#!/usr/bin/env node
/*
 * The console web page's translations: every `cw_*` key from all 21 locale
 * files under client/src/i18n/locales/, written to
 * client/src/console/strings.gen.json as { "<locale>": { "cw_…": "…" } }.
 *
 * The page (client/src/console/strings.ts) imports that JSON instead of the
 * PC app's locale modules, so it ships only its own strings. `npm run
 * build:console` runs this first; the file is committed so typecheck and
 * tests work without a build, and strings.test.ts fails when it is stale.
 *
 * Locale files are read the way scripts/i18n-coverage.mjs reads them: the
 * `const <id>: Translations = { … }` literal evaluated in an isolated vm
 * context, never regex-parsed for values. Keep the matcher in sync with that
 * script if the locale-file shape changes.
 *
 * Usage: node scripts/build-console-strings.mjs [--check]
 *   --check  exit 1 when the committed file differs, write nothing.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES_DIR = path.join(repoRoot, "client/src/i18n/locales");
const OUT_PATH = path.join(repoRoot, "client/src/console/strings.gen.json");
const PREFIX = "cw_";

function loadLocale(fp) {
  const src = fs.readFileSync(fp, "utf8");
  const startMatch = src.match(/^const\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*Translations\s*=\s*/m);
  if (!startMatch) throw new Error(`${fp}: could not find 'const <name>: Translations = ' declaration`);
  const startIdx = startMatch.index + startMatch[0].length;
  const endMatch = src.slice(startIdx).match(/\n};\s*\n\s*export default/);
  if (!endMatch) throw new Error(`${fp}: could not find end of literal (};\\nexport default)`);
  const literalSrc = src.slice(startIdx, startIdx + endMatch.index + "\n}".length);
  return vm.runInNewContext(`(${literalSrc})`, Object.create(null), { timeout: 1000 });
}

/** { locale: { cw_key: value } }, locales and keys sorted, English required. */
export function extractConsoleStrings() {
  const files = fs
    .readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .sort();
  const out = {};
  for (const f of files) {
    const dict = loadLocale(path.join(LOCALES_DIR, f));
    const picked = {};
    for (const key of Object.keys(dict).sort()) {
      if (key.startsWith(PREFIX)) picked[key] = dict[key];
    }
    out[f.replace(/\.ts$/, "")] = picked;
  }
  if (!out.en) throw new Error(`${LOCALES_DIR} has no en.ts`);
  return out;
}

function main() {
  const text = `${JSON.stringify(extractConsoleStrings(), null, 2)}\n`;
  const old = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, "utf8") : null;
  if (process.argv.includes("--check")) {
    if (old !== text) {
      console.error(`${path.relative(repoRoot, OUT_PATH)} is stale: run node scripts/build-console-strings.mjs`);
      process.exit(1);
    }
    return;
  }
  // Rewrite only on a change, so the payload's make rule does not see a new mtime for nothing.
  if (old !== text) fs.writeFileSync(OUT_PATH, text);
  const n = Object.keys(JSON.parse(text).en).length;
  console.log(`console strings: ${n} keys × ${Object.keys(JSON.parse(text)).length} locales`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
