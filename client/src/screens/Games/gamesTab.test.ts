import { describe, expect, it } from "vitest";

import { gamesTabOf } from "./gamesTab";

describe("Games ?tab=", () => {
  it("keeps the old values and adds Everything", () => {
    expect(gamesTabOf("ready")).toBe("ready");
    expect(gamesTabOf("files")).toBe("files");
    expect(gamesTabOf("all")).toBe("all");
  });

  it("opens On this PS5 for none or an unknown value", () => {
    expect(gamesTabOf(null)).toBe("ready");
    expect(gamesTabOf("collection")).toBe("ready");
  });
});
