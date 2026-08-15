import type { CoverageLevel } from "./script-factory-coverage";
import type { ScriptContentResponse } from "./script-factory-response";
import type {
  ParagraphAttribution,
  ParagraphAttributionType,
  ScriptAttributionAudit,
  ScriptFactAudit,
  ScriptFactCaseEvidence,
} from "./script-factory-contract";

export interface AttributionParagraph {
  id: string;
  sectionIndex: number;
  paragraphIndex: number;
  sectionLabel: string;
  text: string;
}

export interface AllowedAttributionReference {
  sourceId: string;
  itemId: string;
  sourceTitle: string;
  originalExcerpt: string;
}

const ATTRIBUTION_TYPES = new Set<ParagraphAttributionType>([
  "teacher_explicit",
  "faithful_rewrite",
  "ai_reasoning",
  "case_fact",
]);

class ScriptAttributionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptAttributionParseError";
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJSONObject(content: string): Record<string, unknown> {
  const cleaned = content.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    const object = asObject(JSON.parse(cleaned));
    if (!object) throw new Error("invalid root");
    return object;
  } catch {
    throw new ScriptAttributionParseError("观点归属审计返回格式不正确");
  }
}

function requiredString(object: Record<string, unknown>, field: string): string {
  const value = object[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new ScriptAttributionParseError(`观点归属审计缺少字段：${field}`);
  }
  return value.trim();
}

export function buildAttributionParagraphs(
  content: Pick<ScriptContentResponse, "outline">,
): AttributionParagraph[] {
  return content.outline.flatMap((section, sectionIndex) => {
    const parts = section.content
      .split(/\n+/)
      .map(item => item.trim())
      .filter(Boolean);
    return parts.map((text, paragraphIndex) => ({
      id: `S${sectionIndex + 1}-P${paragraphIndex + 1}`,
      sectionIndex,
      paragraphIndex,
      sectionLabel: section.label,
      text,
    }));
  });
}

export function parseParagraphAttributions(
  response: string,
  paragraphs: readonly AttributionParagraph[],
  allowedReferences: readonly AllowedAttributionReference[],
  hasCaseEvidence: boolean,
): ParagraphAttribution[] {
  const object = parseJSONObject(response);
  if (!Array.isArray(object.paragraphs)) {
    throw new ScriptAttributionParseError("观点归属审计缺少段落列表");
  }
  const paragraphMap = new Map(paragraphs.map(paragraph => [paragraph.id, paragraph]));
  const allowedReferenceMap = new Map(
    allowedReferences.map(reference => [`${reference.sourceId}:${reference.itemId}`, reference]),
  );
  const seen = new Set<string>();

  const result = object.paragraphs.map((rawItem): ParagraphAttribution => {
    const item = asObject(rawItem);
    if (!item) throw new ScriptAttributionParseError("观点归属审计包含非法段落");
    const paragraphId = requiredString(item, "paragraphId");
    const paragraph = paragraphMap.get(paragraphId);
    if (!paragraph || seen.has(paragraphId)) {
      throw new ScriptAttributionParseError("观点归属审计引用了不存在或重复的正文段落");
    }
    seen.add(paragraphId);
    const attributionType = requiredString(item, "attributionType") as ParagraphAttributionType;
    if (!ATTRIBUTION_TYPES.has(attributionType)) {
      throw new ScriptAttributionParseError("观点归属审计包含未知来源类型");
    }
    const reason = requiredString(item, "reason");
    if (!Array.isArray(item.sourceReferences)) {
      throw new ScriptAttributionParseError("观点归属审计缺少来源引用列表");
    }
    const sourceReferences = item.sourceReferences.map(rawReference => {
      const reference = asObject(rawReference);
      if (!reference) throw new ScriptAttributionParseError("观点归属审计包含非法来源引用");
      const sourceId = requiredString(reference, "sourceId");
      const itemId = requiredString(reference, "itemId");
      if (!allowedReferenceMap.has(`${sourceId}:${itemId}`)) {
        throw new ScriptAttributionParseError("观点归属审计引用了不存在的老师原始内容");
      }
      return { sourceId, itemId };
    });

    if (
      (attributionType === "teacher_explicit" || attributionType === "faithful_rewrite") &&
      sourceReferences.length === 0
    ) {
      throw new ScriptAttributionParseError("老师表达类段落必须提供真实来源");
    }
    if (attributionType === "ai_reasoning" && sourceReferences.length > 0) {
      throw new ScriptAttributionParseError("AI推理补充不能冒用老师原始内容来源");
    }
    if (attributionType === "case_fact" && !hasCaseEvidence) {
      throw new ScriptAttributionParseError("案例事实补充没有可对应的案例证据");
    }
    if (attributionType === "case_fact" && sourceReferences.length > 0) {
      throw new ScriptAttributionParseError("案例事实补充不能冒用老师原始内容来源");
    }

    return {
      sectionIndex: paragraph.sectionIndex,
      paragraphIndex: paragraph.paragraphIndex,
      excerpt: paragraph.text,
      attributionType,
      sourceReferences,
      reason,
    };
  });

  if (seen.size !== paragraphs.length) {
    throw new ScriptAttributionParseError("观点归属审计没有覆盖正文全部段落");
  }
  return result.sort((left, right) =>
    left.sectionIndex - right.sectionIndex || left.paragraphIndex - right.paragraphIndex);
}

