export type HotAnalysisResponseErrorCode =
  | "empty_content"
  | "invalid_json"
  | "incomplete_fields";

export class HotAnalysisResponseError extends Error {
  readonly code: HotAnalysisResponseErrorCode;

  constructor(
    code: HotAnalysisResponseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HotAnalysisResponseError";
    this.code = code;
  }
}

export interface HotAnalysisAIResponse {
  title: string;
  author: string;
  platform: string;
  publishedAt: string;
  contentDirection: string[];
  hook: string;
  hookType: string;
  hookScore: {
    painPoint: number;
    curiosity: number;
    conflict: number;
    benefit: number;
    emotion: number;
    total: number;
  };
  whyViral: string;
  structureBreakdownText: string;
  contentLayerPassed: boolean;
  contentLayerMatched: string[];
  structureLayerPassed: boolean;
  structureLayerMissing: string[];
  exclusionMatched: string | null;
  selfCheckPassed: boolean;
  selfCheckReasoning: string;
  worthLearning: "值得学习" | "部分学习" | "不建议学习";
  worthLearningReason: string;
  ipFitTier: "高度匹配" | "中度匹配" | "低度匹配" | null;
  ipFitReason: string;
  titleStructure: string;
  openingHookType: string;
  userNeedLayer: string;
  sentenceStageTags: Array<{
    index: number;
    stage: "Hook" | "Problem" | "Solution" | "Case" | "CTA" | "none";
  }>;
  sentenceEmotionTags: Array<{
    index: number;
    emotions: string[];
  }>;
}

const STAGES = ["Hook", "Problem", "Solution", "Case", "CTA", "none"] as const;
const WORTH_LEARNING = ["值得学习", "部分学习", "不建议学习"] as const;
const IP_FIT_TIERS = ["高度匹配", "中度匹配", "低度匹配"] as const;

function extractCompleteJSONObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (start < 0) {
      if (character !== "{") continue;
      start = index;
      depth = 1;
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requiredString(
  object: Record<string, unknown>,
  field: string,
): string {
  const value = optionalString(object[field]);
  if (!value) {
    throw new HotAnalysisResponseError(
      "incomplete_fields",
      `分析结果字段不完整：${field}`,
    );
  }
  return value;
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function requiredBoolean(
  object: Record<string, unknown>,
  field: string,
): boolean {
  if (typeof object[field] !== "boolean") {
    throw new HotAnalysisResponseError(
      "incomplete_fields",
      `分析结果字段不完整：${field}`,
    );
  }
  return object[field] as boolean;
}

function scoreValue(
  object: Record<string, unknown>,
  field: string,
  maximum: number,
): number {
  const raw = object[field];
  const value = typeof raw === "number"
    ? raw
    : typeof raw === "string" && raw.trim()
      ? Number(raw)
      : Number.NaN;
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new HotAnalysisResponseError(
      "incomplete_fields",
      `分析结果字段不完整：hookScore.${field}`,
    );
  }
  return value;
}

function normalizeStageTags(value: unknown): HotAnalysisAIResponse["sentenceStageTags"] {
  if (!Array.isArray(value)) {
    throw new HotAnalysisResponseError(
      "incomplete_fields",
      "分析结果字段不完整：sentenceStageTags",
    );
  }
  return value.map((item) => {
    const tag = asObject(item);
    if (
      !tag ||
      !Number.isInteger(tag.index) ||
      typeof tag.stage !== "string" ||
      !STAGES.includes(tag.stage as (typeof STAGES)[number])
    ) {
      throw new HotAnalysisResponseError(
        "incomplete_fields",
        "分析结果字段不完整：sentenceStageTags",
      );
    }
    return {
      index: tag.index as number,
      stage: tag.stage as HotAnalysisAIResponse["sentenceStageTags"][number]["stage"],
    };
  });
}

function normalizeEmotionTags(value: unknown): HotAnalysisAIResponse["sentenceEmotionTags"] {
  if (!Array.isArray(value)) {
    throw new HotAnalysisResponseError(
      "incomplete_fields",
      "分析结果字段不完整：sentenceEmotionTags",
    );
  }
  return value.map((item) => {
    const tag = asObject(item);
    if (!tag || !Number.isInteger(tag.index)) {
      throw new HotAnalysisResponseError(
        "incomplete_fields",
        "分析结果字段不完整：sentenceEmotionTags",
      );
    }
    return {
      index: tag.index as number,
      emotions: stringArray(tag.emotions),
    };
  });
}

export function parseHotAnalysisResponse(
  content: unknown,
): HotAnalysisAIResponse {
  if (typeof content !== "string" || !content.trim()) {
    throw new HotAnalysisResponseError(
      "empty_content",
      "AI未返回有效内容",
    );
  }

  const trimmed = content.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const jsonText = extractCompleteJSONObject(trimmed);
  if (!jsonText) {
    throw new HotAnalysisResponseError(
      "invalid_json",
      "AI返回格式异常",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new HotAnalysisResponseError(
      "invalid_json",
      "AI返回格式异常",
    );
  }

  const object = asObject(parsed);
  const hookScore = asObject(object?.hookScore);
  if (!object || !hookScore) {
    throw new HotAnalysisResponseError(
      "incomplete_fields",
      "分析结果字段不完整：hookScore",
    );
  }

  const worthLearning = object.worthLearning;
  if (
    typeof worthLearning !== "string" ||
    !WORTH_LEARNING.includes(worthLearning as (typeof WORTH_LEARNING)[number])
  ) {
    throw new HotAnalysisResponseError(
      "incomplete_fields",
      "分析结果字段不完整：worthLearning",
    );
  }

  const rawIPFitTier = object.ipFitTier;
  const ipFitTier = rawIPFitTier === null || rawIPFitTier === undefined
    ? null
    : typeof rawIPFitTier === "string" &&
        IP_FIT_TIERS.includes(rawIPFitTier as (typeof IP_FIT_TIERS)[number])
      ? rawIPFitTier as HotAnalysisAIResponse["ipFitTier"]
      : null;

  return {
    title: optionalString(object.title),
    author: optionalString(object.author),
    platform: optionalString(object.platform),
    publishedAt: optionalString(object.publishedAt),
    contentDirection: stringArray(object.contentDirection),
    hook: requiredString(object, "hook"),
    hookType: requiredString(object, "hookType"),
    hookScore: {
      painPoint: scoreValue(hookScore, "painPoint", 10),
      curiosity: scoreValue(hookScore, "curiosity", 10),
      conflict: scoreValue(hookScore, "conflict", 10),
      benefit: scoreValue(hookScore, "benefit", 10),
      emotion: scoreValue(hookScore, "emotion", 10),
      total: scoreValue(hookScore, "total", 50),
    },
    whyViral: requiredString(object, "whyViral"),
    structureBreakdownText: requiredString(object, "structureBreakdownText"),
    contentLayerPassed: requiredBoolean(object, "contentLayerPassed"),
    contentLayerMatched: stringArray(object.contentLayerMatched),
    structureLayerPassed: requiredBoolean(object, "structureLayerPassed"),
    structureLayerMissing: stringArray(object.structureLayerMissing),
    exclusionMatched: typeof object.exclusionMatched === "string"
      ? object.exclusionMatched.trim() || null
      : null,
    selfCheckPassed: requiredBoolean(object, "selfCheckPassed"),
    selfCheckReasoning: requiredString(object, "selfCheckReasoning"),
    worthLearning: worthLearning as HotAnalysisAIResponse["worthLearning"],
    worthLearningReason: requiredString(object, "worthLearningReason"),
    ipFitTier,
    ipFitReason: optionalString(object.ipFitReason),
    titleStructure: requiredString(object, "titleStructure"),
    openingHookType: requiredString(object, "openingHookType"),
    userNeedLayer: requiredString(object, "userNeedLayer"),
    sentenceStageTags: normalizeStageTags(object.sentenceStageTags),
    sentenceEmotionTags: normalizeEmotionTags(object.sentenceEmotionTags),
  };
}
