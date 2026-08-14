import { CONTENT_PURPOSES, type ContentPurpose } from "./content-purpose";
import {
  LIVE_CLIP_TYPES,
  LIVE_CLIP_STRUCTURE_ROLES,
  type ClipCandidate,
  type ClipDimensions,
  type ClipRating,
  type ClipRecommendation,
  type ClipType,
  type ClipStructureRole,
  type LiveClipFailureReason,
  type PurposeEvidence,
  type SourceRemovalSuggestion,
  type TopicBlock,
  type TranscriptChunk,
  type TranscriptParagraph,
} from "./live-clips-types";
import {
  deriveSourceLocation,
  extractCleanedClipText,
  extractClipText,
  verifySourceQuote,
} from "./live-clips-transcript";

export type LiveClipResponseErrorCode = "JSON_PARSE_FAIL" | "SCHEMA_FAIL";

export class LiveClipResponseError extends Error {
  readonly diagnosticCode: LiveClipResponseErrorCode;
  readonly diagnosticDetails: Record<string, unknown>;

  constructor(
    public readonly code: LiveClipResponseErrorCode,
    message: string,
    diagnosticDetails: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "LiveClipResponseError";
    this.diagnosticCode = code;
    this.diagnosticDetails = diagnosticDetails;
  }
}

type IdFactory = () => string;
type NowFactory = () => string;

interface TopicResponseContext {
  liveTranscriptId: string;
  chunk: TranscriptChunk;
  paragraphs: TranscriptParagraph[];
  createId?: IdFactory;
  now?: NowFactory;
}

interface CandidateResponseContext {
  liveTranscriptId: string;
  topic: TopicBlock;
  paragraphs: TranscriptParagraph[];
  createId?: IdFactory;
  now?: NowFactory;
}

function schemaFail(
  message: string,
  reasonCode: LiveClipFailureReason = "FIELD_INVALID",
  details: Record<string, unknown> = {},
): never {
  throw new LiveClipResponseError("SCHEMA_FAIL", message, { ...details, reasonCode });
}

function strictJSON(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed || trimmed.startsWith("```") || !trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new LiveClipResponseError("JSON_PARSE_FAIL", "AI返回内容不是纯JSON对象");
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new LiveClipResponseError("JSON_PARSE_FAIL", "AI返回内容不是有效JSON");
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) schemaFail(`${label}必须是对象`);
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) schemaFail(`${label}必须是数组`);
  return value;
}

function stringValue(value: unknown, label: string, maxLength = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    schemaFail(`${label}必须是非空字符串`);
  }
  return value.trim();
}

function integerValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) schemaFail(`${label}必须是正整数`);
  return value;
}

function stringArray(value: unknown, label: string, options: { min?: number; max?: number } = {}) {
  const array = arrayValue(value, label);
  const min = options.min ?? 0;
  const max = options.max ?? 20;
  if (array.length < min || array.length > max) schemaFail(`${label}数量必须在${min}到${max}之间`);
  return array.map((item, index) => stringValue(item, `${label}[${index}]`, 200));
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) schemaFail(`${label}不在允许范围内`);
  return value as T;
}

function parseRemoval(
  value: unknown,
  paragraphs: TranscriptParagraph[],
  allowedStart: number,
  allowedEnd: number,
  label: string,
): SourceRemovalSuggestion {
  const object = objectValue(value, label);
  const paragraphNumber = integerValue(object.paragraphNumber, `${label}.paragraphNumber`);
  const quote = stringValue(object.quote, `${label}.quote`, 500);
  const reason = stringValue(object.reason, `${label}.reason`, 300);
  if (paragraphNumber < allowedStart || paragraphNumber > allowedEnd) {
    schemaFail(`${label}超出允许段落范围`, "REMOVAL_QUOTE_NOT_FOUND");
  }
  if (!verifySourceQuote(paragraphs, paragraphNumber, quote)) {
    schemaFail(`${label}无法在原文中唯一定位`, "REMOVAL_QUOTE_NOT_FOUND");
  }
  return { paragraphNumber, quote, reason };
}

