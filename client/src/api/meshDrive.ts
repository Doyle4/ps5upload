// Mesh Drive (8.0.0, engine /api/drive*): a folder kept the same across devices, with its home on a
// console. An older helper answers {supported:false}.

import { getEngineUrl } from "../state/engine";
import { consoleAddr } from "../lib/addr";

export interface DriveMember {
  id: string;
  device: string;
  device_name: string;
  path: string;
  approved: boolean;
  paused: boolean;
  joined: number;
}

export interface Drive {
  id: string;
  name: string;
  hub: string;
  created: number;
  by: string;
  members: DriveMember[];
}

export interface DriveStatus {
  state: string;
  detail: string;
  last_ok: number;
  files: number;
  uploaded: number;
  downloaded: number;
  deleted: number;
  conflicts: number;
  held_deletes: number;
}

export interface LocalDriveMember {
  drive: string;
  member: string;
  path: string;
  status: DriveStatus;
}

export type DrivesAnswer =
  | { supported: false }
  | { supported: true; me: string | null; kind: string; suggest: string | null; drives: Drive[]; local: LocalDriveMember[] };

async function engineJson(route: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`${getEngineUrl()}${route}`, { ...init, signal: AbortSignal.timeout(60_000) });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof body.error === "string" && body.error ? body.error : `request failed (${res.status})`);
  }
  return body;
}

const post = (route: string, body: object) =>
  engineJson(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export async function fetchDrives(host: string): Promise<DrivesAnswer> {
  const b = await engineJson(`/api/drive?addr=${encodeURIComponent(consoleAddr(host))}`);
  if (b.supported !== true) return { supported: false };
  return {
    supported: true,
    me: typeof b.me === "string" ? b.me : null,
    kind: typeof b.kind === "string" ? b.kind : "",
    suggest: typeof b.suggest === "string" ? b.suggest : null,
    drives: Array.isArray(b.drives) ? (b.drives as Drive[]) : [],
    local: Array.isArray(b.local) ? (b.local as LocalDriveMember[]) : [],
  };
}

const call = (route: string) => async (host: string, body: object) => {
  const b = await post(route, { addr: consoleAddr(host), ...body });
  if (b.supported !== true) throw new Error("Update the console's helper to use Mesh Drive.");
  return b;
};

export const driveApi = {
  create: (host: string, name: string, hub: string, path: string | null) =>
    call("/api/drive/create")(host, { name, hub, path }),
  join: (host: string, drive: string, path: string) => call("/api/drive/join")(host, { drive, path }),
  approve: (host: string, drive: string, member: string, approve: boolean) =>
    call("/api/drive/approve")(host, { drive, member, approve }),
  leave: (host: string, drive: string, member: string) => call("/api/drive/leave")(host, { drive, member }),
  remove: (host: string, drive: string) => call("/api/drive/delete")(host, { drive }),
  pause: (host: string, drive: string, member: string, paused: boolean) =>
    call("/api/drive/pause")(host, { drive, member, paused }),
  sync: (host: string, drive: string) => call("/api/drive/sync")(host, { drive }),
  confirm: (host: string, drive: string, member: string) => call("/api/drive/confirm")(host, { drive, member }),
};

/** "ps5://192.168.1.5/data/x" -> "/data/x". */
export function consolePathOf(picked: string): string {
  if (!picked.startsWith("ps5://")) return picked;
  const rest = picked.slice("ps5://".length);
  const i = rest.indexOf("/");
  return i < 0 ? "/" : rest.slice(i);
}
