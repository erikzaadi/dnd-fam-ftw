#!/usr/bin/env bash
# Provision a Let's Encrypt TLS certificate on the Lightsail instance.
# Uses certbot with DNS-01 challenge via Route 53 - no port 80 needed.
# Reads instance IP and certbot IAM credentials from terraform outputs.
#
# Prerequisites:
#   - terraform apply has completed successfully
#   - SSH key for the instance is loaded (ssh-agent or ~/.ssh/id_rsa)
#
# Usage:
#   ./scripts/provision-cert.sh <admin-email> [instance-ip]
#
#   admin-email  - email for Let's Encrypt expiry notifications
#   instance-ip  - override the IP from terraform output (useful if DNS hasn't propagated yet)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="$SCRIPT_DIR/../terraform"

ADMIN_EMAIL="${1:-}"
if [[ -z "$ADMIN_EMAIL" ]]; then
  echo "Usage: $0 <admin-email> [instance-ip]"
  exit 1
fi

echo "[cert] Reading terraform outputs..."
INSTANCE_NAME=$(cd "$TERRAFORM_DIR" && terraform output -raw lightsail_instance_name)
INSTANCE_IP="${2:-$(cd "$TERRAFORM_DIR" && terraform output -raw lightsail_static_ip)}"
API_DOMAIN=$(cd "$TERRAFORM_DIR" && terraform output -raw api_url | sed 's|https://||')
CERTBOT_KEY_ID=$(cd "$TERRAFORM_DIR" && terraform output -raw certbot_access_key_id)
CERTBOT_SECRET=$(cd "$TERRAFORM_DIR" && terraform output -raw certbot_secret_access_key)

echo "[cert] Instance:  $INSTANCE_IP"
echo "[cert] Domain:    $API_DOMAIN"
echo "[cert] Email:     $ADMIN_EMAIL"
echo ""

MY_IP=$(curl -s https://checkip.amazonaws.com)
close_port() {
  echo "[cert] Closing port 22 for $MY_IP..."
  aws lightsail close-instance-public-ports \
    --instance-name "$INSTANCE_NAME" \
    --port-info fromPort=22,toPort=22,protocol=TCP,cidrs="[\"$MY_IP/32\"]"
}
echo "[cert] Opening port 22 for $MY_IP on $INSTANCE_NAME..."
aws lightsail open-instance-public-ports \
  --instance-name "$INSTANCE_NAME" \
  --port-info fromPort=22,toPort=22,protocol=TCP,cidrs="[\"$MY_IP/32\"]"
trap close_port EXIT

# Run everything in one SSH session.
# bash -s -- args passes positional args to the remote script via stdin.
# Single-quoted heredoc (ENDSSH) means no local variable expansion - $ is safe to use remotely.
ssh -o StrictHostKeyChecking=accept-new \
    ubuntu@"$INSTANCE_IP" \
    bash -s -- "$API_DOMAIN" "$ADMIN_EMAIL" "$CERTBOT_KEY_ID" "$CERTBOT_SECRET" << 'ENDSSH'
set -euo pipefail

DOMAIN="$1"
EMAIL="$2"
CERTBOT_KEY_ID="$3"
CERTBOT_SECRET="$4"

echo "[cert] Installing certbot and Route 53 plugin..."
# export DEBIAN_FRONTEND=noninteractive
# sudo apt-get update -q
# sudo apt-get install -yq certbot python3-certbot-dns-route53

echo "[cert] Writing certbot AWS credentials..."
sudo mkdir -p /root/.aws
printf '[certbot]\naws_access_key_id = %s\naws_secret_access_key = %s\n' \
  "$CERTBOT_KEY_ID" "$CERTBOT_SECRET" | sudo tee /root/.aws/certbot > /dev/null
sudo chmod 600 /root/.aws/certbot

echo "[cert] Requesting certificate for $DOMAIN (DNS-01 via Route 53)..."
sudo -E AWS_SHARED_CREDENTIALS_FILE=/root/.aws/certbot AWS_CONFIG_FILE=/root/.aws/certbot AWS_PROFILE=certbot \
  certbot certonly \
    --dns-route53 \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    -d "$DOMAIN"

echo "[cert] Fixing permissions so nginx (www-data) can read certs..."
sudo chmod 755 /etc/letsencrypt/live
sudo chmod 755 /etc/letsencrypt/archive
sudo chgrp www-data /etc/letsencrypt/archive/"$DOMAIN"/privkey*.pem
sudo chmod 640 /etc/letsencrypt/archive/"$DOMAIN"/privkey*.pem

echo "[cert] Installing renewal cron (daily at 03:00)..."
(sudo crontab -l 2>/dev/null || true | grep -v certbot; \
  echo "0 3 * * * AWS_SHARED_CREDENTIALS_FILE=/root/.aws/certbot AWS_PROFILE=certbot certbot renew --quiet --deploy-hook 'chgrp www-data /etc/letsencrypt/archive/*/privkey*.pem && systemctl reload nginx'") \
  | sudo crontab -

echo ""
echo "[cert] Done. Certificate files:"
echo "       /etc/letsencrypt/live/$DOMAIN/fullchain.pem"
echo "       /etc/letsencrypt/live/$DOMAIN/privkey.pem"
ENDSSH

echo ""
echo "[cert] Certificate provisioned. Add to your Nginx config:"
echo "       ssl_certificate     /etc/letsencrypt/live/$API_DOMAIN/fullchain.pem;"
echo "       ssl_certificate_key /etc/letsencrypt/live/$API_DOMAIN/privkey.pem;"
