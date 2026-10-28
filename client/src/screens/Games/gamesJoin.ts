import type { CollectionGame } from "../../api/collection";
import type { InstalledTitle, LibraryEntry } from "../../api/ps5";
import type { RegisteredTitle } from "../../state/library";

/** One game in Games' All list: every place it is, joined by title ID. */
export interface AllGamesRow {
  /** The title ID (upper case), or "" for a copy no title ID could be read from. */
  titleId: string;
  title: string;
  /** Registered on the connected console (installed, or a folder or image added to Home). */
  installed: boolean;
  /** The installed title's source on the console (a folder or image), for its icon. */
  consolePath: string | null;
  /** Folders and images of it found on the console's drives. */
  storage: LibraryEntry[];
  /** Its entry in the Collection (copies on this computer's drives and shares). */
  computer: CollectionGame | null;
}

const idOf = (s: string | null | undefined): string => (s ?? "").trim().toUpperCase();

/**
 * Every game the app knows, once each, by title ID: what the connected console has registered
 * (system titles left out), the folders and images on its drives (an image's title from what
 * the console registered from it), and the Collection. A copy whose title ID is unknown (an
 * image never registered) stays its own row, so nothing on the drives goes missing.
 *
 * Installed games come first, then by title; a game the console names wins over the
 * Collection's name for it, which wins over a file name.
 */
export function joinAllGames(input: {
  installed: readonly InstalledTitle[] | null;
  storage: readonly LibraryEntry[] | null;
  registeredBySource: ReadonlyMap<string, RegisteredTitle>;
  collection: readonly CollectionGame[];
}): AllGamesRow[] {
  const rows = new Map<string, AllGamesRow>();
  const loose: AllGamesRow[] = [];
  const row = (id: string, title: string): AllGamesRow => {
    let r = rows.get(id);
    if (!r) {
      r = { titleId: id, title, installed: false, consolePath: null, storage: [], computer: null };
      rows.set(id, r);
    }
    if (!r.title && title) r.title = title;
    return r;
  };

  for (const t of input.installed ?? []) {
    const id = idOf(t.titleId);
    if (!id || t.system) continue;
    const r = row(id, t.titleName);
    if (t.titleName) r.title = t.titleName;
    r.installed = true;
    if (t.source) r.consolePath = t.source;
  }
  for (const g of input.collection) {
    const id = idOf(g.game_id);
    if (!id) continue;
    row(id, g.title).computer = g;
  }
  for (const e of input.storage ?? []) {
    const id = idOf(e.titleId) || idOf(input.registeredBySource.get(e.path)?.titleId);
    if (!id) {
      loose.push({ titleId: "", title: e.name, installed: false, consolePath: null, storage: [e], computer: null });
      continue;
    }
    const registered = input.registeredBySource.get(e.path)?.titleName ?? "";
    row(id, registered || e.name).storage.push(e);
  }

  const byTitle = (a: AllGamesRow, b: AllGamesRow) =>
    (a.title || a.titleId).localeCompare(b.title || b.titleId, undefined, { sensitivity: "base" });
  return [
    ...[...rows.values()].sort((a, b) => Number(b.installed) - Number(a.installed) || byTitle(a, b)),
    ...loose.sort(byTitle),
  ];
}

/** Whether `row` matches a search: its title, title ID or a file name, ignoring case. */
export function rowMatches(row: AllGamesRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    row.title.toLowerCase().includes(q) ||
    row.titleId.toLowerCase().includes(q) ||
    row.storage.some((e) => e.name.toLowerCase().includes(q))
  );
}
