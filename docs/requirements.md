# Telegram 群组照片墙 - 需求文档

## 1. 项目概述

### 1.1 背景
客户需要一个系统，能够实时同步 Telegram 群组中用户发送的消息（包括文字和图片）到一个可视化的照片墙页面。系统支持配置多个不同的 Telegram 群组，每个群组拥有独立的照片墙展示页面。

### 1.2 目标
- 实时接收 Telegram 群组消息（文字 + 图片）
- 以照片墙形式展示群组内容
- 支持多群组配置，每个群组独立展示
- 部署在 AWS 上，使用 CDK 进行基础设施即代码管理
- 确保系统安全，无安全漏洞

## 2. 系统架构

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Telegram    │────▶│ API Gateway  │────▶│  Webhook Lambda │
│  Bot API     │     │ (webhook)    │     │  (消息处理)      │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
                                          ┌────────┼────────┐
                                          ▼        ▼        ▼
                                    ┌─────────┐ ┌──────┐ ┌─────────┐
                                    │DynamoDB │ │  S3  │ │Secrets  │
                                    │(消息表) │ │(图片)│ │Manager  │
                                    └─────────┘ └──────┘ └─────────┘
                                          │        │
                                          ▼        ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  用户浏览器  │◀────│ CloudFront   │◀────│  API Lambda     │
│  (照片墙)   │     │ + S3 静态站  │     │  (数据查询)      │
└─────────────┘     └──────────────┘     └─────────────────┘
```

## 3. 功能需求

### 3.1 Telegram Bot Webhook
- **FR-01**: 通过 Telegram Bot API Webhook 实时接收群组消息
- **FR-02**: 支持处理文字消息（text message）
- **FR-03**: 支持处理图片消息（photo message），包含 caption
- **FR-04**: 验证 Webhook 请求来源（Telegram secret token）
- **FR-05**: 提取发送者信息（用户名、头像等）
- **FR-06**: 将消息元数据存储到 DynamoDB
- **FR-07**: 将图片下载并存储到 S3

### 3.2 照片墙 API
- **FR-08**: 提供 REST API 查询指定群组的消息列表
- **FR-09**: 支持分页查询（基于时间戳的游标分页）
- **FR-10**: 返回消息内容、图片 URL、发送者信息、时间戳
- **FR-11**: 为 S3 图片生成 CloudFront 签名 URL

### 3.3 照片墙前端
- **FR-12**: 响应式瀑布流/网格布局展示照片墙
- **FR-13**: 支持通过 URL 路径区分不同群组（如 `/wall/{group-id}`）
- **FR-14**: 实时轮询新消息（每 5 秒）
- **FR-15**: 新消息以动画效果出现
- **FR-16**: 点击图片可放大预览
- **FR-17**: 展示消息文字、发送者名称、发送时间
- **FR-18**: 支持移动端和桌面端自适应

### 3.4 多群组管理
- **FR-19**: 通过 CDK context 或 SSM Parameter 配置多个群组
- **FR-20**: 每个群组配置：群组 ID、Bot Token、照片墙名称
- **FR-21**: 不同群组数据完全隔离
- **FR-22**: 共享基础设施（同一 API Gateway、DynamoDB 表、S3 桶）

## 4. 非功能需求

### 4.1 安全性
- **NFR-01**: Bot Token 存储在 AWS Secrets Manager，不硬编码
- **NFR-02**: Webhook 端点使用 Telegram secret token 验证请求来源
- **NFR-03**: API Gateway 配置 WAF 防护
- **NFR-04**: S3 桶禁止公开访问，通过 CloudFront OAC 访问
- **NFR-05**: DynamoDB 和 S3 启用静态加密（KMS）
- **NFR-06**: Lambda 函数使用最小权限 IAM 角色
- **NFR-07**: 前端 API 请求配置 CORS 白名单
- **NFR-08**: 所有传输使用 HTTPS/TLS
- **NFR-09**: 输入验证：对所有用户输入进行清洗和验证
- **NFR-10**: CloudFront 配置安全响应头（CSP, X-Frame-Options 等）
- **NFR-11**: S3 桶启用版本控制和访问日志
- **NFR-12**: API Gateway 启用访问日志和请求限流

### 4.2 性能
- **NFR-13**: Webhook 响应时间 < 3 秒（Telegram 超时限制）
- **NFR-14**: 照片墙页面加载时间 < 2 秒
- **NFR-15**: 支持并发 100+ 用户浏览

### 4.3 可用性
- **NFR-16**: CloudFront 全球分发，低延迟访问
- **NFR-17**: Lambda 自动扩缩容
- **NFR-18**: DynamoDB 按需计费模式，自动扩缩

## 5. 数据模型

### 5.1 DynamoDB 表设计

**消息表 (Messages)**
| 字段 | 类型 | 说明 |
|------|------|------|
| PK | String | `GROUP#{groupId}` |
| SK | String | `MSG#{timestamp}#{messageId}` |
| messageId | Number | Telegram 消息 ID |
| groupId | String | 群组标识符 |
| type | String | `text` / `photo` |
| text | String | 消息文字内容 |
| photoKey | String | S3 图片 key（仅图片消息） |
| senderName | String | 发送者显示名称 |
| senderUsername | String | 发送者 @username |
| timestamp | Number | Unix 时间戳（毫秒） |
| createdAt | String | ISO 8601 格式时间 |

