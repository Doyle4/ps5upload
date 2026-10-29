import { describe, expect, it, vi } from "vitest";

import { pickOrReport } from "./AddSources";

describe("pickOrReport", () => {
  it("reports a pick that failed instead of swallowing it", async () => {
    const report = vi.fn();
    const out = await pickOrReport(() => Promise.reject(new Error("no dialog")), [] as string[], report);
    expect(out).toEqual([]);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("passes a pick (or a cancel, which resolves empty) through without a report", async () => {
    const report = vi.fn();
    expect(await pickOrReport(() => Promise.resolve(["/a"]), [] as string[], report)).toEqual(["/a"]);
    expect(await pickOrReport<string | null>(() => Promise.resolve(null), null, report)).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });
});
