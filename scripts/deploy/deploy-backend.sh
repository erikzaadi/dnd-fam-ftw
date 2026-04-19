#!/usr/bin/env bash
# Deploy the backend: build locally, rsync dist to instance, pull SSM secrets,
# write app.env, restart the service.
#
# Usage:
#   ./scripts/deploy/deploy-backend.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

load_terraform_outputs
require_var LIGHTSAIL_HOST
require_var LIGHTSAIL_INSTANCE_NAME
require_var API_DOMAIN
require_var FRONTEND_DOMAIN
require_var IMAGE_BUCKET_URL
require_var IMAGE_BUCKET_NAME
require_var AWS_REGION
require_var SSM_PREFIX
require_var AWS_PROFILE

export AWS_PROFILE
open_ssh
trap close_ssh EXIT

BACKEND_DIR="$ROOT_DIR/backend"

GIT_VERSION=$(git describe --tags --always --dirty 2>/dev/null || git rev-parse --short HEAD)
echo "[backend] Version: $GIT_VERSION"
echo "[backend] Building..."
cd "$BACKEND_DIR"
npm ci
npm run build
cd "$ROOT_DIR"

echo "[backend] Syncing to $LIGHTSAIL_HOST..."
rsync -avz --delete \
  --exclude='node_modules/' \
  "$BACKEND_DIR/dist/" "$SSH_USER@$LIGHTSAIL_HOST:$CURRENT_DIR/dist/"
rsync -avz --delete \
  "$BACKEND_DIR/public/" "$SSH_USER@$LIGHTSAIL_HOST:$CURRENT_DIR/public/"
rsync -avz \
  "$BACKEND_DIR/package.json" \
  "$BACKEND_DIR/package-lock.json" \
  "$SSH_USER@$LIGHTSAIL_HOST:$CURRENT_DIR/"

echo "[backend] Installing production dependencies on instance..."
ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=10 \
  "$SSH_USER@$LIGHTSAIL_HOST" \
  "bash -lc 'cd $CURRENT_DIR && npm ci --omit=dev --no-audit --no-fund'"

echo "[backend] Pulling secrets from SSM..."
SSM_PARAMS=$(aws ssm get-parameters-by-path \
  --path "$SSM_PREFIX" \
  --with-decryption \
  --query 'Parameters[*].[Name,Value]' \
  --output text)

# Build app.env: static config + secrets from SSM
APP_ENV=$(cat << ENV
# Written by deploy-backend.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ") - do not edit manually

# App
APP_BASE_PATH=/
PORT=3001
APP_VERSION=$GIT_VERSION

# Database (on attached disk)
SQLITE_DB_PATH=/mnt/dnd-fam-ftw-data/app.db

# Images (S3)
IMAGE_STORAGE_PROVIDER=s3
AWS_REGION=$AWS_REGION
S3_IMAGE_BUCKET=$IMAGE_BUCKET_NAME
S3_IMAGE_PREFIX=generated/
S3_IMAGE_PUBLIC_BASE_URL=$IMAGE_BUCKET_URL

# Auth
FRONTEND_URL=https://$FRONTEND_DOMAIN
GOOGLE_CALLBACK_URL=https://$API_DOMAIN/auth/google/callback
ENV
)

# Append SSM secrets as KEY=VALUE lines
while IFS=$'\t' read -r name value; do
  key="${name##*/}"  # strip prefix, keep just the param name
  APP_ENV="${APP_ENV}"$'\n'"${key}=${value}"
done <<< "$SSM_PARAMS"

echo "[backend] Writing app.env to instance..."
# shellcheck disable=SC2029
echo "$APP_ENV" | ssh "$SSH_USER@$LIGHTSAIL_HOST" "sudo tee $APP_ENV_FILE > /dev/null && sudo chmod 600 $APP_ENV_FILE && sudo chown ubuntu:ubuntu $APP_ENV_FILE"

echo "[backend] Restarting service..."
# shellcheck disable=SC2029
ssh "$SSH_USER@$LIGHTSAIL_HOST" "sudo systemctl restart $SERVICE_NAME"

echo "[backend] Waiting for service to come up..."
sleep 3
# shellcheck disable=SC2029
ssh "$SSH_USER@$LIGHTSAIL_HOST" "systemctl is-active $SERVICE_NAME"

echo ""
echo "[backend] Deploy complete."
