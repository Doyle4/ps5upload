// The bytes a package takes with its split parts, from a listing of the folder it is in. Two
// layouts exist: `Game.pkg` + `Game.pkg.0`, `Game.pkg.1`… (the engine's split-set parser) and
// `Game_0.pkg`, `Game_1.pkg`… (sets named by part). A lone package is its own size.

const SUFFIX_PART = /^(.*\.pkg)\.(\d+)$/i;
const NAMED_PART = /^(.*)_(\d+)\.pkg$/i;

export interface ListedFile {
  name: string;
  size: number;
}

/** `name`'s bytes plus its parts among `siblings` (same folder, names only, no paths). Only the
 *  lead of a set carries the parts: `Game.pkg` or `Game_0.pkg`; any other part is its own size,
 *  so a set never counts twice. */
export function splitPkgBytes(name: string, size: number, siblings: readonly ListedFile[]): number {
  let total = Math.max(0, size);
  const named = NAMED_PART.exec(name);
  if (/\.pkg$/i.test(name) && !named) {
    const lower = name.toLowerCase();
    for (const s of siblings) {
      const m = SUFFIX_PART.exec(s.name);
      if (m && m[1].toLowerCase() === lower) total += Math.max(0, s.size);
    }
    return total;
  }
  if (named && Number(named[2]) === 0) {
    const stem = named[1].toLowerCase();
    for (const s of siblings) {
      const m = NAMED_PART.exec(s.name);
      if (m && m[1].toLowerCase() === stem && Number(m[2]) > 0) total += Math.max(0, s.size);
    }
  }
  return total;
}
