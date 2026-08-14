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

export const COMPLETE_VIDEO_SECTION_ROLES = ["opening", "body", "golden_quote", "marketing", "ending"] as const;
export type CompleteVideoSectionRole = typeof COMPLETE_VIDEO_SECTION_ROLES[number];
export type CompleteVideoSectionSource = "transcript" | "supplemental";
export const COMPLETE_VIDEO_SUPPLEMENTAL_KINDS = ["problem_hook", "conflict_hook", "summary_closure", "action_closure"] as const;
export type CompleteVideoSupplementalKind = typeof COMPLETE_VIDEO_SUPPLEMENTAL_KINDS[number];

export const COMPLETE_VIDEO_SECTION_ROLE_LABELS: Record<CompleteVideoSectionRole, string> = {
  opening: "开头",
  body: "主体",
  golden_quote: "金句",
  marketing: "营销",
  ending: "结尾",
};
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
  | "CLIP_ANALYSIS_FAIL"
  | "COMPLETE_PLAN_ANALYSIS_FAIL";

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

export const COMPLETE_PLAN_VALIDATION_CODES = [
  "REQUEST_FORMAT_INVALID",
  "REQUEST_FIELD_INVALID",
  "CANDIDATE_COUNT_EXCEEDED",
  "CANDIDATE_LIST_INVALID",
  "CANDIDATE_FORMAT_INVALID",
  "HISTORICAL_CANDIDATE_MISSING_FIELD",
  "CANDIDATE_OWNERSHIP_MISMATCH",
  "CANDIDATE_RANGE_INVALID",
  "CANDIDATE_REMOVAL_INVALID",
  "CANDIDATE_ID_DUPLICATED",
  "CORE_CANDIDATE_NOT_FOUND",
  "TRANSCRIPT_PARAGRAPHS_INVALID",
  "CANDIDATE_SOURCE_RANGE_MISSING",
  "PLAN_COUNT_INVALID",
  "PLAN_FIELD_INVALID",
  "SECTION_COUNT_INVALID",
  "SECTION_FIELD_INVALID",
  "BODY_SOURCE_INVALID",
  "SOURCE_REFERENCE_INVALID",
  "SOURCE_RANGE_INVALID",
  "SOURCE_QUOTE_MISSING",
  "SUPPLEMENTAL_SECTION_INVALID",
  "SECTION_STRUCTURE_INVALID",
] as const;

export type CompletePlanValidationCode = typeof COMPLETE_PLAN_VALIDATION_CODES[number];

export const COMPLETE_PLAN_VALIDATION_LABELS: Record<CompletePlanValidationCode, string> = {
  REQUEST_FORMAT_INVALID: "请求格式不正确",
  REQUEST_FIELD_INVALID: "请求字段不完整",
  CANDIDATE_COUNT_EXCEEDED: "候选数量超过30条",
  CANDIDATE_LIST_INVALID: "候选列表为空或格式不正确",
  CANDIDATE_FORMAT_INVALID: "候选格式不正确",
  HISTORICAL_CANDIDATE_MISSING_FIELD: "历史候选缺少必填字段",
  CANDIDATE_OWNERSHIP_MISMATCH: "候选不属于当前直播",
  CANDIDATE_RANGE_INVALID: "候选段落范围不正确",
  CANDIDATE_REMOVAL_INVALID: "候选删除建议格式不正确",
  CANDIDATE_ID_DUPLICATED: "候选编号重复",
  CORE_CANDIDATE_NOT_FOUND: "核心候选不存在于本次候选列表",
  TRANSCRIPT_PARAGRAPHS_INVALID: "逐字稿段落为空或格式不正确",
  CANDIDATE_SOURCE_RANGE_MISSING: "候选的原文范围在逐字稿中不存在",
  PLAN_COUNT_INVALID: "方案数量不是1至3套",
  PLAN_FIELD_INVALID: "方案标题、推荐理由或剪辑建议字段不合法",
  SECTION_COUNT_INVALID: "成片段落数量不是3至5段",
  SECTION_FIELD_INVALID: "成片段落角色、来源类型或衔接说明不合法",
  BODY_SOURCE_INVALID: "主体没有正确引用当前核心候选",
  SOURCE_REFERENCE_INVALID: "原片引用的候选不存在或归属不匹配",
  SOURCE_RANGE_INVALID: "原片段落范围不合法或超出候选范围",
  SOURCE_QUOTE_MISSING: "原片缺少开始句或结束句",
  SUPPLEMENTAL_SECTION_INVALID: "补录段落的角色、类型或来源字段不合法",
  SECTION_STRUCTURE_INVALID: "开头、主体、结尾的顺序、数量或原文范围存在冲突",
};

export function isCompletePlanValidationCode(value: unknown): value is CompletePlanValidationCode {
  return typeof value === "string" && COMPLETE_PLAN_VALIDATION_CODES.includes(value as CompletePlanValidationCode);
}

export const COMPLETE_PLAN_CANDIDATE_FIELD_LABELS = {
  id: "候选编号",
  liveTranscriptId: "直播归属",
  startParagraph: "开始段落",
  endParagraph: "结束段落",
  removeSuggestions: "删除建议",
  topic: "主题",
  corePoint: "核心观点",
  recommendation: "推荐程度",
} as const;

export type CompletePlanCandidateFieldName = keyof typeof COMPLETE_PLAN_CANDIDATE_FIELD_LABELS;

export function isCompletePlanCandidateFieldName(value: unknown): value is CompletePlanCandidateFieldName {
  return typeof value === "string"
    && Object.prototype.hasOwnProperty.call(COMPLETE_PLAN_CANDIDATE_FIELD_LABELS, value);
}

export const COMPLETE_PLAN_REQUEST_FIELD_LABELS = {
  liveTranscriptId: "直播逐字稿编号",
  coreCandidateId: "核心候选编号",
} as const;

export type CompletePlanRequestFieldName = keyof typeof COMPLETE_PLAN_REQUEST_FIELD_LABELS;

export function isCompletePlanRequestFieldName(value: unknown): value is CompletePlanRequestFieldName {
  return typeof value === "string"
    && Object.prototype.hasOwnProperty.call(COMPLETE_PLAN_REQUEST_FIELD_LABELS, value);
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

interface CompleteVideoPlanSectionBase {
  role: CompleteVideoSectionRole;
  transitionNote: string;
}

export interface CompleteVideoTranscriptSection extends CompleteVideoPlanSectionBase {
  sourceType: "transcript";
  candidateId: string | null;
  startTime: string | null;
  endTime: string | null;
  startParagraph: number;
  endParagraph: number;
  rawText: string;
  cleanedText: string;
  supplementalKind: null;
  supplementalSuggestion: null;
}

export interface CompleteVideoSupplementalSection extends CompleteVideoPlanSectionBase {
  sourceType: "supplemental";
  role: "opening" | "ending";
  candidateId: null;
  startTime: null;
  endTime: null;
  startParagraph: null;
  endParagraph: null;
  rawText: null;
  cleanedText: null;
  supplementalKind: CompleteVideoSupplementalKind;
  supplementalSuggestion: string;
}

export type CompleteVideoPlanSection = CompleteVideoTranscriptSection | CompleteVideoSupplementalSection;

export interface CompleteVideoPlan {
  id: string;
  liveTranscriptId: string;
  coreCandidateId: string;
  title: string;
  recommendReason: string;
  sections: CompleteVideoPlanSection[];
  editingNotes: string[];
  sourceDurationSeconds: number;
  durationBasis: "actual" | "text-estimate";
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
  completeVideoPlans: CompleteVideoPlan[];
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