export function parseTopicAnalysisResponse(content: string, context: TopicResponseContext) {
  const root = objectValue(strictJSON(content), "根节点");
  const removalSuggestions = arrayValue(root.removalSuggestions, "removalSuggestions")
    .map((value, index) => parseRemoval(
      value,
      context.paragraphs,
      context.chunk.startParagraph,
      context.chunk.endParagraph,
      `removalSuggestions[${index}]`,
    ));
  const createId = context.createId ?? (() => crypto.randomUUID());
  const now = context.now ?? (() => new Date().toISOString());
  const topics = arrayValue(root.topics, "topics").map((value, index): TopicBlock | null => {
    const object = objectValue(value, `topics[${index}]`);
    if ("startTime" in object || "endTime" in object) schemaFail("AI不得返回主题时间字段");
    const startParagraph = integerValue(object.startParagraph, `topics[${index}].startParagraph`);
    const endParagraph = integerValue(object.endParagraph, `topics[${index}].endParagraph`);
    if (
      startParagraph > endParagraph
      || startParagraph < context.chunk.startParagraph
      || endParagraph > context.chunk.endParagraph
    ) {
      schemaFail(`topics[${index}]段落范围无效`);
    }
    const midpoint = Math.floor((startParagraph + endParagraph) / 2);
    if (midpoint < context.chunk.ownedStartParagraph || midpoint > context.chunk.ownedEndParagraph) return null;
    const location = deriveSourceLocation(context.paragraphs, startParagraph, endParagraph);
    return {
      id: createId(),
      liveTranscriptId: context.liveTranscriptId,
      title: stringValue(object.title, `topics[${index}].title`, 120),
      summary: stringValue(object.summary, `topics[${index}].summary`, 600),
      startTime: location.startTime,
      endTime: location.endTime,
      startParagraph,
      endParagraph,
      keywords: Array.from(new Set(stringArray(object.keywords, `topics[${index}].keywords`, { min: 1, max: 8 }))),
      mainPoint: stringValue(object.mainPoint, `topics[${index}].mainPoint`, 500),
      sourceChunkIds: [context.chunk.id],
      candidateStatus: "pending" as const,
      candidateError: null,
      candidateErrorReason: null,
      createdAt: now(),
    } satisfies TopicBlock;
  }).filter((topic): topic is TopicBlock => topic !== null);

  return { topics, removalSuggestions };
}

const RATINGS = ["强", "中", "弱"] as const satisfies readonly ClipRating[];
const RECOMMENDATIONS = ["强烈建议切", "可以考虑", "不建议"] as const satisfies readonly ClipRecommendation[];

function parseDimensions(value: unknown, label: string): ClipDimensions {
  const object = objectValue(value, label);
  return {
    completeness: enumValue(object.completeness, RATINGS, `${label}.completeness`),
    hookStrength: enumValue(object.hookStrength, RATINGS, `${label}.hookStrength`),
    pointClarity: enumValue(object.pointClarity, RATINGS, `${label}.pointClarity`),
    informationDensity: enumValue(object.informationDensity, RATINGS, `${label}.informationDensity`),
    tension: enumValue(object.tension, RATINGS, `${label}.tension`),
    ipFit: enumValue(object.ipFit, RATINGS, `${label}.ipFit`),
  };
}

function parsePurposeEvidence(
  value: unknown,
  paragraphs: TranscriptParagraph[],
  clip: {
    startParagraph: number;
    endParagraph: number;
    startQuote: string;
    endQuote: string;
  },
  label: string,
): PurposeEvidence {
  const object = objectValue(value, label);
  const paragraphNumber = integerValue(object.paragraphNumber, `${label}.paragraphNumber`);
  const quote = stringValue(object.quote, `${label}.quote`, 500);
  if (paragraphNumber < clip.startParagraph || paragraphNumber > clip.endParagraph) {
    schemaFail(`${label}超出切片段落范围`, "PURPOSE_EVIDENCE_NOT_FOUND");
  }
  if (!verifySourceQuote(paragraphs, paragraphNumber, quote)) {
    schemaFail(`${label}无法在原文中唯一定位`, "PURPOSE_EVIDENCE_NOT_FOUND");
  }
  const paragraph = paragraphs.find(item => item.paragraphNumber === paragraphNumber)!;
  const startIndex = paragraphNumber === clip.startParagraph
    ? paragraph.text.indexOf(clip.startQuote)
    : 0;
  const endIndex = paragraphNumber === clip.endParagraph
    ? paragraph.text.indexOf(clip.endQuote) + clip.endQuote.length
    : paragraph.text.length;
  const clippedParagraph = paragraph.text.slice(startIndex, endIndex);
  const evidenceIndex = clippedParagraph.indexOf(quote);
  if (evidenceIndex < 0 || clippedParagraph.indexOf(quote, evidenceIndex + quote.length) >= 0) {
    schemaFail(`${label}无法在切片原始稿中唯一定位`, "PURPOSE_EVIDENCE_NOT_FOUND");
  }
  return { paragraphNumber, quote };
}

const SPECIFIC_LIVE_TIME_PATTERNS = [
  /\d{1,2}月\d{1,2}[日号](?:[^，。！？]{0,8}(?:上午|下午|晚上|晚间|中午|凌晨)?\d{1,2}(?:[:：点时]\d{0,2})?)?/,
  /(?:今天|今日|明天|明晚|今晚|本周[一二三四五六日天]|周[一二三四五六日天])[^，。！？]{0,8}\d{1,2}(?:[:：点时]\d{0,2})?/,
  /(?:上午|下午|晚上|晚间|中午|凌晨)\s*\d{1,2}(?:[:：点时]\d{0,2})?/,
  /(?:[01]?\d|2[0-3])[:：][0-5]\d/,
  /\d{1,2}点(?:\d{1,2}分)?[^，。！？]{0,6}(?:开播|直播|开始)/,
];

