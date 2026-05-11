import { NextRequest, NextResponse } from "next/server";
import { PutItemCommand, UpdateItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { dynamodb, s3, getSecretValue } from "@/lib/aws";
import { getGroup, validateGroupId } from "@/lib/config";
import { sanitizeText } from "@/lib/sanitize";
import { generateQuantumSignature } from "@/lib/quantum-signature";

const TABLE_NAME = process.env.TABLE_NAME || "";
const BUCKET_NAME = process.env.BUCKET_NAME || "";
const WEBHOOK_SECRET_ARN = process.env.WEBHOOK_SECRET_ARN || "";

async function getFileUrl(botToken: string, fileId: string): Promise<string> {
  const resp = await fetch(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const data = await resp.json();
  if (data.ok && data.result.file_path) {
    return `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`;
  }
  throw new Error(`getFile failed: ${JSON.stringify(data)}`);
}

async function downloadFile(url: string): Promise<Buffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
  const arrayBuffer = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > 20 * 1024 * 1024) throw new Error("File too large (>20MB)");
  return buffer;
}

// Check if message mentions the bot (via @username or entities)
function mentionsBot(message: any, botUsername: string): boolean {
  const lower = botUsername.toLowerCase();

  // Check entities for bot_command or mention
  if (message.entities) {
    for (const e of message.entities) {
      if (e.type === "mention") {
        const mentioned = (message.text || "").substring(e.offset, e.offset + e.length).toLowerCase();
        if (mentioned === `@${lower}`) return true;
      }
      if (e.type === "bot_command") return true;
    }
  }

  // Check caption_entities for photo messages
  if (message.caption_entities) {
    for (const e of message.caption_entities) {
      if (e.type === "mention") {
        const mentioned = (message.caption || "").substring(e.offset, e.offset + e.length).toLowerCase();
        if (mentioned === `@${lower}`) return true;
      }
    }
  }

  // Fallback: check text contains @botUsername
  const fullText = (message.text || "") + " " + (message.caption || "");
  return fullText.toLowerCase().includes(`@${lower}`);
}

