import { CONTENT_PURPOSES, type ContentPurpose } from "./content-purpose";
import {
  LIVE_CLIP_STORAGE_KEY,
  LIVE_CLIP_STRUCTURE_ROLES,
  isLiveClipFailureReason,
  type ClipCandidate,
  type ClipPlan,
  type LiveClipWorkspaceState,
  type PurposeEvidence,
  type LiveClipFailureReason,
  type ClipStructureRole,
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
    && Array.isArray(record.clipPlans);
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
  return typeof value === "string" && LIVE_CLIP_STRUCTURE_ROLES.includes(value as ClipStructureRole)
    ? value as ClipStructureRole
    : null;
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

function migrateCandidatePurpose(candidate: ClipCandidate): ClipCandidate {
  const primary = migratePurposePair(candidate.primaryPurpose, candidate.primaryPurposeEvidence);
  const secondary = migratePurposePair(candidate.secondaryPurpose, candidate.secondaryPurposeEvidence);
  return {
    ...candidate,
    structureRole: legacyStructureRole(candidate.structureRole),
    primaryPurpose: primary.purpose,
    primaryPurposeEvidence: primary.evidence,
    secondaryPurpose: secondary.purpose,
    secondaryPurposeEvidence: secondary.evidence,
  };
}

function migratePlanPurpose(plan: ClipPlan): ClipPlan {
  const primary = migratePurposePair(plan.primaryPurpose, plan.primaryPurposeEvidence);
  const secondary = migratePurposePair(plan.secondaryPurpose, plan.secondaryPurposeEvidence);
  return {
    ...plan,
    structureRole: legacyStructureRole(plan.structureRole),
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
      clipCandidates: parsed.clipCandidates.map(migrateCandidatePurpose),
      clipPlans: parsed.clipPlans.map(migratePlanPurpose),
    };
  } catch {
    throw new LiveClipStorageError("CORRUPTED", "直播切片本地数据损坏，已停止读取以保护原始数据。");
  }
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
