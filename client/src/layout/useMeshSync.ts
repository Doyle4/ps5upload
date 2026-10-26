import { useEffect } from "react";

import { hostOf } from "../lib/addr";
import { isTauriEnv } from "../lib/tauriEnv";
import { syncId } from "../lib/meshShare";
import { dailyBackup } from "../lib/settingsBackup";
import { useConnectionStore } from "../state/connection";
import { useTr } from "../state/lang";
import {
  deviceName,
  loadMeshMe,
  onMeshEvent,
  pollMesh,
  presenceItems,
  publishPresence,
  useMeshStore,
} from "../state/mesh";
import { useTaskStore } from "../state/tasks";
import { useToastStore } from "../state/toasts";

/** How often the selected console's devices are read while the window is shown. */
export const MESH_POLL_MS = 4_000;
/** How often this window's presence is checked (it is sent only when it changed, or every 8 s). */
export const PRESENCE_MS = 3_000;
/** The daily settings backup is looked at this often (it runs once a day; lib/settingsBackup). */
const BACKUP_CHECK_MS = 60 * 60 * 1000;

/** How a backup names the app that made it: a browser of a Docker engine says so (several
 *  browsers share the engine's name). */
export function backupLabel(engineName: string | undefined): string {
  const name = engineName || "PS5Upload";
  return isTauriEnv() ? name : `${name} (browser)`;
}

/**
 * The multi-device mesh, app-wide (8.0.0):
 *  - reads the selected console's devices, locks and events every few seconds while shown;
 *  - publishes what this window is doing on each console whose helper is up, even while hidden
 *    (an upload goes on with the window minimised, and the others should still see it);
 *  - tells the user when another device restarts the helper, takes a task over, or joins.
 * Against a helper from before 8.0.0 the reads answer "not supported" and nothing is shown.
 */
export function useMeshSync() {
  const host = useConnectionStore((s) => s.host);
  const up = useConnectionStore((s) => s.payloadStatus === "up");
  const tr = useTr();

  useEffect(() => {
    void loadMeshMe();
  }, []);

  // The daily settings backup: to the engine, and to the connected console (8.0.1). The first look
  // waits a minute, so a start-up is not slowed and the device knows its id by then.
  useEffect(() => {
    const run = () => {
      const conn = useConnectionStore.getState();
      const mesh = useMeshStore.getState();
      const key = hostOf(conn.host);
      const supported = !!key && conn.payloadStatus === "up" && mesh.byHost[key]?.supported === true;
      void dailyBackup(supported ? key : null, syncId(), backupLabel(mesh.me?.name));
    };
    const first = window.setTimeout(run, 60_000);
    const id = window.setInterval(run, BACKUP_CHECK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);

  // Read the selected console.
  useEffect(() => {
    const key = hostOf(host);
    if (!key || !up) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      if (typeof document === "undefined" || document.visibilityState === "visible") await pollMesh(key);
      if (!stopped) timer = setTimeout(tick, MESH_POLL_MS);
    };
    void tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") void pollMesh(key);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [host, up]);

  // Publish this window's work, per console it touches (and the selected one, idle or not).
  useEffect(() => {
    const id = window.setInterval(() => {
      const tasks = useTaskStore.getState().tasks;
      const conn = useConnectionStore.getState();
      const hosts = new Set<string>();
      for (const t of tasks) hosts.add(hostOf(t.consoleId));
      if (conn.payloadStatus === "up") hosts.add(hostOf(conn.host));
      for (const h of hosts) {
        if (!h) continue;
        const rt = conn.runtimeByHost[h];
        if (rt && rt.payloadStatus !== "up") continue;
        void publishPresence(h, presenceItems(tasks, h));
      }
    }, PRESENCE_MS);
    return () => window.clearInterval(id);
  }, []);

  // What the other devices did.
  useEffect(
    () =>
      onMeshEvent((_host, e, state) => {
        const by = state.devices.find((d) => d.id === e.by);
        const name = by ? deviceName(by) : tr("mesh_another_device", undefined, "Another device");
        const push = useToastStore.getState().push;
        switch (e.kind) {
          case "restart":
            push({
              tone: "warn",
              message: tr(
                "mesh_ev_restart",
                { name },
                `${name} is restarting the helper on this console. Transfers pause and pick up again in a moment.`,
              ),
            });
            break;
          case "takeover":
            push({ tone: "warn", message: e.text });
            break;
          case "joined":
            push({
              tone: "info",
              message: tr("mesh_ev_joined", { name }, `${name} connected to this console for the first time`),
            });
            break;
          default:
            break;
        }
      }),
    [tr],
  );
}