// Look up existing quantum signature for this sender in this group
async function findExistingSignature(
  groupId: string,
  senderName: string
): Promise<{ quantumNumber: number; publicKeyHash: string; signature: string; bellState: string; algorithm: string; visualColor: string } | null> {
  const result = await dynamodb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      FilterExpression: "senderName = :sn AND signatureStatus = :s",
      ExpressionAttributeValues: {
        ":pk": { S: `GROUP#${groupId}` },
        ":sn": { S: senderName },
        ":s": { S: "completed" },
      },
      Limit: 10,
      ScanIndexForward: false,
    })
  );

  const item = result.Items?.[0];
  if (!item?.quantumNumber?.N) return null;

  return {
    quantumNumber: parseInt(item.quantumNumber.N, 10),
    publicKeyHash: item.publicKeyHash?.S || "",
    signature: item.quantumSignature?.S || "",
    bellState: item.bellState?.S || "[]",
    algorithm: item.signatureAlgorithm?.S || "",
    visualColor: item.visualColor?.S || "",
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;

  try {
    if (!validateGroupId(groupId)) {
      return NextResponse.json({ error: "Invalid group ID" }, { status: 400 });
    }

    const groupConfig = getGroup(groupId);
    if (!groupConfig) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // Verify Telegram secret token
    const secretToken = request.headers.get("x-telegram-bot-api-secret-token");
    const webhookSecret = await getSecretValue(WEBHOOK_SECRET_ARN);
    if (secretToken !== webhookSecret) {
      console.warn(`[webhook] Invalid secret token for group ${groupId}`);
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.text();
    console.log(`[webhook] Raw body (first 1000 chars): ${body.substring(0, 1000)}`);

    const update = JSON.parse(body);
    const message = update.message;

    if (!message) {
      console.log(`[webhook] No message field in update, keys: ${Object.keys(update).join(",")}`);
      return NextResponse.json({ status: "ok" });
    }

    // Only process messages that @mention the bot
    if (groupConfig.botUsername) {
      if (!mentionsBot(message, groupConfig.botUsername)) {
        console.log(`[webhook] Message does not mention @${groupConfig.botUsername}, skipping`);
        return NextResponse.json({ status: "ok" });
      }
    }

    console.log(`[webhook] Message keys: ${Object.keys(message).join(",")}, has photo: ${!!message.photo}, photo length: ${message.photo?.length ?? 0}`);

    const messageId = message.message_id;
    const timestamp = (message.date || Math.floor(Date.now() / 1000)) * 1000;
    const senderName = sanitizeText(
      message.from?.first_name
        ? `${message.from.first_name}${message.from.last_name ? " " + message.from.last_name : ""}`
        : "Anonymous"
    );
    const senderUsername = sanitizeText(message.from?.username || "");

    let messageType = "text";
    let text = sanitizeText(message.text || message.caption || "");
    let photoKey = "";

    // Strip @botUsername from displayed text
    if (groupConfig.botUsername) {
      const botMention = new RegExp(`@${groupConfig.botUsername}\\s*`, "gi");
      text = text.replace(botMention, "").trim();
    }

    // Determine file_id and content type
    const IMAGE_MIME_TYPES = new Set([
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "image/bmp", "image/tiff", "image/svg+xml",
    ]);

    let fileId: string | null = null;
    let contentType = "image/jpeg";
    let fileExt = "jpg";

    if (message.photo && message.photo.length > 0) {
      const photo = message.photo[message.photo.length - 1];
      fileId = photo.file_id;
      messageType = "photo";
    } else if (message.document && message.document.mime_type && IMAGE_MIME_TYPES.has(message.document.mime_type)) {
      fileId = message.document.file_id;
      contentType = message.document.mime_type;
      fileExt = contentType.split("/")[1] || "bin";
      if (fileExt === "svg+xml") fileExt = "svg";
      messageType = "photo";
    } else if (message.sticker && !message.sticker.is_animated && !message.sticker.is_video) {
      fileId = message.sticker.file_id;
      contentType = "image/webp";
      fileExt = "webp";
      messageType = "photo";
      if (!text) text = message.sticker.emoji || "";
    }

    if (fileId) {
      console.log(`[webhook] Processing image: msgId=${messageId}, fileId=${fileId}, type=${contentType}`);
      try {
        const botToken = await getSecretValue(groupConfig.secretName);
        const fileUrl = await getFileUrl(botToken, fileId);
        const fileData = await downloadFile(fileUrl);
        photoKey = `photos/${groupId}/${messageId}_${fileId}.${fileExt}`;
        await s3.send(
          new PutObjectCommand({ Bucket: BUCKET_NAME, Key: photoKey, Body: fileData, ContentType: contentType })
        );
        console.log(`[webhook] Uploaded to S3: ${photoKey}`);
      } catch (err) {
        console.error(`[webhook] Photo processing failed:`, err);
      }
    } else if (!message.text) {
      console.log(`[webhook] Skipping non-text/non-image message`);
      return NextResponse.json({ status: "ok" });
    }

    // Phase 1: Save message immediately with signatureStatus = "generating"
    const pk = `GROUP#${groupId}`;
    const sk = `MSG#${String(timestamp).padStart(15, "0")}#${messageId}`;

    const item: Record<string, any> = {
      PK: { S: pk },
      SK: { S: sk },
      messageId: { N: String(messageId) },
      groupId: { S: groupId },
      type: { S: messageType },
      text: { S: text },
      senderName: { S: senderName },
      senderUsername: { S: senderUsername },
      timestamp: { N: String(timestamp) },
      createdAt: { S: new Date(timestamp).toISOString() },
      signatureStatus: { S: "generating" },
    };

    if (photoKey) {
      item.photoKey = { S: photoKey };
    }

    await dynamodb.send(new PutItemCommand({ TableName: TABLE_NAME, Item: item }));
    console.log(`[webhook] Saved message (pending signature): type=${messageType}, msgId=${messageId}`);

    // Phase 2: Quantum signature — reuse existing if same sender already has one
    try {
      const existing = await findExistingSignature(groupId, senderName);

      if (existing) {
        // Reuse existing quantum signature (no Braket call)
        console.log(`[webhook] Reusing existing signature for "${senderName}": qn=${existing.quantumNumber}`);
        await dynamodb.send(
          new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: { PK: { S: pk }, SK: { S: sk } },
            UpdateExpression: "SET signatureStatus = :s, quantumNumber = :qn, publicKeyHash = :pkh, quantumSignature = :qs, bellState = :bs, signatureAlgorithm = :sa, visualColor = :vc",
            ExpressionAttributeValues: {
              ":s": { S: "completed" },
              ":qn": { N: String(existing.quantumNumber) },
              ":pkh": { S: existing.publicKeyHash },
              ":qs": { S: existing.signature },
              ":bs": { S: existing.bellState },
              ":sa": { S: existing.algorithm },
              ":vc": { S: existing.visualColor },
            },
          })
        );
      } else {
        // First message from this sender — call Braket SV1
        console.log(`[webhook] First message from "${senderName}", generating quantum signature via Braket`);
        const sig = await generateQuantumSignature(senderName, text || `msg-${messageId}`);
        await dynamodb.send(
          new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: { PK: { S: pk }, SK: { S: sk } },
            UpdateExpression: "SET signatureStatus = :s, quantumNumber = :qn, publicKeyHash = :pkh, quantumSignature = :qs, bellState = :bs, signatureAlgorithm = :sa, visualColor = :vc",
            ExpressionAttributeValues: {
              ":s": { S: "completed" },
              ":qn": { N: String(sig.quantumNumber) },
              ":pkh": { S: sig.publicKeyHash },
              ":qs": { S: sig.signature },
              ":bs": { S: JSON.stringify(sig.bellState) },
              ":sa": { S: sig.algorithm },
              ":vc": { S: sig.visualColor },
            },
          })
        );
        console.log(`[webhook] Quantum signature generated: qn=${sig.quantumNumber}, pk=${sig.publicKeyHash}`);
      }
    } catch (sigErr) {
      console.error(`[webhook] Signature generation failed:`, sigErr);
    }

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error(`[webhook] Error processing message for group ${groupId}:`, err);
    return NextResponse.json({ status: "ok" });
  }
}
