import { NextRequest, NextResponse } from "next/server";
import {
  callStructuredDeepSeek,
  StructuredDeepSeekError,
} from "@/lib/structured-deepseek";

// 这是固定的边界声明，不依赖AI生成——保证这条边界100%出现，不会因为AI某次输出漏掉而消失
const BOUNDARY_NOTE = "以上拆解只分析原文「怎么说」（结构、节奏、修辞、情绪基调），不对原文「说的是什么」做对错、价值观或专业性判断。如果原文观点本身有问题，这个工具不会发现也不会指出，需要你自己判断。";
const BREAKDOWN_MAX_TOKENS = 1_800;

interface BreakdownResponse {
  coreElements: {
    viewpoint: string;
    cases: string[];
    logic: string;
    conclusion: string;
  };
  expressionAnalysis: {
    openingHook: string;
    narrativeRhythm: string;
    emotionalTone: string;
    rhetoricDevices: string[];
    closingStyle: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  field: string,
) {
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actualKeys.length !== expected.length || actualKeys.some((key, index) => key !== expected[index])) {
    throw new Error(`${field}字段不完整或包含额外内容`);
  }
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field}必须是非空字符串`);
  }
  return value.trim();
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field}必须是数组`);
  return value.map((item, index) => requireNonEmptyString(item, `${field}[${index}]`));
}

function parseBreakdownResponse(content: string): BreakdownResponse {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) throw new Error("拆解响应必须是JSON对象");
  requireExactKeys(parsed, ["coreElements", "expressionAnalysis"], "拆解响应");

  if (!isRecord(parsed.coreElements)) throw new Error("coreElements必须是对象");
  requireExactKeys(parsed.coreElements, ["viewpoint", "cases", "logic", "conclusion"], "coreElements");

  if (!isRecord(parsed.expressionAnalysis)) throw new Error("expressionAnalysis必须是对象");
  requireExactKeys(
    parsed.expressionAnalysis,
    ["openingHook", "narrativeRhythm", "emotionalTone", "rhetoricDevices", "closingStyle"],
    "expressionAnalysis",
  );

  return {
    coreElements: {
      viewpoint: requireNonEmptyString(parsed.coreElements.viewpoint, "coreElements.viewpoint"),
      cases: requireStringArray(parsed.coreElements.cases, "coreElements.cases"),
      logic: requireNonEmptyString(parsed.coreElements.logic, "coreElements.logic"),
      conclusion: requireNonEmptyString(parsed.coreElements.conclusion, "coreElements.conclusion"),
    },
    expressionAnalysis: {
      openingHook: requireNonEmptyString(parsed.expressionAnalysis.openingHook, "expressionAnalysis.openingHook"),
      narrativeRhythm: requireNonEmptyString(parsed.expressionAnalysis.narrativeRhythm, "expressionAnalysis.narrativeRhythm"),
      emotionalTone: requireNonEmptyString(parsed.expressionAnalysis.emotionalTone, "expressionAnalysis.emotionalTone"),
      rhetoricDevices: requireStringArray(parsed.expressionAnalysis.rhetoricDevices, "expressionAnalysis.rhetoricDevices"),
      closingStyle: requireNonEmptyString(parsed.expressionAnalysis.closingStyle, "expressionAnalysis.closingStyle"),
    },
  };
}

const BREAKDOWN_SYSTEM = `你是一位内容结构分析师，任务是拆解一段口播文案/逐字稿的内部结构，为后续的"风格化改写"提供锁定基准。

你必须严格遵守一条边界：你只分析这段内容"是怎么表达的"，绝不评价、纠正、暗示或质疑这段内容"说的对不对""观点是否合适""是否有依据"。即使你认为原文某个观点存疑、片面或者有争议，你也不能在任何字段里流露出这种判断——你的角色是结构分析师，不是内容审核员或事实核查员。如果原文包含数据/案例，你只描述"作者用它来论证什么"，不评估这些数据/案例本身是否准确可靠。

拆解出的"核心观点/核心案例/核心逻辑/核心结论"这四项，将在后续改写阶段被锁定为不可更改的硬约束，所以必须准确、完整地反映原文，不要加入你自己的归纳升华或简化，保持贴近原文的实际表述。

严格按JSON格式输出，不要输出任何其他文字。`;

