import type { IPSourceAnalysisKind, IPSourceExtractionStatus } from "./types";

export type CoverageLevel = "FULL" | "PARTIAL" | "NONE";
export type CoverageDimension = "核心判断" | "推理过程" | "事实证据" | "案例" | "概念解释";
export type CaseNeed = "NOT_ASSESSED" | "NOT_NEEDED" | "ENHANCEMENT" | "REQUIRED";
export type CaseDecision = "skip" | "knowledge" | "manual";

export interface CoverageSourceReference {
  sourceId: string;
  sourceTitle: string;
  itemId: string;
  kind: IPSourceAnalysisKind;
  content: string;
  originalExcerpt: string;
  extractionStatus: IPSourceExtractionStatus;
}

export interface CoverageAssessment {
  coverage: CoverageLevel;
  reason: string;
  coveredDimensions: CoverageDimension[];
  missingDimensions: CoverageDimension[];
  sourceReferences: CoverageSourceReference[];
  caseNeed: CaseNeed;
  caseReason: string;
}

const COVERAGE_LEVELS = new Set<CoverageLevel>(["FULL", "PARTIAL", "NONE"]);
const DIMENSIONS = new Set<CoverageDimension>(["核心判断", "推理过程", "事实证据", "案例", "概念解释"]);
const CASE_NEEDS = new Set<CaseNeed>(["NOT_ASSESSED", "NOT_NEEDED", "ENHANCEMENT", "REQUIRED"]);

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function createEmptyCoverageAssessment(topic: string): CoverageAssessment {
  return {
    coverage: "NONE",
    reason: `当前IP知识库里没有找到能够支撑「${topic.trim() || "当前选题"}」核心判断的原始内容。`,
    coveredDimensions: [],
    missingDimensions: ["核心判断", "推理过程"],
    sourceReferences: [],
    caseNeed: "NOT_ASSESSED",
    caseReason: "先补充老师的核心判断，再判断是否需要案例。",
  };
}

export function parseCoverageAssessment(
  content: string,
  allowedReferences: CoverageSourceReference[],
): CoverageAssessment {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error("观点覆盖度返回的不是完整JSON");
  }
  const object = asObject(raw);
  if (!object) throw new Error("观点覆盖度返回格式不正确");

  const coverage = object.coverage;
  const caseNeed = object.caseNeed;
  if (typeof coverage !== "string" || !COVERAGE_LEVELS.has(coverage as CoverageLevel)) {
    throw new Error("观点覆盖度状态不正确");
  }
  if (typeof caseNeed !== "string" || !CASE_NEEDS.has(caseNeed as CaseNeed)) {
    throw new Error("案例需求状态不正确");
  }
  const reason = typeof object.reason === "string" ? object.reason.trim() : "";
  const caseReason = typeof object.caseReason === "string" ? object.caseReason.trim() : "";
  if (!reason || !caseReason) throw new Error("观点覆盖度缺少判断理由");

  const coveredDimensions = stringList(object.coveredDimensions)
    .filter((item): item is CoverageDimension => DIMENSIONS.has(item as CoverageDimension));
  const missingDimensions = stringList(object.missingDimensions)
    .filter((item): item is CoverageDimension => DIMENSIONS.has(item as CoverageDimension));
  const allowedMap = new Map(
    allowedReferences.map(reference => [`${reference.sourceId}:${reference.itemId}`, reference]),
  );
  const referenceRows = Array.isArray(object.sourceReferences) ? object.sourceReferences : [];
  const sourceReferences = referenceRows.map(row => {
    const reference = asObject(row);
    const sourceId = typeof reference?.sourceId === "string" ? reference.sourceId : "";
    const itemId = typeof reference?.itemId === "string" ? reference.itemId : "";
    const matched = allowedMap.get(`${sourceId}:${itemId}`);
    if (!matched) throw new Error("观点覆盖度引用了不存在的原始内容");
    return matched;
  });

  if (coverage !== "NONE" && sourceReferences.length === 0) {
    throw new Error("观点覆盖度没有提供原始内容依据");
  }
  if (coverage === "FULL" && !coveredDimensions.includes("核心判断")) {
    throw new Error("充分覆盖必须包含核心判断依据");
  }
  if (coverage === "FULL") {
    const hasClaim = sourceReferences.some(reference => reference.kind === "claim");
    const hasReasoning = sourceReferences.some(reference => reference.kind === "reasoning" || reference.kind === "concept");
    if (!hasClaim || !hasReasoning) {
      throw new Error("充分覆盖必须同时引用老师的核心判断和推理依据");
    }
    if (caseNeed === "NOT_ASSESSED") {
      throw new Error("充分覆盖后必须明确判断案例是否需要");
    }
  }
  if (coverage !== "FULL" && caseNeed !== "NOT_ASSESSED") {
    throw new Error("覆盖度未通过前不能提前判断案例需求");
  }

  return {
    coverage: coverage as CoverageLevel,
    reason,
    coveredDimensions,
    missingDimensions,
    sourceReferences,
    caseNeed: caseNeed as CaseNeed,
    caseReason,
  };
}

export function resolveGenerationPermission(
  assessment: CoverageAssessment | null,
  caseDecision: CaseDecision | null,
  evidenceConfirmed: boolean,
): { allowed: boolean; reason: string } {
  if (!assessment || assessment.coverage !== "FULL") {
    return { allowed: false, reason: "当前IP的观点覆盖度尚未达到充分覆盖。" };
  }
  if (assessment.caseNeed === "REQUIRED" && caseDecision !== "knowledge" && caseDecision !== "manual") {
    return { allowed: false, reason: "这个立意必须先补充能够支撑论证的案例。" };
  }
  if (assessment.caseNeed === "ENHANCEMENT" && !caseDecision) {
    return { allowed: false, reason: "请先选择使用案例，或明确本次不使用案例。" };
  }
  if (!evidenceConfirmed) {
    return { allowed: false, reason: "请先确认本次使用的观点依据和案例边界。" };
  }
  return { allowed: true, reason: "观点依据和案例边界已确认。" };
}
