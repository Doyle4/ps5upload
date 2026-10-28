import { describe, expect, it } from "vitest";

import type { CollectionGame } from "../../api/collection";
import type { LibraryEntry } from "../../api/ps5";
import type { AllGamesRow } from "./gamesJoin";
import {
  consoleVolume,
  gameLocations,
  gamesWhereOf,
  rowIsIn,
} from "./gamesWhere";

const row = (over: Partial<AllGamesRow>): AllGamesRow => ({
  titleId: "PPSA01325",
  title: "Astro Bot",
  installed: false,
  consolePath: null,
  storage: [],
  computer: null,
  ...over,
});
const entry = (path: string) =>
  ({ path, name: path.split("/").pop() ?? "" }) as LibraryEntry;
const computer = (roots: string[]) =>
  ({
    game_id: "PPSA01325",
    title: "Astro Bot",
    copies: roots.length,
    locations: roots.map((root) => ({
      root,
      absolute_path: `${root}/Astro Bot`,
      path: "Astro Bot",
    })),
  }) as unknown as CollectionGame;

describe("Games' where filter", () => {
  it("reads ?where= and falls back to everywhere", () => {
    expect(gamesWhereOf("installed")).toBe("installed");
    expect(gamesWhereOf("drives")).toBe("drives");
    expect(gamesWhereOf("yours")).toBe("yours");
    expect(gamesWhereOf(null)).toBe("everywhere");
    expect(gamesWhereOf("files")).toBe("everywhere");
  });

  it("keeps a game in every place it has a copy", () => {
    const r = row({
      installed: true,
      storage: [entry("/mnt/ext0/games/x.exfat")],
    });
    expect(rowIsIn(r, "everywhere")).toBe(true);
    expect(rowIsIn(r, "installed")).toBe(true);
    expect(rowIsIn(r, "drives")).toBe(true);
    expect(rowIsIn(r, "yours")).toBe(false);
  });
});

describe("a game's places", () => {
  it("names the console volume a path is on", () => {
    expect(consoleVolume("/mnt/ext0/homebrew/x")).toBe("ext0");
    expect(consoleVolume("/mnt/usb0/x.exfat")).toBe("usb0");
    expect(consoleVolume("/data/homebrew/x")).toBe("");
  });

  it("lists installed, each drive, this computer and each server, counting copies", () => {
    const r = row({
      installed: true,
      storage: [entry("/mnt/ext0/a"), entry("/mnt/ext0/b"), entry("/data/c")],
      computer: computer([
        "/Volumes/Games",
        "/Users/me/PS5",
        "remote://nas1/media",
        "remote://gone/x",
      ]),
    });
    const names: Record<string, string> = { nas1: "Media NAS" };
    expect(gameLocations(r, (id) => names[id])).toEqual([
      { kind: "installed", label: "", count: 1 },
      { kind: "drive", label: "ext0", count: 2 },
      { kind: "drive", label: "", count: 1 },
      { kind: "computer", label: "", count: 2 },
      { kind: "server", label: "Media NAS", count: 1 },
      { kind: "server", label: "", count: 1 },
    ]);
  });

  it("has no places for a game it knows nothing about", () => {
    expect(gameLocations(row({}), () => undefined)).toEqual([]);
  });
});
