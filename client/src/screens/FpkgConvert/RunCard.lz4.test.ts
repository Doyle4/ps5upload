import { describe, expect, it } from "vitest";
import { lz4SavedNothing } from "./RunCard";

describe("lz4SavedNothing", () => {
  const done = (bytes: number, pack = true) => ({ mode: "image", packageBytes: bytes, stageMs: pack ? { pack: 5000 } : {} });
  it("says so when an LZ4 image came out no smaller than the game", () => {
    expect(lz4SavedNothing(done(41.5e9), 40.9e9)).toBe(true);
  });
  it("stays quiet when LZ4 saved space, or when no LZ4 pack ran", () => {
    expect(lz4SavedNothing(done(30e9), 40.9e9)).toBe(false);
    expect(lz4SavedNothing(done(41.5e9, false), 40.9e9)).toBe(false);
  });
});
