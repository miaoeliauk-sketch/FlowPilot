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
  methodCards: HotAnalysisMethodCard[];
}

export type HotAnalysisMethodCategory =
  | "定位方法库"
  | "选题方法库"
  | "标题方法库"
  | "开头方法库"
  | "文案框架方法库";

export interface HotAnalysisMethodCard {
  name: string;
  targetCategory: HotAnalysisMethodCategory;
  summary: string;
  evidenceQuote: string;
}

export interface HotAnalysisTitleAIResponse {
  titleStructure: "反差型" | "结果型" | "痛点型" | "悬念型" | "认知颠覆型";
  contentDirection: string[];
  titleAttraction: {
    score: number;
    reason: string;
  };
  topicPotential: {
    score: number;
    reason: string;
  };
  painPointClarity: {
    score: number;
    painPoint: string;
    reason: string;
  };
  ipFit: {
    tier: "高度匹配" | "中度匹配" | "低度匹配" | null;
    reason: string;
  };
  worthContinuing: {
    verdict: "值得补全" | "可以补全" | "不建议补全";
    reason: string;
  };
  titleDiagnosisGrade: "A" | "B" | "C";
  overallSummary: string;
}

const STAGES = ["Hook", "Problem", "Solution", "Case", "CTA", "none"] as const;
const WORTH_LEARNING = ["值得学习", "部分学习", "不建议学习"] as const;
const IP_FIT_TIERS = ["高度匹配", "中度匹配", "低度匹配"] as const;
const METHOD_CATEGORIES = [
  "定位方法库",
  "选题方法库",
  "标题方法库",
  "开头方法库",
  "文案框架方法库",
] as const;
const TITLE_STRUCTURES = [
  "反差型",
  "结果型",
  "痛点型",
  "悬念型",
  "认知颠覆型",
] as const;
const CONTINUE_VERDICTS = ["值得补全", "可以补全", "不建议补全"] as const;
const TITLE_GRADES = ["A", "B", "C"] as const;

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

function parseObjectContent(content: unknown): Record<string, unknown> {
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
  if (!object) {
    throw new HotAnalysisResponseError(
      "incomplete_fields",
      "分析结果字段不完整：root",
    );
  }
  return object;
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

function requiredObject(
  object: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const value = asObject(object[field]);
  if (!value) {
    throw new HotAnalysisResponseError(
      "incomplete_fields",
      `分析结果字段不完整：${field}`,
    );
  }
  return value;
}

function requiredEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new HotAnalysisResponseError(
      "incomplete_fields",
      `分析结果字段不完整：${field}`,
    );
  }
  return value as T;
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

function normalizeMethodCards(value: unknown): HotAnalysisMethodCard[] {
  if (!Array.isArray(value)) {
    throw new HotAnalysisResponseError(
      "incomplete_fields",
      "分析结果字段不完整：methodCards",
    );
  }

  return value.map((item, index) => {
    const card = asObject(item);
    if (!card) {
      throw new HotAnalysisResponseError(
        "incomplete_fields",
        `分析结果字段不完整：methodCards[${index}]`,
      );
    }
    return {
      name: requiredString(card, "name"),
      targetCategory: requiredEnum(
        card.targetCategory,
        METHOD_CATEGORIES,
        `methodCards[${index}].targetCategory`,
      ),
      summary: requiredString(card, "summary"),
      evidenceQuote: requiredString(card, "evidenceQuote"),
    };
  }).slice(0, 6);
}

export function parseHotAnalysisResponse(
  content: unknown,
): HotAnalysisAIResponse {
  const object = parseObjectContent(content);
  const hookScore = requiredObject(object, "hookScore");

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
    methodCards: normalizeMethodCards(object.methodCards),
  };
}

export function parseHotAnalysisTitleResponse(
  content: unknown,
): HotAnalysisTitleAIResponse {
  const object = parseObjectContent(content);
  const titleAttraction = requiredObject(object, "titleAttraction");
  const topicPotential = requiredObject(object, "topicPotential");
  const painPointClarity = requiredObject(object, "painPointClarity");
  const ipFit = requiredObject(object, "ipFit");
  const worthContinuing = requiredObject(object, "worthContinuing");
  const rawTier = ipFit.tier;
  const tier = rawTier === null
    ? null
    : requiredEnum(rawTier, IP_FIT_TIERS, "ipFit.tier");

  return {
    titleStructure: requiredEnum(
      object.titleStructure,
      TITLE_STRUCTURES,
      "titleStructure",
    ),
    contentDirection: stringArray(object.contentDirection),
    titleAttraction: {
      score: scoreValue(titleAttraction, "score", 10),
      reason: requiredString(titleAttraction, "reason"),
    },
    topicPotential: {
      score: scoreValue(topicPotential, "score", 10),
      reason: requiredString(topicPotential, "reason"),
    },
    painPointClarity: {
      score: scoreValue(painPointClarity, "score", 10),
      painPoint: requiredString(painPointClarity, "painPoint"),
      reason: requiredString(painPointClarity, "reason"),
    },
    ipFit: {
      tier,
      reason: optionalString(ipFit.reason),
    },
    worthContinuing: {
      verdict: requiredEnum(
        worthContinuing.verdict,
        CONTINUE_VERDICTS,
        "worthContinuing.verdict",
      ),
      reason: requiredString(worthContinuing, "reason"),
    },
    titleDiagnosisGrade: requiredEnum(
      object.titleDiagnosisGrade,
      TITLE_GRADES,
      "titleDiagnosisGrade",
    ),
    overallSummary: requiredString(object, "overallSummary"),
  };
}
