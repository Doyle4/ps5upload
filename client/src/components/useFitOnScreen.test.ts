import { describe, expect, it } from "vitest";
import { fitOnScreen } from "./useFitOnScreen";

const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });
const screen = (w: number, h: number) => box(0, 0, w, h);

describe("fitOnScreen", () => {
  it("leaves a box that already fits alone", () => {
    expect(fitOnScreen(box(20, 20, 200, 200), screen(360, 780))).toEqual({ dx: 0, maxHeight: null, up: false });
  });

  it("slides a panel back that grew off the left of a phone", () => {
    // The notifications panel in the More footer: anchored right, 320 wide, its bell mid-row.
    expect(fitOnScreen(box(-61, 100, 320, 300), screen(360, 780)).dx).toBe(69);
  });

  it("slides a panel back from the right edge", () => {
    expect(fitOnScreen(box(200, 100, 224, 100), screen(360, 780)).dx).toBe(-72);
  });

  it("keeps the left edge on screen when the box is wider than the window", () => {
    expect(fitOnScreen(box(100, 0, 400, 100), screen(360, 780)).dx).toBe(-92);
  });

  it("caps the height of a panel that runs past the bottom (or under the tab bar)", () => {
    expect(fitOnScreen(box(10, 100, 300, 430), screen(852, 393)).maxHeight).toBe(285);
  });

  it("caps the height of a panel opening upwards past the top", () => {
    expect(fitOnScreen(box(10, -60, 300, 430), screen(360, 780)).maxHeight).toBe(362);
  });

  it("fits inside the screen area, not just the window", () => {
    // The landscape top bar's bell: the screen area ends 26px above the window's bottom.
    expect(fitOnScreen(box(500, 60, 320, 330), box(0, 0, 852, 367)).maxHeight).toBe(299);
  });

  it("opens a menu upwards when it does not fit below its button but does above", () => {
    // Browse ▾ near the bottom of an iPhone, just above the tab bar (which ends the area at 760).
    const fit = fitOnScreen(box(150, 700, 224, 110), screen(393, 760), box(150, 660, 200, 40));
    expect(fit).toEqual({ dx: 0, maxHeight: null, up: true });
  });

  it("keeps a menu below when there is more room there than above", () => {
    expect(fitOnScreen(box(150, 100, 224, 700), screen(393, 760), box(150, 60, 200, 40)).up).toBe(false);
  });

  it("fits the room there is on a short screen, down to a row or two", () => {
    expect(fitOnScreen(box(10, 290, 300, 200), screen(852, 393)).maxHeight).toBe(95);
    expect(fitOnScreen(box(10, 380, 300, 200), screen(852, 393)).maxHeight).toBe(64);
  });
});
