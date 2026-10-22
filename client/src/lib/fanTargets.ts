/**
 * The fan targets both fan controls offer (the desktop's Hardware card and the
 * console page's Fan section).
 *
 * A target is the temperature the console's own fan control works to hold, so
 * a LOWER value is the louder, cooler one. The console's own value is far
 * higher (91 °C on FW 13.60, 69 on one known board), and the helper refuses
 * anything above it, so a choice above it is not offered. The range mirrors
 * the helper's clamp (payload/include/hw_info.h HW_FAN_THRESHOLD_MIN/MAX) and
 * the engine's check (engine/crates/ps5upload-core/src/hw.rs).
 */
export const FAN_TARGET_MIN_C = 45;
export const FAN_TARGET_MAX_C = 85;

/** One-press choices, mildest first. */
export const FAN_TARGET_PRESETS_C: readonly number[] = [85, 80, 75, 70, 65];

/** The presets a console with its own target `stockC` (0 = not known) accepts. */
export function fanPresetsFor(stockC: number): number[] {
  return FAN_TARGET_PRESETS_C.filter((c) => stockC <= 0 || c <= stockC);
}

/** The highest target we may set on a console whose own target is `stockC` (0 = not known). */
export function fanTargetCeiling(stockC: number): number {
  return stockC > 0 ? Math.min(FAN_TARGET_MAX_C, stockC) : FAN_TARGET_MAX_C;
}

/**
 * The −1 / +1 °C step from `baseC` (what is held now: our pin, or the
 * console's own value), kept inside [FAN_TARGET_MIN_C, ceiling]. From the
 * console's own 91 °C a −1 lands on the ceiling. null when the step goes
 * nowhere (already at the edge).
 */
export function stepFanTarget(baseC: number, delta: -1 | 1, stockC: number): number | null {
  const top = fanTargetCeiling(stockC);
  const from = Math.min(Math.max(baseC, FAN_TARGET_MIN_C), top + 1);
  const next = Math.min(Math.max(from + delta, FAN_TARGET_MIN_C), top);
  if (baseC > top && delta > 0) return null;
  return next === baseC ? null : next;
}
