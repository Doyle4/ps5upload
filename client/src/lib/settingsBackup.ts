// Settings backups (8.0.1). A bundle is every `ps5upload.` key of this app's storage (the same JSON
// Settings › Export bundle saves). Copies are kept in two places so either can bring a device back:
//  * the engine (`/api/settings-backup`, its data folder; Docker's volume for the web UI): the
//    newest 14, one a day plus one before a sync or a restore changes several settings at once;
//  * the console (mesh document `backup-<device>`): this device's latest, trimmed to fit, so a
//    device whose disk was wiped gets its set-up back from any console it used.

import { meshDocGet, meshDocPut } from "../api/mesh";
import { getEngineUrl } from "../state/engine";
import { safeGetItem, safeRemoveItem, safeSetItem } from "./safeStorage";

export const NS_PREFIX = "ps5upload.";
/** When the last automatic backup was taken (never itself backed up or restored). */
const LAST_AUTO_KEY = "ps5upload.settings_backup.last_auto.v1";
/** Per console: when this device's copy there was last written ({host: ms}). Not backed up either. */
const LAST_CONSOLE_KEY = "ps5upload.settings_backup.last_console.v1";
const OWN_KEYS = new Set([LAST_AUTO_KEY, LAST_CONSOLE_KEY]);
const DAY_MS = 24 * 60 * 60 * 1000;
/** Before-sync backups at most this often (a busy sync must not rotate the daily ones out). */
const BEFORE_SYNC_EVERY_MS = 60 * 60 * 1000;
/** A console document holds at most 160 KiB; the console copy stays under this. */
const CONSOLE_BUDGET = 140 * 1024;

export interface Bundle {
  meta: { generated_at_ms: number; schema: 1; reason?: string; device?: string; dropped?: string[] };
  local_storage: Record<string, string | null>;
}

export function buildBundle(reason = "manual", device = ""): Bundle {
  const local_storage: Record<string, string | null> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(NS_PREFIX) && !OWN_KEYS.has(k)) local_storage[k] = safeGetItem(k);
    }
  } catch {
    // Storage blocked: an empty bundle, which nothing restores from.
  }
  return {
    meta: { generated_at_ms: Date.now(), schema: 1, reason, device },
    local_storage,
  };
}

/** Writes a bundle's keys back (only this app's namespace). Returns how many. Throws on a file
 *  that is not a bundle, before anything is written. */
export function applyBundle(parsed: unknown): number {
  if (!parsed || typeof parsed !== "object" || typeof (parsed as Bundle).local_storage !== "object") {
    throw new Error("file is not a ps5upload settings bundle");
  }
  const ls = (parsed as Bundle).local_storage as Record<string, unknown>;
  const actions: Array<{ key: string; value: string | null }> = [];
  for (const k of Object.keys(ls)) {
    // Only our own namespace: a hand-edited bundle can't write arbitrary keys.
    if (!k.startsWith(NS_PREFIX) || OWN_KEYS.has(k)) continue;
    const v = ls[k];
    if (typeof v === "string") actions.push({ key: k, value: v });
    else if (v === null) actions.push({ key: k, value: null });
    else if (v !== undefined) throw new Error(`invalid value for ${k}`);
  }
  for (const { key, value } of actions) {
    if (value === null) safeRemoveItem(key);
    else safeSetItem(key, value);
  }
  return actions.length;
}

/** The bundle cut to `budget` bytes for the console: the largest values (histories, caches) go
 *  first, and are listed in `meta.dropped`. */
export function trimBundle(b: Bundle, budget = CONSOLE_BUDGET): Bundle {
  const entries = Object.entries(b.local_storage).sort(
    (x, y) => (x[1]?.length ?? 0) + x[0].length - ((y[1]?.length ?? 0) + y[0].length),
  );
  const kept: Record<string, string | null> = {};
  const dropped: string[] = [];
  let size = 512;
  for (const [k, v] of entries) {
    const add = k.length + (v?.length ?? 4) + 8;
    if (size + add > budget) dropped.push(k);
    else {
      kept[k] = v;
      size += add;
    }
  }
  return { meta: { ...b.meta, dropped }, local_storage: kept };
}

