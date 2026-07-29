import type {
  ConfidenceTier,
  ReviewGrade,
  ReviewPerformanceType,
  VideoReview,
} from "./types";

export type ReviewAnalysis = NonNullable<VideoReview["analysis"]>;
export type ReviewResponseErrorCode =
  | "empty_content"
  | "invalid_json"
  | "incomplete_fields";

export class ReviewResponseError extends Error {
  readonly code: ReviewResponseErrorCode;

  constructor(code: ReviewResponseErrorCode, message: string) {
    super(message);
    this.name = "ReviewResponseError";
    this.code = code;
  }
}

function parseJSONObject(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new ReviewResponseError("empty_content", "AI返回内容为空");
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new ReviewResponseError("invalid_json", "AI返回内容不是完整JSON");
  }

  try {
    const parsed: unknown = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    return objectValue(parsed, "root");
  } catch (error) {
    if (error instanceof ReviewResponseError) throw error;
    throw new ReviewResponseError("invalid_json", "AI返回JSON解析失败");
  }
}

function incomplete(path: string): never {
  throw new ReviewResponseError(
    "incomplete_fields",
    `AI返回字段不完整或格式错误：${path}`,
  );
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return incomplete(path);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string") return incomplete(path);
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return incomplete(path);
  return value;
}

function numberValue(
  value: unknown,
  path: string,
  options?: { min?: number; max?: number; nullable?: boolean },
): number | null {
  if (value === null && options?.nullable) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return incomplete(path);
  }
  if (options?.min !== undefined && value < options.min) return incomplete(path);
  if (options?.max !== undefined && value > options.max) return incomplete(path);
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return incomplete(path);
  return value.map((item, index) => stringValue(item, `${path}[${index}]`));
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return incomplete(path);
  }
  return value as T;
}

function layer3Item(value: unknown, path: string) {
  const item = objectValue(value, path);
  return {
    score: numberValue(item.score, `${path}.score`, { min: 0, max: 10 }) as number,
    feedback: stringValue(item.feedback, `${path}.feedback`),
    suggestion: stringValue(item.suggestion, `${path}.suggestion`),
  };
}

export function parseReviewResponse(content: string): ReviewAnalysis {
  const root = parseJSONObject(content);
  const layer1 = objectValue(root.layer1, "layer1");
  const layer2 = objectValue(root.layer2, "layer2");
  const layer3 = objectValue(root.layer3, "layer3");
  const layer4 = objectValue(root.layer4, "layer4");
  const layer5 = objectValue(root.layer5, "layer5");
  const layer6 = objectValue(root.layer6, "layer6");

  return {
    layer1: {
      grade: enumValue<ReviewGrade>(
        layer1.grade,
        ["S", "A", "B", "C"],
        "layer1.grade",
      ),
      performanceType: enumValue<ReviewPerformanceType>(
        layer1.performanceType,
        ["爆款", "潜力款", "普通款", "失败款"],
        "layer1.performanceType",
      ),
      highlights: stringArray(layer1.highlights, "layer1.highlights"),
      weaknesses: stringArray(layer1.weaknesses, "layer1.weaknesses"),
      scoringBasis: stringValue(layer1.scoringBasis, "layer1.scoringBasis"),
    },
    layer2: {
      hasViralPotential: booleanValue(
        layer2.hasViralPotential,
        "layer2.hasViralPotential",
      ),
      confidenceTier: enumValue<ConfidenceTier>(
        layer2.confidenceTier,
        ["高可信度", "中可信度", "低可信度"],
        "layer2.confidenceTier",
      ),
      reasoning: stringValue(layer2.reasoning, "layer2.reasoning"),
      dataEvidence: stringValue(layer2.dataEvidence, "layer2.dataEvidence"),
      structureEvidence: stringValue(
        layer2.structureEvidence,
        "layer2.structureEvidence",
      ),
      knowledgeEvidence: stringValue(
        layer2.knowledgeEvidence,
        "layer2.knowledgeEvidence",
      ),
    },
    layer3: {
      hasScriptText: booleanValue(
        layer3.hasScriptText,
        "layer3.hasScriptText",
      ),
      noScriptReason: stringValue(
        layer3.noScriptReason,
        "layer3.noScriptReason",
      ),
      titleAnalysis: layer3Item(layer3.titleAnalysis, "layer3.titleAnalysis"),
      hookAnalysis: layer3Item(layer3.hookAnalysis, "layer3.hookAnalysis"),
      middleAnalysis: layer3Item(layer3.middleAnalysis, "layer3.middleAnalysis"),
      endingAnalysis: layer3Item(layer3.endingAnalysis, "layer3.endingAnalysis"),
    },
    layer4: {
      hasHistoricalData: booleanValue(
        layer4.hasHistoricalData,
        "layer4.hasHistoricalData",
      ),
      noHistoryReason: stringValue(
        layer4.noHistoryReason,
        "layer4.noHistoryReason",
      ),
      betterMetrics: stringArray(layer4.betterMetrics, "layer4.betterMetrics"),
      worseMetrics: stringArray(layer4.worseMetrics, "layer4.worseMetrics"),
      changeReason: stringValue(layer4.changeReason, "layer4.changeReason"),
      avgHistoricalViews: numberValue(
        layer4.avgHistoricalViews,
        "layer4.avgHistoricalViews",
        { nullable: true },
      ),
      avgHistoricalLikes: numberValue(
        layer4.avgHistoricalLikes,
        "layer4.avgHistoricalLikes",
        { nullable: true },
      ),
      avgHistoricalComments: numberValue(
        layer4.avgHistoricalComments,
        "layer4.avgHistoricalComments",
        { nullable: true },
      ),
      avgHistoricalFavorites: numberValue(
        layer4.avgHistoricalFavorites,
        "layer4.avgHistoricalFavorites",
        { nullable: true },
      ),
    },
    layer5: {
      successPatterns: stringArray(
        layer5.successPatterns,
        "layer5.successPatterns",
      ),
      failurePatterns: stringArray(
        layer5.failurePatterns,
        "layer5.failurePatterns",
      ),
      reusableFormulas: stringArray(
        layer5.reusableFormulas,
        "layer5.reusableFormulas",
      ),
    },
    layer6: {
      continueSuggestions: stringArray(
        layer6.continueSuggestions,
        "layer6.continueSuggestions",
      ),
      stopSuggestions: stringArray(
        layer6.stopSuggestions,
        "layer6.stopSuggestions",
      ),
      optimizeSuggestions: stringArray(
        layer6.optimizeSuggestions,
        "layer6.optimizeSuggestions",
      ),
      recommendedTopics: stringArray(
        layer6.recommendedTopics,
        "layer6.recommendedTopics",
      ),
      recommendedTitles: stringArray(
        layer6.recommendedTitles,
        "layer6.recommendedTitles",
      ),
    },
  };
}
