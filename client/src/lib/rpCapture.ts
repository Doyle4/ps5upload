// Remote Play screenshots and clips: names, the recording format, and where the file goes.
//
// The picture is the stream's own canvas (its pixel size is the stream's, whatever size it is
// shown at), and a clip is that canvas's captureStream() plus a tap on the game's sound
// (RemotePlayStream.captureMedia) through MediaRecorder. Saving: a download in a browser; in the
// app, straight into Downloads (Documents on iPhone) with no dialog, so a screenshot taken
// mid-game never stops the game for a question.

import { isTauriEnv } from "./tauriEnv";

/** Characters no file system takes in a name, and control characters. */
// eslint-disable-next-line no-control-regex
const BAD_NAME_CHARS = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;

/** `PS5 <console> 2026-10-30 21-14-05.<ext>` in local time. */
export function captureFileName(consoleName: string, d: Date, ext: string): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const when =
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  const name = consoleName.replace(BAD_NAME_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim();
  // Windows refuses a name ending in a dot or a space; the date always ends it here.
  return `${name ? `PS5 ${name}` : "PS5"} ${when}.${ext.replace(/^\./, "")}`;
}

/** MediaRecorder formats, best first: MP4 (H.264 + AAC) plays everywhere a clip is shared;
 *  WebM is what Chromium on Linux and older Chromium record. */
const RECORDER_TYPES: Array<{ mime: string; ext: string }> = [
  { mime: "video/mp4;codecs=avc1,mp4a.40.2", ext: "mp4" },
  { mime: "video/mp4;codecs=avc1", ext: "mp4" },
  { mime: "video/mp4", ext: "mp4" },
  { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
  { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
  { mime: "video/webm", ext: "webm" },
];

/** The first recording format this device records, or null (`supported` is
 *  MediaRecorder.isTypeSupported). */
export function recorderType(supported: (mime: string) => boolean): { mime: string; ext: string } | null {
  for (const t of RECORDER_TYPES) {
    try {
      if (supported(t.mime)) return t;
    } catch {
      // A check that throws is not a yes.
    }
  }
  return null;
}

/** True when this device can record a clip of a canvas. */
export function canRecordClips(): boolean {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement === "undefined") return false;
  if (typeof (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream !== "function") return false;
  return recorderType((m) => MediaRecorder.isTypeSupported(m)) !== null;
}

/** How long a clip runs before it is stopped and saved on its own: it is held in memory until
 *  then (about 60 MB a minute). */
export const MAX_CLIP_MS = 10 * 60_000;

/** `m:ss` (or `h:mm:ss`) for a recording's running time. */
export function clipClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Save a screenshot or clip. Returns where it went in the app (a path), or null for a
 *  browser download (the browser says where). Throws when it could not be saved. */
export async function saveCapture(blob: Blob, name: string): Promise<string | null> {
  if (!isTauriEnv()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Not at once: a large clip may still be being read by the download.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return null;
  }
  const { downloadsDest } = await import("./pickSaveDest");
  const { invoke } = await import("@tauri-apps/api/core");
  const dest = await downloadsDest(name);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return invoke<string>("save_binary_file", bytes, {
    headers: { "x-path": encodeURIComponent(dest), "x-name": encodeURIComponent(name) },
  });
}
