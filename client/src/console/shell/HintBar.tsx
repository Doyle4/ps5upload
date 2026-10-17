import type { InputMap } from "../nav";
import { barHints, type ScreenId } from "../help/hints";
import { t } from "../strings";

/** A hint's glyph chips (shared with the help overlay). */
export function Glyphs({ glyphs }: { glyphs: string[] }) {
  return (
    <>
      {glyphs.map((glyph) => (
        <span key={glyph} className="cw-glyph" aria-hidden>
          {glyph}
        </span>
      ))}
    </>
  );
}

/**
 * The controller hints along the bottom, for the screen in front: ✕ and ○
 * always (○ is the browser's own Back, ✕ its click), and the buttons with a
 * job on this screen only once measured on a console (verified), so the bar
 * never advertises a button that does nothing.
 */
export function HintBar({ map, screen }: { map: InputMap; screen: ScreenId }) {
  const hints = barHints(map, screen);
  if (!hints.length) return null;
  return (
    <footer className="cw-hints" aria-label={t("cw_hints_label")} data-screen={screen}>
      {hints.map((h) => (
        <span key={h.labelKey} className="cw-hint">
          <Glyphs glyphs={h.glyphs} />
          {t(h.labelKey)}
        </span>
      ))}
    </footer>
  );
}
