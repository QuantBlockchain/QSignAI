#!/bin/bash
set -e

# Restores Telegram webhook to point at the production CloudFront URL.
# Run this after local dev to switch back to production.

REGION="${AWS_DEFAULT_REGION:-us-west-2}"

CF_URL=$(aws cloudformation describe-stacks \
  --stack-name TelegramPhotoWallStack --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontURL'].OutputValue" \
  --output text)

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

  WEBHOOK_URL="${CF_URL}/api/webhook/${GROUP_ID}"

  echo "Restoring webhook for group '$GROUP_ID' → $WEBHOOK_URL"

  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
    -H "Content-Type: application/json" \
    -d "{
      \"url\": \"${WEBHOOK_URL}\",
      \"secret_token\": \"${WEBHOOK_SECRET}\",
      \"allowed_updates\": [\"message\"]
    }" | python3 -m json.tool

  echo ""
done

echo "Done. Webhook restored to production."
