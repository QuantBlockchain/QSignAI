# System Architecture

## Overview

Telegram Photo Wall is a real-time event photo wall powered by quantum-authenticated signatures. Users post photos and messages in Telegram groups; the system processes them through a quantum computing module (AWS Braket SV1) and renders them as draggable sticky notes on a web-based wall.

## System-Level Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (User Interface)                           │
│                                                                                 │
│   Browser ──→ CloudFront (CDN + TLS + Security Headers)                         │
│                    │                                                             │
│                    ▼                                                             │
│   ┌──────────────────────────────────────────┐                                  │
│   │  Next.js Client Components               │                                  │
│   │  ├── PhotoWall (polling + drag)          │                                  │
│   │  ├── MessageCard (quantum badge)         │                                  │
│   │  ├── Lightbox (image preview)            │                                  │
│   │  └── Admin Dashboard (CRUD)              │                                  │
│   └──────────────────────────────────────────┘                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          BACKEND / API LAYER                                     │
│                                                                                 │
│   ALB (secret header validation) ──→ ECS Fargate (Next.js Server)               │
│                                                                                 │
│   API Routes:                                                                   │
│   ├── POST /api/webhook/[groupId]     ← Telegram pushes messages here           │
│   ├── GET  /api/messages/[groupId]    → Paginated message list + signed URLs    │
│   ├── DELETE /api/messages/[groupId]  → Admin: hide messages                    │
│   ├── PATCH  /api/messages/[groupId]  → Admin: save card positions              │
│   ├── GET  /api/groups                → Available groups                        │
│   ├── POST /api/admin                 → Login (password verification)           │
│   ├── GET  /api/admin                 → Admin: group stats                      │
│   └── GET  /api/health                → Health check for ALB                    │
│                                                                                 │
│   Security:                                                                     │
│   ├── Telegram webhook secret token validation                                  │
│   ├── Bearer token auth for admin/write endpoints                               │
│   ├── CloudFront → ALB secret header (blocks direct ALB access)                 │
│   └── Input sanitization (XSS prevention)                                       │
└─────────────────────────────────────────────────────────────────────────────────┘
                                     │
                        ┌────────────┼────────────┐
                        ▼            ▼            ▼
┌──────────────────────────┐ ┌─────────────┐ ┌──────────────────────────────────┐
│  QUANTUM PROCESSING      │ │  DATABASE   │ │  STORAGE                         │
│  MODULE                  │ │  LAYER      │ │  LAYER                           │
│                          │ │             │ │                                  │
│  AWS Braket SV1          │ │  DynamoDB   │ │  S3 (photos)                     │
│  ├── 4-qubit RNG circuit │ │  ├── PK/SK  │ │  ├── Private, encrypted          │
│  ├── 2-qubit Bell state  │ │  │  schema  │ │  ├── Pre-signed URL access       │
│  ├── ToyLWE signature    │ │  ├── PAY_PER│ │  └── Versioned                   │
│  └── Local crypto        │ │  │  _REQUEST│ │                                  │
│      fallback            │ │  └── PITR   │ │  S3 (Braket results)             │
│                          │ │             │ │  └── amazon-braket-* bucket       │
│  ┌─────────────────────┐ │ │             │ │                                  │
│  │ ░░░░░░░░░░░░░░░░░░░ │ │ │             │ │  Secrets Manager                 │
│  │ ░  OpenClaw Deploy  ░ │ │ │             │ │  ├── Bot tokens                  │
│  │ ░  (Future: hybrid  ░ │ │ │             │ │  ├── Webhook secret              │
│  │ ░   QPU routing)    ░ │ │ │             │ │  └── Admin password              │
│  │ ░░░░░░░░░░░░░░░░░░░ │ │ │             │ │                                  │
│  └─────────────────────┘ │ │             │ │                                  │
└──────────────────────────┘ └─────────────┘ └──────────────────────────────────┘
```

## Data Flow

### End-to-End Message Flow

```
1. USER INPUT
   User sends photo/text with @bot mention in Telegram group
        │
        ▼
