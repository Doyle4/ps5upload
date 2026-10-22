// A queue row's game art and identity read from its SOURCE (the .pkg, split package, game folder
// or image on this computer or a saved server), before anything reaches the console: the same
// engine inspection the package viewer uses (`/api/game/inspect` → `icon0.png`).
//
// Kept in memory only, keyed by source path, and never written into the saved queue. Reads are
// lazy (a row asks only while it is waiting and on screen), at most two at a time, and at most
// one at a time from saved servers, so a long queue never floods the engine or a NAS.

import { useEffect, useSyncExternalStore } from "react";

import { gameInspect, gameInspectImageUrl } from "../api/gameInspect";
import type { QueueItem } from "../state/uploadQueue";
import { isRemotePath, parseRemotePath } from "./remotePath";

/** What a source said about itself. Any field can be missing (a folder that is not a game, a
 *  package without an icon). */
export interface SourceArt {
  /** `data:` URL of the source's icon0.png. */
  icon: string | null;
  title: string | null;
  contentId: string | null;
  titleId: string | null;
  /** Bytes the source takes (a split set summed); null when it did not say. */
  size: number | null;
}

export type SourceArtReader = (path: string) => Promise<SourceArt>;

const MAX_ACTIVE = 2;
const MAX_REMOTE_ACTIVE = 1;
/** A read that failed (engine away, server asleep) may be tried again after this long. A
 *  failure is never remembered as "this source has no art". */
const RETRY_AFTER_MS = 60_000;

type Entry =
  | { state: "waiting" }
  | { state: "reading" }
  | { state: "done"; art: SourceArt }
  | { state: "failed"; at: number };

const entries = new Map<string, Entry>();
const waiting: string[] = [];
const listeners = new Set<() => void>();
let active = 0;
let remoteActive = 0;
let reader: SourceArtReader = readSourceArt;

/** The engine read: identity and size from the inspection, then the icon if it has one. */
export async function readSourceArt(path: string): Promise<SourceArt> {
  const { token, inspection } = await gameInspect(path);
  const id = inspection.identity;
  let icon: string | null = null;
  if (inspection.images.some((i) => i.name === "icon0.png")) {
    icon = await gameInspectImageUrl(token, "icon0.png").catch(() => null);
  }
  const size = inspection.source?.size;
  return {
    icon,
    title: id.title?.trim() || null,
    contentId: id.content_id?.trim() || null,
    titleId: id.title_id?.trim() || null,
    size: typeof size === "number" && size > 0 ? size : null,
  };
}

function emit(): void {
  for (const l of listeners) l();
}

function pump(): void {
  for (let i = 0; i < waiting.length && active < MAX_ACTIVE; ) {
    const path = waiting[i];
    const remote = isRemotePath(path);
    if (remote && remoteActive >= MAX_REMOTE_ACTIVE) {
      i++;
      continue;
    }
    waiting.splice(i, 1);
    active++;
    if (remote) remoteActive++;
    entries.set(path, { state: "reading" });
    void reader(path)
      .then(
        (art) => entries.set(path, { state: "done", art }),
        () => entries.set(path, { state: "failed", at: Date.now() }),
      )
      .finally(() => {
        active--;
        if (remote) remoteActive--;
        emit();
        pump();
      });
  }
}

/** Ask for `path`'s art. No-op when it is known, being read, or already asked for; a failed
 *  read is asked again only after RETRY_AFTER_MS. */
export function requestSourceArt(path: string): void {
  const e = entries.get(path);
  if (e && (e.state !== "failed" || Date.now() - e.at < RETRY_AFTER_MS)) return;
  entries.set(path, { state: "waiting" });
  waiting.push(path);
  pump();
}

/** A row that scrolled away or stopped waiting: drop its read if it has not started. */
export function cancelSourceArt(path: string): void {
  const i = waiting.indexOf(path);
  if (i < 0) return;
  waiting.splice(i, 1);
  entries.delete(path);
}

export function sourceArtFor(path: string | null | undefined): SourceArt | null {
  if (!path) return null;
  const e = entries.get(path);
  return e?.state === "done" ? e.art : null;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The path the queue reads art from for this row: a source on this computer or a saved
 *  server that can carry a game's art. Never a console path (the console has its own icon
 *  route for those) and never a link (reading one would download it). */
export function queueArtSourcePath(
  item: Pick<QueueItem, "sourceKind" | "sourcePath" | "install">,
): string | null {
  if (item.sourceKind === "install") {
    const req = item.install;
    return req?.via === "stream" && typeof req.source === "string" && req.source
      ? req.source
      : null;
  }
  switch (item.sourceKind) {
    case "pkg":
    case "image":
    case "game-folder":
      return item.sourcePath || null;
    default:
      return null;
  }
}

/** The saved server a running row is reading from, so a waiting row on the same server holds
 *  its read until that transfer is done instead of competing with it. */
export function busyServers(items: readonly QueueItem[]): Set<string> {
  const out = new Set<string>();
  for (const it of items) {
    if (it.status !== "running") continue;
    const src = it.sourceKind === "install" && it.install?.via === "stream"
      ? it.install.source
      : it.sourcePath;
    const parsed = typeof src === "string" ? parseRemotePath(src) : null;
    if (parsed) out.add(parsed.connectionId);
  }
  return out;
}

/** May this row read its source now? Only while it waits and is on screen, and a saved-server
 *  source only while no transfer is reading from that server. */
export function shouldReadSourceArt(
  path: string | null,
  opts: { pending: boolean; visible: boolean; busy: ReadonlySet<string> },
): boolean {
  if (!path || !opts.pending || !opts.visible) return false;
  const parsed = parseRemotePath(path);
  return !parsed || !opts.busy.has(parsed.connectionId);
}

/** The art for `path` (null until read). Reads it when `want` is true. */
export function useSourceArt(path: string | null, want: boolean): SourceArt | null {
  const art = useSyncExternalStore(
    subscribe,
    () => sourceArtFor(path),
    () => sourceArtFor(path),
  );
  useEffect(() => {
    if (!path || !want) return;
    requestSourceArt(path);
    return () => cancelSourceArt(path);
  }, [path, want]);
  return art;
}

/** Tests: swap the engine read and forget everything. */
export function __resetSourceArtForTests(fn?: SourceArtReader): void {
  entries.clear();
  waiting.length = 0;
  listeners.clear();
  active = 0;
  remoteActive = 0;
  reader = fn ?? readSourceArt;
}
