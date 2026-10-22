// How much the upload queue still has to write to the console, for the size chip in the queue
// header. Sizes come from the inspection the Upload screen already ran when the item was added.
//
// The upload chip is deliberately NOT a free-space check: the engine's up-front check (the AVA1 `fs.freespace`
// reservation, resume-aware and job-wide) is the authority, and a second estimate here would
// disagree with it, e.g. by counting a resumed item in full.

import { volumeAllocatableBytes, type Volume } from "../api/ps5";
import type { QueueItem } from "../state/uploadQueue";
import { resolvePkgStorage } from "./pkgStorage";

/** Best-known size of a queue item in bytes. Prefers the size captured at
 *  queue-add time (pkg header, folder walk or archive central directory);
 *  falls back to the engine's pre-stat, which only lands once the item
 *  starts running. Plain files, multi-part archive sets and installs
 *  nobody could size have no size until then — they count as 0, which makes the
 *  check conservative (it can only ever UNDER-report). */
export function queueItemBytes(it: QueueItem): number {
  if (it.sourceKind === "install") {
    // The package's size from the caller (library entry, listing, link probe) or from reading
    // the source; else the install's own total once it runs.
    return it.estimatedBytes || it.installProgress?.total || 0;
  }
  return it.estimatedBytes || it.totalBytes || 0;
}

/** Bytes this item still needs on the console: everything for a waiting
 *  item, the un-transferred remainder for the one running. Done and
 *  failed rows need nothing. */
export function queueItemRemainingBytes(it: QueueItem): number {
  if (it.status === "done" || it.status === "failed") return 0;
  const total = queueItemBytes(it);
  if (it.status === "running") return Math.max(0, total - (it.bytesSent || 0));
  return total;
}

/** Total bytes the queue still has to write. */
export function queueRemainingBytes(items: readonly QueueItem[]): number {
  return items.reduce((n, it) => n + queueItemRemainingBytes(it), 0);
}

/** What the waiting and running installs still need on the console. Informational: the
 *  per-install checks stay the authority, and nothing here blocks or adds a reserve. */
export interface InstallNeeds {
  /** Installs waiting or running. */
  count: number;
  /** Bytes the sized ones still need. */
  bytes: number;
  /** How many have no size, so `bytes` is a floor, not the whole. */
  unknown: number;
}

export function queueInstallNeeds(items: readonly QueueItem[]): InstallNeeds {
  let count = 0;
  let bytes = 0;
  let unknown = 0;
  for (const it of items) {
    if (it.sourceKind !== "install") continue;
    if (it.status !== "pending" && it.status !== "running") continue;
    count++;
    const total = queueItemBytes(it);
    if (total <= 0) {
      unknown++;
      continue;
    }
    // A running install has written some of it already (the PS5 writes a stream or link
    // install as it arrives): the drive's free space counts that. A USB stage copy does not land
    // on the install drive's tally the same way, so it is not subtracted.
    const phase = it.installProgress?.phase;
    const written =
      it.status === "running" && (phase === "install" || phase === "transfer")
        ? Math.min(total, it.installProgress?.current ?? 0)
        : 0;
    bytes += Math.max(0, total - written);
  }
  return { count, bytes, unknown };
}

/** Free space on the drive the console's installs go to. `drive` null = internal storage. */
export interface InstallTargetSpace {
  freeBytes: number;
  drive: string | null;
}

/** The free space on the install target among `volumes`: the console's package drive when it
 *  is there, else internal storage. Null when the drive list is unknown or names no such
 *  drive, so nothing is claimed. */
export function installTargetSpace(
  volumes: readonly Volume[] | null,
  chosen: string | null,
): InstallTargetSpace | null {
  if (!volumes || volumes.length === 0) return null;
  const target = resolvePkgStorage(chosen, volumes as Volume[]);
  const real = volumes.filter((v) => !v.is_placeholder);
  const trim = (p: string) => p.replace(/\/+$/, "") || "/";
  const vol = target.volume
    ? real.find((v) => trim(v.path) === target.volume)
    : (real.find((v) => v.path === "/user") ?? real.find((v) => v.path === "/data"));
  if (!vol) return null;
  return { freeBytes: volumeAllocatableBytes(vol), drive: target.volume };
}

/** The header line: what the installs need against what the drive has. `shortBy` is set only
 *  when every install has a size and they need more than is free; an unknown size or unknown
 *  free space never produces a claim. */
export interface InstallSpaceLine {
  need: number;
  unknown: number;
  free: InstallTargetSpace | null;
  shortBy: number | null;
}

export function installSpaceLine(
  needs: InstallNeeds,
  free: InstallTargetSpace | null,
): InstallSpaceLine | null {
  if (needs.count === 0) return null;
  const shortBy =
    free && needs.unknown === 0 && needs.bytes > free.freeBytes
      ? needs.bytes - free.freeBytes
      : null;
  return { need: needs.bytes, unknown: needs.unknown, free, shortBy };
}
