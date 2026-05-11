import { NextRequest, NextResponse } from "next/server";
import {
  QueryCommand,
  QueryCommandInput,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { dynamodb, s3, getSecretValue } from "@/lib/aws";
import { getGroup, validateGroupId } from "@/lib/config";

const TABLE_NAME = process.env.TABLE_NAME || "";
const BUCKET_NAME = process.env.BUCKET_NAME || "";
const ADMIN_SECRET_ARN = process.env.ADMIN_SECRET_ARN || "";

async function verifyAdmin(request: NextRequest): Promise<boolean> {
  const auth = request.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return false;
  const token = auth.substring(7);
  const password = await getSecretValue(ADMIN_SECRET_ARN);
  return token === password;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;

  if (!validateGroupId(groupId)) {
    return NextResponse.json({ error: "Invalid group ID" }, { status: 400 });
  }

  const groupConfig = getGroup(groupId);
  if (!groupConfig) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  const searchParams = request.nextUrl.searchParams;
  const limitParam = searchParams.get("limit");
  const limit = Math.min(
    Math.max(parseInt(limitParam || "50", 10) || 50, 1),
    100
  );
  const cursor = searchParams.get("cursor");
  const after = searchParams.get("after");

  let keyCondition = "PK = :pk";
  const exprValues: Record<string, { S: string }> = {
    ":pk": { S: `GROUP#${groupId}` },
  };
  let scanForward = false;

  if (after) {
    const afterTs = after.padStart(15, "0");
    keyCondition = "PK = :pk AND SK > :after";
    exprValues[":after"] = { S: `MSG#${afterTs}#` };
    scanForward = true;
  }

  const queryInput: QueryCommandInput = {
    TableName: TABLE_NAME,
    KeyConditionExpression: keyCondition,
    FilterExpression: "attribute_not_exists(#h) OR #h <> :t",
    ExpressionAttributeNames: { "#h": "hidden" },
    ExpressionAttributeValues: {
      ...exprValues,
      ":t": { S: "true" },
    },
    ScanIndexForward: scanForward,
    Limit: limit,
  };

  if (cursor) {
    queryInput.ExclusiveStartKey = {
      PK: { S: `GROUP#${groupId}` },
      SK: { S: cursor },
    };
  }

  const result = await dynamodb.send(new QueryCommand(queryInput));

  const messages = await Promise.all(
    (result.Items || []).map(async (item) => {
      let photoUrl: string | null = null;
      const photoKey = item.photoKey?.S;

      if (photoKey) {
        photoUrl = await getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: photoKey,
          }),
          { expiresIn: 3600 }
        );
      }

      return {
        messageId: parseInt(item.messageId?.N || "0", 10),
        groupId: item.groupId?.S || "",
        type: item.type?.S || "text",
        text: item.text?.S || "",
        photoUrl,
        senderName: item.senderName?.S || "",
        senderUsername: item.senderUsername?.S || "",
        timestamp: parseInt(item.timestamp?.N || "0", 10),
        createdAt: item.createdAt?.S || "",
        sk: item.SK?.S || "",
        signatureStatus: item.signatureStatus?.S || null,
        quantumNumber: item.quantumNumber?.N ? parseInt(item.quantumNumber.N, 10) : null,
        publicKeyHash: item.publicKeyHash?.S || null,
        quantumSignature: item.quantumSignature?.S || null,
        bellState: item.bellState?.S ? JSON.parse(item.bellState.S) : null,
        visualColor: item.visualColor?.S || null,
        posX: item.posX?.N ? parseFloat(item.posX.N) : null,
        posY: item.posY?.N ? parseFloat(item.posY.N) : null,
      };
    })
  );

  return NextResponse.json({
    messages,
    nextCursor: result.LastEvaluatedKey?.SK?.S || null,
    groupName: groupConfig.name,
    groupId: groupConfig.groupId,
  });
}

// DELETE single message: /api/messages/{groupId}?sk=MSG%23...
// DELETE all messages: /api/messages/{groupId}?all=true
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  if (!(await verifyAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { groupId } = await params;

  if (!validateGroupId(groupId)) {
    return NextResponse.json({ error: "Invalid group ID" }, { status: 400 });
  }

  const groupConfig = getGroup(groupId);
  if (!groupConfig) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  const searchParams = request.nextUrl.searchParams;
  const sk = searchParams.get("sk");
  const all = searchParams.get("all");

  const pk = `GROUP#${groupId}`;

  if (sk) {
    // Soft-delete single message
    await dynamodb.send(
      new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: { PK: { S: pk }, SK: { S: sk } },
        UpdateExpression: "SET #h = :t",
        ExpressionAttributeNames: { "#h": "hidden" },
        ExpressionAttributeValues: { ":t": { S: "true" } },
      })
    );
    return NextResponse.json({ deleted: 1 });
  }

  if (all === "true") {
    // Soft-delete all visible messages for this group
    let count = 0;
    let lastKey: Record<string, any> | undefined;

    do {
      const query: QueryCommandInput = {
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk",
        FilterExpression: "attribute_not_exists(#h) OR #h <> :t",
          ExpressionAttributeNames: { "#h": "hidden" },
        ExpressionAttributeValues: {
          ":pk": { S: pk },
          ":t": { S: "true" },
        },
        ProjectionExpression: "PK, SK",
        Limit: 100,
      };
      if (lastKey) query.ExclusiveStartKey = lastKey;

      const result = await dynamodb.send(new QueryCommand(query));

      for (const item of result.Items || []) {
        await dynamodb.send(
          new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: { PK: item.PK!, SK: item.SK! },
            UpdateExpression: "SET #h = :t",
        ExpressionAttributeNames: { "#h": "hidden" },
            ExpressionAttributeValues: { ":t": { S: "true" } },
          })
        );
        count++;
      }

      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return NextResponse.json({ deleted: count });
  }

  return NextResponse.json({ error: "Provide ?sk=... or ?all=true" }, { status: 400 });
}

// PATCH: save card position
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  if (!(await verifyAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { groupId } = await params;

  if (!validateGroupId(groupId)) {
    return NextResponse.json({ error: "Invalid group ID" }, { status: 400 });
  }

  const body = await request.json();
  const { sk, posX, posY } = body;

  if (!sk || typeof posX !== "number" || typeof posY !== "number") {
    return NextResponse.json({ error: "Provide sk, posX, posY" }, { status: 400 });
  }

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `GROUP#${groupId}` },
        SK: { S: sk },
      },
      UpdateExpression: "SET posX = :x, posY = :y",
      ExpressionAttributeValues: {
        ":x": { N: String(posX) },
        ":y": { N: String(posY) },
      },
    })
  );

  return NextResponse.json({ ok: true });
}
