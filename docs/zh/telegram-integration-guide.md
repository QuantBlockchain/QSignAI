# Telegram 集成指南

本文档详细说明如何将 Telegram 群组与照片墙系统进行集成。

---

## 前置条件

- 已完成照片墙系统部署（`./deploy.sh`）
- 拥有 Telegram 账号
- 已安装 AWS CLI 并配置好凭证

## 当前部署信息

| 项目 | 值 |
|------|------|
| CloudFront URL | `https://<YOUR_DOMAIN>` |
| Webhook URL 模板 | `https://<YOUR_DOMAIN>/api/webhook/{groupId}` |

> 如果你重新部署了栈，请通过 `aws cloudformation describe-stacks --stack-name TelegramPhotoWallStack --query "Stacks[0].Outputs"` 获取最新的 URL。

---

## 第一步：创建 Telegram Bot

1. 打开 Telegram，搜索 **@BotFather** 并进入对话

2. 发送 `/newbot`

3. 按提示输入：
   - **Bot 名称**（显示名）：例如 `My Photo Wall Bot`
   - **Bot 用户名**（唯一标识，必须以 `bot` 结尾）：例如 `my_photo_wall_bot`

4. 创建成功后，BotFather 会返回一个 **Bot Token**，格式如下：
   ```
   7123456789:AAH1234567890abcdefghijklmnopqrstuv
   ```

5. **记下这个 Token**，后续步骤需要使用

### 配置 Bot 权限（重要）

默认情况下，Bot 无法读取群组中的所有消息。需要关闭 Privacy Mode：

1. 在 BotFather 对话中发送 `/mybots`
2. 选择你刚创建的 Bot
3. 点击 **Bot Settings** → **Group Privacy**
4. 点击 **Turn off**

> 关闭 Privacy Mode 后，Bot 才能接收群组中所有用户发送的消息。如果不关闭，Bot 只能接收 `/` 开头的命令消息。

---

## 第二步：将 Bot Token 存入 AWS Secrets Manager

将 Bot Token 安全存储到 AWS Secrets Manager 中（不要硬编码在任何配置文件中）：

```bash
aws secretsmanager create-secret \
  --name "telegram/bot-token/demo-group" \
  --secret-string "7123456789:AAH1234567890abcdefghijklmnopqrstuv" \
  --region us-west-2
```

> 将上面的 Token 替换为你自己的 Bot Token。`demo-group` 对应 `cdk.json` 中配置的 `secretName`。

如果 secret 已存在，使用 `update` 命令：

```bash
aws secretsmanager update-secret \
  --secret-id "telegram/bot-token/demo-group" \
  --secret-string "7123456789:AAH1234567890abcdefghijklmnopqrstuv" \
  --region us-west-2
```

### 验证 Secret 已存储

```bash
aws secretsmanager get-secret-value \
  --secret-id "telegram/bot-token/demo-group" \
  --query SecretString --output text \
  --region us-west-2
```

---

## 第三步：获取 Webhook Secret

部署时系统自动生成了一个 64 位随机字符串作为 Webhook 验证密钥，用于确保只有 Telegram 的请求能被系统接受：

```bash
WEBHOOK_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "telegram/webhook-secret" \
  --query SecretString --output text \
  --region us-west-2)

echo $WEBHOOK_SECRET
```

---

## 第四步：注册 Telegram Webhook

告诉 Telegram 将消息推送到我们的系统：

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

期望返回：

```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

### 验证 Webhook 状态

```bash
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo" | python3 -m json.tool
```

期望输出（关键字段）：

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

> 如果 `last_error_message` 不为空，说明 Telegram 推送消息时遇到了错误，请根据错误信息排查。

---

## 第五步：将 Bot 添加到 Telegram 群组

1. 打开你想要同步消息的 Telegram 群组
2. 点击群组名称进入设置 → **添加成员**
3. 搜索你创建的 Bot 用户名（例如 `@my_photo_wall_bot`）
4. 将 Bot 添加到群组

添加成功后，在群组中发送一条测试消息（文字或图片），然后访问照片墙页面查看是否同步：

```
https://<YOUR_DOMAIN>/wall/demo-group
```

---

## 添加更多群组

如果需要为多个 Telegram 群组配置独立的照片墙，按以下步骤操作：

### 1. 为新群组创建 Bot（或复用同一个 Bot）

> 一个 Bot 只能设置一个 Webhook URL。如果需要对接多个群组，**每个群组需要一个独立的 Bot**。

### 2. 存储新 Bot Token

```bash
aws secretsmanager create-secret \
  --name "telegram/bot-token/marketing" \
  --secret-string "NEW_BOT_TOKEN_HERE" \
  --region us-west-2
```

### 3. 更新 `cdk.json` 配置

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
        "name": "市场部照片墙",
        "secretName": "telegram/bot-token/marketing"
      }
    ]
  }
}
```

字段说明：

| 字段 | 说明 | 示例 |
|------|------|------|
| `groupId` | 照片墙的 URL 标识符（英文、数字、下划线、连字符） | `marketing` |
| `chatId` | Telegram 群组的 Chat ID（见下方获取方法） | `-1001234567890` |
| `name` | 照片墙页面显示的标题 | `市场部照片墙` |
| `secretName` | Secrets Manager 中 Bot Token 的名称 | `telegram/bot-token/marketing` |

### 4. 重新部署

```bash
npx cdk deploy --require-approval never
```

### 5. 为新群组注册 Webhook

```bash
NEW_BOT_TOKEN="新 Bot 的 Token"
curl -X POST "https://api.telegram.org/bot${NEW_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"https://<YOUR_DOMAIN>/api/webhook/marketing\",
    \"secret_token\": \"${WEBHOOK_SECRET}\",
    \"allowed_updates\": [\"message\"]
  }"
```

---

## 附录

### 获取 Telegram 群组的 Chat ID

**方法一：通过 Bot API**

1. 将 Bot 加入群组
2. 在群组中发送任意一条消息
3. 执行：

```bash
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getUpdates" | python3 -m json.tool
```

4. 在返回的 JSON 中找到 `message.chat.id`，该值即为 Chat ID（群组的 Chat ID 通常为负数，如 `-1001234567890`）

**方法二：通过 @userinfobot**

1. 将 `@userinfobot` 添加到群组
2. 它会自动回复群组的 Chat ID
3. 获取后可将其移出群组

### 删除 Webhook（调试用）

如果需要临时移除 Webhook：

```bash
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook"
```

### 查看 ECS 日志（排查问题）

```bash
aws logs tail /ecs/telegram-photo-wall --follow --region us-west-2
```

### 常见问题

**Q: 消息发送了但照片墙上看不到？**

1. 确认 Bot 已添加到群组
2. 确认 Bot 的 Privacy Mode 已关闭（BotFather → Bot Settings → Group Privacy → Turn off）
3. 检查 Webhook 状态：`curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"`
4. 查看 ECS 日志是否有报错

**Q: 图片显示不出来？**

1. 图片通过 S3 预签名 URL 访问，有效期 1 小时，刷新页面会获取新的 URL
2. 检查 ECS Task Role 是否有 S3 读写权限（CDK 自动配置，正常情况不需要手动调整）

**Q: Webhook 返回 403？**

1. 确认 `secret_token` 设置正确（必须与 Secrets Manager 中的 `telegram/webhook-secret` 一致）
2. 确认 Webhook URL 中的 `groupId` 与 `cdk.json` 中配置的 `groupId` 一致
