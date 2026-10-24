import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyShareEvents,
  dismissFirstShare,
  startShareCopy,
  useIncomingShareStore,
} from "./incomingShare";

const reset = () =>
  useIncomingShareStore.setState({ queue: [], copying: null, copyError: null, approved: false });

describe("incoming share queue", () => {
  beforeEach(() => {
    reset();
    // Node has no window; the Android shell's bridge hangs off it.
    vi.stubGlobal("window", {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queues items once each", () => {
    const item = { kind: "url" as const, url: "https://a.b/c.pkg" };
    applyShareEvents([{ type: "item", item }, { type: "item", item }]);
    expect(useIncomingShareStore.getState().queue).toEqual([item]);
    dismissFirstShare();
    expect(useIncomingShareStore.getState().queue).toEqual([]);
  });

  it("a copy the user asked for replaces the stream and is sent without asking again", () => {
    const bridge = { take: vi.fn(() => ""), copy: vi.fn(), cancel: vi.fn() };
    (window as Window & { PS5UploadShare?: unknown }).PS5UploadShare = bridge;
    applyShareEvents([
      { type: "item", item: { kind: "stream", token: "s1", name: "g.pkg", size: 5 } },
    ]);
    expect(startShareCopy("s1", 10)).toBe(true);
    expect(bridge.copy).toHaveBeenCalledWith("s1", 10);
    expect(useIncomingShareStore.getState().copying).toBe("s1");

    // A result for another token changes nothing.
    applyShareEvents([{ type: "copied", token: "s9", path: "/x", name: "x", size: 1 }]);
    expect(useIncomingShareStore.getState().queue[0].kind).toBe("stream");

    applyShareEvents([{ type: "copied", token: "s1", path: "/c/g.pkg", name: "g.pkg", size: 5 }]);
    const s = useIncomingShareStore.getState();
    expect(s.queue[0]).toEqual({
      kind: "path",
      path: "/c/g.pkg",
      name: "g.pkg",
      size: 5,
      copied: true,
    });
    expect(s.copying).toBeNull();
    expect(s.approved).toBe(true);
  });

  it("a failed copy says why; dismissing stops a running copy", () => {
    const bridge = { take: vi.fn(() => ""), copy: vi.fn(), cancel: vi.fn() };
    (window as Window & { PS5UploadShare?: unknown }).PS5UploadShare = bridge;
    applyShareEvents([
      { type: "item", item: { kind: "stream", token: "s2", name: "g.pkg", size: null } },
    ]);
    startShareCopy("s2", 10);
    applyShareEvents([{ type: "copy_error", token: "s2", code: "too_large" }]);
    expect(useIncomingShareStore.getState().copyError).toBe("too_large");
    expect(useIncomingShareStore.getState().copying).toBeNull();

    startShareCopy("s2", 10);
    dismissFirstShare();
    expect(bridge.cancel).toHaveBeenCalledWith("s2");
    expect(useIncomingShareStore.getState().queue).toEqual([]);
  });

  it("cannot copy without the Android shell", () => {
    expect(startShareCopy("s1", 10)).toBe(false);
  });
});
