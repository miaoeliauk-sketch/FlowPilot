import { NextRequest, NextResponse } from "next/server";
import {
  applyCognitionReview,
  type CognitionReviewAction,
} from "@/lib/ip-source-analysis-review";
import {
  buildIPSourceAnalysisProofClaims,
  createIPSourceAnalysisToken,
  digestIPSourceAnalysisProofClaims,
  getIPSourceAnalysisProofSecret,
  verifyIPSourceAnalysisToken,
} from "@/lib/ip-source-analysis-proof";
import { advanceIPSourceLedger } from "@/lib/ip-source-ledger";
import { parseStoredIPSourceAnalysis } from "@/lib/ip-source-analysis-v2";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAction(value: unknown): CognitionReviewAction | null {
  if (!isRecord(value) || typeof value.nodeId !== "string" || !value.nodeId.trim()) return null;
  if (value.type === "confirm" || value.type === "reject") {
    if (Object.keys(value).sort().join(",") !== "nodeId,type") return null;
    return { type: value.type, nodeId: value.nodeId.trim() };
  }
  if (value.type !== "revise" || Object.keys(value).sort().join(",") !== "humanRevision,nodeId,type"
    || !isRecord(value.humanRevision)) return null;
  const revisionKeys = Object.keys(value.humanRevision).sort().join(",");
  if (revisionKeys !== "claim" && revisionKeys !== "reasoningSteps" && revisionKeys !== "claim,reasoningSteps") {
    return null;
  }
  const claim = value.humanRevision.claim;
  const rawSteps = value.humanRevision.reasoningSteps;
  if (claim !== undefined && typeof claim !== "string") return null;
  if (rawSteps !== undefined && (!Array.isArray(rawSteps) || rawSteps.some(step =>
    !isRecord(step) || Object.keys(step).sort().join(",") !== "content,order"
    || !Number.isInteger(step.order) || typeof step.content !== "string"
  ))) return null;
  return {
    type: "revise",
    nodeId: value.nodeId.trim(),
    humanRevision: {
      ...(typeof claim === "string" ? { claim } : {}),
      ...(Array.isArray(rawSteps) ? {
        reasoningSteps: rawSteps.map(step => ({
          order: (step as Record<string, unknown>).order as number,
          content: (step as Record<string, unknown>).content as string,
        })),
      } : {}),
    },
  };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const activeIPId = typeof body.activeIPId === "string" ? body.activeIPId.trim() : "";
  const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
  const rawContent = typeof body.rawContent === "string" ? body.rawContent : "";
  const analysisToken = typeof body.analysisToken === "string" ? body.analysisToken.trim() : "";
  const requestSeq = Number.isInteger(body.requestSeq) ? body.requestSeq as number : null;
  const action = parseAction(body.action);
  if (!activeIPId) return NextResponse.json({ error: "请先选择当前IP" }, { status: 400 });
  if (!sourceId) return NextResponse.json({ error: "缺少Source编号" }, { status: 400 });
  if (!rawContent.trim()) return NextResponse.json({ error: "请提供IP原始内容" }, { status: 400 });
  if (!analysisToken) return NextResponse.json({ error: "缺少解析凭证，请重新分析" }, { status: 400 });
  if (!action) return NextResponse.json({ error: "审核操作格式错误" }, { status: 400 });

  try {
    const parsed = parseStoredIPSourceAnalysis(body.analysis, rawContent, sourceId);
    if (!parsed.ok || parsed.version !== 2) {
      throw new Error(parsed.ok ? "认知审核只支持V2解析" : parsed.error);
    }
    const proofSecret = await getIPSourceAnalysisProofSecret();
    const currentClaims = buildIPSourceAnalysisProofClaims({
      ipId: activeIPId,
      analysis: parsed.analysis,
    });
    if (!verifyIPSourceAnalysisToken(
      analysisToken,
      currentClaims,
      proofSecret,
    )) {
      throw new Error("解析凭证无效或与当前IP、Source不一致");
    }
    const reviewedAnalysis = applyCognitionReview({
        sourceId,
        rawContent,
        analysis: body.analysis,
        action,
      });
    const nextAnalysis = {
      ...reviewedAnalysis,
      nonce: parsed.analysis.nonce + 1,
    };
    const nextClaims = buildIPSourceAnalysisProofClaims({ ipId: activeIPId, analysis: nextAnalysis });
    const advanced = await advanceIPSourceLedger({
      sourceId,
      ipId: activeIPId,
      expectedNonce: parsed.analysis.nonce,
      expectedDigest: digestIPSourceAnalysisProofClaims(currentClaims),
      nextNonce: nextAnalysis.nonce,
      nextDigest: digestIPSourceAnalysisProofClaims(nextClaims),
    });
    if (!advanced) {
      return NextResponse.json({
        error: "解析凭证已过期，请使用最新审核结果",
      }, { status: 409 });
    }
    return NextResponse.json({
      analysis: nextAnalysis,
      analysisToken: createIPSourceAnalysisToken(
        nextClaims,
        proofSecret,
      ),
      activeIPId,
      requestSeq,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "认知审核失败",
    }, { status: 400 });
  }
}
