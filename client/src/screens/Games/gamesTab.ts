/**
 * Games' views, by `?tab=`:
 * - `any` (none, or anything unknown): the grid, every game once.
 * - `ready`: Installed, the games the PS5 has registered.
 * - `files`: On PS5 Storage, game folders and images on the console's drives.
 * - `dumps`: Dumps, installed games dumped to a drive.
 * (`all` was the copies tab; the grid is those copies now, so links to it land there.)
 */
export type GamesTab = "any" | "ready" | "files" | "dumps";

/** The view a `?tab=` value names; anything unknown (or none) is the grid. */
export function gamesTabOf(param: string | null): GamesTab {
  return param === "ready" || param === "files" || param === "dumps" ? param : "any";
}
