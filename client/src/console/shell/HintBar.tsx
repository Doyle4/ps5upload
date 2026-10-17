import { verifiedButtons, type InputMap, type NavAction } from "../nav";
import { t } from "../strings";

const LABELS: Partial<Record<NavAction, string>> = {
  confirm: "cw_hint_open",
  back: "cw_hint_back",
  actions: "cw_actions",
  select: "cw_select",
  prevSection: "cw_hint_switch_section",
  nextSection: "cw_hint_switch_section",
  filter: "cw_hint_filter",
};

/**
 * The controller hints along the bottom. Only bindings measured on a console
 * (verified) are shown, so the bar never advertises a button that does nothing;
 * with none verified it renders nothing.
 */
export function HintBar({ map }: { map: InputMap }) {
  const groups: { labelKey: string; glyphs: string[] }[] = [];
  for (const b of verifiedButtons(map)) {
    const labelKey = LABELS[b.action];
    if (!labelKey || !b.glyph) continue;
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
