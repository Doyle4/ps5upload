import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../api")>();
  return { ...real, callBlob: vi.fn() };
});

import { callBlob } from "../api";
import { IMAGE_MAX, readUpTo, VIEW_MAX } from "./Viewer";

const mockBlob = vi.mocked(callBlob);

beforeEach(() => {
  mockBlob.mockReset();
});

describe("Viewer reads", () => {
  it("closing_after_the_first_chunk_issues_no_further_reads", async () => {
    const stop = new AbortController();
    mockBlob.mockImplementation(async () => {
      stop.abort(); // the viewer closes while the first 1 MiB is coming in
      return new Blob([new Uint8Array(VIEW_MAX)]);
    });
    await expect(readUpTo("/data/big.png", IMAGE_MAX, stop.signal)).rejects.toThrow();
    expect(mockBlob).toHaveBeenCalledTimes(1);
    // The signal reaches the request itself, so the one in flight is aborted too.
    expect(mockBlob.mock.calls[0][2]).toBe(stop.signal);
  });

  it("an image is read 1 MiB at a time until a short chunk", async () => {
    mockBlob
      .mockResolvedValueOnce(new Blob([new Uint8Array(VIEW_MAX)]))
      .mockResolvedValueOnce(new Blob([new Uint8Array(10)]));
    const b = await readUpTo("/data/a.png", IMAGE_MAX);
    expect(b.size).toBe(VIEW_MAX + 10);
    expect(mockBlob.mock.calls.map((c) => (c[1] as { offset: number }).offset)).toEqual([0, VIEW_MAX]);
  });

  it("text stops at 1 MiB", async () => {
    mockBlob.mockResolvedValue(new Blob([new Uint8Array(VIEW_MAX)]));
    await readUpTo("/data/a.log", VIEW_MAX);
    expect(mockBlob).toHaveBeenCalledTimes(1);
  });
});
