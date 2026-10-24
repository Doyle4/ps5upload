import { describe, expect, it } from "vitest";

import type {
  CollectionGame,
  CollectionLocation,
  CollectionOffer,
  GameConsoleState,
} from "../api/collection";
import {
  firmwareShortfall,
  gameMinFw,
  sendStep,
  shrinkCandidate,
  SHRINK_MIN_BYTES,
} from "./collectionInsights";
import { consoleCounts, filterCounts, viewGames } from "./collectionView";

const GB = 1024 ** 3;

function loc(
  type: string,
  over: Partial<CollectionLocation> = {},
  pkg: CollectionLocation["pkg"] = undefined,
): CollectionLocation {
  return {
    root: "/r",
    container: "",
    name: `${type}-${over.size_bytes ?? 1}`,
    type,
    path: type,
    absolute_path: `/r/${type}-${over.size_bytes ?? 1}`,
    size_bytes: 1,
    added_ts: 0,
    pkg,
    ...over,
  };
}

function game(
  locations: CollectionLocation[],
  over: Partial<CollectionGame> = {},
): CollectionGame {
  return {
    game_id: "PPSA01234",
    title: "Game",
    platform: "PS5",
    sources: [],
    locations,
    total_size_bytes: locations.reduce((n, l) => n + l.size_bytes, 0),
    copies: locations.length,
    is_duplicate: false,
    added_ts: 0,
    ...over,
  };
}

const offer = (category: string, version = "1.00"): CollectionOffer => ({
  path: `/r/${category}.pkg`,
  name: `${category}.pkg`,
  version,
  content_id: "",
  title: "",
  size_bytes: 1,
  category,
});

describe("firmware", () => {
  it("takes the lowest firmware any full copy asks for, never an update's", () => {
    const g = game([
      loc("folder", {}, { min_fw: "10.00" }),
      loc("pkg", {}, { kind: "base", min_fw: "7.00" }),
      loc("pkg", {}, { kind: "patch", min_fw: "4.00" }),
    ]);
    expect(gameMinFw(g)).toBe("7.00");
  });

  it("says nothing for a PS4 game: its firmware is a PS4's", () => {
    const g = game([loc("folder", {}, { min_fw: "9.00" })], {
      platform: "PS4",
    });
    expect(gameMinFw(g)).toBeNull();
    expect(firmwareShortfall(g, "5.10")).toBeNull();
  });

  it("is short only when the console is below what the game asks", () => {
    const g = game([loc("folder", {}, { min_fw: "10.00" })]);
    expect(firmwareShortfall(g, "9.60")).toBe("10.00");
    expect(firmwareShortfall(g, "10.00")).toBeNull();
    expect(firmwareShortfall(g, "13.60")).toBeNull();
    expect(firmwareShortfall(g, null)).toBeNull();
  });
});

describe("shrinkCandidate", () => {
  it("offers the largest local folder or plain image of a PS5 game", () => {
    const big = loc("folder", { size_bytes: SHRINK_MIN_BYTES + GB });
    const g = game([loc("mount.exfat", { size_bytes: SHRINK_MIN_BYTES }), big]);
    expect(shrinkCandidate(g)?.absolute_path).toBe(big.absolute_path);
  });

  it("offers nothing when it is small, already compressed, on a server, or not PS5", () => {
    const big = { size_bytes: SHRINK_MIN_BYTES + GB };
    expect(
      shrinkCandidate(game([loc("folder", { size_bytes: GB })])),
    ).toBeNull();
    expect(
      shrinkCandidate(game([loc("folder", big), loc("mount.ffpfsc")])),
    ).toBeNull();
    expect(
      shrinkCandidate(
        game([loc("folder", { ...big, absolute_path: "remote://nas/g" })]),
      ),
    ).toBeNull();
    expect(
      shrinkCandidate(game([loc("folder", big)], { platform: "PS4" })),
    ).toBeNull();
  });
});

