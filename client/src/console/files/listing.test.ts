import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../api")>();
  return { ...real, call: vi.fn() };
});

import { call } from "../api";
import { statusText } from "./Files";
import {
  DEFAULT_VIEW,
  iconKind,
  invertShown,
  loadView,
  saveView,
  selectAllShown,
  sortEntries,
  statusOf,
  visibleEntries,
  type ViewPrefs,
} from "./listing";
import { createDirLoader, LIST_PAGE, type DirState, type Entry } from "./useDir";

const mockCall = vi.mocked(call);
const e = (name: string, kind: Entry["kind"] = "file", size = 1, mtime: number | null = 0): Entry => ({
  name,
  kind,
  size,
  mtime,
});
const names = (l: Entry[]) => l.map((x) => x.name);
const view = (over: Partial<ViewPrefs> = {}): ViewPrefs => ({ ...DEFAULT_VIEW, ...over });

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

beforeEach(() => {
  mockCall.mockReset();
  store.clear();
});

describe("sort", () => {
  it("sorts names naturally, case-insensitively, folders first", () => {
    const l = [e("file10"), e("File2"), e("b", "dir"), e("file1"), e("A", "dir"), e("ゲーム"), e("あ")];
    expect(names(sortEntries(l))).toEqual(["A", "b", "file1", "File2", "file10", "あ", "ゲーム"]);
  });

  it("keeps folders first when descending", () => {
    const l = [e("a"), e("z"), e("d1", "dir"), e("d2", "dir")];
    expect(names(sortEntries(l, "name", "desc"))).toEqual(["d2", "d1", "z", "a"]);
  });

  it("sorts by size and by date, ties by name", () => {
    const l = [e("big", "file", 900, 5), e("small", "file", 1, 9), e("mid", "file", 50, 1), e("tie", "file", 50, 1), e("d", "dir", 0, 99)];
    expect(names(sortEntries(l, "size", "asc"))).toEqual(["d", "small", "mid", "tie", "big"]);
    expect(names(sortEntries(l, "size", "desc"))).toEqual(["d", "big", "mid", "tie", "small"]);
    expect(names(sortEntries(l, "date", "desc"))).toEqual(["d", "small", "big", "mid", "tie"]);
    expect(names(sortEntries(l, "date", "asc"))).toEqual(["d", "mid", "tie", "big", "small"]);
  });

  it("remembers the sort and hidden toggle, never the filter, and survives bad storage", () => {
    saveView(view({ sort: "size", dir: "desc", hidden: true, filter: "x" }));
    expect(loadView()).toEqual({ sort: "size", dir: "desc", hidden: true, filter: "" });
    localStorage.setItem("ps5upload.files.view", "{broken");
    expect(loadView()).toEqual(DEFAULT_VIEW);
  });
});

describe("hidden and filter", () => {
  const l = [e(".cache", "dir"), e(".hidden"), e("Game.PKG"), e("notes.txt"), e("pkgs", "dir")];
  it("hides dot files by default and shows them on request", () => {
    expect(names(visibleEntries(l, view()))).toEqual(["pkgs", "Game.PKG", "notes.txt"]);
    expect(names(visibleEntries(l, view({ hidden: true })))).toEqual([".cache", "pkgs", ".hidden", "Game.PKG", "notes.txt"]);
  });
  it("filters by case-insensitive substring", () => {
    expect(names(visibleEntries(l, view({ filter: "PKG" })))).toEqual(["pkgs", "Game.PKG"]);
    expect(names(visibleEntries(l, view({ filter: "cache" })))).toEqual([]);
    expect(names(visibleEntries(l, view({ filter: "cache", hidden: true })))).toEqual([".cache"]);
  });
});