### 5.2 S3 存储结构
```
photos/
  {groupId}/
    {messageId}_{fileId}.jpg
```

## 6. API 设计

### 6.1 Webhook 端点
```
POST /webhook/{groupId}
Headers:
  X-Telegram-Bot-Api-Secret-Token: {secret}
Body: Telegram Update JSON
Response: 200 OK
```

### 6.2 消息查询端点
```
GET /api/messages/{groupId}?limit=20&cursor={lastSK}
Response:
{
  "messages": [...],
  "nextCursor": "MSG#...",
  "groupName": "My Group"
}
```

## 7. 部署架构

### 7.1 AWS 资源清单
| 服务 | 用途 |
|------|------|
| API Gateway (REST) | Webhook + API 端点 |
| Lambda (Node.js 20) | Webhook 处理 + API 查询 |
| DynamoDB | 消息存储 |
| S3 | 图片存储 + 静态网站 |
| CloudFront | CDN 分发（前端 + 图片） |
| Secrets Manager | Bot Token 存储 |
| WAF | API 防护 |
| CloudWatch | 日志和监控 |
| KMS | 数据加密 |

### 7.2 CDK 项目结构
```
telegram-photo-wall/
├── bin/
│   └── app.ts                  # CDK app 入口
├── lib/
│   └── telegram-photo-wall-stack.ts  # 主栈定义
├── lambda/
│   ├── webhook/
│   │   └── index.ts            # Webhook 处理函数
│   └── api/
│       └── index.ts            # API 查询函数
├── frontend/
│   ├── index.html              # 照片墙 SPA
│   ├── style.css               # 样式
│   └── app.js                  # 前端逻辑
├── docs/
│   └── requirements.md         # 本文档
├── cdk.json                    # CDK 配置
├── tsconfig.json               # TypeScript 配置
├── package.json                # 依赖管理
└── .gitignore
```

## 8. 配置示例

```json
// cdk.json context
{
  "telegramGroups": [
    {
      "groupId": "innovation-team",
      "chatId": "-1001234567890",
      "name": "创新团队照片墙",
      "secretName": "telegram/bot-token/innovation-team"
    },
    {
      "groupId": "marketing",
      "chatId": "-1009876543210",
      "name": "市场部照片墙",
      "secretName": "telegram/bot-token/marketing"
    }
  ]
}
```

## 9. 安全检查清单

- [ ] Bot Token 不在代码或环境变量中明文出现
- [ ] Webhook 请求来源验证
- [ ] S3 桶无公开访问
- [ ] IAM 角色最小权限
- [ ] 所有 API 启用 HTTPS
- [ ] 输入数据清洗（防 XSS/注入）
- [ ] CloudFront 安全头配置
- [ ] WAF 规则配置
- [ ] DynamoDB/S3 加密
- [ ] API 限流配置
