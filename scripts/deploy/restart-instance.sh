#!/bin/bash
set -e

INSTANCE_NAME="${LIGHTSAIL_INSTANCE:-dnd-fam-ftw}"
AWS_REGION="${AWS_REGION:-eu-west-1}"
WAIT_TIMEOUT=120  # seconds before giving up on health check

echo "Restarting Lightsail instance: ${INSTANCE_NAME} (${AWS_REGION})..."

aws lightsail reboot-instance \
    --instance-name "${INSTANCE_NAME}" \
    --region "${AWS_REGION}"

echo "Reboot triggered. Waiting for instance to come back up..."

elapsed=0
while [ $elapsed -lt $WAIT_TIMEOUT ]; do
    state=$(aws lightsail get-instance-state \
        --instance-name "${INSTANCE_NAME}" \
        --region "${AWS_REGION}" \
        --query 'state.name' \
        --output text 2>/dev/null || echo "unknown")

    if [ "$state" = "running" ]; then
        echo "Instance is running."
        break
    fi

    printf "  state: %-12s (${elapsed}s elapsed)\r" "${state}"
    sleep 5
    elapsed=$((elapsed + 5))
done

if [ $elapsed -ge $WAIT_TIMEOUT ]; then
    echo "Timed out waiting for instance to reach running state. Check AWS console."
    exit 1
fi

# Give services a moment to fully start before reporting done
sleep 5

echo "Done. Instance ${INSTANCE_NAME} is back up."
echo "Check backend logs with: ./dnd-fam-ftw-prod-cli 'journalctl -u dnd-fam-ftw-backend.service -n 50'"
