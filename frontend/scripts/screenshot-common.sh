# shellcheck shell=bash
# Common definitions sourced by screenshot scripts.
# Do not execute directly.

# Viewport definitions: WIDTH HEIGHT label
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

sanitize_slug() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed -E 's/^-+//;s/-+$//'
}

# dismiss_audio_overlay <browser-session>
dismiss_audio_overlay() {
  local browser_session="$1"
  local audio_ref
  echo "  -> dismissing audio unlock overlay (if present)"
  audio_ref=$(playwright-cli -s="$browser_session" snapshot \
    | grep 'Enable Audio' \
    | sed 's/.*\[ref=\(e[0-9]*\)\].*/\1/' \
    || true)
  if [ -n "$audio_ref" ]; then
    echo "     found overlay at ref=${audio_ref}, clicking..."
    playwright-cli -s="$browser_session" click "$audio_ref"
    sleep 0.5
  else
    echo "     overlay not present, skipping"
  fi
}

# take_viewport_screenshots <browser-session> <slug> <out-dir>
take_viewport_screenshots() {
  local browser_session="$1"
  local slug="$2"
  local out_dir="$3"
  for entry in "${VIEWPORTS[@]}"; do
    read -r w h label <<< "$entry"
    echo "  -> ${label} (${w}x${h})"
    playwright-cli -s="$browser_session" resize "$w" "$h"
    sleep 1
    playwright-cli -s="$browser_session" screenshot --full-page --filename "${out_dir}/${slug}-${label}-${w}x${h}.png"
  done
}
