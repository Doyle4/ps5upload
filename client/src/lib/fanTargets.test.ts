import { describe, expect, it } from "vitest";

import { FAN_RESTORE_CONSOLE, FAN_THRESHOLD_MAX_C, FAN_THRESHOLD_MIN_C } from "../api/ps5";
import {
  FAN_TARGET_MAX_C,
  FAN_TARGET_MIN_C,
  FAN_TARGET_PRESETS_C,
  fanPresetsFor,
  fanTargetCeiling,
  stepFanTarget,
} from "./fanTargets";

describe("fan targets", () => {
  it("match the range the desktop API sends and the helper accepts", () => {
    expect(FAN_TARGET_MIN_C).toBe(FAN_THRESHOLD_MIN_C);
    expect(FAN_TARGET_MAX_C).toBe(FAN_THRESHOLD_MAX_C);
    expect(FAN_TARGET_MAX_C).toBe(85);
    expect(FAN_RESTORE_CONSOLE).toBe(0);
  });

  it("offers 85 down to 65, every one inside the range", () => {
    expect(FAN_TARGET_PRESETS_C).toEqual([85, 80, 75, 70, 65]);
    for (const c of FAN_TARGET_PRESETS_C) {
      expect(c).toBeGreaterThanOrEqual(FAN_TARGET_MIN_C);
      expect(c).toBeLessThanOrEqual(FAN_TARGET_MAX_C);
    }
  });

  it("never offers a target above the console's own", () => {
    expect(fanPresetsFor(91)).toEqual([85, 80, 75, 70, 65]);
    expect(fanPresetsFor(0)).toEqual([85, 80, 75, 70, 65]); // not known yet
    expect(fanPresetsFor(69)).toEqual([65]);
    expect(fanTargetCeiling(69)).toBe(69);
    expect(fanTargetCeiling(91)).toBe(85);
  });

  it("steps one degree inside the range", () => {
    expect(stepFanTarget(75, -1, 91)).toBe(74);
    expect(stepFanTarget(75, 1, 91)).toBe(76);
    expect(stepFanTarget(91, -1, 91)).toBe(85); // from the console's own: the mildest we set
    expect(stepFanTarget(91, 1, 91)).toBeNull();
    expect(stepFanTarget(85, 1, 91)).toBeNull();
    expect(stepFanTarget(45, -1, 91)).toBeNull();
    expect(stepFanTarget(69, 1, 69)).toBeNull();
    expect(stepFanTarget(69, -1, 69)).toBe(68);
  });
});
