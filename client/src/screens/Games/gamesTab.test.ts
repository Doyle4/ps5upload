import { describe, expect, it } from "vitest";

import { legacyGamesLink } from "./gamesTab";

describe("links to Games' old views", () => {
  const f = (q: string) => legacyGamesLink(new URLSearchParams(q));

  it("turns links to the old views into the grid filter that shows the same games", () => {
    expect(f("tab=ready")).toEqual({ filter: "installed", strip: true });
    expect(f("tab=ready&unplayed=1")).toEqual({
      filter: "unplayed",
      strip: true,
    });
    expect(f("tab=files")).toEqual({ filter: "drives", strip: true });
  });

  it("opens the grid for the old Dumps view, and leaves any other tab alone", () => {
    expect(f("tab=dumps")).toEqual({ filter: null, strip: true });
    expect(f("tab=all")).toEqual({ filter: null, strip: false });
  });

  it("reads a filter by name, the merged update/DLC filter from its old names", () => {
    expect(f("console=update")).toEqual({ filter: "addons", strip: true });
    expect(f("console=dlc")).toEqual({ filter: "addons", strip: true });
    expect(f("console=missing")).toEqual({ filter: "missing", strip: true });
  });

  it("leaves a plain link alone", () => {
    expect(f("")).toEqual({ filter: null, strip: false });
  });
});
