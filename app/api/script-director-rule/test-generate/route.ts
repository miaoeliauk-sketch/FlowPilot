import { NextRequest, NextResponse } from "next/server";

import { DEEPSEEK_MODEL } from "@/lib/deepseek";
import { buildIPContextBlock } from "@/lib/ip-prompt";
import { parseRequiredIPProfile } from "@/lib/ip-profile-validation";
import {
  calculateScriptDirectorRuleContentHash,
  parseScriptDirectorRule,
  type ScriptDirectorRuleTestType,
} from "@/lib/script-director-rule";
import {
  parseScriptDirectorRuleTestGeneration,
} from "@/lib/script-director-rule-test-generation";
import {
  createScriptDirectorRuleTestProof,
  getScriptDirectorRuleProofSecret,
} from "@/lib/script-director-rule-proof";
import { callStructuredDeepSeek, StructuredDeepSeekError } from "@/lib/structured-deepseek";

const TEST_TYPES = new Set<ScriptDirectorRuleTestType>(["familiar", "unfamiliar", "stress"]);
const MAX_TOPIC_CHARS = 500;
const MAX_RULE_CHARS = 50_000;
const MAX_IP_CONTEXT_CHARS = 15_000;
const MAX_KNOWLEDGE_ITEMS = 100;
const MAX_KNOWLEDGE_TITLE_CHARS = 200;
const MAX_KNOWLEDGE_CONTENT_CHARS = 4_000;
const MAX_KNOWLEDGE_CONTEXT_CHARS = 25_000;
const MAX_USER_PROMPT_CHARS = 80_000;
const MAX_TOKENS = 3_500;

const TEST_TYPE_GUIDANCE: Record<ScriptDirectorRuleTestType, string> = {
  familiar: "熟悉题：选择与当前IP既有定位和常见内容方向高度相关的角度，检验规则能否稳定还原日常表达。",
  unfamiliar: "陌生题：面对当前IP较少谈论的主题，只验证表达规则，不得虚构IP经历、立场或事实。",
  stress: "压力题：面对容易诱发模板化、极端判断或事实越界的题目，严格执行禁用表达、推理和事实边界。",
};

const SYSTEM_PROMPT = `你是FlowPilot的专属编导规则测试器。请依据当前IP档案与用户新导入的规则，生成一份可供人工判断规则效果的临时口播稿。

必须遵守：
1. 这是规则测试稿，不是正式脚本；测试稿不得进入正式脚本库或学习数据。
2. 严格执行规则原文，但规则中的格式范例不属于本次创作素材，不得复用范例人物、企业、事件或结论。
3. 不得虚构当前IP的经历、观点、案例或事实。陌生主题只能做一般性表达，并明确克制归属。
4. 只输出JSON对象，且只能包含title和fullScript两个字段。`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestError(error: string, field?: string) {
  return NextResponse.json({
    code: "INVALID_REQUEST",
    error,
    ...(field ? { errorField: field } : {}),
    apiMeta: { apiCalled: false },
  }, { status: 400 });
}

