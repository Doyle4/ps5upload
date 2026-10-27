import { describe, expect, it } from "vitest";
import { avcCodecString, isKeyframe, mergePads, padFromKeys, PadButton, IDLE_PAD } from "./remotePlayStream";

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
