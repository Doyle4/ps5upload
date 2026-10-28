/**
 * Games' views, by `?tab=`:
 * - `any` (none, or anything unknown): All, every game once with where its copies are.
 * - `ready`: Installed, the games the PS5 has registered.
 * - `files`: On PS5 Storage, game folders and images on the console's drives.
 * - `all`: On This Computer, the Collection. (Its old id: it was "Everything", and links to
 *   `?tab=all` keep opening it.)
 */
export type GamesTab = "any" | "ready" | "files" | "all";

/** The view a `?tab=` value names; anything unknown (or none) is All. */
export function gamesTabOf(param: string | null): GamesTab {
  return param === "ready" || param === "files" || param === "all" ? param : "any";
}
