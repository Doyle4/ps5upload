import { beforeEach, describe, expect, it, vi } from "vitest";

const HIDDEN_KEY = "ps5upload.desktop-sidebar.hidden.v1";
const CLOSED_KEY = "ps5upload.desktop-sidebar.closed-sections.v1";
const PINNED_KEY = "ps5upload.desktop-sidebar.pinned.v1";

// Plain-node environment: stand up localStorage by hand (see navItems/safeStorage).
function installStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
    },
  };
  return map;
}

/** The store reads storage at module load: seed, then re-import. */
async function freshStore() {
  vi.resetModules();
  return (await import("./navSidebar")).useNavSidebarStore;
}

beforeEach(() => {
  installStorage();
});

describe("the sidebar's hidden screens", () => {
  it("starts with nothing hidden and every section open", async () => {
    const s = (await freshStore()).getState();
    expect(s.hidden).toEqual([]);
    expect(s.closedSections).toEqual([]);
  });

  it("hides and shows a screen, and remembers it across a relaunch", async () => {
    const storage = installStorage();
    const store = await freshStore();
    store.getState().toggleHidden("/cheats");
    expect(store.getState().hidden).toContain("/cheats");
    expect(JSON.parse(storage.get(HIDDEN_KEY)!)).toEqual(["/cheats"]);
    const again = await freshStore();
    expect(again.getState().hidden).toEqual(["/cheats"]);
    again.getState().toggleHidden("/cheats");
    expect(again.getState().hidden).toEqual([]);
  });

  it("collapses a section and remembers it", async () => {
    const storage = installStorage();
    const store = await freshStore();
    store.getState().toggleSection("nav_section_diagnostics");
    expect(store.getState().closedSections).toEqual(["nav_section_diagnostics"]);
    expect(JSON.parse(storage.get(CLOSED_KEY)!)).toEqual(["nav_section_diagnostics"]);
    store.getState().toggleSection("nav_section_diagnostics");
    expect(store.getState().closedSections).toEqual([]);
  });

  it("treats a damaged stored value as nothing hidden", async () => {
    installStorage({ [HIDDEN_KEY]: "{not json", [CLOSED_KEY]: JSON.stringify([1, "nav_section_help"]) });
    const s = (await freshStore()).getState();
    expect(s.hidden).toEqual([]);
    expect(s.closedSections).toEqual(["nav_section_help"]);
  });

  it("takes the settings-file mirror's lists at start-up", async () => {
    const store = await freshStore();
    store.getState().setAll(["/shell", 7 as unknown as string], ["nav_section_advanced"]);
    expect(store.getState().hidden).toEqual(["/shell"]);
    expect(store.getState().closedSections).toEqual(["nav_section_advanced"]);
  });
});

