import { NextRequest, NextResponse } from "next/server";
import {
  ATTRIBUTION_AUDIT_SYSTEM,
  buildAttributionAudit,
  buildAttributionAuditPrompt,
  buildAttributionParagraphs,
  buildFactAudit,
  parseParagraphAttributions,
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
  topic?: unknown;
  angle?: unknown;
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

function parseContent(value: unknown): AuditContent | null {
  const object = asObject(value);
  if (!object || !Array.isArray(object.outline) || !Array.isArray(object.pendingVerification)) return null;
  const outline = object.outline.map(rawSection => {
    const section = asObject(rawSection);
    if (
      !section ||
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
  const body = bodyObject as AuditRequestBody;
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const angle = typeof body.angle === "string" ? body.angle.trim() : "";
  const content = parseContent(body.content);
  const caseEvidence = parseCaseEvidence(body.caseEvidence);
  if (!topic || !content || caseEvidence === undefined) {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const sources = Array.isArray(body.sources)
    ? body.sources.filter(isCoverageSource).slice(0, 120) as CoverageSourceReference[]
    : [];
  const factAudit = buildFactAudit({
    pendingItems: content.pendingVerification,
    caseEvidence,
  });

  try {
    const coverageAssessment = await analyzeScriptCoverage({
      topic,
      angle,
      sources,
      apiKey: req.headers.get("X-DeepSeek-Key") ?? "",
    });
    const paragraphs = buildAttributionParagraphs(content);
    const allowedReferences = coverageAssessment.sourceReferences.map(reference => ({
      sourceId: reference.sourceId,
      itemId: reference.itemId,
      sourceTitle: reference.sourceTitle,
      originalExcerpt: reference.originalExcerpt,
    }));
    try {
      const attributionResult = await callStructuredDeepSeek({
        systemPrompt: ATTRIBUTION_AUDIT_SYSTEM,
        userPrompt: buildAttributionAuditPrompt({ paragraphs, sourceReferences: allowedReferences, caseEvidence }),
        parse: response => parseParagraphAttributions(
          response,
          paragraphs,
          allowedReferences,
          Boolean(caseEvidence),
        ),
        apiKey: req.headers.get("X-DeepSeek-Key") ?? "",
        maxTokens: 1800,
        temperature: 0,
        timeoutMs: 60_000,
        maxRetries: 0,
      });
      const result: ScriptPostGenerationAudit = {
        status: "completed",
        coverageAssessment,
        attributionAudit: buildAttributionAudit({
          coverage: coverageAssessment.coverage,
          coveredDimensions: coverageAssessment.coveredDimensions,
          missingDimensions: coverageAssessment.missingDimensions,
          paragraphAttributions: attributionResult.data,
          auditCompleted: true,
        }),
        factAudit,
      };
      return NextResponse.json(result);
    } catch {
      const result: ScriptPostGenerationAudit = {
        status: "unavailable",
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
      message: "本次归属分析暂未完成",
      factAudit,
    };
    return NextResponse.json(result);
  }
}
