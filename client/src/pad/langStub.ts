// The controller page the computer's engine serves to a phone's browser (vite.pad.config.ts)
// is built with this in place of state/lang: English only, so the page stays one small file
// (every locale inlined would make it megabytes). Same `useTr` shape as state/lang.

type Vars = Record<string, string | number>;

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

export interface Translator {
  (key: string): string;
  (key: string, fallback: string): string;
  (key: string, vars: Vars | undefined, fallback?: string): string;
}

const tr: Translator = ((key: string, a?: Vars | string, b?: string) =>
  typeof a === "string" ? a : fill(b ?? key, a)) as Translator;

export function useTr(): Translator {
  return tr;
}
