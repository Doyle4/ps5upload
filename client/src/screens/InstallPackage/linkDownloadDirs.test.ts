import { describe, expect, it } from "vitest";

import { imageDirFor } from "./LinkDownloadCard";

describe("imageDirFor", () => {
  it("puts a game image in the homebrew folder ShadowMount+ scans", () => {
    expect(imageDirFor(null)).toBe("/data/homebrew");
    expect(imageDirFor("/mnt/ext0")).toBe("/mnt/ext0/homebrew");
    expect(imageDirFor("/mnt/usb0/")).toBe("/mnt/usb0/homebrew");
  });
});
