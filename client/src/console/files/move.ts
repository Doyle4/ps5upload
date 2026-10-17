/**
 * Copy, move, delete and rename for Files.
 *
 * Destinations: the helper's JOB_COPY takes `dest` as the copied item's own
 * new path (payload/ava1/ava1_copy.c: `dest` is the job's root, refused with
 * "exists" when present; the PC app's engine sends the full target path,
 * engine/crates/ps5upload-ava1/src/copy.rs), never the folder to copy into.
 * Likewise rename's `to` is the full new path. So every item goes to
 * <destDir>/<its name>.
 *
 * One request at a time: JOB_COPY walks the source before it answers, on one of
 * the helper's four web workers, so a batch is sent item by item.
 */
import { ApiError, call } from "../api";

export function joinPath(dir: string, name: string): string {
  const d = dir.replace(/\/+$/, "");
  return `${d}/${name}`;
}

export function parentPath(path: string): string {
  const p = path.replace(/\/+$/, "");
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

export function baseName(path: string): string {
  const p = path.replace(/\/+$/, "");
  return p.slice(p.lastIndexOf("/") + 1);
}

/** A folder cannot be copied or moved into itself or one of its subfolders. */
export class IntoItselfError extends Error {
  constructor(item: string) {
    super(`into_itself: ${item}`);
    this.name = "IntoItselfError";
  }
}

/** `destDir` is `item` or inside it (checked on the page, before any request). */
export function isInside(destDir: string, item: string): boolean {
  const d = destDir.replace(/\/+$/, "") || "/";
  const i = item.replace(/\/+$/, "") || "/";
  return d === i || d.startsWith(i === "/" ? "/" : `${i}/`);
}

export interface Failure {
  item: string;
  error: unknown;
}

export interface BatchResult {
  /** Jobs the helper started (copies, cross-drive moves, deletes). */
  started: string[];
  /** Items moved at once by rename (same drive). */
  moved: string[];
  failed: Failure[];
}

type Progress = (done: number, total: number) => void;

async function each(
  items: string[],
  onProgress: Progress | undefined,
  one: (item: string, r: BatchResult) => Promise<void>,
): Promise<BatchResult> {
  const r: BatchResult = { started: [], moved: [], failed: [] };
  for (let i = 0; i < items.length; i++) {
    onProgress?.(i + 1, items.length);
    try {
      await one(items[i], r);
    } catch (error) {
      r.failed.push({ item: items[i], error });
      // The token is gone: every other request would 401 too.
      if (error instanceof ApiError && error.status === 401) break;
    }
  }
  return r;
}

async function startCopy(src: string, dest: string, move: boolean): Promise<string> {
  const { job } = await call<{ job: string }>("/api/fs/copy", { src, dest, move });
  return job;
}

/**
 * Move each item into `destDir`: a rename on the same drive; across drives the
 * helper refuses the rename (409 cross_mount, a cross-mount rename() panics the
 * kernel) and a copy job with move set does it instead.
 */
export async function moveItems(items: string[], destDir: string, onProgress?: Progress): Promise<BatchResult> {
  return each(items, onProgress, async (item, r) => {
    if (isInside(destDir, item)) throw new IntoItselfError(item);
    if (parentPath(item) === destDir.replace(/\/+$/, "")) return; // already there
    const to = joinPath(destDir, baseName(item));
    try {
      await call("/api/fs/rename", { from: item, to });
      r.moved.push(item);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "cross_mount")) throw e;
      r.started.push(await startCopy(item, to, true));
    }
  });
}

export async function copyItems(items: string[], destDir: string, onProgress?: Progress): Promise<BatchResult> {
  return each(items, onProgress, async (item, r) => {
    if (isInside(destDir, item)) throw new IntoItselfError(item);
    r.started.push(await startCopy(item, joinPath(destDir, baseName(item)), false));
  });
}

export async function deleteItems(items: string[], onProgress?: Progress): Promise<BatchResult> {
  return each(items, onProgress, async (item, r) => {
    const { job } = await call<{ job: string }>("/api/fs/delete", { path: item });
    r.started.push(job);
  });
}

/** Rename `name` in `dir` to `newName` (the helper never overwrites: 409 when taken). */
export async function renameEntry(dir: string, name: string, newName: string): Promise<void> {
  await call("/api/fs/rename", { from: joinPath(dir, name), to: joinPath(dir, newName) });
}

/** A name the page can send: not empty, no "/", not "." or "..". */
export function validName(name: string): boolean {
  return name.length > 0 && name.indexOf("/") < 0 && name !== "." && name !== ".." && name.indexOf("\0") < 0;
}

/** The drive (volume path) holding `path`: the longest volume path it starts with. */
export function volumeOf<V extends { path: string }>(path: string, volumes: V[]): V | null {
  let best: V | null = null;
  for (const v of volumes) {
    const root = v.path.replace(/\/+$/, "");
    if ((path === root || path.startsWith(`${root}/`)) && (!best || root.length > best.path.length)) best = v;
  }
  return best;
}

/** One level up from `path`: its parent, or null (the drive list) from a drive's top or "/". */
export function upFrom(path: string | null, volumes: { path: string }[]): string | null {
  if (path == null) return null;
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/" || volumes.some((v) => v.path.replace(/\/+$/, "") === p)) return null;
  return parentPath(p);
}
