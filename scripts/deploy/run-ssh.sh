#!/usr/bin/env bash
# Run a ssh session the remote production instance.
#
# Usage:
#   ./scripts/deploy/run-ssh.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

load_terraform_outputs
require_var LIGHTSAIL_HOST
require_var LIGHTSAIL_INSTANCE_NAME

open_ssh
trap close_ssh EXIT

# shellcheck disable=SC2029,SC2240
ssh "$SSH_USER@$LIGHTSAIL_HOST"
