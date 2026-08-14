import { LiveClipResponseError } from "./live-clips-response";
import {
  contractEnum,
  contractObject,
  contractString,
  strictJsonObject,
} from "./live-clips-json-contract";
import {
  completeVideoSectionsError,
  isCompleteVideoSupplementalKind,
  isSupplementalKindAllowedForRole,
  supplementalSuggestion,
} from "./live-clips-complete-plan-contract";
import {
  COMPLETE_VIDEO_SECTION_ROLES,
  type ClipRemovalSuggestion,
  type CompleteVideoPlan,
  type CompleteVideoPlanSection,
  type CompleteVideoSectionRole,
  type CompleteVideoSectionSource,
  type TranscriptParagraph,
} from "./live-clips-types";
import {
  deriveSourceLocation,
  extractCleanedClipText,
  extractClipText,
} from "./live-clips-transcript";

export interface CompletePlanSourceCandidate {
  id: string;
  liveTranscriptId: string;
  startParagraph: number;
  endParagraph: number;
  removeSuggestions: ClipRemovalSuggestion[];
}

interface CompletePlanResponseContext {
  liveTranscriptId: string;
  coreCandidateId: string;
  candidates: CompletePlanSourceCandidate[];
  paragraphs: TranscriptParagraph[];
  createId?: () => string;
  now?: () => string;
}

function fail(message: string, reasonCode = "FIELD_INVALID"): never {
  throw new LiveClipResponseError("SCHEMA_FAIL", message, { reasonCode });
}

function strictJSON(content: string): unknown {
  return strictJsonObject(content, message => { throw new LiveClipResponseError("JSON_PARSE_FAIL", message); });
}

function record(value: unknown, label: string): Record<string, unknown> {
  return contractObject(value, label, message => fail(message));
}

function stringValue(value: unknown, label: string, max = 1000) {
  return contractString(value, label, max, message => fail(message));
}

function nullableString(value: unknown, label: string, max = 1000) {
  return value === null ? null : stringValue(value, label, max);
}

function nullableInteger(value: unknown, label: string) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) fail(`${label}必须是正整数或null`);
  return value;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  return contractEnum(value, allowed, label, message => fail(message));
}

