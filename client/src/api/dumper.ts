// EchoStretch's ps5-app-dumper (GPLv3) through the engine's /api/ps5/dumper routes: whether it
// runs, the code the TV shows, and its dump, queue and finished-dump calls. Plain fetches against
// the engine origin, so the desktop app, the browser build and the Docker build take one path.

import { getEngineUrl } from "../state/engine";
import { hostOf } from "../lib/addr";

/** The dumper's job (its `/api/status` `job`). */
export interface DumperJob {
  /** idle | preparing | dumping | done | failed | aborted (the dumper's own names). */
  state: string;
  appDir: string;
  title: string;
  titleId: string;
  dest: string;
  stage: string;
  currentFile: string;
  message: string;
  totalBytes: number;
  copiedBytes: number;
  started: number;
  copyStarted: number;
  finished: number;
  now: number;
}

export interface DumperQueueItem {
  titleId: string;
  title: string;
  custom: boolean;
  isDisc: boolean;
  discIn: boolean;
  /** waiting | launching | loading | dumping | done | failed | skipped (the dumper's names). */
  state: string;
  message: string;
}

export interface DumperQueue {
  active: boolean;
  current: number;
  settle: number;
  wait: number;
  target: string;
  items: DumperQueueItem[];
}

export interface DumperStatus {
  job: DumperJob;
  queue: DumperQueue;
  busy: boolean;
}

export type DumperOverview =
  | { present: false }
  | {
      present: true;
      port: number;
      version: string;
      /** The dumper asks for the code at all (it can be switched off on the console). */
      required: boolean;
      /** This app holds a token the dumper takes. */
      unlocked: boolean;
      status: DumperStatus | null;
    };

/** A title mounted now (the running game): what can be dumped this moment. */
export interface DumperApp {
  dir: string;
  titleId: string;
  title: string;
  version: string;
  isPs4: boolean;
  media: "disc" | "pkg";
  installed: number;
  installing: boolean;
}

/** A drive a dump can go to. */
export interface DumperTarget {
  mount: string;
  fs: string;
  writable: boolean;
  internal: boolean;
  totalBytes: number;
  freeBytes: number;
}

export interface DumperDevices {
  apps: DumperApp[];
  targets: DumperTarget[];
}

/** An installed title the dumper can start (and then dump). */
export interface DumperTitle {
  titleId: string;
  title: string;
  version: string;
  isPs4: boolean;
  isRunning: boolean;
  media: "disc" | "pkg";
  discIn: boolean;
  installed: number;
  installing: boolean;
}

export interface DumperLibrary {
  titles: DumperTitle[];
  aTitleIsRunning: boolean;
  canLaunch: boolean;
}

/** A dump on a drive. */
export interface DumperDump {
  mount: string;
  dir: string;
  folder: string;
  titleId: string;
  title: string;
  /** done | incomplete | … (the dumper's names) */
  state: string;
  internal: boolean;
  inUse: boolean;
  bytes: number;
  /** How many executables are FSELF-signed. */
  fself: number;
}

export interface DumperDumps {
  consoleListed: boolean;
  dumps: DumperDump[];
}

/** An error from the dumper. `locked`: the code from the TV is needed (again). */
export class DumperError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly locked = false,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new DumperError(
      typeof body.error === "string" ? body.error : `request failed (${res.status})`,
      res.status,
      body.locked === true,
      body,
    );
  }
  return body as T;
}

const base = () => `${getEngineUrl()}/api/ps5/dumper`;

export const dumperApi = {
  overview: async (host: string): Promise<DumperOverview> =>
    readJson(await fetch(`${base()}?host=${encodeURIComponent(hostOf(host))}`)),

  read: async <T>(host: string, what: "status" | "devices" | "library" | "dumps"): Promise<T> =>
    readJson(await fetch(`${base()}/read?host=${encodeURIComponent(hostOf(host))}&what=${what}`)),

  unlock: async (host: string, code: string): Promise<void> => {
    await readJson(
      await fetch(`${base()}/unlock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host: hostOf(host), code }),
      }),
    );
  },

  showCode: async (host: string): Promise<void> => {
    await readJson(
      await fetch(`${base()}/show-code`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host: hostOf(host) }),
      }),
    );
  },

  call: async <T = Record<string, unknown>>(
    host: string,
    path: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> =>
    readJson(
      await fetch(`${base()}/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          host: hostOf(host),
          path,
          params: Object.fromEntries(
            Object.entries(params).map(([k, v]) => [k, typeof v === "boolean" ? (v ? "1" : "0") : String(v)]),
          ),
        }),
      }),
    ),
};

/** Where a dump sits on the console: `<mount>/<dir>/<folder>`. */
export function dumpPath(d: Pick<DumperDump, "mount" | "dir" | "folder">): string {
  return [d.mount, d.dir, d.folder].map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean).reduce((a, p) => `${a}/${p}`, "");
}

/** Bytes copied of the job, 0-1, or null before its size is known. */
export function jobFraction(j: Pick<DumperJob, "totalBytes" | "copiedBytes">): number | null {
  return j.totalBytes > 0 ? Math.min(1, j.copiedBytes / j.totalBytes) : null;
}

/** Seconds left at the job's average rate since copying began, or null. */
export function jobEta(j: DumperJob): number | null {
  if (!j.copyStarted || j.totalBytes <= 0 || j.copiedBytes <= 0) return null;
  const elapsed = j.now - j.copyStarted;
  if (elapsed <= 0) return null;
  const rate = j.copiedBytes / elapsed;
  return rate > 0 ? Math.max(0, Math.round((j.totalBytes - j.copiedBytes) / rate)) : null;
}

/** Whether a job is running (not idle and not ended). */
export function jobRunning(j: Pick<DumperJob, "state">): boolean {
  return !["idle", "done", "failed", "aborted", ""].includes(j.state);
}
