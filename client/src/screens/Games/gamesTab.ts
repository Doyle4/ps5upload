import { consoleFilterOf, type ConsoleFilter } from "../../lib/collectionView";

/**
 * Games is one grid. Links to the views it replaced still work: `?tab=ready` (installed games),
 * `?tab=files` (the PS5's drives) and `unplayed=1` (Clean up's "Not played") open the grid with
 * the filter that shows the same games; `?tab=dumps` (dumping is on each game's page now) opens it
 * unfiltered; any other `?tab=` is left alone. `?console=<filter>` sets a grid filter by name (the old
 * `update` and `dlc` read as `addons`).
 */
export function legacyGamesLink(params: URLSearchParams): {
  /** The grid filter to set, or null to leave it. */
  filter: ConsoleFilter | null;
  /** The link carries params to put away once handled. */
  strip: boolean;
} {
  const tab = params.get("tab");
  const strip =
    tab === "ready" ||
    tab === "files" ||
    tab === "dumps" ||
    params.has("unplayed") ||
    params.has("console");
  const filter: ConsoleFilter | null =
    params.get("unplayed") === "1"
      ? "unplayed"
      : tab === "ready"
        ? "installed"
        : tab === "files"
          ? "drives"
          : consoleFilterOf(params.get("console"));
  return { filter, strip };
}
