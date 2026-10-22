import { describe, expect, it } from "vitest";

import type { QueueItem } from "../state/uploadQueue";
import type { Volume } from "../api/ps5";
import {
  installSpaceLine,
  installTargetSpace,
  queueInstallNeeds,
  queueItemBytes,
  queueItemRemainingBytes,
  queueRemainingBytes,
} from "./queueSize";

/** A QueueItem with only the fields the space helpers read. */
function item(over: Partial<QueueItem>): QueueItem {
  return {
    id: over.id ?? over.sourcePath ?? "it",
    sourceKind: "file",
    sourcePath: "/src/game",
    displayName: "game",
    resolvedDest: "/data/game",
    addr: "192.168.1.2:9113",
    strategy: "overwrite",
    reconcileMode: "fast",
    excludes: [],
    mountAfterUpload: false,
    mountReadOnly: true,
    registerAfterUpload: false,
    txIdHex: "00",
    status: "pending",
    bytesSent: 0,
    totalBytes: 0,
    bytesPerSec: 0,
    filesFinalized: 0,
    filesFinalizingTotal: 0,
    mountedAt: null,
    registeredAs: null,
    mountWarnings: [],
    error: null,
    errorReason: null,
    errorDetail: null,
    addedAt: 0,
    startedAt: null,
    completedAt: null,
    ...over,
  };
}

describe("sizing a queue item", () => {
  it("prefers the size captured at add time over the pre-stat", () => {
    expect(queueItemBytes(item({ estimatedBytes: 5, totalBytes: 7 }))).toBe(5);
  });

  it("falls back to the pre-stat when the pick had no size", () => {
    expect(queueItemBytes(item({ totalBytes: 7 }))).toBe(7);
    expect(queueItemBytes(item({ estimatedBytes: 0, totalBytes: 7 }))).toBe(7);
  });

  it("counts unknown sources as zero so the chip under-reports, never over", () => {
    expect(queueItemBytes(item({}))).toBe(0);
  });

  it("sizes an install from the size it was queued with, else its live progress", () => {
    expect(
      queueItemBytes(item({ sourceKind: "install", estimatedBytes: 90 })),
    ).toBe(90);
    expect(
      queueItemBytes(item({ sourceKind: "install", install: { via: "library", path: "/data/p.pkg" } })),
    ).toBe(0);
    expect(
      queueItemBytes(
        item({
          sourceKind: "install",
          installProgress: { phase: "install", current: 20, total: 80, bytesPerSec: 0 },
        }),
      ),
    ).toBe(80);
  });

  it("needs everything while waiting, only the remainder while running, nothing when finished", () => {
    const pending = item({ estimatedBytes: 100 });
    const running = item({ estimatedBytes: 100, status: "running", bytesSent: 30 });
    const done = item({ estimatedBytes: 100, status: "done", bytesSent: 100 });
    const failed = item({ estimatedBytes: 100, status: "failed" });
    expect(queueItemRemainingBytes(pending)).toBe(100);
    expect(queueItemRemainingBytes(running)).toBe(70);
    expect(queueItemRemainingBytes(done)).toBe(0);
    expect(queueItemRemainingBytes(failed)).toBe(0);
  });

  it("clamps the running remainder at zero when bytesSent overshoots", () => {
    expect(
      queueItemRemainingBytes(item({ estimatedBytes: 10, status: "running", bytesSent: 20 })),
    ).toBe(0);
  });

  it("sums the live rows and skips finished ones", () => {
    const items = [
      item({ estimatedBytes: 100 }),
      item({ estimatedBytes: 100, status: "running", bytesSent: 30 }),
      item({ estimatedBytes: 100, status: "done", bytesSent: 100 }),
      item({ estimatedBytes: 100, status: "failed" }),
    ];
    expect(queueRemainingBytes(items)).toBe(170);
  });

  it("counts an empty queue as zero bytes", () => {
    expect(queueRemainingBytes([])).toBe(0);
  });
});

