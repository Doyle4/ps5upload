/**
 * Drag files and folders from Files onto this computer's desktop or file manager.
 *
 * The OS drag can only carry files that exist here, so the first drag of an
 * item downloads it (a folder with everything in it) into a staging folder
 * (commands/dragout.rs) and, if the mouse button is still held when the
 * downloads finish, starts the OS drag with those copies. If the button was
 * released first, the copies are kept and a notice says to drag again: the
 * second drag is immediate. Desktop only.
 */
import { invoke, Channel } from "@tauri-apps/api/core";

import { jobCancel, jobStatus, startTransferDownload } from "../api/ps5";
import { pollFsDownload } from "../state/fsDownloadPoll";
import { pushNotification } from "../state/notifications";
import { log } from "../state/logs";
import type { Translator } from "../state/lang";
import { isTauriEnv } from "./tauriEnv";
import { isAndroid, isIOS } from "./platform";

/** One drag stages at most this much; the right-click Download is for more. */
export const DRAG_OUT_MAX_BYTES = 4 * 1024 * 1024 * 1024;

/** The app icon, shown under the cursor while dragging. */
const DRAG_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAADeElEQVR42s1XXUsUURh+ztkZ3dU1W/zC9asolcCIbryLgi7LCgy8KOwu6B/0I4KugqArL4OEjCKyC6ErQxLCQF0DoxU/tnV1cd1dd3bm9J5xRmZH92NWKV8YzuzsOed53u9zFFQghmEwVCGcc1FuTtGNhRA+cwJjOo4h5fZhRbRlxN44SQvQHlzycVuFucC5DUzvd4j1I3rto0eVi0tZzK24NVejJ0JWGKN937kxCghILSU7y2Sv6RnGyco4PSPSFTaWm4DJjAi8scA1639+TGDDsoi04jgRuO+0ArMDxWImzT5hgavwYG+U94+5J2Hdle6wMQu0s3yOSn1Nm0A3hDmZOYiUyjgHxn6gulKkz/m9dG0Qch18nOHVosBEdB8hX5wFd2LYmIodEFaqqZWnGMPv1SSi8RyefmlBqFVgqJNBYWXTRXViKkXcWVbmIjGsbWzhw7cUaraC4P5abGQZ2gPSNVLDsiFzpKlL+t4Q+2sjy3HEt1MYvBrGwuwsgvFfuB7MmeB5im3OKq++3lLM4p7Jamg8UwNNM5BIbGN3YwOxZNrMN4XSW3ipltUkdk7LI5POyroKf/85+NJxcFXBjlZFua6GgK7ryOY0GLoB8SeBzjaV/K7Cp+seqnUVBLjl3OnvUUhDJ1NZdCg7CPX0YufnEoJ+w1PD8ETADsCv81v4NDWLgJLDWQK8eO02Pk4u4GZ43cxiIYQnCyiV9/V91WZWGOp6BxHZbMCzySTeTkzj3kAKo8MjVTUK7okAya0rlGv+MF6+j4HFl/DicRPGno+iM9xias+pAHixAnNWJZJ5+tZvdTDubu4F+Wjs0YxaE0zTdCiKTx5AynVFOWGR1lwqVgmP1FxWtdnlDLZSOur8PmQ1hu5QHkE1jYZgELlcDsH6wAHj1dgmwq1NVcVAUduNT60gnhKor2VEQKArsIpQTQLR9W3sEYGOtmaks3tI7WbQ3dGGJw+HTOuwwzVZlCJwaLZcLzPgwY0mtDTW4vPMGgI1HCprRjKxh9aQjvNd7dSWDeymM9DyOi70dFRcipmrv8/RMOCOgRMSe88fZJXLBVlgH51ln3FMPnT4ENY5QFrEHs3KSNqbv83ROPh+BIEDDBuTu0DGisWC9CWzqqFMNXuU4qPoN3+bIz/4fpTvHRg4PYfSU3Es/+8Xk1NxNTsVl9N/fT3/C/bj8sGHN4+TAAAAAElFTkSuQmCC";

/** Whether this build can drag files out of the window at all. */
export function dragOutAvailable(): boolean {
  return isTauriEnv() && !isAndroid() && !isIOS();
}

/** One row being dragged out. A folder's size is not known until its download starts. */
export interface DragOutItem {
  remotePath: string;
  kind: "file" | "dir";
  /** A file's size; 0 for a folder. */
  size: number;
  /** Seconds since the epoch, when the listing has it: a changed item is fetched again. */
  mtime?: number;
}

type Staged = { local: string } | { promise: Promise<string | null> };
const staged = new Map<string, Staged>();
/** Every local copy made for a drag, so one dropped back on this window is not uploaded again. */
const stagedLocals = new Set<string>();

/** Is `path` a copy this app made for a drag out (dropped back onto the window)? */
export function isDragOutCopy(path: string): boolean {
  return stagedLocals.has(path) || /[\\/]dragout[\\/][^\\/]+_[0-9a-f]{8}[\\/]/.test(path);
}

/** Is the primary mouse button down right now? Tracked so a finished download
 *  knows whether the user is still holding the drag. */
let mouseHeld = false;
if (typeof window !== "undefined") {
  window.addEventListener("mousedown", (e) => { if (e.button === 0) mouseHeld = true; }, true);
  window.addEventListener("mouseup", () => { mouseHeld = false; }, true);
  window.addEventListener("blur", () => { mouseHeld = false; });
}

function stageKey(addr: string, item: DragOutItem): string {
  return `${addr}|${item.kind}|${item.remotePath}|${item.mtime ?? ""}|${item.size}`;
}

