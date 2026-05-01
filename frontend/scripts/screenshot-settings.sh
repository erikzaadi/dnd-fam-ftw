#!/usr/bin/env bash
set -euo pipefail

# Take screenshots of the settings page at every layout breakpoint.
# Usage: ./frontend/scripts/screenshot-settings.sh [api-base]
# Default api-base: http://localhost:5173
#
# Requires: playwright-cli (brew install playwright-cli)
# Output: frontend/screenshots/settings-<viewport>-<WxH>.png

API_BASE="${1:-http://localhost:5173}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../screenshots"
BROWSER_SESSION="ss-$$"

# shellcheck source=./screenshot-common.sh
source "$SCRIPT_DIR/screenshot-common.sh"

mkdir -p "$OUT_DIR"

URL="$API_BASE/settings"
echo "Opening browser at $URL ..."
playwright-cli -s="$BROWSER_SESSION" open "$URL"
sleep 2

dismiss_audio_overlay "$BROWSER_SESSION"
take_viewport_screenshots "$BROWSER_SESSION" "settings" "$OUT_DIR"

playwright-cli -s="$BROWSER_SESSION" close

echo "Screenshots saved to ${OUT_DIR}/"
ls -1 "${OUT_DIR}/settings"*.png
