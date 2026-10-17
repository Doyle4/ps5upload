import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fullscreenApi,
  fullscreenPref,
  fullscreenSupported,
  installFullscreen,
  setFullscreenPref,
  toggleFullscreen,
  type FullscreenDoc,
} from "./fullscreen";

function doc(kind: "standard" | "webkit" | "both" | "none", enabled = true) {
  const calls: string[] = [];
  const d: FullscreenDoc = { documentElement: {} as FullscreenDoc["documentElement"] };
  const el = d.documentElement as unknown as Record<string, unknown>;
  if (kind === "standard" || kind === "both") {
    el.requestFullscreen = () => {
      calls.push("standard");
      d.fullscreenElement = el as unknown as Element;
      return Promise.resolve();
    };
    d.fullscreenEnabled = enabled;
    d.exitFullscreen = () => {
      calls.push("exit");
      d.fullscreenElement = null;
      return Promise.resolve();
    };
  }
  if (kind === "webkit" || kind === "both") {
    el.webkitRequestFullscreen = () => {
      calls.push("webkit");
      d.webkitFullscreenElement = el as unknown as Element;
    };
    d.webkitFullscreenEnabled = enabled;
    d.webkitExitFullscreen = () => {
      calls.push("webkit-exit");
      d.webkitFullscreenElement = null;
    };
  }
  return { d, calls };
}

function storage(init: Record<string, string> = {}, broken = false) {
  const m = new Map(Object.entries(init));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => {
      if (broken) throw new Error("denied");
      return m.has(k) ? m.get(k) : null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error("denied");
      m.set(k, v);
    },
  });
  return m;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("full screen", () => {
  it("prefers the standard API, falls back to the webkit-prefixed one", () => {
    expect(fullscreenApi(doc("both").d)).toBe("standard");
    expect(fullscreenApi(doc("webkit").d)).toBe("webkit");
    expect(fullscreenApi(doc("none").d)).toBeNull();
  });

  it("is unsupported when the API is missing or the browser disables it", () => {
    expect(fullscreenSupported(doc("webkit").d)).toBe(true);
    expect(fullscreenSupported(doc("none").d)).toBe(false);
    expect(fullscreenSupported(doc("standard", false).d)).toBe(false);
  });

  it("the setting defaults to on, and survives broken storage", () => {
    storage();
    expect(fullscreenPref()).toBe(true);
    storage({ "ps5upload.console.fullscreen": "0" });
    expect(fullscreenPref()).toBe(false);
    storage({}, true);
    expect(fullscreenPref()).toBe(true);
    expect(() => setFullscreenPref(false, doc("none").d)).not.toThrow();
  });

  it("enters on the first user activation with the prefixed API, only once", async () => {
    storage();
    const { d, calls } = doc("webkit");
    const listeners: Record<string, (() => void)[]> = {};
    const win = {
      addEventListener: (t: string, fn: () => void) => (listeners[t] ??= []).push(fn),
      removeEventListener: (t: string, fn: () => void) => {
        listeners[t] = (listeners[t] ?? []).filter((f) => f !== fn);
      },
    };
    installFullscreen(win, d);
    for (const fn of listeners.click ?? []) fn();
    await Promise.resolve();
    expect(calls).toEqual(["webkit"]);
    for (const fn of listeners.click ?? []) fn();
    for (const fn of listeners.keydown ?? []) fn();
    await Promise.resolve();
    expect(calls).toEqual(["webkit"]);
  });

  it("does nothing on activation when the setting is off", async () => {
    storage({ "ps5upload.console.fullscreen": "0" });
    const { d, calls } = doc("standard");
    const listeners: Record<string, (() => void)[]> = {};
    installFullscreen({ addEventListener: (t: string, fn: () => void) => (listeners[t] ??= []).push(fn), removeEventListener: () => {} }, d);
    for (const fn of listeners.click ?? []) fn();
    await Promise.resolve();
    expect(calls).toEqual([]);
  });

  it("a refused request is tried again on the next activation", async () => {
    storage();
    const { d } = doc("standard");
    let n = 0;
    (d.documentElement as unknown as Record<string, unknown>).requestFullscreen = () => {
      n++;
      return n === 1 ? Promise.reject(new Error("no")) : Promise.resolve();
    };
    const listeners: Record<string, (() => void)[]> = {};
    installFullscreen({ addEventListener: (t: string, fn: () => void) => (listeners[t] ??= []).push(fn), removeEventListener: () => {} }, d);
    for (const fn of listeners.click ?? []) fn();
    await new Promise((r) => setTimeout(r, 0));
    for (const fn of listeners.click ?? []) fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(n).toBe(2);
  });

  it("the switch and the touchpad toggle enter and leave", async () => {
    const m = storage();
    const { d, calls } = doc("standard");
    setFullscreenPref(false, d);
    expect(m.get("ps5upload.console.fullscreen")).toBe("0");
    setFullscreenPref(true, d);
    await Promise.resolve();
    expect(calls).toEqual(["standard"]);
    toggleFullscreen(d);
    await Promise.resolve();
    expect(calls).toEqual(["standard", "exit"]);
  });
});