const GiB = 1024 ** 3;
const vol = (path: string, free: number, over: Partial<Volume> = {}): Volume =>
  ({
    path,
    fs_type: "exfat",
    total_bytes: 1000 * GiB,
    free_bytes: free,
    writable: true,
    ...over,
  }) as Volume;
const install = (over: Partial<QueueItem>) =>
  item({ sourceKind: "install", install: { via: "library", path: "/p.pkg" }, ...over });

describe("what the installs need against the install drive", () => {
  it("adds the waiting and running installs, counts the unsized ones, skips uploads and finished rows", () => {
    const needs = queueInstallNeeds([
      install({ id: "a", estimatedBytes: 10 * GiB }),
      install({
        id: "b",
        estimatedBytes: 20 * GiB,
        status: "running",
        installProgress: { phase: "install", current: 5 * GiB, total: 20 * GiB, bytesPerSec: 0 },
      }),
      install({ id: "c" }),
      install({
        id: "t",
        estimatedBytes: 8 * GiB,
        status: "running",
        install: { via: "stream", source: "/pc/t.pkg" },
        installProgress: { phase: "transfer", current: 3 * GiB, total: 8 * GiB, bytesPerSec: 0 },
      }),
      install({ id: "d", estimatedBytes: 99 * GiB, status: "done" }),
      item({ id: "e", estimatedBytes: 50 * GiB }),
    ]);
    expect(needs).toEqual({ count: 4, bytes: 30 * GiB, unknown: 1 });
  });

  it("reads free space from the package drive, else internal storage", () => {
    const vols = [vol("/data", 300 * GiB), vol("/user", 100 * GiB), vol("/mnt/ext0", 500 * GiB)];
    expect(installTargetSpace(vols, null)).toEqual({ freeBytes: 100 * GiB, drive: null });
    expect(installTargetSpace(vols, "/mnt/ext0")).toEqual({ freeBytes: 500 * GiB, drive: "/mnt/ext0" });
    // The chosen drive is gone: installs fall back to internal, and so does the line.
    expect(installTargetSpace(vols, "/mnt/usb0")).toEqual({ freeBytes: 100 * GiB, drive: null });
    // A reserve-aware payload's number wins over raw free space.
    expect(installTargetSpace([vol("/user", 100 * GiB, { allocatable_bytes: 60 * GiB })], null)).toEqual({
      freeBytes: 60 * GiB,
      drive: null,
    });
  });

  it("claims nothing when the drives could not be read", () => {
    expect(installTargetSpace(null, null)).toBeNull();
    expect(installTargetSpace([], null)).toBeNull();
    expect(installTargetSpace([vol("/mnt/usb0", 5, { writable: false })], null)).toBeNull();
  });

  it("all sizes known and more than is free: says how much more is needed", () => {
    const line = installSpaceLine({ count: 2, bytes: 120 * GiB, unknown: 0 }, { freeBytes: 100 * GiB, drive: null });
    expect(line).toEqual({
      need: 120 * GiB,
      unknown: 0,
      free: { freeBytes: 100 * GiB, drive: null },
      shortBy: 20 * GiB,
    });
    expect(
      installSpaceLine({ count: 2, bytes: 80 * GiB, unknown: 0 }, { freeBytes: 100 * GiB, drive: null })?.shortBy,
    ).toBeNull();
  });

  it("some sizes unknown: never says it won't fit, and says how many are unknown", () => {
    const line = installSpaceLine({ count: 3, bytes: 120 * GiB, unknown: 1 }, { freeBytes: 100 * GiB, drive: "/mnt/ext0" });
    expect(line?.shortBy).toBeNull();
    expect(line?.unknown).toBe(1);
  });

  it("no console or unreadable drives: the total alone, no claim", () => {
    const line = installSpaceLine({ count: 1, bytes: 500 * GiB, unknown: 0 }, null);
    expect(line).toEqual({ need: 500 * GiB, unknown: 0, free: null, shortBy: null });
  });

  it("no installs: no line", () => {
    expect(installSpaceLine({ count: 0, bytes: 0, unknown: 0 }, { freeBytes: 1, drive: null })).toBeNull();
  });
});
