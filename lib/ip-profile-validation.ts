import type { IPProfile } from "./types";
import { isScriptDirectorProfileId } from "./script-director-profile";

export type IPProfileValidationResult =
  | { ok: true; ipProfile: IPProfile }
  | {
      ok: false;
      error: string;
      errorCode: "MISSING_IP_PROFILE" | "INVALID_IP_PROFILE";
      errorField: string;
    };

const STRING_FIELDS = [
  "avatar",
  "positioning",
  "audience",
  "professionalIdentity",
  "credibilitySource",
  "tone",
  "pacing",
  "styleNotes",
  "bio",
  "color",
  "createdAt",
  "updatedAt",
] as const satisfies ReadonlyArray<keyof IPProfile>;

const STRING_ARRAY_FIELDS = [
  "platforms",
  "contentDirection",
  "personaKeywords",
  "personalityTags",
  "representativeViewpoints",
  "commonOpenings",
  "commonClosings",
  "catchphrases",
  "forbiddenExpressions",
  "commonScenes",
  "commonShotTypes",
  "sampleViralTitles",
] as const satisfies ReadonlyArray<keyof IPProfile>;

const BOOLEAN_FIELDS = [
  "showsFace",
  "usesScreenRecording",
  "needsBroll",
  "needsCaseScreenshots",
  "needsSubtitleHighlight",
] as const satisfies ReadonlyArray<keyof IPProfile>;

function invalid(errorField: string): IPProfileValidationResult {
  return {
    ok: false,
    error: `当前IP档案字段“${errorField.replace("ipProfile.", "")}”格式不正确`,
    errorCode: "INVALID_IP_PROFILE",
    errorField,
  };
}

export function parseRequiredIPProfile(value: unknown): IPProfileValidationResult {
  if (value === null || value === undefined) {
    return {
      ok: false,
      error: "请先选择当前操盘IP后再生成内容",
      errorCode: "MISSING_IP_PROFILE",
      errorField: "ipProfile",
    };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return invalid("ipProfile");
  }

  const profile = value as Record<string, unknown>;
  if (typeof profile.id !== "string" || !profile.id.trim()) {
    return {
      ok: false,
      error: "当前操盘IP缺少有效ID",
      errorCode: "MISSING_IP_PROFILE",
      errorField: "ipProfile.id",
    };
  }
  if (typeof profile.name !== "string" || !profile.name.trim()) {
    return {
      ok: false,
      error: "当前操盘IP缺少有效名称",
      errorCode: "MISSING_IP_PROFILE",
      errorField: "ipProfile.name",
    };
  }

  for (const field of STRING_FIELDS) {
    if (typeof profile[field] !== "string") return invalid(`ipProfile.${field}`);
  }
  for (const field of STRING_ARRAY_FIELDS) {
    const fieldValue = profile[field];
    if (!Array.isArray(fieldValue) || !fieldValue.every(item => typeof item === "string")) {
      return invalid(`ipProfile.${field}`);
    }
  }
  for (const field of BOOLEAN_FIELDS) {
    if (typeof profile[field] !== "boolean") return invalid(`ipProfile.${field}`);
  }
  if (
    profile.scriptDirectorProfileId !== undefined &&
    profile.scriptDirectorProfileId !== null &&
    !isScriptDirectorProfileId(profile.scriptDirectorProfileId)
  ) {
    return invalid("ipProfile.scriptDirectorProfileId");
  }

  return { ok: true, ipProfile: value as IPProfile };
}
