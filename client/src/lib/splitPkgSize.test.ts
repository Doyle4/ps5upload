import { describe, expect, it } from "vitest";

import { splitPkgBytes } from "./splitPkgSize";

describe("a split package's bytes", () => {
  const listing = [
    { name: "Game.pkg", size: 100 },
    { name: "Game.pkg.0", size: 10 },
    { name: "Game.pkg.1", size: 20 },
    { name: "Other.pkg", size: 7 },
    { name: "Big_0.pkg", size: 1000 },
    { name: "Big_1.pkg", size: 500 },
    { name: "Big_2.pkg", size: 250 },
  ];

  it("adds `.pkg.N` parts to their lead", () => {
    expect(splitPkgBytes("Game.pkg", 100, listing)).toBe(130);
  });

  it("adds `_N.pkg` parts to part 0 only, so a set never counts twice", () => {
    expect(splitPkgBytes("Big_0.pkg", 1000, listing)).toBe(1750);
    expect(splitPkgBytes("Big_1.pkg", 500, listing)).toBe(500);
  });

  it("leaves a lone package at its own size", () => {
    expect(splitPkgBytes("Other.pkg", 7, listing)).toBe(7);
    expect(splitPkgBytes("Other.pkg", 7, [])).toBe(7);
  });
});