describe("sendStep", () => {
  const st = (over: Partial<GameConsoleState>): GameConsoleState => ({
    game_id: "PPSA01234",
    installed: false,
    dlc_missing: [],
    non_package_copy: false,
    ...over,
  });

  it("brings an installed game up to date, or leaves it", () => {
    const g = game([loc("folder")]);
    const s = sendStep(
      g,
      st({ installed: true, update: offer("gp"), dlc_missing: [offer("ac")] }),
    );
    expect(s).toEqual({ kind: "install", offers: [offer("gp"), offer("ac")] });
    expect(sendStep(g, st({ installed: true }))).toEqual({
      kind: "skip",
      why: "up-to-date",
    });
  });

  it("installs the base package with its add-ons on a console that lacks it", () => {
    const s = sendStep(
      game([]),
      st({ base: offer("gd"), update: offer("gp") }),
    );
    expect(s).toEqual({ kind: "install", offers: [offer("gd"), offer("gp")] });
  });

  it("uploads a folder, image or archive when there is no package", () => {
    const folder = loc("folder");
    expect(
      sendStep(game([loc("zip"), folder]), st({ non_package_copy: true })),
    ).toEqual({
      kind: "upload",
      copy: folder,
    });
  });

  it("falls back to the newest base package when the console could not be read", () => {
    const old = loc(
      "pkg",
      { size_bytes: 2 },
      { kind: "base", version: "01.000.000" },
    );
    const fresh = loc(
      "pkg",
      { size_bytes: 3 },
      { kind: "base", version: "01.002.000" },
    );
    const s = sendStep(
      game([old, fresh, loc("pkg", {}, { kind: "patch" })]),
      undefined,
    );
    expect(s.kind).toBe("install");
    expect(s.kind === "install" && s.offers.map((o) => o.path)).toEqual([
      fresh.absolute_path,
    ]);
  });

  it("has nothing to send for an unreadable copy only", () => {
    const g = game([loc("folder", {}, { error: "no param" })]);
    expect(sendStep(g, undefined)).toEqual({
      kind: "skip",
      why: "nothing-to-send",
    });
  });
});

describe("Collection view: cheats, smaller, firmware, played", () => {
  const a = game(
    [loc("folder", { size_bytes: SHRINK_MIN_BYTES + GB }, { min_fw: "10.00" })],
    {
      game_id: "PPSA00001",
      title: "Alpha",
    },
  );
  const b = game([loc("mount.ffpfsc")], {
    game_id: "PPSA00002",
    title: "Beta",
  });
  const base = { search: "", platform: "all", sort: "title-asc" } as const;

  it("filters by cheats and by what could be smaller, and counts both", () => {
    const cheatIds = new Set(["PPSA00002"]);
    expect(
      viewGames([a, b], { ...base, filter: "cheats", cheatIds }).map(
        (g) => g.title,
      ),
    ).toEqual(["Beta"]);
    expect(
      viewGames([a, b], { ...base, filter: "smaller" }).map((g) => g.title),
    ).toEqual(["Alpha"]);
    const n = filterCounts([a, b], { cheatIds });
    expect([n.cheats, n.smaller]).toEqual([1, 1]);
  });

  it("filters and counts games that need newer firmware", () => {
    const q = {
      ...base,
      filter: "all" as const,
      console: "firmware" as const,
      consoleFw: "9.60",
    };
    expect(viewGames([a, b], q).map((g) => g.title)).toEqual(["Alpha"]);
    expect(consoleCounts([a, b], undefined, "9.60").firmware).toBe(1);
    expect(consoleCounts([a, b], undefined, null).firmware).toBe(0);
  });

  it("sorts recently played first, never-played last by title", () => {
    const c = game([], { game_id: "PPSA00003", title: "Gamma" });
    const played: Record<string, number> = { PPSA00003: 200, PPSA00002: 100 };
    const out = viewGames([a, b, c], {
      ...base,
      filter: "all",
      sort: "played-desc",
      lastPlayed: (id) => played[id],
    });
    expect(out.map((g) => g.title)).toEqual(["Gamma", "Beta", "Alpha"]);
  });
});
