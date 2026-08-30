import { NextRequest, NextResponse } from "next/server";

import { confirmGlobalConstraintOnServer, GlobalConstraintServerError } from "@/lib/global-content-constraint-server";

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return origin === request.nextUrl.origin && (!fetchSite || fetchSite === "same-origin");
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "请求来源无效", code: "INVALID_REQUEST_ORIGIN" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误", code: "INVALID_REQUEST" }, { status: 400 });
  }

  const challengeId = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).challengeId
    : null;
  const challenge = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).challenge
    : null;
  if (typeof challengeId !== "string" || !challengeId || typeof challenge !== "string" || !challenge) {
    return NextResponse.json({
      error: "缺少有效的一次性确认挑战，未启用任何规则",
      code: "INVALID_CONFIRMATION_CHALLENGE",
    }, { status: 403 });
  }
  const requestRecord = body as Record<string, unknown>;
  const expectedKeys = [
    "acknowledgement",
    "challenge",
    "challengeId",
    "confirmedBy",
    "idempotencyKey",
    "proposalId",
  ];
  if (Object.keys(requestRecord).sort().join(",") !== expectedKeys.join(",")) {
    return NextResponse.json({
      error: "人工确认请求包含未定义字段，未启用任何规则",
      code: "INVALID_CONFIRMATION_REQUEST",
    }, { status: 400 });
  }
  try {
    const record = await confirmGlobalConstraintOnServer(requestRecord as Parameters<typeof confirmGlobalConstraintOnServer>[0]);
    if (record.recordType === "active_rule") {
      return NextResponse.json({
        confirmationStatus: "active",
        runtimeStatus: "active",
        rule: record.rule,
        sourceFacts: record.sourceFacts,
      });
    }
    return NextResponse.json({
      confirmationStatus: record.confirmationStatus,
      runtimeStatus: record.runtimeStatus,
      proposal: record.proposal,
      rule: null,
      sourceFacts: record.sourceFacts,
    });
  } catch (error) {
    if (error instanceof GlobalConstraintServerError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "人工确认失败", code: "CONFIRMATION_FAILED" }, { status: 500 });
  }
}
