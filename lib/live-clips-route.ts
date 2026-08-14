import { NextResponse } from "next/server";
import { StructuredDeepSeekError } from "./structured-deepseek";
import {
  COMPLETE_PLAN_CANDIDATE_FIELD_LABELS,
  COMPLETE_PLAN_REQUEST_FIELD_LABELS,
  COMPLETE_PLAN_VALIDATION_LABELS,
  LIVE_CLIP_FAILURE_REASON_LABELS,
  isCompletePlanCandidateFieldName,
  isCompletePlanRequestFieldName,
  isCompletePlanValidationCode,
  isLiveClipFailureReason,
} from "./live-clips-types";
import type {
  CompletePlanValidationCode,
  LiveClipFailureCause,
  LiveClipFailureReason,
  LiveClipStageCode,
  TranscriptChunk,
  TranscriptParagraph,
} from "./live-clips-types";

export class LiveClipRequestError extends Error {
  readonly diagnosticDetails: Record<string, unknown>;

  constructor(message: string, diagnosticDetails: Record<string, unknown> = {}) {
    super(message);
    this.name = "LiveClipRequestError";
    this.diagnosticDetails = diagnosticDetails;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseTranscriptParagraphs(value: unknown): TranscriptParagraph[] {
  if (!Array.isArray(value) || value.length === 0) throw new LiveClipRequestError("逐字稿段落为空");
  return value.map((item, index) => {
    if (!isRecord(item)) throw new LiveClipRequestError(`第${index + 1}段格式无效`);
    const paragraphNumber = item.paragraphNumber;
    const text = item.text;
    if (typeof paragraphNumber !== "number" || !Number.isInteger(paragraphNumber) || paragraphNumber < 1 || typeof text !== "string" || !text.trim()) {
      throw new LiveClipRequestError(`第${index + 1}段格式无效`);
    }
    return {
      paragraphNumber,
      text,
      rawLine: typeof item.rawLine === "string" ? item.rawLine : text,
      startOffset: typeof item.startOffset === "number" ? item.startOffset : 0,
      endOffset: typeof item.endOffset === "number" ? item.endOffset : text.length,
      startTime: typeof item.startTime === "string" ? item.startTime : null,
      endTime: typeof item.endTime === "string" ? item.endTime : null,
      startSeconds: typeof item.startSeconds === "number" ? item.startSeconds : null,
      endSeconds: typeof item.endSeconds === "number" ? item.endSeconds : null,
    };
  });
}

export function parseTranscriptChunk(value: unknown): TranscriptChunk {
  if (!isRecord(value)) throw new LiveClipRequestError("逐字稿分块格式无效");
  const requiredNumbers = ["ownedStartParagraph", "ownedEndParagraph", "startParagraph", "endParagraph"] as const;
  for (const key of requiredNumbers) {
    if (typeof value[key] !== "number" || !Number.isInteger(value[key]) || value[key] < 1) {
      throw new LiveClipRequestError("逐字稿分块范围无效");
    }
  }
  if (typeof value.id !== "string" || typeof value.liveTranscriptId !== "string" || typeof value.text !== "string") {
    throw new LiveClipRequestError("逐字稿分块字段不完整");
  }
  return value as unknown as TranscriptChunk;
}

function lastFailureCode(error: StructuredDeepSeekError): string {
  for (let index = error.attemptDiagnostics.length - 1; index >= 0; index -= 1) {
    const code = error.attemptDiagnostics[index].failureCode;
    if (code) return code;
  }
  return error.stage === "timeout" ? "TIMEOUT" : "AI_REQUEST_FAIL";
}

function lastReasonCode(error: StructuredDeepSeekError): LiveClipFailureReason | null {
  for (let index = error.attemptDiagnostics.length - 1; index >= 0; index -= 1) {
    const code = error.attemptDiagnostics[index].reasonCode;
    if (isLiveClipFailureReason(code)) return code;
  }
  return null;
}

function lastValidationCode(error: StructuredDeepSeekError): CompletePlanValidationCode | null {
  for (let index = error.attemptDiagnostics.length - 1; index >= 0; index -= 1) {
    const code = error.attemptDiagnostics[index].validationCode;
    if (isCompletePlanValidationCode(code)) return code;
  }
  return null;
}

function requestValidationCode(error: LiveClipRequestError): CompletePlanValidationCode | null {
  const code = error.diagnosticDetails.validationCode;
  return isCompletePlanValidationCode(code) ? code : null;
}

function safePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function requestValidationDetails(
  error: LiveClipRequestError,
  validationCode: CompletePlanValidationCode | null,
): Record<string, number | string> | null {
  if (validationCode === "CANDIDATE_COUNT_EXCEEDED") {
    const actualCount = safePositiveInteger(error.diagnosticDetails.actualCount);
    const maxCount = safePositiveInteger(error.diagnosticDetails.maxCount);
    return actualCount !== null && maxCount !== null ? { actualCount, maxCount } : null;
  }
  if (validationCode === "HISTORICAL_CANDIDATE_MISSING_FIELD") {
    const candidateIndex = safePositiveInteger(error.diagnosticDetails.candidateIndex);
    const fieldName = error.diagnosticDetails.fieldName;
    return candidateIndex !== null && isCompletePlanCandidateFieldName(fieldName)
      ? { candidateIndex, fieldName }
      : null;
  }
  if (validationCode === "REQUEST_FIELD_INVALID") {
    const fieldName = error.diagnosticDetails.fieldName;
    return isCompletePlanRequestFieldName(fieldName) ? { fieldName } : null;
  }
  if (
    validationCode === "CANDIDATE_FORMAT_INVALID"
    || validationCode === "CANDIDATE_OWNERSHIP_MISMATCH"
    || validationCode === "CANDIDATE_RANGE_INVALID"
    || validationCode === "CANDIDATE_SOURCE_RANGE_MISSING"
  ) {
    const candidateIndex = safePositiveInteger(error.diagnosticDetails.candidateIndex);
    return candidateIndex !== null ? { candidateIndex } : null;
  }
  if (validationCode === "CANDIDATE_REMOVAL_INVALID") {
    const candidateIndex = safePositiveInteger(error.diagnosticDetails.candidateIndex);
    const removalIndex = safePositiveInteger(error.diagnosticDetails.removalIndex);
    return candidateIndex !== null && removalIndex !== null ? { candidateIndex, removalIndex } : null;
  }
  return null;
}

function completePlanValidationMessage(
  validationCode: CompletePlanValidationCode | null,
  details: Record<string, number | string> | null,
) {
  if (validationCode === "CANDIDATE_COUNT_EXCEEDED" && details) {
    return `共提交${details.actualCount}条候选，最多支持${details.maxCount}条`;
  }
  if (validationCode === "HISTORICAL_CANDIDATE_MISSING_FIELD" && details) {
    const fieldName = details.fieldName;
    return typeof fieldName === "string" && isCompletePlanCandidateFieldName(fieldName)
      ? `第${details.candidateIndex}条历史候选缺少或无法识别“${COMPLETE_PLAN_CANDIDATE_FIELD_LABELS[fieldName]}”`
      : COMPLETE_PLAN_VALIDATION_LABELS[validationCode];
  }
  if (validationCode === "REQUEST_FIELD_INVALID" && details) {
    const fieldName = details.fieldName;
    return typeof fieldName === "string" && isCompletePlanRequestFieldName(fieldName)
      ? `请求缺少或无法识别“${COMPLETE_PLAN_REQUEST_FIELD_LABELS[fieldName]}”`
      : COMPLETE_PLAN_VALIDATION_LABELS[validationCode];
  }
  if (validationCode === "CANDIDATE_FORMAT_INVALID" && details) return `第${details.candidateIndex}条候选格式不正确`;
  if (validationCode === "CANDIDATE_OWNERSHIP_MISMATCH" && details) return `第${details.candidateIndex}条候选不属于当前直播`;
  if (validationCode === "CANDIDATE_RANGE_INVALID" && details) return `第${details.candidateIndex}条候选的段落范围不正确`;
  if (validationCode === "CANDIDATE_SOURCE_RANGE_MISSING" && details) return `第${details.candidateIndex}条候选的原文范围在逐字稿中不存在`;
  if (validationCode === "CANDIDATE_REMOVAL_INVALID" && details) {
    return `第${details.candidateIndex}条候选的第${details.removalIndex}条删除建议格式不正确`;
  }
  return validationCode ? COMPLETE_PLAN_VALIDATION_LABELS[validationCode] : null;
}

export function failureCause(error: unknown): LiveClipFailureCause {
  if (error instanceof StructuredDeepSeekError) {
    const code = lastFailureCode(error);
    if (code === "EMPTY_CONTENT") return "EMPTY_CONTENT";
    if (code === "OUTPUT_TRUNCATED") return "TRUNCATED";
    if (code === "JSON_PARSE_FAIL") return "JSON_PARSE_FAIL";
    if (code === "SCHEMA_FAIL") return "SCHEMA_FAIL";
    if (code === "MISSING_API_KEY") return "MISSING_API_KEY";
    if (code === "TIMEOUT") return "TIMEOUT";
    return "AI_REQUEST_FAIL";
  }
  if (error instanceof LiveClipRequestError) return "SCHEMA_FAIL";
  return "AI_REQUEST_FAIL";
}

export function liveClipErrorResponse(
  stageCode: LiveClipStageCode,
  error: unknown,
  diagnosticId: string,
) {
  const causeCode = failureCause(error);
  const reasonCode = causeCode === "TRUNCATED"
    ? "OUTPUT_TRUNCATED"
    : error instanceof StructuredDeepSeekError
      ? lastReasonCode(error)
      : causeCode === "SCHEMA_FAIL" ? "FIELD_INVALID" : null;
  const validationCode = stageCode === "COMPLETE_PLAN_ANALYSIS_FAIL"
    ? error instanceof StructuredDeepSeekError
      ? lastValidationCode(error)
      : error instanceof LiveClipRequestError
        ? requestValidationCode(error)
        : null
    : null;
  const validationDetails = error instanceof LiveClipRequestError
    ? requestValidationDetails(error, validationCode)
    : null;
  const stageLabel = stageCode === "TOPIC_ANALYSIS_FAIL"
    ? "主题识别"
    : stageCode === "COMPLETE_PLAN_ANALYSIS_FAIL"
      ? "完整成片方案生成"
      : "切片识别";
  const causeLabel: Record<LiveClipFailureCause, string> = {
    EMPTY_CONTENT: "AI返回为空",
    JSON_PARSE_FAIL: "AI返回的JSON格式异常",
    SCHEMA_FAIL: "AI返回字段不完整或原话无法追溯",
    TRUNCATED: "AI返回被截断",
    TIMEOUT: "AI请求超时",
    AI_REQUEST_FAIL: "AI请求失败",
    MISSING_API_KEY: "未配置DeepSeek API Key",
  };
  const status = causeCode === "MISSING_API_KEY" || error instanceof LiveClipRequestError
    ? 400
    : causeCode === "TIMEOUT"
      ? 504
      : 502;
  const validationMessage = completePlanValidationMessage(validationCode, validationDetails);
  return NextResponse.json({
    error: `${stageLabel}失败：${validationMessage ?? (reasonCode ? LIVE_CLIP_FAILURE_REASON_LABELS[reasonCode] : causeLabel[causeCode])}`,
    stageCode,
    causeCode,
    reasonCode,
    validationCode,
    validationDetails,
    diagnosticId,
  }, { status });
}
