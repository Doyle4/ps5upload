import { describe, expect, it } from "vitest";
import { createPadReader, DEFAULT_INPUT_MAP, nextFocus, type InputMap } from "./nav";

// Vitest runs in node here (no jsdom): rects are plain objects and the
// "elements" are tagged stand-ins, which is all nextFocus looks at.
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}
const el = (name: string) => ({ name }) as unknown as HTMLElement;

describe("nextFocus", () => {
  it("nextFocus_prefers_aligned_neighbour", () => {
    const from = rect(100, 100, 200, 50);
    const aligned = el("aligned"); // straight below, further away
    const diagonal = el("diagonal"); // closer, but off to the right
    const above = el("above");
    const got = nextFocus(
      from,
      [
        { el: diagonal, rect: rect(320, 160, 200, 50) },
        { el: aligned, rect: rect(100, 240, 200, 50) },
        { el: above, rect: rect(100, 20, 200, 50) },
      ],
      "down",
    );
    expect(got).toBe(aligned);
  });

  it("nextFocus_none_beyond_edge", () => {
    const from = rect(100, 100, 200, 50);
    const got = nextFocus(
      from,
      [
        { el: el("left"), rect: rect(0, 100, 80, 50) },
        { el: el("above"), rect: rect(100, 20, 200, 50) },
      ],
      "right",
    );
    expect(got).toBeNull();
  });

  it("falls back to the nearest off-axis candidate when nothing is aligned", () => {
    const from = rect(400, 500, 100, 40); // a row below the last rail item
    const near = el("near");
    const got = nextFocus(
      from,
      [
        { el: el("far"), rect: rect(10, 10, 80, 80) },
        { el: near, rect: rect(10, 300, 80, 80) },
      ],
      "left",
    );
    expect(got).toBe(near);
  });
});

describe("gamepad reader", () => {
  const press = (...idx: number[]) => {
    const b: boolean[] = new Array(17).fill(false);
    for (const i of idx) b[i] = true;
    return b;
  };

  it("fires a face button once per press (edge-triggered)", () => {
    const read = createPadReader(DEFAULT_INPUT_MAP);
    expect(read(press(0), 0)).toEqual(["confirm"]);
    expect(read(press(0), 16)).toEqual([]);
    expect(read(press(0), 900)).toEqual([]);
    expect(read(press(), 916)).toEqual([]);
    expect(read(press(0), 932)).toEqual(["confirm"]);
  });

  it("repeats a held D-pad direction after the delay, then at the repeat rate", () => {
    const read = createPadReader(DEFAULT_INPUT_MAP);
    expect(read(press(13), 0)).toEqual(["down"]);
    expect(read(press(13), 399)).toEqual([]);
    expect(read(press(13), 400)).toEqual(["down"]);
    expect(read(press(13), 519)).toEqual([]);
    expect(read(press(13), 520)).toEqual(["down"]);
    expect(read(press(), 600)).toEqual([]);
  });

  it("ignores buttons the map does not name", () => {
    const map: InputMap = { keys: {}, buttons: { 1: { action: "back", glyph: "○", verified: false } } };
    const read = createPadReader(map);
    expect(read(press(0, 1), 0)).toEqual(["back"]);
  });
});

describe("default input map", () => {
  it("ships every R11 binding unverified", () => {
    const all = [...Object.values(DEFAULT_INPUT_MAP.keys), ...Object.values(DEFAULT_INPUT_MAP.buttons)];
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((b) => b.verified === false)).toBe(true);
    expect(DEFAULT_INPUT_MAP.buttons[0].action).toBe("confirm");
    expect(DEFAULT_INPUT_MAP.buttons[1].action).toBe("back");
    expect(DEFAULT_INPUT_MAP.keys.Escape.action).toBe("back");
    expect(DEFAULT_INPUT_MAP.keys.Backspace.action).toBe("back");
  });
});
