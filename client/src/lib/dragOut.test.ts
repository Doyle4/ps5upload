import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));

const { isDragOutCopy } = await import("./dragOut");

describe("drag out", () => {
  it("knows its own staged copies when one is dropped back on the window", () => {
    expect(
      isDragOutCopy(
        "/Users/a/Library/Application Support/com.phantomptr.ps5upload/dragout/10_0_0_2_9113__data_a1b2c3d4/game",
      ),
    ).toBe(true);
    expect(
      isDragOutCopy(
        "C:\\Users\\a\\AppData\\Local\\com.phantomptr.ps5upload\\dragout\\x_0badf00d\\eboot.bin",
      ),
    ).toBe(true);
    expect(isDragOutCopy("/Users/a/Downloads/game.pkg")).toBe(false);
    expect(isDragOutCopy("/Users/a/dragout/game.pkg")).toBe(false);
  });
});
