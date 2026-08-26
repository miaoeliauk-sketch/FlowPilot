import { NextRequest, NextResponse } from "next/server";
import { parseDeepSeekJSON as parseJSON, DEEPSEEK_MODEL as MODEL } from "@/lib/deepseek";
import {
  callStructuredDeepSeek,
  StructuredDeepSeekError,
} from "@/lib/structured-deepseek";

interface TranscriptCleanResult {
  cleaned: string;
  segmented: string;
  summary: {
    theme: string;
    keyPoints: string[];
    cases: string[];
    quotables: string[];
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function parseTranscriptCleanResult(content: string): TranscriptCleanResult {
  const parsed = parseJSON<unknown>(content, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("逐字稿整理结果不是有效对象");
  }
  const record = parsed as Record<string, unknown>;
  const summary = record.summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    throw new Error("逐字稿整理结果缺少摘要");
  }
  const summaryRecord = summary as Record<string, unknown>;
  if (
    !isNonEmptyString(record.cleaned)
    || !isNonEmptyString(record.segmented)
    || !isNonEmptyString(summaryRecord.theme)
    || !isStringArray(summaryRecord.keyPoints)
    || summaryRecord.keyPoints.length < 3
    || summaryRecord.keyPoints.length > 5
    || !isStringArray(summaryRecord.cases)
    || summaryRecord.cases.length > 3
    || !isStringArray(summaryRecord.quotables)
  ) {
    throw new Error("逐字稿整理结果字段不完整");
  }
  return {
    cleaned: record.cleaned,
    segmented: record.segmented,
    summary: {
      theme: summaryRecord.theme,
      keyPoints: summaryRecord.keyPoints,
      cases: summaryRecord.cases,
      quotables: summaryRecord.quotables,
    },
  };
}

const SYSTEM = `你是逐字稿整理专家。任务是对用户提供的原始口语转写文本做三件事：

1. 清洗版：去除口头禅（嗯、啊、那个、就是、然后等）、明显的重复句子、无意义的停顿词，但不能改变任何原始信息、观点、案例——只清理语言噪音，不改变内容。

2. 分段版：把清洗版按语义和话题自然分段，每段加一个简短的小标题（用【】括起来），方便阅读。

3. 摘要：提炼以下四项——
   - 核心主题（一句话）
   - 关键观点（3-5条，每条一句话）
   - 重点案例（如果有的话，列出1-3个）
   - 可复用金句（原文里有传播价值的表达，原样摘录，不要改写）

必须严格按JSON格式输出，不要输出任何其他文字。`;

const PROMPT = (raw: string) => `原始逐字稿：
"""
${raw}
"""

请严格按以下JSON格式输出：
{
  "cleaned": "清洗后的逐字稿，去除口头禅和重复，不改变内容",
  "segmented": "分段版逐字稿，每段有【小标题】",
  "summary": {
    "theme": "核心主题（一句话）",
    "keyPoints": ["关键观点1", "关键观点2", "关键观点3"],
    "cases": ["案例1（如果有的话）"],
    "quotables": ["可复用金句1（原文原话）", "可复用金句2"]
  }
}`;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: { rawText?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  const rawText = (body.rawText ?? "").trim();
  if (!rawText) {
    return NextResponse.json({ error: "请提供逐字稿文本" }, { status: 400 });
  }
  if (rawText.length < 50) {
    return NextResponse.json({ error: "逐字稿内容太短，请至少提供50个字" }, { status: 400 });
  }

  const calledAt = new Date().toISOString();
  const apiMeta = { apiCalled: true, calledAt, model: MODEL };

  try {
    const result = await callStructuredDeepSeek({
      systemPrompt: SYSTEM,
      userPrompt: PROMPT(rawText),
      apiKey,
      maxTokens: 8_000,
      temperature: 0.3,
      maxRetries: 1,
      rejectTruncatedOutput: true,
      parse: parseTranscriptCleanResult,
      buildParseRetryInstruction: () => (
        "上一次返回的JSON不完整。请重新输出完整JSON，必须包含cleaned、segmented，以及summary中的theme、keyPoints、cases、quotables；不要输出JSON以外的文字。"
      ),
    });
    return NextResponse.json({ ...result.data, apiMeta });
  } catch (err) {
    const structuredError = err instanceof StructuredDeepSeekError ? err : null;
    const causeMessage = structuredError?.cause instanceof Error
      ? structuredError.cause.message
      : "";
    const missingApiKey = causeMessage.includes("未配置 DeepSeek API Key");
    if (structuredError && !missingApiKey) {
      console.error("[transcribe-clean]", JSON.stringify({
        inputChars: rawText.length,
        stage: structuredError.stage,
        attempts: structuredError.attempts,
        attemptDiagnostics: structuredError.attemptDiagnostics,
      }));
    }
    const failureCodes = structuredError?.attemptDiagnostics
      .map(item => item.failureCode)
      .filter((code): code is string => Boolean(code)) ?? [];
    const message = missingApiKey
      ? causeMessage
      : structuredError?.stage === "timeout"
        ? "AI整理超时，已自动重试，请稍后再试。"
        : failureCodes.some(code => code === "REQUEST_FAILED" || code === "INSUFFICIENT_SYSTEM_RESOURCE")
          ? "AI服务请求失败，已自动重试，请稍后再试。"
          : "AI返回格式不完整，已自动重试，请稍后再试。";
    return NextResponse.json(
      { error: message, apiMeta: { ...apiMeta, error: message } },
      { status: missingApiKey ? 500 : 502 },
    );
  }
}
