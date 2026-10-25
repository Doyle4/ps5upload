import { fsListDir, type FsDirEntry } from "../api/ps5";

/** What an extracted folder holds that has a next step: packages to install, or a game folder
 *  (its own `sce_sys`, or one folder holding a game) to register. */
export interface ExtractedNext {
  packages: number;
  game: boolean;
}

/** Judge a listing: packages at the top, or a game folder at the top or one level down (an
 *  archive often holds `Game/` rather than the game's files). */
export async function judgeExtracted(
  top: FsDirEntry[],
  list: (sub: string) => Promise<FsDirEntry[]>,
): Promise<ExtractedNext> {
  const packages = top.filter((e) => e.kind === "file" && /\.pkg$/i.test(e.name)).length;
  if (packages > 0) return { packages, game: false };
  if (top.some((e) => e.kind === "dir" && e.name === "sce_sys")) return { packages: 0, game: true };
  const dirs = top.filter((e) => e.kind === "dir");
  if (dirs.length === 1 && top.length === 1) {
    const inner = await list(dirs[0].name).catch(() => [] as FsDirEntry[]);
    return { packages: 0, game: inner.some((e) => e.kind === "dir" && e.name === "sce_sys") };
  }
  return { packages: 0, game: false };
}

/** The next step for the folder an extract wrote. Never throws: a listing that fails says
 *  nothing about what to do next. */
export async function extractedNext(addr: string, dir: string): Promise<ExtractedNext> {
  try {
    const top = await fsListDir(addr, dir);
    return await judgeExtracted(top, (sub) => fsListDir(addr, `${dir.replace(/\/+$/, "")}/${sub}`));
  } catch {
    return { packages: 0, game: false };
  }
}
