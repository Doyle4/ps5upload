import { describe, expect, it } from "vitest";
import {
  archiveFolderName,
  extractCause,
  freeFolderName,
  isExtractableArchive,
  needsPassword,
  toExtractResult,
  validFolderName,
} from "./archiveName";

describe("isExtractableArchive", () => {
  it("accepts the single-file formats in any case", () => {
    for (const n of ["a.zip", "a.ZIPX", "a.7z", "a.rar", "a.tar", "a.tgz", "a.tbz", "a.tbz2", "a.txz", "a.tzst", "a.tar.gz", "a.gz", "a.bz2", "a.xz", "a.zst", "a.TAR.ZST"]) {
      expect(isExtractableArchive(n), n).toBe(true);
    }
  });
  it("offers only the first volume of a split archive", () => {
    expect(isExtractableArchive("g.part1.rar")).toBe(true);
    expect(isExtractableArchive("g.part01.rar")).toBe(true);
    expect(isExtractableArchive("g.part001.rar")).toBe(true);
    expect(isExtractableArchive("g.part2.rar")).toBe(false);
    expect(isExtractableArchive("g.part02.rar")).toBe(false);
    expect(isExtractableArchive("g.part10.rar")).toBe(false);
    expect(isExtractableArchive("g.7z.001")).toBe(true);
    expect(isExtractableArchive("g.zip.001")).toBe(true);
    expect(isExtractableArchive("g.001")).toBe(true);
    expect(isExtractableArchive("g.7z.002")).toBe(false);
    expect(isExtractableArchive("g.010")).toBe(false);
  });
  it("leaves other files (and .ffpfsc) alone", () => {
    for (const n of ["a.ffpfsc", "a.exfat", "a.pkg", "zip", "a.zip.txt", "a.rar5", "a.1"]) {
      expect(isExtractableArchive(n), n).toBe(false);
    }
  });
});

describe("archiveFolderName", () => {
  it("strips the archive extensions", () => {
    expect(archiveFolderName("Game.zip")).toBe("Game");
    expect(archiveFolderName("x.tar.gz")).toBe("x");
    expect(archiveFolderName("x.TAR.XZ")).toBe("x");
    expect(archiveFolderName("x.tgz")).toBe("x");
    expect(archiveFolderName("x.tar")).toBe("x");
    expect(archiveFolderName("x.7z.001")).toBe("x");
    expect(archiveFolderName("x.zip.001")).toBe("x");
    expect(archiveFolderName("x.001")).toBe("x");
    expect(archiveFolderName("x.part01.rar")).toBe("x");
    expect(archiveFolderName("x.part1.rar")).toBe("x");
    expect(archiveFolderName("x.rar")).toBe("x");
    expect(archiveFolderName("x.bin.gz")).toBe("x.bin");
    expect(archiveFolderName("My Game v1.02.7z")).toBe("My Game v1.02");
  });
  it("falls back when nothing is left", () => {
    expect(archiveFolderName(".zip")).toBe("extracted");
    expect(archiveFolderName("..zip")).toBe("extracted");
    expect(archiveFolderName(".tar.gz")).toBe("extracted");
  });
});

describe("folder names", () => {
  it("validates one plain name", () => {
    expect(validFolderName("a")).toBe(true);
    expect(validFolderName("")).toBe(false);
    expect(validFolderName(".")).toBe(false);
    expect(validFolderName("..")).toBe(false);
    expect(validFolderName("a/b")).toBe(false);
    expect(validFolderName("x".repeat(256))).toBe(false);
  });
  it("finds a free name", () => {
    const taken = new Set(["x", "x (2)"]);
    expect(freeFolderName("x", (n) => taken.has(n))).toBe("x (3)");
    expect(freeFolderName("y", (n) => taken.has(n))).toBe("y");
  });
});

describe("extract results and causes", () => {
  it("reads a result with defaults", () => {
    expect(toExtractResult({ path: "/data/x", files: 3, skipped: 1 })).toEqual({
      path: "/data/x",
      files: 3,
      dirs: 0,
      bytes: 0,
      skipped: 1,
      unsafe: 0,
      links: 0,
    });
    expect(toExtractResult(null).files).toBe(0);
  });
  it("finds the cause token", () => {
    expect(extractCause("fs_extract_no_space: needs 5 bytes, 1 free")).toBe("fs_extract_no_space");
    expect(extractCause("job failed: fs_extract_corrupt")).toBe("fs_extract_corrupt");
    expect(extractCause("other")).toBeNull();
    expect(needsPassword("fs_extract_password_required")).toBe(true);
    expect(needsPassword("fs_extract_wrong_password")).toBe(true);
    expect(needsPassword("fs_extract_rar_encrypted")).toBe(false);
  });
});