const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** Start the OS drag with local files and folders. Resolves when the drop finishes or is cancelled. */
async function startOsDrag(locals: string[]): Promise<void> {
  await invoke("plugin:drag|start_drag", {
    item: locals,
    image: DRAG_IMAGE,
    onEvent: new Channel<unknown>(),
  });
}

class TooBig extends Error {}

/** What a drag has fetched so far, across its items, against DRAG_OUT_MAX_BYTES. */
interface Budget {
  used: number;
}

/** Download one item into the staging folder; resolves to the local path. A folder that turns
 *  out to be over the drag's budget is cancelled (TooBig). */
async function stage(
  addr: string,
  item: DragOutItem,
  unsafeRead: boolean,
  budget: Budget,
): Promise<string> {
  const dir = item.remotePath.slice(0, item.remotePath.lastIndexOf("/")) || "/";
  // Per console, folder and version, so the copy keeps its own name and a changed item is
  // fetched into a folder of its own.
  const destDir = await invoke<string>("dragout_stage_dir", {
    key: `${addr}|${dir}|${item.mtime ?? ""}|${item.size}`,
  });
  const jobId = await startTransferDownload(
    item.remotePath,
    destDir,
    addr,
    item.kind === "dir" ? "folder" : "file",
    unsafeRead,
  );
  const before = budget.used;
  let failed: string | null = null;
  let over = false;
  await pollFsDownload(
    jobId,
    {
      isLive: () => !over,
      onProgress: ({ totalBytes }) => {
        if (item.kind === "dir" && before + totalBytes > DRAG_OUT_MAX_BYTES) {
          over = true;
          void jobCancel(jobId).catch(() => {});
        }
      },
      onLostContact: () => {},
      onDone: () => {},
      onFailed: (e) => { failed = e; },
    },
    { jobStatus: (id) => jobStatus(id) },
  );
  if (over) throw new TooBig(baseName(item.remotePath));
  if (failed) throw new Error(failed);
  const sep = destDir.includes("\\") ? "\\" : "/";
  const local = destDir + sep + baseName(item.remotePath);
  budget.used += item.size;
  return local;
}

/**
 * Called from a row's dragstart (after preventDefault) with the dragged rows: the row, or the
 * whole selection when the row is selected. Never throws: every outcome is told through a
 * notification.
 */
export function dragOut(
  input: { addr: string; items: DragOutItem[]; unsafeRead: boolean },
  tr: Translator,
): void {
  if (!dragOutAvailable() || input.items.length === 0) return;
  const { addr, items, unsafeRead } = input;
  const label =
    items.length === 1
      ? baseName(items[0].remotePath)
      : tr("fs_dragout_n_items", { n: items.length }, `${items.length} items`);
  const fileBytes = items.reduce((n, i) => n + (i.kind === "file" ? i.size : 0), 0);
  if (fileBytes > DRAG_OUT_MAX_BYTES) {
    pushNotification(
      "info",
      tr("fs_dragout_too_big", { name: label }, `"${label}" is too large to drag out`),
      { body: tr("fs_dragout_over_cap", undefined, "One drag fetches up to 4 GB. For more, right-click → Download.") },
    );
    return;
  }
  const keys = items.map((i) => stageKey(addr, i));
  const have = keys.map((k) => staged.get(k));
  if (have.every((h) => h && "local" in h)) {
    const locals = have.map((h) => (h as { local: string }).local);
    void startOsDrag(locals).catch((e) => {
      for (const k of keys) staged.delete(k);
      log.warn("files", `drag out of ${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    });
    return;
  }
  if (have.some((h) => h && "promise" in h)) return; // already being fetched for a previous drag
  pushNotification(
    "info",
    tr("fs_dragout_preparing", { name: label }, `Fetching "${label}" for the drag…`),
    { body: tr("fs_dragout_preparing_body", undefined, "Keep holding the mouse button, or drag it again once it is ready.") },
  );
  const budget: Budget = { used: 0 };
  // One at a time, so a folder's size is known before the next item starts.
  const run = (async () => {
    const locals: string[] = [];
    for (const [n, item] of items.entries()) {
      const prior = staged.get(keys[n]);
      const local =
        prior && "local" in prior ? prior.local : await stage(addr, item, unsafeRead, budget);
      staged.set(keys[n], { local });
      stagedLocals.add(local);
      locals.push(local);
    }
    return locals;
  })();
  const promise = run
    .then(async (locals) => {
      if (mouseHeld) {
        await startOsDrag(locals);
      } else {
        pushNotification(
          "success",
          tr("fs_dragout_ready", { name: label }, `"${label}" is ready — drag it again`),
        );
      }
      return locals[0] ?? null;
    })
    .catch((e) => {
      for (const k of keys) if (!(staged.get(k) && "local" in staged.get(k)!)) staged.delete(k);
      if (e instanceof TooBig) {
        pushNotification(
          "info",
          tr("fs_dragout_too_big", { name: e.message }, `"${e.message}" is too large to drag out`),
          { body: tr("fs_dragout_over_cap", undefined, "One drag fetches up to 4 GB. For more, right-click → Download.") },
        );
        return null;
      }
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("files", `drag out of ${label} failed: ${msg}`);
      pushNotification(
        "error",
        tr("fs_dragout_failed", { name: label }, `Couldn't fetch "${label}" for the drag`),
        { body: msg },
      );
      return null;
    });
  for (const k of keys) if (!staged.has(k)) staged.set(k, { promise });
}
