import { NextRequest, NextResponse } from "next/server";

import {
  resolveScriptAuditItem,
  ScriptAuditServerError,
} from "@/lib/script-factory-audit-server";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "人工处理请求格式错误", code: "INVALID_RESOLUTION_REQUEST" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "人工处理请求格式错误", code: "INVALID_RESOLUTION_REQUEST" }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== "auditSessionId,auditVersion,idempotencyKey,pendingItemId,resolutionStatus") {
    return NextResponse.json({ error: "人工处理请求格式错误", code: "INVALID_RESOLUTION_REQUEST" }, { status: 400 });
  }
  try {
    return NextResponse.json(await resolveScriptAuditItem({
      auditSessionId: input.auditSessionId,
      auditVersion: input.auditVersion,
      pendingItemId: input.pendingItemId,
      resolutionStatus: input.resolutionStatus,
      idempotencyKey: input.idempotencyKey,
    }));
  } catch (error) {
    if (error instanceof ScriptAuditServerError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "人工处理失败", code: "RESOLUTION_FAILED" }, { status: 500 });
  }
}
