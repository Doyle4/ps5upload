import { useEffect, useRef, useState } from "react";

import { IDLE_PAD, PadButton, touchAt, type PadState, type RemotePlayStream } from "../../lib/remotePlayStream";
import { gamepadsOf } from "../../lib/nativePad";
import { useTr } from "../../state/lang";
import { rpInput, type RpPrefs } from "../../state/remotePlay";

/** True when the on-screen controller should show: set on, or (auto) a touch screen with no
 *  controller connected. A controller connecting hides it, as PS Remote Play does. */
export function useTouchFirst(mode: RpPrefs["touchControls"]): boolean {
  const coarse = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
  const padConnected = () =>
    typeof navigator !== "undefined" && gamepadsOf(navigator).some((g) => !!g?.connected);
  const [state, setState] = useState(() => ({ coarse: coarse(), pad: padConnected() }));
  useEffect(() => {
    const update = () => setState({ coarse: coarse(), pad: padConnected() });
    window.addEventListener("gamepadconnected", update);
    window.addEventListener("gamepaddisconnected", update);
    return () => {
      window.removeEventListener("gamepadconnected", update);
      window.removeEventListener("gamepaddisconnected", update);
    };
  }, []);
  if (mode === "on") return true;
  if (mode === "off") return false;
  return state.coarse && !state.pad;
}

type Part =
  | { kind: "button"; bit: number }
  | { kind: "trigger"; which: "l2" | "r2" }
  | { kind: "stick"; which: "l" | "r"; cx: number; cy: number; radius: number }
  | { kind: "touchpad"; rect: DOMRect };

const STICK_RANGE = 32767;

/**
 * Where the controller is drawn:
 * - "overlay": over a picture that fills the screen (full screen, a phone sideways). Clear of
 *   the notch and the rounded corners (safe areas); the middle of the picture stays free.
 * - "overlay-bar": the same over a picture that has the button bar along its top (a computer
 *   with the controller switched on), so the top row sits below that bar.
 * - "deck": full screen on a phone held upright, like PS Remote Play's portrait layout: the
 *   picture across the top, the controller on the black below it (`deckTop` is where the
 *   picture ends), so no button covers the game.
 */
export type TouchLayout = "overlay" | "overlay-bar" | "deck";

const SIZE_SCALE: Record<RpPrefs["touchSize"], number> = { s: 0.85, m: 1, l: 1.15 };

/** A controller drawn over the picture: two sticks, D-pad, face buttons, shoulders, Options,
 *  Create, PS and a touchpad strip. Several fingers at once; each press buzzes the phone. */
