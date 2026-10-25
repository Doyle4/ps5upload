import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { notPlayedTitles } from "./NotPlayedCard";

const title = (titleId: string, system = false) => ({
  titleId,
  titleName: titleId,
  origin: "pkg" as const,
  imageBacked: false,
  source: "",
  system,
});

describe("notPlayedTitles", () => {
  it("lists titles with no play, never system ones", () => {
    const secs: Record<string, number> = { PPSA00001: 3600 };
    const out = notPlayedTitles(
      [title("PPSA00001"), title("PPSA00002"), title("NPXS40000", true), title("CUSA00003")],
      (id) => secs[id],
    );
    expect(out.map((t) => t.titleId)).toEqual(["PPSA00002", "CUSA00003"]);
  });
});
