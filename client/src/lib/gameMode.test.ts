import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ tauri: true }));
const calls = vi.hoisted(() => [] as boolean[]);

vi.mock("./tauriEnv", () => ({ isTauriEnv: () => env.tauri }));
vi.mock("./invokeLogged", () => ({
  invoke: vi.fn(async (_cmd: string, args: { on: boolean }) => {
    calls.push(args.on);
  }),
}));

import { resetGameModeForTest, setGameMode } from "./gameMode";

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("setGameMode", () => {
  beforeEach(() => {
    env.tauri = true;
    calls.length = 0;
    resetGameModeForTest();
  });

  it("tells the app on and off, in order", async () => {
    setGameMode(true);
    setGameMode(false);
    setGameMode(true);
    await settle();
    // The first on is sent; the off and on after it cancel out before they are sent.
    expect(calls).toEqual([true]);
    setGameMode(false);
    await settle();
    expect(calls).toEqual([true, false]);
  });

  it("always sends the first call, even an off", async () => {
    setGameMode(false);
    await settle();
    setGameMode(false);
    await settle();
    expect(calls).toEqual([false]);
  });

  it("drops repeats", async () => {
    setGameMode(true);
    await settle();
    setGameMode(true);
    await settle();
    expect(calls).toEqual([true]);
  });

  it("does nothing in a browser", async () => {
    env.tauri = false;
    setGameMode(true);
    await settle();
    expect(calls).toEqual([]);
  });
});
