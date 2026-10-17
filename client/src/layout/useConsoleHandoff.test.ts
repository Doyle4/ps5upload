import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFsNavStore, openInFileSystem } from "../state/fsNavigation";
import { createHandoffPoller, HANDOFF_POLL_FILES_MS } from "./useConsoleHandoff";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Show on PC: the handoff poll", () => {
  it("asks at once, then every delay, and opens a waiting folder", async () => {
    const take = vi
      .fn()
      .mockResolvedValueOnce({ supported: true, path: null, ageMs: 0 })
      .mockResolvedValueOnce({ supported: true, path: "/mnt/usb0/games", ageMs: 800 })
      .mockResolvedValue({ supported: true, path: null, ageMs: 0 });
    const onPath = vi.fn();
    const p = createHandoffPoller({ take, delay: () => HANDOFF_POLL_FILES_MS, onPath });
    await vi.advanceTimersByTimeAsync(0);
    expect(take).toHaveBeenCalledTimes(1);
    expect(onPath).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HANDOFF_POLL_FILES_MS);
    expect(take).toHaveBeenCalledTimes(2);
    expect(onPath).toHaveBeenCalledWith("/mnt/usb0/games");
    await vi.advanceTimersByTimeAsync(HANDOFF_POLL_FILES_MS);
    expect(take).toHaveBeenCalledTimes(3);
    expect(onPath).toHaveBeenCalledTimes(1);
    p.stop();
    await vi.advanceTimersByTimeAsync(HANDOFF_POLL_FILES_MS * 3);
    expect(take).toHaveBeenCalledTimes(3);
  });

  it("stops for good against an older helper", async () => {
    const take = vi.fn().mockResolvedValue({ supported: false });
    const onUnsupported = vi.fn();
    createHandoffPoller({ take, delay: () => 1000, onPath: vi.fn(), onUnsupported });
    await vi.advanceTimersByTimeAsync(5000);
    expect(take).toHaveBeenCalledTimes(1);
    expect(onUnsupported).toHaveBeenCalledOnce();
  });

  it("a failed ask is retried on the next tick", async () => {
    const take = vi
      .fn()
      .mockRejectedValueOnce(new Error("console busy"))
      .mockResolvedValueOnce({ supported: true, path: "/data", ageMs: 0 });
    const onPath = vi.fn();
    const p = createHandoffPoller({ take, delay: () => 1000, onPath });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onPath).toHaveBeenCalledWith("/data");
    p.stop();
  });

  it("the folder reaches File System as a one-shot request", () => {
    const navigate = vi.fn();
    openInFileSystem(navigate, "/mnt/usb0/games");
    expect(navigate).toHaveBeenCalledWith("/files");
    expect(useFsNavStore.getState().consume()).toBe("/mnt/usb0/games");
    expect(useFsNavStore.getState().consume()).toBeNull();
  });
});
