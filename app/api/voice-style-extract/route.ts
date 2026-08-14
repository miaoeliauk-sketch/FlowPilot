import { NextRequest, NextResponse } from "next/server";
import { DEEPSEEK_MODEL as MODEL } from "@/lib/deepseek";
import {
  callStructuredDeepSeek,
  StructuredDeepSeekError,
  type StructuredDeepSeekAttemptDiagnostic,
} from "@/lib/structured-deepseek";
import { parseVoiceStyleResponse } from "@/lib/voice-style-profile";

interface SampleInput {
  id: string;
  title: string;
  rawText: string;
}

interface RequestBody {
  ipName?: string;
  samples?: SampleInput[];
}

const MAX_SAMPLE_COUNT = 5;
const MAX_IP_NAME_CHARS = 100;
const MAX_SAMPLE_TITLE_CHARS = 200;
const MAX_SAMPLE_CHARS = 8_000;
const MAX_TOTAL_CHARS = 30_000;
const MAX_TOKENS = 2_500;
const TIMEOUT_MS = 60_000;
const MAX_RETRIES = 1;

const EXTRACT_SYSTEM = `你是一位资深的内容风格分析师，专门从一个人/一个账号的多篇真实口播逐字稿中，反向提炼出这个人独特的“语感画像”，
目的是让后续的AI改写能真正写出“像这个人在说话”的效果，而不是泛泛的风格分类。

你必须做到具体、可执行、有证据支撑，严禁输出“理性”“专业”“有深度”这类空洞标签而不给出具体例子。
每一项结论都应该能让人指着某一句原文说“对，就是这种感觉”。
句子长度的判断要基于实际逐字稿里的句子做统计感受，不是猜测。
禁用表达要重点找“AI生成感”强的、和这个人真实语感不符的表达（比如过于书面、过于客套、过于宏大空洞的词），而不是泛泛而谈。
严格按JSON格式输出，不要输出任何其他文字。`;

const EXTRACT_PROMPT = (ipName: string, samplesText: string) => `分析对象：${ipName}

以下是这个IP的多篇真实口播逐字稿样本，请逐篇通读后提炼出统一的风格画像：

${samplesText}

请严格按以下JSON格式输出：
{
  "openingHabits": ["从样本中实际出现过的开头句式或开头模式，3-5条，尽量贴近原文措辞，不要泛化成抽象描述"],
  "viewpointStyle": "这个人表达观点的方式（例如：先抛结论再补案例 / 先讲一个故事再引出观点 / 先说现象再拆解本质），1-2句话，要具体",
  "sentenceLength": "短句为主 | 中句为主 | 长句为主 | 长短句结合，根据样本实际句子长度分布判断，四选一",
  "emotionalTone": ["情绪风格标签，2-4个，例如理性、犀利、陪伴感、操盘手视角、导师型、朋友型，必须是样本里真实体现出来的，不要套模板"],
  "commonPhrases": ["从样本中提取的真实高频词/口头禅，5-10个"],
  "closingHabits": ["从样本中实际出现过的结尾方式，3-5条，例如具体的引导语句式"],
  "forbiddenExpressions": ["这个人明显不会说的话/不符合其真实语感的AI味表达或书面语，3-6条，给出具体词句而不是空泛分类"],
  "styleSummary": "用3-4句话，像介绍一个真实的人一样，描述这个IP说话的整体感觉，要让人读完能在脑子里听见这个人的声音"
}`;

type SafeAttemptDiagnostic = Pick<StructuredDeepSeekAttemptDiagnostic,
  | "attempt"
  | "stage"
  | "failureCode"
  | "responseChars"
  | "finishReason"
  | "promptTokens"
  | "completionTokens"
  | "totalTokens"
  | "reasoningTokens"
  | "hasReasoningContent"
  | "reasoningChars">;

interface SafeDiagnostic {
  diagnosticId: string;
  calledAt: string;
  sampleCount: number;
  totalInputChars: number;
  attempts: number;
  failureCode: string;
  attemptDiagnostics: SafeAttemptDiagnostic[];
}

