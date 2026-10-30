import { describe, expect, it } from "vitest";

import { BUSY_WINDOW_S, BusyNetworkWatch, WARMUP_S, badSecond, canStepDown } from "./rpAutoQuality";

const good = { lossPct: 0.2, lost: 0, rebuilt: 1 };
const bad = { lossPct: 4, lost: 3, rebuilt: 12 };

describe("badSecond", () => {
  it("counts packet loss, lost frames, and many rebuilt frames", () => {
    expect(badSecond(good)).toBe(false);
    expect(badSecond({ lossPct: 2, lost: 0, rebuilt: 0 })).toBe(true);
    expect(badSecond({ lossPct: 0, lost: 2, rebuilt: 0 })).toBe(true);
    expect(badSecond({ lossPct: 0, lost: 0, rebuilt: 5 })).toBe(false);
    expect(badSecond({ lossPct: 0, lost: 0, rebuilt: 10 })).toBe(true);
  });
});

describe("BusyNetworkWatch", () => {
  const feed = (w: BusyNetworkWatch, seconds: Array<typeof good>) => seconds.map((s) => w.push(s));

  it("offers only after the loss has lasted about ten seconds", () => {
    const w = new BusyNetworkWatch();
    feed(w, Array(WARMUP_S).fill(bad));
    const out = feed(w, Array(BUSY_WINDOW_S).fill(bad));
    expect(out.slice(0, -1).every((x) => !x)).toBe(true);
    expect(out[out.length - 1]).toBe(true);
  });

  it("does not judge the first seconds of a session", () => {
    const w = new BusyNetworkWatch();
    expect(feed(w, Array(WARMUP_S + BUSY_WINDOW_S - 1).fill(bad)).some(Boolean)).toBe(false);
  });

  it("lets a few bad seconds pass", () => {
    const w = new BusyNetworkWatch();
    feed(w, Array(WARMUP_S).fill(good));
    const pattern = [bad, good, bad, good, bad, bad, good, bad, bad, good, bad, good];
    expect(feed(w, pattern).some(Boolean)).toBe(false);
  });

  it("starts over after reset", () => {
    const w = new BusyNetworkWatch();
    feed(w, Array(WARMUP_S + BUSY_WINDOW_S - 1).fill(bad));
    w.reset();
    expect(feed(w, Array(WARMUP_S + 1).fill(bad)).some(Boolean)).toBe(false);
  });
});

describe("canStepDown", () => {
  const base = { enabled: true, res: "1920x1080", pictureHeight: 1080, offered: false };

  it("steps down from 1080p only", () => {
    expect(canStepDown(base)).toBe(true);
    expect(canStepDown({ ...base, res: "1280x720" })).toBe(false);
    expect(canStepDown({ ...base, pictureHeight: 720 })).toBe(false);
  });

  it("never twice in a session, and never when switched off", () => {
    expect(canStepDown({ ...base, offered: true })).toBe(false);
    expect(canStepDown({ ...base, enabled: false })).toBe(false);
  });
});
