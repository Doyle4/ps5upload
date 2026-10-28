import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, type LucideIcon } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";

import {
  convertScreenshot,
  saveArchiveCleanupTemp,
  saveArchiveMakeTemp,
  startTransferDownload,
  waitForJob,
} from "../../api/ps5";
import { consoleAddr } from "../../lib/addr";
import { captureIsItsOwnThumb, captureThumbPath } from "../../lib/captureThumb";
import { isJxrScreenshot, joinDir, pngNameForJxr } from "../../lib/screenshotConvert";
import { basename } from "../../lib/uploadDest";

// Inline thumbnails for Captures' screenshots and video clips: the console's own small
// thumbnail (lib/captureThumb), downloaded once and decoded to a PNG when it is JPEG XR.

/** Shared, per-mount thumbnail cache + scratch dir, threaded into each row's
 *  <ScreenshotThumb> so a decoded thumbnail survives re-renders and re-scrolls
 *  (decoded once) and the scratch dir is cleaned on unmount. */
export interface ThumbCache {
  urls: Map<string, string>;
  inflight: Map<string, Promise<string | null>>;
  dir: { current: string | null };
  /** Set when the screen unmounts: a thumbnail still waiting for its turn is not fetched. */
  closed: { current: boolean };
}

/** Thumbnail downloads in flight at once, across every mount. Each one is a transfer job on
 *  the console's session; a screen of rows started them all together, filled every data lane
 *  and kept doing so after the screen was left, which made the Games tab stutter (#450). */
const THUMB_PARALLEL = 2;
let thumbActive = 0;
const thumbWaiting: Array<() => void> = [];

async function thumbSlot<T>(work: () => Promise<T>): Promise<T> {
  if (thumbActive >= THUMB_PARALLEL) {
    await new Promise<void>((resolve) => thumbWaiting.push(resolve));
  }
  thumbActive += 1;
  try {
    return await work();
  } finally {
    thumbActive -= 1;
    thumbWaiting.shift()?.();
  }
}

/** Download a shot's (thumbnail, else full-res) `.jxr` and decode it to a
 *  WebView-renderable PNG — the same pipeline the Preview lightbox uses, just
 *  cached for inline thumbnails. SDR `.jpg/.png` shots are shown as-is. */
async function buildThumb(
  item: { path: string },
  host: string,
  cache: ThumbCache,
): Promise<string | null> {
  if (cache.urls.has(item.path)) return cache.urls.get(item.path) ?? null;
  const existing = cache.inflight.get(item.path);
  if (existing) return existing;
  const run = thumbSlot(async (): Promise<string | null> => {
    if (cache.closed.current) return null;
    if (!cache.dir.current) cache.dir.current = await saveArchiveMakeTemp("ss-thumb");
    const dir = cache.dir.current;
    const fetchDecode = async (srcPath: string): Promise<string> => {
      const name = basename(srcPath);
      const jobId = await startTransferDownload(
        srcPath,
        dir,
        consoleAddr(host.trim()),
        "file",
      );
      await waitForJob(jobId);
      const local = joinDir(dir, name);
      if (isJxrScreenshot(name)) {
        const png = joinDir(dir, pngNameForJxr(name));
        await convertScreenshot(local, png, true);
        return convertFileSrc(png);
      }
      return convertFileSrc(local);
    };
    const thumb = captureThumbPath(item.path);
    let url: string;
    try {
      // A shot outside the capture tree has no thumbnail: the shot itself is the picture.
      url = await fetchDecode(thumb ?? item.path);
    } catch {
      // No thumbnail (the console had none for many shots in #450). An SDR .jpg/.png is a
      // few hundred KiB, so it stands in; an HDR .jxr is megabytes per row, so that row keeps
      // its glyph and Preview still opens it.
      if (!thumb || !captureIsItsOwnThumb(item.path)) return null;
      try {
        url = await fetchDecode(item.path);
      } catch {
        return null;
      }
    }
    cache.urls.set(item.path, url);
    return url;
  });
  cache.inflight.set(item.path, run);
  try {
    return await run;
  } finally {
    cache.inflight.delete(item.path);
  }
}

/** Inline lazy thumbnail: a generic glyph until the row scrolls near view, then
 *  the decoded shot. Desktop-only (`enabled`, gated on the JPEG XR codec); on
 *  mobile or decode failure it stays the glyph. */
export function CaptureThumb({
  item,
  host,
  enabled,
  cache,
  icon: Icon = ImageIcon,
}: {
  item: { path: string };
  host: string;
  enabled: boolean;
  cache: ThumbCache;
  /** Shown until the thumbnail is there (and when there is none). */
  icon?: LucideIcon;
}) {
  const [url, setUrl] = useState<string | null>(
    () => cache.urls.get(item.path) ?? null,
  );
  const [near, setNear] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (url || near || !boxRef.current) return;
    const el = boxRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          obs.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [url, near]);

  useEffect(() => {
    if (!near || url || !enabled || !host?.trim()) return;
    let cancelled = false;
    buildThumb(item, host, cache)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [near, url, enabled, host, item, cache]);

  // The file behind a URL can be gone: the scratch dir is deleted when this
  // console's screens are hidden (keep-alive), and this row keeps its state.
  // Drop the dead URL and decode again, once; a second failure keeps the glyph.
  const retried = useRef(false);
  const onBroken = () => {
    cache.urls.delete(item.path);
    if (retried.current) return;
    retried.current = true;
    setUrl(null);
  };

  return (
    <div
      ref={boxRef}
      className="grid h-12 w-16 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-field)] bg-[var(--color-surface-3)]"
    >
      {url ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={onBroken}
        />
      ) : (
        <Icon size={14} className="text-[var(--color-muted)]" />
      )}
    </div>
  );
}


/** One thumbnail cache per screen: decoded URLs and a scratch dir, created once, the dir
 *  removed when the screen goes. */
export function useThumbCache(): ThumbCache {
  // Lazy inline-thumbnail cache: decoded URLs + a scratch dir, created once and
  // stable across renders so a thumbnail decodes once. Held in state (not a ref)
  // so passing it to rows isn't a render-time ref read. Scratch dir cleaned on
  // unmount.
  const [thumbCache] = useState<ThumbCache>(() => ({
    urls: new Map(),
    inflight: new Map(),
    dir: { current: null },
    closed: { current: false },
  }));
  useEffect(() => {
    // Open again after a StrictMode remount or when this console's screens
    // come back from keep-alive; closed on the real unmount.
    thumbCache.closed.current = false;
    return () => {
      thumbCache.closed.current = true;
      const d = thumbCache.dir.current;
      thumbCache.dir.current = null;
      // The URLs point into that dir: forget them with it, or a row shown
      // again (or mounted later) would load a file that no longer exists.
      thumbCache.urls.clear();
      if (d) void saveArchiveCleanupTemp(d).catch(() => {});
    };
  }, [thumbCache]);
  return thumbCache;
}
