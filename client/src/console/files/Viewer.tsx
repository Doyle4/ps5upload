import { useCallback, useEffect, useRef, useState } from "react";
import { Binary, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { callBlob } from "../api";
import { t } from "../strings";
import { NAV_ARROW_EVENT } from "../nav";
import { Modal } from "../ui/Modal";
import { HexView } from "./viewer/HexView";
import { HEX_MAX } from "./viewer/hex";
import { gameFacts, isParamJsonPath, paramJsonText, type GameInfo } from "./viewer/gameInfo";
import { imageNeighbours } from "./viewer/images";
import { isJsonName, prettyJson, toRows, type Row } from "./viewer/text";
import { TextView } from "./viewer/TextView";

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
    const want = Math.min(VIEW_MAX, max - at);
    const b = await callBlob("/api/fs/read", { path, offset: at, len: want }, signal);
    parts.push(b);
    at += b.size;
    if (b.size < want) break;
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

/** What the viewer shows a file as: an image, text (JSON pretty printed), or hex. */
export type ViewKind = "image" | "text" | "hex";

export interface TextModel {
  rows: Row[];
  /** A .json file that did not parse (or was cut at 1 MiB): shown as written. */
  jsonRaw: boolean;
  /** sce_sys/param.json's summary. */
  game: GameInfo | null;
}

/** Decoded text as the viewer shows it (pure: tests call it). */
export function textModel(path: string, name: string, text: string): TextModel {
  let shown = text;
  let jsonRaw = false;
  if (isJsonName(name)) {
    const p = prettyJson(text);
    shown = p.text;
    jsonRaw = !p.ok;
  }
  return { rows: toRows(shown), jsonRaw, game: isParamJsonPath(path) ? paramJsonText(text) : null };
}

type Loaded =
  | { kind: "image"; url: string; size: number }
  | { kind: "text"; model: TextModel; size: number }
  | { kind: "hex"; bytes: Uint8Array }
  | { kind: "error" }
  | { kind: "too_large" }
  | null;

/** sce_sys/param.json's summary above its text. */
export function GameSummary({ info }: { info: GameInfo }) {
  return (
    <div className="cw-gb is-summary" data-game-summary="">
      <div className="cw-gb-text">
        <strong className="cw-gb-title">{info.title ?? info.titleId ?? ""}</strong>
        <span className="cw-dim cw-gb-facts">{gameFacts(info)}</span>
        {info.contentId ? <span className="cw-dim cw-mono cw-gb-facts">{info.contentId}</span> : null}
      </div>
    </div>
  );
}

/**
 * The viewer: an image (png/jpg, up to 16 MiB; previous / next through the
 * folder's images), the first 1 MiB of a text file (line numbers, find, wrap;
 * JSON pretty printed, sce_sys/param.json summarized), or the first 64 KiB of
 * any file as hex. Bytes come from /api/fs/read with the token header: an
 * image through a blob: URL (revoked on close), text decoded as UTF-8 (bad
 * bytes become U+FFFD) and rendered as text nodes, never as HTML. ○ closes it.
 */
export function Viewer({
  path,
  name,
  kind,
  size,
  images,
  onOpenImage,
  onClose,
}: {
  path: string;
  name: string;
  kind: ViewKind;
  /** The file's size from the folder listing, when known. */
  size?: number;
  /** The folder's images in list order (an image's previous / next). */
  images?: string[];
  onOpenImage?: (name: string) => void;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>(null);
  /** A text file shown as hex instead (the head's toggle). */
  const [asHex, setAsHex] = useState(false);
  const mode: ViewKind = kind === "text" && asHex ? "hex" : kind;
  const nb = kind === "image" && images ? imageNeighbours(images, name) : null;
  const imageRef = useRef<HTMLImageElement>(null);
  const prevImage = nb?.prev ?? null;
  const nextImage = nb?.next ?? null;

  /** The picture's blob: URL shown now: revoked when the next one replaces it, and on close. */
  const shownUrl = useRef<string | null>(null);
  const showUrl = useCallback((url: string | null) => {
    const old = shownUrl.current;
    shownUrl.current = url;
    if (old && old !== url) URL.revokeObjectURL(old);
  }, []);
  useEffect(() => () => showUrl(null), [showUrl]);

  useEffect(() => {
    let live = true;
    const stop = new AbortController();
    // The next image keeps the one shown (and the focus on it) until it arrives.
    setLoaded((l) => (mode === "image" && l?.kind === "image" ? l : null));
    if (mode === "image" && imageTooLarge(size, null)) {
      showUrl(null);
      setLoaded({ kind: "too_large" }); // nothing read: it would not be shown
      return;
    }
    const max = mode === "image" ? IMAGE_MAX : mode === "hex" ? HEX_MAX : VIEW_MAX;
    readUpTo(path, max, stop.signal).then(
      async (blob) => {
        if (!live) return;
        if (mode === "image") {
          if (imageTooLarge(size, blob.size)) {
            showUrl(null);
            setLoaded({ kind: "too_large" });
            return;
          }
          const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
          const url = URL.createObjectURL(new Blob([blob], { type: ext === "png" ? "image/png" : "image/jpeg" }));
          setLoaded({ kind: "image", url, size: blob.size });
          showUrl(url);
          return;
        }
        const buf = await new Response(blob).arrayBuffer();
        if (!live) return;
        if (mode === "hex") {
          setLoaded({ kind: "hex", bytes: new Uint8Array(buf, 0, Math.min(buf.byteLength, HEX_MAX)) });
          return;
        }
        const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
        setLoaded({ kind: "text", model: textModel(path, name, text), size: blob.size });
      },
      () => {
        if (!live) return;
        showUrl(null);
        setLoaded({ kind: "error" });
      },
    );
    return () => {
      live = false;
      stop.abort();
    };
  }, [path, name, mode, size, showUrl]);

  // ← / → (D-pad or keys) on the picture itself: previous / next image. The nav layer hands
  // left/right on a [data-nav-arrows] element to it as a NAV_ARROW_EVENT instead of moving focus.
  const loadedImage = loaded?.kind === "image";
  useEffect(() => {
    const img = imageRef.current;
    if (!img || !onOpenImage) return;
    const onArrow = (e: Event) => {
      const dir = (e as CustomEvent<"left" | "right">).detail;
      const to = dir === "left" ? prevImage : nextImage;
      if (to) onOpenImage(to);
    };
    img.addEventListener(NAV_ARROW_EVENT, onArrow);
    return () => img.removeEventListener(NAV_ARROW_EVENT, onArrow);
  }, [prevImage, nextImage, onOpenImage, loadedImage]);

  return (
    <Modal label={name} className="cw-viewer" onBack={onClose}>
      <div className="cw-viewer-head">
        <h2 className="cw-file-name">{name}</h2>
        {nb && nb.total > 1 ? (
          <span className="cw-dim cw-viewer-count" data-image-count="">
            {t("cw_files_vw_image_at", { at: nb.at + 1, n: nb.total })}
          </span>
        ) : null}
        {kind === "text" ? (
          <button
            type="button"
            className="cw-focusable cw-button"
            data-action="as-hex"
            aria-pressed={asHex}
            onClick={() => setAsHex((h) => !h)}
          >
            {asHex ? <FileText aria-hidden /> : <Binary aria-hidden />}
            <span>{t(asHex ? "cw_files_vw_as_text" : "cw_files_vw_as_hex")}</span>
          </button>
        ) : null}
        <button type="button" className="cw-focusable cw-button" data-nav-default="" data-action="viewer-close" onClick={onClose}>
          <span>{t("cw_files_close")}</span>
        </button>
      </div>
      <div className={`cw-viewer-body is-${mode}`}>
        {loaded == null ? <p className="cw-dim">{t("cw_home_loading")}</p> : null}
        {loaded?.kind === "error" ? <p className="cw-field-error">{t("cw_files_err_read")}</p> : null}
        {loaded?.kind === "too_large" ? <p className="cw-dim">{t("cw_files_too_large")}</p> : null}
        {mode === "image" && nb && onOpenImage ? (
          <button
            type="button"
            className="cw-focusable cw-button cw-image-nav"
            data-action="image-prev"
            aria-label={t("cw_files_vw_image_prev")}
            data-tip={t("cw_files_vw_image_prev")}
            aria-disabled={!nb.prev || undefined}
            onClick={() => nb.prev && onOpenImage(nb.prev)}
          >
            <ChevronLeft aria-hidden />
          </button>
        ) : null}
        {loaded?.kind === "image" ? (
          <img
            ref={imageRef}
            className="cw-focusable"
            tabIndex={0}
            src={loaded.url}
            alt={name}
            data-image-view=""
            data-nav-arrows={onOpenImage ? "" : undefined}
          />
        ) : null}
        {mode === "image" && nb && onOpenImage ? (
          <button
            type="button"
            className="cw-focusable cw-button cw-image-nav"
            data-action="image-next"
            aria-label={t("cw_files_vw_image_next")}
            data-tip={t("cw_files_vw_image_next")}
            aria-disabled={!nb.next || undefined}
            onClick={() => nb.next && onOpenImage(nb.next)}
          >
            <ChevronRight aria-hidden />
          </button>
        ) : null}
        {loaded?.kind === "text" ? (
          <>
            {loaded.model.game ? <GameSummary info={loaded.model.game} /> : null}
            {loaded.size >= VIEW_MAX ? <p className="cw-dim">{t("cw_files_truncated")}</p> : null}
            {loaded.model.jsonRaw ? <p className="cw-dim">{t("cw_files_vw_json_raw")}</p> : null}
            <TextView key={path} rows={loaded.model.rows} />
          </>
        ) : null}
        {loaded?.kind === "hex" ? <HexView key={path} bytes={loaded.bytes} size={size} /> : null}
      </div>
    </Modal>
  );
}
