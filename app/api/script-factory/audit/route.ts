import { NextRequest, NextResponse } from "next/server";
import {
  ATTRIBUTION_AUDIT_SYSTEM,
  buildAttributionAudit,
  buildAttributionAuditPrompt,
  buildAttributionParagraphs,
  buildFactAudit,
  parseAttributionAuditResult,
} from "@/lib/script-factory-attribution";
import {
  analyzeScriptCoverage,
} from "@/lib/script-factory-coverage-analysis";
import type {
  ScriptPostGenerationAudit,
} from "@/lib/script-factory-contract";
import { isFactCaseEvidenceConfirmed } from "@/lib/script-factory-contract";
import {
  createScriptAuditSession,
  ScriptAuditServerError,
  verifyScriptAuditSessionGenerationEvidence,
} from "@/lib/script-factory-audit-server";
import {
  digestScriptGenerationAuditContent,
  digestScriptGenerationEvidenceProof,
  createScriptGenerationAuditVersion,
  parseScriptGenerationAuditContent,
  readVerifiedScriptGenerationEvidenceProof,
} from "@/lib/script-factory-generation-evidence-proof";
import { getIPSourceAnalysisProofSecret } from "@/lib/ip-source-analysis-proof";
import { callStructuredDeepSeek } from "@/lib/structured-deepseek";

