// Serves the production build (dist/) with the desktop and phone apps' Content-Security-Policy
// (src-tauri/tauri.conf.json), for the e2e project "app-csp". The dev server sends no such
// policy, so code the apps refuse (a blob: or data: worklet, the Remote Play mic) passed every
// test and failed in every app. Build first (npm run build:vite; CI does).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../dist");
const conf = JSON.parse(fs.readFileSync(path.resolve(here, "../../src-tauri/tauri.conf.json"), "utf8"));
const csp = conf.app.security.csp;
const port = Number(process.env.PORT ?? 1421);
const types = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".md": "text/markdown",
  ".wasm": "application/wasm",
};

if (!fs.existsSync(path.join(dist, "index.html"))) {
  process.stderr.write(`serve-dist-csp: no build at ${dist}; run npm run build:vite first\n`);
  process.exit(1);
}

http
  .createServer((req, res) => {
    let file = path.join(dist, decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(dist, "index.html"); // the app's routes
    }
    res.writeHead(200, {
      "content-type": types[path.extname(file)] ?? "application/octet-stream",
      "content-security-policy": csp,
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, "127.0.0.1");