2. API VALIDATION
   Telegram → POST /api/webhook/[groupId]
   ├── Validate X-Telegram-Bot-Api-Secret-Token header
   ├── Validate groupId format (regex: ^[a-zA-Z0-9_-]{1,64}$)
   ├── Verify group exists in configuration
   ├── Check message contains @bot mention
   └── Sanitize text input (HTML entity encoding, max 4096 chars)
        │
        ▼
3. PHOTO PROCESSING (if applicable)
   ├── Call Telegram getFile API → obtain file download URL
   ├── Download file (max 20MB limit)
   ├── Upload to S3: photos/{groupId}/{messageId}_{fileId}.{ext}
   └── Supported: JPEG, PNG, GIF, WebP, BMP, TIFF, SVG, static stickers
        │
        ▼
4. DATABASE WRITE (Phase 1)
   Save message to DynamoDB with signatureStatus = "generating"
   ├── PK: GROUP#{groupId}
   ├── SK: MSG#{timestamp(15-padded)}#{messageId}
   └── Fields: type, text, senderName, senderUsername, photoKey, timestamp
        │
        ▼
5. QUANTUM TASK QUEUE
   Check if sender already has a quantum signature in this group
        │
        ├── [EXISTS] → Reuse existing signature (no Braket call)
        │
        └── [NEW SENDER] → Submit to AWS Braket SV1:
             │
             ▼
6. DEVICE EXECUTION (AWS Braket SV1 Simulator)
   Task A: Quantum Random Number
   ├── Circuit: 4-qubit (H gates → CNOT chain → Ry seed rotations → Measure)
   ├── Shots: 100
   ├── Output: Most frequent bitstring → integer mod 1001
   └── Results written to: s3://amazon-braket-*/braket-results/{taskId}/results.json
   
   Task B: Bell State Measurement
   ├── Circuit: 2-qubit (H q[0] → CNOT q[0],q[1] → Measure)
   ├── Shots: 200
   └── Output: Probability distribution [P(00), P(01), P(10), P(11)]
        │
        ▼
7. RESULT AGGREGATION
   ├── quantumNumber = parseInt(topBitstring, 2) % 1001
   ├── bellState = [P(00), P(01), P(10), P(11)]
   ├── ToyLWE Signature:
   │   ├── Key derivation: SHAKE-256(seed + quantum_number + random_bytes)
   │   ├── Public key hash: SHA-256 → first 12 hex chars (uppercase)
   │   └── Signature: SHA-256 chain → base64 (24 chars)
   ├── Visual color: HSL derived from quantum number + Bell state
   └── Update DynamoDB: signatureStatus = "completed" + all signature fields
        │
        ▼
