import type { Section } from "../sections";
import { t } from "../strings";

/**
 * The left icon rail, a nav region: D-pad left from the content enters it on
 * the active section ([data-nav-entry]), ✕ opens a section.
 */
export function Rail({
  sections,
  active,
  onSelect,
}: {
  sections: Section[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="cw-rail" aria-label={t("cw_nav_sections")} data-nav-region="rail">
      {sections.map((s) => {
        const Icon = s.icon;
        return (
          <button
            key={s.id}
            type="button"
            className="cw-focusable cw-rail-item"
            data-rail-id={s.id}
            aria-current={s.id === active ? "page" : undefined}
            data-nav-entry={s.id === active ? "" : undefined}
            onClick={() => onSelect(s.id)}
          >
            <Icon aria-hidden />
            <span>{t(s.labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}
