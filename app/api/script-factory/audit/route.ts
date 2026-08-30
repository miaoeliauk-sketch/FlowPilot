import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
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
  isCoverageSource,
} from "@/lib/script-factory-coverage-analysis";
import type { CoverageSourceReference } from "@/lib/script-factory-coverage";
import type {
  ScriptFactCaseEvidence,
  ScriptPostGenerationAudit,
} from "@/lib/script-factory-contract";
import { callStructuredDeepSeek } from "@/lib/structured-deepseek";

interface AuditRequestBody {
  sources?: unknown;
  content?: unknown;
  caseEvidence?: unknown;
}

interface AuditContent {
  outline: Array<{
    label: string;
    timeRange: string;
    content: string;
    subPoints: string[];
  }>;
  pendingVerification: string[];
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

const SOURCE_KEYS = [
  "sourceId",
  "sourceTitle",
  "itemId",
  "kind",
  "content",
  "originalExcerpt",
  "extractionStatus",
] as const;

function hasForbiddenNestedAuditFields(body: AuditRequestBody): boolean {
  if (Array.isArray(body.sources) && body.sources.some(source => {
    const object = asObject(source);
    return Boolean(object && !hasOnlyKeys(object, SOURCE_KEYS));
  })) return true;
  const caseEvidence = asObject(body.caseEvidence);
  if (
    caseEvidence &&
    !hasOnlyKeys(caseEvidence, ["title", "content", "sourceType", "verificationStatus", "sourceUrl", "occurredAt"])
  ) return true;
  const content = asObject(body.content);
  if (!content) return false;
  if (!hasOnlyKeys(content, ["outline", "pendingVerification"])) return true;
  return Array.isArray(content.outline) && content.outline.some(section => {
    const object = asObject(section);
    return Boolean(object && !hasOnlyKeys(object, ["label", "timeRange", "content", "subPoints"]));
  });
}

function parseContent(value: unknown): AuditContent | null {
  const object = asObject(value);
  if (
    !object ||
    !hasOnlyKeys(object, ["outline", "pendingVerification"]) ||
    !Array.isArray(object.outline) ||
    !Array.isArray(object.pendingVerification)
  ) return null;
  const outline = object.outline.map(rawSection => {
    const section = asObject(rawSection);
    if (
      !section ||
      !hasOnlyKeys(section, ["label", "timeRange", "content", "subPoints"]) ||
      typeof section.label !== "string" ||
      typeof section.timeRange !== "string" ||
      typeof section.content !== "string" ||
      !Array.isArray(section.subPoints) ||
      !section.subPoints.every(item => typeof item === "string")
    ) return null;
    return {
      label: section.label,
      timeRange: section.timeRange,
      content: section.content,
      subPoints: section.subPoints as string[],
    };
  });
  if (outline.some(section => section === null) || !object.pendingVerification.every(item => typeof item === "string")) {
    return null;
  }
  return {
    outline: outline as AuditContent["outline"],
    pendingVerification: object.pendingVerification as string[],
  };
}

function parseCaseEvidence(value: unknown): ScriptFactCaseEvidence | null | undefined {
  if (value === null || value === undefined) return null;
  const object = asObject(value);
  if (!object) return undefined;
  if (!hasOnlyKeys(object, ["title", "content", "sourceType", "verificationStatus", "sourceUrl", "occurredAt"])) {
    return undefined;
  }
  if (
    typeof object.title !== "string" ||
    typeof object.sourceType !== "string" ||
    typeof object.verificationStatus !== "string"
  ) return undefined;
  const optionalFields = ["content", "sourceUrl", "occurredAt"] as const;
  if (optionalFields.some(field => object[field] !== undefined && typeof object[field] !== "string")) return undefined;
  return {
    title: object.title,
    content: object.content as string | undefined,
    sourceType: object.sourceType,
    verificationStatus: object.verificationStatus,
    sourceUrl: object.sourceUrl as string | undefined,
    occurredAt: object.occurredAt as string | undefined,
  };
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
  if (!hasOnlyKeys(bodyObject, ["sources", "content", "caseEvidence"])) {
    return NextResponse.json({ error: "审计接口只接受正文与证据字段" }, { status: 400 });
  }
  const body = bodyObject as AuditRequestBody;
  if (hasForbiddenNestedAuditFields(body)) {
    return NextResponse.json({ error: "审计接口只接受正文与证据字段" }, { status: 400 });
  }
  const content = parseContent(body.content);
  const caseEvidence = parseCaseEvidence(body.caseEvidence);
  if (!content || caseEvidence === undefined) {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (
    !Array.isArray(body.sources) ||
    body.sources.length > 120 ||
    !body.sources.every(isCoverageSource)
  ) {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const sources = body.sources as CoverageSourceReference[];
  const auditSubject = content.outline
    .map(section => `${section.label}：${section.content}`)
    .join("\n")
    .slice(0, 4000);
  const factAudit = buildFactAudit({
    pendingItems: content.pendingVerification,
    caseEvidence,
  });
  const auditVersion = createHash("sha256")
    .update(JSON.stringify({ content, sources, caseEvidence }))
    .digest("hex");

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
      const result: ScriptPostGenerationAudit = {
        status: "completed",
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
        factAudit,
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
      };
      return NextResponse.json(result);
    }
  } catch {
    const result: ScriptPostGenerationAudit = {
      status: "unavailable",
      auditVersion,
      message: "本次归属分析暂未完成",
      factAudit,
    };
    return NextResponse.json(result);
  }
}
