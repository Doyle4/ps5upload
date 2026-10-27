import { describe, expect, it } from "vitest";

import { filesViewLink, parseFilesView } from "./filesViews";

describe("Files views in the URL", () => {
  it("reads only the views Files has", () => {
    expect(parseFilesView("search")).toBe("search");
    expect(parseFilesView("space")).toBe("space");
    expect(parseFilesView("snapshots")).toBe("snapshots");
    expect(parseFilesView("backup")).toBeNull();
    expect(parseFilesView(null)).toBeNull();
  });

  it("links a game's files search and a folder's space map", () => {
    expect(filesViewLink("search", { title: "PPSA01234" })).toBe("/files?view=search&title=PPSA01234");
    expect(filesViewLink("search", { q: "*.pkg" })).toBe("/files?view=search&q=*.pkg");
    expect(filesViewLink("space", { path: "/user" })).toBe("/files?view=space&path=%2Fuser");
    expect(filesViewLink("snapshots")).toBe("/files?view=snapshots");
  });
});
