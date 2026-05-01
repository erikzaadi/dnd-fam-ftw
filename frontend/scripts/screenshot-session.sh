#!/usr/bin/env bash
set -euo pipefail

# Take screenshots of a session page at every layout breakpoint.
# Usage: ./frontend/scripts/screenshot-session.sh <api-base> <session-id> [display-name]
# Example: ./frontend/scripts/screenshot-session.sh http://localhost:5173 abc123 "Dragon's Lair"
#
# Requires: playwright-cli (brew install playwright-cli)
# Output: frontend/screenshots/<session-slug>-<viewport>-<WxH>.png

if [ $# -lt 2 ]; then
  echo "Usage: $0 <api-base> <session-id> [display-name]"
  exit 1
fi

API_BASE="$1"
SESSION_ID="$2"
DISPLAY_NAME="${3:-$SESSION_ID}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../screenshots"
BROWSER_SESSION="ss-$$"

# shellcheck source=./screenshot-common.sh
source "$SCRIPT_DIR/screenshot-common.sh"

mkdir -p "$OUT_DIR"

SESSION_SLUG=$(sanitize_slug "$DISPLAY_NAME")
URL="$API_BASE/session/$SESSION_ID"

echo "Session: $DISPLAY_NAME ($SESSION_ID)"
echo "Opening browser at $URL ..."
playwright-cli -s="$BROWSER_SESSION" open "$URL"

# Give the page time to fully render
sleep 2

dismiss_audio_overlay "$BROWSER_SESSION"

take_viewport_screenshots "$BROWSER_SESSION" "$SESSION_SLUG" "$OUT_DIR"

playwright-cli -s="$BROWSER_SESSION" close

echo "Screenshots saved to ${OUT_DIR}/"
ls -1 "${OUT_DIR}/${SESSION_SLUG}"*.png
