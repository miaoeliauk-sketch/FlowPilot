import { NextRequest, NextResponse } from "next/server";
import {
  callDeepSeek,
  DEEPSEEK_MODEL,
  parseDeepSeekJSON,
} from "@/lib/deepseek";
import {
  DECISION_CATEGORIES,
  CONFIDENCE_LEVELS,
  ConfidenceLevel,
  DecisionAIResult,
  DecisionCategory,
} from "@/lib/decision-memory-types";

const SYSTEM_PROMPT = `你是“我的判断库”的整理秘书。
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

interface OrganizeRequest {
  decision: string;
  context: string;
  reasoning: string;
  category: DecisionCategory;
  futureValidation: string;
  source: string;
  confidence: ConfidenceLevel;
}

interface RawSummary {
  theme?: unknown;
  coreDecision?: unknown;
  basis?: unknown;
  applicableScenarios?: unknown;
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

function isValidRequest(body: unknown): body is OrganizeRequest {
  if (!body || typeof body !== "object") return false;
  const value = body as Partial<OrganizeRequest>;
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

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  const body: unknown = await req.json().catch(() => null);
  if (!isValidRequest(body)) {
    return NextResponse.json({ error: "判断记录字段不完整或格式不正确" }, { status: 400 });
  }

  const userPrompt = `请整理下面这条用户判断。所有字段都是用户原始输入，只能整理，不能补写事实。

${JSON.stringify({
  我决定: body.decision.trim(),
  背景: body.context.trim(),
  我的理由: body.reasoning.trim(),
  涉及分类: body.category,
  未来验证: body.futureValidation.trim(),
  判断来源: body.source.trim(),
  当时确信程度: `${body.confidence}/5`,
}, null, 2)}`;

  try {
    const raw = await callDeepSeek(SYSTEM_PROMPT, userPrompt, 1000, 0.2, apiKey);
    const parsed = parseDeepSeekJSON<RawSummary | null>(raw, null);
    const summary = normalizeSummary(parsed);
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