function safeAttemptDiagnostics(
  attempts: StructuredDeepSeekAttemptDiagnostic[],
): SafeAttemptDiagnostic[] {
  return attempts.map((attempt) => ({
    attempt: attempt.attempt,
    stage: attempt.stage,
    failureCode: attempt.failureCode,
    responseChars: attempt.responseChars,
    finishReason: attempt.finishReason,
    promptTokens: attempt.promptTokens,
    completionTokens: attempt.completionTokens,
    totalTokens: attempt.totalTokens,
    reasoningTokens: attempt.reasoningTokens,
    hasReasoningContent: attempt.hasReasoningContent,
    reasoningChars: attempt.reasoningChars,
  }));
}

function baseMeta(calledAt: string, ipUsed: string | null) {
  return {
    calledAt,
    model: MODEL,
    ipUsed,
    mockHit: false,
  };
}

function requestError(
  code: string,
  error: string,
  calledAt: string,
  ipUsed: string | null,
) {
  return NextResponse.json({
    code,
    error,
    apiMeta: { apiCalled: false, ...baseMeta(calledAt, ipUsed) },
  }, { status: 400 });
}

function lastFailureCode(error: StructuredDeepSeekError): string {
  for (let index = error.attemptDiagnostics.length - 1; index >= 0; index -= 1) {
    const code = error.attemptDiagnostics[index].failureCode;
    if (code) return code;
  }
  return error.stage === "timeout" ? "TIMEOUT" : "AI_REQUEST_FAILED";
}

function userFacingError(code: string): string {
  switch (code) {
    case "EMPTY_CONTENT":
      return "AI未返回有效的风格画像，已自动重试，请稍后再试";
    case "OUTPUT_TRUNCATED":
      return "AI返回内容被截断，已自动重试，请减少样本后再试";
    case "TIMEOUT":
      return "AI分析超过60秒，已自动重试，请稍后再试";
    case "MISSING_API_KEY":
      return "未配置DeepSeek API Key，请先在设置页面填写";
    case "INVALID_JSON":
      return "AI返回内容不是有效JSON，已自动重试，请稍后再试";
    case "MISSING_FIELD":
    case "INVALID_FIELD_TYPE":
    case "EMPTY_FIELD":
    case "INVALID_FIELD_VALUE":
    case "ARRAY_OUT_OF_RANGE":
    case "UNEXPECTED_FIELD":
    case "INVALID_ROOT":
      return "AI返回的风格画像结构不完整，已自动重试，请稍后再试";
    default:
      return "风格分析失败，已自动重试，请稍后再试";
  }
}

