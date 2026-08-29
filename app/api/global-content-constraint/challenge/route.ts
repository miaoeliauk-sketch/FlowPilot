import { NextRequest, NextResponse } from "next/server";

import { GlobalConstraintServerError, issueGlobalConstraintChallenge } from "@/lib/global-content-constraint-server";

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
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "请求格式错误", code: "INVALID_REQUEST" }, { status: 400 }); }
  const proposalId = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).proposalId
    : null;
  try {
    return NextResponse.json(issueGlobalConstraintChallenge(proposalId));
  } catch (error) {
    if (error instanceof GlobalConstraintServerError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "确认挑战签发失败", code: "CHALLENGE_FAILED" }, { status: 500 });
  }
}
