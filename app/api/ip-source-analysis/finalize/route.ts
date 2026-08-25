import { NextRequest, NextResponse } from "next/server";
import {
  buildIPSourceAnalysisProofClaims,
  buildIPSourceFinalProofClaims,
  createIPSourceFinalProof,
  digestIPSourceAnalysisProofClaims,
  digestIPSourceFinalProofClaims,
  getIPSourceAnalysisProofSecret,
  verifyIPSourceAnalysisToken,
} from "@/lib/ip-source-analysis-proof";
import { finalizeIPSourceLedger } from "@/lib/ip-source-ledger";
import {
  parseStoredIPSourceAnalysis,
  toV1CompatibleItems,
} from "@/lib/ip-source-analysis-v2";

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
  const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
  const rawContent = typeof body.rawContent === "string" ? body.rawContent : "";
  const analysisToken = typeof body.analysisToken === "string" ? body.analysisToken.trim() : "";
  const requestSeq = Number.isInteger(body.requestSeq) ? body.requestSeq as number : null;
  if (!activeIPId || !sourceId || !rawContent.trim() || !analysisToken) {
    return NextResponse.json({ error: "最终入库请求不完整" }, { status: 400 });
  }

  try {
    const parsed = parseStoredIPSourceAnalysis(body.analysis, rawContent, sourceId);
    if (!parsed.ok || parsed.version !== 2) {
      throw new Error(parsed.ok ? "最终入库只支持V2认知解析" : parsed.error);
    }
    if (parsed.analysis.nodes.some(node => node.reviewStatus === "ai_extracted")) {
      return NextResponse.json({ error: "请先完成全部认知节点审核" }, { status: 400 });
    }
    const secret = await getIPSourceAnalysisProofSecret();
    const analysisClaims = buildIPSourceAnalysisProofClaims({
      ipId: activeIPId,
      analysis: parsed.analysis,
    });
    if (!verifyIPSourceAnalysisToken(analysisToken, analysisClaims, secret)) {
      return NextResponse.json({ error: "解析凭证无效或已过期" }, { status: 400 });
    }
    const finalClaims = buildIPSourceFinalProofClaims({
      ipId: activeIPId,
      analysis: parsed.analysis,
      contextItems: toV1CompatibleItems(parsed.analysis),
    });
    const finalized = await finalizeIPSourceLedger({
      sourceId,
      ipId: activeIPId,
      expectedNonce: parsed.analysis.nonce,
      expectedDigest: digestIPSourceAnalysisProofClaims(analysisClaims),
      finalDigest: digestIPSourceFinalProofClaims(finalClaims),
    });
    if (!finalized) {
      return NextResponse.json({ error: "解析状态已变化，请使用最新审核结果" }, { status: 409 });
    }
    return NextResponse.json({
      finalProof: createIPSourceFinalProof(finalClaims, secret),
      activeIPId,
      sourceId,
      nonce: parsed.analysis.nonce,
      requestSeq,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "最终入库校验失败",
    }, { status: 400 });
  }
}
