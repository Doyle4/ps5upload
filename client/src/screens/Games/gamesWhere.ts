import type { AllGamesRow } from "./gamesJoin";
import { isRemotePath, parseRemotePath } from "../../lib/remotePath";

/**
 * Where a game is, for Games' one list: the filter (`?where=`) and the place names on each row.
 * The list is every game once; these narrow it to one kind of place instead of the separate
 * tabs that each listed the same game again.
 */
export type GamesWhere = "everywhere" | "installed" | "drives" | "yours";

export function gamesWhereOf(param: string | null): GamesWhere {
  return param === "installed" || param === "drives" || param === "yours"
    ? param
    : "everywhere";
}

/** Whether `row` has a copy in `where`. */
export function rowIsIn(row: AllGamesRow, where: GamesWhere): boolean {
  switch (where) {
    case "installed":
      return row.installed;
    case "drives":
      return row.storage.length > 0;
    case "yours":
      return row.computer !== null;
    default:
      return true;
  }
}

/** One place a game has copies: installed on the console, a console drive, this computer, or a
 *  saved server. `label` is the drive's volume ("" for internal storage) or the server's name. */
export interface GameLocation {
  kind: "installed" | "drive" | "computer" | "server";
  label: string;
  count: number;
}

/** The console volume a path is on: `/mnt/ext0/...` is "ext0", anything else ("/data", the
 *  internal drive) is "". */
export function consoleVolume(path: string): string {
  return /^\/mnt\/([^/]+)/.exec(path)?.[1] ?? "";
}

/** Every place `row` has copies, in a fixed order (installed, drives, this computer, servers),
 *  each with how many copies are there. `serverName` names a saved server by its id. */
export function gameLocations(
  row: AllGamesRow,
  serverName: (id: string) => string | undefined,
): GameLocation[] {
  const out: GameLocation[] = [];
  const add = (kind: GameLocation["kind"], label: string) => {
    const hit = out.find((l) => l.kind === kind && l.label === label);
    if (hit) hit.count += 1;
    else out.push({ kind, label, count: 1 });
  };
  if (row.installed) add("installed", "");
  for (const e of row.storage) add("drive", consoleVolume(e.path));
  for (const loc of row.computer?.locations ?? []) {
    const p = isRemotePath(loc.root) ? loc.root : loc.absolute_path || loc.root;
    const remote = isRemotePath(p) ? parseRemotePath(p) : null;
    if (remote) add("server", serverName(remote.connectionId) ?? "");
    else add("computer", "");
  }
  const rank = { installed: 0, drive: 1, computer: 2, server: 3 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}
