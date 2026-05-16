# Telegram Integration Guide

This guide walks through integrating a Telegram group with the photo wall system.

---

## Prerequisites

- The photo wall system is deployed (`./deploy.sh`)
- You have a Telegram account
- AWS CLI is installed with configured credentials

## Current Deployment Information

| Item | Value |
|------|-------|
| CloudFront URL | `https://<YOUR_DOMAIN>` |
| Webhook URL template | `https://<YOUR_DOMAIN>/api/webhook/{groupId}` |

> If you have redeployed the stack, fetch the latest URL with `aws cloudformation describe-stacks --stack-name TelegramPhotoWallStack --query "Stacks[0].Outputs"`.

---

## Step 1: Create a Telegram Bot

1. Open Telegram and start a chat with **@BotFather**

2. Send `/newbot`

3. Provide:
   - **Bot name** (display name): for example `My Photo Wall Bot`
   - **Bot username** (unique handle, must end in `bot`): for example `my_photo_wall_bot`

4. BotFather returns a **Bot Token** in this form:
   ```
   7123456789:AAH1234567890abcdefghijklmnopqrstuv
   ```

5. **Save this token** for the next steps.

### Configure Bot Permissions (Important)

By default, a Bot cannot read every message in a group. Turn off Privacy Mode:

1. In the BotFather chat, send `/mybots`
2. Select the Bot you just created
3. Choose **Bot Settings** → **Group Privacy**
4. Click **Turn off**

> With Privacy Mode off the Bot can receive every group message. Otherwise it only sees `/`-prefixed commands.

---

## Step 2: Store the Bot Token in AWS Secrets Manager

Store the Bot Token in AWS Secrets Manager (do not hard-code it anywhere):

```bash
aws secretsmanager create-secret \
  --name "telegram/bot-token/demo-group" \
  --secret-string "7123456789:AAH1234567890abcdefghijklmnopqrstuv" \
  --region us-west-2
```

> Replace the token with your own. `demo-group` should match the `secretName` configured in `cdk.json`.

If the secret already exists, use `update`:

```bash
aws secretsmanager update-secret \
  --secret-id "telegram/bot-token/demo-group" \
  --secret-string "7123456789:AAH1234567890abcdefghijklmnopqrstuv" \
  --region us-west-2
```

### Verify the Secret

```bash
aws secretsmanager get-secret-value \
  --secret-id "telegram/bot-token/demo-group" \
  --query SecretString --output text \
  --region us-west-2
```

---

## Step 3: Fetch the Webhook Secret

The deployment generated a 64-character random string used to verify webhook origin so that only Telegram requests are accepted:

```bash
WEBHOOK_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "telegram/webhook-secret" \
  --query SecretString --output text \
  --region us-west-2)

echo $WEBHOOK_SECRET
```

---

## Step 4: Register the Telegram Webhook

Tell Telegram where to push messages:

```bash
BOT_TOKEN="7123456789:AAH1234567890abcdefghijklmnopqrstuv"
WEBHOOK_URL="https://<YOUR_DOMAIN>/api/webhook/demo-group"

curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${WEBHOOK_URL}\",
    \"secret_token\": \"${WEBHOOK_SECRET}\",
    \"allowed_updates\": [\"message\"]
  }"
```

Expected response:

```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

### Verify Webhook Status

```bash
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo" | python3 -m json.tool
```

Key fields in the expected output:

```json
{
  "ok": true,
  "result": {
    "url": "https://<YOUR_DOMAIN>/api/webhook/demo-group",
    "has_custom_certificate": false,
    "pending_update_count": 0,
    "last_error_date": null,
    "last_error_message": null
  }
}
```

> If `last_error_message` is non-null, Telegram is hitting an error during delivery; investigate based on the message.

---

## Step 5: Add the Bot to the Telegram Group

1. Open the Telegram group you want to sync
2. Open the group settings → **Add Members**
3. Search for the Bot username (e.g. `@my_photo_wall_bot`)
4. Add the Bot to the group

Send a test message in the group (text or photo) and open the photo wall page to confirm it appears:

```
https://<YOUR_DOMAIN>/wall/demo-group
```

---

## Adding More Groups

To configure additional independent walls, follow these steps:

### 1. Create a New Bot (or reuse one)

> A Bot can only have one webhook URL. Different groups therefore require **separate Bots**.

### 2. Store the New Bot Token

```bash
aws secretsmanager create-secret \
  --name "telegram/bot-token/marketing" \
  --secret-string "NEW_BOT_TOKEN_HERE" \
  --region us-west-2
```

### 3. Update `cdk.json`

```json
{
  "context": {
    "telegramGroups": [
      {
        "groupId": "demo-group",
        "chatId": "-1001234567890",
        "name": "Demo Photo Wall",
        "secretName": "telegram/bot-token/demo-group"
      },
      {
        "groupId": "marketing",
        "chatId": "-1009876543210",
        "name": "Marketing Photo Wall",
        "secretName": "telegram/bot-token/marketing"
      }
    ]
  }
}
```

Field reference:

| Field | Description | Example |
|-------|-------------|---------|
| `groupId` | URL identifier for the wall (letters, digits, underscore, hyphen) | `marketing` |
| `chatId` | Telegram group Chat ID (see appendix) | `-1001234567890` |
| `name` | Title displayed on the wall | `Marketing Photo Wall` |
| `secretName` | Name of the Bot Token secret in Secrets Manager | `telegram/bot-token/marketing` |

### 4. Redeploy

```bash
npx cdk deploy --require-approval never
```

### 5. Register the Webhook for the New Group

```bash
NEW_BOT_TOKEN="<new bot token>"
curl -X POST "https://api.telegram.org/bot${NEW_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"https://<YOUR_DOMAIN>/api/webhook/marketing\",
    \"secret_token\": \"${WEBHOOK_SECRET}\",
    \"allowed_updates\": [\"message\"]
  }"
```

---

## Appendix

### Get the Telegram Group Chat ID

**Method 1: Via the Bot API**

1. Add the Bot to the group
2. Send any message in the group
3. Run:

```bash
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getUpdates" | python3 -m json.tool
```

4. Locate `message.chat.id` in the JSON response. Group Chat IDs are typically negative (e.g. `-1001234567890`).

**Method 2: Via @userinfobot**

1. Add `@userinfobot` to the group
2. It will reply with the group's Chat ID
3. Remove it once you have the value

### Delete the Webhook (for Debugging)

```bash
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook"
```

### View ECS Logs (Troubleshooting)

```bash
aws logs tail /ecs/telegram-photo-wall --follow --region us-west-2
```

### FAQ

**Q: Messages were sent in the group but nothing appears on the wall.**

1. Confirm the Bot has been added to the group
2. Confirm Privacy Mode is **off** (BotFather → Bot Settings → Group Privacy → Turn off)
3. Check webhook status: `curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"`
4. Inspect ECS logs for errors

**Q: Photos do not load.**

1. Photos use S3 pre-signed URLs with a 1-hour TTL; refresh the page to mint new URLs
2. Confirm the ECS Task Role has S3 read/write permissions (CDK provisions this automatically)

**Q: Webhook returns 403.**

1. Confirm the `secret_token` matches the value in Secrets Manager (`telegram/webhook-secret`)
2. Confirm the `groupId` in the webhook URL matches the `groupId` in `cdk.json`
