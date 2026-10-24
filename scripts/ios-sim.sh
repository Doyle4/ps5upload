#!/usr/bin/env bash
#
# iPhone Simulator lifecycle for `make run-ios`, the iOS counterpart of android-emu.sh.
#
# Subcommands: ensure | stop | grant | status
#
#   ensure  reuses a booted iPhone simulator, or boots one (and opens Simulator.app so it can
#           be seen and used). Prints "<booted|preexisting><TAB><device name>" so the caller
#           knows the device to run on and whether it owns it (and should shut it down).
#   stop    shuts down the simulator `ensure` booted (PS5UPLOAD_IOS_SIM_UDID).
#   status  lists the iPhone simulators and which are booted.
#
# Pick a device with PS5UPLOAD_IOS_SIM="iPhone 17 Pro" (any model `xcrun simctl list devicetypes`
# can create); by default a booted iPhone, else the newest Pro Max (created on first use).
#
# The Simulator needs Xcode's iOS platform once (several GB):  xcodebuild -downloadPlatform iOS
# It is a look-and-feel tool: the app runs on this Mac's network, so it can reach a PS5 on the
# LAN, but iOS limits a real iPhone has (background suspension, the local-network prompt, the
# Files app sandbox as on a phone) do not all apply. The .ipa for real iPhones is `make ios-build`.

set -euo pipefail

die() { echo "ios-sim: $*" >&2; exit 1; }

need_xcode() {
  command -v xcrun >/dev/null 2>&1 || die "Xcode is required (xcrun not found)"
  xcrun simctl help >/dev/null 2>&1 || die "Xcode's simctl is not usable; open Xcode once to finish its setup"
}

# Decide the simulator to use, across every installed iOS runtime. Prints one line:
#   use<TAB><udid><TAB><name><TAB><state>          an existing simulator
#   create<TAB><name><TAB><devicetype><TAB><runtime>  one to create first
# or nothing when no iOS runtime is installed. $1 is the wanted model ("" = default: a booted
# iPhone, else the newest generation's Pro Max). A model is paired with the newest runtime that
# supports it (Xcode can list models a given runtime cannot run: "Incompatible device").
plan() {
  python3 - "$1" "$(xcrun simctl list runtimes --json)" "$(xcrun simctl list devices --json)" <<'PY'
import json, re, sys
want, runtimes, devices = sys.argv[1], json.loads(sys.argv[2])["runtimes"], json.loads(sys.argv[3])["devices"]
ios = [r for r in runtimes if r.get("platform") == "iOS" and r.get("isAvailable")]
if not ios:
    sys.exit(0)
ver = lambda r: [int(x) for x in r["version"].split(".")]
ios.sort(key=ver, reverse=True)  # newest first
phones = [(r, d) for r in ios for d in devices.get(r["identifier"], [])
          if d.get("isAvailable") and d["name"].startswith("iPhone")]
if not want:
    for r, d in phones:
        if d["state"] == "Booted":
            print("use", d["udid"], d["name"], d["state"], sep="\t"); sys.exit(0)
    best = None
    for r in ios:
        for t in r.get("supportedDeviceTypes", []):
            m = re.fullmatch(r"iPhone (\d+) Pro Max", t["name"])
            if m and (best is None or int(m.group(1)) > best):
                best = int(m.group(1))
    want = f"iPhone {best} Pro Max" if best else ""
    if not want:
        sys.exit("no Pro Max model in any installed iOS runtime; name one with PS5UPLOAD_IOS_SIM")
for r, d in phones:
    if d["name"] == want:
        print("use", d["udid"], d["name"], d["state"], sep="\t"); sys.exit(0)
for r in ios:
    for t in r.get("supportedDeviceTypes", []):
        if t["name"] == want:
            print("create", want, t["identifier"], r["identifier"], sep="\t"); sys.exit(0)
sys.exit(f'no installed iOS runtime can run "{want}" (xcrun simctl list runtimes)')
PY
}

ensure() {
  need_xcode
  local p kind udid name state
  p="$(plan "${PS5UPLOAD_IOS_SIM:-}")" || exit 1
  [ -n "$p" ] || die "no iOS Simulator runtime installed. Install it once (several GB):
    xcodebuild -downloadPlatform iOS"
  kind="$(printf '%s' "$p" | cut -f1)"
  if [ "$kind" = "create" ]; then
    name="$(printf '%s' "$p" | cut -f2)"
    echo "ios-sim: creating an $name simulator..." >&2
    udid="$(xcrun simctl create "$name" "$(printf '%s' "$p" | cut -f3)" "$(printf '%s' "$p" | cut -f4)")"
    state="Shutdown"
  else
    udid="$(printf '%s' "$p" | cut -f2)"
    name="$(printf '%s' "$p" | cut -f3)"
    state="$(printf '%s' "$p" | cut -f4)"
  fi
  if [ "$state" = "Booted" ]; then
    open -a Simulator >/dev/null 2>&1 || true
    printf 'preexisting\t%s\t%s\n' "$name" "$udid"
    return
  fi
  echo "ios-sim: booting $name..." >&2
  xcrun simctl boot "$udid"
  open -a Simulator --args -CurrentDeviceUDID "$udid" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
  printf 'booted\t%s\t%s\n' "$name" "$udid"
}

stop() {
  local udid="${PS5UPLOAD_IOS_SIM_UDID:-}"
  [ -n "$udid" ] || die "PS5UPLOAD_IOS_SIM_UDID is not set"
  xcrun simctl shutdown "$udid" 2>/dev/null || true
  # Close the Simulator app too, unless another simulator is still running in it.
  if ! xcrun simctl list devices booted 2>/dev/null | grep -q '(Booted)'; then
    osascript -e 'tell application "Simulator" to quit' >/dev/null 2>&1 || true
  fi
}

# Pre-grant every privacy permission the Simulator can grant (photos, location, ...; it has no
# switch for notifications or the local-network prompt, which a simulator does not show) to the
# app, so a run never stops at a prompt. Works before the app is installed.
grant() {
  local udid="${PS5UPLOAD_IOS_SIM_UDID:-}"
  [ -n "$udid" ] || die "PS5UPLOAD_IOS_SIM_UDID is not set"
  if xcrun simctl privacy "$udid" grant all com.phantomptr.ps5upload >/dev/null 2>&1; then
    echo "ios-sim: privacy permissions granted to com.phantomptr.ps5upload" >&2
  else
    echo "ios-sim: could not pre-grant privacy permissions (the app will ask)" >&2
  fi
}

status() {
  need_xcode
  xcrun simctl list devices available | grep -E '^-- iOS|iPhone' || echo "no iOS Simulator runtime installed (xcodebuild -downloadPlatform iOS)"
  local p; p="$(plan "${PS5UPLOAD_IOS_SIM:-}" 2>&1)" || true
  echo "run-ios would use: ${p:-nothing}"
}

case "${1:-}" in
  ensure) ensure ;;
  stop) stop ;;
  grant) grant ;;
  status) status ;;
  *) die "usage: $0 ensure|stop|grant|status" ;;
esac
