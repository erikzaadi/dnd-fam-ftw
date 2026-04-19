#!/usr/bin/env bash
# Run a backend management script on the remote production instance.
#
# Usage:
#   ./scripts/deploy/run-script.sh <script> [args...]
#
# Available scripts:
#   users           list | add <email> [name] | remove <email>
#   namespaces      list | create <name> | rename <id> <name> | delete <id> | sessions <id> | assign-session <sessionId> <namespaceId> | add-user <nsId> <email> | set-limits <id> [--max-sessions N] [--max-turns N]
#   list-sessions
#   nuke-sessions
#   seed-sessions
#   usage-metrics   [--json]
#   invite-requests list | clear [--json]
#
# Examples:
#   ./scripts/deploy/run-script.sh users list
#   ./scripts/deploy/run-script.sh users add someone@gmail.com "Their Name"
#   ./scripts/deploy/run-script.sh namespaces list
#   ./scripts/deploy/run-script.sh list-sessions

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

load_terraform_outputs
require_var LIGHTSAIL_HOST
require_var LIGHTSAIL_INSTANCE_NAME

open_ssh
trap close_ssh EXIT

SCRIPT_NAME="${1:-}"
if [[ -z "$SCRIPT_NAME" ]]; then
  echo "Usage: $0 <script> [args...]"
  echo "Available: users, namespaces, list-sessions, nuke-sessions, seed-sessions"
  exit 1
fi
shift

# Map npm script name to compiled JS path
case "$SCRIPT_NAME" in
  users)           JS_PATH="dist/scripts/users.js" ;;
  namespaces)      JS_PATH="dist/scripts/namespaces.js" ;;
  list-sessions)   JS_PATH="dist/scripts/listSessions.js" ;;
  nuke-sessions)   JS_PATH="dist/scripts/nukeSessions.js" ;;
  seed-sessions)   JS_PATH="dist/scripts/seedSessions.js" ;;
  usage-metrics)   JS_PATH="dist/scripts/usageMetrics.js" ;;
  invite-requests) JS_PATH="dist/scripts/inviteRequests.js" ;;
  *)
    echo "Unknown script: $SCRIPT_NAME"
    echo "Available: users, namespaces, list-sessions, nuke-sessions, seed-sessions"
    exit 1
    ;;
esac

# shellcheck disable=SC2029,SC2240
ssh "$SSH_USER@$LIGHTSAIL_HOST" \
  "cd $CURRENT_DIR && DOTENV_QUIET=true node --env-file=$APP_ENV_FILE $JS_PATH $*"