export async function POST(req: NextRequest) {
  const calledAt = new Date().toISOString();
  const diagnosticId = crypto.randomUUID();
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: RequestBody;

  try {
    const parsedBody: unknown = await req.json();
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      return requestError("INVALID_REQUEST", "请求格式错误", calledAt, null);
    }
    body = parsedBody as RequestBody;
  } catch {
    return requestError("INVALID_REQUEST", "请求格式错误", calledAt, null);
  }

  const ipName = typeof body.ipName === "string" && body.ipName.trim()
    ? body.ipName.trim()
    : "未指定IP";
  if (ipName.length > MAX_IP_NAME_CHARS) {
    return requestError(
      "IP_NAME_TOO_LONG",
      `IP名称最多${MAX_IP_NAME_CHARS}字，请缩短后重试`,
      calledAt,
      null,
    );
  }
  if (!Array.isArray(body.samples)) {
    return requestError("INVALID_SAMPLES", "样本格式错误", calledAt, ipName);
  }

  const samples = body.samples.filter((sample): sample is SampleInput => (
    Boolean(sample)
    && typeof sample.id === "string"
    && typeof sample.title === "string"
    && typeof sample.rawText === "string"
    && sample.rawText.trim().length > 0
  ));

  if (samples.length === 0) {
    return requestError(
      "NO_VALID_SAMPLES",
      "至少需要1篇有效的口播逐字稿样本才能学习风格，建议3-5篇",
      calledAt,
      ipName,
    );
  }
  if (samples.length > MAX_SAMPLE_COUNT) {
    return requestError(
      "SAMPLE_COUNT_EXCEEDED",
      `一次最多分析${MAX_SAMPLE_COUNT}篇样本，请取消部分选择后重试`,
      calledAt,
      ipName,
    );
  }

  const oversizedTitle = samples.find((sample) => sample.title.trim().length > MAX_SAMPLE_TITLE_CHARS);
  if (oversizedTitle) {
    return requestError(
      "SAMPLE_TITLE_TOO_LONG",
      `样本标题最多${MAX_SAMPLE_TITLE_CHARS}字，请缩短后重试`,
      calledAt,
      ipName,
    );
  }

  const oversizedSample = samples.find((sample) => sample.rawText.trim().length > MAX_SAMPLE_CHARS);
  if (oversizedSample) {
    return requestError(
      "SAMPLE_TOO_LONG",
      `单篇样本最多${MAX_SAMPLE_CHARS}字，请缩短后重试`,
      calledAt,
      ipName,
    );
  }

  const totalInputChars = samples.reduce(
    (total, sample) => total + sample.rawText.trim().length,
    0,
  );
  if (totalInputChars > MAX_TOTAL_CHARS) {
    return requestError(
      "TOTAL_INPUT_TOO_LONG",
      `样本总字数最多${MAX_TOTAL_CHARS}字，请取消部分选择后重试`,
      calledAt,
      ipName,
    );
  }

  const samplesText = samples
    .map((sample, index) => `【样本${index + 1}：${sample.title || "未命名样本"}】\n${sample.rawText.trim()}`)
    .join("\n\n");

  try {
    const result = await callStructuredDeepSeek({
      systemPrompt: EXTRACT_SYSTEM,
      userPrompt: EXTRACT_PROMPT(ipName, samplesText),
      parse: parseVoiceStyleResponse,
      apiKey,
      maxTokens: MAX_TOKENS,
      temperature: 0.3,
      timeoutMs: TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
    });

    return NextResponse.json({
      ...result.data,
      sourceSampleIds: samples.map((sample) => sample.id),
      sourceSampleTitles: samples.map((sample) => sample.title || "未命名样本"),
      extractedAt: calledAt,
      model: MODEL,
      apiMeta: {
        apiCalled: true,
        ...baseMeta(calledAt, ipName),
        diagnosticId,
        attempts: result.attempts,
        attemptDiagnostics: result.attemptDiagnostics,
      },
    });
  } catch (error) {
    if (!(error instanceof StructuredDeepSeekError)) {
      const failureCode = "UNEXPECTED_ERROR";
      const diagnostic: SafeDiagnostic = {
        diagnosticId,
        calledAt,
        sampleCount: samples.length,
        totalInputChars,
        attempts: 0,
        failureCode,
        attemptDiagnostics: [],
      };
      console.error("[voice-style-extract]", JSON.stringify(diagnostic));
      return NextResponse.json({
        code: failureCode,
        diagnosticId,
        error: userFacingError(failureCode),
        apiMeta: {
          apiCalled: false,
          ...baseMeta(calledAt, ipName),
          diagnosticId,
          attempts: 0,
          attemptDiagnostics: [],
        },
      }, { status: 500 });
    }

    const failureCode = lastFailureCode(error);
    const diagnostic: SafeDiagnostic = {
      diagnosticId,
      calledAt,
      sampleCount: samples.length,
      totalInputChars,
      attempts: error.attempts,
      failureCode,
      attemptDiagnostics: safeAttemptDiagnostics(error.attemptDiagnostics),
    };
    console.error("[voice-style-extract]", JSON.stringify(diagnostic));

    const status = failureCode === "MISSING_API_KEY"
      ? 400
      : error.stage === "timeout"
        ? 504
        : 502;
    return NextResponse.json({
      code: failureCode,
      diagnosticId,
      error: userFacingError(failureCode),
      apiMeta: {
        apiCalled: failureCode !== "MISSING_API_KEY",
        ...baseMeta(calledAt, ipName),
        diagnosticId,
        attempts: error.attempts,
        attemptDiagnostics: error.attemptDiagnostics,
      },
    }, { status });
  }
}
