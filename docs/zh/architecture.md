# 系统架构

## 概述

Telegram 照片墙是一个由量子签名认证的实时活动照片墙系统。用户在 Telegram 群组中发送照片或文字，系统通过量子计算模块（AWS Braket SV1）处理后，将其作为可拖拽的便利贴卡片渲染到一个网页墙上。

## 系统级架构图

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              前端（用户界面）                                     │
│                                                                                 │
│   浏览器 ──→ CloudFront（CDN + TLS + 安全响应头）                                 │
│                    │                                                             │
│                    ▼                                                             │
│   ┌──────────────────────────────────────────┐                                  │
│   │  Next.js 客户端组件                        │                                  │
│   │  ├── PhotoWall（轮询 + 拖拽）              │                                  │
│   │  ├── MessageCard（量子徽章）               │                                  │
│   │  ├── Lightbox（图片预览）                  │                                  │
│   │  └── Admin Dashboard（管理后台）            │                                  │
│   └──────────────────────────────────────────┘                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          后端 / API 层                                           │
│                                                                                 │
│   ALB（secret header 校验） ──→ ECS Fargate（Next.js 服务）                      │
│                                                                                 │
│   API 路由：                                                                     │
│   ├── POST /api/webhook/[groupId]     ← Telegram 推送消息入口                    │
│   ├── GET  /api/messages/[groupId]    → 分页消息 + 签名图片 URL                  │
│   ├── DELETE /api/messages/[groupId]  → 管理员：隐藏消息                         │
│   ├── PATCH  /api/messages/[groupId]  → 管理员：保存卡片位置                     │
│   ├── GET  /api/groups                → 群组列表                                 │
│   ├── POST /api/admin                 → 管理员登录（密码校验）                   │
│   ├── GET  /api/admin                 → 管理员：群组统计                         │
│   └── GET  /api/health                → ALB 健康检查                             │
│                                                                                 │
│   安全：                                                                         │
│   ├── Telegram webhook secret token 校验                                         │
│   ├── 管理 / 写接口的 Bearer token 鉴权                                          │
│   ├── CloudFront → ALB secret header（阻断对 ALB 的直连）                        │
│   └── 输入清洗（XSS 防护）                                                       │
└─────────────────────────────────────────────────────────────────────────────────┘
                                     │
                        ┌────────────┼────────────┐
                        ▼            ▼            ▼
┌──────────────────────────┐ ┌─────────────┐ ┌──────────────────────────────────┐
│  量子计算模块             │ │  数据库层    │ │  存储层                           │
│                          │ │             │ │                                  │
│  AWS Braket SV1          │ │  DynamoDB   │ │  S3（照片）                       │
│  ├── 4 量子比特随机数电路 │ │  ├── PK/SK  │ │  ├── 私有，加密                   │
│  ├── 2 量子比特 Bell 态   │ │  │   schema │ │  ├── 通过预签名 URL 访问           │
│  ├── ToyLWE 签名          │ │  ├── 按需    │ │  └── 启用版本控制                 │
│  └── 本地 crypto          │ │  │   计费    │ │                                  │
│      回退                 │ │  └── PITR   │ │  S3（Braket 结果）                │
│                          │ │             │ │  └── amazon-braket-* 桶            │
│  ┌─────────────────────┐ │ │             │ │                                  │
│  │ ░░░░░░░░░░░░░░░░░░░ │ │ │             │ │  Secrets Manager                 │
│  │ ░  OpenClaw Deploy  ░ │ │ │             │ │  ├── Bot tokens                  │
│  │ ░ （未来：混合 QPU   ░ │ │ │             │ │  ├── Webhook secret              │
│  │ ░    路由）         ░ │ │ │             │ │  └── 管理员密码                   │
│  │ ░░░░░░░░░░░░░░░░░░░ │ │ │             │ │                                  │
│  └─────────────────────┘ │ │             │ │                                  │
└──────────────────────────┘ └─────────────┘ └──────────────────────────────────┘
```

## 数据流

### 端到端消息流

```
1. 用户输入
   用户在 Telegram 群组中发送带 @bot 的图片 / 文字
        │
        ▼
2. API 校验
   Telegram → POST /api/webhook/[groupId]
   ├── 校验 X-Telegram-Bot-Api-Secret-Token 头
   ├── 校验 groupId 格式（正则：^[a-zA-Z0-9_-]{1,64}$）
   ├── 确认群组在配置中存在
   ├── 检查消息是否包含 @bot mention
   └── 清洗文本（HTML 实体编码，最长 4096 字符）
        │
        ▼
