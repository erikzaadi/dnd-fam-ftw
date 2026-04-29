#!/usr/bin/env bash
set -euo pipefail

# Take screenshots of a session page at every layout breakpoint.
# Usage: ./frontend/scripts/screenshot-session.sh [url]
# Default URL: http://localhost:5173/session/seed-session-3
#
# Requires: playwright-cli (brew install playwright-cli)
# Output: frontend/screenshots/

URL="${1:-http://localhost:5173/session/seed-session-3}"
OUT_DIR="$(dirname "$0")/../screenshots"
SESSION="ss-$$"

mkdir -p "$OUT_DIR"

# Viewport definitions: WIDTHxHEIGHT label
VIEWPORTS=(
  "390 844  mobile-portrait"
  "844 390  mobile-landscape"
  "768 1024 tablet-portrait"
  "1024 768 tablet-landscape-md"
  "1280 900 desktop-xl-breakpoint"
  "1920 1080 desktop-1080p"
  "2560 1440 desktop-ultrawide"
  "3440 1440 desktop-ultrawide-21-9"
)

echo "Opening browser at $URL ..."
playwright-cli -s="$SESSION" open "$URL"

# Give the page time to fully render
sleep 2

# Dismiss the audio unlock overlay if present.
# Take a snapshot, find the "Enable Audio" button ref, click it if found.
echo "  -> dismissing audio unlock overlay (if present)"
AUDIO_REF=$(playwright-cli -s="$SESSION" snapshot \
  | grep 'Enable Audio' \
  | sed 's/.*\[ref=\(e[0-9]*\)\].*/\1/' \
  || true)
if [ -n "$AUDIO_REF" ]; then
  echo "     found overlay at ref=${AUDIO_REF}, clicking..."
  playwright-cli -s="$SESSION" click "$AUDIO_REF"
  sleep 0.5
else
  echo "     overlay not present, skipping"
fi

for entry in "${VIEWPORTS[@]}"; do
  read -r w h label <<< "$entry"
  echo "  -> ${label} (${w}x${h})"
  playwright-cli -s="$SESSION" resize "$w" "$h"
  sleep 1
  playwright-cli -s="$SESSION" screenshot --full-page --filename "${OUT_DIR}/${label}-${w}x${h}.png"
done

playwright-cli -s="$SESSION" close

echo ""
echo "Screenshots saved to ${OUT_DIR}/"
ls -1 "$OUT_DIR"/*.png
