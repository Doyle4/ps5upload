import { describe, expect, it } from "vitest";
import type { ScreenshotEntry } from "../../api/ps5";
import { sortCaptures, type CaptureSort } from "./sortCaptures";

const captures: ScreenshotEntry[] = [
  { path: "/photo/a.jxr", mtime: 100, size: 300 },
  { path: "/video/b.webm", mtime: 300, size: 100 },
  { path: "/photo/c.png", mtime: 200, size: 200 },
];

describe("capture sorting", () => {
  it.each<[CaptureSort, string[]]>([
    ["newest", ["/video/b.webm", "/photo/c.png", "/photo/a.jxr"]],
    ["oldest", ["/photo/a.jxr", "/photo/c.png", "/video/b.webm"]],
    ["smallest", ["/video/b.webm", "/photo/c.png", "/photo/a.jxr"]],
    ["biggest", ["/photo/a.jxr", "/photo/c.png", "/video/b.webm"]],
  ])("orders screenshots and clips by %s without mutating their source", (sort, expected) => {
    const original = [...captures];
    const result = sortCaptures(captures, sort);
    expect(result.map((item) => item.path)).toEqual(expected);
    expect(captures).toEqual(original);
    expect(result.every((item) => captures.includes(item))).toBe(true);
  });

  it.each<CaptureSort>(["newest", "oldest", "smallest", "biggest"])(
    "breaks ties consistently by path for %s", (sort) => {
      const tied = ["/b", "/a"].map((path) => ({ path, size: 0, mtime: 10 }));
      expect(sortCaptures(tied, sort).map((item) => item.path)).toEqual(["/a", "/b"]);
      expect(sortCaptures([], sort)).toEqual([]);
    },
  );

  it.each<CaptureSort>(["newest", "oldest"])("keeps unknown dates last for %s", (sort) => {
    const undated = [0, -1, NaN].map((mtime, i) => ({ path: `/unknown${i}`, size: 0, mtime }));
    const result = sortCaptures([...undated, ...captures], sort);
    expect(result.slice(-3)).toEqual(undated);
  });
});
