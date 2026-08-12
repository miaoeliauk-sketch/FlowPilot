import {
  callDeepSeek,
  DeepSeekResponseError,
  type DeepSeekResponseMeta,
} from "./deepseek";

export interface StructuredDeepSeekOptions<T> {
  systemPrompt: string;
  userPrompt: string;
  parse: (content: string) => T;
  buildParseRetryInstruction?: (failureCode: string) => string | null;
  apiKey?: string;
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface StructuredDeepSeekResult<T> {
  data: T;
  attempts: number;
  responseMeta: DeepSeekResponseMeta;
  attemptDiagnostics: StructuredDeepSeekAttemptDiagnostic[];
}

export type StructuredDeepSeekErrorStage = "timeout" | "request" | "parse";

export interface StructuredDeepSeekAttemptDiagnostic {
  attempt: number;
  stage: StructuredDeepSeekErrorStage | "success";
  failureCode?: string;
  reasonCode?: string;
  responseChars: number | null;
  finishReason: string | null;
  promptTokens?: number;
  completionTokens: number | null;
  totalTokens?: number;
  reasoningTokens?: number;
  hasReasoningContent?: boolean;
  reasoningChars?: number;
  itemCount?: number;
  itemIndex?: number;
  fieldCount?: number;
}

interface StructuredParseDiagnosticSource {
  diagnosticCode?: unknown;
  diagnosticDetails?: unknown;
}

export class StructuredDeepSeekError extends Error {
  readonly stage: StructuredDeepSeekErrorStage;
  readonly attempts: number;
  readonly cause: unknown;
  readonly attemptDiagnostics: StructuredDeepSeekAttemptDiagnostic[];

  constructor(
    stage: StructuredDeepSeekErrorStage,
    attempts: number,
    cause: unknown,
    attemptDiagnostics: StructuredDeepSeekAttemptDiagnostic[] = [],
  ) {
    const message = cause instanceof Error ? cause.message : "结构化AI调用失败";
    super(message);
    this.name = "StructuredDeepSeekError";
    this.stage = stage;
    this.attempts = attempts;
    this.cause = cause;
    this.attemptDiagnostics = attemptDiagnostics;
  }
}

class StructuredDeepSeekTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`结构化AI调用超过${Math.round(timeoutMs / 1000)}秒未完成`);
    this.name = "StructuredDeepSeekTimeoutError";
  }
}

const EMPTY_RESPONSE_META: DeepSeekResponseMeta = {
  requestId: null,
  finishReason: null,
  promptTokens: null,
  completionTokens: null,
  totalTokens: null,
  reasoningTokens: null,
  hasReasoningContent: false,
  reasoningChars: 0,
};

function responseMetaDiagnostic(meta: DeepSeekResponseMeta) {
  const diagnostic: Pick<StructuredDeepSeekAttemptDiagnostic,
    "finishReason" | "completionTokens" | "promptTokens" | "totalTokens" |
    "reasoningTokens" | "hasReasoningContent" | "reasoningChars"> = {
    finishReason: meta.finishReason,
    completionTokens: meta.completionTokens,
    hasReasoningContent: meta.hasReasoningContent,
    reasoningChars: meta.reasoningChars,
  };
  if (meta.promptTokens !== null) diagnostic.promptTokens = meta.promptTokens;
  if (meta.totalTokens !== null) diagnostic.totalTokens = meta.totalTokens;
  if (meta.reasoningTokens !== null) diagnostic.reasoningTokens = meta.reasoningTokens;
  return diagnostic;
}

function safeFailureCode(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value)
    ? value
    : fallback;
}

function safeDiagnosticNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function parseFailureDiagnostic(
  error: unknown,
): Pick<StructuredDeepSeekAttemptDiagnostic,
  "failureCode" | "reasonCode" | "itemCount" | "itemIndex" | "fieldCount"> {
  const source = error && typeof error === "object"
    ? error as StructuredParseDiagnosticSource
    : {};
  const details = source.diagnosticDetails && typeof source.diagnosticDetails === "object"
    ? source.diagnosticDetails as Record<string, unknown>
    : {};
  const diagnostic: Pick<StructuredDeepSeekAttemptDiagnostic,
    "failureCode" | "reasonCode" | "itemCount" | "itemIndex" | "fieldCount"> = {
    failureCode: safeFailureCode(source.diagnosticCode, "PARSE_FAILED"),
  };
  const reasonCode = safeFailureCode(details.reasonCode, "");
  if (reasonCode) diagnostic.reasonCode = reasonCode;
  const itemCount = safeDiagnosticNumber(details.itemCount);
  const itemIndex = safeDiagnosticNumber(details.itemIndex);
  const fieldCount = safeDiagnosticNumber(details.fieldCount);
  if (itemCount !== undefined) diagnostic.itemCount = itemCount;
  if (itemIndex !== undefined) diagnostic.itemIndex = itemIndex;
  if (fieldCount !== undefined) diagnostic.fieldCount = fieldCount;
  return diagnostic;
}

