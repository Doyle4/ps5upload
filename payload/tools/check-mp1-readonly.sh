#!/bin/sh
# The helper READS the GPU and CPU clocks from /dev/mp1 (mp1_clock.c) and must never change
# them. The same driver accepts three requests that do: the GFX clock set, the power mode
# switch and the per-core P-state set. A clock change on a retail console is not something this
# app offers, and a wrong one can crash a game or the console. This fails if any of those
# requests shows up anywhere in payload/ sources in any spelling: the full request number in
# hex, its signed or unsigned decimal, the short 0xAE17-style form, an _IO*() macro built from
# group 0xAE and number 0x17/0x18/0x1D, or the names other projects give them.
#
# Usage: check-mp1-readonly.sh [payload-dir]   (default: the payload/ next to this script)
set -eu

DIR="${1:-$(dirname "$0")/..}"
SELF="check-mp1-readonly.sh"

# 0x8004AE17 (GFX clock set), 0xC004AE18 (mode switch), 0x8008AE1D (core P-state set).
PATTERN='0x0*(8004ae17|c004ae18|8008ae1d)'
PATTERN="$PATTERN"'|\b0x0*ae1[78d]([^0-9a-f]|$)'
PATTERN="$PATTERN"'|(^|[^0-9])(2147790359|3221532184|2148052509|2147176937|1073435112|2146914787)([^0-9]|$)'
PATTERN="$PATTERN"'|_IO[RW]*[[:space:]]*\([[:space:]]*(0xae|174|'"'"'\\xae'"'"')[[:space:]]*,[[:space:]]*(0x0*1[78d]|23|24|29)\b'
PATTERN="$PATTERN"'|SET_GFXCLK|REQUEST_MODE_SWITCH|SET_COREPSTATE|CPU_SET_IOCTL|gpu_backend_set|cpu_backend_set'

# Text sources only (-I skips binaries). Vendored code is scanned too (a request number has no
# business there either); only the generated build/ output is skipped.
hits=$(grep -rIniE "$PATTERN" "$DIR" \
    --include='*.c' --include='*.h' --include='*.inc' --include='*.def' --include='*.S' \
    --include='*.s' --include='*.cpp' --include='*.cc' --include='*.hpp' --include='*.mk' \
    --include='Makefile' --include='*.sh' --include='*.py' \
    --exclude-dir=build --exclude="$SELF" || true)

if [ -n "$hits" ]; then
    echo "$hits"
    echo
    echo "ERROR: a /dev/mp1 request that CHANGES a clock appears above. The helper only reads"
    echo "clocks (payload/include/mp1_clock.h); remove it."
    exit 1
fi
echo "  /dev/mp1: read requests only"
