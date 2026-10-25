import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async () => {
  throw new Error("'keep_awake_state' requires the Tauri desktop client");
});
vi.mock("../lib/invokeLogged", () => ({ invoke: (...a: unknown[]) => invoke(...(a as [])) }));
vi.mock("../lib/tauriEnv", () => ({ isTauriEnv: () => false }));
vi.mock("../lib/platform", () => ({ isAndroid: () => false, isMobile: () => false }));

import { useKeepAwakeStore } from "./keepAwake";

describe("keep awake in the browser build", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never calls the native command, and says so when the browser has no screen lock", async () => {
    await useKeepAwakeStore.getState().syncFromBackend();
    expect(useKeepAwakeStore.getState()).toMatchObject({ supported: false, lastError: null });
    await useKeepAwakeStore.getState().setEnabled(true);
    expect(useKeepAwakeStore.getState().lastError).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the screen on where the browser offers a screen lock", async () => {
    const request = vi.fn(async () => ({ released: false, release: async () => {}, addEventListener: () => {} }));
    vi.stubGlobal("navigator", { wakeLock: { request } });
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => {} });
    await useKeepAwakeStore.getState().setEnabled(true);
    expect(useKeepAwakeStore.getState()).toMatchObject({ enabled: true, supported: true, lastError: null });
    expect(invoke).not.toHaveBeenCalled();
  });
});
