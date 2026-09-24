#!/usr/bin/env bash
# Roll the backend back to an earlier release directory without touching the database.
#
# Usage:
#   ./scripts/deploy/rollback-backend.sh            # re-activate the release that preceded the current one
#   ./scripts/deploy/rollback-backend.sh --list     # show releases on the instance (* = active)
#   ./scripts/deploy/rollback-backend.sh <release>  # re-activate a specific release id
#   ./scripts/deploy/rollback-backend.sh --restore-env [<release>]
#                                                   # also restore app.env.previous (config written by the last deploy)
#
# Schema migrations are additive, so older releases run against the current database.
# Never restore a database backup as part of a code rollback.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

load_terraform_outputs
require_var LIGHTSAIL_HOST
require_var LIGHTSAIL_INSTANCE_NAME

REMOTE_RELEASE="$SCRIPT_DIR/remote-release.sh"
RESTORE_ENV=false
if [[ "${1:-}" == "--restore-env" ]]; then
  RESTORE_ENV=true
  shift
fi

open_ssh
trap close_ssh EXIT

if [[ "${1:-}" == "--list" ]]; then
  # shellcheck disable=SC2029
  ssh "$SSH_USER@$LIGHTSAIL_HOST" "bash -s -- list" < "$REMOTE_RELEASE"
  exit 0
fi

if [[ "$RESTORE_ENV" == "true" ]]; then
  echo "[rollback] Restoring app.env.previous..."
  # shellcheck disable=SC2029
  ssh "$SSH_USER@$LIGHTSAIL_HOST" "test -f $APP_ENV_FILE.previous && sudo cp $APP_ENV_FILE.previous $APP_ENV_FILE"
fi

echo "[rollback] Switching release..."
# shellcheck disable=SC2029
ssh "$SSH_USER@$LIGHTSAIL_HOST" "bash -s -- rollback ${1:-}" < "$REMOTE_RELEASE"
# shellcheck disable=SC2029
ssh "$SSH_USER@$LIGHTSAIL_HOST" "sleep 3 && systemctl is-active $SERVICE_NAME && curl -s http://localhost:3001/health"
echo ""
echo "[rollback] Done. The frontend is rolled back separately: re-run the Deploy workflow on the earlier tag with force_frontend."