export function buildAttributionAudit(input: {
  coverage: CoverageLevel;
  coveredDimensions: string[];
  missingDimensions: string[];
  paragraphAttributions: ParagraphAttribution[];
  auditCompleted: boolean;
}): ScriptAttributionAudit {
  const hasAIReasoning = input.paragraphAttributions.some(
    paragraph => paragraph.attributionType === "ai_reasoning",
  );
  if (!input.auditCompleted) {
    return {
      outputStatus: input.coverage === "NONE" ? "exploratory" : "review",
      confidenceLevel: "low",
      coveredDimensions: input.coveredDimensions,
      missingDimensions: input.missingDimensions,
      recommendation: "观点归属审计未完成，请逐段人工核对后再决定是否作为老师正式表达。",
      auditStatus: "unavailable",
      paragraphAttributions: input.paragraphAttributions,
    };
  }
  if (input.coverage === "NONE") {
    return {
      outputStatus: "exploratory",
      confidenceLevel: "low",
      coveredDimensions: input.coveredDimensions,
      missingDimensions: input.missingDimensions,
      recommendation: "当前没有老师的明确观点依据，只能作为探索稿供老师确认。",
      auditStatus: "completed",
      paragraphAttributions: input.paragraphAttributions,
    };
  }
  if (input.coverage === "PARTIAL") {
    return {
      outputStatus: "review",
      confidenceLevel: "medium",
      coveredDimensions: input.coveredDimensions,
      missingDimensions: input.missingDimensions,
      recommendation: "核心判断有老师原始内容支撑，但缺失部分需要老师审核后才能作为正式稿。",
      auditStatus: "completed",
      paragraphAttributions: input.paragraphAttributions,
    };
  }
  return {
    outputStatus: "formal",
    confidenceLevel: hasAIReasoning ? "medium" : "high",
    coveredDimensions: input.coveredDimensions,
    missingDimensions: input.missingDimensions,
    recommendation: hasAIReasoning
      ? "老师观点依据完整，但部分推理属于AI补充，建议确认相关段落后使用。"
      : "观点和核心推理均有老师原始内容支撑，可以按正式稿审核使用。",
    auditStatus: "completed",
    paragraphAttributions: input.paragraphAttributions,
  };
}

export function buildFactAudit(input: {
  pendingItems: string[];
  caseEvidence: ScriptFactCaseEvidence | null;
}): ScriptFactAudit {
  const pendingItems = input.pendingItems.map(item => item.trim()).filter(Boolean);
  const caseConfirmed = input.caseEvidence?.verificationStatus === "人工已核实" ||
    (
      input.caseEvidence?.verificationStatus === "有明确来源" &&
      Boolean(input.caseEvidence.sourceUrl?.trim())
    );
  return {
    overallStatus: pendingItems.length > 0 || (input.caseEvidence && !caseConfirmed)
      ? "pending"
      : input.caseEvidence && caseConfirmed ? "user_confirmed" : "not_checked",
    systemVerified: false,
    pendingItems,
    caseEvidence: input.caseEvidence,
  };
}

export const ATTRIBUTION_AUDIT_SYSTEM = `你是独立的脚本观点归属审计员。你不负责写稿、改稿或评价文采，只判断正文每一段的内容来源。
teacher_explicit表示与老师原文直接对应；faithful_rewrite表示忠实重组但没有改变判断；ai_reasoning表示原始内容没有提供这层判断或推理；case_fact表示来自本次案例材料。
老师表达类标记必须引用真实存在的sourceId和itemId。找不到老师出处时只能标记ai_reasoning。案例事实只能在确有案例材料时使用。每个正文段落必须且只能返回一次。只输出合法JSON对象。`;

export function buildAttributionAuditPrompt(input: {
  paragraphs: AttributionParagraph[];
  sourceReferences: AllowedAttributionReference[];
  caseEvidence: ScriptFactCaseEvidence | null;
}): string {
  return `待审计正文段落：
${JSON.stringify(input.paragraphs.map(paragraph => ({
  paragraphId: paragraph.id,
  sectionLabel: paragraph.sectionLabel,
  text: paragraph.text,
})), null, 2)}

允许引用的老师原始内容：
${JSON.stringify(input.sourceReferences, null, 2)}

本次案例材料：
${input.caseEvidence ? JSON.stringify(input.caseEvidence, null, 2) : "无"}

严格按以下JSON格式输出：
{
  "paragraphs": [{
    "paragraphId": "S1-P1",
    "attributionType": "teacher_explicit|faithful_rewrite|ai_reasoning|case_fact",
    "sourceReferences": [{"sourceId": "真实sourceId", "itemId": "真实itemId"}],
    "reason": "这段为什么属于该来源类型"
  }]
}`;
}
