// Which of a game's copies Convert can take, and the one to offer first.
//
// Convert takes a game folder, a game image (.exfat, .ffpkg, .ffpfs, .ffpfsc), an archive (.zip,
// .7z, .rar) or a base-game package (unpacked into a folder or image). An update or DLC package is
// not a game on its own, so it is never offered.
import type { CollectionLocation } from "../api/collection";
import { isRemotePath } from "./remotePath";

const ARCHIVES = new Set(["zip", "7z", "rar"]);

export function isConvertible(
  loc: Pick<CollectionLocation, "type" | "pkg">,
): boolean {
  if (
    loc.type === "folder" ||
    loc.type.startsWith("mount.") ||
    ARCHIVES.has(loc.type)
  )
    return true;
  if (loc.type === "pkg")
    return loc.pkg?.kind !== "patch" && loc.pkg?.kind !== "dlc";
  return false;
}

/** Folder first (nothing to unpack), then an image, an archive, a base package; a copy on this
 *  computer before one on a saved server; then the largest (most likely the complete one). */
function rank(loc: CollectionLocation): number {
  const kind =
    loc.type === "folder"
      ? 0
      : loc.type.startsWith("mount.")
        ? 1
        : ARCHIVES.has(loc.type)
          ? 2
          : 3;
  return kind * 2 + (isRemotePath(loc.absolute_path) ? 1 : 0);
}

export function bestConvertible(
  locs: CollectionLocation[],
): CollectionLocation | null {
  const candidates = locs.filter(isConvertible);
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) => rank(a) - rank(b) || b.size_bytes - a.size_bytes,
  )[0];
}