function parseKnowledgeContext(value: unknown, ipId: string) {
  if (!Array.isArray(value) || value.length > MAX_KNOWLEDGE_ITEMS) {
    return { ok: false as const, error: "当前IP知识条目格式错误或数量过多", field: "knowledgeContext" };
  }
  const items: Array<{ id: string; ipId: string; category: string; title: string; rawContent: string }> = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const field = `knowledgeContext[${index}]`;
    if (!isRecord(item)) return { ok: false as const, error: "当前IP知识条目格式错误", field };
    if (item.ipId !== ipId) {
      return { ok: false as const, error: "知识条目不属于当前IP，已拒绝测试", field: `${field}.ipId` };
    }
    if (typeof item.id !== "string" || !item.id.trim()) {
      return { ok: false as const, error: "当前IP知识条目格式错误", field: `${field}.id` };
    }
    if (typeof item.category !== "string" || !item.category.trim()) {
      return { ok: false as const, error: "当前IP知识条目格式错误", field: `${field}.category` };
    }
    if (typeof item.title !== "string" || !item.title.trim() || item.title.length > MAX_KNOWLEDGE_TITLE_CHARS) {
      return { ok: false as const, error: "当前IP知识标题为空或过长", field: `${field}.title` };
    }
    if (typeof item.rawContent !== "string" || item.rawContent.length > MAX_KNOWLEDGE_CONTENT_CHARS) {
      return { ok: false as const, error: "当前IP知识正文过长", field: `${field}.rawContent` };
    }
    items.push({
      id: item.id,
      ipId: item.ipId,
      category: item.category,
      title: item.title,
      rawContent: item.rawContent,
    });
  }
  return { ok: true as const, items };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return requestError("请求格式错误");
  }
  if (!isRecord(body)) return requestError("请求格式错误");

  const parsedIP = parseRequiredIPProfile(body.ipProfile);
  if (!parsedIP.ok) return requestError(parsedIP.error, parsedIP.errorField);
  const parsedRule = parseScriptDirectorRule(body.rule);
  if (!parsedRule.ok) return requestError("专属规则结构不完整，无法测试", "rule");
  if (parsedRule.rule.ipId !== parsedIP.ipProfile.id) {
    return requestError("专属规则不属于当前IP，已拒绝测试", "rule.ipId");
  }
  if (calculateScriptDirectorRuleContentHash(parsedRule.rule.source.rawMarkdown)
    !== parsedRule.rule.source.contentHash) {
    return requestError("专属规则原文与哈希不一致，已拒绝测试", "rule.source.contentHash");
  }
  if (parsedRule.rule.source.rawMarkdown.length > MAX_RULE_CHARS) {
    return requestError(`专属规则原文最多${MAX_RULE_CHARS}字`, "rule.source.rawMarkdown");
  }
  if (!TEST_TYPES.has(body.testType as ScriptDirectorRuleTestType)) {
    return requestError("请求格式错误", "testType");
  }
  if (typeof body.topic !== "string" || !body.topic.trim()) {
    return requestError("请填写测试选题", "topic");
  }
  if (body.topic.trim().length > MAX_TOPIC_CHARS) {
    return requestError(`测试选题最多${MAX_TOPIC_CHARS}字`, "topic");
  }

  const parsedKnowledge = parseKnowledgeContext(body.knowledgeContext, parsedIP.ipProfile.id);
  if (!parsedKnowledge.ok) return requestError(parsedKnowledge.error, parsedKnowledge.field);

  const ipContext = buildIPContextBlock(parsedIP.ipProfile);
  if (ipContext.length > MAX_IP_CONTEXT_CHARS) {
    return requestError("当前IP档案内容过长，请先精简后再测试", "ipProfile");
  }
  const knowledgeBlock = parsedKnowledge.items.length > 0
    ? parsedKnowledge.items.map(item => [
      `编号：${item.id}`,
      `分类：${item.category}`,
      `标题：${item.title}`,
      `内容：${item.rawContent}`,
    ].join("\n")).join("\n\n")
    : "当前IP暂无知识条目。";
  if (knowledgeBlock.length > MAX_KNOWLEDGE_CONTEXT_CHARS) {
    return requestError("当前IP知识内容过多，请先精简后再测试", "knowledgeContext");
  }

  const testType = body.testType as ScriptDirectorRuleTestType;
  const topic = body.topic.trim();
  const userPrompt = `${ipContext}

【当前IP知识库】
${knowledgeBlock}

【测试类型】
${TEST_TYPE_GUIDANCE[testType]}

【用户填写的测试选题】
${topic}

【本次要验证的专属编导规则原文】
${parsedRule.rule.source.rawMarkdown}

输出格式：{"title":"测试稿标题","fullScript":"完整口播正文"}`;
  if (userPrompt.length > MAX_USER_PROMPT_CHARS) {
    return requestError("本次测试输入总量过大，请精简规则或IP资料后重试", "request");
  }

  try {
    const result = await callStructuredDeepSeek({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      parse: content => parseScriptDirectorRuleTestGeneration(content, { testType, topic }),
      buildParseRetryInstruction: failureCode => failureCode === "INVALID_JSON"
        ? "上次输出不是合法JSON，请只输出包含title和fullScript的完整JSON对象。"
        : "上次输出字段不完整，请只保留非空的title和fullScript两个字符串字段。",
      preserveParserErrorCode: true,
      rejectTruncatedOutput: true,
      apiKey: req.headers.get("X-DeepSeek-Key") ?? undefined,
      maxTokens: MAX_TOKENS,
      temperature: 0.6,
      timeoutMs: 60_000,
      maxRetries: 1,
    });
    const proofSecret = await getScriptDirectorRuleProofSecret();
    const testProof = createScriptDirectorRuleTestProof({
      ipId: parsedIP.ipProfile.id,
      ruleId: parsedRule.rule.id,
      contentHash: parsedRule.rule.source.contentHash,
      testType,
    }, proofSecret);
    return NextResponse.json({
      result: result.data,
      temporary: true,
      testProof,
      apiMeta: {
        apiCalled: true,
        model: DEEPSEEK_MODEL,
        attempts: result.attempts,
        attemptDiagnostics: result.attemptDiagnostics,
      },
    });
  } catch (error) {
    if (error instanceof StructuredDeepSeekError) {
      const missingKey = error.attemptDiagnostics.some(item => item.failureCode === "MISSING_API_KEY");
      return NextResponse.json({
        code: missingKey ? "MISSING_API_KEY" : "TEST_GENERATION_FAILED",
        error: missingKey ? "请先在设置中填写DeepSeek API Key" : "测试稿生成失败，已自动重试，请稍后再试",
        apiMeta: { apiCalled: !missingKey, attempts: error.attempts, attemptDiagnostics: error.attemptDiagnostics },
      }, { status: missingKey ? 400 : 502 });
    }
    console.error("[script-director-rule-test-generate]", error);
    return NextResponse.json({
      code: "UNEXPECTED_ERROR",
      error: "测试稿生成失败，请稍后重试",
      apiMeta: { apiCalled: false },
    }, { status: 500 });
  }
}
