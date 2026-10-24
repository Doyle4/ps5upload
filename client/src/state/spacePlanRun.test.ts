import { beforeEach, describe, expect, it, vi } from "vitest";

import { planWithSelection, type SpaceCandidate, type SpacePlanInput } from "../lib/spacePlan";
import { moveDestination, runSpacePlan, stopSpacePlan, useSpaceRunStore, type SpaceRunDeps } from "./spacePlanRun";

const GB = 1024 ** 3;

const cands: SpaceCandidate[] = [
  { id: "leftover:7", kind: "leftover", label: "old.pkg", bytes: 5 * GB, lastPlayedMs: null, cleanupId: 7 },
  { id: "leftover:8", kind: "leftover", label: "tmp", bytes: 1 * GB, lastPlayedMs: null, cleanupId: 8 },
  {
    id: "move:/data/homebrew/A",
    kind: "move",
    label: "A",
    bytes: 40 * GB,
    lastPlayedMs: null,
    moveTargets: ["/mnt/usb0"],
    path: "/data/homebrew/A",
  },
  { id: "uninstall:PPSA1", kind: "uninstall", label: "U", titleId: "PPSA1", bytes: 50 * GB, lastPlayedMs: null, hasCopy: true },
];

const planOf = (ids: string[]) => {
  const input: SpacePlanInput = {
    neededBytes: 200 * GB,
    roomBytes: 0,
    candidates: cands,
    destRoom: { "/mnt/usb0": 500 * GB },
    nowMs: 0,
  };
  return planWithSelection(input, new Set(ids));
};

function deps(over: Partial<SpaceRunDeps> = {}): SpaceRunDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    cleanup: vi.fn(async (ids: number[]) => {
      calls.push(`cleanup ${ids.join(",")}`);
      return { done: ids, skipped: [], failed: [] };
    }),
    pathExists: vi.fn(async () => false),
    move: vi.fn(async (from: string, to: string) => {
      calls.push(`move ${from} -> ${to}`);
      return { phase: "done" as const, error: null };
    }),
    stopMove: vi.fn(),
    uninstall: vi.fn(async (id: string) => {
      calls.push(`uninstall ${id}`);
      return { stillPresent: false };
    }),
    ...over,
  };
}

const states = () => Object.fromEntries(Object.entries(useSpaceRunStore.getState().steps).map(([k, v]) => [k, v.state]));

beforeEach(() => {
  useSpaceRunStore.setState({ running: false });
  useSpaceRunStore.getState().reset();
});

describe("runSpacePlan", () => {
  it("runs leftovers in one clean-up run, then moves, then uninstalls", async () => {
    const d = deps();
    await runSpacePlan("h", planOf(["uninstall:PPSA1", "move:/data/homebrew/A", "leftover:7", "leftover:8"]), ["/data", "/mnt/usb0"], d);
    expect(d.calls).toEqual(["cleanup 7,8", "move /data/homebrew/A -> /mnt/usb0/homebrew/A", "uninstall PPSA1"]);
    expect(states()).toEqual({
      "leftover:7": "done",
      "leftover:8": "done",
      "move:/data/homebrew/A": "done",
      "uninstall:PPSA1": "done",
    });
    expect(useSpaceRunStore.getState().running).toBe(false);
    expect(useSpaceRunStore.getState().finished).toBe(true);
  });

  it("only runs what is ticked", async () => {
    const d = deps();
    await runSpacePlan("h", planOf(["uninstall:PPSA1"]), ["/data", "/mnt/usb0"], d);
    expect(d.calls).toEqual(["uninstall PPSA1"]);
  });

  it("reports each leftover the console skipped or failed, and keeps going", async () => {
    const d = deps({
      cleanup: vi.fn(async () => ({ done: [], skipped: [{ id: 7, reason: "changed" }], failed: [{ id: 8, reason: "io" }] })),
    });
    await runSpacePlan("h", planOf(["leftover:7", "leftover:8", "uninstall:PPSA1"]), ["/data"], d);
    expect(states()).toMatchObject({ "leftover:7": "skipped", "leftover:8": "failed", "uninstall:PPSA1": "done" });
    expect(useSpaceRunStore.getState().steps["leftover:7"].detail).toBe("changed");
  });

  it("does not move onto something already there", async () => {
    const d = deps({ pathExists: vi.fn(async () => true) });
    await runSpacePlan("h", planOf(["move:/data/homebrew/A"]), ["/data", "/mnt/usb0"], d);
    expect(d.move).not.toHaveBeenCalled();
    expect(useSpaceRunStore.getState().steps["move:/data/homebrew/A"]).toMatchObject({ state: "skipped", detail: "dest_exists" });
  });

  it("says when a move copied but could not delete the original", async () => {
    const d = deps({ move: vi.fn(async () => ({ phase: "delete-failed" as const, error: "busy" })) });
    await runSpacePlan("h", planOf(["move:/data/homebrew/A"]), ["/data", "/mnt/usb0"], d);
    expect(useSpaceRunStore.getState().steps["move:/data/homebrew/A"]).toMatchObject({ state: "failed", detail: "both_copies" });
  });

  it("says when the console still has the game after an uninstall", async () => {
    const d = deps({ uninstall: vi.fn(async () => ({ stillPresent: true })) });
    await runSpacePlan("h", planOf(["uninstall:PPSA1"]), ["/data"], d);
    expect(useSpaceRunStore.getState().steps["uninstall:PPSA1"]).toMatchObject({ state: "failed", detail: "still_present" });
  });

  it("records a refused uninstall and an error in the clean-up run", async () => {
    const d = deps({
      cleanup: vi.fn(async () => {
        throw new Error("busy");
      }),
      uninstall: vi.fn(async () => {
        throw new Error("uninstall_refused:0x1");
      }),
    });
    await runSpacePlan("h", planOf(["leftover:7", "uninstall:PPSA1"]), ["/data"], d);
    expect(useSpaceRunStore.getState().steps["leftover:7"]).toMatchObject({ state: "failed", detail: "busy" });
    expect(useSpaceRunStore.getState().steps["uninstall:PPSA1"]).toMatchObject({ state: "failed", detail: "uninstall_refused:0x1" });
  });

  it("stops after the step that is running, and stops a running move's copy", async () => {
    const plan = planOf(["move:/data/homebrew/A", "uninstall:PPSA1"]);
    const d = deps();
    d.move = vi.fn(async () => {
      stopSpacePlan(d, plan);
      return { phase: "cancelled" as const, error: null };
    });
    await runSpacePlan("h", plan, ["/data", "/mnt/usb0"], d);
    expect(d.stopMove).toHaveBeenCalledWith("/data/homebrew/A");
    expect(d.uninstall).not.toHaveBeenCalled();
    expect(states()).toEqual({ "move:/data/homebrew/A": "stopped", "uninstall:PPSA1": "stopped" });
  });

  it("does not start a second run while one is going", async () => {
    useSpaceRunStore.setState({ running: true });
    const d = deps();
    await runSpacePlan("h", planOf(["uninstall:PPSA1"]), ["/data"], d);
    expect(d.uninstall).not.toHaveBeenCalled();
  });
});

describe("moveDestination", () => {
  it("keeps the folder it was in, under the other drive", () => {
    expect(moveDestination("/data/homebrew/A", "/mnt/usb0", ["/data", "/mnt/usb0"])).toBe("/mnt/usb0/homebrew/A");
    expect(moveDestination("/mnt/ext1/games/X.exfat", "/user", ["/user", "/mnt/ext1"])).toBe("/user/games/X.exfat");
  });
});
