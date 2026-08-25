import { NextRequest, NextResponse } from "next/server";

import {
  buildIPSourceLegacyProofClaims,
  createIPSourceLegacyProof,
  digestIPSourceLegacyProofClaims,
  getIPSourceAnalysisProofSecret,
} from "@/lib/ip-source-analysis-proof";
import { getLegacyIPSourceAnalysisItems, parseStoredIPSourceAnalysis } from "@/lib/ip-source-analysis-v2";
import { isTrustedLegacyMigration, registerLegacyIPSourceLedger } from "@/lib/ip-source-ledger";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!isRecord(body)) return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  const activeIPId = typeof body.activeIPId === "string" ? body.activeIPId.trim() : "";
  const sourceIPId = typeof body.sourceIPId === "string" ? body.sourceIPId.trim() : "";
  const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
  const rawContent = typeof body.rawContent === "string" ? body.rawContent : "";
  if (!activeIPId || !sourceIPId || activeIPId !== sourceIPId) {
    return NextResponse.json({ error: "历史认知不属于当前IP，已拒绝登记" }, { status: 403 });
  }
  if (!sourceId || !rawContent.trim()) {
    return NextResponse.json({ error: "历史认知登记资料不完整" }, { status: 400 });
  }
  const parsed = parseStoredIPSourceAnalysis(body.analysis, rawContent, sourceId);
  if (!parsed.ok || parsed.version !== 1) {
    return NextResponse.json({
      error: parsed.ok ? "只有历史V1认知需要迁移登记" : parsed.error,
    }, { status: 400 });
  }
  const contextItems = getLegacyIPSourceAnalysisItems(parsed.analysis);
  const claims = buildIPSourceLegacyProofClaims({
    ipId: activeIPId,
    sourceId,
    rawContent,
    contextItems,
  });
  if (!await isTrustedLegacyMigration(claims)) {
    return NextResponse.json(
      { error: "这份历史认知不在服务端可信迁移清单中，无法登记" },
      { status: 403 },
    );
  }
  const registered = await registerLegacyIPSourceLedger({
    sourceId,
    ipId: activeIPId,
    digest: digestIPSourceLegacyProofClaims(claims),
  });
  if (!registered) {
    return NextResponse.json(
      { error: "这个Source编号已有其他认知状态，无法登记" },
      { status: 409 },
    );
  }
  const secret = await getIPSourceAnalysisProofSecret();
  return NextResponse.json({
    legacyProof: createIPSourceLegacyProof(claims, secret),
  });
}
