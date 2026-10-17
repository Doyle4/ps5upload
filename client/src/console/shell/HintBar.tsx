import { hintEntries, type ButtonAction, type InputMap } from "../nav";
import { t } from "../strings";

const LABELS: Partial<Record<ButtonAction, string>> = {
  confirm: "cw_hint_open",
  back: "cw_hint_back",
  actions: "cw_actions",
  select: "cw_select",
  prevSection: "cw_hint_switch_section",
  nextSection: "cw_hint_switch_section",
  pageUp: "cw_hint_page",
  pageDown: "cw_hint_page",
  top: "cw_hint_top",
  rail: "cw_nav_sections",
  help: "cw_hint_help",
  refresh: "cw_hint_refresh",
  fullscreen: "cw_hint_fullscreen",
};

/**
 * The controller hints along the bottom: ✕ and ○ always (○ is the browser's
 * own Back, ✕ its click), every other button only once it was measured on a
 * console (verified), so the bar never advertises a button that does nothing.
 */
export function HintBar({ map }: { map: InputMap }) {
  const groups: { labelKey: string; glyphs: string[] }[] = [];
  for (const b of hintEntries(map)) {
    const labelKey = LABELS[b.action];
    if (!labelKey) continue;
    const g = groups.find((x) => x.labelKey === labelKey);
    if (g) g.glyphs.push(b.glyph);
    else groups.push({ labelKey, glyphs: [b.glyph] });
  }
  if (!groups.length) return null;
  return (
    <footer className="cw-hints" aria-label={t("cw_hints_label")}>
      {groups.map((g) => (
        <span key={g.labelKey} className="cw-hint">
          {g.glyphs.map((glyph) => (
            <span key={glyph} className="cw-glyph" aria-hidden>
              {glyph}
            </span>
          ))}
          {t(g.labelKey)}
        </span>
      ))}
    </footer>
  );
}
