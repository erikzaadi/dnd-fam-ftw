#!/usr/bin/env bash
# Deploy the frontend: build with production env vars, sync to S3, invalidate CloudFront.
#
# Usage:
#   ./scripts/deploy/deploy-frontend.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

load_terraform_outputs
require_var FRONTEND_BUCKET
require_var CF_DIST_ID
require_var API_DOMAIN
require_var FRONTEND_DOMAIN
require_var AWS_PROFILE

export AWS_PROFILE

FRONTEND_DIR="$ROOT_DIR/frontend"

echo "[frontend] Building..."
echo "[frontend] API:      https://$API_DOMAIN"
echo "[frontend] Base URL: https://$FRONTEND_DOMAIN"
echo ""

GIT_VERSION=$(git describe --tags --always --dirty 2>/dev/null || git rev-parse --short HEAD)
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "[frontend] Version: $GIT_VERSION"

# Write version.json into public/ so it is included in the build output
cat > "$FRONTEND_DIR/public/version.json" <<EOF
{"version":"$GIT_VERSION","buildTime":"$BUILD_TIME"}
EOF

cd "$FRONTEND_DIR"
npm ci
VITE_API_BASE_URL="https://$API_DOMAIN" \
VITE_BASE_PATH="/" \
npm run build
cd "$ROOT_DIR"

echo "[frontend] Syncing to s3://$FRONTEND_BUCKET ..."

# Hashed assets: long cache
aws s3 sync "$FRONTEND_DIR/dist/assets/" "s3://$FRONTEND_BUCKET/assets/" \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --no-progress

# index.html and other root files: no cache (always fresh)
aws s3 sync "$FRONTEND_DIR/dist/" "s3://$FRONTEND_BUCKET/" \
  --delete \
  --exclude "assets/*" \
  --cache-control "no-cache, no-store, must-revalidate" \
  --no-progress

echo "[frontend] Invalidating CloudFront distribution $CF_DIST_ID ..."
aws cloudfront create-invalidation \
  --distribution-id "$CF_DIST_ID" \
  --paths "/*" \
  --no-cli-pager

echo ""
echo "[frontend] Deploy complete. Live at https://$FRONTEND_DOMAIN"
