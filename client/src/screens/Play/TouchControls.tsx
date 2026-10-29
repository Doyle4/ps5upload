import { useEffect, useRef, useState } from "react";

import { IDLE_PAD, PadButton, touchAt, type PadState, type RemotePlayStream } from "../../lib/remotePlayStream";
import { useTr } from "../../state/lang";
import { rpInput, type RpPrefs } from "../../state/remotePlay";

/** True when the on-screen controller should show: set on, or (auto) a touch screen with no
 *  controller connected. A controller connecting hides it, as PS Remote Play does. */
export function useTouchFirst(mode: RpPrefs["touchControls"]): boolean {
  const coarse = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
  const padConnected = () =>
    typeof navigator !== "undefined" && (navigator.getGamepads?.() ?? []).some((g) => !!g?.connected);
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

/** A controller drawn over the picture: two sticks, D-pad, face buttons, shoulders, Options,
 *  Create, PS and a touchpad strip. Several fingers at once; each press buzzes the phone. */
export function TouchControls({ stream }: { stream: RemotePlayStream | null }) {
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
    el.setPointerCapture(e.pointerId);
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
  const handlers = { onPointerMove: move, onPointerUp: up, onPointerCancel: up, onClick: (e: React.MouseEvent) => e.stopPropagation() };
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
        className="pointer-events-auto relative h-28 w-28 touch-none rounded-full border border-white/25 bg-black/25 backdrop-blur-sm"
      >
        <div
          className="absolute left-1/2 top-1/2 h-12 w-12 rounded-full bg-white/50"
          style={{ transform: `translate(calc(-50% + ${(x / STICK_RANGE) * 32}px), calc(-50% + ${(y / STICK_RANGE) * 32}px))` }}
        />
      </div>
    );
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none" data-testid="rp-touch">
      {/* Touchpad strip, top middle (under the toolbar). */}
      <div
        aria-label={tr("rp_touch_touchpad", undefined, "Touchpad")}
        onPointerDown={(e) => down(e, (el) => ({ kind: "touchpad", rect: el.getBoundingClientRect() }))}
        {...handlers}
        className="pointer-events-auto absolute left-1/2 top-14 h-12 w-[34%] -translate-x-1/2 touch-none rounded-xl border border-white/20 bg-black/15"
      />
      {/* Shoulders. */}
      <div className="absolute left-3 top-14 flex flex-col gap-2">
        {trig("L2", "l2")}
        {btn("L1", PadButton.L1, "h-9 w-16 rounded-lg")}
      </div>
      <div className="absolute right-3 top-14 flex flex-col items-end gap-2">
        {trig("R2", "r2")}
        {btn("R1", PadButton.R1, "h-9 w-16 rounded-lg")}
      </div>
      {/* Left: D-pad above the stick. Right: face buttons above the stick. */}
      <div className="absolute bottom-4 left-4 flex flex-col items-center gap-3">
        <div className="grid grid-cols-3 grid-rows-3 gap-0.5">
          <span />
          {btn("↑", PadButton.UP, "h-10 w-10 rounded-md")}
          <span />
          {btn("←", PadButton.LEFT, "h-10 w-10 rounded-md")}
          <span />
          {btn("→", PadButton.RIGHT, "h-10 w-10 rounded-md")}
          <span />
          {btn("↓", PadButton.DOWN, "h-10 w-10 rounded-md")}
          <span />
        </div>
        {stick("l")}
      </div>
      <div className="absolute bottom-4 right-4 flex flex-col items-center gap-3">
        <div className="grid grid-cols-3 grid-rows-3 gap-0.5">
          <span />
          {btn("△", PadButton.TRIANGLE, "h-11 w-11")}
          <span />
          {btn("□", PadButton.SQUARE, "h-11 w-11")}
          <span />
          {btn("○", PadButton.CIRCLE, "h-11 w-11")}
          <span />
          {btn("✕", PadButton.CROSS, "h-11 w-11")}
          <span />
        </div>
        {stick("r")}
      </div>
      {/* Middle bottom: Create, PS, Options. */}
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3">
        {btn("Create", PadButton.SHARE, "h-8 px-3 text-[11px]")}
        {btn("PS", PadButton.PS, "h-10 w-10 text-xs")}
        {btn("Options", PadButton.OPTIONS, "h-8 px-3 text-[11px]")}
      </div>
    </div>
  );
}
