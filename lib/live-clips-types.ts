import type { ContentPurpose } from "./content-purpose";

export const LIVE_CLIP_STORAGE_KEY = "ipwr:liveClipWorkspaces:v1";

export const LIVE_CLIP_TYPES = [
  "opinion",
  "method",
  "counterintuitive",
  "case",
  "qa",
  "story",
] as const;

export type ClipType = typeof LIVE_CLIP_TYPES[number];

export const LIVE_CLIP_STRUCTURE_ROLES = ["opening", "golden_quote", "marketing", "ending"] as const;
export type ClipStructureRole = typeof LIVE_CLIP_STRUCTURE_ROLES[number];

export const CLIP_STRUCTURE_ROLE_LABELS: Record<ClipStructureRole, string> = {
  opening: "开头",
  golden_quote: "金句",
  marketing: "营销",
  ending: "结尾",
};

export function isClipStructureRole(value: unknown): value is ClipStructureRole {
  return typeof value === "string" && LIVE_CLIP_STRUCTURE_ROLES.includes(value as ClipStructureRole);
}
export type ClipRating = "强" | "中" | "弱";
export type ClipRecommendation = "强烈建议切" | "可以考虑" | "不建议";
export type LivePlatform = "抖音" | "视频号" | "小红书" | "B站";
export type TargetDuration = "30—60秒" | "1—3分钟" | "3—5分钟" | "不限制";
export type TranscriptSourceType = "paste" | "txt" | "md" | "docx";
export type AnalysisProgress = "pending" | "analyzing" | "completed" | "failed";
export type LiveAnalysisStatus = "imported" | "analyzing" | "completed" | "partial";

export type LiveClipStageCode =
  | "TRANSCRIPT_PARSE_FAIL"
  | "TOPIC_ANALYSIS_FAIL"
  | "CLIP_ANALYSIS_FAIL";

export type LiveClipFailureCause =
  | "EMPTY_CONTENT"
  | "JSON_PARSE_FAIL"
  | "SCHEMA_FAIL"
  | "TRUNCATED"
  | "TIMEOUT"
  | "AI_REQUEST_FAIL"
  | "MISSING_API_KEY";

export const LIVE_CLIP_FAILURE_REASONS = [
  "START_QUOTE_NOT_FOUND",
  "END_QUOTE_NOT_FOUND",
  "REMOVAL_QUOTE_NOT_FOUND",
  "PURPOSE_EVIDENCE_NOT_FOUND",
  "FIELD_INVALID",
  "OUTPUT_TRUNCATED",
] as const;

export type LiveClipFailureReason = typeof LIVE_CLIP_FAILURE_REASONS[number];

export const LIVE_CLIP_FAILURE_REASON_LABELS: Record<LiveClipFailureReason, string> = {
  START_QUOTE_NOT_FOUND: "开始句无法在原文中定位",
  END_QUOTE_NOT_FOUND: "结束句无法在原文中定位",
  REMOVAL_QUOTE_NOT_FOUND: "删除片段无法在原文中定位",
  PURPOSE_EVIDENCE_NOT_FOUND: "内容目的证据无法在切片原文中定位",
  FIELD_INVALID: "AI返回字段不完整或不合法",
  OUTPUT_TRUNCATED: "AI返回被截断",
};

export function isLiveClipFailureReason(value: unknown): value is LiveClipFailureReason {
  return typeof value === "string" && LIVE_CLIP_FAILURE_REASONS.includes(value as LiveClipFailureReason);
}

export interface TranscriptParagraph {
  paragraphNumber: number;
  text: string;
  rawLine: string;
  startOffset: number;
  endOffset: number;
  startTime: string | null;
  endTime: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
}

export interface SourceRemovalSuggestion {
  paragraphNumber: number;
  quote: string;
  reason: string;
}

export interface ClipRemovalSuggestion extends SourceRemovalSuggestion {
  startTime: string | null;
  endTime: string | null;
}

export interface TranscriptChunk {
  id: string;
  liveTranscriptId: string;
  paragraphNumbers: number[];
  ownedStartParagraph: number;
  ownedEndParagraph: number;
  startParagraph: number;
  endParagraph: number;
  startTime: string | null;
  endTime: string | null;
  text: string;
  status: AnalysisProgress;
  errorStage: LiveClipStageCode | null;
  errorCause: LiveClipFailureCause | null;
  errorReason?: LiveClipFailureReason | null;
  removalSuggestions: SourceRemovalSuggestion[];
}

