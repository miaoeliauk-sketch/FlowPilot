import type { IPStyleProfile } from "./types";

const ARRAY_FIELDS = [
  "openingHabits",
  "emotionalTone",
  "commonPhrases",
  "closingHabits",
  "forbiddenExpressions",
  "sourceSampleIds",
  "sourceSampleTitles",
] as const;

const STRING_FIELDS = [
  "ipId",
  "viewpointStyle",
  "styleSummary",
  "extractedAt",
  "model",
] as const;

const SENTENCE_LENGTHS: IPStyleProfile["sentenceLength"][] = [
  "短句为主",
  "中句为主",
  "长句为主",
  "长短句结合",
];

export type IPStyleProfileValidationResult =
  | { ok: true; styleProfile: IPStyleProfile | null }
  | {
      ok: false;
      error: string;
      errorCode: "invalid_style_profile" | "style_profile_ip_mismatch";
      errorField: string;
    };

function getStructureError(value: unknown): { field: string; message: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { field: "styleProfile", message: "styleProfile必须是对象" };
  }

  const profile = value as Record<string, unknown>;
  for (const field of ARRAY_FIELDS) {
    const fieldValue = profile[field];
    if (
      !Array.isArray(fieldValue) ||
      !fieldValue.every(item => typeof item === "string")
    ) {
      return { field, message: `${field}必须是字符串数组` };
    }
  }

  for (const field of STRING_FIELDS) {
    if (typeof profile[field] !== "string" || !profile[field].trim()) {
      return { field, message: `${field}必须是非空字符串` };
    }
  }

  if (
    !SENTENCE_LENGTHS.includes(
      profile.sentenceLength as IPStyleProfile["sentenceLength"],
    )
  ) {
    return {
      field: "sentenceLength",
      message: "sentenceLength不是支持的句子长度类型",
    };
  }
  return null;
}

export function parseIPStyleProfileForIP(
  value: unknown,
  ipId: string,
): IPStyleProfileValidationResult {
  if (value === null || value === undefined) {
    return { ok: true, styleProfile: null };
  }

  const structureError = getStructureError(value);
  if (structureError) {
    return {
      ok: false,
      error: `风格画像字段不合法：${structureError.message}`,
      errorCode: "invalid_style_profile",
      errorField: structureError.field,
    };
  }

  const styleProfile = value as IPStyleProfile;
  if (styleProfile.ipId !== ipId) {
    return {
      ok: false,
      error: "风格画像与当前IP不匹配，请重新选择当前操盘IP",
      errorCode: "style_profile_ip_mismatch",
      errorField: "ipId",
    };
  }

  return { ok: true, styleProfile };
}
