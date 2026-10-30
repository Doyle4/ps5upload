// A phone's motion sensors as a controller's (gyro aiming, tilt): DeviceMotionEvent readings
// turned into the controller's axes and sent with the pad (engine rp_stream/feedback.rs
// MotionSample; the engine tracks the orientation as chiaki-ng does, orientation.rs).
//
// Axes: the phone held sideways with its screen toward you is a controller held in front of
// you, so screen-right is the controller's x, screen-up its y (gravity reads +1 g there at rest,
// as on a controller lying level) and toward you its z. The phone's own axes are fixed to its
// portrait shape, so they are turned by the screen's rotation first.
//
// Browsers give motion to secure pages only (the apps' pages are; a phone's browser on the
// computer's plain-http controller page is not), and iOS asks the user first.

import { isIOS } from "./platform";

export interface MotionReading {
  /** mrad/s */
  gyro: [number, number, number];
  /** thousandths of g, gravity included */
  accel: [number, number, number];
  /** µs, any clock, wrapping at 2^32 */
  t: number;
}

const DEG = Math.PI / 180;
const G = 9.80665;

/** One DeviceMotionEvent's readings in the controller's axes. `angle`: the screen's rotation
 *  (screen.orientation.angle). `invertAccel`: iOS reports acceleration with the opposite sign. */
export function toController(
  rate: { alpha: number | null; beta: number | null; gamma: number | null } | null,
  acc: { x: number | null; y: number | null; z: number | null } | null,
  angle: number,
  timeMs: number,
  invertAccel: boolean,
): MotionReading {
  const th = (((angle % 360) + 360) % 360) * DEG;
  const c = Math.round(Math.cos(th));
  const s = Math.round(Math.sin(th));
  // Device (x right, y up, z out of the screen, in portrait) → screen (right, up, out).
  const turn = (x: number, y: number, z: number): [number, number, number] => [x * c - y * s, x * s + y * c, z];
  // rotationRate: beta about x, gamma about y, alpha about z, in °/s.
  const g = turn((rate?.beta ?? 0) * DEG, (rate?.gamma ?? 0) * DEG, (rate?.alpha ?? 0) * DEG);
  const sign = invertAccel ? -1 : 1;
  const a = turn(((acc?.x ?? 0) * sign) / G, ((acc?.y ?? 0) * sign) / G, ((acc?.z ?? 0) * sign) / G);
  const milli = (v: number) => Math.round(v * 1000) || 0; // never -0
  return {
    gyro: [milli(g[0]), milli(g[1]), milli(g[2])],
    accel: [milli(a[0]), milli(a[1]), milli(a[2])],
    t: Math.round(timeMs * 1000) >>> 0,
  };
}

/** Whether this device and page can give motion at all. */
export function motionAvailable(): boolean {
  return typeof window !== "undefined" && "DeviceMotionEvent" in window && window.isSecureContext !== false;
}

type PermissionAsking = { requestPermission?: () => Promise<"granted" | "denied"> };

/** Ask for motion (iOS asks the user; call it from a tap). True when allowed. */
export async function askMotion(): Promise<boolean> {
  const ask = (window.DeviceMotionEvent as unknown as PermissionAsking | undefined)?.requestPermission;
  if (!ask) return true;
  try {
    return (await ask()) === "granted";
  } catch {
    return false;
  }
}

/** Send every reading to `onReading` until the returned stop is called. */
export function startMotion(onReading: (m: MotionReading) => void): () => void {
  const ios = isIOS();
  const handler = (e: DeviceMotionEvent) => {
    const angle = typeof screen !== "undefined" && screen.orientation ? screen.orientation.angle : 0;
    onReading(toController(e.rotationRate, e.accelerationIncludingGravity, angle, e.timeStamp, ios));
  };
  window.addEventListener("devicemotion", handler);
  return () => window.removeEventListener("devicemotion", handler);
}
