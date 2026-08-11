import {
  LIVE_CLIP_STORAGE_KEY,
  type ClipPlan,
  type LiveClipWorkspaceState,
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

export function loadLiveClipState(storage: LiveClipStorageLike | null = defaultStorage()) {
  if (!storage) return createEmptyLiveClipState();
  const raw = storage.getItem(LIVE_CLIP_STORAGE_KEY);
  if (!raw) return createEmptyLiveClipState();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isWorkspaceState(parsed)) throw new Error("invalid state");
    return parsed;
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

export function createClipPlans(
  state: LiveClipWorkspaceState,
  liveTranscriptId: string,
  selectedCandidateIds: string[],
  options: CreatePlansOptions = {},
): LiveClipWorkspaceState {
  const transcript = state.liveTranscripts.find(item => item.id === liveTranscriptId);
  if (!transcript) return state;
  const createId = options.createId ?? (() => crypto.randomUUID());
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
      clipType: candidate.clipType,
      recommendation: candidate.recommendation,
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