3. 图片处理（如有）
   ├── 调用 Telegram getFile API → 获取下载 URL
   ├── 下载文件（≤ 20MB）
   ├── 上传到 S3：photos/{groupId}/{messageId}_{fileId}.{ext}
   └── 支持：JPEG / PNG / GIF / WebP / BMP / TIFF / SVG / 静态贴纸
        │
        ▼
4. 数据库写入（第一阶段）
   将消息写入 DynamoDB，signatureStatus = "generating"
   ├── PK: GROUP#{groupId}
   ├── SK: MSG#{timestamp(15 位填充)}#{messageId}
   └── 字段：type、text、senderName、senderUsername、photoKey、timestamp
        │
        ▼
5. 量子任务排队
   检查该发送者在该群组是否已有量子签名
        │
        ├── [已有] → 复用现有签名（不调 Braket）
        │
        └── [新发送者] → 提交到 AWS Braket SV1：
             │
             ▼
6. 设备执行（AWS Braket SV1 模拟器）
   任务 A：量子随机数
   ├── 电路：4 量子比特（H 门 → CNOT 链 → Ry 种子旋转 → 测量）
   ├── Shots：100
   ├── 输出：出现频率最高的比特串 → 整数 mod 1001
   └── 结果写入：s3://amazon-braket-*/braket-results/{taskId}/results.json

   任务 B：Bell 态测量
   ├── 电路：2 量子比特（H q[0] → CNOT q[0],q[1] → 测量）
   ├── Shots：200
   └── 输出：概率分布 [P(00), P(01), P(10), P(11)]
        │
        ▼
7. 结果聚合
   ├── quantumNumber = parseInt(topBitstring, 2) % 1001
   ├── bellState = [P(00), P(01), P(10), P(11)]
   ├── ToyLWE 签名：
   │   ├── 密钥派生：SHAKE-256(seed + quantum_number + random_bytes)
   │   ├── 公钥哈希：SHA-256 → 取前 12 个十六进制字符（大写）
   │   └── 签名：SHA-256 链 → base64（24 字符）
   ├── 视觉颜色：由量子数与 Bell 态派生的 HSL
   └── 更新 DynamoDB：signatureStatus = "completed" + 签名相关字段
        │
        ▼
8. 前端渲染
   浏览器每 5 秒轮询 GET /api/messages/[groupId]
   ├── DynamoDB 查询（按时间倒序，过滤 hidden != true）
   ├── 为图片生成 S3 预签名 URL（1 小时有效期）
   └── 返回 JSON：messages[]、nextCursor、groupName
        │
        ▼
   React 组件渲染：
   ├── PhotoWall：绝对定位卡片，支持拖拽
   ├── MessageCard：便利贴样式 + 量子徽章（Q#number | pubKeyHash）
   ├── Leaderboard：发送者排行榜
   └── Lightbox：点击图片放大
```

### 管理员流程

```
管理员 → POST /api/admin {password}
       → 与 Secrets Manager 中的 telegram/admin-password 校验
       → 返回 token（密码本身复用为 bearer token）
       → 后续请求：Authorization: Bearer {token}
       → GET /api/admin（群组），DELETE /api/admin?action=hide|clear
```

## 接口规范

### REST API 端点

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/webhook/[groupId]` | Telegram secret token | 接收 Telegram 消息 |
| GET | `/api/messages/[groupId]` | 公开 | 分页消息 + 签名图片 URL |
| DELETE | `/api/messages/[groupId]?sk=...` | Bearer token | 隐藏单条消息 |
| DELETE | `/api/messages/[groupId]?all=true` | Bearer token | 隐藏整个群组的消息 |
| PATCH | `/api/messages/[groupId]` | Bearer token | 保存卡片位置 {sk, posX, posY} |
| GET | `/api/groups` | 公开 | 列出群组 |
| POST | `/api/admin` | 请求体中的密码 | 管理员登录 |
| GET | `/api/admin` | Bearer token | 群组及统计 |
| DELETE | `/api/admin?action=hide&groupId=X&sk=Y` | Bearer token | 管理员隐藏单条 |
| DELETE | `/api/admin?action=clear&groupId=X` | Bearer token | 管理员清空整个群组 |
| GET | `/api/health` | 公开 | 健康检查（返回 200） |

### 请求 / 响应结构

#### POST /api/webhook/[groupId]

**请求**（来自 Telegram）：
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

**响应**：`{"status": "ok"}`（始终返回 200，避免 Telegram 重试）

**必需请求头**：`X-Telegram-Bot-Api-Secret-Token: <webhook_secret>`

#### GET /api/messages/[groupId]

**Query 参数**：
- `limit`（可选）：1–100，默认 50
- `cursor`（可选）：分页游标 SK
- `after`（可选）：用于轮询的时间戳

**响应**：
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

