#!/usr/bin/env bash
set -euo pipefail

# Seed sessions and screenshot all pages for visual diffing.
# The dev server must already be running (npm run dev).
#
# Usage: ./frontend/scripts/ci-screenshots.sh [api-base]
# Default api-base: http://localhost:5173
#
# Requires: playwright-cli (brew install playwright-cli), jq, curl
# Output: frontend/screenshots/<slug>-<viewport>-<WxH>.png

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
API_BASE="${1:-http://localhost:5173}"

echo "==> Checking dev server at $API_BASE ..."
if ! curl -sf "$API_BASE/api/sessions" > /dev/null; then
  echo "Error: dev server not reachable at $API_BASE - run 'npm run dev' first."
  exit 1
fi

echo "==> Seeding sessions ..."
(cd "$REPO_ROOT" && npm run cli -- sessions seed)

echo "==> Fetching seeded sessions ..."
if ! SESSIONS_JSON=$(curl -sf "$API_BASE/api/sessions"); then
  echo "Error: failed to fetch sessions from $API_BASE/api/sessions"
  exit 1
fi

COUNT=$(echo "$SESSIONS_JSON" | jq 'length')
if [ "$COUNT" -eq 0 ]; then
  echo "No sessions found after seeding."
  exit 1
fi
echo "Found $COUNT session(s)."
echo ""

while IFS=$'\t' read -r sid sname; do
  echo "==> [$sid] $sname"
  "$SCRIPT_DIR/screenshot-session.sh" "$API_BASE" "$sid" "$sname"
  echo ""
done < <(echo "$SESSIONS_JSON" | jq -r '.[] | "\(.id)\t\(.displayName)"')

echo "==> Home page"
"$SCRIPT_DIR/screenshot-home.sh" "$API_BASE"
echo ""

echo "==> Settings page"
"$SCRIPT_DIR/screenshot-settings.sh" "$API_BASE"
echo ""

echo "All screenshots complete."
