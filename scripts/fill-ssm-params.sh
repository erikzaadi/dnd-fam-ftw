#!/usr/bin/env bash
# Fill SSM parameter values after `terraform apply` has created the placeholders.
# Run this once - Terraform will not overwrite these values after initial creation.
#
# Usage:
#   ./scripts/fill-ssm-params.sh [aws-profile] [ssm-prefix]
#
#   aws-profile - AWS CLI profile to use (default: dnd-fam-ftw-terraform)
#   ssm-prefix  - SSM parameter prefix (default: /dnd-fam-ftw/prod)

set -euo pipefail

AWS_PROFILE="${1:-dnd-fam-ftw-terraform}"
SSM_PREFIX="${2:-/dnd-fam-ftw/prod}"

export AWS_PROFILE

put_secure() {
  local name="$1"
  local value="$2"
  aws ssm put-parameter \
    --name "${SSM_PREFIX}/${name}" \
    --value "$value" \
    --type SecureString \
    --overwrite \
    --no-cli-pager
  echo "[ssm] Set ${SSM_PREFIX}/${name} (SecureString)"
}

put_string() {
  local name="$1"
  local value="$2"
  aws ssm put-parameter \
    --name "${SSM_PREFIX}/${name}" \
    --value "$value" \
    --type String \
    --overwrite \
    --no-cli-pager
  echo "[ssm] Set ${SSM_PREFIX}/${name} (String)"
}

prompt() {
  local var_name="$1"
  # local description="$2"
  local secret="${2:-false}"
  local value=""

  # echo ""
  # printf "  %s - %s", "$var_name" "$description"
  # echo "  $var_name - $description"
  if [[ "$secret" == "true" ]]; then
    read -r -s -p "  Value (hidden): " value
    # echo ""
  else
    read -r -p "  Value: " value
  fi

  if [[ -z "$value" ]]; then
    echo "  [skip] Empty value, skipping $var_name"
    return 1
  fi

  echo "$value"
  # last_value=${value}
}

echo "[ssm] Using AWS profile: $AWS_PROFILE"
echo "[ssm] SSM prefix: $SSM_PREFIX"
echo ""
echo "Enter values for each parameter. Press Enter with no value to skip."
echo "Skipped parameters keep their current value in SSM."

echo ""
echo " GOOGLE_CLIENT_ID - Google OAuth client ID (ends in .apps.googleusercontent.com)"
# GOOGLE_CLIENT_ID
if value=$(prompt "GOOGLE_CLIENT_ID"); then
  put_string "GOOGLE_CLIENT_ID" "$value"
fi

echo ""
echo " GOOGLE_CLIENT_SECRET - Google OAuth client secret)"
## GOOGLE_CLIENT_SECRET
if value=$(prompt "GOOGLE_CLIENT_SECRET" true); then
  put_secure "GOOGLE_CLIENT_SECRET" "$value"
fi

echo ""
echo " ADMIN_EMAIL - Admin Google email - auto-created as user on startup"
## ADMIN_EMAIL
if value=$(prompt "ADMIN_EMAIL"); then
  put_string "ADMIN_EMAIL" "$value"
fi

# JWT_SECRET
echo ""
echo "  JWT_SECRET - Secret for signing JWT tokens"
echo "  Press Enter to auto-generate a secure random value, or type one manually."
read -r -s -p "  Value (hidden, Enter to generate): " jwt_value
echo ""
if [[ -z "$jwt_value" ]]; then
  jwt_value="$(openssl rand -hex 32)"
  echo "  [auto] Generated random JWT_SECRET"
fi
put_secure "JWT_SECRET" "$jwt_value"

# OPENAI_API_KEY
echo ""
echo " OPENAI_API_KEY - OpenAI API key (sk-...) - skip if using Gemini/LocalAI only"
if value=$(prompt "OPENAI_API_KEY" true); then
  put_secure "OPENAI_API_KEY" "$value"
fi

# # GEMINI_API_KEY
# if value=$(prompt "GEMINI_API_KEY" "Google Gemini API key - skip if using OpenAI/LocalAI only" true); then
#   put_secure "GEMINI_API_KEY" "$value"
# fi

echo ""
echo "[ssm] Done. Verify with:"
echo "  aws ssm get-parameters-by-path --path \"$SSM_PREFIX\" --with-decryption --profile $AWS_PROFILE"
