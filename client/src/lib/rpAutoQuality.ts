// When to offer a lower picture quality: the network has kept dropping the stream for a while.
//
// The engine reports each second: the share of packets lost (before the console is told, capped,
// to cut its bitrate) and frames lost or rebuilt from error correction. The console already
// lowers its bitrate on loss; a 1080p stream that keeps losing frames after that is past what
// the network carries, and 720p (about two-thirds the bitrate) usually is not. The resolution is
// fixed for a session, so the change is a restart: offered, never done behind your back.

import type { StreamStats } from "./remotePlayStream";

/** Seconds looked at, and how many of them must be bad. */
export const BUSY_WINDOW_S = 10;
export const BUSY_BAD_S = 8;
/** Seconds after the first picture that are not judged (a session's start is bursty). */
export const WARMUP_S = 5;

/** A second the network spoiled: packets lost, or whole frames lost. A frame rebuilt from
 *  error correction played fine; only many of them count. */
export function badSecond(s: Pick<StreamStats, "lossPct" | "lost" | "rebuilt">): boolean {
  return s.lossPct >= 2 || s.lost >= 2 || s.rebuilt >= 10;
}

/** Watches one session's seconds; `push` says when to offer the lower quality. */
export class BusyNetworkWatch {
  private seconds: boolean[] = [];
  private seen = 0;

  push(s: Pick<StreamStats, "lossPct" | "lost" | "rebuilt">): boolean {
    if (++this.seen <= WARMUP_S) return false;
    this.seconds.push(badSecond(s));
    if (this.seconds.length > BUSY_WINDOW_S) this.seconds.shift();
    return this.seconds.length === BUSY_WINDOW_S && this.seconds.filter(Boolean).length >= BUSY_BAD_S;
  }

  reset(): void {
    this.seconds = [];
    this.seen = 0;
  }
}

/** True when a lower quality can be offered at all: the setting is on, the stream is 1080p
 *  (asked for and sent), and it has not been offered for this session. Never anything upward. */
export function canStepDown(o: { enabled: boolean; res: string; pictureHeight: number; offered: boolean }): boolean {
  return o.enabled && !o.offered && o.res === "1920x1080" && o.pictureHeight > 720;
}
