import type { ConsoleFilter } from "../../lib/collectionView";

/**
 * Games' views, by `?tab=`:
 * - `any` (none, or anything unknown): the grid, every game once.
 * - `dumps`: Dumps, installed games dumped to a drive.
 * (`all` was the copies tab, `ready` the installed games and `files` the PS5's drives: the grid
 * holds all of them now, and each game's page their actions, so links to them land there.)
 */
export type GamesTab = "any" | "dumps";

/** The view a `?tab=` value names; anything unknown (or none) is the grid. */
export function gamesTabOf(param: string | null): GamesTab {
  return param === "dumps" ? param : "any";
}

/** The grid filter an old link to a view the grid replaced asks for: the installed games
 *  (`?tab=ready`), the ones never seen played (`unplayed=1`, Clean up's "Not played"), or the
 *  ones on the PS5's drives (`?tab=files`). Null for any other link. */
export function legacyConsoleFilter(params: URLSearchParams): ConsoleFilter | null {
  if (params.get("unplayed") === "1") return "unplayed";
  const tab = params.get("tab");
  if (tab === "ready") return "installed";
  if (tab === "files") return "drives";
  return null;
}