const SPECIFIC_EVENT_ADDRESS_PATTERNS = [
  /(?:路|街|巷|大道|酒店|宾馆|大厦|中心|园区|商场|广场|写字楼)[^，。！？]{0,8}(?:\d+号|\d+楼|[一二三四五六七八九十]+楼|[A-Za-z]\d*座|[东西南北]门)/i,
  /\d+号[^，。！？]{0,8}(?:\d+楼|[一二三四五六七八九十]+楼|[A-Za-z]\d*座|[东西南北]门)?/i,
];

export function containsSpecificLiveScheduleOrAddress(value: string) {
  return [...SPECIFIC_LIVE_TIME_PATTERNS, ...SPECIFIC_EVENT_ADDRESS_PATTERNS]
    .some(pattern => pattern.test(value));
}

function safePackagingSuggestions(value: unknown, label: string, count: number) {
  const suggestions = stringArray(value, label, { min: count, max: count });
  if (suggestions.some(containsSpecificLiveScheduleOrAddress)) {
    schemaFail(`${label}不得包含具体直播时间或活动地址`);
  }
  return suggestions;
}

export function parseCandidateAnalysisResponse(content: string, context: CandidateResponseContext) {
  const root = objectValue(strictJSON(content), "根节点");
  const createId = context.createId ?? (() => crypto.randomUUID());
  const now = context.now ?? (() => new Date().toISOString());
  const candidates = arrayValue(root.candidates, "candidates").map((value, index) => {
    const object = objectValue(value, `candidates[${index}]`);
    if ("startTime" in object || "endTime" in object || "rawClipText" in object || "cleanedClipText" in object) {
      schemaFail("AI不得返回时间或切片正文");
    }
    const startParagraph = integerValue(object.startParagraph, `candidates[${index}].startParagraph`);
    const endParagraph = integerValue(object.endParagraph, `candidates[${index}].endParagraph`);
    if (
      startParagraph > endParagraph
      || startParagraph < context.topic.startParagraph
      || endParagraph > context.topic.endParagraph
    ) {
      schemaFail(`candidates[${index}]段落范围无效`);
    }
    const startQuote = stringValue(object.startQuote, `candidates[${index}].startQuote`, 500);
    const endQuote = stringValue(object.endQuote, `candidates[${index}].endQuote`, 500);
    const startParagraphSource = context.paragraphs.find(paragraph => paragraph.paragraphNumber === startParagraph);
    const endParagraphSource = context.paragraphs.find(paragraph => paragraph.paragraphNumber === endParagraph);
    if (!startParagraphSource || !verifySourceQuote(context.paragraphs, startParagraph, startQuote)) {
      schemaFail("建议开始句无法在原文中唯一定位", "START_QUOTE_NOT_FOUND");
    }
    if (!endParagraphSource || !verifySourceQuote(context.paragraphs, endParagraph, endQuote)) {
      schemaFail("建议结束句无法在原文中唯一定位", "END_QUOTE_NOT_FOUND");
    }
    const clipTextInput = { startParagraph, endParagraph, startQuote, endQuote };
    let rawClipText: string;
    try {
      rawClipText = extractClipText(context.paragraphs, clipTextInput);
    } catch (error) {
      schemaFail(error instanceof Error ? error.message : "切片原话无法追溯");
    }
    const removals = arrayValue(object.removeSuggestions, `candidates[${index}].removeSuggestions`)
      .map((removal, removalIndex) => parseRemoval(
        removal,
        context.paragraphs,
        startParagraph,
        endParagraph,
        `candidates[${index}].removeSuggestions[${removalIndex}]`,
      ));
    let cleanedClipText: string;
    try {
      cleanedClipText = extractCleanedClipText(context.paragraphs, clipTextInput, removals);
    } catch (error) {
      schemaFail(
        error instanceof Error ? error.message : "删除建议无法在切片原文中定位",
        "REMOVAL_QUOTE_NOT_FOUND",
      );
    }
    const location = deriveSourceLocation(context.paragraphs, startParagraph, endParagraph);
    const structureRole = enumValue(
      object.structureRole,
      LIVE_CLIP_STRUCTURE_ROLES,
      `candidates[${index}].structureRole`,
    ) as ClipStructureRole;
    const clipType = enumValue(object.clipType, LIVE_CLIP_TYPES, `candidates[${index}].clipType`);
    const secondaryTags = stringArray(object.secondaryTags, `candidates[${index}].secondaryTags`, { max: 2 })
      .map((tag, tagIndex) => enumValue(tag, LIVE_CLIP_TYPES, `candidates[${index}].secondaryTags[${tagIndex}]`));
    const primaryPurpose = enumValue(
      object.primaryPurpose,
      CONTENT_PURPOSES,
      `candidates[${index}].primaryPurpose`,
    ) as ContentPurpose;
    const primaryPurposeEvidence = parsePurposeEvidence(
      object.primaryPurposeEvidence,
      context.paragraphs,
      clipTextInput,
      `candidates[${index}].primaryPurposeEvidence`,
    );
    const secondaryPurpose = object.secondaryPurpose === null
      ? null
      : enumValue(object.secondaryPurpose, CONTENT_PURPOSES, `candidates[${index}].secondaryPurpose`) as ContentPurpose;
    const secondaryPurposeEvidence = object.secondaryPurposeEvidence === null
      ? null
      : parsePurposeEvidence(
        object.secondaryPurposeEvidence,
        context.paragraphs,
        clipTextInput,
        `candidates[${index}].secondaryPurposeEvidence`,
      );
    if ((secondaryPurpose === null) !== (secondaryPurposeEvidence === null)) {
      schemaFail(`candidates[${index}]辅助目的与证据必须同时为空或同时提供`);
    }
    if (secondaryPurpose === primaryPurpose) {
      schemaFail(`candidates[${index}]辅助目的不得与主要目的重复`);
    }

    return {
      id: createId(),
      liveTranscriptId: context.liveTranscriptId,
      topicBlockId: context.topic.id,
      topic: stringValue(object.topic, `candidates[${index}].topic`, 160),
      structureRole,
      clipType,
      secondaryTags: Array.from(new Set(secondaryTags)).filter(tag => tag !== clipType).slice(0, 2) as ClipType[],
      recommendation: enumValue(object.recommendation, RECOMMENDATIONS, `candidates[${index}].recommendation`),
      dimensions: parseDimensions(object.dimensions, `candidates[${index}].dimensions`),
      recommendReason: stringValue(object.recommendReason, `candidates[${index}].recommendReason`, 800),
      primaryPurpose,
      primaryPurposeEvidence,
      secondaryPurpose,
      secondaryPurposeEvidence,
      startTime: location.startTime,
      endTime: location.endTime,
      startParagraph,
      endParagraph,
      estimatedDurationSeconds: location.estimatedDurationSeconds,
      durationBasis: location.durationBasis,
      corePoint: stringValue(object.corePoint, `candidates[${index}].corePoint`, 500),
      startQuote,
      endQuote,
      rawClipText,
      cleanedClipText,
      removeSuggestions: removals.map(removal => {
        const removalLocation = deriveSourceLocation(
          context.paragraphs,
          removal.paragraphNumber,
          removal.paragraphNumber,
        );
        return {
          ...removal,
          startTime: removalLocation.startTime,
          endTime: removalLocation.endTime,
        };
      }),
      titleSuggestions: safePackagingSuggestions(object.titleSuggestions, `candidates[${index}].titleSuggestions`, 3),
      coverSuggestions: safePackagingSuggestions(object.coverSuggestions, `candidates[${index}].coverSuggestions`, 2),
      createdAt: now(),
    } satisfies ClipCandidate;
  });
  return { candidates };
}

