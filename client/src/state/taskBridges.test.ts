import { describe, expect, it } from "vitest";

import type { HelperSendState } from "./helperSend";
import { helperSendTransitions, playlistTaskPatch } from "./taskBridges";
import { queueStage } from "./taskWiring";

const busy = (startedAtMs: number, msg = "Sending…"): HelperSendState => ({
  state: "busy",
  phase: "sending",
  msg,
  startedAtMs,
});

describe("helperSendTransitions", () => {
  it("begins, follows and ends a send per console", () => {
    expect(helperSendTransitions({}, { h: busy(1) })).toEqual([{ host: "h", event: "begin", state: busy(1) }]);
    expect(helperSendTransitions({ h: busy(1) }, { h: busy(1, "Waiting…") })[0].event).toBe("progress");
    // A new press starts a new send.
    expect(helperSendTransitions({ h: busy(1) }, { h: busy(2) })[0].event).toBe("begin");
    expect(helperSendTransitions({ h: busy(1) }, {})[0].event).toBe("done");
    const fail: HelperSendState = { state: "fail", phase: null, msg: "loader down", startedAtMs: 1 };
    expect(helperSendTransitions({ h: busy(1) }, { h: fail })[0]).toMatchObject({ event: "failed", state: fail });
    // A failure that was already shown, then cleared, is no news.
    expect(helperSendTransitions({ h: fail }, {})).toEqual([]);
  });
});

describe("playlistTaskPatch", () => {
  it("maps a run's status to a live step or an ending", () => {
    expect(playlistTaskPatch({ kind: "running", playlistId: "p", stepIndex: 1, host: "h" }, 3)).toEqual({ kind: "live", step: 1 });
    expect(
      playlistTaskPatch(
        { kind: "sleeping", playlistId: "p", host: "h", stepIndex: 2, sleepStartedAtMs: 0, sleepDurationMs: 5 },
        3,
      ),
    ).toEqual({ kind: "live", step: 2 });
    expect(
      playlistTaskPatch({ kind: "done", playlistId: "p", host: "h", successCount: 2, failureCount: 1, failures: [] }, 3),
    ).toEqual({ kind: "done" });
    expect(
      playlistTaskPatch(
        { kind: "done", playlistId: "p", host: "h", successCount: 0, failureCount: 2, failures: [{ stepIndex: 0, error: "x" }] },
        2,
      ),
    ).toEqual({ kind: "failed", error: "x" });
    expect(playlistTaskPatch({ kind: "failed", playlistId: "p", host: "h", stepIndex: 0, error: "e" }, 2)).toEqual({
      kind: "failed",
      error: "e",
    });
    expect(playlistTaskPatch({ kind: "idle" }, 2)).toEqual({ kind: "stopped" });
  });
});

describe("queueStage", () => {
  it("says the PS5 is finishing once every byte is sent", () => {
    expect(queueStage(5, 10)).toBe("Sending");
    expect(queueStage(10, 10)).toBe("Finishing on the PS5");
    expect(queueStage(0, 0)).toBe("Sending");
  });
});
