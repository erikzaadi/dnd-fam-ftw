# shellcheck shell=bash
# shellcheck disable=SC2034  # all vars here are used by sourcing scripts
# shellcheck disable=SC1090  # dynamic source path is intentional
# Sourced by all deploy scripts. Do not execute directly.
# Loads .env.deploy if present, validates required vars, sets common paths.

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPTS_DIR/../.." && pwd)"
TERRAFORM_DIR="$ROOT_DIR/terraform"

ENV_FILE="$SCRIPTS_DIR/.env.deploy"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "[deploy] ERROR: $name is not set. Fill in scripts/deploy/.env.deploy or export the variable."
    exit 1
  fi
}

# Attempt to fill missing vars from terraform outputs (requires terraform state)
terraform_output() {
  local key="$1"
  (cd "$TERRAFORM_DIR" && terraform output -raw "$key" 2>/dev/null) || true
}

load_terraform_outputs() {
  LIGHTSAIL_HOST="${LIGHTSAIL_HOST:-$(terraform_output lightsail_static_ip)}"
  LIGHTSAIL_INSTANCE_NAME="${LIGHTSAIL_INSTANCE_NAME:-$(terraform_output lightsail_instance_name)}"
  FRONTEND_BUCKET="${FRONTEND_BUCKET:-$(terraform_output frontend_bucket_name)}"
  CF_DIST_ID="${CF_DIST_ID:-$(terraform_output cloudfront_distribution_id)}"
  API_DOMAIN="${API_DOMAIN:-$(terraform_output api_url | sed 's|https://||')}"
  FRONTEND_DOMAIN="${FRONTEND_DOMAIN:-$(terraform_output frontend_url | sed 's|https://||')}"
  IMAGE_BUCKET_URL="${IMAGE_BUCKET_URL:-$(terraform_output image_bucket_url)}"
  IMAGE_BUCKET_NAME="${IMAGE_BUCKET_NAME:-$(terraform_output image_bucket_name)}"
  AWS_REGION="${AWS_REGION:-eu-west-1}"
  SSM_PREFIX="${SSM_PREFIX:-/dnd-fam-ftw/prod}"
  AWS_PROFILE="${AWS_PROFILE:-dnd-fam-ftw-terraform}"
  export AWS_PROFILE
}

# Open port 22 on the Lightsail instance for this machine's IP only.
# Call open_ssh early in any script that SSHes, and pair with: trap close_ssh EXIT
_SSH_OPENED_IP=""
open_ssh() {
  local my_ip out
  my_ip=$(curl -s https://checkip.amazonaws.com)
  _SSH_OPENED_IP="$my_ip"
  echo "[ssh] Opening port 22 for $my_ip..." >&2
  out=$(aws lightsail open-instance-public-ports \
    --no-cli-pager \
    --instance-name "$LIGHTSAIL_INSTANCE_NAME" \
    --port-info fromPort=22,toPort=22,protocol=TCP,cidrs="[\"$my_ip/32\"]" 2>&1) || {
    echo "[ssh] ERROR opening port 22: $out" >&2; return 1
  }
  
  # Lightsail firewall rules can take time to propagate. Poll until port 22 is open.
  echo "[ssh] Waiting for port 22 to become reachable..." >&2
  local max_attempts=30
  local attempt=1
  while ! nc -z -w 3 "$LIGHTSAIL_HOST" 22 > /dev/null 2>&1; do
    if [[ $attempt -ge $max_attempts ]]; then
      echo "[ssh] ERROR: Port 22 never became reachable after $max_attempts attempts." >&2
      echo "[ssh] Check if your IP ($my_ip) matches the CIDR in Lightsail and that no other firewall is blocking." >&2
      return 1
    fi
    echo "[ssh] Port 22 not yet reachable, waiting... ($attempt/$max_attempts)" >&2
    sleep 2
    attempt=$((attempt + 1))
  done
  echo "[ssh] Port 22 is reachable." >&2
}

close_ssh() {
  if [[ -n "$_SSH_OPENED_IP" ]]; then
    local out
    out=$(aws lightsail close-instance-public-ports \
      --no-cli-pager \
      --instance-name "$LIGHTSAIL_INSTANCE_NAME" \
      --port-info fromPort=22,toPort=22,protocol=TCP,cidrs="[\"$_SSH_OPENED_IP/32\"]" 2>&1) || {
      echo "[ssh] ERROR closing port 22: $out" >&2; return 1
    }
    _SSH_OPENED_IP=""
  fi
}

APP_DIR=/opt/dnd-fam-ftw
APP_ENV_FILE="$APP_DIR/app.env"
CURRENT_DIR="$APP_DIR/current"
SERVICE_NAME=dnd-fam-ftw
SSH_USER=ubuntu
