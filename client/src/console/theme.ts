/**
 * The console page's theme: the PC app's four themes and its high-contrast
 * option, applied as `data-theme` / `data-contrast` on <html> (the token
 * blocks are the app's own, see vite.console.config.ts). Stored per viewer in
 * localStorage; a browser that refuses storage still works for the session.
 */

export type Theme = "dark" | "light" | "oled" | "peach";
export const THEMES: Theme[] = ["dark", "light", "oled", "peach"];

const THEME_KEY = "ps5upload.console.theme";
const CONTRAST_KEY = "ps5upload.console.contrast";
const TEXT_SIZE_KEY = "ps5upload.console.textSize";

/** Text size in percent of the page's own (viewport-sized) type (#505). Every size on the page is
 *  rem-based, so this scales the whole layout. Kept per viewer like the theme: the TV and a PC
 *  monitor each keep their own. 100 is the attribute-less default. */
export type TextSize = 75 | 85 | 100 | 115 | 130;
export const TEXT_SIZES: TextSize[] = [75, 85, 100, 115, 130];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage refused: the choice lasts until the page is closed
  }
}

function root(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.documentElement;
}

/** The session's choice, for a browser whose storage refuses writes. */
const session: { theme: Theme | null; high: boolean | null; size: TextSize | null } = {
  theme: null,
  high: null,
  size: null,
};

export function getTextSize(): TextSize {
  const v = Number(read(TEXT_SIZE_KEY));
  return TEXT_SIZES.find((s) => s === v) ?? session.size ?? 100;
}

export function setTextSize(size: TextSize): void {
  session.size = size;
  write(TEXT_SIZE_KEY, String(size));
  applyTextSize(size);
}

function applyTextSize(size: TextSize): void {
  const el = root();
  if (!el) return;
  if (size === 100) el.removeAttribute("data-text-size");
  else el.setAttribute("data-text-size", String(size));
}

export function getTheme(): Theme {
  const v = read(THEME_KEY);
  return THEMES.find((t) => t === v) ?? session.theme ?? "dark";
}

export function getContrast(): boolean {
  const v = read(CONTRAST_KEY);
  if (v === "high") return true;
  if (v === "normal") return false;
  return session.high ?? false;
}

export function setTheme(theme: Theme): void {
  session.theme = theme;
  write(THEME_KEY, theme);
  apply(theme, getContrast());
}

export function setContrast(on: boolean): void {
  session.high = on;
  write(CONTRAST_KEY, on ? "high" : "normal");
  apply(getTheme(), on);
}

/** Dark is the attribute-less default, like the app. */
function apply(theme: Theme, high: boolean): void {
  const el = root();
  if (!el) return;
  if (theme === "dark") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", theme);
  if (high) el.setAttribute("data-contrast", "high");
  else el.removeAttribute("data-contrast");
  // The browser's own controls and scrollbars follow the theme (index.html's head script does the same pre-paint).
  const meta = typeof document.querySelector === "function" ? document.querySelector('meta[name="color-scheme"]') : null;
  if (meta) meta.setAttribute("content", theme === "light" || theme === "peach" ? "light" : "dark");
}

/** Applies the stored (or session) choice: call before the first paint. */
export function applyStoredTheme(): void {
  apply(getTheme(), getContrast());
  applyTextSize(getTextSize());
}
