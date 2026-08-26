import { NextRequest, NextResponse } from "next/server";
import type { InterviewRawInteraction, InterviewSource } from "@/lib/ip-boundary-interview";
import {
  buildIPSourceAnalysisProofClaims,
  buildIPSourceFinalProofClaims,
  createIPSourceFinalProof,
  digestIPSourceAnalysisProofClaims,
  digestIPSourceFinalProofClaims,
  getIPSourceAnalysisProofSecret,
  verifyIPSourceAnalysisToken,
} from "@/lib/ip-source-analysis-proof";
import { applyCognitionReview, type CognitionReviewAction } from "@/lib/ip-source-analysis-review";
import { parseStoredIPSourceAnalysis, toV1CompatibleItems } from "@/lib/ip-source-analysis-v2";
import { confirmAndFinalizeIPSourceLedger } from "@/lib/ip-source-ledger";
import {
  buildEphemeralCognitionProofClaims,
  createEphemeralCognitionProof,
} from "@/lib/ip-boundary-interview-proof";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseRawInteraction(value: unknown): InterviewRawInteraction[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return null;
  const interactions: InterviewRawInteraction[] = [];
  for (const item of value) {
    if (!isRecord(item) || !hasExactKeys(item, ["questionId", "question", "answer"])
      || typeof item.questionId !== "string" || !item.questionId.trim()
      || typeof item.question !== "string" || !item.question.trim()
      || typeof item.answer !== "string" || item.answer.trim().length <= 10) return null;
    interactions.push({
      questionId: item.questionId,
      question: item.question,
      answer: item.answer,
    });
  }
  return interactions;
}

function parseAction(value: unknown): CognitionReviewAction | null {
  if (!isRecord(value) || typeof value.nodeId !== "string" || !value.nodeId.trim()) return null;
  if (value.type === "confirm" || value.type === "reject") {
    return hasExactKeys(value, ["type", "nodeId"])
      ? { type: value.type, nodeId: value.nodeId }
      : null;
  }
  if (value.type !== "revise" || !hasExactKeys(value, ["type", "nodeId", "humanRevision"])
    || !isRecord(value.humanRevision)) return null;
  const revision = value.humanRevision;
  const allowedRevisionKeys = ["claim", "reasoningSteps"];
  if (Object.keys(revision).some(key => !allowedRevisionKeys.includes(key))) return null;
  const claim = typeof revision.claim === "string" ? revision.claim.trim() : "";
  let reasoningSteps: Array<{ order: number; content: string }> | undefined;
  if (revision.reasoningSteps !== undefined) {
    if (!Array.isArray(revision.reasoningSteps) || revision.reasoningSteps.length === 0) return null;
    reasoningSteps = [];
    for (const step of revision.reasoningSteps) {
      if (!isRecord(step) || !hasExactKeys(step, ["order", "content"])
        || !Number.isInteger(step.order) || (step.order as number) < 1
        || typeof step.content !== "string" || !step.content.trim()) return null;
      reasoningSteps.push({ order: step.order as number, content: step.content.trim() });
    }
  }
  if (!claim && !reasoningSteps) return null;
  return {
    type: "revise",
    nodeId: value.nodeId,
    humanRevision: {
      ...(claim ? { claim } : {}),
      ...(reasoningSteps ? { reasoningSteps } : {}),
    },
  };
}

