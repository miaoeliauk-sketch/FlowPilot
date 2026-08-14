import type { IPStyleProfile } from "./types";

export type VoiceStyleAnalysis = Pick<IPStyleProfile,
  | "openingHabits"
  | "viewpointStyle"
  | "sentenceLength"
  | "emotionalTone"
  | "commonPhrases"
  | "closingHabits"
  | "forbiddenExpressions"
  | "styleSummary">;

export type VoiceStyleParseFailureCode =
  | "INVALID_JSON"
  | "INVALID_ROOT"
  | "MISSING_FIELD"
  | "INVALID_FIELD_TYPE"
  | "EMPTY_FIELD"
  | "INVALID_FIELD_VALUE"
  | "UNEXPECTED_FIELD"
  | "ARRAY_OUT_OF_RANGE";

export class VoiceStyleParseError extends Error {
  readonly diagnosticCode: VoiceStyleParseFailureCode;
  readonly diagnosticDetails: { fieldCount?: number; itemCount?: number; itemIndex?: number };

  constructor(
    diagnosticCode: VoiceStyleParseFailureCode,
    diagnosticDetails: { fieldCount?: number; itemCount?: number; itemIndex?: number } = {},
  ) {
    super("AI返回的风格画像结构不完整");
    this.name = "VoiceStyleParseError";
    this.diagnosticCode = diagnosticCode;
    this.diagnosticDetails = diagnosticDetails;
  }
}

const REQUIRED_FIELDS = [
  "openingHabits",
  "viewpointStyle",
  "sentenceLength",
  "emotionalTone",
  "commonPhrases",
  "closingHabits",
  "forbiddenExpressions",
  "styleSummary",
] as const;

const SENTENCE_LENGTHS: IPStyleProfile["sentenceLength"][] = [
  "短句为主",
  "中句为主",
  "长句为主",
  "长短句结合",
];

function parseRoot(content: string): Record<string, unknown> {
  const clean = content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  let value: unknown;
  try {
    value = JSON.parse(clean);
  } catch {
    throw new VoiceStyleParseError("INVALID_JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VoiceStyleParseError("INVALID_ROOT");
  }
  return value as Record<string, unknown>;
}

function requireString(
  root: Record<string, unknown>,
  field: string,
  maxLength: number,
): string {
  const value = root[field];
  if (typeof value !== "string") throw new VoiceStyleParseError("INVALID_FIELD_TYPE");
  const clean = value.trim();
  if (!clean) throw new VoiceStyleParseError("EMPTY_FIELD");
  if (clean.length > maxLength) throw new VoiceStyleParseError("INVALID_FIELD_VALUE");
  return clean;
}

function requireStringArray(
  root: Record<string, unknown>,
  field: string,
  minItems: number,
  maxItems: number,
  maxItemLength: number,
): string[] {
  const value = root[field];
  if (!Array.isArray(value)) throw new VoiceStyleParseError("INVALID_FIELD_TYPE");
  if (value.length < minItems || value.length > maxItems) {
    throw new VoiceStyleParseError("ARRAY_OUT_OF_RANGE", { itemCount: value.length });
  }
  return value.map((item, itemIndex) => {
    if (typeof item !== "string") {
      throw new VoiceStyleParseError("INVALID_FIELD_TYPE", { itemIndex });
    }
    const clean = item.trim();
    if (!clean) throw new VoiceStyleParseError("EMPTY_FIELD", { itemIndex });
    if (clean.length > maxItemLength) {
      throw new VoiceStyleParseError("INVALID_FIELD_VALUE", { itemIndex });
    }
    return clean;
  });
}

export function parseVoiceStyleResponse(content: string): VoiceStyleAnalysis {
  const root = parseRoot(content);
  const fieldCount = Object.keys(root).length;
  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(root, field)) {
      throw new VoiceStyleParseError("MISSING_FIELD", { fieldCount });
    }
  }
  if (fieldCount !== REQUIRED_FIELDS.length) {
    throw new VoiceStyleParseError("UNEXPECTED_FIELD", { fieldCount });
  }

  const sentenceLength = requireString(root, "sentenceLength", 20);
  if (!SENTENCE_LENGTHS.includes(sentenceLength as IPStyleProfile["sentenceLength"])) {
    throw new VoiceStyleParseError("INVALID_FIELD_VALUE");
  }

  return {
    openingHabits: requireStringArray(root, "openingHabits", 3, 5, 200),
    viewpointStyle: requireString(root, "viewpointStyle", 600),
    sentenceLength: sentenceLength as IPStyleProfile["sentenceLength"],
    emotionalTone: requireStringArray(root, "emotionalTone", 2, 4, 60),
    commonPhrases: requireStringArray(root, "commonPhrases", 5, 10, 100),
    closingHabits: requireStringArray(root, "closingHabits", 3, 5, 200),
    forbiddenExpressions: requireStringArray(root, "forbiddenExpressions", 3, 6, 200),
    styleSummary: requireString(root, "styleSummary", 1500),
  };
}

function requireResponseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length === value.length ? strings : null;
}

export function buildVoiceStyleProfileForSave(
  response: unknown,
  ipId: string,
): IPStyleProfile | null {
  if (!response || typeof response !== "object" || Array.isArray(response)) return null;
  const root = response as Record<string, unknown>;
  let analysis: VoiceStyleAnalysis;
  try {
    const analysisFields = Object.fromEntries(
      REQUIRED_FIELDS.map((field) => [field, root[field]]),
    );
    analysis = parseVoiceStyleResponse(JSON.stringify(analysisFields));
  } catch {
    return null;
  }

  const sourceSampleIds = requireResponseStringArray(root.sourceSampleIds);
  const sourceSampleTitles = requireResponseStringArray(root.sourceSampleTitles);
  if (
    !sourceSampleIds
    || !sourceSampleTitles
    || sourceSampleIds.length !== sourceSampleTitles.length
    || typeof root.extractedAt !== "string"
    || !root.extractedAt.trim()
    || typeof root.model !== "string"
    || !root.model.trim()
  ) {
    return null;
  }

  return {
    ipId,
    ...analysis,
    sourceSampleIds,
    sourceSampleTitles,
    extractedAt: root.extractedAt,
    model: root.model,
  };
}

export function getDefaultVoiceStyleSampleIds(
  samples: Array<{ id: string }>,
): string[] {
  return samples.slice(0, 5).map((sample) => sample.id);
}
