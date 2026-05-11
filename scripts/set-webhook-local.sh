#!/bin/bash
set -e

# Registers the Telegram webhook to point at a local ngrok tunnel.
# Usage: ./scripts/set-webhook-local.sh <NGROK_URL>
# Example: ./scripts/set-webhook-local.sh https://abcd1234.ngrok-free.app

NGROK_URL="${1:?Usage: $0 <NGROK_URL>}"
REGION="${AWS_DEFAULT_REGION:-us-west-2}"

# Read group config from cdk.json
GROUPS=$(node -e "
  const cdk = require('./cdk.json');
  (cdk.context.telegramGroups || []).forEach(g => {
    console.log(g.groupId + ' ' + g.secretName);
  });
")

WEBHOOK_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "telegram/webhook-secret" --region "$REGION" \
  --query SecretString --output text)

echo "$GROUPS" | while read GROUP_ID SECRET_NAME; do
  [ -z "$GROUP_ID" ] && continue

  BOT_TOKEN=$(aws secretsmanager get-secret-value \
    --secret-id "$SECRET_NAME" --region "$REGION" \
    --query SecretString --output text)

  WEBHOOK_URL="${NGROK_URL}/api/webhook/${GROUP_ID}"

  echo "Setting webhook for group '$GROUP_ID' → $WEBHOOK_URL"

  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
    -H "Content-Type: application/json" \
    -d "{
      \"url\": \"${WEBHOOK_URL}\",
      \"secret_token\": \"${WEBHOOK_SECRET}\",
      \"allowed_updates\": [\"message\"]
    }" | python3 -m json.tool

  echo ""
done

echo "Done. Telegram will now push messages to your local dev server."
echo "Remember to run './scripts/set-webhook-prod.sh' when done to restore production webhook."
