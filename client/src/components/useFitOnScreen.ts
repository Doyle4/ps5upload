import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

const MARGIN = 8;
/** Space between a pop-up opened upwards and its button. */
const GAP = 4;
/** The least a capped pop-up keeps: a row or two, scrolled. */
const MIN_HEIGHT = 64;

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type Fit = { dx: number; maxHeight: number | null; up: boolean };

/** How far a box must slide sideways, how tall it may be, and whether it should open upwards
 *  instead, to sit whole inside `area` (the part of the screen it can be seen in). `anchor` is
 *  the box it hangs from; a box hanging below it flips above when it would not fit below and
 *  there is more room above. Pure so it can be tested without a layout engine. */
export function fitOnScreen(r: Bounds, area: Bounds, anchor?: Bounds): Fit {
  const lo = area.left + MARGIN;
  const hi = area.right - MARGIN;
  const dx = r.left < lo ? lo - r.left : r.right > hi ? Math.max(lo - r.left, hi - r.right) : 0;
  let maxHeight: number | null = null;
  let up = false;
  if (r.bottom > area.bottom - MARGIN) {
    const below = area.bottom - MARGIN - r.top;
    const above = anchor && r.top >= anchor.bottom - 1 ? anchor.top - GAP - area.top - MARGIN : -1;
    if (above > below) {
      up = true;
      if (r.bottom - r.top > above) maxHeight = above;
    } else maxHeight = below;
  } else if (r.top < area.top + MARGIN) maxHeight = r.bottom - area.top - MARGIN;
  return {
    dx: Math.abs(dx) > 0.5 ? dx : 0,
    // Whatever room there is (a landscape phone has little): a pop-up that scrolls inside the
    // screen beats one cut off by it. Never below a row or two.
    maxHeight: maxHeight === null ? null : Math.max(MIN_HEIGHT, Math.floor(maxHeight)),
    up,
  };
}

/** The part of the screen an element inside the page can be seen in: the window, less a phone's
 *  floating tab bar, cut down by every ancestor that clips or scrolls its content (the app's
 *  screen area ends below the top bar and above the window's edge). */
export function visibleArea(el: HTMLElement): Bounds {
  const area: Bounds = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const bar = document.querySelector("[data-bottom-nav]")?.getBoundingClientRect();
  if (bar && bar.height > 0) area.bottom = Math.min(area.bottom, bar.top);
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.overflowX !== "visible" || s.overflowY !== "visible") {
      const r = a.getBoundingClientRect();
      area.left = Math.max(area.left, r.left);
      area.top = Math.max(area.top, r.top);
      area.right = Math.min(area.right, r.right);
      area.bottom = Math.min(area.bottom, r.bottom);
    }
    if (s.position === "fixed") break;
  }
  return area;
}

/**
 * Keeps an anchored pop-up (a panel or menu opened from a button) whole on screen: slid back
 * sideways when its anchor sits near the other edge of a narrow window, and capped in height
 * (so it scrolls) when it would run past the bottom, under a phone's tab bar, or off the top of
 * the area it is drawn in.
 * Measured before paint each time it opens and on resize. The shift is a margin, never a
 * transform, because entry animations own the transform. Give the pop-up a scrollable body
 * (or overflow-y-auto) so a capped height still shows everything.
 */
export function useFitOnScreen(ref: RefObject<HTMLElement | null>, open: boolean): CSSProperties | undefined {
  const [fit, setFit] = useState<Fit>(NO_FIT);
  useLayoutEffect(() => {
    if (!open) {
      setFit(NO_FIT);
      return;
    }
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      // Measure the natural box: drop what the last measurement set first.
      const saved = el.getAttribute("style");
      for (const k of FIT_PROPS) el.style.removeProperty(k);
      const r = el.getBoundingClientRect();
      const anchor = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
      if (saved === null) el.removeAttribute("style");
      else el.setAttribute("style", saved);
      const next = fitOnScreen(r, visibleArea(el), anchor);
      setFit((prev) => (prev.dx === next.dx && prev.maxHeight === next.maxHeight && prev.up === next.up ? prev : next));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, ref]);
  if (!open || (!fit.dx && fit.maxHeight === null && !fit.up)) return undefined;
  return {
    ...(fit.dx ? { marginLeft: fit.dx, marginRight: -fit.dx } : {}),
    ...(fit.maxHeight !== null ? { maxHeight: fit.maxHeight } : {}),
    ...(fit.up ? { top: "auto", bottom: "100%", marginTop: 0, marginBottom: GAP } : {}),
  };
}

const NO_FIT: Fit = { dx: 0, maxHeight: null, up: false };
const FIT_PROPS = ["margin-left", "margin-right", "max-height", "top", "bottom", "margin-top", "margin-bottom"];
