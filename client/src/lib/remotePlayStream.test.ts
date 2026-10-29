import { describe, expect, it } from "vitest";
import {
  avcCodecString,
  canvasClass,
  DEFAULT_KEYMAP,
  isKeyframe,
  keysFor,
  mergePads,
  padFromKeys,
  PadButton,
  IDLE_PAD,
  rebind,
} from "./remotePlayStream";

describe("rebind", () => {
  it("moves an action to a new key and frees the old one", () => {
    const next = rebind(DEFAULT_KEYMAP, { button: PadButton.CROSS }, "KeyX");
    expect(keysFor(next, { button: PadButton.CROSS })).toEqual(["KeyX"]);
    expect(next.Enter).toBeUndefined();
    expect(padFromKeys(["KeyX"], next).buttons).toBe(PadButton.CROSS);
  });
  it("takes the key off whatever it did before", () => {
    const next = rebind(DEFAULT_KEYMAP, { button: PadButton.CROSS }, "KeyQ");
    expect(keysFor(next, { button: PadButton.SQUARE })).toEqual([]);
  });
});

describe("padFromKeys", () => {
  it("maps buttons, sticks and triggers", () => {
    const p = padFromKeys(["Enter", "ArrowUp", "KeyD", "Digit3"]);
    expect(p.buttons).toBe(PadButton.CROSS | PadButton.UP);
    expect(p.lx).toBe(32767);
    expect(p.r2).toBe(255);
  });
  it("opposite keys cancel", () => {
    expect(padFromKeys(["KeyA", "KeyD"]).lx).toBe(0);
  });
  it("ignores unmapped keys", () => {
    expect(padFromKeys(["KeyP"])).toEqual(IDLE_PAD);
  });
});

describe("mergePads", () => {
  it("ORs buttons and clamps sticks", () => {
    const m = mergePads({ ...IDLE_PAD, buttons: 1, lx: 30000 }, { ...IDLE_PAD, buttons: 2, lx: 30000 });
    expect(m.buttons).toBe(3);
    expect(m.lx).toBe(32767);
  });
});

describe("isKeyframe", () => {
  it("knows an H.264 IDR from a P slice", () => {
    expect(isKeyframe(new Uint8Array([0, 0, 0, 1, 0x65, 0x88]), false)).toBe(true);
    expect(isKeyframe(new Uint8Array([0, 0, 0, 1, 0x41, 0x9a]), false)).toBe(false);
  });
  it("knows an HEVC IDR from a trailing picture", () => {
    expect(isKeyframe(new Uint8Array([0, 0, 0, 1, 19 << 1, 1]), true)).toBe(true);
    expect(isKeyframe(new Uint8Array([0, 0, 0, 1, 1 << 1, 1]), true)).toBe(false);
  });
});

describe("avcCodecString", () => {
  it("reads profile, constraints and level from the SPS", () => {
    expect(avcCodecString(new Uint8Array([0, 0, 0, 1, 0x67, 0x4d, 0x40, 0x32, 0x99]))).toBe("avc1.4d4032");
  });
});

describe("canvasClass", () => {
  it("keeps the canvas inside its place and maps each fit to object-fit", () => {
    for (const fit of ["fit", "fill", "stretch"] as const) {
      const c = canvasClass(fit).split(" ");
      for (const k of ["pointer-events-none", "h-full", "w-full", "max-h-full", "max-w-full", "min-h-0", "min-w-0"]) expect(c).toContain(k);
    }
    expect(canvasClass("fit")).toContain("object-contain");
    expect(canvasClass("fill")).toContain("object-cover");
    expect(canvasClass("stretch")).toContain("object-fill");
    // A stored value from elsewhere falls back to the whole picture.
    expect(canvasClass("zoom" as never)).toContain("object-contain");
  });
});
