/**
 * Where the console keeps a capture's thumbnail, as measured on FW 13.60 (2026-10-28):
 *
 *   /user/av_contents/photo/<app>/<title>/<n>/X.jxr   -> .../thumbnails/photo/.../X.jxr.jxr
 *   /user/av_contents/photo/<app>/<title>/<n>/X.jpg   -> .../thumbnails/photo/.../X.jpg.jpeg
 *   /user/av_contents/video/<app>/<title>/<n>/X.webm  -> .../thumbnails/video/.../X.webm.jxr
 *
 * Null for a path outside those trees (a capture copied elsewhere has no thumbnail).
 */
export function captureThumbPath(fullPath: string): string | null {
  for (const kind of ["photo", "video"] as const) {
    const marker = `/av_contents/${kind}/`;
    if (!fullPath.includes(marker)) continue;
    const thumb = fullPath.replace(marker, `/av_contents/thumbnails/${kind}/`);
    if (kind === "video") return `${thumb}.jxr`;
    return /\.(jpe?g|png)$/i.test(fullPath) ? `${thumb}.jpeg` : `${thumb}.jxr`;
  }
  return null;
}

/** Whether the capture itself is small enough to stand in for a missing thumbnail: an SDR
 *  picture (a few hundred KiB), never an HDR .jxr (megabytes) or a clip. */
export function captureIsItsOwnThumb(fullPath: string): boolean {
  return /\.(jpe?g|png)$/i.test(fullPath);
}
