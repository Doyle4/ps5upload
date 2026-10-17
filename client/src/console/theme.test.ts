import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyStoredTheme, getContrast, getTheme, setContrast, setTheme } from "./theme";

function stubDom(store: Record<string, string> | "refuse") {
  const attrs = new Map<string, string>();
  vi.stubGlobal("document", {
    documentElement: {
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
      getAttribute: (k: string) => attrs.get(k) ?? null,
    },
  });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => {
      if (store === "refuse") throw new Error("denied");
      return store[k] ?? null;
    },
    setItem: (k: string, v: string) => {
      if (store === "refuse") throw new Error("denied");
      store[k] = v;
    },
  });
  return attrs;
}

describe("console theme", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("defaults_to_dark_without_attributes", () => {
    const attrs = stubDom({});
    applyStoredTheme();
    expect(getTheme()).toBe("dark");
    expect(getContrast()).toBe(false);
    expect(attrs.has("data-theme")).toBe(false);
    expect(attrs.has("data-contrast")).toBe(false);
  });

  it("applies_and_persists_theme_and_contrast", () => {
    const store: Record<string, string> = {};
    const attrs = stubDom(store);
    setTheme("peach");
    setContrast(true);
    expect(attrs.get("data-theme")).toBe("peach");
    expect(attrs.get("data-contrast")).toBe("high");
    // a fresh page load reads it back
    attrs.clear();
    applyStoredTheme();
    expect(getTheme()).toBe("peach");
    expect(attrs.get("data-theme")).toBe("peach");
    expect(attrs.get("data-contrast")).toBe("high");
    setTheme("dark");
    setContrast(false);
    expect(attrs.has("data-theme")).toBe(false);
    expect(attrs.has("data-contrast")).toBe(false);
  });

  it("ignores_an_unknown_stored_theme", () => {
    stubDom({ "ps5upload.console.theme": "neon" });
    expect(getTheme()).toBe("dark");
  });

  it("storage_failure_still_applies_for_the_session", () => {
    const attrs = stubDom("refuse");
    applyStoredTheme();
    expect(getTheme()).toBe("dark");
    expect(() => setTheme("oled")).not.toThrow();
    expect(() => setContrast(true)).not.toThrow();
    expect(attrs.get("data-theme")).toBe("oled");
    expect(attrs.get("data-contrast")).toBe("high");
    expect(getTheme()).toBe("oled");
    expect(getContrast()).toBe(true);
  });
});
