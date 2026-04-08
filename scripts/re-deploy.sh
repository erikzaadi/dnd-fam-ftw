#!/bin/bash
set -e

# Get the root directory (one level up from the scripts directory)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The destination is where the app is served from
PROJECT_DIR="/var/www/dnd-fam-ftw"
SERVICE_NAME="dnd-fam-ftw-backend.service"

echo "🔄 Syncing and Re-deploying from $ROOT_DIR to $PROJECT_DIR..."

# 1. Sync latest files to deployment directory
# We use the absolute ROOT_DIR path to ensure we sync the right files
sudo rsync -av --exclude='node_modules' --exclude='.git' --exclude='backend/dist' --exclude='frontend/dist' --exclude='*.sqlite' --exclude='*.sqlite-journal' "$ROOT_DIR/" "$PROJECT_DIR/"

# 2. Switch to deployment directory and clean
cd "$PROJECT_DIR"
sudo rm -rf frontend/dist
sudo rm -rf backend/dist
sudo rm -rf frontend/node_modules/.vite

# 3. Ensure dependencies are up to date
npm run install:all

# 4. Build the frontend
echo "Building frontend..."
npm run build

# 4. Build the backend
echo "Building backend..."
npm run build:backend

# 5. Force kill any lingering node/tsx processes
# echo "Ensuring old backend processes are terminated..."
# sudo pkill -f "tsx server/index.ts" || true

# 6. Restart the service
echo "Restarting backend service..."
sudo systemctl daemon-reload
sudo systemctl restart "$SERVICE_NAME"

echo "🚀 Re-deployment complete. Check logs with: journalctl -u $SERVICE_NAME -f"
