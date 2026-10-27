import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import type { InstalledTitle } from "../../api/ps5";
import { recentlyPlayed, RecentlyPlayedStrip } from "./RecentlyPlayed";

const title = (titleId: string, titleName: string, system = false): InstalledTitle => ({
  titleId,
  titleName,
  origin: "pkg",
  imageBacked: false,
  source: "",
  system,
});

const titles = [
  title("PPSA00001", "Astro"),
  title("PPSA00002", "Never played"),
  title("PPSA00003", "Running now"),
  title("NPXS00001", "Settings", true),
  title("CUSA00004", "Older"),
];
const play: Record<string, { seconds: number | undefined; lastSeenMs: number | undefined }> = {
  PPSA00001: { seconds: 3600, lastSeenMs: 3_000 },
  PPSA00003: { seconds: 60, lastSeenMs: 4_000 },
  NPXS00001: { seconds: 10, lastSeenMs: 5_000 },
  CUSA00004: { seconds: undefined, lastSeenMs: 1_000 },
};
const playOf = (id: string) => play[id] ?? { seconds: undefined, lastSeenMs: undefined };

describe("Recently played", () => {
  it("lists played games newest first, without system apps, unplayed or running titles", () => {
    const rows = recentlyPlayed(titles, playOf, new Set(["PPSA00003"]));
    expect(rows.map((r) => r.title.titleId)).toEqual(["PPSA00001", "CUSA00004"]);
  });

  it("keeps to the limit", () => {
    expect(recentlyPlayed(titles, playOf, new Set(), 1).map((r) => r.title.titleId)).toEqual(["PPSA00003"]);
  });

  it("links each game to its page, and offers Reset only when the helper answered", () => {
    const items = recentlyPlayed(titles, playOf, new Set());
    const render = (canReset: boolean) =>
      renderToStaticMarkup(
        <MemoryRouter>
          <RecentlyPlayedStrip host="192.168.1.100" items={items} canReset={canReset} />
        </MemoryRouter>,
      );
    const out = render(true);
    expect(out).toContain("Recently played");
    expect(out).toContain('href="/games/PPSA00001"');
    expect(out).toContain("Reset play time");
    expect(render(false)).not.toContain("Reset play time");
  });

  it("renders nothing when nothing was played", () => {
    const out = renderToStaticMarkup(
      <MemoryRouter>
        <RecentlyPlayedStrip host="192.168.1.100" items={[]} canReset />
      </MemoryRouter>,
    );
    expect(out).toBe("");
  });
});