8. FRONTEND RENDERING
   Browser polls GET /api/messages/[groupId] every 5 seconds
   ├── DynamoDB query (newest-first, filtered: hidden != true)
   ├── Generate S3 pre-signed URLs for photos (1-hour expiry)
   └── Return JSON: messages[], nextCursor, groupName
        │
        ▼
   React components render:
   ├── PhotoWall: absolute-positioned cards, drag-to-reposition
   ├── MessageCard: sticky note with quantum badge (Q#number | pubKeyHash)
   ├── Leaderboard: top senders ranked by message count
   └── Lightbox: click photo to zoom
```

### Admin Flow

```
Admin → POST /api/admin {password}
     → Verify against Secrets Manager (telegram/admin-password)
     → Return token (password re-used as bearer token)
     → Subsequent requests: Authorization: Bearer {token}
     → GET /api/admin (groups), DELETE /api/admin?action=hide|clear
```

## Interface Specifications

### REST API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/webhook/[groupId]` | Telegram secret token | Receive Telegram updates |
| GET | `/api/messages/[groupId]` | None (public) | Paginated messages with signed photo URLs |
| DELETE | `/api/messages/[groupId]?sk=...` | Bearer token | Hide single message |
| DELETE | `/api/messages/[groupId]?all=true` | Bearer token | Hide all messages in group |
| PATCH | `/api/messages/[groupId]` | Bearer token | Save card position {sk, posX, posY} |
| GET | `/api/groups` | None (public) | List available groups |
| POST | `/api/admin` | None (password in body) | Admin login |
| GET | `/api/admin` | Bearer token | Get groups + stats |
| DELETE | `/api/admin?action=hide&groupId=X&sk=Y` | Bearer token | Hide message via admin |
| DELETE | `/api/admin?action=clear&groupId=X` | Bearer token | Clear all group messages |
| GET | `/api/health` | None | Health check (returns 200) |

### Payload Schemas

#### POST /api/webhook/[groupId]

**Request** (from Telegram):
```json
{
  "update_id": 123456789,
  "message": {
    "message_id": 42,
    "from": { "id": 12345, "first_name": "Alice", "last_name": "Chen", "username": "alice_c" },
    "chat": { "id": -1001234567890, "type": "supergroup" },
    "date": 1700000000,
    "text": "@my_bot Hello world!",
    "photo": [
      { "file_id": "AgACAgI...", "width": 320, "height": 240 },
      { "file_id": "AgACAgI...", "width": 1280, "height": 960 }
    ],
    "caption": "@my_bot Check this out",
    "entities": [{ "type": "mention", "offset": 0, "length": 7 }]
  }
}
```

**Response**: `{"status": "ok"}` (always 200 to avoid Telegram retries)

**Headers required**: `X-Telegram-Bot-Api-Secret-Token: <webhook_secret>`

#### GET /api/messages/[groupId]

**Query params**:
- `limit` (optional): 1-100, default 50
- `cursor` (optional): SK value for pagination
- `after` (optional): timestamp for polling new messages

**Response**:
```json
{
  "messages": [
    {
      "messageId": 42,
      "groupId": "demo-group",
      "type": "photo",
      "text": "Hello world!",
      "photoUrl": "https://s3.amazonaws.com/...?X-Amz-Signature=...",
      "senderName": "Alice Chen",
      "senderUsername": "alice_c",
      "timestamp": 1700000000000,
      "createdAt": "2024-11-14T22:13:20.000Z",
      "sk": "MSG#000001700000000#42",
      "signatureStatus": "completed",
      "quantumNumber": 452,
      "publicKeyHash": "7B284BB3D413",
      "quantumSignature": "a3F2b8c9d0e1f2g3h4i5",
      "bellState": [0.49, 0.01, 0.01, 0.49],
      "visualColor": "hsl(207, 85%, 55%)",
      "posX": 0.35,
      "posY": 0.22
    }
  ],
  "nextCursor": "MSG#000001699999000#41",
  "groupName": "Demo Photo Wall",
  "groupId": "demo-group"
}
```

#### PATCH /api/messages/[groupId]

**Request**:
```json
{
  "sk": "MSG#000001700000000#42",
  "posX": 0.45,
  "posY": 0.30
}
```

**Response**: `{"ok": true}`

#### POST /api/admin

**Request**: `{"password": "admin-secret-value"}`

**Response (success)**: `{"ok": true, "token": "admin-secret-value"}`

**Response (failure)**: `{"error": "Invalid password"}` (401)

### Real-Time Updates

The system uses **polling** rather than WebSocket connections:

- **Interval**: 5 seconds
- **Mechanism**: Client-side `setInterval` calling `GET /api/messages/[groupId]?after={lastTimestamp}`
- **Rationale**: Simpler architecture for ECS Fargate (no sticky sessions needed), sufficient for event use case where message frequency is low-to-moderate

Future enhancement: WebSocket via API Gateway for sub-second updates.

### OpenClaw Integration Points

The system is designed for future OpenClaw deployment with the following integration points:

#### Deployment Configuration

```yaml
# openclaw.yml (future)
service:
  name: telegram-photo-wall
  runtime: container
  image: ./photo-wall
  port: 3000
  health_check: /api/health

scaling:
  min_instances: 1
  max_instances: 4
  target_cpu: 70

environment:
  TABLE_NAME: ${resource.dynamodb.table_name}
  BUCKET_NAME: ${resource.s3.bucket_name}
  WEBHOOK_SECRET_ARN: ${secret.webhook_secret.arn}
  ADMIN_SECRET_ARN: ${secret.admin_password.arn}
  GROUP_CONFIG: ${var.telegram_groups_json}
  AWS_REGION_NAME: ${region}
  BRAKET_BUCKET: ${resource.braket_bucket.name}

quantum:
  provider: aws-braket
  device: arn:aws:braket:::device/quantum-simulator/amazon/sv1
  fallback: local-crypto
  result_bucket: ${resource.braket_bucket.name}
```

#### Environment Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `TABLE_NAME` | CDK/OpenClaw resource | DynamoDB table name |
| `BUCKET_NAME` | CDK/OpenClaw resource | S3 photo bucket name |
| `BRAKET_BUCKET` | CDK/OpenClaw resource | S3 bucket for Braket results |
| `WEBHOOK_SECRET_ARN` | Secrets Manager | ARN of webhook verification secret |
| `ADMIN_SECRET_ARN` | Secrets Manager | ARN of admin password secret |
| `GROUP_CONFIG` | JSON string | Array of group configurations |
| `AWS_REGION_NAME` | Deployment config | AWS region for SDK clients |
| `NODE_ENV` | Fixed: "production" | Node.js environment |
| `PORT` | Fixed: "3000" | Server listen port |

#### Scaling Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Min instances | 1 | Always-on for webhook reception |
| Max instances | 4 | Handle event spikes (100+ concurrent users) |
| CPU target | 70% | Scale out before saturation |
| Scale-out cooldown | 30s | Respond quickly to traffic bursts |
| Scale-in cooldown | 60s | Avoid flapping |
| Memory | 1024 MB | Next.js + image processing headroom |
| CPU | 512 (0.5 vCPU) | Sufficient for I/O-bound workload |

## Input/Output Definitions

### Quantum Processing Module

#### Inputs

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `username` | string | Yes | Telegram sender display name (seed for circuit rotations) |
| `messageText` | string | Yes | Message content or fallback `msg-{id}` |
| Circuit type | enum | Internal | `random` (4-qubit RNG) or `bell` (2-qubit entanglement) |
| Shots | number | Internal | 100 (RNG) or 200 (Bell) |
| Backend | string | Config | `arn:aws:braket:::device/quantum-simulator/amazon/sv1` |

#### Outputs

| Field | Type | Description |
|-------|------|-------------|
| `quantumNumber` | number (0-1000) | Quantum random number from SV1 measurement |
| `publicKeyHash` | string (12 hex chars) | ToyLWE public key hash (e.g., `"7B284BB3D413"`) |
| `signature` | string (24 chars, base64) | ToyLWE signature |
| `bellState` | [number, number, number, number] | Bell state probabilities [P(00), P(01), P(10), P(11)] |
| `algorithm` | string | `"ToyLWE-Braket-SV1"` or `"ToyLWE-local-fallback"` |
| `visualColor` | string | HSL color derived from quantum data (e.g., `"hsl(207, 85%, 55%)"`) |
| `device` | string | `"SV1"` or `"local-fallback"` |

#### Error Handling

- Braket timeout (30s) → falls back to local crypto
- Braket task FAILED/CANCELLED → falls back to local crypto
- S3 results unreadable → falls back to local crypto
- All fallbacks produce deterministic-looking but cryptographically-seeded results

### Frontend Rendering

#### Inputs (from API)

- Array of message objects (see GET /api/messages schema above)
- Group metadata (name, groupId)

#### Outputs (rendered)

- Positioned sticky-note cards (absolute % positioning, draggable)
- Quantum badge on each card: `Q#{number} | {publicKeyHash}`
- HSL-colored card borders from `visualColor`
- Photo thumbnails with click-to-expand lightbox
- Leaderboard showing top message senders
- Event logo overlay (from `/public/logo.png`)
