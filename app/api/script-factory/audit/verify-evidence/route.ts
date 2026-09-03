import { NextRequest, NextResponse } from "next/server";

import { getIPSourceAnalysisProofSecret } from "@/lib/ip-source-analysis-proof";
import {
  ScriptAuditServerError,
  verifyRestoredScriptAuditEvidenceBinding,
} from "@/lib/script-factory-audit-server";
import { SCRIPT_GENERATION_EVIDENCE_CHAIN_VERSION } from "@/lib/script-factory-contract";
import {
  createScriptGenerationAuditVersion,
  digestScriptGenerationEvidenceProof,
  parseScriptGenerationAuditContent,
  readVerifiedScriptGenerationEvidenceProof,
} from "@/lib/script-factory-generation-evidence-proof";

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOnlyKeys(object: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(object).every(key => allowed.has(key));
}

export async function POST(req: NextRequest) {
  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const body = asObject(parsedBody);
  if (!body || !hasOnlyKeys(body, [
    "activeIPId",
    "content",
    "generationEvidenceProof",
    "generationEvidenceId",
    "evidenceChainVersion",
    "auditSessionId",
    "auditVersion",
  ])) {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const content = parseScriptGenerationAuditContent(body.content);
  if (
    !content
    || typeof body.activeIPId !== "string" || !body.activeIPId.trim()
    || typeof body.generationEvidenceProof !== "string" || !body.generationEvidenceProof
    || typeof body.generationEvidenceId !== "string" || !body.generationEvidenceId.trim()
    || body.evidenceChainVersion !== SCRIPT_GENERATION_EVIDENCE_CHAIN_VERSION
    || typeof body.auditSessionId !== "string" || !body.auditSessionId.trim()
    || typeof body.auditVersion !== "string" || !body.auditVersion.trim()
  ) {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  let claims;
  try {
    claims = readVerifiedScriptGenerationEvidenceProof(
      body.generationEvidenceProof,
      await getIPSourceAnalysisProofSecret(),
    );
  } catch {
    return NextResponse.json({
      error: "生成证据凭证核验服务暂不可用，已停止恢复。",
      code: "GENERATION_EVIDENCE_VERIFICATION_UNAVAILABLE",
    }, { status: 500 });
  }
  if (
    !claims
    || claims.generationEvidenceId !== body.generationEvidenceId
    || claims.evidenceChainVersion !== body.evidenceChainVersion
    || claims.ipId !== body.activeIPId.trim()
  ) {
    return NextResponse.json({
      error: "生成证据凭证无效或与当前脚本不一致，已停止恢复。",
      code: "GENERATION_EVIDENCE_MISMATCH",
    }, { status: 400 });
  }
  const expectedAuditVersion = createScriptGenerationAuditVersion({
    ipId: claims.ipId,
    content,
    sources: claims.sources,
    caseEvidence: claims.caseEvidence,
    nonEvidenceReferences: claims.nonEvidenceReferences,
  });
  if (expectedAuditVersion !== body.auditVersion) {
    return NextResponse.json({
      error: "当前脚本正文与审计版本不一致，已停止恢复。",
      code: "GENERATION_EVIDENCE_MISMATCH",
    }, { status: 409 });
  }

  let trustedAuditState;
  try {
    trustedAuditState = await verifyRestoredScriptAuditEvidenceBinding({
      auditSessionId: body.auditSessionId,
      auditVersion: body.auditVersion,
      generationEvidenceDigest: digestScriptGenerationEvidenceProof(body.generationEvidenceProof),
    });
  } catch (error) {
    if (error instanceof ScriptAuditServerError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({
      error: "审计会话核验失败，已停止恢复。",
      code: "AUDIT_SESSION_VERIFICATION_UNAVAILABLE",
    }, { status: 500 });
  }

  return NextResponse.json({
    status: "verified",
    auditSessionId: body.auditSessionId,
    auditVersion: body.auditVersion,
    generationEvidenceId: body.generationEvidenceId,
    evidenceChainVersion: body.evidenceChainVersion,
    ...trustedAuditState,
  });
}
