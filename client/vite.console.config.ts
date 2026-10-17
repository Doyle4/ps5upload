/**
 * Build of the console web page (src/console/) that the helper serves on the
 * PS5 itself: `npm run build:console` → dist-console/index.html, ONE file with
 * the script and styles inlined (payload/Makefile gzips it and embeds it in
 * ps5upload.elf; the helper serves it at GET /).
 *
 * - Target safari13 like the PC app (the PS5 browser is WebKit). BigInt cannot
 *   be down-levelled and is rejected by the client lint rule.
 * - The PC app's dark-theme tokens come from src/index.css itself (pcTokens),
 *   not a copy, so the page follows the app's colours.
 * - Size budget: the build FAILS over 640 KiB raw or 150 KiB gzip.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const RAW_BUDGET = 640 * 1024;
const GZIP_BUDGET = 150 * 1024;
const TOKENS_ID = "virtual:pc-tokens.css";

/** The `{…}` body that starts at `open` (the index of a "{"), braces balanced. */
function blockBody(css: string, open: number): string {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("pcTokens: unbalanced braces in src/index.css");
}

/**
 * virtual:pc-tokens.css = the PC app's font stacks (its Tailwind @theme block)
 * and its dark :root token block, read from src/index.css at build time.
 * Importing index.css itself would pull in Tailwind and every app rule.
 */
function pcTokens(): Plugin {
  const file = fileURLToPath(new URL("./src/index.css", import.meta.url));
  return {
    name: "ps5upload-console-pc-tokens",
    resolveId(id) {
      return id === TOKENS_ID ? `\0${TOKENS_ID}` : undefined;
    },
    load(id) {
      if (id !== `\0${TOKENS_ID}`) return undefined;
      this.addWatchFile(file);
      const css = readFileSync(file, "utf8");
      const theme = css.indexOf("@theme {");
      const dark = css.indexOf(":root {");
      if (theme < 0 || dark < 0) this.error("pcTokens: @theme or :root block not found in src/index.css");
      const themeBody = blockBody(css, css.indexOf("{", theme));
      const darkBody = blockBody(css, css.indexOf("{", dark));
      return `:root {${themeBody}}\n:root {${darkBody}}\n`;
    },
  };
}

/** Move every emitted script and stylesheet into index.html, then enforce the budget. */
function singleFile(): Plugin {
  return {
    name: "ps5upload-console-single-file",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      const html = Object.values(bundle).find((f) => f.type === "asset" && f.fileName === "index.html");
      if (!html || html.type !== "asset") return this.error("singleFile: no index.html in the bundle");
      let page = String(html.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === "chunk") {
          const re = new RegExp(`<script[^>]*src="[^"]*${escapeRe(name)}"[^>]*></script>`);
          if (!re.test(page)) return this.error(`singleFile: ${name} is not referenced by index.html`);
          // Escape "</script" so the code cannot close its own tag.
          const code = file.code.replace(/<\/script/gi, "<\\/script");
          page = page.replace(re, () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (file.fileName.endsWith(".css")) {
          const re = new RegExp(`<link[^>]*href="[^"]*${escapeRe(name)}"[^>]*>`);
          if (!re.test(page)) return this.error(`singleFile: ${name} is not referenced by index.html`);
          const css = String(file.source).replace(/<\/style/gi, "<\\/style");
          page = page.replace(re, () => `<style>${css}</style>`);
          delete bundle[name];
        }
      }
      const left = Object.keys(bundle).filter((n) => n !== "index.html");
      if (left.length) return this.error(`singleFile: files left outside index.html: ${left.join(", ")}`);
      html.source = page;

      const raw = Buffer.byteLength(page);
      const gz = gzipSync(page, { level: 9 }).length;
      const kib = (n: number) => `${(n / 1024).toFixed(1)} KiB`;
      this.info(`console page: ${kib(raw)} raw, ${kib(gz)} gzip (budget ${kib(RAW_BUDGET)} / ${kib(GZIP_BUDGET)})`);
      if (raw > RAW_BUDGET || gz > GZIP_BUDGET) {
        this.error(`console page over budget: ${kib(raw)} raw (max ${kib(RAW_BUDGET)}), ${kib(gz)} gzip (max ${kib(GZIP_BUDGET)})`);
      }
    },
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default defineConfig({
  root: fileURLToPath(new URL("./src/console", import.meta.url)),
  base: "./",
  publicDir: false,
  plugins: [react(), pcTokens(), singleFile()],
  clearScreen: false,
  build: {
    outDir: fileURLToPath(new URL("./dist-console", import.meta.url)),
    emptyOutDir: true,
    target: "safari13",
    cssTarget: "safari13",
    // One chunk, no preload helper: everything ends up inline.
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    reportCompressedSize: false,
    rollupOptions: {
      // @ts-expect-error checks is a rolldown passthrough not typed by Vite (see vite.config.ts)
      checks: { pluginTimings: false },
    },
  },
});
