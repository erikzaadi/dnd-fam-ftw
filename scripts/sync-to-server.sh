#!/bin/bash
set -e

# Get the root directory (one level up from the scripts directory)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Configuration
DEFAULT_IP=10.0.0.134
TARGET_IP="${TARGET_IP:-${DEFAULT_IP}}"
TARGET_USER="${TARGET_USER:-ubuntu}"
TARGET_DIR="${TARGET_DIR:-/var/www/mission-maker-kid}"

echo "🔄 Syncing files from $ROOT_DIR to ${TARGET_USER}@${TARGET_IP}:${TARGET_DIR}..."

# rsync flags:
# We explicitly exclude sqlite files to protect the remote database
rsync -avz --force --delete \
    --exclude='.git/' \
    --exclude='node_modules/' \
    --exclude='frontend/dist/' \
    --exclude='backend/dist/' \
    --exclude='frontend/node_modules/' \
    --exclude='backend/node_modules/' \
    --exclude='*.sqlite' \
    --exclude='*.sqlite-journal' \
    "$ROOT_DIR/" "${TARGET_USER}@${TARGET_IP}:${TARGET_DIR}/"

echo "✅ Sync complete."
echo "💡 You can now run './scripts/re-deploy.sh' on the server to apply changes."
