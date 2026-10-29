import { beforeEach, expect, it, vi } from "vitest";
import { useFsUploadStore, type FsUploadDeps, type FsUploadRequest } from "./fsUpload";
import { drainFsUploadQueue, enqueueFsUpload, fsUploadQueueFor, fsUploadReservations, pauseFsUploadQueue, removeFsUploadQueued, resumeFsUploadQueue, useFsUploadQueue } from "./fsUploadQueue";

const host = "192.0.2.22";
const request = (name: string, destDir = "/data/a"): FsUploadRequest => ({
  host, addr: host, destDir, srcPaths: [], steps: [{ kind: "one", src: `/pc/${name}`, name }],
});
function engine() {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const startFile = vi.fn<FsUploadDeps["startFile"]>(async () => "job");
  const deps: FsUploadDeps = {
    pathKind: async () => "file", startFile, startDir: startFile,
    jobStatus: async () => { await gate; return { status: "done" }; },
    jobCancel: async () => {}, sleep: async () => {}, listDir: async () => [],
  };
  return { deps, startFile, release };
}
beforeEach(() => {
  useFsUploadQueue.setState({ byHost: {} });
  useFsUploadStore.setState({ byHost: {} });
});

it("serializes picks and keeps each destination and queued name reservation", async () => {
  const e = engine();
  enqueueFsUpload(request("one"), e.deps, []);
  const second = enqueueFsUpload(request("two", "/data/b"), e.deps, []);
  await vi.waitFor(() => expect(e.startFile).toHaveBeenCalledTimes(1));
  expect(fsUploadReservations(host, "/data/b").map((x) => x.name)).toEqual(["two"]);
  expect(fsUploadQueueFor(host).items[1].id).toBe(second);
  e.release();
  await vi.waitFor(() => expect(fsUploadQueueFor(host).items).toHaveLength(0));
  expect(e.startFile.mock.calls.map((c) => c[1])).toEqual(["/data/a/one", "/data/b/two"]);
});

it("allows removing a waiting pick without touching the active pick", async () => {
  const e = engine();
  const first = enqueueFsUpload(request("one"), e.deps, []);
  const second = enqueueFsUpload(request("two"), e.deps, []);
  removeFsUploadQueued(host, first);
  removeFsUploadQueued(host, second);
  expect(fsUploadQueueFor(host).items.map((i) => i.id)).toEqual([first]);
  e.release();
  await vi.waitFor(() => expect(fsUploadQueueFor(host).items).toHaveLength(0));
});

it("pauses before overwriting a destination created while a pick waited", async () => {
  const e = engine();
  enqueueFsUpload(request("one"), e.deps, []);
  enqueueFsUpload(request("new.bin"), e.deps, []);
  pauseFsUploadQueue(host);
  e.release();
  await vi.waitFor(() => expect(fsUploadQueueFor(host).items).toHaveLength(1));
  e.deps.listDir = async () => [{ name: "new.bin", kind: "file", size: 8 }];
  resumeFsUploadQueue(host, e.deps);
  await vi.waitFor(() => expect(fsUploadQueueFor(host).error).toContain("Destination changed"));
  expect(e.startFile).toHaveBeenCalledTimes(1);
  expect(fsUploadQueueFor(host).items).toHaveLength(1);
  expect(fsUploadQueueFor(host).paused).toBe(true);
});

it("holds waiting picks while paused until explicitly resumed", async () => {
  const e = engine();
  enqueueFsUpload(request("one"), e.deps, []);
  enqueueFsUpload(request("two"), e.deps, []);
  pauseFsUploadQueue(host);
  e.release();
  await vi.waitFor(() => expect(fsUploadQueueFor(host).running).toBe(false));
  await drainFsUploadQueue(host, e.deps);
  expect(e.startFile).toHaveBeenCalledTimes(1);
  expect(fsUploadQueueFor(host).items.map((i) => i.request.steps?.[0])).toMatchObject([{ name: "two" }]);
  resumeFsUploadQueue(host, e.deps);
  await vi.waitFor(() => expect(fsUploadQueueFor(host).items).toHaveLength(0));
  expect(e.startFile).toHaveBeenCalledTimes(2);
});

