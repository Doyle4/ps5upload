/** Paths inside an image and the changes queued for an edited copy (#479). The engine applies
 *  the changes in order and checks each; these helpers only shape what the screen shows. */
import type { ImageEdit } from "../../api/fpkg";

/** `name` inside folder `dir` ("" at the root). */
export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** The last part of a path on this computer or inside an image. */
export function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** The folders from the root down to `dir`, for a breadcrumb: [{name, path}]. */
export function crumbs(dir: string): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  let at = "";
  for (const part of dir.split("/").filter(Boolean)) {
    at = joinPath(at, part);
    out.push({ name: part, path: at });
  }
  return out;
}

/** The folder above `dir` ("" stays ""). */
export function parentDir(dir: string): string {
  const i = dir.lastIndexOf("/");
  return i < 0 ? "" : dir.slice(0, i);
}

/** The folder a saved file or folder landed in, to show it there. */
export function folderOf(dest: string): string {
  const i = Math.max(dest.lastIndexOf("/"), dest.lastIndexOf("\\"));
  return i <= 0 ? dest : dest.slice(0, i);
}

function within(path: string, target: string): boolean {
  return path === target || path.startsWith(`${target}/`);
}

/** What the queued changes do to the entry at `path`: deleted (it or a folder above it),
 *  replaced (a file put on it), or nothing. The last change that touches it wins. */
export function pendingState(edits: ImageEdit[], path: string): "deleted" | "replaced" | null {
  let state: "deleted" | "replaced" | null = null;
  for (const e of edits) {
    if (e.op === "delete" && within(path, e.path)) state = "deleted";
    else if (e.op === "put" && e.path === path) state = "replaced";
    else if (e.op === "put" && within(path, e.path)) state = null;
  }
  return state;
}

/** Queues `edit`, dropping an earlier change it makes pointless: the same path put again, or
 *  anything at or under a path now deleted. */
export function queueEdit(edits: ImageEdit[], edit: ImageEdit): ImageEdit[] {
  const kept = edits.filter((e) =>
    edit.op === "delete" ? !(e.op === "put" && within(e.path, edit.path)) : !(e.op === "put" && e.path === edit.path),
  );
  return [...kept, edit];
}
