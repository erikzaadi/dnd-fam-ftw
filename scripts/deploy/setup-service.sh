#!/usr/bin/env bash
# One-time instance bootstrap: creates app directories, installs the systemd
# service, and writes the Nginx config. Run once after terraform apply + cert provisioning.
#
# Usage:
#   ./scripts/deploy/setup-service.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

load_terraform_outputs
require_var LIGHTSAIL_HOST
require_var LIGHTSAIL_INSTANCE_NAME
require_var API_DOMAIN

open_ssh
trap close_ssh EXIT

echo "[setup] Host:       $LIGHTSAIL_HOST"
echo "[setup] API domain: $API_DOMAIN"
echo ""

ssh -o StrictHostKeyChecking=accept-new \
    "$SSH_USER@$LIGHTSAIL_HOST" \
    bash -s -- "$APP_DIR" "$CURRENT_DIR" "$APP_ENV_FILE" "$SERVICE_NAME" "$API_DOMAIN" << 'ENDSSH'
set -euo pipefail

APP_DIR="$1"
CURRENT_DIR="$2"
APP_ENV_FILE="$3"
SERVICE_NAME="$4"
API_DOMAIN="$5"

# Update and install Node.js (if missing)
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "[setup] Creating app directories..."
sudo mkdir -p "$CURRENT_DIR"
sudo chown -R ubuntu:ubuntu "$APP_DIR"

echo "[setup] Writing systemd service..."
sudo tee /etc/systemd/system/"$SERVICE_NAME".service > /dev/null << SERVICE
[Unit]
Description=dnd-fam-ftw backend
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=$CURRENT_DIR
EnvironmentFile=$APP_ENV_FILE
ExecStart=/usr/bin/env node dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE

echo "[setup] Writing Nginx config for $API_DOMAIN..."
sudo tee /etc/nginx/sites-available/"$SERVICE_NAME" > /dev/null << NGINX
server {
    listen 80;
    server_name $API_DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name $API_DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$API_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$API_DOMAIN/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # SSE endpoints - long-lived streaming connections
    location ~* ^/session/[^/]+/events$ {
        proxy_pass         http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_set_header   Connection '';
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 1h;
    }

    location / {
        proxy_pass         http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/"$SERVICE_NAME" /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

echo "[setup] Enabling systemd service (will start after first deploy)..."
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

echo ""
echo "[setup] Done. Run deploy-backend.sh to push the first build."
ENDSSH
