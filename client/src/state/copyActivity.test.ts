import { describe, expect, it } from "vitest";

import { activityFor } from "./copyActivity";
import type { QueueItem } from "./uploadQueue";

const game = "/games/Astro Bot";
const idle = { phase: "idle" } as const;

function sending(addr: string): QueueItem {
  return {
    id: addr,
    sourceKind: "folder",
    sourcePath: game,
    addr,
    status: "running",
    bytesSent: 50,
    totalBytes: 100,
    estimatedBytes: 0,
  } as unknown as QueueItem;
}

describe("activityFor", () => {
  it("is busy on the console the game is going to", () => {
    expect(activityFor(game, [sending("192.168.0.100")], idle, "192.168.0.100")).toMatchObject({
      phase: "sending",
      pct: 50,
    });
  });

  it("shows a running install by its own progress, not the queued size", () => {
    const install = (over: Record<string, unknown>) =>
      ({
        id: "i",
        sourceKind: "install",
        sourcePath: `pc:${game}.pkg`,
        install: { via: "stream", source: `${game}.pkg` },
        addr: "192.168.0.100",
        status: "running",
        bytesSent: 0,
        totalBytes: 0,
        estimatedBytes: 1000,
        ...over,
      }) as unknown as QueueItem;
    const at = (it: QueueItem) => activityFor(`${game}.pkg`, [it], idle, "192.168.0.100");
    expect(at(install({}))).toMatchObject({ phase: "sending", installing: true, pct: null });
    expect(at(install({ installPct: 40 }))).toMatchObject({ pct: 40 });
    expect(
      at(install({ installPct: 40, installProgress: { phase: "transfer", current: 250, total: 1000, bytesPerSec: 0 } })),
    ).toMatchObject({ pct: 25 });
  });

  it("leaves the same game free to send to another console", () => {
    // Sending a game to the Pro disabled its Send button for the Phat too.
    expect(activityFor(game, [sending("192.168.0.100")], idle, "192.168.0.99")).toBeNull();
  });

  it("matches a console address with a port", () => {
    expect(activityFor(game, [sending("192.168.0.100:9113")], idle, "192.168.0.100")).not.toBeNull();
  });

  it("shows an image being built for another console as no activity on this one", () => {
    const building = {
      phase: "running",
      source: game,
      host: "192.168.0.100",
      stageDone: 1,
      stageTotal: 4,
    } as unknown as Parameters<typeof activityFor>[2];
    expect(activityFor(game, [], building, "192.168.0.99")).toBeNull();
    expect(activityFor(game, [], building, "192.168.0.100")).toMatchObject({ phase: "building" });
  });
});
