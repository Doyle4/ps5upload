// Which browser Remote Play in the web UI is best in, and what this one misses.
//
// Remote Play is made for Chromium (Chrome, Edge): Keyboard Lock lets Esc be the controller's ○
// in full screen (immersive.ts), and Document Picture-in-Picture keeps the controls in the small
// window (pip.tsx). Firefox has neither, and no picture-in-picture call at all; Safari has no
// Keyboard Lock and only the picture in its picture in picture. The desktop and Android apps
// bring their own webview, and every iPhone/iPad browser is Safari underneath: no advice there.

import { isAndroid, isIOS } from "../../lib/platform";
import { isTauriEnv } from "../../lib/tauriEnv";

export type BrowserAdvice = "firefox" | "safari" | "other" | "other_mobile";

interface NavLike {
  userAgent?: string;
  userAgentData?: { brands?: { brand: string }[] };
}

/** Advice for the web UI's Remote Play in this browser, or null when it is the right one (or the
 *  user has no better choice). */
export function rpBrowserAdvice(
  nav: NavLike | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator,
): BrowserAdvice | null {
  if (!nav || isTauriEnv() || isIOS()) return null;
  const ua = nav.userAgent ?? "";
  const chromium =
    nav.userAgentData?.brands?.some((b) =>
      /Chromium|Google Chrome|Microsoft Edge/.test(b.brand),
    ) || /\bChrome\/|\bEdg\//.test(ua);
  if (chromium) return null;
  if (isAndroid()) return "other_mobile";
  if (/\bFirefox\//.test(ua)) return "firefox";
  if (/\bSafari\//.test(ua)) return "safari";
  return "other";
}
