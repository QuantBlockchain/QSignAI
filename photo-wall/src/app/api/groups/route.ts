import { NextResponse } from "next/server";
import { getGroups } from "@/lib/config";

export async function GET() {
  const groups = getGroups().map((g) => ({
    groupId: g.groupId,
    name: g.name,
  }));
  return NextResponse.json({ groups });
}
