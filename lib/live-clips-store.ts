import { CONTENT_PURPOSES, type ContentPurpose } from "./content-purpose";
import {
  LIVE_CLIP_STORAGE_KEY,
  LIVE_CLIP_TYPES,
  COMPLETE_VIDEO_SECTION_ROLES,
  isClipStructureRole,
  isLiveClipFailureReason,
  type ClipCandidate,
  type CompleteVideoPlan,
  type ClipPlan,
  type LiveClipWorkspaceState,
  type PurposeEvidence,
  type LiveClipFailureReason,
  type ClipStructureRole,
  type ClipType,
} from "./live-clips-types";

export type LiveClipStorageErrorCode = "WRITE_FAILED" | "VERIFY_FAILED" | "CORRUPTED";

export class LiveClipStorageError extends Error {
  constructor(public readonly code: LiveClipStorageErrorCode, message: string) {
    super(message);
    this.name = "LiveClipStorageError";
  }
}

export interface LiveClipStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): LiveClipStorageLike | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function createEmptyLiveClipState(): LiveClipWorkspaceState {
  return {
    version: 1,
    activeLiveTranscriptId: null,
    liveTranscripts: [],
    transcriptChunks: [],
    topicBlocks: [],
    clipCandidates: [],
    clipPlans: [],
    completeVideoPlans: [],
  };
}

function isWorkspaceState(value: unknown): value is LiveClipWorkspaceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1
    && (record.activeLiveTranscriptId === null || typeof record.activeLiveTranscriptId === "string")
    && Array.isArray(record.liveTranscripts)
    && Array.isArray(record.transcriptChunks)
    && Array.isArray(record.topicBlocks)
    && Array.isArray(record.clipCandidates)
    && Array.isArray(record.clipPlans)
    && (record.completeVideoPlans === undefined || (
      Array.isArray(record.completeVideoPlans) && record.completeVideoPlans.every(isCompleteVideoPlan)
    ));
}

function isNullableString(value: unknown) {
  return value === null || typeof value === "string";
}

function isNullablePositiveInteger(value: unknown) {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value > 0);
}

function isCompleteVideoPlanSection(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const section = value as Record<string, unknown>;
  if (
    typeof section.role !== "string"
    || !COMPLETE_VIDEO_SECTION_ROLES.includes(section.role as typeof COMPLETE_VIDEO_SECTION_ROLES[number])
    || (section.sourceType !== "transcript" && section.sourceType !== "supplemental")
    || typeof section.transitionNote !== "string"
    || !isNullableString(section.startTime)
    || !isNullableString(section.endTime)
  ) return false;
  if (section.sourceType === "supplemental") {
    return (section.role === "opening" || section.role === "ending")
      && section.candidateId === null
      && section.startParagraph === null
      && section.endParagraph === null
      && section.rawText === null
      && section.cleanedText === null
      && typeof section.supplementalSuggestion === "string";
  }
  return typeof section.candidateId === "string"
    && isNullablePositiveInteger(section.startParagraph) && section.startParagraph !== null
    && isNullablePositiveInteger(section.endParagraph) && section.endParagraph !== null
    && typeof section.rawText === "string"
    && typeof section.cleanedText === "string"
    && section.supplementalSuggestion === null;
}

function isCompleteVideoPlan(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  if (
    typeof plan.id !== "string"
    || typeof plan.liveTranscriptId !== "string"
    || typeof plan.coreCandidateId !== "string"
    || typeof plan.title !== "string"
    || typeof plan.recommendReason !== "string"
    || typeof plan.createdAt !== "string"
    || typeof plan.sourceDurationSeconds !== "number"
    || !Number.isFinite(plan.sourceDurationSeconds)
    || plan.sourceDurationSeconds < 0
    || (plan.durationBasis !== "actual" && plan.durationBasis !== "text-estimate")
    || !Array.isArray(plan.editingNotes)
    || !plan.editingNotes.every(note => typeof note === "string")
    || !Array.isArray(plan.sections)
    || plan.sections.length < 3
    || plan.sections.length > 5
    || !plan.sections.every(isCompleteVideoPlanSection)
  ) return false;
  const roles = plan.sections.map(section => (section as Record<string, unknown>).role as string);
  const ranks = roles.map(role => COMPLETE_VIDEO_SECTION_ROLES.indexOf(role as typeof COMPLETE_VIDEO_SECTION_ROLES[number]));
  return new Set(roles).size === roles.length
    && roles.includes("opening")
    && roles.includes("body")
    && roles.includes("ending")
    && ranks.every((rank, index) => index === 0 || rank > ranks[index - 1]);
}

