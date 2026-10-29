import { describe, expect, it } from "vitest";

import { gamesTabOf, legacyConsoleFilter } from "./gamesTab";

describe("Games views", () => {
  it("keeps Dumps on its own view", () => {
    expect(gamesTabOf("dumps")).toBe("dumps");
  });

  it("opens the grid otherwise, the old views included", () => {
    expect(gamesTabOf(null)).toBe("any");
    expect(gamesTabOf("all")).toBe("any");
    expect(gamesTabOf("ready")).toBe("any");
    expect(gamesTabOf("files")).toBe("any");
    expect(gamesTabOf("collection")).toBe("any");
  });

  it("turns links to the old views into the grid filter that shows the same games", () => {
    const f = (q: string) => legacyConsoleFilter(new URLSearchParams(q));
    expect(f("tab=ready")).toBe("installed");
    expect(f("tab=ready&unplayed=1")).toBe("unplayed");
    expect(f("tab=files")).toBe("drives");
    expect(f("tab=all")).toBeNull();
    expect(f("")).toBeNull();
  });
});
