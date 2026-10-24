import { describe, expect, it } from "vitest";
import { pickRunSide } from "./runPlacement";

// ④ goes under the column that leaves the smaller hole; heights in px, gap 16.
describe("pickRunSide", () => {
  it("puts ④ under ③ when ③ is short (a folder needs almost no options)", () => {
    expect(pickRunSide({ steps: 650, options: 260, run: 190 }, 16, "left")).toBe("right");
  });

  it("puts ④ under ①② when ③ is tall (a compressed image)", () => {
    expect(pickRunSide({ steps: 650, options: 800, run: 220 }, 16, "right")).toBe("left");
  });

  it("stays put when the other side is only a little better", () => {
    // Left leaves 226, right 246: not worth moving ④ back and forth.
    expect(pickRunSide({ steps: 650, options: 660, run: 220 }, 16, "left")).toBe("left");
    expect(pickRunSide({ steps: 650, options: 660, run: 220 }, 16, "right")).toBe("right");
  });
});
