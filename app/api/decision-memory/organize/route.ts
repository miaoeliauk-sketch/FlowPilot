import { NextRequest, NextResponse } from "next/server";
import {
  callDeepSeek,
  DEEPSEEK_MODEL,
  parseDeepSeekJSON,
} from "@/lib/deepseek";
import {
  DECISION_CATEGORIES,
  CONFIDENCE_LEVELS,
  CONTENT_DECISION_STAGES,
  ConfidenceLevel,
  ContentDecisionStage,
  DecisionAIResult,
  DecisionCategory,
  QuickCaptureAIResult,
} from "@/lib/decision-memory-types";

const SYSTEM_PROMPT = `你是“内容判断库”的整理秘书。
你的职责只有整理用户已经写出的判断，不替用户创造判断，不补充用户没有表达的事实，也不评价判断绝对正确或错误。

整理规则：
1. 忠实保留用户原意，不改变立场。
2. “判断依据”只能来自用户填写的背景和理由。
3. “适用场景”和“核心原则”只能做保守归纳，无法确认时使用空字符串或空数组。
4. 不给出行动命令，不预测结果，不替用户做决定。
5. 只输出一个JSON对象，不要输出Markdown代码块或其他说明。

输出格式：
{
  "theme": "判断主题，20字以内",
  "coreDecision": "核心判断",
  "basis": "判断依据",
  "applicableScenarios": ["适用场景"],
  "corePrinciple": "核心原则",
  "keywords": ["关键词"]
}`;

const QUICK_CAPTURE_SYSTEM_PROMPT = `你是“内容判断库”的结构化翻译官，不是专家或决策者。
用户会用一句自然语言写下“决定做什么，以及为什么”。你的职责是忠实整理这句话，生成一张可编辑的内容判断卡。

边界：
1. 核心判断必须忠实保留用户的最终决定，不改变方向，也不把不确定判断改成确定结论。
2. 判断依据只能来自用户原始输入。不得补充用户没有表达的理由、事实、数据或价值判断。
3. 适用IP只能来自用户原话或系统提供的当前IP名称；无法确认时使用空字符串。
4. 未来验证建议应给出一个简短、可修改的验证草稿，可使用发布后的收藏、评论、主页访问或咨询等通用内容反馈，但不得把建议写进“判断依据”，也不得冒充用户已经做出的判断。
5. 核心原则只能保守总结原话中已经存在的关系或方法；原话没有明确原则时使用空字符串。
6. 不评价判断绝对正确或错误，不生成评分，不替用户做决定。
7. 只输出一个json对象，不要输出Markdown代码块或其他说明。

涉及环节只能选择以下一个值：
${CONTENT_DECISION_STAGES.join("、")}

目标json结构：
{
  "theme": "判断主题，20字以内",
  "coreDecision": "核心判断",
  "basis": "判断依据，只能使用原话信息",
  "contentStage": "选题判断",
  "applicableIP": "适用IP，没有则为空字符串",
  "futureValidationSuggestion": "未来验证建议，可为空字符串",
  "corePrinciple": "核心原则，可为空字符串",
  "keywords": ["关键词1", "关键词2", "关键词3"]
}`;

interface FullOrganizeRequest {
  decision: string;
  context: string;
  reasoning: string;
  category: DecisionCategory;
  futureValidation: string;
  source: string;
  confidence: ConfidenceLevel;
}

interface QuickCaptureRequest {
  mode: "quick_capture";
  rawInput: string;
  activeIPName?: string;
}

interface RawSummary {
  theme?: unknown;
  coreDecision?: unknown;
  basis?: unknown;
  applicableScenarios?: unknown;
  corePrinciple?: unknown;
  keywords?: unknown;
}

interface RawQuickCaptureSummary {
  theme?: unknown;
  coreDecision?: unknown;
  basis?: unknown;
  contentStage?: unknown;
  applicableIP?: unknown;
  futureValidationSuggestion?: unknown;
  corePrinciple?: unknown;
  keywords?: unknown;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeSummary(value: unknown): DecisionAIResult | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as RawSummary;
  if (
    typeof raw.theme !== "string" ||
    typeof raw.coreDecision !== "string" ||
    typeof raw.basis !== "string" ||
    !Array.isArray(raw.applicableScenarios) ||
    typeof raw.corePrinciple !== "string" ||
    !Array.isArray(raw.keywords)
  ) {
    return null;
  }
  const summary: DecisionAIResult = {
    theme: normalizeString(raw.theme).slice(0, 40),
    coreDecision: normalizeString(raw.coreDecision),
    basis: normalizeString(raw.basis),
    applicableScenarios: normalizeStringArray(raw.applicableScenarios),
    corePrinciple: normalizeString(raw.corePrinciple),
    keywords: normalizeStringArray(raw.keywords),
    model: DEEPSEEK_MODEL,
  };

