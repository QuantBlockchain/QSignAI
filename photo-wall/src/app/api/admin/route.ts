import { NextRequest, NextResponse } from "next/server";
import { QueryCommand, QueryCommandInput, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { dynamodb, getSecretValue } from "@/lib/aws";
import { getGroups } from "@/lib/config";

const TABLE_NAME = process.env.TABLE_NAME || "";
const ADMIN_SECRET_ARN = process.env.ADMIN_SECRET_ARN || "";

async function verifyAdmin(request: NextRequest): Promise<boolean> {
  const auth = request.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return false;
  const token = auth.substring(7);
  const password = await getSecretValue(ADMIN_SECRET_ARN);
  return token === password;
}

// POST /api/admin — login check
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { password } = body;

  if (!password) {
    return NextResponse.json({ error: "Password required" }, { status: 400 });
  }

  try {
    const adminPassword = await getSecretValue(ADMIN_SECRET_ARN);
    if (password !== adminPassword) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    return NextResponse.json({ ok: true, token: password });
  } catch {
    return NextResponse.json({ error: "Auth service error" }, { status: 500 });
  }
}

// DELETE /api/admin?action=clear&groupId=xxx — clear all messages
// DELETE /api/admin?action=hide&groupId=xxx&sk=xxx — hide single message
export async function DELETE(request: NextRequest) {
  if (!(await verifyAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get("action");
  const groupId = searchParams.get("groupId");

  if (!groupId) {
    return NextResponse.json({ error: "groupId required" }, { status: 400 });
  }

  const pk = `GROUP#${groupId}`;

  if (action === "hide" ) {
    const sk = searchParams.get("sk");
    if (!sk) return NextResponse.json({ error: "sk required" }, { status: 400 });

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

  if (action === "clear") {
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

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// GET /api/admin — get groups and stats
export async function GET(request: NextRequest) {
  if (!(await verifyAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const groups = getGroups().map((g) => ({ groupId: g.groupId, name: g.name }));
  return NextResponse.json({ groups });
}