function parseSource(
  value: unknown,
  activeIPId: string,
  topicId: string,
  interviewId: string,
): InterviewSource | null {
  if (!isRecord(value) || value.ipId !== activeIPId || value.topicId !== topicId
    || value.interviewId !== interviewId || typeof value.id !== "string" || !value.id.trim()
    || typeof value.timestamp !== "string" || Number.isNaN(Date.parse(value.timestamp))) return null;
  const rawInteraction = parseRawInteraction(value.rawInteraction);
  return rawInteraction ? {
    id: value.id,
    ipId: activeIPId,
    topicId,
    interviewId,
    rawInteraction,
    timestamp: value.timestamp,
  } : null;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }
  if (!isRecord(body)) return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  const activeIPId = typeof body.activeIPId === "string" ? body.activeIPId.trim() : "";
  if (!activeIPId) return NextResponse.json({ error: "缺少当前IP归属，已拒绝确认访谈认知" }, { status: 403 });
  const topicId = typeof body.topicId === "string" ? body.topicId.trim() : "";
  const interviewId = typeof body.interviewId === "string" ? body.interviewId.trim() : "";
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const analysisToken = typeof body.analysisToken === "string" ? body.analysisToken.trim() : "";
  const source = parseSource(body.source, activeIPId, topicId, interviewId);
  if (!(body.mode === "long_term" || body.mode === "temporary")
    || !topicId || !interviewId || !analysisToken || !source
    || (body.mode === "temporary" && (!topic || topic.length > 500))
    || !Array.isArray(body.actions)) {
    return NextResponse.json({ error: "访谈确认请求不完整" }, { status: 400 });
  }

  try {
    const rawContent = source.rawInteraction.map(item => item.answer).join("\n\n");
    const parsed = parseStoredIPSourceAnalysis(body.analysis, rawContent, source.id);
    if (!parsed.ok || parsed.version !== 2) {
      throw new Error(parsed.ok ? "访谈长期确认只支持V2认知" : parsed.error);
    }
    if (parsed.analysis.analyzedAt !== source.timestamp) throw new Error("访谈存证时间与认知解析不一致");
    const actions = body.actions.map(parseAction);
    if (actions.some(action => action === null)) throw new Error("访谈认知审核操作格式错误");
    const validActions = actions as CognitionReviewAction[];
    const expectedNodeIds = new Set(parsed.analysis.nodes.map(node => node.id));
    if (validActions.length !== expectedNodeIds.size
      || new Set(validActions.map(action => action.nodeId)).size !== validActions.length
      || validActions.some(action => !expectedNodeIds.has(action.nodeId))) {
      throw new Error("每个访谈认知节点必须且只能审核一次");
    }
    const secret = await getIPSourceAnalysisProofSecret();
    const originalClaims = buildIPSourceAnalysisProofClaims({ ipId: activeIPId, analysis: parsed.analysis });
    if (!verifyIPSourceAnalysisToken(analysisToken, originalClaims, secret)) {
      return NextResponse.json({ error: "访谈解析凭证无效或已过期" }, { status: 400 });
    }
    let reviewedAnalysis = parsed.analysis;
    for (const action of validActions) {
      reviewedAnalysis = applyCognitionReview({
        sourceId: source.id,
        rawContent,
        analysis: reviewedAnalysis,
        action,
      });
    }
    reviewedAnalysis = { ...reviewedAnalysis, nonce: parsed.analysis.nonce + 1 };
    const nextClaims = buildIPSourceAnalysisProofClaims({ ipId: activeIPId, analysis: reviewedAnalysis });
    if (body.mode === "temporary") {
      const temporaryClaims = buildEphemeralCognitionProofClaims({
        ipId: activeIPId,
        topicId,
        topic,
        sourceId: source.id,
        analysis: reviewedAnalysis,
      });
      return NextResponse.json({
        mode: "temporary",
        activeIPId,
        topicId,
        interviewId,
        sourceId: source.id,
        rawContent,
        analysis: reviewedAnalysis,
        temporaryProof: createEphemeralCognitionProof(temporaryClaims, secret),
        expiresAt: temporaryClaims.expiresAt,
      });
    }
    const finalClaims = buildIPSourceFinalProofClaims({
      ipId: activeIPId,
      analysis: reviewedAnalysis,
      contextItems: toV1CompatibleItems(reviewedAnalysis),
    });
    const finalized = await confirmAndFinalizeIPSourceLedger({
      sourceId: source.id,
      ipId: activeIPId,
      expectedNonce: parsed.analysis.nonce,
      expectedDigest: digestIPSourceAnalysisProofClaims(originalClaims),
      nextNonce: reviewedAnalysis.nonce,
      nextDigest: digestIPSourceAnalysisProofClaims(nextClaims),
      finalDigest: digestIPSourceFinalProofClaims(finalClaims),
    });
    if (!finalized) {
      return NextResponse.json({ error: "访谈解析凭证已过期，请重新提取" }, { status: 409 });
    }
    return NextResponse.json({
      mode: "long_term",
      source,
      analysis: reviewedAnalysis,
      finalProof: createIPSourceFinalProof(finalClaims, secret),
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "访谈认知终审失败",
    }, { status: 400 });
  }
}
