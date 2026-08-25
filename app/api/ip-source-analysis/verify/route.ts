import { NextRequest, NextResponse } from "next/server";
import {
  buildIPSourceAnalysisProofClaims,
  buildIPSourceFinalProofClaims,
  digestIPSourceAnalysisProofClaims,
  digestIPSourceFinalProofClaims,
  getIPSourceAnalysisProofSecret,
  verifyIPSourceFinalProof,
} from "@/lib/ip-source-analysis-proof";
import { verifyFinalizedIPSourceLedger } from "@/lib/ip-source-ledger";
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
  const finalProof = typeof body.finalProof === "string" ? body.finalProof.trim() : "";
  if (!activeIPId || !sourceId || !rawContent.trim() || !finalProof) {
    return NextResponse.json({ error: "最终凭证验证请求不完整" }, { status: 400 });
  }

  try {
    const parsed = parseStoredIPSourceAnalysis(body.analysis, rawContent, sourceId);
    if (!parsed.ok || parsed.version !== 2) {
      throw new Error(parsed.ok ? "最终凭证只适用于V2认知解析" : parsed.error);
    }
    const finalClaims = buildIPSourceFinalProofClaims({
      ipId: activeIPId,
      analysis: parsed.analysis,
      contextItems: toV1CompatibleItems(parsed.analysis),
    });
    const secret = await getIPSourceAnalysisProofSecret();
    if (!verifyIPSourceFinalProof(finalProof, finalClaims, secret)) {
      return NextResponse.json({ error: "最终入库凭证无效" }, { status: 400 });
    }
    const analysisClaims = buildIPSourceAnalysisProofClaims({
      ipId: activeIPId,
      analysis: parsed.analysis,
    });
    const verified = await verifyFinalizedIPSourceLedger({
      sourceId,
      ipId: activeIPId,
      nonce: parsed.analysis.nonce,
      digest: digestIPSourceAnalysisProofClaims(analysisClaims),
      finalDigest: digestIPSourceFinalProofClaims(finalClaims),
    });
    if (!verified) {
      return NextResponse.json({ error: "最终入库凭证已失效" }, { status: 409 });
    }
    return NextResponse.json({ verified: true });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "最终凭证验证失败",
    }, { status: 400 });
  }
}