export interface LiveTranscript {
  id: string;
  title: string;
  ipId: string;
  platform: LivePlatform;
  rawTranscript: string;
  cleanedTranscript: string;
  hasTimecode: boolean;
  sourceType: TranscriptSourceType;
  targetDuration: TargetDuration;
  preferredClipTypes: ClipType[];
  preferredStructureRoles?: ClipStructureRole[];
  paragraphs: TranscriptParagraph[];
  analysisStatus: LiveAnalysisStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TopicBlock {
  id: string;
  liveTranscriptId: string;
  title: string;
  summary: string;
  startTime: string | null;
  endTime: string | null;
  startParagraph: number;
  endParagraph: number;
  keywords: string[];
  mainPoint: string;
  sourceChunkIds: string[];
  candidateStatus: AnalysisProgress;
  candidateError: LiveClipFailureCause | null;
  candidateErrorReason?: LiveClipFailureReason | null;
  createdAt: string;
}

export interface ClipDimensions {
  completeness: ClipRating;
  hookStrength: ClipRating;
  pointClarity: ClipRating;
  informationDensity: ClipRating;
  tension: ClipRating;
  ipFit: ClipRating;
}

export interface PurposeEvidence {
  paragraphNumber: number;
  quote: string;
}

export interface ClipCandidate {
  id: string;
  liveTranscriptId: string;
  topicBlockId: string;
  topic: string;
  structureRole: ClipStructureRole | null;
  clipType: ClipType | null;
  secondaryTags: ClipType[];
  recommendation: ClipRecommendation;
  dimensions: ClipDimensions;
  recommendReason: string;
  primaryPurpose: ContentPurpose | null;
  primaryPurposeEvidence: PurposeEvidence | null;
  secondaryPurpose: ContentPurpose | null;
  secondaryPurposeEvidence: PurposeEvidence | null;
  startTime: string | null;
  endTime: string | null;
  startParagraph: number;
  endParagraph: number;
  estimatedDurationSeconds: number | null;
  durationBasis: "actual" | "text-estimate";
  corePoint: string;
  startQuote: string;
  endQuote: string;
  rawClipText: string;
  cleanedClipText: string;
  removeSuggestions: ClipRemovalSuggestion[];
  titleSuggestions: string[];
  coverSuggestions: string[];
  createdAt: string;
}

export interface ClipPlan {
  id: string;
  liveTranscriptId: string;
  clipCandidateId: string;
  ipId: string;
  topic: string;
  structureRole: ClipStructureRole | null;
  clipType: ClipType | null;
  recommendation: ClipRecommendation;
  primaryPurpose: ContentPurpose | null;
  primaryPurposeEvidence: PurposeEvidence | null;
  secondaryPurpose: ContentPurpose | null;
  secondaryPurposeEvidence: PurposeEvidence | null;
  startTime: string | null;
  endTime: string | null;
  startParagraph: number;
  endParagraph: number;
  corePoint: string;
  rawClipText: string;
  cleanedClipText: string;
  removeSuggestions: ClipRemovalSuggestion[];
  titleSuggestions: string[];
  coverSuggestions: string[];
  userAccepted: true;
  createdAt: string;
}

export interface LiveClipWorkspaceState {
  version: 1;
  activeLiveTranscriptId: string | null;
  liveTranscripts: LiveTranscript[];
  transcriptChunks: TranscriptChunk[];
  topicBlocks: TopicBlock[];
  clipCandidates: ClipCandidate[];
  clipPlans: ClipPlan[];
}

export interface LiveClipApiError {
  error: string;
  stageCode: LiveClipStageCode;
  causeCode: LiveClipFailureCause;
  reasonCode?: LiveClipFailureReason | null;
  diagnosticId?: string;
}

export const CLIP_TYPE_LABELS: Record<ClipType, string> = {
  opinion: "观点型",
  method: "方法型",
  counterintuitive: "反常识型",
  case: "案例型",
  qa: "问答型",
  story: "故事型",
};
