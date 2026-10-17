import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, WrapText } from "lucide-react";
import { t } from "../../strings";
import {
  BLOCK_ROWS,
  findMatches,
  firstMatchFrom,
  highlight,
  ROW_WINDOW,
  stepMatch,
  windowFor,
  type Match,
  type Row,
} from "./text";
import "./viewer.css";

/** "3 of 17", "No matches", "10,000+ matches" (null before the first find). */
export function findCountText(query: string, count: number, current: number, capped: boolean): string | null {
  if (!query) return null;
  if (!count) return t("cw_files_vw_find_none");
  if (capped && current < 0) return t("cw_files_vw_find_many", { n: count.toLocaleString() });
  const at = t("cw_files_vw_find_at", { at: current + 1, n: count.toLocaleString() });
  return capped ? `${at} · ${t("cw_files_vw_find_capped")}` : at;
}

/**
 * Numbered rows of text with find (the field, then Previous / Next: on-screen
 * buttons, ✕ on each) and a wrap toggle. Rows are drawn ROW_WINDOW at a time
 * ("Show more lines", or a match further down extends it), in focusable
 * blocks the D-pad steps through. Text is rendered as text nodes, never HTML.
 */
export function TextView({ rows }: { rows: Row[] }) {
  const [field, setField] = useState("");
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(-1);
  const [wrap, setWrap] = useState(true);
  const [limit, setLimit] = useState(ROW_WINDOW);
  const body = useRef<HTMLDivElement>(null);
  const found = useMemo(() => findMatches(rows, query), [rows, query]);
  const { matches, capped } = found;

  const byRow = useMemo(() => {
    const m = new Map<number, { start: number; end: number; index: number }[]>();
    matches.forEach((x: Match, index) => {
      const list = m.get(x.row);
      if (list) list.push({ start: x.start, end: x.end, index });
      else m.set(x.row, [{ start: x.start, end: x.end, index }]);
    });
    return m;
  }, [matches]);

  // A new current match: draw down to it, then bring it into view (focus stays on Next / Previous).
  useEffect(() => {
    if (current < 0 || current >= matches.length) return;
    const row = matches[current].row;
    if (row >= limit) {
      setLimit((l) => windowFor(row, l));
      return;
    }
    const el = body.current?.querySelector<HTMLElement>(`[data-match="${current}"]`);
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center", inline: "nearest" });
  }, [current, matches, limit]);

  /** Find what the field holds: a new query starts at the first match; the same one steps on. */
  const go = (dir: 1 | -1) => {
    if (field !== query) {
      const next = findMatches(rows, field);
      setQuery(field);
      setCurrent(dir === 1 ? firstMatchFrom(next.matches, 0) : next.matches.length - 1);
      return;
    }
    setCurrent((c) => stepMatch(c, matches.length, dir));
  };

  const shown = rows.slice(0, limit);
  const blocks: Row[][] = [];
  for (let i = 0; i < shown.length; i += BLOCK_ROWS) blocks.push(shown.slice(i, i + BLOCK_ROWS));
  const gutter = String(rows.length ? rows[rows.length - 1].line : 1).length;
  const count = findCountText(query, matches.length, current, capped);

  return (
    <div className="cw-tv">
      <form
        className="cw-tv-bar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go(1);
        }}
      >
        <label className="cw-tv-find">
          <Search aria-hidden />
          <input
            className="cw-focusable cw-input"
            type="text"
            value={field}
            placeholder={t("cw_files_vw_find")}
            aria-label={t("cw_files_vw_find")}
            data-action="find-field"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => setField(e.target.value)}
          />
        </label>
        <button type="button" className="cw-focusable cw-button" data-action="find-prev" disabled={!field} onClick={() => go(-1)}>
          <ChevronUp aria-hidden />
          <span>{t("cw_files_vw_prev")}</span>
        </button>
        <button type="submit" className="cw-focusable cw-button" data-action="find-next" disabled={!field}>
          <ChevronDown aria-hidden />
          <span>{t("cw_files_vw_next")}</span>
        </button>
        <span className="cw-dim cw-tv-count" role="status" data-find-count="">
          {count ?? ""}
        </span>
        <button
          type="button"
          className="cw-focusable cw-button"
          data-action="wrap"
          aria-pressed={wrap}
          onClick={() => setWrap((w) => !w)}
        >
          <WrapText aria-hidden />
          <span>{t("cw_files_vw_wrap")}</span>
        </button>
      </form>
      <div ref={body} className={`cw-tv-body${wrap ? " is-wrap" : ""}`} style={{ ["--cw-gutter" as string]: `${gutter}ch` }}>
        {!rows.length ? <p className="cw-dim">{t("cw_files_vw_empty")}</p> : null}
        {blocks.map((b, bi) => (
          <div key={bi} className="cw-focusable cw-tv-block" tabIndex={0}>
            {b.map((r, ri) => {
              const index = bi * BLOCK_ROWS + ri;
              const marks = byRow.get(index);
              return (
                <div key={ri} className="cw-tv-row">
                  <span className="cw-tv-n" aria-hidden>
                    {r.cont ? "" : r.line}
                  </span>
                  <span className="cw-tv-t">
                    {marks
                      ? highlight(r.text, marks).map(([s, mi], k) =>
                          mi < 0 ? (
                            s
                          ) : (
                            <mark key={k} data-match={mi} className={mi === current ? "is-current" : undefined}>
                              {s}
                            </mark>
                          ),
                        )
                      : r.text}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {rows.length > limit ? (
          <button
            type="button"
            className="cw-focusable cw-button cw-more"
            data-action="more-lines"
            onClick={() => setLimit((l) => l + ROW_WINDOW)}
          >
            <span>{t("cw_files_vw_more_lines", { n: (rows.length - limit).toLocaleString() })}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
