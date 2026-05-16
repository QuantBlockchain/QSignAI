# How to Create a New Group Photo Wall

This guide explains how to add an independent photo wall for a new Telegram group. Each group requires its own Bot.

---

## Prerequisites

- The project has been deployed at least once (`./deploy.sh` or `npx cdk deploy`)
- AWS CLI is installed and credentials are configured
- You have a Telegram account

---

## Step 1: Create a New Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Provide a Bot name (e.g. `Marketing Wall Bot`) and a username (e.g. `marketing_wall_bot`, must end in `bot`)
4. Save the returned **Bot Token**
5. Turn off Privacy Mode: BotFather → `/mybots` → select the Bot → Bot Settings → Group Privacy → **Turn off**

---

## Step 2: Store the Bot Token in Secrets Manager

```bash
aws secretsmanager create-secret \
  --name "telegram/bot-token/marketing" \
  --secret-string "YOUR_NEW_BOT_TOKEN" \
  --region us-west-2
```

> The `marketing` suffix in `telegram/bot-token/marketing` is arbitrary; it just has to match the `secretName` you set in the next step.

---

## Step 3: Add the New Group to `cdk.json`

Edit the project root `cdk.json` and append a new entry to the `telegramGroups` array:

```json
{
  "context": {
    "telegramGroups": [
      {
        "groupId": "demo-group",
        "chatId": "-1001234567890",
        "name": "Demo Photo Wall",
        "secretName": "telegram/bot-token/demo-group",
        "botUsername": "your_photo_wall_bot"
      },
      {
        "groupId": "marketing",
        "chatId": "-1009876543210",
        "name": "Marketing Photo Wall",
        "secretName": "telegram/bot-token/marketing",
        "botUsername": "marketing_wall_bot"
      }
    ]
  }
}
```

### Field Reference

| Field | Required | Description | Example |
|-------|----------|-------------|---------|
| `groupId` | Yes | URL identifier for the wall; letters, digits, underscore, hyphen only | `marketing` |
| `chatId` | Yes | Telegram group Chat ID (negative integer); see the appendix for how to obtain it | `-1009876543210` |
| `name` | Yes | Title shown on the photo wall page | `Marketing Photo Wall` |
| `secretName` | Yes | Name in Secrets Manager that holds the Bot Token; must match Step 2 | `telegram/bot-token/marketing` |
| `botUsername` | Yes | The Bot's `@username` (without `@`); only messages that `@mention` it are surfaced on the wall | `marketing_wall_bot` |

---

## Step 4: Deploy

```bash
cd photo-wall && npm run build && cd ..
npx cdk deploy --require-approval never
```

After the deployment, the CDK output prints the new group's webhook URL:

```
TelegramPhotoWallStack.WebhookUrlmarketing = https://<YOUR_DOMAIN>/api/webhook/marketing
```

---

## Step 5: Register the Telegram Webhook

```bash
# Fetch the webhook verification secret
WEBHOOK_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "telegram/webhook-secret" \
  --query SecretString --output text \
  --region us-west-2)

# Fetch the new Bot Token
NEW_BOT_TOKEN=$(aws secretsmanager get-secret-value \
  --secret-id "telegram/bot-token/marketing" \
  --query SecretString --output text \
  --region us-west-2)

# Register the webhook
curl -X POST "https://api.telegram.org/bot${NEW_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"https://<YOUR_DOMAIN>/api/webhook/marketing\",
    \"secret_token\": \"${WEBHOOK_SECRET}\",
    \"allowed_updates\": [\"message\"]
  }"
```

> Replace `https://<YOUR_DOMAIN>` with the actual CloudFront URL emitted by CDK.

### Verify the Webhook

```bash
curl -s "https://api.telegram.org/bot${NEW_BOT_TOKEN}/getWebhookInfo" | python3 -m json.tool
```

---

## Step 6: Add the Bot to the Group

1. Open the target Telegram group
2. Add member → search for `@marketing_wall_bot` → add
3. Send a test message in the group: `@marketing_wall_bot hello`

---

## Step 7: Open the Photo Wall

```
https://<YOUR_DOMAIN>/wall/marketing
```

If multiple groups are configured, a group switcher appears at the top of the page.

---

## Appendix

### Get the Telegram Group Chat ID

**Method 1: Via the Bot API**

1. Add the Bot to the group
2. Send any message in the group
3. Run:
```bash
curl -s "https://api.telegram.org/bot${NEW_BOT_TOKEN}/getUpdates" | python3 -m json.tool
```
4. Locate `message.chat.id` in the returned JSON (group Chat IDs are negative, e.g. `-1009876543210`)

**Method 2: Via @userinfobot**

1. Add `@userinfobot` to the group
2. It will reply with the group's Chat ID
3. Remove it once you have the value

### Remove a Group

1. Remove the entry from `telegramGroups` in `cdk.json`
2. Redeploy: `npx cdk deploy`
3. (Optional) Delete the Bot Token: `aws secretsmanager delete-secret --secret-id "telegram/bot-token/marketing" --region us-west-2`
4. (Optional) Remove the webhook: `curl -X POST "https://api.telegram.org/bot${NEW_BOT_TOKEN}/deleteWebhook"`

### Quick Reference

| Step | Command / Action |
|------|------------------|
| 1. Create the Bot | BotFather `/newbot` + turn off Privacy Mode |
| 2. Store the Token | `aws secretsmanager create-secret ...` |
| 3. Update config | Edit `cdk.json`, append the new group |
| 4. Deploy | `npx cdk deploy` |
| 5. Register webhook | `curl ... setWebhook` |
| 6. Add Bot to group | Add as a Telegram group member |
| 7. Test | Send `@bot hello` in the group, open `/wall/groupId` |
