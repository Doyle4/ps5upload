import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetSourceArtForTests,
  busyServers,
  cancelSourceArt,
  downscaleIcon,
  queueArtSourcePath,
  requestSourceArt,
  shouldReadSourceArt,
  sourceArtFor,
  viewSourceArt,
  type SourceArt,
} from "./queueArt";
import type { QueueItem } from "../state/uploadQueue";

const art = (over: Partial<SourceArt> = {}): SourceArt => ({
  icon: "data:image/png;base64,AA==",
  title: "Game",
  contentId: "UP0000-PPSA00001_00-0000000000000000",
  titleId: "PPSA00001",
  size: 10,
  ...over,
});

/** A reader whose reads finish when the test says so. */
function controlledReader() {
  const pending = new Map<string, { resolve: (a: SourceArt) => void; reject: (e: Error) => void }>();
  const calls: string[] = [];
  const read = (path: string) =>
    new Promise<SourceArt>((resolve, reject) => {
      calls.push(path);
      pending.set(path, { resolve, reject });
    });
  return { read, calls, pending };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => __resetSourceArtForTests());

describe("which rows read their source", () => {
  const it_ = (over: Partial<QueueItem>) => ({ sourcePath: "", ...over }) as QueueItem;

  it("reads packages, images, game folders and streamed files, local or on a saved server", () => {
    expect(queueArtSourcePath(it_({ sourceKind: "pkg", sourcePath: "/pc/a.pkg" }))).toBe("/pc/a.pkg");
    expect(queueArtSourcePath(it_({ sourceKind: "image", sourcePath: "C:\\g\\a.ffpfsc" }))).toBe("C:\\g\\a.ffpfsc");
    expect(queueArtSourcePath(it_({ sourceKind: "game-folder", sourcePath: "/pc/PPSA00001" }))).toBe("/pc/PPSA00001");
    expect(
      queueArtSourcePath(
        it_({ sourceKind: "install", sourcePath: "pc:remote://nas/g.pkg", install: { via: "stream", source: "remote://nas/g.pkg" } }),
      ),
    ).toBe("remote://nas/g.pkg");
  });

  it("never reads a console path, a link, a plain file or an archive", () => {
    expect(queueArtSourcePath(it_({ sourceKind: "install", install: { via: "library", path: "/data/a.pkg" } }))).toBeNull();
    expect(queueArtSourcePath(it_({ sourceKind: "install", install: { via: "console-path", path: "/data/a.pkg" } }))).toBeNull();
    expect(
      queueArtSourcePath(
        it_({ sourceKind: "install", install: { via: "link", url: "https://x/a.pkg", mode: "stream", insecureTls: false } }),
      ),
    ).toBeNull();
    expect(queueArtSourcePath(it_({ sourceKind: "ps5", sourcePath: "/data/game" }))).toBeNull();
    expect(queueArtSourcePath(it_({ sourceKind: "file", sourcePath: "/pc/a.bin" }))).toBeNull();
    expect(queueArtSourcePath(it_({ sourceKind: "archive", sourcePath: "/pc/a.rar" }))).toBeNull();
  });

  it("reads only a waiting row on screen, and holds a server a transfer is reading from", () => {
    const busy = busyServers([
      { status: "running", sourceKind: "pkg", sourcePath: "remote://nas/x.pkg" } as QueueItem,
      { status: "pending", sourceKind: "pkg", sourcePath: "remote://other/y.pkg" } as QueueItem,
    ]);
    expect([...busy]).toEqual(["nas"]);
    const ok = { pending: true, visible: true, busy };
    expect(shouldReadSourceArt("/pc/a.pkg", ok)).toBe(true);
    expect(shouldReadSourceArt("remote://other/a.pkg", ok)).toBe(true);
    expect(shouldReadSourceArt("remote://nas/a.pkg", ok)).toBe(false);
    expect(shouldReadSourceArt("/pc/a.pkg", { ...ok, visible: false })).toBe(false);
    expect(shouldReadSourceArt("/pc/a.pkg", { ...ok, pending: false })).toBe(false);
    expect(shouldReadSourceArt(null, ok)).toBe(false);
    // #479: a row that started at once still shows its game, read from this computer only.
    const running = { pending: false, running: true, visible: true, busy };
    expect(shouldReadSourceArt("/pc/a.pkg", running)).toBe(true);
    expect(shouldReadSourceArt("remote://other/a.pkg", running)).toBe(false);
    expect(shouldReadSourceArt("/pc/a.pkg", { ...running, visible: false })).toBe(false);
  });
});

