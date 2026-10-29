import { describe, expect, it } from "vitest";

import { aboveDecryptLimit, dumpDrives, isDumpable } from "./DumpThisGame";

describe("dumping from the game page", () => {
  it("offers USB and extended storage before the internal drive, and nothing else", () => {
    const v = (path: string, total_bytes = 1) =>
      ({ path, total_bytes, free_bytes: 1, fs_type: "exfatfs" }) as Parameters<
        typeof dumpDrives
      >[0][number];
    expect(
      dumpDrives([
        v("/data"),
        v("/mnt/ext0"),
        v("/system"),
        v("/mnt/usb1"),
        v("/mnt/usb0", 0),
      ]).map((d) => d.path),
    ).toEqual(["/mnt/usb1", "/mnt/ext0", "/data"]);
  });

  it("dumps games, not system apps", () => {
    expect(isDumpable({ system: false })).toBe(true);
    expect(isDumpable({ system: true })).toBe(false);
  });

  it("knows the firmware the helper no longer decrypts on", () => {
    expect(aboveDecryptLimit("13.60")).toBe(false);
    expect(aboveDecryptLimit("9.60")).toBe(false);
    expect(aboveDecryptLimit("13.70")).toBe(true);
    expect(aboveDecryptLimit("14.00")).toBe(true);
    expect(aboveDecryptLimit(null)).toBe(false);
  });
});
