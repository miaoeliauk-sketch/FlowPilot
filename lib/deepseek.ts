/**
 * lib/deepseek.ts
 * FlowPilot 统一 DeepSeek API 调用层。
 *
 * 所有 API 接口文件必须从这里 import，不允许在接口文件里自己定义 callDeepSeek。
 * 原因：统一管理模型名称、错误处理、重试逻辑，未来切换模型只改这一个文件。
 */

const DEEPSEEK_API = "https://api.deepseek.com/v1/chat/completions";
export const DEEPSEEK_MODEL = "deepseek-v4-flash";

export interface DeepSeekResponseMeta {
  requestId: string | null;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  hasReasoningContent: boolean;
  reasoningChars: number;
}

export interface DeepSeekResponseMetaReader {
  clear: () => void;
  capture: (meta: DeepSeekResponseMeta) => void;
  read: () => DeepSeekResponseMeta | null;
}

export function createDeepSeekResponseMetaReader(): DeepSeekResponseMetaReader {
  let current: DeepSeekResponseMeta | null = null;
  return {
    clear: () => { current = null; },
    capture: (meta) => { current = meta; },
    read: () => current,
  };
}

export type DeepSeekResponseErrorCode =
  | "EMPTY_CONTENT"
  | "OUTPUT_TRUNCATED"
  | "CONTENT_FILTERED"
  | "INSUFFICIENT_SYSTEM_RESOURCE";

export class DeepSeekResponseError extends Error {
  readonly code: DeepSeekResponseErrorCode;
  readonly responseMeta: DeepSeekResponseMeta;
  readonly responseChars: number | null;

  constructor(
    code: DeepSeekResponseErrorCode,
    responseMeta: DeepSeekResponseMeta,
    responseChars: number | null,
  ) {
    super("DeepSeek API 返回格式异常：choices[0].message.content 为空或不是字符串");
    this.name = "DeepSeekResponseError";
    this.code = code;
    this.responseMeta = responseMeta;
    this.responseChars = responseChars;
  }
}

export class DeepSeekRequestPayloadTooLargeError extends Error {
  readonly actualBytes: number;
  readonly maxBytes: number;

  constructor(actualBytes: number, maxBytes: number) {
    super(`DeepSeek API请求体为${actualBytes}字节，超过${maxBytes}字节上限`);
    this.name = "DeepSeekRequestPayloadTooLargeError";
    this.actualBytes = actualBytes;
    this.maxBytes = maxBytes;
  }
}

export interface DeepSeekCallOptions {
  thinking?: { type: "disabled" };
  responseFormat?: { type: "json_object" };
  onResponseMeta?: (meta: DeepSeekResponseMeta) => void;
  signal?: AbortSignal;
  maxRequestBytes?: number;
}

/**
 * 调用 DeepSeek Chat API。
 *
 * @param systemPrompt 系统提示词
 * @param userPrompt   用户输入
 * @param maxTokens    最大输出 token 数，默认 800（适合短结构化输出）。
 *                     长文本生成（脚本/分析报告）请显式传入 2000-4000。
 * @param temperature  采样温度，默认 0.3（结构化 JSON 输出用低温度保证稳定性）。
 *                     创意类生成可传 0.7。
 * @param options      按任务开启JSON模式或明确关闭思考模式。
 */
export async function callDeepSeek(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 800,
  temperature = 0.3,
  apiKey?: string,  // 优先使用：来自请求头 X-DeepSeek-Key，不传则退回 process.env.DEEPSEEK_API_KEY
  options: DeepSeekCallOptions = {},
): Promise<string> {
  const key = apiKey || process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error("未配置 DeepSeek API Key。请在「设置 / API配置」页面填写你的 API Key。");
  }

  const requestBody = JSON.stringify({
    model: DEEPSEEK_MODEL,
    max_tokens: maxTokens,
    temperature,
    ...(options.thinking ? { thinking: options.thinking } : {}),
    ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const requestBytes = new TextEncoder().encode(requestBody).byteLength;
  if (options.maxRequestBytes !== undefined && requestBytes > options.maxRequestBytes) {
    throw new DeepSeekRequestPayloadTooLargeError(requestBytes, options.maxRequestBytes);
  }

  const res = await fetch(DEEPSEEK_API, {
    method: "POST",
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: requestBody,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(无响应体)");
    throw new Error(`DeepSeek API 请求失败（HTTP ${res.status}）：${body}`);
  }

  const data = await res.json();
  const message = data.choices?.[0]?.message;
  const reasoningContent = message?.reasoning_content;
  const responseMeta: DeepSeekResponseMeta = {
    requestId: typeof data.id === "string" ? data.id : null,
    finishReason: typeof data.choices?.[0]?.finish_reason === "string" ? data.choices[0].finish_reason : null,
    promptTokens: typeof data.usage?.prompt_tokens === "number" ? data.usage.prompt_tokens : null,
    completionTokens: typeof data.usage?.completion_tokens === "number" ? data.usage.completion_tokens : null,
    totalTokens: typeof data.usage?.total_tokens === "number" ? data.usage.total_tokens : null,
    reasoningTokens: typeof data.usage?.completion_tokens_details?.reasoning_tokens === "number"
      ? data.usage.completion_tokens_details.reasoning_tokens
      : null,
    hasReasoningContent: typeof reasoningContent === "string" && reasoningContent.length > 0,
    reasoningChars: typeof reasoningContent === "string" ? reasoningContent.length : 0,
  };
  options.onResponseMeta?.(responseMeta);
  const content = message?.content;
  if (typeof content !== "string" || !content.trim()) {
    const code: DeepSeekResponseErrorCode = responseMeta.finishReason === "length"
      ? "OUTPUT_TRUNCATED"
      : responseMeta.finishReason === "content_filter"
        ? "CONTENT_FILTERED"
        : responseMeta.finishReason === "insufficient_system_resource"
          ? "INSUFFICIENT_SYSTEM_RESOURCE"
          : "EMPTY_CONTENT";
    throw new DeepSeekResponseError(
      code,
      responseMeta,
      typeof content === "string" ? content.length : null,
    );
  }
  return content;
}

/**
 * 从 DeepSeek 返回的文本里安全提取 JSON 对象（{}）。
 * 自动去除 Markdown 代码块包裹（```json ... ```）。
 * 解析失败时返回 fallback，不抛出异常——调用方应根据 fallback 值判断是否需要报错。
 */
export function parseDeepSeekJSON<T>(text: string, fallback: T): T {
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    // 优先匹配 {...}，兼容 AI 在 JSON 前后多输出了说明文字的情况
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    return JSON.parse(match[0]) as T;
  } catch {
    return fallback;
  }
}

/**
 * 从 DeepSeek 返回的文本里安全提取 JSON 数组（[]）。
 */
export function parseDeepSeekJSONArray<T>(text: string, fallback: T[]): T[] {
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) return fallback;
    return JSON.parse(match[0]) as T[];
  } catch {
    return fallback;
  }
}

/**
 * 按中文标点切句。
 * 用于 DNA 分析等需要句子级标注的场景——切句由代码做，不依赖 AI，
 * 保证后续"字数占比"统计的分母是确定值而不是 AI 估算的数字。
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？\n])/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}
