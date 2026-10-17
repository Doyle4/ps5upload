import { useEffect, useState } from "react";
import { callBlob } from "../api";
import { t } from "../strings";
import { Modal } from "../ui/Modal";

/** The most the viewer reads (the helper's /api/fs/read cap). */
export const VIEW_MAX = 1024 * 1024;

/** Images are read whole, 1 MiB per request, up to this much. */
export const IMAGE_MAX = 16 * VIEW_MAX;

/**
 * Read `path` from the start, request after request, until it ends or `max`
 * bytes. `signal` (the viewer closed) stops it before the next request and
 * aborts the one in flight: each holds one of the helper's four web workers.
 */
export async function readUpTo(path: string, max: number, signal?: AbortSignal): Promise<Blob> {
  const parts: Blob[] = [];
  let at = 0;
  while (at < max) {
    if (signal?.aborted) throw new Error("aborted");
    const b = await callBlob("/api/fs/read", { path, offset: at, len: VIEW_MAX }, signal);
    parts.push(b);
    at += b.size;
    if (b.size < VIEW_MAX) break;
  }
  return parts.length === 1 ? parts[0] : new Blob(parts);
}

/**
 * An image the viewer will not show: larger than IMAGE_MAX by its listed size,
 * or (size unknown) the read stopped at the cap — showing those bytes would be
 * a cut-off picture.
 */
export function imageTooLarge(size: number | undefined, read: number | null): boolean {
  if (size != null) return size > IMAGE_MAX;
  return read != null && read >= IMAGE_MAX;
}

/** A text chunk the D-pad steps through: this many lines or characters at most. */
const CHUNK_LINES = 30;
const CHUNK_CHARS = 3000;

/** Split text into focusable blocks so ↑/↓ scroll through it. */
export function textChunks(text: string): string[] {
  const out: string[] = [];
  const lines = text.split("\n");
  let cur: string[] = [];
  let len = 0;
  const flush = () => {
    if (cur.length) out.push(cur.join("\n"));
    cur = [];
    len = 0;
  };
  for (const line of lines) {
    for (let i = 0; i < Math.max(1, line.length); i += CHUNK_CHARS) {
      const part = line.slice(i, i + CHUNK_CHARS);
      if (cur.length >= CHUNK_LINES || len + part.length > CHUNK_CHARS) flush();
      cur.push(part);
      len += part.length;
    }
  }
  flush();
  return out;
}

type Loaded =
  | { kind: "image"; url: string; size: number }
  | { kind: "text"; chunks: string[]; size: number }
  | { kind: "error" }
  | { kind: "too_large" }
  | null;

/**
 * An image (png/jpg, up to 16 MiB) or the first 1 MiB of a text file. The bytes
 * come from /api/fs/read with the token header: an image through a blob: URL (revoked on
 * close), text decoded as UTF-8 (bad bytes become U+FFFD) and shown as text
 * nodes, never as HTML.
 */
export function Viewer({
  path,
  name,
  kind,
  size,
  onClose,
}: {
  path: string;
  name: string;
  kind: "image" | "text";
  /** The file's size from the folder listing, when known. */
  size?: number;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>(null);

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    const stop = new AbortController();
    if (kind === "image" && imageTooLarge(size, null)) {
      setLoaded({ kind: "too_large" }); // nothing read: it would not be shown
      return;
    }
    readUpTo(path, kind === "image" ? IMAGE_MAX : VIEW_MAX, stop.signal).then(
      async (blob) => {
        if (!live) return;
        if (kind === "image") {
          if (imageTooLarge(size, blob.size)) {
            setLoaded({ kind: "too_large" });
            return;
          }
          const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
          url = URL.createObjectURL(new Blob([blob], { type: ext === "png" ? "image/png" : "image/jpeg" }));
          setLoaded({ kind: "image", url, size: blob.size });
          return;
        }
        const buf = await new Response(blob).arrayBuffer();
        if (!live) return;
        const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
        setLoaded({ kind: "text", chunks: textChunks(text), size: blob.size });
      },
      () => {
        if (live) setLoaded({ kind: "error" });
      },
    );
    return () => {
      live = false;
      stop.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, name, kind, size]);

  return (
    <Modal label={name} className="cw-viewer" onBack={onClose}>
      <div className="cw-viewer-head">
        <h2 className="cw-file-name">{name}</h2>
        <button type="button" className="cw-focusable cw-button" data-nav-default="" onClick={onClose}>
          <span>{t("cw_files_close")}</span>
        </button>
      </div>
      <div className="cw-viewer-body">
        {loaded == null ? <p className="cw-dim">{t("cw_home_loading")}</p> : null}
        {loaded?.kind === "error" ? <p className="cw-field-error">{t("cw_files_err_read")}</p> : null}
        {loaded?.kind === "too_large" ? <p className="cw-dim">{t("cw_files_too_large")}</p> : null}
        {loaded?.kind === "image" ? (
          <img className="cw-focusable" tabIndex={0} src={loaded.url} alt={name} />
        ) : null}
        {loaded?.kind === "text" ? (
          <>
            {loaded.size >= VIEW_MAX ? <p className="cw-dim">{t("cw_files_truncated")}</p> : null}
            {loaded.chunks.map((c, i) => (
              <pre key={i} className="cw-focusable cw-viewer-text" tabIndex={0}>
                {c}
              </pre>
            ))}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
