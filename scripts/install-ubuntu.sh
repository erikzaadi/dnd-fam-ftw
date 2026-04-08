#!/bin/bash
set -e

# Get the root directory (one level up from the scripts directory)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Configuration
PROJECT_DIR="/var/www/dnd-fam-ftw"
SERVICE_NAME="dnd-fam-ftw-backend.service"

echo "🚀 Starting installation for Mission Maker Kid..."

# 1. Update and install Node.js (if missing)
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# 2. Project Directory Setup
echo "Setting up project directory..."
sudo mkdir -p "$PROJECT_DIR"
sudo chown -R $USER:$USER "$PROJECT_DIR"
# Copy from root
cp -r "$ROOT_DIR"/* "$PROJECT_DIR/"

# 3. Install dependencies
echo "Installing dependencies..."
cd "$PROJECT_DIR"
npm install

# 4. Build the frontend for subpath /dnd-fam-ftw/
echo "Building the frontend..."
npm run build

# 5. Set up the backend service
echo "Configuring systemd service..."
sed -i "s/User=ubuntu/User=$USER/" "$PROJECT_DIR/deploy/dnd-fam-ftw-backend.service"
sudo cp "$PROJECT_DIR/deploy/dnd-fam-ftw-backend.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo "✅ Backend service is running."
echo "⚠️  Nginx Configuration Instructions:"
echo "Please add the location blocks from '$PROJECT_DIR/deploy/nginx-site.conf' to your existing Nginx server block."
echo "Then, run: sudo systemctl reload nginx"
echo "Deployment complete."
