import { describe, expect, it } from "vitest";

import { gamesTabOf } from "./gamesTab";

describe("Games views", () => {
  it("keeps old links on the view they named", () => {
    expect(gamesTabOf("ready")).toBe("ready");
    expect(gamesTabOf("files")).toBe("files");
    expect(gamesTabOf("dumps")).toBe("dumps");
  });

  it("opens the grid otherwise, the old copies tab included", () => {
    expect(gamesTabOf(null)).toBe("any");
    expect(gamesTabOf("all")).toBe("any");
    expect(gamesTabOf("collection")).toBe("any");
  });
});
