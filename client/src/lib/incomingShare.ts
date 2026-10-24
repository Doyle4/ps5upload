// "Send to PS5": what reached the app from outside, as plain data.
//
// Android: another app shares a link or a file, or a .pkg is opened with PS5Upload. The
// Android shell (ShareIntake.kt, written by scripts/release/android-postinit-patch.sh) queues
// it and the page drains the queue through window.PS5UploadShare.take(), on load and on each
// 'ps5upload-share' window event. Desktop: a .pkg opened with the app (file association)
// arrives as a path from the `opened_files_take` command. Nothing here installs anything: the
// sheet (components/IncomingShareSheet) shows the item and asks first.

import { isInstallPackagePath } from "./pkgDropDedupe";
import { isArchiveFirstVolume } from "../state/rarPackages";

/** Largest file copied into the app when it can only be read as a stream (Drive, Telegram…).
 *  A bigger one has to be downloaded to the phone first. */
export const SHARE_COPY_LIMIT = 2 * 1024 ** 3;

export type IncomingItem =
  /** A link shared as text. */
  | { kind: "url"; url: string }
  /** Text with no link in it. */
  | { kind: "text"; text: string }
  /** A file this device can read where it is (or a copy the app made of a stream). */
  | { kind: "path"; path: string; name: string; size: number | null; copied?: boolean }
  /** A file Android lets the app read only as a stream; `token` asks the shell for a copy. */
  | { kind: "stream"; token: string; name: string; size: number | null };

export type ShareEvent =
  | { type: "item"; item: IncomingItem }
  | { type: "copied"; token: string; path: string; name: string; size: number | null }
  | { type: "copy_error"; token: string; code: CopyError };

export type CopyError = "too_large" | "no_space" | "copy_failed" | "cancelled";

/** What the app does with an item once the user says yes. */
export type ShareTarget = "link" | "package" | "archive" | "no_link" | "unsupported";

/** The first http(s) address in shared text ("Look at this: https://… (mirror)"), without
 *  the punctuation a sentence puts after it. */
export function extractLink(text: string): string | null {
  const m = /https?:\/\/[^\s<>"'`]+/i.exec(text);
  if (!m) return null;
  let url = m[0];
  // A closing bracket belongs to the address only when it opens one too (Wikipedia-style).
  for (;;) {
    const last = url.slice(-1);
    if (/[.,;:!?'"]/.test(last)) url = url.slice(0, -1);
    else if (last === ")" && !url.includes("(")) url = url.slice(0, -1);
    else if (last === "]" && !url.includes("[")) url = url.slice(0, -1);
    else break;
  }
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function size(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** One entry of the Android shell's queue, or null for anything malformed. */
export function parseShareEvent(raw: unknown): ShareEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const value = str(r.value);
  switch (r.kind) {
    case "text": {
      const url = extractLink(value);
      return { type: "item", item: url ? { kind: "url", url } : { kind: "text", text: value } };
    }
    case "path":
      if (!value) return null;
      return {
        type: "item",
        item: { kind: "path", path: value, name: str(r.name) || baseName(value), size: size(r.size) },
      };
    case "stream":
      if (!value) return null;
      return {
        type: "item",
        item: { kind: "stream", token: value, name: str(r.name) || "file", size: size(r.size) },
      };
    case "copied":
      if (!value || !str(r.token)) return null;
      return {
        type: "copied",
        token: str(r.token),
        path: value,
        name: str(r.name) || baseName(value),
        size: size(r.size),
      };
    case "error": {
      if (!str(r.token)) return null;
      const code: CopyError = (["too_large", "no_space", "cancelled"] as const).includes(
        value as never,
      )
        ? (value as CopyError)
        : "copy_failed";
      return { type: "copy_error", token: str(r.token), code };
    }
    default:
      return null;
  }
}

/** The shell's queue as it comes from take(): a JSON array, or "" when empty. */
export function parseShareQueue(json: string): ShareEvent[] {
  if (!json) return [];
  let list: unknown;
  try {
    list = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.map(parseShareEvent).filter((e): e is ShareEvent => e !== null);
}

/** Paths a desktop "Open with" handed over, as items. */
export function pathItems(paths: unknown): IncomingItem[] {
  if (!Array.isArray(paths)) return [];
  return paths
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .map((p) => ({ kind: "path", path: p, name: baseName(p), size: null }));
}

/** Decided by the file's name: the same packages and archives the Install screen takes. A
 *  RAR set needs all its parts side by side, so only a file that is already on the device
 *  can start one; a stream is copied alone. */
export function shareTarget(item: IncomingItem): ShareTarget {
  switch (item.kind) {
    case "url":
      return "link";
    case "text":
      return "no_link";
    case "path": {
      const name = baseName(item.path);
      if (isInstallPackagePath(name)) return "package";
      if (isArchiveFirstVolume(name)) return "archive";
      return "unsupported";
    }
    case "stream": {
      if (isInstallPackagePath(item.name)) return "package";
      const lower = item.name.toLowerCase();
      if (lower.endsWith(".zip") || lower.endsWith(".7z")) return "archive";
      if (lower.endsWith(".rar") && isArchiveFirstVolume(item.name) && !/\.part\d+\.rar$/.test(lower))
        return "archive";
      return "unsupported";
    }
  }
}

/** Whether a stream may be copied into the app. An unknown size is tried: the copy stops
 *  at the limit. */
export function copyDecision(
  bytes: number | null,
  limit: number = SHARE_COPY_LIMIT,
): "copy" | "too_large" {
  return bytes !== null && bytes > limit ? "too_large" : "copy";
}