it("a drop while paused joins the line: it never runs ahead of the waiting picks (#536)", async () => {
  const e = engine();
  enqueueFsUpload(request("one"), e.deps, []);
  enqueueFsUpload(request("two"), e.deps, []);
  pauseFsUploadQueue(host);
  e.release();
  await vi.waitFor(() => expect(fsUploadQueueFor(host).running).toBe(false));
  enqueueFsUpload(request("three"), e.deps, []);
  await new Promise((r) => setTimeout(r, 20));
  expect(e.startFile).toHaveBeenCalledTimes(1);
  resumeFsUploadQueue(host, e.deps);
  await vi.waitFor(() => expect(fsUploadQueueFor(host).items).toHaveLength(0));
  expect(e.startFile.mock.calls.map((c) => c[1])).toEqual(["/data/a/one", "/data/a/two", "/data/a/three"]);
});

it("starts the first drop at once when a pause outlived the picks it held", async () => {
  // A cancelled or failed copy pauses the queue; once nothing waits, the next pick must run.
  const e = engine();
  e.release();
  pauseFsUploadQueue(host);
  enqueueFsUpload(request("next.bin"), e.deps, []);
  await vi.waitFor(() => expect(e.startFile).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(fsUploadQueueFor(host).items).toHaveLength(0));
  expect(fsUploadQueueFor(host).paused).toBe(false);
});

it("starts the first drop after a restart that left an empty, paused queue", async () => {
  // The user's report: a saved slot (empty after the last session's copies) came back paused,
  // so the first drop of the session showed Queue · 1 with Resume instead of copying.
  const saved = new Map<string, string>([
    ["ps5upload.fsUploadQueue.v1", JSON.stringify({ [host]: { items: [], running: false, paused: true, error: null } })],
  ]);
  vi.stubGlobal("window", {
    localStorage: { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) },
  });
  try {
    vi.resetModules();
    const fresh = await import("./fsUploadQueue");
    const freshUpload = await import("./fsUpload");
    expect(fresh.fsUploadQueueFor(host).paused).toBe(false);
    const startFile = vi.fn<FsUploadDeps["startFile"]>(async () => "job");
    const deps: FsUploadDeps = {
      pathKind: async () => "file", startFile, startDir: startFile,
      jobStatus: async () => ({ status: "done" }), jobCancel: async () => {}, sleep: async () => {}, listDir: async () => [],
    };
    fresh.enqueueFsUpload(request("Resident Evil 2.pkg", "/mnt/usb0"), deps, []);
    await vi.waitFor(() => expect(startFile).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(fresh.fsUploadQueueFor(host).items).toHaveLength(0));
    expect(freshUpload.fsUploadForHost(freshUpload.useFsUploadStore.getState(), host).active).toBeFalsy();
  } finally { vi.unstubAllGlobals(); }
});

it("restores waiting picks paused and leaves the interrupted pick to Resume", async () => {
  const pending = request("waiting.bin");
  const interrupted = { ...request("active.bin"), queueId: "active" };
  const saved = new Map<string, string>([
    ["ps5upload.fsUpload.v1", JSON.stringify({ [host]: {
      ...interrupted, why: "interrupted", error: "", reason: null,
      name: "active.bin", count: 1, doneCount: 0,
    } })],
    ["ps5upload.fsUploadQueue.v1", JSON.stringify({ [host]: {
      items: [
        { id: "active", request: interrupted, allowedExisting: [] },
        { id: "waiting", request: pending, allowedExisting: [] },
      ], running: true, paused: false, error: null,
    } })],
  ]);
  vi.stubGlobal("window", {
    localStorage: { getItem: (k: string) => saved.get(k) ?? null,
      setItem: (k: string, v: string) => saved.set(k, v) },
  });
  try {
    vi.resetModules();
    const restored = await import("./fsUploadQueue");
    expect(restored.fsUploadQueueFor(host).items.map((i) => i.id)).toEqual(["waiting"]);
    expect(restored.fsUploadQueueFor(host).paused).toBe(true);
    expect(restored.fsUploadQueueFor(host).running).toBe(false);
  } finally { vi.unstubAllGlobals(); }
});
