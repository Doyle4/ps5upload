import { describe, expect, it } from "vitest";

import type { CollectionGame } from "../../api/collection";
import type { InstalledTitle, LibraryEntry } from "../../api/ps5";
import { joinAllGames, rowMatches } from "./gamesJoin";

const installed = (titleId: string, titleName: string, extra: Partial<InstalledTitle> = {}): InstalledTitle => ({
  titleId,
  titleName,
  origin: "pkg",
  imageBacked: false,
  source: "",
  system: false,
  ...extra,
});
const entry = (path: string, extra: Partial<LibraryEntry> = {}): LibraryEntry =>
  ({ kind: "game", name: path.split("/").pop()!, path, volume: "/data", scope: "homebrew", size: 0, ...extra }) as LibraryEntry;
const game = (game_id: string, title: string): CollectionGame =>
  ({ game_id, title, platform: "PS5", sources: [], locations: [], total_size_bytes: 0, copies: 1, is_duplicate: false, added_ts: 0 }) as CollectionGame;

describe("Games' All list", () => {
  it("shows a game once, wherever its copies are", () => {
    const rows = joinAllGames({
      installed: [installed("PPSA01234", "Astro Bot")],
      storage: [entry("/data/homebrew/PPSA01234", { titleId: "ppsa01234" })],
      registeredBySource: new Map(),
      collection: [game("PPSA01234", "ASTRO BOT (EU)")],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ titleId: "PPSA01234", title: "Astro Bot", installed: true });
    expect(rows[0].storage).toHaveLength(1);
    expect(rows[0].computer?.game_id).toBe("PPSA01234");
  });

  it("names an image by what the console registered from it, and keeps unknown copies", () => {
    const rows = joinAllGames({
      installed: [],
      storage: [
        entry("/mnt/usb0/a.exfat", { kind: "image" as LibraryEntry["kind"] }),
        entry("/mnt/usb0/b.exfat", { kind: "image" as LibraryEntry["kind"] }),
      ],
      registeredBySource: new Map([["/mnt/usb0/a.exfat", { titleId: "PPSA00002", titleName: "Wolverine" }]]),
      collection: [],
    });
    expect(rows.map((r) => [r.titleId, r.title])).toEqual([
      ["PPSA00002", "Wolverine"],
      ["", "b.exfat"],
    ]);
  });

  it("puts installed games first, leaves system titles out, then sorts by title", () => {
    const rows = joinAllGames({
      installed: [installed("PPSA00003", "Zelda"), installed("NPXS40000", "Settings", { system: true })],
      storage: null,
      registeredBySource: new Map(),
      collection: [game("PPSA00001", "Alpha"), game("PPSA00002", "Beta")],
    });
    expect(rows.map((r) => r.titleId)).toEqual(["PPSA00003", "PPSA00001", "PPSA00002"]);
  });

  it("finds a game by title, title ID or file name", () => {
    const [row] = joinAllGames({
      installed: null,
      storage: [entry("/data/homebrew/Game-v1.exfat", { titleId: "PPSA00009" })],
      registeredBySource: new Map(),
      collection: [game("PPSA00009", "Ninth Game")],
    });
    expect(rowMatches(row, "ninth")).toBe(true);
    expect(rowMatches(row, "ppsa00009")).toBe(true);
    expect(rowMatches(row, "v1.exfat")).toBe(true);
    expect(rowMatches(row, "other")).toBe(false);
    expect(rowMatches(row, "  ")).toBe(true);
  });
});
