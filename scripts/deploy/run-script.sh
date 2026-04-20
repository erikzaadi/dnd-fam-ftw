#!/usr/bin/env bash
# Run a backend management command on the remote production instance.
# Full reference: MANAGE.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

load_terraform_outputs
require_var LIGHTSAIL_HOST
require_var LIGHTSAIL_INSTANCE_NAME

open_ssh
trap close_ssh EXIT

RESOURCE="${1:-}"
if [[ -z "$RESOURCE" ]]; then
  echo "Usage: $0 <resource> [sub-command] [args...]"
  echo "See MANAGE.md for the full reference."
  exit 1
fi

# shellcheck disable=SC2029,SC2240
ssh "$SSH_USER@$LIGHTSAIL_HOST" \
  "cd $CURRENT_DIR && DOTENV_QUIET=true node --env-file=$APP_ENV_FILE dist/scripts/cli.js $*"
