#!/usr/bin/env bash
#
# The local pre-release check (`make release-check`): what CI's PR gate covers, run on this
# machine before a release, with the parts that do not depend on each other side by side.
#
#   1. at once:  make quality            (fmt, clippy, tests, client build; CPU-heavy)
#                Playwright e2e suite    (vite dev server on a free port; make quality skips it)
#   2. then:     make test-payload       (builds the payload with the PS5 SDK and checks the ELFs)
#
# Fails if any part fails, and prints each part's result and time. Logs go to a temp folder
# (printed); a failed part's log tail is shown.
#
# BUILD_LOCK=/path/to/lockfile serializes the heavy builds (make quality, make test-payload)
# with other builds sharing that lock (lockf on macOS, flock on Linux). The e2e run never
# holds it: it is a dev server and a browser, not a build.
#
# The e2e suite gets its own vite on a free port through a temporary Playwright config, so a
# dev server already on :1420 (`make run-client`) neither blocks it nor is reused by it.

set -uo pipefail

cd "$(dirname "$0")/../.." || exit 2
root="$PWD"
logs="$(mktemp -d "${TMPDIR:-/tmp}/release-check.XXXXXX")"

locked() {
  if [[ -z "${BUILD_LOCK:-}" ]]; then "$@"
  elif command -v lockf >/dev/null; then lockf -k "$BUILD_LOCK" "$@"
  elif command -v flock >/dev/null; then flock "$BUILD_LOCK" "$@"
  else echo "release-check: BUILD_LOCK set but neither lockf nor flock exists" >&2; return 2
  fi
}

# A port with the next one up also free (vite's live reload may take port + 1).
free_port() {
  node -e '
    const net = require("net");
    const take = (p) => new Promise((ok) => { const s = net.createServer();
      s.once("error", () => ok(false)); s.listen(p, "127.0.0.1", () => s.close(() => ok(true))); });
    (async () => { for (let p = 14200; p < 14400; p += 2)
      if ((await take(p)) && (await take(p + 1))) { console.log(p); return; }
      process.exit(1); })();'
}

e2e() {
  local port cfg
  port="$(free_port)" || { echo "no free port for the e2e dev server"; return 1; }
  # Outside client/ so the concurrent typecheck and lint never see it; paths are absolute.
  cfg="$logs/playwright.config.ts"
  cat > "$cfg" <<EOF
// Temporary (scripts/release/release-check.sh): the e2e suite on its own port.
import base from "$root/client/playwright.config";
const url = "http://127.0.0.1:$port";
export default {
  ...base,
  testDir: "$root/client/e2e",
  outputDir: "$root/output/playwright/test-results",
  use: { ...base.use, baseURL: url },
  webServer: { ...base.webServer, url, cwd: "$root/client", reuseExistingServer: false },
};
EOF
  echo "e2e: vite on 127.0.0.1:$port"
  (cd client && PS5UPLOAD_VITE_PORT="$port" npx playwright test -c "$cfg")
}

declare -a names=() codes=() secs=()
record() { names+=("$1"); codes+=("$2"); secs+=("$3"); }

run_part() { # log, command...
  local log="$1" start rc
  shift
  start=$(date +%s)
  "$@" > "$log" 2>&1
  rc=$?
  echo "$rc $(( $(date +%s) - start ))" > "$log.result"
  return "$rc"
}

trap 'kill $(jobs -p) 2>/dev/null' EXIT INT TERM

echo "release-check: logs in $logs"
echo "release-check: make quality + e2e, side by side..."
run_part "$logs/quality.log" locked make quality &
run_part "$logs/e2e.log" e2e &
wait

for part in quality e2e; do
  read -r rc s < "$logs/$part.log.result" || { rc=1; s=0; }
  record "$part" "$rc" "$s"
done

echo "release-check: make test-payload..."
run_part "$logs/test-payload.log" locked make test-payload
read -r rc s < "$logs/test-payload.log.result" || { rc=1; s=0; }
record test-payload "$rc" "$s"

failed=0
echo
echo "release-check summary"
for i in "${!names[@]}"; do
  if [[ "${codes[$i]}" == 0 ]]; then status=ok; else status="FAILED (exit ${codes[$i]})"; failed=1; fi
  printf '  %-13s %-18s %4ds  %s\n' "${names[$i]}" "$status" "${secs[$i]}" "$logs/${names[$i]}.log"
done
if (( failed )); then
  for i in "${!names[@]}"; do
    [[ "${codes[$i]}" == 0 ]] && continue
    echo
    echo "---- ${names[$i]}: last 40 lines ----"
    tail -n 40 "$logs/${names[$i]}.log"
  done
  exit 1
fi
echo "release-check: all passed"
