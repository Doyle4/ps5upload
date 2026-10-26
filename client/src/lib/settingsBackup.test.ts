import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyBundle, buildBundle, consoleDocName, trimBundle, type Bundle } from "./settingsBackup";

// The node test environment has no window: a small in-memory localStorage (as fsLastPath.test).
function installLocalStorageStub() {
  const store = new globalThis.Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

describe("settings bundles", () => {
  beforeEach(installLocalStorageStub);
  afterEach(() => vi.unstubAllGlobals());

  it("take only the app's keys, and never their own bookkeeping", () => {
    window.localStorage.setItem("ps5upload.theme", "dark");
    window.localStorage.setItem("other.app", "x");
    window.localStorage.setItem("ps5upload.settings_backup.last_auto.v1", "1");
    const b = buildBundle("daily", "Mac");
    expect(b.local_storage).toEqual({ "ps5upload.theme": "dark" });
    expect(b.meta).toMatchObject({ schema: 1, reason: "daily", device: "Mac" });
  });

  it("restore writes our namespace only and refuses what is not a bundle", () => {
    const n = applyBundle({
      meta: {},
      local_storage: { "ps5upload.a": "1", "ps5upload.b": null, "evil.key": "x" },
    });
    expect(n).toBe(2);
    expect(window.localStorage.getItem("ps5upload.a")).toBe("1");
    expect(window.localStorage.getItem("evil.key")).toBeNull();
    expect(() => applyBundle({ nope: 1 })).toThrow();
    expect(() => applyBundle({ local_storage: { "ps5upload.c": 5 } })).toThrow();
    // Nothing was written by the refused one.
    expect(window.localStorage.getItem("ps5upload.c")).toBeNull();
  });

  it("the console copy drops the largest values first to fit", () => {
    const b: Bundle = {
      meta: { generated_at_ms: 1, schema: 1 },
      local_storage: { "ps5upload.small": "s", "ps5upload.big": "x".repeat(5000), "ps5upload.mid": "y".repeat(500) },
    };
    const t = trimBundle(b, 2000);
    expect(Object.keys(t.local_storage).sort()).toEqual(["ps5upload.mid", "ps5upload.small"]);
    expect(t.meta.dropped).toEqual(["ps5upload.big"]);
  });

  it("console document names stay within the helper's rules", () => {
    const n = consoleDocName("AB12cd34".repeat(8));
    expect(n).toMatch(/^[a-z0-9_-]{1,40}$/);
  });
});
