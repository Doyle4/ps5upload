// A queue row's game art and identity read from its SOURCE (the .pkg, split package, game folder
// or image on this computer or a saved server), before anything reaches the console: the same
// engine inspection the package viewer uses (`/api/game/inspect` → `icon0.png`).
//
// Kept in memory only, keyed by source path, and never written into the saved queue. Reads are
// lazy (a row asks only while it is on screen and waiting, or running from this computer), at
// most two at a time, and at most one at a time from saved servers, so a long queue never floods
// the engine or a NAS.

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
/** Results kept at most; the oldest one no row shows goes first. */
const MAX_ENTRIES = 100;
/** Edge the icon is kept at: the row shows it at 32-44 px, so this covers a 2x screen. */
export const ICON_KEEP_PX = 96;
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
/** Rows that asked for each path's read: one row going away cancels nothing another wants. */
const wants = new Map<string, number>();
/** Rows showing each path: an entry a row shows is never evicted. */
const viewers = new Map<string, number>();
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
    if (icon) icon = await downscaleIcon(icon, ICON_KEEP_PX);
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

/** A `data:` icon redrawn at `px` across (a full icon0.png is 300-700 KiB; the queue keeps up to
 *  MAX_ENTRIES of them). Uses only standard DOM APIs, so it works in the browser build too; where
 *  they are missing or fail, the original is kept. */
export async function downscaleIcon(url: string, px: number): Promise<string> {
  try {
    if (typeof document === "undefined" || typeof Image === "undefined") return url;
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h || (w <= px && h <= px)) return url;
    const scale = px / Math.max(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return url;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return url;
  }
}

/** Forget the oldest finished entries no row shows, down to MAX_ENTRIES. */
function evict(): void {
  if (entries.size <= MAX_ENTRIES) return;
  for (const [path, e] of entries) {
    if (entries.size <= MAX_ENTRIES) break;
    if ((e.state === "done" || e.state === "failed") && !(viewers.get(path) ?? 0)) {
      entries.delete(path);
    }
  }
}

function bump(map: Map<string, number>, path: string, by: number): number {
  const n = Math.max(0, (map.get(path) ?? 0) + by);
  if (n) map.set(path, n);
  else map.delete(path);
  return n;
}

/** A row starts showing `path`'s art. Returns the matching release. */
export function viewSourceArt(path: string): () => void {
  bump(viewers, path, 1);
  return () => {
    bump(viewers, path, -1);
    evict();
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
        (art) => {
          // Re-inserted, so the Map's order is least recently finished first.
          entries.delete(path);
          entries.set(path, { state: "done", art });
        },
        () => {
          entries.delete(path);
          entries.set(path, { state: "failed", at: Date.now() });
        },
      )
      .finally(() => {
        active--;
        if (remote) remoteActive--;
        evict();
        emit();
        pump();
      });
  }
}

/** Ask for `path`'s art (one per asking row; pair it with cancelSourceArt). Reads nothing when
 *  it is known, being read, or already asked for; a failed read is asked again only after
 *  RETRY_AFTER_MS. */
export function requestSourceArt(path: string): void {
  bump(wants, path, 1);
  const e = entries.get(path);
  if (e && (e.state !== "failed" || Date.now() - e.at < RETRY_AFTER_MS)) return;
  entries.set(path, { state: "waiting" });
  waiting.push(path);
  pump();
}

/** A row that scrolled away or stopped waiting: its read is dropped once no row wants it and
 *  only if it has not started. */
export function cancelSourceArt(path: string): void {
  if (bump(wants, path, -1) > 0) return;
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

/** May this row read its source now? Only while it is on screen and waits, or runs from this
 *  computer (#479: a row added to an idle queue starts at once, and must not wait for the
 *  install to finish before it shows its game). A saved-server source is read only while it
 *  waits and no transfer is reading from that server. */
export function shouldReadSourceArt(
  path: string | null,
  opts: { pending: boolean; running?: boolean; visible: boolean; busy: ReadonlySet<string> },
): boolean {
  if (!path || !opts.visible) return false;
  const parsed = parseRemotePath(path);
  if (opts.running && !parsed) return true;
  if (!opts.pending) return false;
  return !parsed || !opts.busy.has(parsed.connectionId);
}

/** The art for `path` (null until read). Reads it when `want` is true. */
export function useSourceArt(path: string | null, want: boolean): SourceArt | null {
  const art = useSyncExternalStore(
    subscribe,
    () => sourceArtFor(path),
    () => sourceArtFor(path),
  );
  useEffect(() => (path ? viewSourceArt(path) : undefined), [path]);
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
  wants.clear();
  viewers.clear();
  active = 0;
  remoteActive = 0;
  reader = fn ?? readSourceArt;
}
