import { useEffect, useState, type RefObject } from "react";

/** Which column ④ Build & install sits under on a wide window. */
export type RunSide = "left" | "right";

/** Shortest-hole choice: ④ goes under ①② ("left") or under ③ ("right"), whichever
 *  leaves the smaller empty space under the shorter column. `keep` holds the current side
 *  unless the other one is clearly better, so a card that changes by a few pixels (a
 *  hint appearing) does not send ④ back and forth. */
export function pickRunSide(
  h: { steps: number; options: number; run: number },
  gap: number,
  keep: RunSide,
): RunSide {
  const holeRight = Math.abs(h.steps - (h.options + gap + h.run));
  const holeLeft = Math.abs(h.steps + gap + h.run - h.options);
  const HYSTERESIS = 48;
  if (keep === "right") return holeLeft + HYSTERESIS < holeRight ? "left" : "right";
  return holeRight + HYSTERESIS < holeLeft ? "right" : "left";
}

/** Measures the three blocks and keeps the side with the smaller hole. Their heights do not
 *  depend on the side (both columns are the same width), so moving ④ cannot feed back. */
export function useRunSide(
  steps: RefObject<HTMLElement | null>,
  options: RefObject<HTMLElement | null>,
  run: RefObject<HTMLElement | null>,
): RunSide {
  const [side, setSide] = useState<RunSide>("right");
  useEffect(() => {
    const els = [steps.current, options.current, run.current];
    if (els.some((e) => !e) || typeof ResizeObserver === "undefined") return;
    const [s, o, r] = els as HTMLElement[];
    const measure = () => {
      const gap = parseFloat(getComputedStyle(s.parentElement ?? s).rowGap) || 0;
      const h = { steps: s.offsetHeight, options: o.offsetHeight, run: r.offsetHeight };
      setSide((keep) => pickRunSide(h, gap, keep));
    };
    const ro = new ResizeObserver(measure);
    for (const e of els as HTMLElement[]) ro.observe(e);
    return () => ro.disconnect();
  }, [steps, options, run]);
  return side;
}
