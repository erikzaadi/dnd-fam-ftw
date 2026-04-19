#!/usr/bin/env bash
# Creates the IAM user and policy that Terraform needs to provision all resources.
# Run this once with an admin AWS profile before the first `terraform apply`.
#
# Usage:
#   ./scripts/create-terraform-user.sh [aws-profile]
#
#   aws-profile - AWS CLI profile with admin permissions (default: default)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POLICY_FILE="$SCRIPT_DIR/../terraform/terraform-iam-policy.json"

AWS_PROFILE="${1:-default}"
USER_NAME="dnd-fam-ftw-terraform"
POLICY_NAME="dnd-fam-ftw-terraform"

export AWS_PROFILE

echo "[iam] Using AWS profile: $AWS_PROFILE"
echo "[iam] Creating IAM user: $USER_NAME"

# Create user (idempotent - ignore error if already exists)
if aws iam get-user --user-name "$USER_NAME" &>/dev/null; then
  echo "[iam] User $USER_NAME already exists, skipping creation"
else
  aws iam create-user --user-name "$USER_NAME" --tags Key=project,Value=dnd-fam-ftw
  echo "[iam] Created user $USER_NAME"
fi

# Get the current AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"

# Create or update the policy
if aws iam get-policy --policy-arn "$POLICY_ARN" &>/dev/null; then
  echo "[iam] Policy $POLICY_NAME already exists, updating..."
  # Get non-default versions and delete them (AWS allows max 5 versions)
  VERSIONS=$(aws iam list-policy-versions --policy-arn "$POLICY_ARN" \
    --query 'Versions[?!IsDefaultVersion].VersionId' --output text)
  for v in $VERSIONS; do
    aws iam delete-policy-version --policy-arn "$POLICY_ARN" --version-id "$v"
  done
  aws iam create-policy-version \
    --policy-arn "$POLICY_ARN" \
    --policy-document "file://$POLICY_FILE" \
    --set-as-default
  echo "[iam] Policy updated"
else
  aws iam create-policy \
    --policy-name "$POLICY_NAME" \
    --policy-document "file://$POLICY_FILE" \
    --description "Permissions for Terraform to manage dnd-fam-ftw infrastructure" \
    --tags Key=project,Value=dnd-fam-ftw
  echo "[iam] Created policy $POLICY_NAME"
fi

# Attach policy to user
ATTACHED=$(aws iam list-attached-user-policies --user-name "$USER_NAME" \
  --query "AttachedPolicies[?PolicyArn=='$POLICY_ARN'].PolicyArn" --output text)
if [[ -n "$ATTACHED" ]]; then
  echo "[iam] Policy already attached to $USER_NAME"
else
  aws iam attach-user-policy --user-name "$USER_NAME" --policy-arn "$POLICY_ARN"
  echo "[iam] Attached policy to $USER_NAME"
fi

EXISTING_KEYS=$(aws iam list-access-keys --user-name "$USER_NAME" \
  --query 'AccessKeyMetadata[].AccessKeyId' --output text)

if [[ -n "$EXISTING_KEYS" ]]; then
  echo "[iam] Access key already exists for $USER_NAME, skipping creation"
  echo ""
  echo "============================================================"
  echo "  Policy updated. No new credentials were created."
  echo "  Your existing AWS profile dnd-fam-ftw-terraform is still valid."
  echo "============================================================"
else
  echo "[iam] Creating access key..."
  KEY_OUTPUT=$(aws iam create-access-key --user-name "$USER_NAME")
  ACCESS_KEY_ID=$(echo "$KEY_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin)['AccessKey']; print(d['AccessKeyId'])")
  SECRET_ACCESS_KEY=$(echo "$KEY_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin)['AccessKey']; print(d['SecretAccessKey'])")

  echo ""
  echo "============================================================"
  echo "  IAM user ready. Configure your AWS CLI profile:"
  echo "============================================================"
  echo ""
  echo "  aws configure --profile dnd-fam-ftw-terraform"
  echo ""
  echo "  AWS Access Key ID:     $ACCESS_KEY_ID"
  echo "  AWS Secret Access Key: $SECRET_ACCESS_KEY"
  echo "  Default region:        eu-west-1"
  echo "  Default output:        json"
  echo ""
  echo "  Or set in ~/.aws/credentials:"
  echo ""
  echo "  [dnd-fam-ftw-terraform]"
  echo "  aws_access_key_id     = $ACCESS_KEY_ID"
  echo "  aws_secret_access_key = $SECRET_ACCESS_KEY"
  echo "  region                = eu-west-1"
  echo ""
  echo "  Then run terraform with:"
  echo "  AWS_PROFILE=dnd-fam-ftw-terraform terraform -chdir=terraform apply"
  echo "============================================================"
fi
