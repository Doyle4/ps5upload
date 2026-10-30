import { invoke } from "./invokeLogged";
import { isAndroid, isIOS, isLinuxDesktop, isWindows } from "./platform";
import { isTauriEnv } from "./tauriEnv";

// "Game mode" while Remote Play plays: the app asks its OS for what a game gets
// (commands/game_mode.rs says what that is on each platform). Only the app can ask; a
// browser tab has no such switch, so there this is a no-op.
//
// Driven from the Remote Play store (state/remotePlay.ts), not from a screen: the stream keeps
// playing on other screens. `desired` is the latest request and `current` what the app was
// last told, null before the first call: the store sends an off at start-up, which the app
// always hears, so a hold left on by a page reloaded mid-stream is let go. Calls go through one
// promise chain so an off can never land before its on, and repeats are dropped here.

let desired = false;
let current: boolean | null = null;
let chain: Promise<unknown> = Promise.resolve();

export function setGameMode(on: boolean): void {
  if (!isTauriEnv()) return;
  desired = on;
  chain = chain.then(async () => {
    if (desired === current) return;
    const next = desired;
    current = next;
    try {
      await invoke("game_mode_set", { on: next });
    } catch {
      // Best effort: the stream plays the same without it.
    }
  });
}

/** Test hook. */
export function resetGameModeForTest(): void {
  desired = false;
  current = null;
  chain = Promise.resolve();
}

/** What the app does for a game on this device, as a key into the Remote Play settings
 *  text; null in a browser. iOS is checked before the Mac (iPadOS reports as a Mac). */
export function gameModeKind(): "mac" | "ios" | "windows" | "linux" | "android" | null {
  if (!isTauriEnv()) return null;
  if (isAndroid()) return "android";
  if (isIOS()) return "ios";
  if (isWindows()) return "windows";
  if (isLinuxDesktop()) return "linux";
  return "mac";
}
