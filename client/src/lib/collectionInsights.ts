// What the Collection can tell about a game beyond its copies: whether the selected PS5 is on
// new enough firmware for it, whether a copy could take less room, and what sending it to a
// console means. Pure, so each rule is tested without a screen.

import type {
  CollectionGame,
  CollectionLocation,
  CollectionOffer,
  GameConsoleState,
} from "../api/collection";
import { bestSendable } from "./collectionSend";
import { versionCompare } from "./packageChecks";
import { isRemotePath } from "./remotePath";

/** A full copy of the game: never an update or DLC package. */
function isFullCopy(l: CollectionLocation): boolean {
  return l.pkg?.kind !== "patch" && l.pkg?.kind !== "dlc";
}

/** The lowest firmware any full copy of a PS5 game asks for, or null when no copy says (or the
 *  game is not a PS5 game: a PS4 copy names a PS4 firmware, which says nothing about a PS5). */
export function gameMinFw(
  g: Pick<CollectionGame, "platform" | "locations">,
): string | null {
  if (g.platform.toUpperCase() !== "PS5") return null;
  const fws = g.locations
    .filter(isFullCopy)
    .map((l) => l.pkg?.min_fw)
    .filter((v): v is string => !!v && /^\d/.test(v));
  if (fws.length === 0) return null;
  return fws.sort(versionCompare)[0];
}

/** The firmware the game needs when the console's is lower, or null (it runs, or either is
 *  unknown). */
export function firmwareShortfall(
  g: Pick<CollectionGame, "platform" | "locations">,
  consoleFw: string | null,
): string | null {
  const need = gameMinFw(g);
  if (!need || !consoleFw) return null;
  return versionCompare(consoleFw, need) < 0 ? need : null;
}

/** Below this, compressing a copy is not worth a build. */
export const SHRINK_MIN_BYTES = 4 * 1024 ** 3;

/** The copy of a PS5 game that could take less room as a compressed image (.ffpfsc): a game
 *  folder or an uncompressed image on this computer, of at least 4 GiB, when the game has no
 *  compressed image already. Null otherwise. How much smaller depends on the game, so no
 *  figure is promised. */
export function shrinkCandidate(
  g: Pick<CollectionGame, "platform" | "locations">,
): CollectionLocation | null {
  if (g.platform.toUpperCase() !== "PS5") return null;
  if (g.locations.some((l) => l.type === "mount.ffpfsc")) return null;
  return (
    g.locations
      .filter(
        (l) =>
          (l.type === "folder" ||
            l.type === "mount.exfat" ||
            l.type === "mount.ffpkg") &&
          l.size_bytes >= SHRINK_MIN_BYTES &&
          !isRemotePath(l.absolute_path) &&
          !l.pkg?.error,
      )
      .sort((a, b) => b.size_bytes - a.size_bytes)[0] ?? null
  );
}

/** A base package copy as an install offer, for a console whose state could not be read. */
function offerOf(l: CollectionLocation, title: string): CollectionOffer {
  return {
    path: l.absolute_path,
    name: l.name,
    version: l.pkg?.version ?? "",
    content_id: l.pkg?.content_id ?? "",
    title: l.pkg?.title || title,
    size_bytes: l.size_bytes,
    category: "gd",
  };
}

/** What sending one game to one console comes to: packages to install (streamed), a copy to
 *  upload, or nothing, and why. */
export type SendStep =
  | { kind: "install"; offers: CollectionOffer[] }
  | { kind: "upload"; copy: CollectionLocation }
  | { kind: "skip"; why: "up-to-date" | "nothing-to-send" };

/** The plan for `g` on a console in state `st` (undefined: its state could not be read). A
 *  game the console has gets its newer update and missing DLC; one it lacks gets the base
 *  package with them, or its best folder, image or archive. The install queue refuses an
 *  install that would erase an installed game, so an unread console is still safe to send to. */
export function sendStep(
  g: CollectionGame,
  st: GameConsoleState | undefined,
): SendStep {
  if (st?.installed) {
    const offers = [...(st.update ? [st.update] : []), ...st.dlc_missing];
    return offers.length > 0
      ? { kind: "install", offers }
      : { kind: "skip", why: "up-to-date" };
  }
  if (st?.base) {
    const offers = [
      st.base,
      ...(st.update ? [st.update] : []),
      ...st.dlc_missing,
    ];
    return { kind: "install", offers };
  }
  if (!st) {
    const base = g.locations
      .filter(
        (l) =>
          l.type === "pkg" &&
          l.pkg?.kind === "base" &&
          l.pkg?.complete !== false &&
          !l.pkg?.error,
      )
      .sort((a, b) =>
        versionCompare(b.pkg?.version ?? "", a.pkg?.version ?? ""),
      )[0];
    if (base) return { kind: "install", offers: [offerOf(base, g.title)] };
  }
  const copy = bestSendable(g.locations);
  return copy
    ? { kind: "upload", copy }
    : { kind: "skip", why: "nothing-to-send" };
}
