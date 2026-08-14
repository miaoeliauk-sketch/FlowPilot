import { NextResponse } from "next/server";
import { StructuredDeepSeekError } from "./structured-deepseek";
import { LIVE_CLIP_FAILURE_REASON_LABELS, isLiveClipFailureReason } from "./live-clips-types";
import type {
  LiveClipFailureCause,
  LiveClipFailureReason,
  LiveClipStageCode,
  TranscriptChunk,
  TranscriptParagraph,
} from "./live-clips-types";

export class LiveClipRequestError extends Error {}

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
  return NextResponse.json({
    error: `${stageLabel}失败：${reasonCode ? LIVE_CLIP_FAILURE_REASON_LABELS[reasonCode] : causeLabel[causeCode]}`,
    stageCode,
    causeCode,
    reasonCode,
    diagnosticId,
  }, { status });
}
