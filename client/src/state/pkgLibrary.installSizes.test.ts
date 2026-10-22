import { beforeEach, describe, expect, it, vi } from "vitest";

// Every install entry point hands the console queue the package's size when it knows it, so the
// queue's "to install" total stops undercounting (spec 2026-10-22 §2).
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../lib/tauriEnv", () => ({ isTauriEnv: () => true }));
vi.mock("../api/ps5", () => ({
  fsListDir: vi.fn(async () => []),
  fsDelete: vi.fn(async () => {}),
  fsMkdir: vi.fn(async () => {}),
  fsCopy: vi.fn(async () => {}),
  fsOpStatus: vi.fn(async () => ({ total_bytes: 0, bytes_copied: 0 })),
  pkgMetadataConsole: vi.fn(async () => null),
  toastPush: vi.fn(async () => ({ ok: true })),
  installFreeBytes: vi.fn(async () => 1_000_000_000_000),
  consoleReadiness: vi.fn(async () => true),
  pkgInstalledInventory: vi.fn(async () => []),
  pkgInstallPreflight: vi.fn(async () => null),
}));
vi.mock("../lib/ps5Transfers", () => ({ transferScreenBusy: () => false }));
vi.mock("./collection", () => ({ loadConsoleStates: vi.fn(async () => {}) }));

import { pkgLibraryStore } from "./pkgLibrary";
import { registerInstallEnqueuer, type EnqueueInstallInput } from "./consoleQueueBridge";
import { installOffers } from "../screens/GameHub/collectionInstall";

const HOST = "10.7.7.7";
let seen: EnqueueInstallInput[];

beforeEach(() => {
  seen = [];
  registerInstallEnqueuer((input) => {
    seen.push(input);
    return { id: `q${seen.length}`, done: Promise.resolve({ ok: true }) };
  });
  pkgLibraryStore(HOST).setState({ entries: [], installingAll: false });
});

const entry = (path: string, size: number, category = "gd") =>
  ({ path, size, status: "idle", title: path, category, contentId: "" }) as never;

describe("install sizes reach the queue", () => {
  it("a staged library package carries its size (install, retry with stream, install all)", async () => {
    const store = pkgLibraryStore(HOST);
    store.setState({ entries: [entry("/a.pkg", 1_000), entry("/b.pkg", 2_000, "gp")] });
    await store.getState().install("/a.pkg", HOST);
    await store.getState().retryWithStream("/b.pkg", HOST);
    expect(seen.map((s) => s.sizeBytes)).toEqual([1_000, 2_000]);
    seen = [];
    await store.getState().installAll(HOST);
    expect(seen.map((s) => [s.request, s.sizeBytes])).toEqual([
      [{ via: "library", path: "/a.pkg" }, 1_000],
      [{ via: "library", path: "/b.pkg" }, 2_000],
    ]);
  });

  it("an external package, a console path and a stream pass what their caller knew", async () => {
    const store = pkgLibraryStore(HOST);
    await store.getState().installExternal(
      { path: "/mnt/usb0/g.pkg", drive: "/mnt/usb0", name: "g.pkg", size: 3_000, contentId: "" } as never,
      HOST,
    );
    await store.getState().installFromConsolePath("/user/data/c.pkg", HOST, { sizeBytes: 4_000 });
    await store.getState().installFromConsolePath("/user/data/d.pkg", HOST);
    await store.getState().installStream("/pc/e.pkg", HOST, { sizeBytes: 5_000 });
    await store.getState().installStream("/pc/f.pkg", HOST);
    expect(seen.map((s) => s.sizeBytes ?? null)).toEqual([3_000, 4_000, null, 5_000, null]);
  });

  it("a link carries the probe's size", async () => {
    await pkgLibraryStore(HOST)
      .getState()
      .installUrl("https://example.com/g.pkg", HOST, { mode: "stream", sizeBytes: 6_000 });
    expect(seen).toHaveLength(1);
    expect(seen[0].request.via).toBe("link");
    expect(seen[0].sizeBytes).toBe(6_000);
  });

  it("a collection offer carries its file's size", () => {
    installOffers(HOST, [
      {
        game: { title: "G" },
        offer: { path: "/pc/g.pkg", size_bytes: 7_000, content_id: "", category: "gd", version: "" } as never,
      },
    ]);
    expect(seen.map((s) => s.sizeBytes)).toEqual([7_000]);
  });
});
