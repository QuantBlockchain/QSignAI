# 本地开发指南

## 架构说明

本地开发时，Next.js 运行在你的机器上，但**直接连接已部署的 AWS 资源**（DynamoDB、S3、Secrets Manager）。不需要安装本地数据库。

```
本地 Next.js (localhost:3000)
   ├── 读写 → AWS DynamoDB（线上同一张表）
   ├── 读写 → AWS S3（线上同一个桶）
   └── 读取 → AWS Secrets Manager（Bot Token）

Telegram → ngrok → localhost:3000  （调试 webhook 时）
```

## 前置条件

- Node.js 20+
- AWS CLI 已配置凭证（`aws configure`），且该凭证有权访问已部署的资源
- （可选）[ngrok](https://ngrok.com/) — 仅在需要调试 Telegram webhook 时使用

## 快速开始

### 1. 生成本地环境变量

```bash
# 从已部署的 CDK 栈自动拉取所有资源 ID
./scripts/setup-local-env.sh
```

该脚本会生成 `photo-wall/.env.local`，内容类似：

```env
AWS_REGION_NAME=us-west-2
TABLE_NAME=TelegramPhotoWallStack-MessagesTable05B58A27-xxxxx
BUCKET_NAME=telegramphotowallstack-photobucket465738b3-xxxxx
WEBHOOK_SECRET_ARN=arn:aws:secretsmanager:us-west-2:xxxxx:secret:telegram/webhook-secret-xxxxx
GROUP_CONFIG=[{"groupId":"demo-group","chatId":"-1001234567890","name":"Demo Photo Wall","secretName":"telegram/bot-token/demo-group"}]
```

> 如果你还没有部署过栈，先运行 `./deploy.sh`。

### 2. 启动开发服务器

```bash
cd photo-wall
npm install   # 首次或依赖变更时
npm run dev
```

访问 http://localhost:3000/wall/demo-group 即可看到照片墙。

**热更新**：修改前端组件（TSX/CSS）后浏览器自动刷新，修改 API route 后下次请求自动生效。

### 3. 调试 Telegram Webhook（可选）

如果你需要在本地调试收到的 Telegram 消息，需要用 ngrok 把本地端口暴露到公网：

```bash
# 终端 1: 启动 ngrok
ngrok http 3000

# 记下 ngrok 给的 URL，例如 https://abcd1234.ngrok-free.app
```

```bash
# 终端 2: 将 Telegram webhook 指向本地
./scripts/set-webhook-local.sh https://abcd1234.ngrok-free.app
```

现在 Telegram 群组里的消息会推送到你本地的 Next.js 服务。

**调试完成后，务必恢复生产 webhook：**

```bash
./scripts/set-webhook-prod.sh
```

## 开发场景

### 只改前端样式/交互

直接改 `photo-wall/src/components/` 或 `photo-wall/src/app/` 下的文件，浏览器热更新。不需要 ngrok。线上已有的消息数据会通过 API 正常加载。

### 改 API 逻辑（消息查询）

修改 `photo-wall/src/app/api/messages/` 下的文件，刷新页面即可测试。数据从线上 DynamoDB 读取。

### 改 Webhook 逻辑（消息接收）

需要 ngrok + 切换 webhook 到本地。也可以用 curl 模拟 Telegram 请求：

```bash
# 获取 webhook secret
WEBHOOK_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "telegram/webhook-secret" \
  --query SecretString --output text --region us-west-2)

# 模拟发送文字消息
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

# 模拟发送图片消息（file_id 为假，图片下载会失败但消息会入库）
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

### 改 CDK 基础设施

```bash
# 预览变更
npx cdk diff

# 部署变更
npx cdk deploy

# 部署后重新拉取环境变量（如果资源名变了）
./scripts/setup-local-env.sh
```

## 项目结构速查

```
telegram-photo-wall/
├── photo-wall/                     ← Next.js 应用（本地开发在这里）
│   ├── src/app/api/                ← API Routes（webhook、messages、health）
│   ├── src/components/             ← React 组件（照片墙 UI）
│   ├── src/lib/                    ← 工具库（AWS 客户端、配置、清洗）
│   ├── .env.local                  ← 本地环境变量（不提交 git）
│   └── package.json
├── lib/                            ← CDK 基础设施定义
├── scripts/
│   ├── setup-local-env.sh          ← 生成 .env.local
│   ├── set-webhook-local.sh        ← Webhook → ngrok（本地调试）
│   └── set-webhook-prod.sh         ← Webhook → CloudFront（恢复生产）
└── cdk.json                        ← 群组配置
```
