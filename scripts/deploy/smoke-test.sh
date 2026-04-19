#!/usr/bin/env bash
# Basic smoke tests: checks API health endpoint and frontend loads.
#
# Usage:
#   ./scripts/deploy/smoke-test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

load_terraform_outputs
require_var API_DOMAIN
require_var FRONTEND_DOMAIN

PASS=0
FAIL=0

check() {
  local label="$1"
  local url="$2"
  local expected="${3:-200}"

  status=$(curl -o /dev/null -s -w "%{http_code}" --max-time 10 "$url")
  if [[ "$status" == "$expected" ]]; then
    echo "  PASS  $label ($url) - HTTP $status"
    ((PASS++)) || true
  else
    echo "  FAIL  $label ($url) - expected HTTP $expected, got $status"
    ((FAIL++)) || true
  fi
}

echo "[smoke] Testing https://$API_DOMAIN ..."
check "API health"   "https://$API_DOMAIN/health"
check "API redirect" "http://$API_DOMAIN" "301"

echo ""
echo "[smoke] Testing https://$FRONTEND_DOMAIN ..."
check "Frontend root" "https://$FRONTEND_DOMAIN/"

echo ""
if [[ $FAIL -eq 0 ]]; then
  echo "[smoke] All $PASS checks passed."
else
  echo "[smoke] $FAIL check(s) failed, $PASS passed."
  exit 1
fi
