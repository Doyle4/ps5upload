import { describe, expect, it } from "vitest";
import { toController } from "./motion";

const G = 9.80665;

describe("a phone's motion in the controller's axes", () => {
  it("held sideways and still, gravity reads +1 g up, like a level controller", () => {
    // Landscape (screen turned 90°): the phone's own x axis points up the screen.
    const m = toController({ alpha: 0, beta: 0, gamma: 0 }, { x: G, y: 0, z: 0 }, 90, 16, false);
    expect(m.accel).toEqual([0, 1000, 0]);
    expect(m.gyro).toEqual([0, 0, 0]);
  });
  it("the other way round too", () => {
    const m = toController(null, { x: -G, y: 0, z: 0 }, 270, 16, false);
    expect(m.accel).toEqual([0, 1000, 0]);
  });
  it("turning left and right is about the up axis", () => {
    // 90°/s about the phone's x (= screen-up when sideways at 90°): the controller's y.
    const m = toController({ alpha: 0, beta: 90, gamma: 0 }, null, 90, 16, false);
    expect(m.gyro).toEqual([0, Math.round((Math.PI / 2) * 1000), 0]);
  });
  it("iOS reports acceleration the other way round", () => {
    const m = toController(null, { x: -G, y: 0, z: 0 }, 90, 16, true);
    expect(m.accel).toEqual([0, 1000, 0]);
  });
  it("time in µs, wrapping", () => {
    expect(toController(null, null, 0, 1.5, false).t).toBe(1500);
    expect(toController(null, null, 0, 2 ** 32 / 1000 + 1, false).t).toBe(1000);
  });
});
