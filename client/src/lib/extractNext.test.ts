import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { judgeExtracted } from "./extractNext";

const f = (name: string) => ({ name, kind: "file" as const, size: 1 });
const d = (name: string) => ({ name, kind: "dir" as const, size: 0 });

describe("judgeExtracted", () => {
  it("counts packages at the top", async () => {
    expect(await judgeExtracted([f("a.pkg"), f("b.PKG"), f("readme.txt")], async () => [])).toEqual({ packages: 2, game: false });
  });
  it("knows a game folder at the top or one folder down", async () => {
    expect(await judgeExtracted([d("sce_sys"), f("eboot.bin")], async () => [])).toEqual({ packages: 0, game: true });
    expect(await judgeExtracted([d("Game")], async () => [d("sce_sys"), f("eboot.bin")])).toEqual({ packages: 0, game: true });
  });
  it("says nothing for anything else", async () => {
    expect(await judgeExtracted([d("a"), d("b")], async () => [d("sce_sys")])).toEqual({ packages: 0, game: false });
    expect(await judgeExtracted([d("Game")], async () => { throw new Error("gone"); })).toEqual({ packages: 0, game: false });
  });
});