describe("icons", () => {
  it("maps types", () => {
    const k = (n: string, kind: Entry["kind"] = "file") => iconKind({ name: n, kind });
    expect(k("d", "dir")).toBe("folder");
    expect(k("a.PNG")).toBe("image");
    expect(k("a.log")).toBe("text");
    expect(k("a.ffpfsc")).toBe("disk");
    expect(k("a.pkg")).toBe("package");
    expect(k("eboot.bin")).toBe("exec");
    expect(k("a.7z")).toBe("archive");
    expect(k("a.mkv")).toBe("video");
    expect(k("noext")).toBe("other");
    expect(k(".png")).toBe("other");
  });
});

describe("selection and status", () => {
  const all = [e("a", "file", 100), e("b", "file", 200), e("c", "dir"), e("abc", "file", 5)];
  it("select all / none / invert follow the filter", () => {
    const shown = visibleEntries(all, view({ filter: "a" })); // a, abc
    expect(names(shown)).toEqual(["a", "abc"]);
    expect(selectAllShown(["b"], shown)).toEqual(["b", "a", "abc"]);
    expect(invertShown(["a", "b"], shown)).toEqual(["abc", "b"]);
    expect(invertShown([], shown)).toEqual(["a", "abc"]);
  });
  it("counts items, selected and bytes (folders add none)", () => {
    const shown = visibleEntries(all, view());
    const st = statusOf(shown, all.length, ["a", "c", "gone"], all);
    expect(st).toEqual({ items: 4, total: 4, selected: 2, bytes: 100, folders: 1 });
    expect(statusText(st)).toBe("4 items · 2 selected (100 B, folders not counted)");
    expect(statusText(statusOf(shown, 4, ["a", "b"], all))).toBe("4 items · 2 selected (300 B)");
    expect(statusText(statusOf(shown.slice(0, 2), 4, [], all))).toBe("2 of 4 items");
  });
});

describe("load all", () => {
  const serve = (pages: number) =>
    mockCall.mockImplementation(async (_r: string, body?: object) => {
      const { offset } = body as { offset: number };
      const entries = Array.from({ length: LIST_PAGE }, (_, i) => e(`f${offset + i}`));
      return { entries, more: offset / LIST_PAGE < pages - 1, next: offset + LIST_PAGE } as never;
    });

  it("reads every page, emitting once", async () => {
    serve(4);
    const seen: DirState[] = [];
    const l = createDirLoader("/d", (s) => seen.push(s));
    await l.loadMore();
    seen.length = 0;
    await l.loadAll(20_000);
    expect(mockCall).toHaveBeenCalledTimes(4);
    expect(seen.map((s) => s.loading)).toEqual([true, false]);
    expect(seen[1].entries).toHaveLength(1024);
    expect(seen[1].more).toBe(false);
  });

  it("stops at the cap and leaves more=true", async () => {
    serve(1000);
    let last: DirState | null = null;
    const l = createDirLoader("/d", (s) => (last = s));
    await l.loadAll(1000);
    expect(last!.entries).toHaveLength(1024);
    expect(last!.more).toBe(true);
  });
});

describe("20,000 entries", () => {
  it("sort + filter + select all + status stay fast", () => {
    const l: Entry[] = [];
    for (let i = 0; i < 20_000; i++) {
      l.push(e(`${i % 7 === 0 ? "." : ""}file_${(i * 7919) % 100003}_ゲーム.dat`, i % 50 === 0 ? "dir" : "file", (i * 31) % 9999, i));
    }
    const run = (v: ViewPrefs) => {
      const t0 = performance.now();
      const shown = visibleEntries(l, v);
      const sel = selectAllShown([], shown);
      const inv = invertShown(sel.slice(0, 100), shown);
      statusOf(shown, l.length, sel, l);
      return { ms: performance.now() - t0, shown, inv };
    };
    run(view({ hidden: true })); // warm-up: builds the sort keys
    const worst = Math.max(
      run(view({ hidden: true })).ms,
      run(view({ hidden: true, sort: "size", dir: "desc" })).ms,
      run(view({ hidden: true, filter: "_1" })).ms,
    );
    expect(run(view()).shown.length).toBeLessThan(20_000);
    expect(worst).toBeLessThan(80); // measured ~28 ms for sort+filter+select-all+status; slack for a loaded CI box
  });
});