// ---- the engine's copies ----

export interface BackupEntry {
  id: string;
  at: number;
  reason: string;
  device: string;
  keys: number;
  bytes: number;
}

async function engine(route: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${getEngineUrl()}${route}`, { ...init, signal: AbortSignal.timeout(20_000) });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 404) throw new Error("This app's engine is older than 8.0.1: restart or update it.");
  if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
  return body;
}

export async function listEngineBackups(): Promise<BackupEntry[]> {
  const b = (await engine("/api/settings-backup")) as { backups?: BackupEntry[] };
  return Array.isArray(b.backups) ? b.backups : [];
}

export async function getEngineBackup(id: string): Promise<Bundle> {
  return (await engine(`/api/settings-backup/get?id=${encodeURIComponent(id)}`)) as Bundle;
}

export async function saveEngineBackup(bundle: Bundle): Promise<void> {
  await engine("/api/settings-backup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: bundle.meta.reason ?? "manual", bundle }),
  });
}

// ---- the console's copy ----

/** Document names are [a-z0-9-_], at most 40: this device's key, shortened. */
export function consoleDocName(deviceId: string): string {
  return `backup-${deviceId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24)}`;
}

export async function saveConsoleBackup(host: string, deviceId: string, bundle: Bundle): Promise<boolean> {
  const name = consoleDocName(deviceId);
  const doc = trimBundle(bundle) as unknown as Record<string, unknown>;
  for (let i = 0; i < 3; i++) {
    const cur = await meshDocGet(host, name);
    if (!cur.supported) return false;
    const put = await meshDocPut(host, name, cur.rev, doc);
    if (!put.supported) return false;
    if (put.saved) return true;
  }
  return false;
}

export async function getConsoleBackup(host: string, deviceId: string): Promise<Bundle | null> {
  const got = await meshDocGet(host, consoleDocName(deviceId));
  if (!got.supported || !got.doc) return null;
  const b = got.doc as unknown as Bundle;
  return b.local_storage && typeof b.local_storage === "object" ? b : null;
}

// ---- automatic ----

let lastBeforeSync = 0;

/** A copy taken now, before a sync writes several settings: kept by the engine. Never throws. */
export function backupBeforeChange(reason: "before-sync" | "before-restore", device = ""): Promise<void> {
  if (reason === "before-sync") {
    if (Date.now() - lastBeforeSync < BEFORE_SYNC_EVERY_MS) return Promise.resolve();
    lastBeforeSync = Date.now();
  }
  // Built now (synchronously), so it holds the settings from before the change.
  const b = buildBundle(reason, device);
  return saveEngineBackup(b).catch((e) => console.warn("[settings-backup]", e instanceof Error ? e.message : e));
}

/** The daily copy: to the engine, and to the console when one that keeps documents is connected.
 *  Never throws. */
export async function dailyBackup(host: string | null, deviceId: string | null, device = ""): Promise<void> {
  const now = Date.now();
  const due = (at: unknown) => !(typeof at === "number" && now - at < DAY_MS && at <= now);
  let consoles: Record<string, number>;
  try {
    consoles = (JSON.parse(safeGetItem(LAST_CONSOLE_KEY) ?? "{}") as Record<string, number> | null) ?? {};
  } catch {
    consoles = {};
  }
  const engineDue = due(Number(safeGetItem(LAST_AUTO_KEY) ?? 0));
  const consoleDue = !!host && !!deviceId && due(consoles[host]);
  if (!engineDue && !consoleDue) return;
  const b = buildBundle("daily", device);
  if (!Object.keys(b.local_storage).length) return;
  if (engineDue) {
    try {
      await saveEngineBackup(b);
      safeSetItem(LAST_AUTO_KEY, String(now));
    } catch (e) {
      console.warn("[settings-backup]", e instanceof Error ? e.message : e);
    }
  }
  if (consoleDue && host && deviceId && (await saveConsoleBackup(host, deviceId, b).catch(() => false))) {
    safeSetItem(LAST_CONSOLE_KEY, JSON.stringify({ ...consoles, [host]: now }));
  }
}