function legacyPurpose(value: unknown): ContentPurpose | null {
  return typeof value === "string" && CONTENT_PURPOSES.includes(value as ContentPurpose)
    ? value as ContentPurpose
    : null;
}

function legacyFailureReason(value: unknown): LiveClipFailureReason | null {
  return isLiveClipFailureReason(value) ? value : null;
}

function legacyStructureRole(value: unknown): ClipStructureRole | null {
  return isClipStructureRole(value) ? value : null;
}

function legacyClipType(value: unknown): ClipType | null {
  return typeof value === "string" && LIVE_CLIP_TYPES.includes(value as ClipType) ? value as ClipType : null;
}

function legacyClipTypes(value: unknown): ClipType[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is ClipType => legacyClipType(item) !== null))).slice(0, 2);
}

function legacyPurposeEvidence(value: unknown): PurposeEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.paragraphNumber === "number"
    && Number.isInteger(record.paragraphNumber)
    && record.paragraphNumber > 0
    && typeof record.quote === "string"
    && record.quote.trim().length > 0
    ? { paragraphNumber: record.paragraphNumber, quote: record.quote }
    : null;
}

function migratePurposePair(purposeValue: unknown, evidenceValue: unknown) {
  const purpose = legacyPurpose(purposeValue);
  const evidence = legacyPurposeEvidence(evidenceValue);
  return purpose && evidence ? { purpose, evidence } : { purpose: null, evidence: null };
}

function migrateCandidate(candidate: ClipCandidate): ClipCandidate {
  const primary = migratePurposePair(candidate.primaryPurpose, candidate.primaryPurposeEvidence);
  const secondary = migratePurposePair(candidate.secondaryPurpose, candidate.secondaryPurposeEvidence);
  return {
    ...candidate,
    structureRole: legacyStructureRole(candidate.structureRole),
    clipType: legacyClipType(candidate.clipType),
    secondaryTags: legacyClipTypes(candidate.secondaryTags),
    primaryPurpose: primary.purpose,
    primaryPurposeEvidence: primary.evidence,
    secondaryPurpose: secondary.purpose,
    secondaryPurposeEvidence: secondary.evidence,
  };
}

function migratePlan(plan: ClipPlan): ClipPlan {
  const primary = migratePurposePair(plan.primaryPurpose, plan.primaryPurposeEvidence);
  const secondary = migratePurposePair(plan.secondaryPurpose, plan.secondaryPurposeEvidence);
  return {
    ...plan,
    structureRole: legacyStructureRole(plan.structureRole),
    clipType: legacyClipType(plan.clipType),
    primaryPurpose: primary.purpose,
    primaryPurposeEvidence: primary.evidence,
    secondaryPurpose: secondary.purpose,
    secondaryPurposeEvidence: secondary.evidence,
  };
}

export function loadLiveClipState(storage: LiveClipStorageLike | null = defaultStorage()) {
  if (!storage) return createEmptyLiveClipState();
  const raw = storage.getItem(LIVE_CLIP_STORAGE_KEY);
  if (!raw) return createEmptyLiveClipState();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isWorkspaceState(parsed)) throw new Error("invalid state");
    return {
      ...parsed,
      transcriptChunks: parsed.transcriptChunks.map(chunk => ({
        ...chunk,
        errorReason: legacyFailureReason(chunk.errorReason),
      })),
      topicBlocks: parsed.topicBlocks.map(topic => ({
        ...topic,
        candidateErrorReason: legacyFailureReason(topic.candidateErrorReason),
      })),
      clipCandidates: parsed.clipCandidates.map(migrateCandidate),
      clipPlans: parsed.clipPlans.map(migratePlan),
      completeVideoPlans: parsed.completeVideoPlans ?? [],
    };
  } catch {
    throw new LiveClipStorageError("CORRUPTED", "直播切片本地数据损坏，已停止读取以保护原始数据。");
  }
}

