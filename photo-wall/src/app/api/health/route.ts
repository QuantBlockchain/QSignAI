import { NextResponse } from "next/server";

// Health check endpoint for ALB target group
// MUST respond fast with 200 to pass ECS health checks
export async function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