  if (!summary.theme || !summary.coreDecision || !summary.basis) return null;
  return summary;
}

function normalizeQuickCaptureSummary(
  value: unknown,
): QuickCaptureAIResult | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as RawQuickCaptureSummary;
  if (
    typeof raw.theme !== "string" ||
    typeof raw.coreDecision !== "string" ||
    typeof raw.basis !== "string" ||
    typeof raw.contentStage !== "string" ||
    typeof raw.applicableIP !== "string" ||
    typeof raw.futureValidationSuggestion !== "string" ||
    typeof raw.corePrinciple !== "string" ||
    !Array.isArray(raw.keywords) ||
    !CONTENT_DECISION_STAGES.includes(raw.contentStage as ContentDecisionStage)
  ) {
    return null;
  }

  const summary: QuickCaptureAIResult = {
    theme: normalizeString(raw.theme).slice(0, 40),
    coreDecision: normalizeString(raw.coreDecision),
    basis: normalizeString(raw.basis),
    contentStage: raw.contentStage as ContentDecisionStage,
    applicableIP: normalizeString(raw.applicableIP),
    futureValidationSuggestion: normalizeString(raw.futureValidationSuggestion),
    corePrinciple: normalizeString(raw.corePrinciple),
    keywords: normalizeStringArray(raw.keywords).slice(0, 6),
    model: DEEPSEEK_MODEL,
  };

  if (
    !summary.theme ||
    !summary.coreDecision ||
    !summary.basis ||
    summary.keywords.length < 3
  ) {
    return null;
  }
  return summary;
}

function isValidFullRequest(body: unknown): body is FullOrganizeRequest {
  if (!body || typeof body !== "object") return false;
  const value = body as Partial<FullOrganizeRequest>;
  return Boolean(
    typeof value.decision === "string" &&
    value.decision.trim() &&
    typeof value.context === "string" &&
    value.context.trim() &&
    typeof value.reasoning === "string" &&
    value.reasoning.trim() &&
    DECISION_CATEGORIES.includes(value.category as DecisionCategory) &&
    typeof value.futureValidation === "string" &&
    value.futureValidation.trim() &&
    typeof value.source === "string" &&
    value.source.trim() &&
    CONFIDENCE_LEVELS.includes(value.confidence as ConfidenceLevel),
  );
}

function isValidQuickCaptureRequest(
  body: unknown,
): body is QuickCaptureRequest {
  if (!body || typeof body !== "object") return false;
  const value = body as Partial<QuickCaptureRequest>;
  return Boolean(
    value.mode === "quick_capture" &&
    typeof value.rawInput === "string" &&
    value.rawInput.trim() &&
    (value.activeIPName === undefined ||
      typeof value.activeIPName === "string"),
  );
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  const body: unknown = await req.json().catch(() => null);
  const quickCapture = isValidQuickCaptureRequest(body);
  if (!quickCapture && !isValidFullRequest(body)) {
    return NextResponse.json({ error: "判断记录字段不完整或格式不正确" }, { status: 400 });
  }

  const systemPrompt = quickCapture
    ? QUICK_CAPTURE_SYSTEM_PROMPT
    : SYSTEM_PROMPT;
  const userPrompt = quickCapture
    ? `请把下面的一句话判断整理成目标json。

用户原始输入：
${body.rawInput.trim()}

系统提供的可选真实上下文：
当前IP名称：${body.activeIPName?.trim() || "未提供"}

当前IP名称只能用于“适用IP”，不能作为新的判断依据。`
    : `请整理下面这条用户判断。所有字段都是用户原始输入，只能整理，不能补写事实。

${JSON.stringify({
  我决定: body.decision.trim(),
  背景: body.context.trim(),
  我的理由: body.reasoning.trim(),
  涉及分类: body.category,
}, null, 2)}`;

  try {
    const raw = await callDeepSeek(
      systemPrompt,
      userPrompt,
      quickCapture ? 1400 : 1200,
      0.2,
      apiKey,
      {
        thinking: { type: "disabled" },
        responseFormat: { type: "json_object" },
      },
    );
    const parsed = parseDeepSeekJSON<RawSummary | RawQuickCaptureSummary | null>(raw, null);
    const summary = quickCapture
      ? normalizeQuickCaptureSummary(parsed)
      : normalizeSummary(parsed);
    if (!summary) {
      return NextResponse.json(
        { error: "AI返回内容无法安全整理，请重试" },
        { status: 502 },
      );
    }
    return NextResponse.json({ summary });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "";
    const message = rawMessage.includes("未配置 DeepSeek API Key")
      ? rawMessage
      : "DeepSeek服务暂时无法完成整理，请在设置中测试连接后重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