describe("reading source art", () => {
  it("reads at most two at a time and caches by path", async () => {
    const r = controlledReader();
    __resetSourceArtForTests(r.read);
    for (const p of ["/a.pkg", "/b.pkg", "/c.pkg", "/a.pkg"]) requestSourceArt(p);
    expect(r.calls).toEqual(["/a.pkg", "/b.pkg"]);
    r.pending.get("/a.pkg")!.resolve(art({ title: "A" }));
    await flush();
    expect(r.calls).toEqual(["/a.pkg", "/b.pkg", "/c.pkg"]);
    expect(sourceArtFor("/a.pkg")?.title).toBe("A");
    // Cached: asking again reads nothing.
    requestSourceArt("/a.pkg");
    expect(r.calls).toHaveLength(3);
  });

  it("reads one saved-server source at a time, letting local ones pass", async () => {
    const r = controlledReader();
    __resetSourceArtForTests(r.read);
    requestSourceArt("remote://nas/a.pkg");
    requestSourceArt("remote://nas/b.pkg");
    requestSourceArt("/pc/c.pkg");
    expect(r.calls).toEqual(["remote://nas/a.pkg", "/pc/c.pkg"]);
    r.pending.get("remote://nas/a.pkg")!.resolve(art());
    await flush();
    expect(r.calls).toEqual(["remote://nas/a.pkg", "/pc/c.pkg", "remote://nas/b.pkg"]);
  });

  it("drops a read that has not started when its row goes away", async () => {
    const r = controlledReader();
    __resetSourceArtForTests(r.read);
    for (const p of ["/a.pkg", "/b.pkg", "/c.pkg"]) requestSourceArt(p);
    cancelSourceArt("/c.pkg");
    r.pending.get("/a.pkg")!.resolve(art());
    await flush();
    expect(r.calls).toEqual(["/a.pkg", "/b.pkg"]);
  });

  it("never remembers a failed read as 'no art'", async () => {
    const r = controlledReader();
    __resetSourceArtForTests(r.read);
    requestSourceArt("/a.pkg");
    r.pending.get("/a.pkg")!.reject(new Error("engine away"));
    await flush();
    expect(sourceArtFor("/a.pkg")).toBeNull();
    // Not hammered right away…
    requestSourceArt("/a.pkg");
    expect(r.calls).toHaveLength(1);
    // …but tried again a minute later.
    const now = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
    requestSourceArt("/a.pkg");
    spy.mockRestore();
    expect(r.calls).toHaveLength(2);
  });

  it("one row going away does not cancel a read another row still wants", async () => {
    const r = controlledReader();
    __resetSourceArtForTests(r.read);
    for (const p of ["/a.pkg", "/b.pkg", "/c.pkg", "/c.pkg"]) requestSourceArt(p);
    cancelSourceArt("/c.pkg");
    r.pending.get("/a.pkg")!.resolve(art());
    await flush();
    expect(r.calls).toEqual(["/a.pkg", "/b.pkg", "/c.pkg"]);
  });

  it("keeps at most 100 results, dropping the oldest no row shows", async () => {
    __resetSourceArtForTests(async (p) => art({ title: p }));
    const release = viewSourceArt("/0.pkg");
    for (let i = 0; i < 105; i++) {
      requestSourceArt(`/${i}.pkg`);
      await flush();
    }
    // The shown one stays; the next-oldest unshown ones went.
    expect(sourceArtFor("/0.pkg")?.title).toBe("/0.pkg");
    expect(sourceArtFor("/1.pkg")).toBeNull();
    expect(sourceArtFor("/104.pkg")?.title).toBe("/104.pkg");
    release();
    requestSourceArt("/105.pkg");
    await flush();
    expect(sourceArtFor("/0.pkg")).toBeNull();
  });

  it("keeps the original icon where it cannot redraw it", async () => {
    expect(await downscaleIcon("data:image/png;base64,AA==", 96)).toBe("data:image/png;base64,AA==");
  });
});
