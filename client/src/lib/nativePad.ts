// A controller the Android app forwards from the system, for when its WebView's Gamepad API does
// not deliver it (scripts/release/android-postinit-patch.sh, step 9). MainActivity calls
// window.__ps5uNativePad({id, buttons, axes}) with the W3C standard layout on every change; it
// is offered as one more Gamepad only while the browser itself sees no controller, so a
// controller the WebView does deliver is never read twice.

interface NativeState {
  id: string;
  buttons: number[];
  axes: number[];
}

let latest: NativeState | null = null;

declare global {
  interface Window {
    __ps5uNativePad?: (s: NativeState) => void;
  }
}

/** Install the receiver (once, at start-up). */
export function installNativePad(): void {
  if (typeof window === "undefined" || window.__ps5uNativePad) return;
  window.__ps5uNativePad = (s) => {
    const first = !latest;
    latest = {
      id: String(s?.id ?? "Controller"),
      buttons: Array.isArray(s?.buttons) ? s.buttons.map(Number) : [],
      axes: Array.isArray(s?.axes) ? s.axes.map(Number) : [],
    };
    // What the browser fires for a controller it sees: the on-screen controller hides on it.
    if (first) window.dispatchEvent(new Event("gamepadconnected"));
  };
}

/** The forwarded controller as a Gamepad, or null. */
function nativeGamepad(): Gamepad | null {
  if (!latest) return null;
  const s = latest;
  return {
    id: `${s.id} (app)`,
    index: 3,
    connected: true,
    mapping: "standard",
    timestamp: 0,
    axes: s.axes,
    buttons: s.buttons.map((v) => ({ pressed: v > 0.5, touched: v > 0, value: v })),
    vibrationActuator: null,
    hapticActuators: [],
  } as unknown as Gamepad;
}

/** The controllers `nav` sees, plus the forwarded one when it sees none. */
export function gamepadsOf(nav: Navigator | undefined): Array<Gamepad | null> {
  const own = nav?.getGamepads?.() ?? [];
  if (own.some((g) => !!g?.connected)) return [...own];
  const n = nativeGamepad();
  return n ? [n] : [...own];
}

/** For tests: forget the forwarded controller. */
export function resetNativePad(): void {
  latest = null;
}
