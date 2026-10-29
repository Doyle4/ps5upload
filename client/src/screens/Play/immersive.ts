import { useEffect, useState } from "react";

import { isMobile } from "../../lib/platform";
import { isTauriEnv } from "../../lib/tauriEnv";

/**
 * Full screen for Remote Play on phones, tablets and computers.
 *
 * Two layers: "immersive" is our own layout (the picture fills the window, the controls float
 * over it, one small menu handle), and the browser's or app window's full screen hides the
 * system bars on top of that where the platform allows it. iPhone Safari has no element full
 * screen at all, so there the immersive layout is all there is; on Android the system back
 * gesture can drop the browser's full screen at any time, and the layout stays immersive and
 * asks again on the next touch.
 */

/** A media query, live. */
export function useMedia(query: string): boolean {
  const get = () =>
    typeof window !== "undefined" && !!window.matchMedia?.(query).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const update = () => setOn(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, [query]);
  return on;
}

/** Touch-sized player: a touch screen, or a window too narrow for the bar on the picture. */
export const COMPACT_QUERY = "(pointer: coarse), (max-width: 639px)";
/** A phone held sideways: the picture takes the whole screen by itself. */
export const PHONE_LANDSCAPE_QUERY =
  "(pointer: coarse) and (orientation: landscape) and (max-height: 520px)";
/** A touch screen (fingers, not a mouse). */
export const COARSE_QUERY = "(pointer: coarse)";

type FsDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

export function docFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

/** Whether the page can ask the browser for full screen at all (not iPhone Safari). */
export function canDocFullscreen(): boolean {
  const el = document.documentElement as FsEl;
  return (
    typeof el.requestFullscreen === "function" ||
    typeof el.webkitRequestFullscreen === "function"
  );
}

/** The window (desktop app) or the screen (browser, phone app) given to the picture. */
export async function setWindowFullscreen(on: boolean): Promise<void> {
  try {
    if (isTauriEnv() && !isMobile()) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setFullscreen(on);
      return;
    }
    const d = document as FsDoc;
    const el = document.documentElement as FsEl;
    if (on) {
      if (docFullscreen()) return;
      if (el.requestFullscreen)
        await el.requestFullscreen({ navigationUI: "hide" });
      else el.webkitRequestFullscreen?.();
    } else if (d.fullscreenElement) {
      await document.exitFullscreen();
    } else if (d.webkitFullscreenElement) {
      d.webkitExitFullscreen?.();
    }
  } catch {
    // Not allowed here (iPhone, no user gesture): the picture still fills the window.
  }
}

type LockableOrientation = ScreenOrientation & {
  lock?: (o: string) => Promise<void>;
};

/** Turn the picture sideways and keep it there (Android in full screen; not iOS). */
export function lockLandscape(): void {
  try {
    const o = screen.orientation as LockableOrientation | undefined;
    void o?.lock?.("landscape")?.catch?.(() => {});
  } catch {
    // No orientation lock here.
  }
}

export function unlockOrientation(): void {
  try {
    screen.orientation?.unlock?.();
  } catch {
    // Nothing was locked.
  }
}

/** The page may not scroll, bounce, zoom or pull to refresh while the picture fills it. */
export function holdPageStill(on: boolean): void {
  const root = document.documentElement.style;
  const body = document.body.style;
  root.overscrollBehavior = on ? "none" : "";
  body.overscrollBehavior = on ? "none" : "";
  body.overflow = on ? "hidden" : "";
}

/** A phone rather than a tablet: the picture is turned sideways for full screen. */
export function isPhoneSized(): boolean {
  if (typeof screen === "undefined") return false;
  return Math.min(screen.width, screen.height) < 600;
}
