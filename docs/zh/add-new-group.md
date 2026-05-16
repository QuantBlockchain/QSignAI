# 如何创建一个新的 Group 照片墙

本文档说明如何为一个新的 Telegram 群组创建独立的照片墙。每个群组需要一个独立的 Bot。

---

## 前置条件

- 项目已部署过至少一次（`./deploy.sh` 或 `npx cdk deploy`）
- 已安装 AWS CLI 并配置好凭证
- 有 Telegram 账号

---

## 第一步：创建新的 Telegram Bot

1. 打开 Telegram，搜索 **@BotFather**
2. 发送 `/newbot`
3. 输入 Bot 名称（如 `Marketing Wall Bot`）和用户名（如 `marketing_wall_bot`，必须以 `bot` 结尾）
4. 记下返回的 **Bot Token**
5. 关闭 Privacy Mode：BotFather → `/mybots` → 选择 Bot → Bot Settings → Group Privacy → **Turn off**

---

## 第二步：存储 Bot Token 到 Secrets Manager

```bash
aws secretsmanager create-secret \
  --name "telegram/bot-token/marketing" \
  --secret-string "YOUR_NEW_BOT_TOKEN" \
  --region us-west-2
```

> `telegram/bot-token/marketing` 中的 `marketing` 可以自定义，和下面 `secretName` 对应即可。

---

## 第三步：在 `cdk.json` 中添加新群组

编辑项目根目录的 `cdk.json`，在 `telegramGroups` 数组中添加一项：

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

### 字段说明

| 字段 | 必填 | 说明 | 示例 |
|------|------|------|------|
| `groupId` | 是 | 照片墙的 URL 路径标识，只能用英文、数字、下划线、连字符 | `marketing` |
| `chatId` | 是 | Telegram 群组的 Chat ID（负数），获取方式见下方 | `-1009876543210` |
| `name` | 是 | 照片墙页面上显示的标题名称 | `Marketing Photo Wall` |
| `secretName` | 是 | Secrets Manager 中 Bot Token 的名称，需与第二步一致 | `telegram/bot-token/marketing` |
| `botUsername` | 是 | Bot 的 @用户名（不含 @），用于过滤只有 @bot 的消息才上墙 | `marketing_wall_bot` |

---

## 第四步：部署

```bash
cd photo-wall && npm run build && cd ..
npx cdk deploy --require-approval never
```

部署完成后，CDK 输出会显示新群组的 Webhook URL：

```
TelegramPhotoWallStack.WebhookUrlmarketing = https://<YOUR_DOMAIN>/api/webhook/marketing
```

---

## 第五步：注册 Telegram Webhook

```bash
# 获取 webhook 验证密钥
WEBHOOK_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "telegram/webhook-secret" \
  --query SecretString --output text \
  --region us-west-2)

# 获取新 Bot 的 Token
NEW_BOT_TOKEN=$(aws secretsmanager get-secret-value \
  --secret-id "telegram/bot-token/marketing" \
  --query SecretString --output text \
  --region us-west-2)

# 注册 Webhook
curl -X POST "https://api.telegram.org/bot${NEW_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"https://<YOUR_DOMAIN>/api/webhook/marketing\",
    \"secret_token\": \"${WEBHOOK_SECRET}\",
    \"allowed_updates\": [\"message\"]
  }"
```

> 将 `https://<YOUR_DOMAIN>` 替换为 CDK 输出的实际 CloudFront URL。

### 验证 Webhook

```bash
curl -s "https://api.telegram.org/bot${NEW_BOT_TOKEN}/getWebhookInfo" | python3 -m json.tool
```

---

## 第六步：将 Bot 加入群组

1. 打开目标 Telegram 群组
2. 添加成员 → 搜索 `@marketing_wall_bot` → 添加
3. 在群组中发送 `@marketing_wall_bot 你好` 测试

---

## 第七步：访问照片墙

```
https://<YOUR_DOMAIN>/wall/marketing
```

如果配置了多个群组，页面顶部会出现群组切换按钮。

---

## 附录

### 获取 Telegram 群组 Chat ID

**方法一：通过 Bot API**

1. 将 Bot 加入群组
2. 在群组中发送一条消息
3. 执行：
```bash
curl -s "https://api.telegram.org/bot${NEW_BOT_TOKEN}/getUpdates" | python3 -m json.tool
```
4. 在返回 JSON 中找到 `message.chat.id`（群组的 Chat ID 是负数，如 `-1009876543210`）

**方法二：通过 @userinfobot**

1. 将 `@userinfobot` 添加到群组
2. 它会回复群组的 Chat ID
3. 获取后移出即可

### 删除群组

1. 从 `cdk.json` 的 `telegramGroups` 中移除该群组配置
2. 重新部署：`npx cdk deploy`
3. （可选）删除 Bot Token：`aws secretsmanager delete-secret --secret-id "telegram/bot-token/marketing" --region us-west-2`
4. （可选）删除 Webhook：`curl -X POST "https://api.telegram.org/bot${NEW_BOT_TOKEN}/deleteWebhook"`

### 完整操作速查

| 步骤 | 命令/操作 |
|------|-----------|
| 1. 创建 Bot | BotFather `/newbot` + 关闭 Privacy Mode |
| 2. 存 Token | `aws secretsmanager create-secret ...` |
| 3. 改配置 | 编辑 `cdk.json` 添加新群组 |
| 4. 部署 | `npx cdk deploy` |
| 5. 注册 Webhook | `curl ... setWebhook` |
| 6. 加 Bot 到群 | Telegram 群组添加成员 |
| 7. 测试 | 群组发 `@bot 你好`，访问 `/wall/groupId` |
