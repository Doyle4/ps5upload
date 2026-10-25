/**
 * Settings and the console list, shared by every device that uses a console (8.0.0). Each console
 * keeps two documents: "prefs" (the keys in `MESH_KEYS`, newest change per key wins) and
 * "consoles" (the console list, merged per console so nobody's console is dropped). The app syncs
 * with the console on screen whenever its helper answers: on connecting, on a change here, on
 * focus and every minute. A new device therefore gets the household's consoles and set-up the
 * first time it connects; a change made on one device reaches the others through whichever
 * console they next meet.
 *
 * A console with a helper from before 8.0.0 has no documents: nothing is shared through it.
 */
import { meshDocGet, meshDocPut } from "../api/mesh";
import { useConnectionStore } from "../state/connection";
import { meshFor, useMeshStore } from "../state/mesh";
import { RosterShare, type SharedProfile, type ShareApi } from "../state/rosterShare";
import { collapseByHost, useRosterStore } from "../state/roster";
import { hostOf } from "./addr";
import { asDoc, MESH_CHANNEL, startSharedPrefs, syncOnce, type Entries, type PrefsApi } from "./sharedPrefs";

/** The console on screen, when its helper keeps documents; else null. */
export function meshHost(): string | null {
  const c = useConnectionStore.getState();
  const host = hostOf(c.host);
  if (!host || c.payloadStatus !== "up") return null;
  return meshFor(useMeshStore.getState(), host).supported === true ? host : null;
}

class NoConsole extends Error {
  constructor() {
    super("no console that keeps shared settings");
  }
}

/** The "prefs" document of the console on screen. */
export const meshPrefsApi: PrefsApi = {
  async get() {
    const host = meshHost();
    if (!host) throw new NoConsole();
    const d = await meshDocGet(host, "prefs");
    if (!d.supported) throw new NoConsole();
    return asDoc({ rev: d.rev, value: d.doc });
  },
  async put(baseRev: number, keys: Entries) {
    const host = meshHost();
    if (!host) throw new NoConsole();
    const r = await meshDocPut(host, "prefs", baseRev, { keys });
    if (!r.supported) throw new NoConsole();
    if (r.saved) return { rev: r.rev };
    return { conflict: asDoc({ rev: r.rev, value: r.doc }) };
  },
};

/**
 * A console list from another device, in this device's terms. Each device names a console with
 * an id of its own, so the same PS5 added on two devices has two ids: matched by address, an
 * incoming entry takes this device's id (tasks and the selected console refer to it), and the
 * list keeps one entry per address. (8.0.0 matched by id only and listed such a PS5 twice.)
 */
export function inLocalTerms(list: readonly SharedProfile[], local: readonly { id: string; host: string }[]): SharedProfile[] {
  const idByHost = new Map<string, string>();
  for (const p of local) {
    const key = hostOf(p.host);
    if (key && !idByHost.has(key)) idByHost.set(key, p.id);
  }
  const mapped = list.map((p) => {
    const id = idByHost.get(hostOf(p.host));
    return id ? { ...p, id } : p;
  });
  return collapseByHost(mapped);
}

/** `host`'s "consoles" document. */
export function meshRosterApi(host: string): ShareApi {
  const asRoster = (rev: number, doc: Record<string, unknown> | null) => ({
    rev,
    value:
      doc && Array.isArray(doc.profiles)
        ? { profiles: inLocalTerms(doc.profiles as SharedProfile[], useRosterStore.getState().profiles) }
        : null,
  });
  return {
    async get() {
      const d = await meshDocGet(host, "consoles");
      if (!d.supported) throw new NoConsole();
      return asRoster(d.rev, d.doc);
    },
    async put(baseRev, profiles) {
      const r = await meshDocPut(host, "consoles", baseRev, { profiles: collapseByHost(profiles) });
      if (!r.supported) throw new NoConsole();
      if (r.saved) return { rev: r.rev };
      return { conflict: asRoster(r.rev, r.doc) };
    },
  };
}

const PULL_MS = 60_000;

/** Starts sharing; returns a stop. `onLive` gets the sidebar keys another device changed;
 *  `onSettingsArrived` how many other settings arrived (they apply when the app next starts). */
export function startMeshShare(
  onLive: (keys: string[]) => void,
  onSettingsArrived: (count: number) => void = () => {},
): () => void {
  const warn = (e: unknown) => {
    if (e instanceof NoConsole) return;
    console.warn("[mesh-share]", e instanceof Error ? e.message : String(e));
  };
  // Settings: changes here are sent as they happen, the console's fetched on focus and every
  // minute (through whichever console is on screen at that moment).
  const stopPrefs = startSharedPrefs(onLive, meshPrefsApi, MESH_CHANNEL);

  // The console list, one share per console met.
  const shares = new Map<string, { share: RosterShare; started: boolean }>();
  const shareFor = (host: string) => {
    let s = shares.get(host);
    if (!s) {
      s = { share: new RosterShare(meshRosterApi(host), useRosterStore, "union"), started: false };
      shares.set(host, s);
    }
    return s;
  };
  const syncHost = (host: string) => {
    // Duplicates left by 8.0.0 (or added by hand) go before anything is shared.
    useRosterStore.getState().dedupeByHost();
    const s = shareFor(host);
    const job = s.started ? s.share.pull() : s.share.start().then(() => void (s.started = true));
    void job.catch(warn);
  };

  // Whenever the console on screen becomes one that keeps documents: settings and list now.
  let lastHost: string | null = null;
  const onMesh = () => {
    const host = meshHost();
    if (host === lastHost) return;
    lastHost = host;
    if (!host) return;
    void syncOnce(meshPrefsApi, undefined, MESH_CHANNEL)
      .then((written) => {
        const live = written.filter((k) => k.startsWith("ps5upload.desktop-sidebar."));
        if (live.length) onLive(live);
        // The rest are read when the app starts: say so, once per batch.
        if (written.length > live.length) onSettingsArrived(written.length - live.length);
      })
      .catch(warn);
    syncHost(host);
  };
  const unsubMesh = useMeshStore.subscribe(onMesh);
  const unsubConn = useConnectionStore.subscribe(onMesh);
  onMesh();

  const unsubRoster = useRosterStore.subscribe((st, prev) => {
    if (st.profiles === prev.profiles) return;
    const host = meshHost();
    if (!host) return;
    const s = shareFor(host);
    if (!s.started || s.share.applyingRemote) return;
    void s.share.push().catch(warn);
  });

  const timer = window.setInterval(() => {
    const host = meshHost();
    if (host && document.visibilityState === "visible") syncHost(host);
  }, PULL_MS);

  return () => {
    stopPrefs();
    unsubMesh();
    unsubConn();
    unsubRoster();
    window.clearInterval(timer);
  };
}
