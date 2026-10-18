/**
 * Files' writes that go past the JSON routes: saving a text file
 * (/api/fs/save-text, up to 1 MiB, atomic on the helper, refused when the
 * file changed since it was read) and making a new, empty one.
 */
import { ApiError, call, callRaw } from "../api";

/** The most the editor saves (the helper's cap too). */
export const TEXT_SAVE_MAX = 1024 * 1024;

/** A file as the editor read it: a save is refused when it is not like this any more. */
export interface FileStamp {
  mtime: number;
  size: number;
  /** The mtime's nanoseconds (a helper that sends them): a same-second change is caught too. */
  mtime_ns?: number;
}

/** The bytes a save writes: the editor's text (a file that used CRLF keeps CRLF), or why it cannot be saved. */
export function encodeText(text: string, crlf: boolean): Uint8Array | "binary" | "too_large" {
  if (text.includes("\u0000")) return "binary";
  const out = new TextEncoder().encode(crlf ? text.replace(/\r?\n/g, "\r\n") : text);
  return out.length > TEXT_SAVE_MAX ? "too_large" : out;
}

/** Text the editor can open: valid UTF-8 without a NUL byte (a BOM is kept as it is). Else null. */
export function decodeEditable(buf: ArrayBuffer): string | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    return null;
  }
  return text.includes("\u0000") ? null : text;
}

/** The save request: one line of JSON, a newline, then the bytes. */
export function saveBody(head: object, bytes: Uint8Array): Blob {
  return new Blob([`${JSON.stringify(head)}\n`, bytes as BlobPart]);
}

/** Save `bytes` as `path` if it is still as `stamp` says; the new stamp. 409 "changed" when it is not. */
export async function saveText(path: string, bytes: Uint8Array, stamp: FileStamp): Promise<FileStamp> {
  const head: Record<string, unknown> = { path, mtime: stamp.mtime, size: stamp.size };
  if (typeof stamp.mtime_ns === "number") head.mtime_ns = stamp.mtime_ns;
  const r = await callRaw<FileStamp>("/api/fs/save-text", saveBody(head, bytes));
  if (!r || typeof r.mtime !== "number" || typeof r.size !== "number") throw new ApiError(500, "bad_reply");
  return r;
}

/** A new, empty file (409 "exists" when anything has that name). */
export async function createFile(path: string): Promise<void> {
  await callRaw("/api/fs/save-text", saveBody({ path, create: true }, new Uint8Array(0)));
}

/** The file as it is now. */
export async function stampOf(path: string): Promise<FileStamp> {
  const s = await call<{ mtime?: number; size?: number; mtime_ns?: number }>("/api/fs/stat", { path });
  const out: FileStamp = { mtime: Number(s?.mtime ?? 0), size: Number(s?.size ?? 0) };
  if (typeof s?.mtime_ns === "number") out.mtime_ns = s.mtime_ns;
  return out;
}
