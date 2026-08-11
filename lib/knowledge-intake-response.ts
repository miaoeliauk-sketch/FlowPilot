export const IP_UNDERSTANDING_CATEGORIES = [
  "IP人设资料",
  "IP表达语料",
  "IP历史内容",
  "IP高表现内容",
  "IP受众反馈",
  "IP禁用规则",
] as const;

export type IPUnderstandingCategory = typeof IP_UNDERSTANDING_CATEGORIES[number];
export type IntakeConfidence = "高" | "中" | "低";
export type IntakeRecommendation = "建议入库" | "待确认" | "不建议入库";

export interface IPUnderstandingItem {
  title: string;
  summary: string;
  category: IPUnderstandingCategory;
  understanding: string;
  keyPoints: string[];
  relationToIP: string;
  keywords: string[];
  confidence: IntakeConfidence;
  confidenceReason: string;
  ingestRecommend: IntakeRecommendation;
  ingestReason: string;
}

export interface IPUnderstandingResponse {
  item: IPUnderstandingItem;
}

interface DiagnosticError extends Error {
  diagnosticCode: string;
  diagnosticDetails: Record<string, number>;
}

function validationError(code: string, message: string): DiagnosticError {
  return Object.assign(new Error(message), {
    diagnosticCode: code,
    diagnosticDetails: {},
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(
  record: Record<string, unknown>,
  field: string,
  maxLength: number,
): string {
  const value = typeof record[field] === "string" ? record[field].trim() : "";
  if (!value) throw validationError("FIELD_MISSING", `AI理解结果缺少${field}`);
  return value.slice(0, maxLength);
}

function requiredStringArray(
  record: Record<string, unknown>,
  field: string,
  maxItems: number,
): string[] {
  if (!Array.isArray(record[field])) {
    throw validationError("FIELD_TYPE_INVALID", `AI理解结果中的${field}格式错误`);
  }
  const values = record[field]
    .filter((value): value is string => typeof value === "string")
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, maxItems);
  if (values.length === 0) {
    throw validationError("FIELD_MISSING", `AI理解结果缺少${field}`);
  }
  return values;
}

export function parseIPUnderstandingResponse(content: string): IPUnderstandingResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw validationError("INVALID_JSON", "AI返回的内容理解结果不是完整JSON");
  }
  const root = asRecord(parsed);
  const item = root ? asRecord(root.item) : null;
  if (!item) {
    throw validationError("ITEM_MISSING", "AI返回缺少单条内容理解结果");
  }

  const forbiddenFields = [
    "coreMethod",
    "applicableScenarios",
    "triggerKeywords",
    "similarPhrases",
    "aiUsage",
    "examples",
    "unsuitableCases",
  ];
  if (forbiddenFields.some(field => field in item)) {
    throw validationError("DECOMPOSITION_NOT_ALLOWED", "IP知识只能理解原文，不能拆解成方法卡");
  }

  const rawCategory = item.category;
  if (
    typeof rawCategory !== "string" ||
    !IP_UNDERSTANDING_CATEGORIES.includes(rawCategory as IPUnderstandingCategory)
  ) {
    throw validationError("INVALID_CATEGORY", "AI返回的IP知识分类无效");
  }
  const category = rawCategory as IPUnderstandingCategory;
  const confidence = item.confidence;
  if (confidence !== "高" && confidence !== "中" && confidence !== "低") {
    throw validationError("INVALID_CONFIDENCE", "AI返回的理解置信度无效");
  }
  const ingestRecommend = item.ingestRecommend;
  if (
    ingestRecommend !== "建议入库" &&
    ingestRecommend !== "待确认" &&
    ingestRecommend !== "不建议入库"
  ) {
    throw validationError("INVALID_RECOMMENDATION", "AI返回的入库建议无效");
  }

  return {
    item: {
      title: requiredString(item, "title", 40),
      summary: requiredString(item, "summary", 300),
      category,
      understanding: requiredString(item, "understanding", 2000),
      keyPoints: requiredStringArray(item, "keyPoints", 8),
      relationToIP: requiredString(item, "relationToIP", 500),
      keywords: requiredStringArray(item, "keywords", 8),
      confidence,
      confidenceReason: requiredString(item, "confidenceReason", 300),
      ingestRecommend,
      ingestReason: requiredString(item, "ingestReason", 300),
    },
  };
}
