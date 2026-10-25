// Before this app sends its helper to a console that already runs one (8.0.0): the send restarts
// the helper for every device, so say who is busy, and refuse to quietly put an older helper over
// a newer one (every device would lose the newer one's features and fixes).

import type { MeshActivityItem, MeshDevice, MeshState } from "../api/mesh";
import { deviceName, othersBusy } from "../state/mesh";
import { compareVersions } from "./semver";

export interface ReplaceCheck {
  /** The running helper is newer than this app's. */
  downgrade: { running: string; ours: string } | null;
  /** Other devices with work on this console right now. */
  busy: { device: MeshDevice; items: MeshActivityItem[] }[];
}

export function replaceCheck(
  state: MeshState | null,
  runningVersion: string | null,
  appVersion: string | null,
): ReplaceCheck {
  const cmp = runningVersion && appVersion ? compareVersions(runningVersion, appVersion) : null;
  return {
    downgrade: cmp === 1 && runningVersion && appVersion ? { running: runningVersion, ours: appVersion } : null,
    busy: othersBusy(state),
  };
}

/** "MacBook: Upload Astro Bot 42%; Pixel: Install Minecraft" */
export function busyText(busy: ReplaceCheck["busy"]): string {
  return busy
    .map(({ device, items }) => {
      const work = items
        .slice(0, 3)
        .map((a) => [a.kind, a.title, typeof a.pct === "number" ? `${a.pct}%` : ""].filter(Boolean).join(" "));
      return `${deviceName(device)}: ${work.join(", ")}`;
    })
    .join("; ");
}
