// "Convert first": hand games to the Workshop before they go to the PS5 (make a package, an
// image or a folder of them). The Workshop (screens/FpkgConvert) reads router state: `source`
// for one game (it becomes the game checked there), `sources` for several (they go into its
// queue).

/** What can be converted: a game folder, any folder, or a game image. Packages are already
 *  what a PS5 installs; plain files and archives are not games the Workshop makes from. */
export const CONVERTIBLE_KINDS: readonly string[] = ["game-folder", "folder", "image"];

export interface ConvertCandidate {
  path: string;
  isDir: boolean;
  kind: string | null | undefined;
}

export type WorkshopHandOver =
  | { source: string }
  | { sources: { path: string; isDir: boolean }[] };

/** The Workshop's router state for the convertible ones among `items`, or null when none is. */
export function convertFirstState(items: ConvertCandidate[]): WorkshopHandOver | null {
  const ok = items.filter((i) => !!i.kind && CONVERTIBLE_KINDS.includes(i.kind));
  if (ok.length === 0) return null;
  if (ok.length === 1) return { source: ok[0].path };
  return { sources: ok.map((i) => ({ path: i.path, isDir: i.isDir })) };
}
