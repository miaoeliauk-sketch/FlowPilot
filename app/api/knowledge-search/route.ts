import { NextRequest, NextResponse } from "next/server";
import { callStructuredDeepSeek } from "@/lib/structured-deepseek";
import {
  searchKnowledgeEntries,
  searchKnowledgeEntriesWithIntent,
  SearchableKnowledgeEntry,
  TopicIntentLike,
} from "@/lib/knowledge-search-utils";

const TOPIC_TYPES = [
  "教程类",
  "反常识类",
  "对比决策类",
  "清单盘点类",
  "案例复盘类",
  "观点评论类",
  "记录日常类",
  "促销转化类",
] as const;

const METHOD_LIBRARIES = [
  "定位方法库",
  "选题方法库",
  "标题方法库",
  "开头方法库",
  "文案框架方法库",
] as const;

const MAX_METHOD_KEYWORD_LENGTH = 30;

const INTENT_SYSTEM_PROMPT = `你是短视频方法论检索的意图理解器。
请把用户输入转换成方法论语言，供本地知识检索使用。

要求：
1. topicType只能是：${TOPIC_TYPES.join("、")}。
2. relevantLibraries必须从以下方法库选择1至3项：${METHOD_LIBRARIES.join("、")}。
3. methodKeywords提供1至10个方法论关键词，每项不超过${MAX_METHOD_KEYWORD_LENGTH}个字符，不要照抄具体产品名、人名或地名。
4. 严格输出JSON对象，不要输出其他文字。`;

function buildIntentUserPrompt(query: string) {
  return `请分析以下输入：
"""
${query}
"""

严格按以下JSON结构输出：
{
  "topicType": "合法选题类型",
  "audienceGuess": "目标人群",
  "corePainPoint": "核心痛点或欲望",
  "relevantLibraries": ["应参考的方法库"],
  "methodKeywords": ["方法论关键词"],
  "reasoning": "判断理由"
}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`意图字段${field}无效`);
  }
  return value.trim();
}

function parseTopicIntent(content: string): TopicIntentLike {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) throw new Error("意图响应必须是JSON对象");

  const topicType = requireNonEmptyString(parsed.topicType, "topicType");
  if (!(TOPIC_TYPES as readonly string[]).includes(topicType)) {
    throw new Error("意图字段topicType不在允许范围内");
  }

  if (
    !Array.isArray(parsed.relevantLibraries) ||
    parsed.relevantLibraries.length < 1 ||
    parsed.relevantLibraries.length > 3
  ) {
    throw new Error("意图字段relevantLibraries必须包含1至3项");
  }
  const relevantLibraries = parsed.relevantLibraries.map((library) =>
    requireNonEmptyString(library, "relevantLibraries")
  );
  if (
    relevantLibraries.some(
      (library) => !(METHOD_LIBRARIES as readonly string[]).includes(library),
    )
  ) {
    throw new Error("意图字段relevantLibraries包含非法方法库");
  }

  if (
    !Array.isArray(parsed.methodKeywords) ||
    parsed.methodKeywords.length < 1 ||
    parsed.methodKeywords.length > 10
  ) {
    throw new Error("意图字段methodKeywords必须包含1至10项");
  }
  const methodKeywords = parsed.methodKeywords.map((keyword) => {
    const normalized = requireNonEmptyString(keyword, "methodKeywords");
    if (normalized.length < 2) throw new Error("方法论关键词不能少于2个字符");
    if (normalized.length > MAX_METHOD_KEYWORD_LENGTH) {
      throw new Error(`方法论关键词不能超过${MAX_METHOD_KEYWORD_LENGTH}个字符`);
    }
    return normalized;
  });

  return {
    topicType,
    audienceGuess: requireNonEmptyString(parsed.audienceGuess, "audienceGuess"),
    corePainPoint: requireNonEmptyString(parsed.corePainPoint, "corePainPoint"),
    relevantLibraries: Array.from(new Set(relevantLibraries)),
    methodKeywords: Array.from(new Set(methodKeywords)),
    reasoning: requireNonEmptyString(parsed.reasoning, "reasoning"),
  };
}

async function extractTopicIntent(
  query: string,
  apiKey: string,
): Promise<TopicIntentLike | null> {
  try {
    const result = await callStructuredDeepSeek({
      systemPrompt: INTENT_SYSTEM_PROMPT,
      userPrompt: buildIntentUserPrompt(query),
      parse: parseTopicIntent,
      apiKey,
      maxTokens: 400,
      temperature: 0.2,
    });
    return result.data;
  } catch {
    return null;
  }
}

/**
 * /api/knowledge-search · Plan B 意图检索版
 *
 * 流程：
 *   1. 用一次轻量 DeepSeek 调用把选题翻译成方法论意图（类型/人群/痛点/应参考的方法库/方法论关键词）
 *   2. 用意图对字面检索结果加权：分类命中 +8，方法论关键词命中 +2~4
 *   3. 全部落空时兜底返回意图相关方法库的头部卡（低度相关·宽泛参考）
 *   4. AI 失败/没配 key → 自动降级为纯字面检索，页面不受影响
 *
 * 响应契约已由旧版的 { results, apiMeta } 调整为 { results, debug }。
 * debug 包含 intentUsed/topicType/intentLibraries/intentKeywords/fallbackMode 字段，
 * 前端检索调试面板不改也能跑，改了能显示更有用的信息。
 */

interface RequestBody {
  query?: string;
  entries?: SearchableKnowledgeEntry[];
  /** 可选：跳过意图提取（比如知识库中心的普通关键词搜索场景不需要烧这次AI调用） */
  skipIntent?: boolean;
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: RequestBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  const query = (body.query ?? "").trim();
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (!query) return NextResponse.json({ error: "请提供检索词" }, { status: 400 });
  if (entries.length === 0) {
    // 没有可检索的条目，返回空结果而不是报错——前端逻辑依赖这一点
    return NextResponse.json({ results: [], debug: { queryKeywords: [], expandedKeywords: [], ignoredKeywords: [], intentUsed: false } });
  }

  // ── 第一步：意图提取（可跳过、可失败，都不阻塞检索） ──
  const intent = body.skipIntent ? null : await extractTopicIntent(query, apiKey);

  // ── 第二步：检索 ──
  const { results, debug } = intent
    ? searchKnowledgeEntriesWithIntent(query, entries, intent, { limit: 8, minScore: 2 })
    : (() => {
        const r = searchKnowledgeEntries(query, entries, { limit: 8, minScore: 2 });
        return { results: r.results, debug: { ...r.debug, intentUsed: false as const } };
      })();

  return NextResponse.json({ results, debug });
}
