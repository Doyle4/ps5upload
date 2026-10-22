/**
 * Which files the console can extract (the helper's extractor payload) and the
 * folder it extracts into by default. Shared by the PC Files screen and the
 * console page (Minion), so both offer Extract on the same names.
 *
 * A split archive is extracted from its first volume only (`.part1.rar`,
 * `.part01.rar`, `.001`); the later volumes sit beside it and are read from
 * there, so they get no Extract action of their own. A `.ffpfsc` is not here:
 * it has its own Decompress action.
 */

const SINGLE = /\.(zip|zipx|7z|rar|tar|tgz|tbz|tbz2|txz|tzst|gz|bz2|xz|zst)$/i;
const RAR_PART = /\.part(\d+)\.rar$/i;
const SPLIT = /\.(\d{3})$/;

/** `name` is an archive (or the first volume of a split one) the console can extract. */
export function isExtractableArchive(name: string): boolean {
  const part = RAR_PART.exec(name);
  if (part) return Number(part[1]) === 1;
  const split = SPLIT.exec(name);
  if (split) return split[1] === "001";
  return SINGLE.test(name);
}

/** The extensions taken off, longest first, after a `.partN.rar` / `.001` volume suffix. */
const STRIP: RegExp[] = [
  /\.part\d+\.rar$/i,
  /\.tar\.(gz|bz2|xz|zst)$/i,
  /\.(zip|zipx|7z|rar|tar|tgz|tbz|tbz2|txz|tzst|gz|bz2|xz|zst)$/i,
];

/**
 * The folder an archive extracts into by default: its name without the
 * archive's extensions (`x.tar.gz`, `x.tgz`, `x.7z.001`, `x.part01.rar` → `x`;
 * a single compressed file `x.bin.gz` → `x.bin`). "extracted" when nothing is left.
 */
export function archiveFolderName(name: string): string {
  let n = name;
  if (SPLIT.test(n)) n = n.slice(0, -4);
  for (const re of STRIP) {
    const m = re.exec(n);
    if (m) {
      n = n.slice(0, m.index);
      break;
    }
  }
  n = n.trim();
  return n && n !== "." && n !== ".." ? n : "extracted";
}

/** One plain folder name: not empty, no "/", not "." or "..", at most 255 bytes. */
export function validFolderName(name: string): boolean {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) return false;
  return new TextEncoder().encode(name).length <= 255;
}

/** `name`, or "name (2)", "name (3)"… — the first one `taken` says is free. */
export function freeFolderName(name: string, taken: (n: string) => boolean): string {
  if (!taken(name)) return name;
  for (let i = 2; i < 10_000; i++) {
    const c = `${name} (${i})`;
    if (!taken(c)) return c;
  }
  return `${name} (${Date.now()})`;
}

/** The extract job's result ({"path","files","dirs","bytes","skipped","unsafe","links"}). */
export interface ExtractResult {
  path: string;
  files: number;
  dirs: number;
  bytes: number;
  /** Files already there (merge without replace), left as they were. */
  skipped: number;
  /** Entries refused for an unsafe path (absolute, "..", through a link). */
  unsafe: number;
  /** Links and special entries, not extracted. */
  links: number;
}

/** A job result (any shape) as an ExtractResult; missing numbers are 0. */
export function toExtractResult(r: unknown): ExtractResult {
  const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    path: typeof o.path === "string" ? o.path : "",
    files: num(o.files),
    dirs: num(o.dirs),
    bytes: num(o.bytes),
    skipped: num(o.skipped),
    unsafe: num(o.unsafe),
    links: num(o.links),
  };
}

/** The cause token of an extract failure ("fs_extract_no_space: needs …" → "fs_extract_no_space"), or null. */
export function extractCause(raw: string): string | null {
  const m = /fs_extract_[a-z_]+/i.exec(raw);
  return m ? m[0].toLowerCase() : null;
}

/** The failure asks for a (different) password: ask for one and run again. */
export function needsPassword(raw: string): boolean {
  const c = extractCause(raw);
  return c === "fs_extract_password_required" || c === "fs_extract_wrong_password";
}