const BREAKDOWN_PROMPT = (text: string) => `请拆解以下原始内容：

"""
${text}
"""

请严格按以下JSON格式输出：
{
  "coreElements": {
    "viewpoint": "这段内容的核心观点是什么，用原文的实际表述方式概括，不要替换成你自己的措辞",
    "cases": ["原文用到的案例/数据/例子，逐条列出，没有就给空数组"],
    "logic": "核心论证逻辑链，例如'先抛现象，再归因，最后给方法'，描述结构而不是复述内容",
    "conclusion": "核心结论或行动号召是什么"
  },
  "expressionAnalysis": {
    "openingHook": "开头用了什么方式抓住注意力，具体描述手法（例如：用提问引发好奇/用反常识陈述制造冲突/直接抛结论），不要评价好不好",
    "narrativeRhythm": "叙事节奏和句子长度特征，例如'短句密集，平均5-8字一句，靠快速转折制造紧迫感'",
    "emotionalTone": "情绪基调，例如'克制理性，少感叹号，靠数据和逻辑而非情绪渲染说服人'",
    "rhetoricDevices": ["用到的修辞/表达手法，例如对比、反问、类比、重复强调，列出实际用到的，没有明显手法就给空数组"],
    "closingStyle": "结尾/收尾方式，例如'用一句总结性金句收尾，没有明显的互动引导'"
  }
}`;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: unknown;
  try { body = await req.json(); }
  catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  if (!isRecord(body) || (body.sourceText !== undefined && typeof body.sourceText !== "string")) {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const text = (body.sourceText ?? "").trim();
  if (!text) {
    return NextResponse.json(
      { error: "请提供要拆解的原始内容" },
      { status: 400 }
    );
  }

  const calledAt = new Date().toISOString();
  const diagnosticId = crypto.randomUUID();

  try {
    const result = await callStructuredDeepSeek({
      systemPrompt: BREAKDOWN_SYSTEM,
      userPrompt: BREAKDOWN_PROMPT(text),
      parse: parseBreakdownResponse,
      buildParseRetryInstruction: () => "上次输出不是完整合法的JSON对象。请严格按指定结构重新输出，不要添加解释、代码块或额外字段。",
      apiKey,
      maxTokens: BREAKDOWN_MAX_TOKENS,
      temperature: 0.3,
    });

    return NextResponse.json({
      coreElements: result.data.coreElements,
      expressionAnalysis: result.data.expressionAnalysis,
      boundaryNote: BOUNDARY_NOTE,
    });
  } catch (err) {
    const structuredError = err instanceof StructuredDeepSeekError ? err : null;
    const attempts = structuredError?.attemptDiagnostics.map(attempt => ({
      attempt: attempt.attempt,
      stage: attempt.stage,
      failureCode: attempt.failureCode ?? "PROCESSING_FAILED",
      finishReason: attempt.finishReason,
      completionTokens: attempt.completionTokens,
      responseChars: attempt.responseChars,
      hasReasoningContent: attempt.hasReasoningContent ?? false,
      reasoningChars: attempt.reasoningChars ?? 0,
    })) ?? [];
    const failureCode = attempts.at(-1)?.failureCode ?? "PROCESSING_FAILED";
    console.warn("[copy-optimization-breakdown]", JSON.stringify({
      diagnosticId,
      calledAt,
      phase: "breakdown",
      inputChars: text.length,
      maxTokens: BREAKDOWN_MAX_TOKENS,
      failureCode,
      attempts,
    }));
    return NextResponse.json(
      { error: "内容拆解失败，请重试" },
      { status: 502 },
    );
  }
}