export function replaceCompleteVideoPlans(
  state: LiveClipWorkspaceState,
  liveTranscriptId: string,
  coreCandidateId: string,
  plans: CompleteVideoPlan[],
): LiveClipWorkspaceState {
  if (plans.some(plan => plan.liveTranscriptId !== liveTranscriptId || plan.coreCandidateId !== coreCandidateId)) {
    throw new LiveClipStorageError("CORRUPTED", "完整成片方案归属不匹配，已停止保存。");
  }
  return {
    ...state,
    completeVideoPlans: [
      ...state.completeVideoPlans.filter(plan => (
        plan.liveTranscriptId !== liveTranscriptId || plan.coreCandidateId !== coreCandidateId
      )),
      ...plans,
    ],
  };
}

export function saveLiveClipState(
  state: LiveClipWorkspaceState,
  storage: LiveClipStorageLike | null = defaultStorage(),
) {
  if (!storage) return;
  const serialized = JSON.stringify(state);
  try {
    storage.setItem(LIVE_CLIP_STORAGE_KEY, serialized);
  } catch {
    throw new LiveClipStorageError("WRITE_FAILED", "直播逐字稿保存失败，可能是浏览器存储空间不足。已停止分析。");
  }
  if (storage.getItem(LIVE_CLIP_STORAGE_KEY) !== serialized) {
    throw new LiveClipStorageError("VERIFY_FAILED", "直播逐字稿保存后校验失败，已停止分析。");
  }
}

interface CreatePlansOptions {
  createId?: () => string;
  now?: () => string;
}

function createLocalId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const randomPart = typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function"
    ? Array.from(crypto.getRandomValues(new Uint32Array(2)), value => value.toString(36)).join("")
    : Math.random().toString(36).slice(2, 12);
  return `live-clip-plan-${Date.now().toString(36)}-${randomPart}`;
}

export function createClipPlans(
  state: LiveClipWorkspaceState,
  liveTranscriptId: string,
  selectedCandidateIds: string[],
  options: CreatePlansOptions = {},
): LiveClipWorkspaceState {
  const transcript = state.liveTranscripts.find(item => item.id === liveTranscriptId);
  if (!transcript) return state;
  const createId = options.createId ?? createLocalId;
  const now = options.now ?? (() => new Date().toISOString());
  const selected = new Set(selectedCandidateIds);
  const existingCandidateIds = new Set(state.clipPlans.map(plan => plan.clipCandidateId));
  const created: ClipPlan[] = state.clipCandidates
    .filter(candidate => (
      candidate.liveTranscriptId === liveTranscriptId
      && selected.has(candidate.id)
      && !existingCandidateIds.has(candidate.id)
    ))
    .map(candidate => ({
      id: createId(),
      liveTranscriptId,
      clipCandidateId: candidate.id,
      ipId: transcript.ipId,
      topic: candidate.topic,
      structureRole: candidate.structureRole,
      clipType: candidate.clipType,
      recommendation: candidate.recommendation,
      primaryPurpose: candidate.primaryPurpose,
      primaryPurposeEvidence: candidate.primaryPurposeEvidence,
      secondaryPurpose: candidate.secondaryPurpose,
      secondaryPurposeEvidence: candidate.secondaryPurposeEvidence,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      startParagraph: candidate.startParagraph,
      endParagraph: candidate.endParagraph,
      corePoint: candidate.corePoint,
      rawClipText: candidate.rawClipText,
      cleanedClipText: candidate.cleanedClipText,
      removeSuggestions: candidate.removeSuggestions,
      titleSuggestions: candidate.titleSuggestions,
      coverSuggestions: candidate.coverSuggestions,
      userAccepted: true as const,
      createdAt: now(),
    }));
  if (created.length === 0) return state;
  return { ...state, clipPlans: [...state.clipPlans, ...created] };
}
