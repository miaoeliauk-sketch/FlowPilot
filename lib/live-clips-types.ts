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
  clipType: ClipType;
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
  clipType: ClipType;
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
