# Telegram Group Photo Wall — Requirements

## 1. Project Overview

### 1.1 Background
The customer needs a system that synchronizes Telegram group messages (text and photos) to a visual photo wall in real time. The system supports configuring multiple Telegram groups, each with its own dedicated photo wall page.

### 1.2 Goals
- Receive Telegram group messages (text + photos) in real time
- Display group content as a photo wall
- Support multiple groups, each with isolated display
- Deploy on AWS using CDK for infrastructure-as-code
- Ensure the system is secure and free of known vulnerabilities

## 2. System Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Telegram    │────▶│ API Gateway  │────▶│  Webhook Lambda │
│  Bot API     │     │ (webhook)    │     │  (msg handling) │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
                                          ┌────────┼────────┐
                                          ▼        ▼        ▼
                                    ┌─────────┐ ┌──────┐ ┌─────────┐
                                    │DynamoDB │ │  S3  │ │ Secrets │
                                    │(messages)│ │(photo)│ │ Manager │
                                    └─────────┘ └──────┘ └─────────┘
                                          │        │
                                          ▼        ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Browser    │◀────│ CloudFront   │◀────│  API Lambda     │
│ (photo wall)│     │ + S3 static  │     │  (data queries) │
└─────────────┘     └──────────────┘     └─────────────────┘
```

## 3. Functional Requirements

### 3.1 Telegram Bot Webhook
- **FR-01**: Receive group messages in real time via the Telegram Bot API webhook
- **FR-02**: Handle text messages
- **FR-03**: Handle photo messages, including captions
- **FR-04**: Validate webhook origin via the Telegram secret token
- **FR-05**: Extract sender information (display name, username, etc.)
- **FR-06**: Persist message metadata in DynamoDB
- **FR-07**: Download photos and store them in S3

### 3.2 Photo Wall API
- **FR-08**: Provide a REST API to query messages for a specific group
- **FR-09**: Support paginated queries (cursor-based on timestamp)
- **FR-10**: Return message body, photo URL, sender, and timestamp
- **FR-11**: Generate CloudFront-signed URLs for S3 photos

### 3.3 Photo Wall Frontend
- **FR-12**: Render the wall as a responsive masonry/grid layout
- **FR-13**: Use the URL path to distinguish groups (e.g. `/wall/{group-id}`)
- **FR-14**: Poll for new messages in real time (every 5 seconds)
- **FR-15**: Animate the entrance of new messages
- **FR-16**: Provide click-to-zoom for photos
- **FR-17**: Show message text, sender name, and timestamp
- **FR-18**: Be responsive across mobile and desktop

### 3.4 Multi-group Management
- **FR-19**: Configure multiple groups via CDK context or SSM Parameters
- **FR-20**: Each group records: group ID, Bot Token, photo wall name
- **FR-21**: Group data is fully isolated
- **FR-22**: Groups share infrastructure (one API Gateway, DynamoDB table, S3 bucket)

## 4. Non-functional Requirements

### 4.1 Security
- **NFR-01**: Bot Tokens live in AWS Secrets Manager; never hard-coded
- **NFR-02**: Webhook endpoints validate the Telegram secret token
- **NFR-03**: API Gateway is protected by WAF
- **NFR-04**: S3 buckets block public access; CloudFront uses OAC
- **NFR-05**: DynamoDB and S3 are encrypted at rest (KMS)
- **NFR-06**: Lambda functions use least-privilege IAM roles
- **NFR-07**: Frontend API calls are restricted via a CORS allowlist
- **NFR-08**: All transport uses HTTPS/TLS
- **NFR-09**: All user input is sanitized and validated
- **NFR-10**: CloudFront emits security response headers (CSP, X-Frame-Options, etc.)
- **NFR-11**: S3 buckets enable versioning and access logging
- **NFR-12**: API Gateway enables access logging and request throttling

### 4.2 Performance
- **NFR-13**: Webhook response time < 3 seconds (Telegram timeout)
- **NFR-14**: Photo wall page load < 2 seconds
- **NFR-15**: Support 100+ concurrent viewers

### 4.3 Availability
- **NFR-16**: CloudFront global distribution for low-latency access
- **NFR-17**: Lambda autoscaling
- **NFR-18**: DynamoDB on-demand billing with automatic scaling

## 5. Data Model

### 5.1 DynamoDB Table

**Messages**
| Field | Type | Description |
|-------|------|-------------|
| PK | String | `GROUP#{groupId}` |
| SK | String | `MSG#{timestamp}#{messageId}` |
| messageId | Number | Telegram message ID |
| groupId | String | Group identifier |
| type | String | `text` / `photo` |
| text | String | Message text |
| photoKey | String | S3 object key (photo messages only) |
| senderName | String | Sender display name |
| senderUsername | String | Sender `@username` |
| timestamp | Number | Unix timestamp (ms) |
| createdAt | String | ISO 8601 timestamp |

### 5.2 S3 Layout
```
photos/
  {groupId}/
    {messageId}_{fileId}.jpg
```

## 6. API Design

### 6.1 Webhook Endpoint
```
POST /webhook/{groupId}
Headers:
  X-Telegram-Bot-Api-Secret-Token: {secret}
Body: Telegram Update JSON
Response: 200 OK
```

### 6.2 Message Query Endpoint
```
GET /api/messages/{groupId}?limit=20&cursor={lastSK}
Response:
{
  "messages": [...],
  "nextCursor": "MSG#...",
  "groupName": "My Group"
}
```

## 7. Deployment Architecture

### 7.1 AWS Resource Inventory
| Service | Purpose |
|---------|---------|
| API Gateway (REST) | Webhook + API endpoints |
| Lambda (Node.js 20) | Webhook handling + API queries |
| DynamoDB | Message storage |
| S3 | Photo storage + static site |
| CloudFront | CDN distribution (frontend + photos) |
| Secrets Manager | Bot Tokens |
| WAF | API protection |
| CloudWatch | Logs and monitoring |
| KMS | Data encryption |

### 7.2 CDK Project Layout
```
telegram-photo-wall/
├── bin/
│   └── app.ts                  # CDK app entry
├── lib/
│   └── telegram-photo-wall-stack.ts  # Main stack definition
├── lambda/
│   ├── webhook/
│   │   └── index.ts            # Webhook handler
│   └── api/
│       └── index.ts            # API query handler
├── frontend/
│   ├── index.html              # Photo wall SPA
│   ├── style.css               # Styles
│   └── app.js                  # Frontend logic
├── docs/
│   └── requirements.md         # This document
├── cdk.json                    # CDK configuration
├── tsconfig.json               # TypeScript configuration
├── package.json                # Dependency management
└── .gitignore
```

## 8. Configuration Example

```json
// cdk.json context
{
  "telegramGroups": [
    {
      "groupId": "innovation-team",
      "chatId": "-1001234567890",
      "name": "Innovation Team Photo Wall",
      "secretName": "telegram/bot-token/innovation-team"
    },
    {
      "groupId": "marketing",
      "chatId": "-1009876543210",
      "name": "Marketing Photo Wall",
      "secretName": "telegram/bot-token/marketing"
    }
  ]
}
```

## 9. Security Checklist

- [ ] No Bot Token appears in plaintext in code or environment variables
- [ ] Webhook origin validation in place
- [ ] S3 buckets are not publicly accessible
- [ ] IAM roles follow least privilege
- [ ] All APIs are HTTPS-only
- [ ] User input is sanitized (XSS / injection)
- [ ] CloudFront security headers are configured
- [ ] WAF rules are configured
- [ ] DynamoDB and S3 encryption at rest
- [ ] API rate limiting is configured
