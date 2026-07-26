export type CopyOptimizationParseErrorCode =
  | "empty_content"
  | "invalid_json"
  | "missing_required_field"
  | "invalid_field_type";

export class CopyOptimizationResponseError extends Error {
  readonly code: CopyOptimizationParseErrorCode;

  constructor(
    code: CopyOptimizationParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CopyOptimizationResponseError";
    this.code = code;
  }
}

export interface ParsedLockedItemCheck {
  item: string;
  label: string;
  preserved: boolean;
  howPreserved: string;
}

export interface ParsedOptimizationSegment {
  original: string;
  rewritten: string;
  reason: string;
  changeType: string[];
}

export interface ParsedCopyOptimizationResponse {
  lockedItemsCheck: ParsedLockedItemCheck[];
  segments: ParsedOptimizationSegment[];
  rewrittenFullText: string;
  deviationScore: number;
  deviationReason: string;
  styleMatchScore: number;
  ipStyleExplanation: string;
  goalImpact: {
    direction: "更有利" | "中性" | "有风险";
    reasoning: string;
  };
}

function extractFirstCompleteJSONObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Record<string, unknown>,
  field: string,
): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new CopyOptimizationResponseError(
      "invalid_field_type",
      `分析结果字段不完整：${field}应为文字`,
    );
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new CopyOptimizationResponseError(
      "missing_required_field",
      `分析结果字段不完整：缺少${field}`,
    );
  }
  return trimmed;
}

function optionalString(
  record: Record<string, unknown>,
  field: string,
): string {
  const value = record[field];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new CopyOptimizationResponseError(
      "invalid_field_type",
      `分析结果字段不完整：${field}应为文字`,
    );
  }
  return value.trim();
}

function score(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CopyOptimizationResponseError(
      "invalid_field_type",
      `分析结果字段不完整：${field}应为数字`,
    );
  }
  if (value < 0 || value > 100) {
    throw new CopyOptimizationResponseError(
      "invalid_field_type",
      `分析结果字段不完整：${field}应在0到100之间`,
    );
  }
  return value;
}

function parseLockedItems(record: Record<string, unknown>): ParsedLockedItemCheck[] {
  const value = record.lockedItemsCheck;
  if (!Array.isArray(value)) {
    throw new CopyOptimizationResponseError(
      "invalid_field_type",
      "分析结果字段不完整：lockedItemsCheck应为数组",
    );
  }
  if (value.length !== 4) {
    throw new CopyOptimizationResponseError(
      "missing_required_field",
      "分析结果字段不完整：lockedItemsCheck必须包含4项",
    );
  }

  const expectedItems = ["viewpoint", "cases", "logic", "conclusion"];
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new CopyOptimizationResponseError(
        "invalid_field_type",
        `分析结果字段不完整：lockedItemsCheck[${index}]应为对象`,
      );
    }
    const itemName = requiredString(item, "item");
    if (itemName !== expectedItems[index]) {
      throw new CopyOptimizationResponseError(
        "missing_required_field",
        `分析结果字段不完整：lockedItemsCheck[${index}]应为${expectedItems[index]}`,
      );
    }
    if (typeof item.preserved !== "boolean") {
      throw new CopyOptimizationResponseError(
        "invalid_field_type",
        `分析结果字段不完整：lockedItemsCheck[${index}].preserved应为布尔值`,
      );
    }
    return {
      item: itemName,
      label: requiredString(item, "label"),
      preserved: item.preserved,
      howPreserved: requiredString(item, "howPreserved"),
    };
  });
}

function parseSegments(record: Record<string, unknown>): ParsedOptimizationSegment[] {
  const value = record.segments;
  if (!Array.isArray(value)) {
    throw new CopyOptimizationResponseError(
      "invalid_field_type",
      "分析结果字段不完整：segments应为数组",
    );
  }
  if (value.length === 0) {
    throw new CopyOptimizationResponseError(
      "missing_required_field",
      "分析结果字段不完整：segments不能为空",
    );
  }

  return value.map((segment, index) => {
    if (!isRecord(segment)) {
      throw new CopyOptimizationResponseError(
        "invalid_field_type",
        `分析结果字段不完整：segments[${index}]应为对象`,
      );
    }

    const rawChangeType = segment.changeType;
    const changeType = typeof rawChangeType === "string"
      ? [rawChangeType.trim()].filter(Boolean)
      : Array.isArray(rawChangeType) && rawChangeType.every((item) => typeof item === "string")
        ? rawChangeType.map((item) => item.trim()).filter(Boolean)
        : rawChangeType === undefined || rawChangeType === null
          ? []
          : null;
    if (changeType === null) {
      throw new CopyOptimizationResponseError(
        "invalid_field_type",
        `分析结果字段不完整：segments[${index}].changeType应为文字数组`,
      );
    }

    return {
      original: requiredString(segment, "original"),
      rewritten: requiredString(segment, "rewritten"),
      reason: optionalString(segment, "reason"),
      changeType,
    };
  });
}

function parseGoalImpact(
  record: Record<string, unknown>,
): ParsedCopyOptimizationResponse["goalImpact"] {
  const value = record.goalImpact;
  if (!isRecord(value)) {
    throw new CopyOptimizationResponseError(
      "invalid_field_type",
      "分析结果字段不完整：goalImpact应为对象",
    );
  }
  const direction = requiredString(value, "direction");
  if (direction !== "更有利" && direction !== "中性" && direction !== "有风险") {
    throw new CopyOptimizationResponseError(
      "invalid_field_type",
      "分析结果字段不完整：goalImpact.direction不在允许范围内",
    );
  }
  return {
    direction,
    reasoning: requiredString(value, "reasoning"),
  };
}

export function parseCopyOptimizationResponse(
  responseText: string,
): ParsedCopyOptimizationResponse {
  if (typeof responseText !== "string" || !responseText.trim()) {
    throw new CopyOptimizationResponseError(
      "empty_content",
      "AI未返回有效内容",
    );
  }

  const clean = responseText
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const jsonText = extractFirstCompleteJSONObject(clean);
  if (!jsonText) {
    throw new CopyOptimizationResponseError(
      "invalid_json",
      "AI返回格式异常：没有找到完整JSON对象",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new CopyOptimizationResponseError(
      "invalid_json",
      "AI返回格式异常：JSON解析失败",
    );
  }
  if (!isRecord(parsed)) {
    throw new CopyOptimizationResponseError(
      "invalid_field_type",
      "分析结果字段不完整：最外层应为JSON对象",
    );
  }

  return {
    lockedItemsCheck: parseLockedItems(parsed),
    segments: parseSegments(parsed),
    rewrittenFullText: requiredString(parsed, "rewrittenFullText"),
    deviationScore: score(parsed, "deviationScore"),
    deviationReason: optionalString(parsed, "deviationReason"),
    styleMatchScore: score(parsed, "styleMatchScore"),
    ipStyleExplanation: optionalString(parsed, "ipStyleExplanation"),
    goalImpact: parseGoalImpact(parsed),
  };
}
