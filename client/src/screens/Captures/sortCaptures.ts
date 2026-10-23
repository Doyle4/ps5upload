import type { ScreenshotEntry } from "../../api/ps5";

export type CaptureSort = "newest" | "oldest" | "smallest" | "biggest";

/** Sort a copy so refreshing, deleting and selecting still use the original list.
 * Dates are the PS5's modification times, as displayed beside each capture.
 * Captures without a usable date stay last in either date order. */
export function sortCaptures(
  items: readonly ScreenshotEntry[],
  sort: CaptureSort,
): ScreenshotEntry[] {
  return [...items].sort((a, b) => {
    let order: number;
    if (sort === "newest" || sort === "oldest") {
      const aHasDate = Number.isFinite(a.mtime) && a.mtime > 0;
      const bHasDate = Number.isFinite(b.mtime) && b.mtime > 0;
      if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;
      order = aHasDate ? (a.mtime - b.mtime) * (sort === "newest" ? -1 : 1) : 0;
    } else {
      order = (a.size - b.size) * (sort === "biggest" ? -1 : 1);
    }
    // A fixed path order avoids jumping rows when the console returns ties in a new order.
    return order || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  });
}