function parseSourceSection(
  object: Record<string, unknown>,
  role: CompleteVideoSectionRole,
  context: CompletePlanResponseContext,
  candidatesById: Map<string, CompletePlanSourceCandidate>,
): CompleteVideoPlanSection {
  const candidateId = object.candidateId === null || object.candidateId === undefined
    ? null
    : stringValue(object.candidateId, `${role}.candidateId`, 160);
  const candidate = candidateId ? candidatesById.get(candidateId) : null;
  if (candidateId && (!candidate || candidate.liveTranscriptId !== context.liveTranscriptId)) fail(`${role}引用的候选不存在或归属不匹配`);
  if (role === "body" && candidateId !== context.coreCandidateId) fail("主体必须来自当前核心候选");
  const startParagraph = nullableInteger(object.startParagraph, `${role}.startParagraph`);
  const endParagraph = nullableInteger(object.endParagraph, `${role}.endParagraph`);
  if (startParagraph === null || endParagraph === null || endParagraph < startParagraph) fail(`${role}段落范围无效`);
  if (candidate && (startParagraph < candidate.startParagraph || endParagraph > candidate.endParagraph)) {
    fail(`${role}超出所引用候选的原文范围`);
  }
  const startQuote = nullableString(object.startQuote, `${role}.startQuote`, 500);
  const endQuote = nullableString(object.endQuote, `${role}.endQuote`, 500);
  if (!startQuote || !endQuote) fail(`${role}缺少原文开始句或结束句`);
  if (object.supplementalSuggestion !== null && object.supplementalSuggestion !== undefined) fail(`${role}原片段落不得夹带补录内容`);
  if (object.supplementalKind !== null && object.supplementalKind !== undefined) fail(`${role}原片段落不得带补录类型`);
  const input = { startParagraph, endParagraph, startQuote, endQuote };
  let rawText: string;
  let cleanedText: string;
  try {
    rawText = extractClipText(context.paragraphs, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "原话无法定位";
    fail(message, message.includes("开始句") ? "START_QUOTE_NOT_FOUND" : "END_QUOTE_NOT_FOUND");
  }
  const removals = (candidate?.removeSuggestions ?? []).filter(item => (
    item.paragraphNumber >= startParagraph
    && item.paragraphNumber <= endParagraph
    && rawText.includes(item.quote)
  ));
  try {
    cleanedText = extractCleanedClipText(context.paragraphs, input, removals);
  } catch (error) {
    fail(error instanceof Error ? error.message : "删除片段无法定位", "REMOVAL_QUOTE_NOT_FOUND");
  }
  const location = deriveSourceLocation(context.paragraphs, startParagraph, endParagraph);
  return {
    role,
    sourceType: "transcript",
    candidateId,
    startTime: location.startTime,
    endTime: location.endTime,
    startParagraph,
    endParagraph,
    rawText,
    cleanedText,
    supplementalKind: null,
    supplementalSuggestion: null,
    transitionNote: stringValue(object.transitionNote, `${role}.transitionNote`, 500),
  };
}

function parseSupplementalSection(
  object: Record<string, unknown>,
  role: CompleteVideoSectionRole,
): CompleteVideoPlanSection {
  if (role !== "opening" && role !== "ending") fail("只有开头或结尾缺失时可以提供补录建议");
  const sourceClaims = [
    object.candidateId,
    object.startParagraph,
    object.endParagraph,
    object.startQuote,
    object.endQuote,
  ];
  if (sourceClaims.some(value => value !== null && value !== undefined)) {
    fail(`${role}补录建议不得伪造原文位置`);
  }
  if (object.supplementalSuggestion !== null && object.supplementalSuggestion !== undefined) {
    fail("补录内容只能由程序固定生成，AI不得自由编写");
  }
  if (!isCompleteVideoSupplementalKind(object.supplementalKind)) fail(`${role}补录类型无效`);
  const kind = object.supplementalKind;
  if (!isSupplementalKindAllowedForRole(role, kind)) fail(`${role}补录类型无效`);
  return {
    role,
    sourceType: "supplemental",
    candidateId: null,
    startTime: null,
    endTime: null,
    startParagraph: null,
    endParagraph: null,
    rawText: null,
    cleanedText: null,
    supplementalKind: kind,
    supplementalSuggestion: supplementalSuggestion(kind),
    transitionNote: stringValue(object.transitionNote, `${role}.transitionNote`, 500),
  };
}

export function parseCompleteVideoPlanResponse(content: string, context: CompletePlanResponseContext) {
  const root = record(strictJSON(content), "返回结果");
  if (!Array.isArray(root.plans) || root.plans.length < 1 || root.plans.length > 3) fail("plans数量必须在1到3之间");
  const candidatesById = new Map(context.candidates.map(candidate => [candidate.id, candidate]));
  if (candidatesById.size !== context.candidates.length || !candidatesById.has(context.coreCandidateId)) {
    fail("候选编号重复或核心候选不存在");
  }
  const createId = context.createId ?? (() => crypto.randomUUID());
  const now = context.now ?? (() => new Date().toISOString());
  const plans = root.plans.map((value, planIndex): CompleteVideoPlan => {
    const object = record(value, `plans[${planIndex}]`);
    if (!Array.isArray(object.sections) || object.sections.length < 3 || object.sections.length > 5) {
      fail(`plans[${planIndex}].sections数量必须在3到5之间`);
    }
    const sections = object.sections.map((sectionValue, sectionIndex) => {
      const section = record(sectionValue, `plans[${planIndex}].sections[${sectionIndex}]`);
      const role = enumValue(section.role, COMPLETE_VIDEO_SECTION_ROLES, `sections[${sectionIndex}].role`);
      const sourceType = enumValue(section.sourceType, ["transcript", "supplemental"] as const, `sections[${sectionIndex}].sourceType`) as CompleteVideoSectionSource;
      return sourceType === "transcript"
        ? parseSourceSection(section, role, context, candidatesById)
        : parseSupplementalSection(section, role);
    });
    const sectionsError = completeVideoSectionsError(sections);
    if (sectionsError) fail(sectionsError);
    const sourceLocations = sections.filter(section => section.sourceType === "transcript").map(section => (
      deriveSourceLocation(context.paragraphs, section.startParagraph!, section.endParagraph!)
    ));
    return {
      id: createId(),
      liveTranscriptId: context.liveTranscriptId,
      coreCandidateId: context.coreCandidateId,
      title: stringValue(object.title, `plans[${planIndex}].title`, 160),
      recommendReason: stringValue(object.recommendReason, `plans[${planIndex}].recommendReason`, 800),
      sections,
      editingNotes: Array.isArray(object.editingNotes)
        ? object.editingNotes.map((note, index) => stringValue(note, `editingNotes[${index}]`, 300)).slice(0, 5)
        : fail(`plans[${planIndex}].editingNotes必须是数组`),
      sourceDurationSeconds: sourceLocations.reduce((sum, location) => sum + location.estimatedDurationSeconds, 0),
      durationBasis: sourceLocations.every(location => location.durationBasis === "actual") && sections.every(section => section.sourceType === "transcript")
        ? "actual"
        : "text-estimate",
      createdAt: now(),
    };
  });
  return { plans };
}