describe("the sidebar's pinned screens", () => {
  it("starts with nothing pinned", async () => {
    expect((await freshStore()).getState().pinned).toEqual([]);
  });

  it("pins in pin order, unpins, and remembers it across a relaunch", async () => {
    const storage = installStorage();
    const store = await freshStore();
    store.getState().togglePinned("/files");
    store.getState().togglePinned("/upload");
    store.getState().togglePinned("/processes");
    expect(store.getState().pinned).toEqual(["/files", "/upload", "/processes"]);
    expect(JSON.parse(storage.get(PINNED_KEY)!)).toEqual(["/files", "/upload", "/processes"]);
    store.getState().togglePinned("/upload");
    expect(store.getState().pinned).toEqual(["/files", "/processes"]);
    const again = await freshStore();
    expect(again.getState().pinned).toEqual(["/files", "/processes"]);
  });

  it("moves a pin up and down, and by drag to a place, never past the ends", async () => {
    const store = await freshStore();
    for (const to of ["/files", "/upload", "/convert"]) store.getState().togglePinned(to);
    store.getState().movePinned("/convert", -1);
    expect(store.getState().pinned).toEqual(["/files", "/convert", "/upload"]);
    store.getState().movePinned("/files", -1);
    expect(store.getState().pinned).toEqual(["/files", "/convert", "/upload"]);
    store.getState().movePinned("/upload", 1);
    expect(store.getState().pinned).toEqual(["/files", "/convert", "/upload"]);
    store.getState().movePinnedTo("/upload", 0);
    expect(store.getState().pinned).toEqual(["/upload", "/files", "/convert"]);
    store.getState().movePinnedTo("/upload", 99);
    expect(store.getState().pinned).toEqual(["/files", "/convert", "/upload"]);
  });

  it("pins at most twelve, and only real screens other than Home and Bug report", async () => {
    const { NAV_ITEMS, MAX_PINNED } = await import("../layout/navItems");
    const store = await freshStore();
    const screens = NAV_ITEMS.map((i) => i.to);
    for (const to of screens.slice(0, MAX_PINNED + 2)) store.getState().togglePinned(to);
    expect(store.getState().pinned).toEqual(screens.slice(0, MAX_PINNED));
    // Full: unpinning still works and frees a place.
    store.getState().togglePinned(screens[0]);
    store.getState().togglePinned(screens[MAX_PINNED]);
    expect(store.getState().pinned).toHaveLength(MAX_PINNED);
    expect(store.getState().pinned[MAX_PINNED - 1]).toBe(screens[MAX_PINNED]);
    installStorage();
    const empty = await freshStore();
    for (const to of ["/home", "/bug-report", "/no-such-screen"]) empty.getState().togglePinned(to);
    expect(empty.getState().pinned).toEqual([]);
  });

  it("drops unknown, removed, repeated and junk ids on load", async () => {
    installStorage({
      [PINNED_KEY]: JSON.stringify(["/files", "/favorites-old", 4, "/files", "/home", "/upload"]),
    });
    expect((await freshStore()).getState().pinned).toEqual(["/files", "/upload"]);
  });

  it("keeps a pinned screen pinned when it is hidden (Pinned overrides hidden)", async () => {
    const store = await freshStore();
    store.getState().togglePinned("/cheats");
    store.getState().toggleHidden("/cheats");
    expect(store.getState().pinned).toEqual(["/cheats"]);
    expect(store.getState().hidden).toEqual(["/cheats"]);
  });

  it("takes the settings-file mirror's pins, and keeps its own when the file has none", async () => {
    const storage = installStorage();
    const store = await freshStore();
    store.getState().togglePinned("/files");
    // A file from before pinning: no `pinned` list.
    store.getState().setAll([], []);
    expect(store.getState().pinned).toEqual(["/files"]);
    store.getState().setAll([], [], ["/convert", "/gone", "/files"]);
    expect(store.getState().pinned).toEqual(["/convert", "/files"]);
    expect(JSON.parse(storage.get(PINNED_KEY)!)).toEqual(["/convert", "/files"]);
  });

  it("counts only the shown pins toward twelve", async () => {
    const { NAV_ITEMS, MAX_PINNED } = await import("../layout/navItems");
    const store = await freshStore();
    const screens = NAV_ITEMS.map((i) => i.to);
    for (const to of screens.slice(0, MAX_PINNED)) store.getState().togglePinned(to);
    // One of them isn't shown now (say a beta screen with beta off): there is room for one more.
    const shown = screens.slice(1, MAX_PINNED);
    store.getState().togglePinned(screens[MAX_PINNED], shown);
    expect(store.getState().pinned).toHaveLength(MAX_PINNED + 1);
    // Now twelve shown: full again.
    store.getState().togglePinned(screens[MAX_PINNED + 1], [...shown, screens[MAX_PINNED]]);
    expect(store.getState().pinned).toHaveLength(MAX_PINNED + 1);
    // And all thirteen survive a relaunch.
    expect((await freshStore()).getState().pinned).toHaveLength(MAX_PINNED + 1);
  });

  it("steps a move over pins that aren't shown, so every press visibly moves", async () => {
    const store = await freshStore();
    for (const to of ["/files", "/cheats", "/upload"]) store.getState().togglePinned(to);
    const shown = ["/files", "/upload"];
    store.getState().movePinned("/upload", -1, shown);
    expect(store.getState().pinned).toEqual(["/upload", "/files", "/cheats"]);
    store.getState().movePinned("/upload", 1, shown);
    expect(store.getState().pinned).toEqual(["/files", "/upload", "/cheats"]);
    // Already last among the shown: nothing to do.
    store.getState().movePinned("/upload", 1, shown);
    expect(store.getState().pinned).toEqual(["/files", "/upload", "/cheats"]);
  });
});