export async function callStructuredDeepSeek<T>(
  options: StructuredDeepSeekOptions<T>,
): Promise<StructuredDeepSeekResult<T>> {
  // 60秒×（首次请求+1次重试）=单接口最坏2分钟。
  const timeoutMs = options.timeoutMs ?? 60_000;
  const totalAttempts = (options.maxRetries ?? 1) + 1;
  let lastError: unknown;
  let lastStage: StructuredDeepSeekErrorStage = "request";
  const attemptDiagnostics: StructuredDeepSeekAttemptDiagnostic[] = [];
  let parseRetryInstruction: string | null = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    let responseMeta = EMPTY_RESPONSE_META;
    let content: string;
    const controller = new AbortController();
    const timeoutError = new StructuredDeepSeekTimeoutError(timeoutMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort(timeoutError);
          reject(timeoutError);
        }, timeoutMs);
      });
      const request = callDeepSeek(
        options.systemPrompt,
        parseRetryInstruction
          ? `${options.userPrompt}\n\n【上次输出纠错要求】\n${parseRetryInstruction}`
          : options.userPrompt,
        options.maxTokens,
        options.temperature ?? 0.3,
        options.apiKey,
        {
          thinking: { type: "disabled" },
          responseFormat: { type: "json_object" },
          onResponseMeta: (meta) => {
            responseMeta = meta;
          },
          signal: controller.signal,
        },
      );
      content = await Promise.race([request, timeout]);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("未配置 DeepSeek API Key")
      ) {
        attemptDiagnostics.push({
          attempt,
          stage: "request",
          failureCode: "MISSING_API_KEY",
          responseChars: null,
          finishReason: null,
          completionTokens: null,
        });
        throw new StructuredDeepSeekError(
          "request",
          attempt,
          error,
          attemptDiagnostics,
        );
      }
      lastError = error;
      lastStage = error instanceof StructuredDeepSeekTimeoutError
        ? "timeout"
        : "request";
      const responseError = error instanceof DeepSeekResponseError ? error : null;
      const failureMeta = responseError?.responseMeta ?? responseMeta;
      attemptDiagnostics.push({
        attempt,
        stage: lastStage,
        failureCode: lastStage === "timeout"
          ? "TIMEOUT"
          : responseError?.code ?? "REQUEST_FAILED",
        responseChars: responseError?.responseChars ?? null,
        ...responseMetaDiagnostic(failureMeta),
      });
      continue;
    } finally {
      if (timer) clearTimeout(timer);
    }

    try {
      return {
        data: options.parse(content),
        attempts: attempt,
        responseMeta,
        attemptDiagnostics: [
          ...attemptDiagnostics,
          {
            attempt,
            stage: "success",
            responseChars: content.length,
            ...responseMetaDiagnostic(responseMeta),
          },
        ],
      };
    } catch (error) {
      lastError = error;
      lastStage = "parse";
      const parseDiagnostic = parseFailureDiagnostic(error);
      if (responseMeta.finishReason === "length") {
        parseDiagnostic.failureCode = "OUTPUT_TRUNCATED";
        parseDiagnostic.reasonCode = "OUTPUT_TRUNCATED";
      }
      const failureCode = parseDiagnostic.failureCode ?? "PARSE_FAILED";
      parseRetryInstruction = attempt < totalAttempts
        ? options.buildParseRetryInstruction?.(failureCode) ?? null
        : null;
      attemptDiagnostics.push({
        attempt,
        stage: "parse",
        responseChars: content.length,
        ...responseMetaDiagnostic(responseMeta),
        ...parseDiagnostic,
      });
    }
  }

  throw new StructuredDeepSeekError(
    lastStage,
    totalAttempts,
    lastError,
    attemptDiagnostics,
  );
}
