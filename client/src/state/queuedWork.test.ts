import { describe, expect, it } from "vitest";

import { queuedWork, stillWaiting } from "./queuedWork";

describe("queuedWork", () => {
  it("lists only work that has not started, console queue first, with kind, console and size", () => {
    const rows = queuedWork(
      [
        { id: "a", status: "running", sourceKind: "file", displayName: "Now.exfat", addr: "10.0.0.2" },
        { id: "b", status: "pending", sourceKind: "install", displayName: "Game.pkg", addr: "10.0.0.2:9113", estimatedBytes: 5000 },
        { id: "c", status: "pending", sourceKind: "game-folder", displayName: "PPSA01", addr: "10.0.0.3", totalBytes: 0 },
        { id: "d", status: "done", sourceKind: "archive", displayName: "x.7z", addr: "10.0.0.2" },
      ],
      [
        { id: "k1", status: "pending", source: "/games/Astro/", host: "10.0.0.2", build: { kind: "image", compress: true } },
        { id: "k2", status: "running", source: "/games/B", host: null },
        { id: "k3", status: "pending", source: "C:\\games\\Bloodborne", host: null },
      ],
    );
    expect(rows.map((r) => [r.id, r.kind, r.label, r.consoleId, r.route, r.sizeBytes])).toEqual([
      ["b", "pkg-install", "Game.pkg", "10.0.0.2", "/send", 5000],
      ["c", "upload-dir", "PPSA01", "10.0.0.3", "/send", null],
      ["k1", "ffpfsc-compress", "Astro", "10.0.0.2", "/workshop", null],
      ["k3", "fpkg-convert", "Bloodborne", "", "/workshop", null],
    ]);
  });
});

describe("stillWaiting", () => {
  it("is true only while the row's item is still pending in its own queue", () => {
    const up = { id: "u1", owner: "upload-queue" as const };
    const cv = { id: "c1", owner: "convert-queue" as const };
    expect(stillWaiting(up, [{ id: "u1", status: "pending" }], [])).toBe(true);
    // Started between the render and the click: leave it alone.
    expect(stillWaiting(up, [{ id: "u1", status: "running" }], [])).toBe(false);
    expect(stillWaiting(up, [], [{ id: "u1", status: "pending" }])).toBe(false);
    expect(stillWaiting(cv, [], [{ id: "c1", status: "pending" }])).toBe(true);
    expect(stillWaiting(cv, [], [{ id: "c1", status: "running" }])).toBe(false);
    expect(stillWaiting(cv, [], [])).toBe(false);
  });
});
