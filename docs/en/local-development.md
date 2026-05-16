# Local Development Guide

## How It Works

For local development, Next.js runs on your machine but **connects directly to the deployed AWS resources** (DynamoDB, S3, Secrets Manager). No local database is required.

```
Local Next.js (localhost:3000)
   ├── read/write → AWS DynamoDB (the same table used in production)
   ├── read/write → AWS S3 (the same bucket used in production)
   └── read       → AWS Secrets Manager (Bot Token)

Telegram → ngrok → localhost:3000   (only when debugging the webhook)
```

## Prerequisites

- Node.js 20+
- AWS CLI with configured credentials (`aws configure`) that can access the deployed resources
- (Optional) [ngrok](https://ngrok.com/) — only needed when debugging the Telegram webhook

## Quick Start

### 1. Generate the Local Environment File

```bash
# Pull every resource ID from the deployed CDK stack
./scripts/setup-local-env.sh
```

The script writes `photo-wall/.env.local`, which looks like:

```env
AWS_REGION_NAME=us-west-2
TABLE_NAME=TelegramPhotoWallStack-MessagesTable05B58A27-xxxxx
BUCKET_NAME=telegramphotowallstack-photobucket465738b3-xxxxx
WEBHOOK_SECRET_ARN=arn:aws:secretsmanager:us-west-2:xxxxx:secret:telegram/webhook-secret-xxxxx
GROUP_CONFIG=[{"groupId":"demo-group","chatId":"-1001234567890","name":"Demo Photo Wall","secretName":"telegram/bot-token/demo-group"}]
```

> If you have not deployed the stack yet, run `./deploy.sh` first.

### 2. Start the Dev Server

```bash
cd photo-wall
npm install   # only on first run or when dependencies change
npm run dev
```

Open http://localhost:3000/wall/demo-group to view the photo wall.

**Hot reload**: edits to frontend components (TSX/CSS) refresh the browser automatically; edits to API routes apply on the next request.

### 3. Debug the Telegram Webhook (optional)

If you need to debug incoming Telegram messages locally, expose your local port to the internet with ngrok:

```bash
# Terminal 1: start ngrok
ngrok http 3000

# Note the public URL it prints, e.g. https://abcd1234.ngrok-free.app
```

```bash
# Terminal 2: point the Telegram webhook at your ngrok URL
./scripts/set-webhook-local.sh https://abcd1234.ngrok-free.app
```

Telegram messages in the group will now flow to your local Next.js server.

**When you're done, restore the production webhook:**

```bash
./scripts/set-webhook-prod.sh
```

## Common Workflows

### Frontend-only Changes (Styles / Interactions)

Edit files under `photo-wall/src/components/` or `photo-wall/src/app/`. The browser hot-reloads. ngrok is not required, and existing messages load via the API as usual.

### API Changes (Message Queries)

Edit files under `photo-wall/src/app/api/messages/` and refresh the page to test. Data is read from the deployed DynamoDB table.

### Webhook Changes (Inbound Messages)

This requires ngrok plus switching the webhook to your local URL. You can also simulate Telegram requests with curl:

```bash
# Fetch the webhook secret
WEBHOOK_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "telegram/webhook-secret" \
  --query SecretString --output text --region us-west-2)

# Simulate a text message
curl -X POST http://localhost:3000/api/webhook/demo-group \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: $WEBHOOK_SECRET" \
  -d '{
    "update_id": 12345,
    "message": {
      "message_id": 999,
      "from": {"id": 123, "first_name": "Test"},
      "chat": {"id": -1001234567890},
      "date": 1700000000,
      "text": "Hello from local dev"
    }
  }'

# Simulate a photo message (file_id is fake; download will fail but the row is persisted)
curl -X POST http://localhost:3000/api/webhook/demo-group \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: $WEBHOOK_SECRET" \
  -d '{
    "update_id": 12346,
    "message": {
      "message_id": 1000,
      "from": {"id": 123, "first_name": "Test"},
      "chat": {"id": -1001234567890},
      "date": 1700000001,
      "photo": [
        {"file_id": "fake_small", "file_unique_id": "u1", "width": 90, "height": 90},
        {"file_id": "fake_large", "file_unique_id": "u2", "width": 800, "height": 600}
      ],
      "caption": "Test photo"
    }
  }'
```

### CDK Infrastructure Changes

```bash
# Preview the diff
npx cdk diff

# Apply the change
npx cdk deploy

# Refresh the local env file if any resource names changed
./scripts/setup-local-env.sh
```

## Project Layout

```
telegram-photo-wall/
├── photo-wall/                     ← Next.js application (where local dev happens)
│   ├── src/app/api/                ← API routes (webhook, messages, health)
│   ├── src/components/             ← React components (photo wall UI)
│   ├── src/lib/                    ← Utilities (AWS clients, config, sanitization)
│   ├── .env.local                  ← Local env file (gitignored)
│   └── package.json
├── lib/                            ← CDK infrastructure definitions
├── scripts/
│   ├── setup-local-env.sh          ← Generate .env.local
│   ├── set-webhook-local.sh        ← Webhook → ngrok (local debugging)
│   └── set-webhook-prod.sh         ← Webhook → CloudFront (restore production)
└── cdk.json                        ← Group configuration
```
