import { describe, expect, it } from "vitest";

import { captureFileName, clipClock, recorderType } from "./rpCapture";

describe("captureFileName", () => {
  const at = new Date(2026, 9, 30, 21, 14, 5);

  it("names a capture after the console and the local time", () => {
    expect(captureFileName("Living room", at, "png")).toBe("PS5 Living room 2026-10-30 21-14-05.png");
    expect(captureFileName("Pro", at, ".mp4")).toBe("PS5 Pro 2026-10-30 21-14-05.mp4");
  });

  it("keeps characters no file system takes out of the name", () => {
    expect(captureFileName('a/b\\c:d*e?"f<g>|h', at, "png")).toBe("PS5 a b c d e f g h 2026-10-30 21-14-05.png");
    expect(captureFileName("  tabs\tand\nlines  ", at, "png")).toBe("PS5 tabs and lines 2026-10-30 21-14-05.png");
  });

  it("works without a console name, and keeps other scripts", () => {
    expect(captureFileName("", at, "webm")).toBe("PS5 2026-10-30 21-14-05.webm");
    expect(captureFileName("客厅", at, "png")).toBe("PS5 客厅 2026-10-30 21-14-05.png");
  });

  it("keeps a long name short", () => {
    expect(captureFileName("x".repeat(200), at, "png").length).toBeLessThan(90);
  });
});

describe("recorderType", () => {
  it("prefers MP4 when the device records it", () => {
    expect(recorderType(() => true)).toEqual({ mime: "video/mp4;codecs=avc1,mp4a.40.2", ext: "mp4" });
  });

  it("falls back to WebM", () => {
    expect(recorderType((m) => m.startsWith("video/webm"))).toEqual({ mime: "video/webm;codecs=vp9,opus", ext: "webm" });
    expect(recorderType((m) => m === "video/webm")).toEqual({ mime: "video/webm", ext: "webm" });
  });

  it("is null when nothing records, and a check that throws is a no", () => {
    expect(recorderType(() => false)).toBeNull();
    expect(
      recorderType(() => {
        throw new Error("nope");
      }),
    ).toBeNull();
  });
});

describe("clipClock", () => {
  it("shows minutes and seconds, and hours when there are any", () => {
    expect(clipClock(0)).toBe("0:00");
    expect(clipClock(65_400)).toBe("1:05");
    expect(clipClock(3_725_000)).toBe("1:02:05");
    expect(clipClock(-5)).toBe("0:00");
  });
});
