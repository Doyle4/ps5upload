import { describe, expect, it, vi } from "vitest";

import { NOOP_RELOAD, registerSettingReload, reloadSettings } from "./liveSettings";

describe("live settings", () => {
  it("re-reads each store once however many of its keys changed", () => {
    const reload = vi.fn();
    registerSettingReload(["ps5upload.t.a", "ps5upload.t.b"], reload);
    expect(reloadSettings(["ps5upload.t.a", "ps5upload.t.b"])).toEqual([]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("names the keys no loaded store claims, and a failing reload", () => {
    registerSettingReload(["ps5upload.t.c"], NOOP_RELOAD);
    registerSettingReload(["ps5upload.t.bad"], () => {
      throw new Error("x");
    });
    expect(reloadSettings(["ps5upload.t.c", "ps5upload.t.none", "ps5upload.t.bad"])).toEqual([
      "ps5upload.t.none",
      "ps5upload.t.bad",
    ]);
  });
});
