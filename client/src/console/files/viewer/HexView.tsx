import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatBytes } from "../../../lib/format";
import { t } from "../../strings";
import { HEX_PAGE, hexPage, hexPages } from "./hex";
import "./viewer.css";

/** Rows per focusable block (↑/↓ steps through a page). */
const HEX_BLOCK = 16;

/**
 * The first 64 KiB of a file as offset | hex | ASCII, a page (1 KiB) at a time
 * with Previous / Next page buttons. `size` is the whole file's, when known.
 */
export function HexView({ bytes, size }: { bytes: Uint8Array; size?: number }) {
  const [page, setPage] = useState(0);
  const pages = hexPages(bytes.length);
  const rows = hexPage(bytes, page);
  const from = page * HEX_PAGE;
  const to = Math.min(bytes.length, from + HEX_PAGE) - 1;
  const blocks = [];
  for (let i = 0; i < rows.length; i += HEX_BLOCK) blocks.push(rows.slice(i, i + HEX_BLOCK));
  const partial = size != null && size > bytes.length;
  return (
    <div className="cw-hex">
      <div className="cw-tv-bar">
        <button
          type="button"
          className="cw-focusable cw-button"
          data-action="hex-prev"
          disabled={page <= 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          <ChevronLeft aria-hidden />
          <span>{t("cw_files_vw_page_prev")}</span>
        </button>
        <button
          type="button"
          className="cw-focusable cw-button"
          data-action="hex-next"
          disabled={page >= pages - 1}
          onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
        >
          <ChevronRight aria-hidden />
          <span>{t("cw_files_vw_page_next")}</span>
        </button>
        <span className="cw-dim cw-tv-count" role="status" data-hex-page="">
          {t("cw_files_vw_page", { at: page + 1, n: pages })}
          {bytes.length ? ` · 0x${from.toString(16)}–0x${Math.max(from, to).toString(16)}` : ""}
        </span>
        {partial ? (
          <span className="cw-dim cw-tv-count">{t("cw_files_vw_hex_partial", { size: formatBytes(size ?? 0) })}</span>
        ) : null}
      </div>
      <div className="cw-tv-body cw-hex-body">
        {!bytes.length ? <p className="cw-dim">{t("cw_files_vw_empty")}</p> : null}
        {blocks.map((b, i) => (
          <div key={`${page}-${i}`} className="cw-focusable cw-tv-block" tabIndex={0}>
            {b.map((r) => (
              <div key={r.offset} className="cw-hex-row">
                <span className="cw-hex-off">{r.offset}</span>
                <span className="cw-hex-bytes">{r.hex}</span>
                <span className="cw-hex-ascii">{r.ascii}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
