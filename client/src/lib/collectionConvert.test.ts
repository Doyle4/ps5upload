import { describe, expect, it } from "vitest";
import type { CollectionLocation } from "../api/collection";
import { bestConvertible, isConvertible } from "./collectionConvert";

const loc = (
  type: string,
  size: number,
  extra: Partial<CollectionLocation> = {},
): CollectionLocation => ({
  root: "/g",
  container: "",
  name: type,
  type,
  path: `${type}-${size}`,
  absolute_path: `/g/${type}-${size}`,
  size_bytes: size,
  added_ts: 0,
  ...extra,
});

describe("collectionConvert", () => {
  it("takes folders, images, archives and base packages, never updates or DLC", () => {
    for (const t of [
      "folder",
      "mount.exfat",
      "mount.ffpkg",
      "mount.ffpfsc",
      "zip",
      "7z",
      "rar",
    ]) {
      expect(isConvertible(loc(t, 1))).toBe(true);
    }
    expect(isConvertible(loc("pkg", 1, { pkg: { kind: "base" } }))).toBe(true);
    expect(isConvertible(loc("pkg", 1))).toBe(true); // kind unknown: let Convert decide
    expect(isConvertible(loc("pkg", 1, { pkg: { kind: "patch" } }))).toBe(
      false,
    );
    expect(isConvertible(loc("pkg", 1, { pkg: { kind: "dlc" } }))).toBe(false);
  });

  it("offers a folder before an image, archive or package, and the largest of a kind", () => {
    const best = bestConvertible([
      loc("pkg", 90, { pkg: { kind: "base" } }),
      loc("zip", 80),
      loc("mount.ffpkg", 70),
      loc("folder", 10),
      loc("folder", 60),
    ]);
    expect(best?.path).toBe("folder-60");
  });

  it("prefers a copy on this computer over one on a saved server", () => {
    const best = bestConvertible([
      loc("folder", 99, { absolute_path: "remote://nas/games/x" }),
      loc("folder", 10),
    ]);
    expect(best?.absolute_path).toBe("/g/folder-10");
  });

  it("has nothing to offer for only an update", () => {
    expect(
      bestConvertible([loc("pkg", 5, { pkg: { kind: "patch" } })]),
    ).toBeNull();
  });
});