function candidateRangeOverlap(left: ClipCandidate, right: ClipCandidate) {
  const intersection = Math.max(
    0,
    Math.min(left.endParagraph, right.endParagraph) - Math.max(left.startParagraph, right.startParagraph) + 1,
  );
  const shorter = Math.min(
    left.endParagraph - left.startParagraph + 1,
    right.endParagraph - right.startParagraph + 1,
  );
  return shorter > 0 ? intersection / shorter : 0;
}

const RECOMMENDATION_SCORE: Record<ClipRecommendation, number> = {
  "强烈建议切": 3,
  "可以考虑": 2,
  "不建议": 1,
};

export function dedupeClipCandidates(candidates: ClipCandidate[]) {
  const deduped: ClipCandidate[] = [];
  for (const candidate of candidates) {
    const duplicateIndex = deduped.findIndex(existing => (
      existing.liveTranscriptId === candidate.liveTranscriptId
      && (
        candidateRangeOverlap(existing, candidate) >= 0.8
        || (
          existing.startTime !== null
          && existing.endTime !== null
          && existing.startTime === candidate.startTime
          && existing.endTime === candidate.endTime
        )
      )
    ));
    if (duplicateIndex < 0) {
      deduped.push(candidate);
      continue;
    }
    if (RECOMMENDATION_SCORE[candidate.recommendation] > RECOMMENDATION_SCORE[deduped[duplicateIndex].recommendation]) {
      deduped[duplicateIndex] = candidate;
    }
  }
  return deduped;
}
