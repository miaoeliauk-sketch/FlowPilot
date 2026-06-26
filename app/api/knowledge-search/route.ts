import { NextRequest, NextResponse } from "next/server";

import { callDeepSeek, parseDeepSeekJSON as parseJSON, parseDeepSeekJSONArray, splitSentences, DEEPSEEK_MODEL as MODEL } from "@/lib/deepseek";


const MAX_RESULTS = 5;

interface EntryDigest { id: string; category: string; title: string; tags: string[]; keywords: string[]; }
interface RequestBody { query?: string; entries?: EntryDigest[]; module?: string; }

const SEARCH_SYSTEM = `你是知识库的检索助手，任务是从一批知识条目里挑出和当前输入真正相关的几条。

你必须诚实：这是基于你对文字含义的理解做判断，不是真正的向量相似度计算，所以你只能给定性的相关度档位（高度相关/中度相关/低度相关），绝对不能编造一个看起来精确的百分比数字（比如"相似度87%"）——你没有能力算出这种精确数字，编出来是不诚实的。

宁缺毋滥：如果一条知识跟输入关系很勉强，不要硬选进来凑数量，最多选${MAX_RESULTS}条，选0条也完全可以，没有强相关的就如实返回空数组。

每条入选的，都要说清楚"引用原因"——具体说这条知识哪里跟当前输入相关（比如关键词重合、同类钩子结构、同赛道、能直接回答输入里提出的问题），不能写"内容相关"这种空话。

严格按JSON数组格式输出，不要输出任何其他文字。`;

const SEARCH_PROMPT = (query: string, entries: EntryDigest[]) => `当前输入：
"""
${query}
"""

知识库里现有条目（只给了标题/分类/标签/关键词，没给全文）：
${entries.map((e, i) => `${i + 1}. [id:${e.id}] [${e.category}] ${e.title} | 标签:${e.tags.join("、") || "无"} | 关键词:${e.keywords.join("、") || "无"}`).join("\n")}

请从中挑出真正相关的（最多${MAX_RESULTS}条，没有强相关的可以返回空数组），严格按以下JSON数组格式输出：
[
  {"id": "原样带回id", "reason": "引用原因，具体说哪里相关", "relevanceTier": "高度相关｜中度相关｜低度相关（三选一）", "relevanceReason": "为什么是这个相关度档位"}
]`;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: RequestBody;
  try { body = await req.json(); }
  catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const query = (body.query ?? "").trim();
  const entries = body.entries ?? [];
  if (!query) {
    return NextResponse.json({ error: "缺少检索输入" }, { status: 400 });
  }
  if (entries.length === 0) {
    return NextResponse.json({ results: [], note: "知识库目前没有条目，无法检索" });
  }

  const calledAt = new Date().toISOString();
  const apiMeta = { apiCalled: true, calledAt, model: MODEL, ipUsed: null as string | null, mockHit: false };

  try {
    const raw = await callDeepSeek(SEARCH_SYSTEM, SEARCH_PROMPT(query, entries.slice(0, 200)), 1500, 0.3, apiKey);
    const parsed = parseJSON<{ id: string; reason: string; relevanceTier: string; relevanceReason: string }[]>(raw, []);
    const validTiers = new Set(["高度相关", "中度相关", "低度相关"]);
    const entryIds = new Set(entries.map((e) => e.id));
    const results = parsed.filter((r) => r.id && entryIds.has(r.id) && validTiers.has(r.relevanceTier)).slice(0, MAX_RESULTS);

    return NextResponse.json({ results, apiMeta });
  } catch (err) {
    const message = err instanceof Error ? err.message : "检索失败，请重试";
    return NextResponse.json({ error: message, apiMeta: { ...apiMeta, error: message } }, { status: 500 });
  }
}