export function TouchControls({
  stream,
  layout = "overlay",
  opacity = 1,
  size = "m",
  deckTop = "0px",
}: {
  /** What the presses go to: the stream, or a phone's link to another device's stream. */
  stream: Pick<RemotePlayStream, "sendPad"> | null;
  layout?: TouchLayout;
  opacity?: number;
  size?: RpPrefs["touchSize"];
  deckTop?: string;
}) {
  const tr = useTr();
  const fingers = useRef(new Map<number, Part>());
  const pad = useRef<PadState>({ ...IDLE_PAD });
  // What is drawn: the pad as last sent (the refs are for the event handlers).
  const [view, setView] = useState<PadState>({ ...IDLE_PAD });

  useEffect(
    () => () => {
      rpInput.touchPad = { ...IDLE_PAD };
    },
    [],
  );

  const apply = () => {
    const p: PadState = { ...IDLE_PAD, touch: null };
    for (const part of fingers.current.values()) {
      if (part.kind === "button") p.buttons |= part.bit;
      if (part.kind === "trigger") p[part.which] = 255;
    }
    p.lx = pad.current.lx;
    p.ly = pad.current.ly;
    p.rx = pad.current.rx;
    p.ry = pad.current.ry;
    p.touch = pad.current.touch ?? null;
    rpInput.touchPad = p;
    stream?.sendPad();
    setView(p);
  };

  const moveStick = (part: Extract<Part, { kind: "stick" }>, x: number, y: number) => {
    const dx = Math.max(-1, Math.min(1, (x - part.cx) / part.radius));
    const dy = Math.max(-1, Math.min(1, (y - part.cy) / part.radius));
    pad.current[part.which === "l" ? "lx" : "rx"] = Math.round(dx * STICK_RANGE);
    pad.current[part.which === "l" ? "ly" : "ry"] = Math.round(dy * STICK_RANGE);
  };

  const down = (e: React.PointerEvent, make: (el: HTMLElement) => Part) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    try {
      // Keeps a finger that slides off the button on it. Refused (InvalidStateError) while the
      // page holds a pointer lock or for a pointer that is no longer active: the press still counts.
      el.setPointerCapture(e.pointerId);
    } catch {
      // Without capture the button still sees its own pointerup and pointercancel.
    }
    const part = make(el);
    fingers.current.set(e.pointerId, part);
    if (part.kind === "stick") moveStick(part, e.clientX, e.clientY);
    if (part.kind === "touchpad") pad.current.touch = touchAt((e.clientX - part.rect.left) / part.rect.width, (e.clientY - part.rect.top) / part.rect.height);
    navigator.vibrate?.(8);
    apply();
  };
  const move = (e: React.PointerEvent) => {
    const part = fingers.current.get(e.pointerId);
    if (!part) return;
    e.stopPropagation();
    if (part.kind === "stick") moveStick(part, e.clientX, e.clientY);
    else if (part.kind === "touchpad")
      pad.current.touch = touchAt((e.clientX - part.rect.left) / part.rect.width, (e.clientY - part.rect.top) / part.rect.height);
    else return;
    apply();
  };
  const up = (e: React.PointerEvent) => {
    const part = fingers.current.get(e.pointerId);
    if (!part) return;
    e.stopPropagation();
    fingers.current.delete(e.pointerId);
    if (part.kind === "stick") {
      pad.current[part.which === "l" ? "lx" : "rx"] = 0;
      pad.current[part.which === "l" ? "ly" : "ry"] = 0;
    }
    if (part.kind === "touchpad") pad.current.touch = null;
    apply();
  };
  // Taps on the controller are the controller's: never a click or a double click on the picture
  // (a double tap there must not leave full screen).
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const handlers = { onPointerMove: move, onPointerUp: up, onPointerCancel: up, onClick: stop, onDoubleClick: stop };
  const held = (bit: number) => (view.buttons & bit) !== 0;

  const btn = (label: string, bit: number, cls: string) => (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => down(e, () => ({ kind: "button", bit }))}
      {...handlers}
      className={`pointer-events-auto flex touch-none select-none items-center justify-center rounded-full border border-white/30 text-sm font-semibold text-white backdrop-blur-sm ${held(bit) ? "bg-white/45" : "bg-black/30"} ${cls}`}
    >
      {label}
    </button>
  );
  const trig = (label: string, which: "l2" | "r2") => (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => down(e, () => ({ kind: "trigger", which }))}
      {...handlers}
      className={`pointer-events-auto h-9 w-16 touch-none select-none rounded-lg border border-white/30 text-xs font-semibold text-white backdrop-blur-sm ${view[which] ? "bg-white/45" : "bg-black/30"}`}
    >
      {label}
    </button>
  );
  const stick = (which: "l" | "r") => {
    const x = which === "l" ? view.lx : view.rx;
    const y = which === "l" ? view.ly : view.ry;
    return (
      <div
        aria-label={
          which === "l"
            ? tr("rp_touch_left_stick", undefined, "Left stick")
            : tr("rp_touch_right_stick", undefined, "Right stick")
        }
        onPointerDown={(e) =>
          down(e, (el) => {
            const r = el.getBoundingClientRect();
            return { kind: "stick", which, cx: r.left + r.width / 2, cy: r.top + r.height / 2, radius: r.width / 2 };
          })
        }
        {...handlers}
        className="pointer-events-auto relative h-24 w-24 touch-none rounded-full border border-white/25 bg-black/25 backdrop-blur-sm"
      >
        <div
          className="absolute left-1/2 top-1/2 h-10 w-10 rounded-full bg-white/50"
          style={{ transform: `translate(calc(-50% + ${(x / STICK_RANGE) * 28}px), calc(-50% + ${(y / STICK_RANGE) * 28}px))` }}
        />
      </div>
    );
  };

  const scale = SIZE_SCALE[size] ?? 1;
  const deck = layout === "deck";
  // Clear of the notch, the rounded corners and the home bar.
  const L = "max(12px, env(safe-area-inset-left))";
  const R = "max(12px, env(safe-area-inset-right))";
  const B = deck ? "max(16px, env(safe-area-inset-bottom))" : "max(12px, env(safe-area-inset-bottom))";
  // The top row: under the menu handle's height (overlay), under the bar (overlay-bar).
  const top = deck ? "8px" : layout === "overlay-bar" ? "3.5rem" : "max(10px, env(safe-area-inset-top))";
  // The touchpad row with Create and Options either side, as on the DualSense: in the overlay
  // it sits below the menu handle in the middle of the top edge.
  const padRowTop = deck
    ? "52px"
    : layout === "overlay-bar"
      ? "3.5rem"
      : "calc(max(10px, env(safe-area-inset-top)) + 2.75rem)";
  const at = (origin: string, pos: React.CSSProperties): React.CSSProperties => ({
    position: "absolute",
    ...pos,
    transform: scale === 1 ? undefined : `scale(${scale})`,
    transformOrigin: origin,
  });

  return (
    <div
      className={`pointer-events-none absolute z-10 select-none [-webkit-touch-callout:none] ${deck ? "inset-x-0 bottom-0" : "inset-0"}`}
      style={{ opacity, top: deck ? deckTop : undefined }}
      data-testid="rp-touch"
      data-layout={layout}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Shoulders, in the top corners. */}
      <div className="flex gap-2" style={at("top left", { top, left: L })}>
        {trig("L2", "l2")}
        {btn("L1", PadButton.L1, "h-9 w-16 rounded-lg")}
      </div>
      <div className="flex gap-2" style={at("top right", { top, right: R })}>
        {btn("R1", PadButton.R1, "h-9 w-16 rounded-lg")}
        {trig("R2", "r2")}
      </div>
      {/* Create, touchpad, Options: top middle. */}
      <div className="flex items-center gap-2" style={at("top center", { top: padRowTop, left: "50%", translate: "-50% 0" })}>
        {btn("Create", PadButton.SHARE, "h-8 px-2.5 text-[11px]")}
        <div
          aria-label={tr("rp_touch_touchpad", undefined, "Touchpad")}
          onPointerDown={(e) => down(e, (el) => ({ kind: "touchpad", rect: el.getBoundingClientRect() }))}
          {...handlers}
          className={`pointer-events-auto h-11 touch-none rounded-xl border border-white/20 bg-black/15 ${
            deck ? "w-[clamp(6rem,34vw,12rem)]" : "w-[clamp(6rem,22vw,14rem)]"
          }`}
        />
        {btn("Options", PadButton.OPTIONS, "h-8 px-2.5 text-[11px]")}
      </div>
      {/* Left: D-pad above the stick. Right: face buttons above the stick. */}
      <div className="flex flex-col items-center gap-2" style={at("bottom left", { bottom: B, left: L })}>
        <div className="grid grid-cols-3 grid-rows-3 gap-0.5">
          <span />
          {btn("↑", PadButton.UP, "h-9 w-9 rounded-md")}
          <span />
          {btn("←", PadButton.LEFT, "h-9 w-9 rounded-md")}
          <span />
          {btn("→", PadButton.RIGHT, "h-9 w-9 rounded-md")}
          <span />
          {btn("↓", PadButton.DOWN, "h-9 w-9 rounded-md")}
          <span />
        </div>
        {stick("l")}
      </div>
      <div className="flex flex-col items-center gap-2" style={at("bottom right", { bottom: B, right: R })}>
        <div className="grid grid-cols-3 grid-rows-3 gap-0.5">
          <span />
          {btn("△", PadButton.TRIANGLE, "h-10 w-10")}
          <span />
          {btn("□", PadButton.SQUARE, "h-10 w-10")}
          <span />
          {btn("○", PadButton.CIRCLE, "h-10 w-10")}
          <span />
          {btn("✕", PadButton.CROSS, "h-10 w-10")}
          <span />
        </div>
        {stick("r")}
      </div>
      {/* PS, bottom middle between the sticks. */}
      <div style={at("bottom center", { bottom: B, left: "50%", translate: "-50% 0" })}>
        {btn("PS", PadButton.PS, "h-10 w-10 text-xs")}
      </div>
    </div>
  );
}
