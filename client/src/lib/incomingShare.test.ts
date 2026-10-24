import { describe, expect, it } from "vitest";

import {
  SHARE_COPY_LIMIT,
  copyDecision,
  extractLink,
  parseShareEvent,
  parseShareQueue,
  pathItems,
  shareTarget,
} from "./incomingShare";

describe("extractLink", () => {
  it("finds the first http(s) link in shared text", () => {
    expect(extractLink("Get it: https://example.com/game.pkg now")).toBe(
      "https://example.com/game.pkg",
    );
    expect(extractLink("http://10.0.0.2:8080/a.pkg")).toBe("http://10.0.0.2:8080/a.pkg");
  });

  it("drops the punctuation a sentence puts after it", () => {
    expect(extractLink("See https://example.com/a.pkg.")).toBe("https://example.com/a.pkg");
    expect(extractLink("(https://example.com/a.pkg)")).toBe("https://example.com/a.pkg");
    expect(extractLink("https://en.wikipedia.org/wiki/Foo_(bar)")).toBe(
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    );
  });

  it("ignores text with no web link", () => {
    expect(extractLink("no link here")).toBeNull();
    expect(extractLink("ftp://example.com/a.pkg")).toBeNull();
    expect(extractLink("")).toBeNull();
  });
});

describe("parseShareEvent", () => {
  it("turns shared text into a link, or plain text without one", () => {
    expect(parseShareEvent({ kind: "text", value: "x https://a.b/c.pkg" })).toEqual({
      type: "item",
      item: { kind: "url", url: "https://a.b/c.pkg" },
    });
    expect(parseShareEvent({ kind: "text", value: "hello" })).toEqual({
      type: "item",
      item: { kind: "text", text: "hello" },
    });
  });

  it("reads a path and a stream with their name and size", () => {
    expect(
      parseShareEvent({ kind: "path", value: "/storage/emulated/0/Download/g.pkg", size: 10 }),
    ).toEqual({
      type: "item",
      item: { kind: "path", path: "/storage/emulated/0/Download/g.pkg", name: "g.pkg", size: 10 },
    });
    expect(parseShareEvent({ kind: "stream", value: "s1", name: "g.pkg", size: -1 })).toEqual({
      type: "item",
      item: { kind: "stream", token: "s1", name: "g.pkg", size: null },
    });
  });

  it("reads copy results and errors by token", () => {
    expect(
      parseShareEvent({ kind: "copied", value: "/cache/s1/g.pkg", token: "s1", size: 5 }),
    ).toEqual({ type: "copied", token: "s1", path: "/cache/s1/g.pkg", name: "g.pkg", size: 5 });
    expect(parseShareEvent({ kind: "error", value: "too_large", token: "s1" })).toEqual({
      type: "copy_error",
      token: "s1",
      code: "too_large",
    });
    expect(parseShareEvent({ kind: "error", value: "weird", token: "s1" })).toEqual({
      type: "copy_error",
      token: "s1",
      code: "copy_failed",
    });
  });

  it("drops malformed entries", () => {
    expect(parseShareEvent(null)).toBeNull();
    expect(parseShareEvent({ kind: "path" })).toBeNull();
    expect(parseShareEvent({ kind: "copied", value: "/x" })).toBeNull();
    expect(parseShareEvent({ kind: "nope", value: "x" })).toBeNull();
  });
});

describe("parseShareQueue", () => {
  it("parses the shell's JSON array and survives junk", () => {
    expect(parseShareQueue("")).toEqual([]);
    expect(parseShareQueue("not json")).toEqual([]);
    expect(parseShareQueue("{}")).toEqual([]);
    expect(
      parseShareQueue(JSON.stringify([{ kind: "text", value: "https://a.b/c" }, { kind: "x" }])),
    ).toHaveLength(1);
  });
});

describe("pathItems", () => {
  it("makes items from desktop paths", () => {
    expect(pathItems(["C:\\Games\\a.pkg", "", 3])).toEqual([
      { kind: "path", path: "C:\\Games\\a.pkg", name: "a.pkg", size: null },
    ]);
    expect(pathItems(null)).toEqual([]);
  });
});

describe("shareTarget", () => {
  const path = (p: string) => ({ kind: "path" as const, path: p, name: "x", size: null });
  const stream = (name: string) => ({ kind: "stream" as const, token: "s", name, size: null });

  it("routes by the file's name", () => {
    expect(shareTarget({ kind: "url", url: "https://a" })).toBe("link");
    expect(shareTarget({ kind: "text", text: "hi" })).toBe("no_link");
    expect(shareTarget(path("/d/Game.PKG"))).toBe("package");
    expect(shareTarget(path("/d/game.fpkg"))).toBe("package");
    expect(shareTarget(path("/d/game.zip"))).toBe("archive");
    expect(shareTarget(path("/d/game.part1.rar"))).toBe("archive");
    expect(shareTarget(path("/d/game.part2.rar"))).toBe("unsupported");
    expect(shareTarget(path("/d/photo.jpg"))).toBe("unsupported");
  });

  it("does not start a RAR set from a lone streamed part", () => {
    expect(shareTarget(stream("game.pkg"))).toBe("package");
    expect(shareTarget(stream("game.7z"))).toBe("archive");
    expect(shareTarget(stream("game.rar"))).toBe("archive");
    expect(shareTarget(stream("game.part1.rar"))).toBe("unsupported");
  });
});

describe("copyDecision", () => {
  it("copies up to the limit, and tries an unknown size", () => {
    expect(copyDecision(1024)).toBe("copy");
    expect(copyDecision(SHARE_COPY_LIMIT)).toBe("copy");
    expect(copyDecision(SHARE_COPY_LIMIT + 1)).toBe("too_large");
    expect(copyDecision(null)).toBe("copy");
    expect(copyDecision(11, 10)).toBe("too_large");
  });
});
