import {
  callDeepSeek,
  type DeepSeekResponseMeta,
} from "./deepseek";

export interface StructuredDeepSeekOptions<T> {
  systemPrompt: string;
  userPrompt: string;
  parse: (content: string) => T;
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
}

export type StructuredDeepSeekErrorStage = "timeout" | "request" | "parse";

export class StructuredDeepSeekError extends Error {
  readonly stage: StructuredDeepSeekErrorStage;
  readonly attempts: number;
  readonly cause: unknown;

  constructor(
    stage: StructuredDeepSeekErrorStage,
    attempts: number,
    cause: unknown,
  ) {
    const message = cause instanceof Error ? cause.message : "结构化AI调用失败";
    super(message);
    this.name = "StructuredDeepSeekError";
    this.stage = stage;
    this.attempts = attempts;
    this.cause = cause;
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
};

export async function callStructuredDeepSeek<T>(
  options: StructuredDeepSeekOptions<T>,
): Promise<StructuredDeepSeekResult<T>> {
  // 60秒×（首次请求+1次重试）=单接口最坏2分钟。
  const timeoutMs = options.timeoutMs ?? 60_000;
  const totalAttempts = (options.maxRetries ?? 1) + 1;
  let lastError: unknown;
  let lastStage: StructuredDeepSeekErrorStage = "request";

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
        options.userPrompt,
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
        throw new StructuredDeepSeekError("request", attempt, error);
      }
      lastError = error;
      lastStage = error instanceof StructuredDeepSeekTimeoutError
        ? "timeout"
        : "request";
      continue;
    } finally {
      if (timer) clearTimeout(timer);
    }

    try {
      return {
        data: options.parse(content),
        attempts: attempt,
        responseMeta,
      };
    } catch (error) {
      lastError = error;
      lastStage = "parse";
    }
  }

  throw new StructuredDeepSeekError(lastStage, totalAttempts, lastError);
}
