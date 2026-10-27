/** The views Files opens over its listing: the all-drives search, the "what takes
 *  space?" map and the console snapshots. Each is a `?view=` value, so a link (and
 *  the old /search, /disk-usage and /backup routes) can open one:
 *
 *    /files?view=search[&q=<pattern>][&title=<TITLE_ID>]
 *    /files?view=space[&path=<folder>]
 *    /files?view=snapshots
 *
 *  (`path` is Files' own deep link: it also moves the listing to that folder.)
 */
export type FilesView = "search" | "space" | "snapshots";

const VIEWS: readonly FilesView[] = ["search", "space", "snapshots"];

export function parseFilesView(v: string | null): FilesView | null {
  return VIEWS.includes(v as FilesView) ? (v as FilesView) : null;
}

/** A link that opens Files on `view`. `q` and `title` go with search; `path` is the
 *  folder the space map starts at (and the folder Files shows). */
export function filesViewLink(
  view: FilesView,
  opts: { q?: string; title?: string; path?: string } = {},
): string {
  const p = new URLSearchParams({ view });
  if (opts.q) p.set("q", opts.q);
  if (opts.title) p.set("title", opts.title);
  if (opts.path) p.set("path", opts.path);
  return `/files?${p.toString()}`;
}
