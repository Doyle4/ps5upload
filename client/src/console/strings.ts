/**
 * Translations for the console page: the `cw_*` keys of the PC app's 21
 * locale files, extracted by scripts/build-console-strings.mjs into
 * strings.gen.json. English is the fallback for any key a locale lacks.
 * The language follows the PS5's system language (navigator.language) until
 * setLanguage overrides it.
 */
import generated from "./strings.gen.json";

export type StringMaps = Record<string, Record<string, string>>;
export type Vars = Record<string, string | number>;

const MAPS = generated as StringMaps;

/** `{name}` placeholders replaced from vars; unknown ones stay as written. */
function interpolate(raw: string, vars?: Vars): string {
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/** A translator over `maps` for `lang`, falling back to English, then to the key. */
export function makeT(maps: StringMaps, lang: string): (key: string, vars?: Vars) => string {
  const own = maps[lang] ?? {};
  const en = maps.en ?? {};
  return (key, vars) => interpolate(own[key] ?? en[key] ?? key, vars);
}

/**
 * The shipped language closest to a BCP-47 tag: an exact match (any case),
 * then Chinese by script/region (Hant, TW, HK, MO → zh-TW; other zh → zh-CN),
 * then the first shipped code with the same primary language, else English.
 */
export function pickLanguage(tag: string | undefined | null, have: string[]): string {
  if (!tag) return "en";
  const lower = tag.toLowerCase();
  const exact = have.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  const parts = lower.split(/[-_]/);
  const primary = parts[0];
  if (primary === "zh") {
    const traditional = parts.some((p) => p === "hant" || p === "tw" || p === "hk" || p === "mo");
    const want = traditional ? "zh-TW" : "zh-CN";
    if (have.includes(want)) return want;
  }
  const same = have.find((c) => c.toLowerCase().split("-")[0] === primary);
  return same ?? "en";
}

export const LANGUAGES: string[] = Object.keys(MAPS);

let current = pickLanguage(typeof navigator !== "undefined" ? navigator.language : "en", LANGUAGES);
let translate = makeT(MAPS, current);

export function getLanguage(): string {
  return current;
}

/** Switch the page's language (Settings' manual override). Re-render after calling. */
export function setLanguage(code: string): void {
  current = pickLanguage(code, LANGUAGES);
  translate = makeT(MAPS, current);
  if (typeof document !== "undefined") {
    document.documentElement.lang = current;
    document.documentElement.dir = current === "ar" || current === "fa" ? "rtl" : "ltr";
  }
}

/** The translation of `key` in the page's language. */
export function t(key: string, vars?: Vars): string {
  return translate(key, vars);
}
