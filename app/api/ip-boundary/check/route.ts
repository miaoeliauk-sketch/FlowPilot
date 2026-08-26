import { NextRequest, NextResponse } from "next/server";

import {
  type BoundaryNodeContext,
  BoundaryContextTooLargeError,
  BoundaryNodeLimitError,
  BoundaryResponseValidationError,
  checkTopic,
} from "@/lib/ip-boundary-engine";
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
import { StructuredDeepSeekError } from "@/lib/structured-deepseek";
import { DeepSeekRequestPayloadTooLargeError } from "@/lib/deepseek";

const MAX_SOURCES = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function securityFailure() {
  return NextResponse.json({
    error: "认知来源凭证无效或已失效",
    code: "SECURITY_VALIDATION_FAILED",
  }, { status: 403 });
}

function toBoundaryNode(node: {
  id: string;
  question: { content: string };
  claim: { content: string };
  reasoning: { steps: Array<{ order: number; content: string }> };
  evidence: Array<{
    type: string;
    content: string;
    verificationStatus: "verified" | "unverified";
  }>;
  concepts: Array<{ term: string; definition: string }>;
  humanRevision?: {
    claim?: string;
    reasoningSteps?: Array<{ order: number; content: string }>;
  };
}): BoundaryNodeContext {
  const revisedSteps = new Map(
    node.humanRevision?.reasoningSteps?.map(step => [step.order, step.content]) ?? [],
  );
  return {
    id: node.id,
    reviewStatus: "human_confirmed",
    question: node.question.content,
    claim: node.humanRevision?.claim ?? node.claim.content,
    reasoningSteps: node.reasoning.steps.map(step => revisedSteps.get(step.order) ?? step.content),
    evidence: node.evidence.map(item => ({
      type: item.type,
      content: item.content,
      verificationStatus: item.verificationStatus,
    })),
    concepts: node.concepts.map(item => ({ term: item.term, definition: item.definition })),
  };
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!isRecord(body)) return NextResponse.json({ error: "请求格式错误" }, { status: 400 });

  const activeIPId = typeof body.activeIPId === "string" ? body.activeIPId.trim() : "";
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!activeIPId || !topic || topic.length > 500
    || !Array.isArray(body.sources) || body.sources.length === 0 || body.sources.length > MAX_SOURCES) {
    return NextResponse.json({ error: "边界判断请求不完整或超出限制" }, { status: 400 });
  }

  try {
    const secret = await getIPSourceAnalysisProofSecret();
    const confirmedNodes: BoundaryNodeContext[] = [];
    const seenNodeIds = new Set<string>();

    for (const rawSource of body.sources) {
      if (!isRecord(rawSource)) return securityFailure();
      const sourceId = typeof rawSource.sourceId === "string" ? rawSource.sourceId.trim() : "";
      const rawContent = typeof rawSource.rawContent === "string" ? rawSource.rawContent : "";
      const finalProof = typeof rawSource.finalProof === "string" ? rawSource.finalProof.trim() : "";
      if (!sourceId || !rawContent.trim() || !finalProof) return securityFailure();

      const parsed = parseStoredIPSourceAnalysis(rawSource.analysis, rawContent, sourceId);
      if (!parsed.ok || parsed.version !== 2) return securityFailure();
      const contextItems = toV1CompatibleItems(parsed.analysis);
      const finalClaims = buildIPSourceFinalProofClaims({
        ipId: activeIPId,
        analysis: parsed.analysis,
        contextItems,
      });
      if (!verifyIPSourceFinalProof(finalProof, finalClaims, secret)) return securityFailure();
      const analysisClaims = buildIPSourceAnalysisProofClaims({
        ipId: activeIPId,
        analysis: parsed.analysis,
      });
      if (!await verifyFinalizedIPSourceLedger({
        sourceId,
        ipId: activeIPId,
        nonce: parsed.analysis.nonce,
        digest: digestIPSourceAnalysisProofClaims(analysisClaims),
        finalDigest: digestIPSourceFinalProofClaims(finalClaims),
      })) return securityFailure();

      for (const node of parsed.analysis.nodes) {
        if (node.reviewStatus !== "human_confirmed") continue;
        if (seenNodeIds.has(node.id)) return securityFailure();
        seenNodeIds.add(node.id);
        confirmedNodes.push(toBoundaryNode(node));
      }
    }

    if (confirmedNodes.length === 0) {
      return NextResponse.json({ error: "没有可用于判断的人工确认认知" }, { status: 400 });
    }
    const report = await checkTopic(
      topic,
      confirmedNodes,
      request.headers.get("X-DeepSeek-Key") || "",
    );
    return NextResponse.json(report);
  } catch (error) {
    const cause = error instanceof StructuredDeepSeekError ? error.cause : error;
    if (cause instanceof BoundaryContextTooLargeError
      || cause instanceof DeepSeekRequestPayloadTooLargeError) {
      return NextResponse.json({
        error: "本次认知判断请求超过12000字节，请缩小判断范围",
        code: "BOUNDARY_CONTEXT_TOO_LARGE",
      }, { status: 413 });
    }
    if (cause instanceof BoundaryNodeLimitError) {
      return NextResponse.json({
        error: cause.message,
        code: "BOUNDARY_NODE_LIMIT_EXCEEDED",
      }, { status: 400 });
    }
    if (cause instanceof BoundaryResponseValidationError) {
      return NextResponse.json({
        error: cause.message,
        code: "BOUNDARY_RESPONSE_INVALID",
      }, { status: 502 });
    }
    const timeout = error instanceof StructuredDeepSeekError && error.stage === "timeout";
    return NextResponse.json({
      error: timeout ? "认知边界判断超时，请重试" : "认知边界判断失败，请重试",
      code: timeout ? "BOUNDARY_TIMEOUT" : "BOUNDARY_REQUEST_FAILED",
    }, { status: timeout ? 504 : 502 });
  }
}