**请求**：
```json
{
  "sk": "MSG#000001700000000#42",
  "posX": 0.45,
  "posY": 0.30
}
```

**响应**：`{"ok": true}`

#### POST /api/admin

**请求**：`{"password": "admin-secret-value"}`

**成功响应**：`{"ok": true, "token": "admin-secret-value"}`

**失败响应**：`{"error": "Invalid password"}`（401）

### 实时更新

系统采用**轮询**而非 WebSocket：

- **间隔**：5 秒
- **机制**：客户端 `setInterval` 调用 `GET /api/messages/[groupId]?after={lastTimestamp}`
- **理由**：在 ECS Fargate 上更简单（无需粘性会话），活动场景的消息频率以中低密度为主，已足够

未来增强：通过 API Gateway WebSocket 实现亚秒级更新。

### OpenClaw 集成点

系统为未来在 OpenClaw 上的部署预留了如下集成点：

#### 部署配置

```yaml
# openclaw.yml（未来）
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

#### 环境变量

| 变量 | 来源 | 说明 |
|------|------|------|
| `TABLE_NAME` | CDK / OpenClaw 资源 | DynamoDB 表名 |
| `BUCKET_NAME` | CDK / OpenClaw 资源 | S3 照片桶名 |
| `BRAKET_BUCKET` | CDK / OpenClaw 资源 | Braket 结果桶名 |
| `WEBHOOK_SECRET_ARN` | Secrets Manager | Webhook 验证密钥 ARN |
| `ADMIN_SECRET_ARN` | Secrets Manager | 管理员密码 ARN |
| `GROUP_CONFIG` | JSON 字符串 | 群组配置数组 |
| `AWS_REGION_NAME` | 部署配置 | AWS SDK 使用的区域 |
| `NODE_ENV` | 固定："production" | Node.js 运行模式 |
| `PORT` | 固定："3000" | 服务监听端口 |

#### 扩缩容参数

| 参数 | 取值 | 理由 |
|------|------|------|
| 最小实例数 | 1 | webhook 必须始终在线 |
| 最大实例数 | 4 | 应对活动峰值（100+ 并发观众） |
| CPU 目标 | 70% | 在饱和前扩容 |
| 扩容冷却 | 30s | 快速响应突发流量 |
| 缩容冷却 | 60s | 避免抖动 |
| 内存 | 1024 MB | 为 Next.js 与图片处理留出余量 |
| CPU | 512（0.5 vCPU） | 适合 I/O 密集型负载 |

## 输入输出定义

### 量子计算模块

#### 输入

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | 是 | Telegram 发送者显示名（用作电路旋转的种子） |
| `messageText` | string | 是 | 消息内容；为空时回退到 `msg-{id}` |
| Circuit type | enum | 内部 | `random`（4 量子比特 RNG）或 `bell`（2 量子比特纠缠） |
| Shots | number | 内部 | 100（RNG）或 200（Bell） |
| Backend | string | 配置 | `arn:aws:braket:::device/quantum-simulator/amazon/sv1` |

#### 输出

| 字段 | 类型 | 说明 |
|------|------|------|
| `quantumNumber` | number（0–1000） | 由 SV1 测量推导出的量子随机数 |
| `publicKeyHash` | string（12 hex） | ToyLWE 公钥哈希（如 `"7B284BB3D413"`） |
| `signature` | string（24 字符 base64） | ToyLWE 签名 |
| `bellState` | [number, number, number, number] | Bell 态概率 [P(00), P(01), P(10), P(11)] |
| `algorithm` | string | `"ToyLWE-Braket-SV1"` 或 `"ToyLWE-local-fallback"` |
| `visualColor` | string | 由量子数据派生的 HSL 颜色（如 `"hsl(207, 85%, 55%)"`） |
| `device` | string | `"SV1"` 或 `"local-fallback"` |

#### 错误处理

- Braket 超时（30s）→ 回退到本地 crypto
- Braket 任务 FAILED / CANCELLED → 回退到本地 crypto
- S3 结果不可读 → 回退到本地 crypto
- 所有回退都会产生看上去具有确定性、但本质由密码学种子驱动的结果

### 前端渲染

#### 输入（来自 API）

- 消息对象数组（结构见上方 GET /api/messages）
- 群组元数据（name、groupId）

#### 输出（渲染结果）

- 绝对百分比定位的便利贴卡片，可拖拽
- 每张卡上的量子徽章：`Q#{number} | {publicKeyHash}`
- 由 `visualColor` 决定的 HSL 卡片描边
- 缩略图，点击放大进入 Lightbox
- 排行榜按发送者消息数排序
- 顶部居中的活动 Logo（来自 `/public/logo.png`）
