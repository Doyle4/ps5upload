import { FAN_TARGET_MAX_C, fanPresetsFor, stepFanTarget } from "../../lib/fanTargets";
import { ApiError, isOffline } from "../api";
import { t } from "../strings";

/** /api/fan and /api/fan/set's answer (payload/src/webui_codec.c webui_fan_status_json). */
export interface FanStatus {
  cpu_c: number | null;
  soc_c: number | null;
  duty_pct: number | null;
  /** What the controller holds now. */
  target_c: number | null;
  /** The console's own value; null until the helper has seen it. */
  stock_c: number | null;
  /** Our pinned target, 0 = none (the console's own control). */
  pinned_c: number;
  min_c: number;
  max_c: number;
  /** Targets the helper put back after a game start reset them, this helper session. */
  restores: number;
  last_restore_s: number | null;
  guard: "off" | "ok" | "failing";
  filtered_c: number | null;
}

/** The Fan page re-reads this often while it is visible. */
export const FAN_POLL_MS = 2_000;

/** What a press asks for: a target, or the console's own setting back. */
export type FanChoice = number | "stock";

/** The highlighted choice: our pin, else the console's own setting. */
export function activeChoice(s: FanStatus): FanChoice {
  return s.pinned_c > 0 ? s.pinned_c : "stock";
}

/** The preset row: the console's own setting, then the presets this console accepts. */
export function presetChoices(s: FanStatus | null): FanChoice[] {
  return ["stock", ...fanPresetsFor(s?.stock_c ?? 0).filter((c) => c <= (s?.max_c ?? FAN_TARGET_MAX_C))];
}

/** The target −1 / +1 °C leads to from what is held now, or null (at the edge, or nothing read yet). */
export function stepChoice(s: FanStatus | null, delta: -1 | 1): number | null {
  if (!s) return null;
  const base = s.pinned_c > 0 ? s.pinned_c : (s.target_c ?? s.stock_c);
  if (base == null) return null;
  return stepFanTarget(base, delta, s.stock_c ?? 0);
}

/** The "restored after a game reset it" line, or null when nothing was restored while ours is pinned. */
export function restoredText(s: FanStatus): string | null {
  if (s.pinned_c <= 0 || s.restores <= 0 || s.last_restore_s == null || s.last_restore_s < 0) return null;
  const sec = s.last_restore_s;
  return sec < 120
    ? t("cw_fan_restored_s", { n: sec })
    : t("cw_fan_restored_min", { n: Math.floor(sec / 60) });
}

/** A failed set as one line; null for a 401 (the reload banner says it). `restartNote` is not a failure. */
export function fanErrorText(err: unknown): string | null {
  if (err instanceof ApiError && err.status === 401) return null;
  if (isOffline(err)) return t("cw_home_err_offline");
  if (err instanceof ApiError && err.code === "fan_above_stock") return t("cw_fan_err_above");
  return t("cw_fan_err_set");
}

/** Whether a set's refusal means "ours is dropped; the console's own returns on its own". */
export function isRestartNote(err: unknown): boolean {
  return err instanceof ApiError && err.code === "fan_restore_needs_restart";
}

/** A temperature for the readout tiles. */
export function degrees(c: number | null): string {
  return c == null ? "—" : `${c} °C`;
}
