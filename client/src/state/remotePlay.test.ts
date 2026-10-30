import { describe, expect, it } from "vitest";

import { DEFAULT_RP_PREFS, LOWEST_AUDIO_BUFFER_MS, audioBufferFor } from "./remotePlay";

describe("audioBufferFor", () => {
  it("is the chosen sound buffer, or the smallest one in low-latency mode", () => {
    expect(audioBufferFor({ lowLatency: false, audioBufferMs: 120 })).toBe(120);
    expect(audioBufferFor({ lowLatency: true, audioBufferMs: 120 })).toBe(LOWEST_AUDIO_BUFFER_MS);
    expect(audioBufferFor({ lowLatency: true, audioBufferMs: 40 })).toBe(40);
  });

  it("starts with low latency off and the 720p offer on", () => {
    expect(DEFAULT_RP_PREFS.lowLatency).toBe(false);
    expect(DEFAULT_RP_PREFS.autoQuality).toBe(true);
  });
});
