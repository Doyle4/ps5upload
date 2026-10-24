import { describe, expect, it } from "vitest";

import { consoleSource } from "./collectionActions";

describe("consoleSource", () => {
  it("names a console copy the way Convert reads it", () => {
    expect(consoleSource("192.168.86.99", "/data/homebrew/Game")).toBe(
      "ps5://192.168.86.99/data/homebrew/Game",
    );
    expect(consoleSource("192.168.86.99:9113", "mnt/ext0/G.exfat")).toBe(
      "ps5://192.168.86.99/mnt/ext0/G.exfat",
    );
  });
});
