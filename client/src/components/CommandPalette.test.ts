import { afterEach, describe, expect, it, vi } from "vitest";

import { OPEN_COMMAND_PALETTE_EVENT, openCommandPalette, paletteScreens } from "./CommandPalette";

describe("openCommandPalette", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the event the palette listens for", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const seen: string[] = [];
    target.addEventListener(OPEN_COMMAND_PALETTE_EVENT, (e) => seen.push(e.type));
    openCommandPalette();
    expect(seen).toEqual([OPEN_COMMAND_PALETTE_EVENT]);
  });
});

describe("the palette's screens", () => {
  const where = { betaEnabled: false, inBrowser: false, macOrLinux: true };

  it("lists Home and Bug report, then pinned screens in pin order, then the rest", () => {
    const order = paletteScreens(["/processes", "/files"], where).map((i) => i.to);
    expect(order.slice(0, 4)).toEqual(["/home", "/bug-report", "/processes", "/files"]);
    // Each screen once.
    expect(new Set(order).size).toBe(order.length);
    const plain = paletteScreens([], where).map((i) => i.to);
    expect([...order].sort()).toEqual([...plain].sort());
  });

  it("keeps the usual order with nothing pinned, and skips pins this build can't show", () => {
    const plain = paletteScreens([], where).map((i) => i.to);
    expect(plain.slice(0, 2)).toEqual(["/home", "/bug-report"]);
    // Shell has no browser path: pinned or not, the browser build leaves it out.
    const browser = paletteScreens(["/shell", "/files"], { ...where, inBrowser: true }).map((i) => i.to);
    expect(browser).not.toContain("/shell");
    expect(browser[2]).toBe("/files");
  });
});