interface AuditRequestBody {
  auditSessionId?: unknown;
  activeIPId?: unknown;
  generationEvidenceProof?: unknown;
  content?: unknown;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOnlyKeys(
  object: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(object).every(key => allowed.has(key));
}

function hasForbiddenNestedAuditFields(body: AuditRequestBody): boolean {
  const content = asObject(body.content);
  if (!content) return false;
  if (!hasOnlyKeys(content, ["outline", "pendingVerification"])) return true;
  return Array.isArray(content.outline) && content.outline.some(section => {
    const object = asObject(section);
    return Boolean(object && !hasOnlyKeys(object, ["label", "timeRange", "content", "subPoints"]));
  });
}

export async function POST(req: NextRequest) {
  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const bodyObject = asObject(parsedBody);
  if (!bodyObject) return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  if (["sources", "teacherOriginalSources", "nonEvidenceReferences", "caseEvidence"].some(key => key in bodyObject)) {
    return NextResponse.json({
      error: "审计来源必须来自生成服务端签发的凭证，不能由浏览器重新选择。",
      code: "GENERATION_EVIDENCE_MISMATCH",
    }, { status: 400 });
  }
  if (!hasOnlyKeys(bodyObject, [
    "auditSessionId",
    "activeIPId",
    "generationEvidenceProof",
    "content",
  ])) {
    return NextResponse.json({ error: "审计接口只接受正文与证据字段" }, { status: 400 });
  }
  const body = bodyObject as AuditRequestBody;
  if (body.auditSessionId !== undefined && (typeof body.auditSessionId !== "string" || !body.auditSessionId)) {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (hasForbiddenNestedAuditFields(body)) {
    return NextResponse.json({ error: "审计接口只接受正文与证据字段" }, { status: 400 });
  }
  const content = parseScriptGenerationAuditContent(body.content);
  if (!content
    || typeof body.generationEvidenceProof !== "string" || !body.generationEvidenceProof) {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (typeof body.activeIPId !== "string" || !body.activeIPId.trim()) {
    return NextResponse.json({
      error: "审计来源缺少可核验的IP归属，已拒绝使用。",
      code: "UNTRUSTED_AUDIT_SOURCE",
    }, { status: 400 });
  }
  let generationEvidence;
  try {
    generationEvidence = readVerifiedScriptGenerationEvidenceProof(
      body.generationEvidenceProof,
      await getIPSourceAnalysisProofSecret(),
    );
  } catch {
    return NextResponse.json({
      error: "生成证据凭证核验服务暂不可用，已停止审计。",
      code: "GENERATION_EVIDENCE_VERIFICATION_UNAVAILABLE",
    }, { status: 500 });
  }
  if (!generationEvidence || generationEvidence.ipId !== body.activeIPId.trim()) {
    return NextResponse.json({
      error: "生成证据凭证无效或与当前IP不一致，已停止审计。",
      code: "GENERATION_EVIDENCE_MISMATCH",
    }, { status: 400 });
  }
  const generationEvidenceDigest = digestScriptGenerationEvidenceProof(body.generationEvidenceProof);
  if (body.auditSessionId) {
    try {
      await verifyScriptAuditSessionGenerationEvidence({
        auditSessionId: body.auditSessionId as string,
        generationEvidenceDigest,
      });
    } catch (error) {
      if (error instanceof ScriptAuditServerError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      return NextResponse.json({
        error: "审计会话核验失败，已停止审计。",
        code: "AUDIT_SESSION_VERIFICATION_UNAVAILABLE",
      }, { status: 500 });
    }
  } else if (digestScriptGenerationAuditContent(content) !== generationEvidence.contentDigest) {
    return NextResponse.json({
      error: "送审正文与生成完成时的正文不一致，已停止审计。",
      code: "GENERATION_EVIDENCE_MISMATCH",
    }, { status: 400 });
  }
  const sources = generationEvidence.sources;
  const caseEvidence = generationEvidence.caseEvidence;
  const nonEvidenceReferences = generationEvidence.nonEvidenceReferences;
  const auditSubject = content.outline
    .map(section => `${section.label}：${section.content}`)
    .join("\n")
    .slice(0, 4000);
  const factAudit = buildFactAudit({
    pendingItems: content.pendingVerification,
    caseEvidence,
  });
  const auditVersion = createScriptGenerationAuditVersion({
    ipId: body.activeIPId.trim(),
    content,
    sources,
    caseEvidence,
    nonEvidenceReferences,
  });

  try {
    const coverageAssessment = await analyzeScriptCoverage({
      topic: auditSubject,
      angle: "",
      sources,
      apiKey: req.headers.get("X-DeepSeek-Key") ?? "",
    });
    const paragraphs = buildAttributionParagraphs(content);
    const allowedReferences = sources.map(reference => ({
      sourceId: reference.sourceId,
      itemId: reference.itemId,
      sourceTitle: reference.sourceTitle,
      originalExcerpt: reference.originalExcerpt,
    }));
    try {
      const attributionResult = await callStructuredDeepSeek({
        systemPrompt: ATTRIBUTION_AUDIT_SYSTEM,
        userPrompt: buildAttributionAuditPrompt({ paragraphs, sourceReferences: allowedReferences, caseEvidence }),
        parse: response => parseAttributionAuditResult(
          response,
          paragraphs,
          allowedReferences,
          Boolean(caseEvidence),
        ),
        apiKey: req.headers.get("X-DeepSeek-Key") ?? "",
        maxTokens: 1800,
        temperature: 0,
        timeoutMs: 60_000,
        maxRetries: 1,
      });
      const pendingItems = attributionResult.data.paragraphAttributions
        .filter(paragraph => paragraph.reasoningSubtype === "unsupported_specific_claim")
        .map(paragraph => ({
          id: `${auditVersion}:${paragraph.sectionIndex}:${paragraph.paragraphIndex}:unsupported_specific_claim`,
          sectionIndex: paragraph.sectionIndex,
          paragraphIndex: paragraph.paragraphIndex,
          subtype: "unsupported_specific_claim" as const,
          excerpt: paragraph.excerpt,
          reason: paragraph.reason,
          resolutionStatus: "PENDING" as const,
        }));
      const declaredPendingItems = factAudit.pendingItems
        .filter((item): item is string => typeof item === "string")
        .map((item, index) => ({
          id: `${auditVersion}:pending-verification:${index}`,
          sectionIndex: null,
          paragraphIndex: index,
          subtype: "declared_pending_verification" as const,
          excerpt: item,
          reason: "生成结果明确标记该事实仍需核验。",
          resolutionStatus: "PENDING" as const,
        }));
      const unverifiedCasePendingItems = caseEvidence && !isFactCaseEvidenceConfirmed(caseEvidence)
        ? [{
            id: `${auditVersion}:case-evidence:0:declared_pending_verification`,
            sectionIndex: null,
            paragraphIndex: 0,
            subtype: "declared_pending_verification" as const,
            excerpt: caseEvidence.content?.trim() || caseEvidence.title.trim(),
            reason: "人工补充案例尚未核实。",
            resolutionStatus: "PENDING" as const,
          }]
        : [];
      const allPendingItems = [
        ...declaredPendingItems,
        ...unverifiedCasePendingItems,
        ...pendingItems,
      ];
      const pendingItemIds = allPendingItems.map(item => item.id);
      const blockerCodes = [
        ...(attributionResult.data.sourceIntegrityAudit.issues.length > 0
          ? ["SOURCE_INTEGRITY_REVIEW_REQUIRED"]
          : []),
        ...(pendingItems.length > 0
          ? ["UNRESOLVED_UNSUPPORTED_SPECIFIC_CLAIM"]
          : []),
        ...(declaredPendingItems.length > 0 || unverifiedCasePendingItems.length > 0
          ? ["UNRESOLVED_FACT_VERIFICATION"]
          : []),
      ];
      const completedFactAudit = {
        ...factAudit,
        pendingItems: allPendingItems,
      };
      const deliveryGate = {
        status: blockerCodes.length > 0 ? "BLOCKED" as const : "OPEN" as const,
        auditVersion,
        blockerCodes,
        pendingItemIds,
      };
      const { auditSessionId } = await createScriptAuditSession({
        auditSessionId: body.auditSessionId as string | undefined,
        auditVersion,
        generationEvidenceDigest,
        factAudit: completedFactAudit,
        sourceIntegrityAudit: attributionResult.data.sourceIntegrityAudit,
        deliveryGate,
      });
      const result: ScriptPostGenerationAudit = {
        status: "completed",
        auditSessionId,
        auditVersion,
        coverageAssessment,
        attributionAudit: buildAttributionAudit({
          coverage: coverageAssessment.coverage,
          coveredDimensions: coverageAssessment.coveredDimensions,
          missingDimensions: coverageAssessment.missingDimensions,
          paragraphAttributions: attributionResult.data.paragraphAttributions,
          auditCompleted: true,
        }),
        sourceIntegrityAudit: attributionResult.data.sourceIntegrityAudit,
        factAudit: completedFactAudit,
        deliveryGate,
        referenceMaterials: { nonEvidenceReferences },
      };
      return NextResponse.json(result);
    } catch {
      const result: ScriptPostGenerationAudit = {
        status: "unavailable",
        auditVersion,
        message: "本次归属分析暂未完成",
        coverageAssessment,
        attributionAudit: buildAttributionAudit({
          coverage: coverageAssessment.coverage,
          coveredDimensions: coverageAssessment.coveredDimensions,
          missingDimensions: coverageAssessment.missingDimensions,
          paragraphAttributions: [],
          auditCompleted: false,
        }),
        factAudit,
        referenceMaterials: { nonEvidenceReferences },
      };
      return NextResponse.json(result);
    }
  } catch {
    const result: ScriptPostGenerationAudit = {
      status: "unavailable",
      auditVersion,
      message: "本次归属分析暂未完成",
      factAudit,
      referenceMaterials: { nonEvidenceReferences },
    };
    return NextResponse.json(result);
  }
}
