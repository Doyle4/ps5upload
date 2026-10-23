// The console's own saved network shares (#498, engine /api/ps5/console-shares): the list
// PS5Upload Minion browses in Files and scans for its game Library. They live on the console;
// the PC adds, edits and removes them here. The console signs in to a share before it saves it.
// A plain fetch against the engine origin, so the desktop app and the web UI take the same path.

import { getEngineUrl } from "../state/engine";
import { consoleAddr } from "../lib/addr";

export interface ConsoleShare {
  id: string;
  name: string;
  host: string;
  port: number;
  share: string;
  user: string;
  domain: string;
  start_path: string;
  has_password: boolean;
}

export interface ConsoleShareInput {
  /** Absent: a new share. */
  id?: string;
  name: string;
  /** An address as typed: "nas", "192.168.1.10:445", "smb://nas/Share/folder". */
  server: string;
  share: string;
  user: string;
  /** Absent when editing: the console keeps the saved one. */
  password?: string;
  domain: string;
  start_path: string;
}

/** A refusal: `reason` is the helper's token (smb_auth, smb_unreachable, unsupported, ...). */
export class ConsoleShareError extends Error {
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = "ConsoleShareError";
    this.reason = reason;
  }
}

/** A save signs in to the server through the console first. */
const SAVE_TIMEOUT_MS = 60_000;

async function engineJson(route: string, init?: RequestInit, timeoutMs = 20_000): Promise<Record<string, unknown>> {
  const res = await fetch(`${getEngineUrl()}${route}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ConsoleShareError(
      typeof body.error === "string" && body.error ? body.error : `request failed (${res.status})`,
      typeof body.reason === "string" ? body.reason : "failed",
    );
  }
  return body;
}

const post = (route: string, body: object, timeoutMs?: number) =>
  engineJson(
    route,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    timeoutMs,
  );

function toShare(v: unknown): ConsoleShare | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  if (typeof s.id !== "string" || typeof s.host !== "string" || typeof s.share !== "string") return null;
  return {
    id: s.id,
    name: typeof s.name === "string" ? s.name : s.share,
    host: s.host,
    port: typeof s.port === "number" ? s.port : 445,
    share: s.share,
    user: typeof s.user === "string" ? s.user : "",
    domain: typeof s.domain === "string" ? s.domain : "",
    start_path: typeof s.start_path === "string" ? s.start_path : "",
    has_password: s.has_password === true,
  };
}

/** The console's shares; null when its helper is older than this feature. */
export async function listConsoleShares(host: string): Promise<ConsoleShare[] | null> {
  try {
    const b = await engineJson(`/api/ps5/console-shares?addr=${encodeURIComponent(consoleAddr(host))}`);
    return Array.isArray(b.shares) ? b.shares.map(toShare).filter((s): s is ConsoleShare => s !== null) : [];
  } catch (e) {
    if (e instanceof ConsoleShareError && e.reason === "unsupported") return null;
    throw e;
  }
}

export async function saveConsoleShare(host: string, input: ConsoleShareInput): Promise<ConsoleShare> {
  const b = await post("/api/ps5/console-shares/save", { addr: consoleAddr(host), ...input }, SAVE_TIMEOUT_MS);
  const s = toShare(b.share);
  if (!s) throw new ConsoleShareError("Invalid reply from the console", "bad_reply");
  return s;
}

export async function removeConsoleShare(host: string, id: string): Promise<void> {
  await post("/api/ps5/console-shares/remove", { addr: consoleAddr(host), id });
}
