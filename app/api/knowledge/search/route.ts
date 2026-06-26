/**
 * POST /api/knowledge/search
 *
 * 统一知识库检索接口（V2）
 * 替代旧的 /api/knowledge-search（旧接口继续保留，不删除）
 *
 * 两层检索：
 * 1. 本地过滤：按 type / scene / keyword 快速过滤
 * 2. AI语义排序：用 DeepSeek 从候选集中选出真正相关的条目，并标注引用理由
 *
 * 输出带 knowledgeId，供前端展示"引用来源"
 */

import { NextRequest, NextResponse } from "next/server";
import { callDeepSeek, parseDeepSeekJSONArray } from "@/lib/deepseek";
import { filterKnowledgeItems } from "@/lib/knowledge-adapter";
import { KnowledgeItemType, KnowledgeItemScene } from "@/lib/types";

const SYSTEM = `你是知识库检索助手。你的任务是从候选知识条目中，找出真正和用户查询相关的条目，给出相关性等级和引用理由。

规则：
1. 严格按照候选条目的实际内容判断，不能引入候选条目以外的内容
2. 相关性判断要基于内容语义，不能只看关键词匹配
3. 如果没有强相关条目，返回空数组——宁可少选也不要强行凑数
4. 每条必须说明为什么相关（relevanceReason），引用具体内容特征，不能是空话
5. 严格按JSON数组格式输出，不输出任何其他文字`;

const PROMPT = (query: string, candidates: { id: string; title: string; content: string; type: string; tags: string[] }[]) =>
  `用户查询：「${query}」

候选知识条目（共${candidates.length}条）：
${candidates.map((c, i) => `[${i + 1}] id=${c.id} type=${c.type}
标题：${c.title}
内容摘要：${c.content.slice(0, 200)}${c.content.length > 200 ? "…" : ""}
标签：${c.tags.join("、")}`).join("\n\n")}

请从以上候选中选出真正相关的条目（最多${Math.min(candidates.length, 8)}条），按相关性从高到低排列。

严格按以下JSON数组格式输出：
[
  {
    "id": "条目的id（必须是候选列表中的id，不能编造）",
    "relevanceTier": "高度相关|中度相关|低度相关",
    "relevanceReason": "为什么相关——引用具体内容特征，不能泛泛而谈",
    "citationLabel": "在生成内容时如何引用这条知识（一句话引用说明）"
  }
]`;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";

  let body: {
    query: string;
    types?: KnowledgeItemType[];
    scenes?: KnowledgeItemScene[];
    ipId?: string;
    keyword?: string;
    useAI?: boolean;       // 是否用AI做语义排序，默认true
    limit?: number;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  const query = (body.query ?? "").trim();
  if (!query) return NextResponse.json({ error: "请提供检索查询词" }, { status: 400 });

  const useAI = body.useAI !== false; // 默认使用AI

  // Step 1: 本地过滤——按 type / scene / keyword 快速缩小候选集
  const candidates = filterKnowledgeItems({
    types: body.types,
    scenes: body.scenes,
    ipId: body.ipId,
    keyword: body.keyword,
    limit: 50, // 最多取50条候选，再交给AI排序
  });

  if (candidates.length === 0) {
    return NextResponse.json({
      query, results: [], totalCandidates: 0,
      message: "知识库中暂无符合条件的内容",
    });
  }

  // Step 2: AI语义排序（可选）
  if (!useAI || !apiKey) {
    // 不用AI时直接返回本地过滤结果
    const results = candidates.slice(0, body.limit ?? 8).map(item => ({
      id: item.id,
      type: item.type,
      scene: item.scene,
      title: item.title,
      content: item.content.slice(0, 300),
      tags: item.tags,
      sourceTier: item.sourceTier,
      relevanceTier: "中度相关",
      relevanceReason: "关键词匹配",
      citationLabel: `参考：${item.title}`,
    }));
    return NextResponse.json({ query, results, totalCandidates: candidates.length, aiUsed: false });
  }

  try {
    const candidatesForAI = candidates.slice(0, 20).map(item => ({
      id: item.id,
      title: item.title,
      content: item.content,
      type: item.type,
      tags: item.tags,
    }));

    const raw = await callDeepSeek(SYSTEM, PROMPT(query, candidatesForAI), 1200, 0.2, apiKey);
    const aiResults = parseDeepSeekJSONArray<{
      id: string;
      relevanceTier: string;
      relevanceReason: string;
      citationLabel: string;
    }>(raw, []);

    // 只保留候选集中真实存在的id（防止AI幻觉）
    const validIds = new Set(candidates.map(c => c.id));
    const candidateMap = new Map(candidates.map(c => [c.id, c]));

    const results = aiResults
      .filter(r => r.id && validIds.has(r.id))
      .slice(0, body.limit ?? 8)
      .map(r => {
        const item = candidateMap.get(r.id)!;
        return {
          id: item.id,
          type: item.type,
          scene: item.scene,
          title: item.title,
          content: item.content.slice(0, 300),
          tags: item.tags,
          sourceTier: item.sourceTier,
          relevanceTier: r.relevanceTier,
          relevanceReason: r.relevanceReason,
          citationLabel: r.citationLabel,
        };
      });

    return NextResponse.json({ query, results, totalCandidates: candidates.length, aiUsed: true });
  } catch (err) {
    // AI失败时降级为本地过滤结果
    const fallback = candidates.slice(0, body.limit ?? 8).map(item => ({
      id: item.id,
      type: item.type,
      scene: item.scene,
      title: item.title,
      content: item.content.slice(0, 300),
      tags: item.tags,
      sourceTier: item.sourceTier,
      relevanceTier: "中度相关" as const,
      relevanceReason: "AI检索失败，降级为关键词匹配",
      citationLabel: `参考：${item.title}`,
    }));
    return NextResponse.json({ query, results: fallback, totalCandidates: candidates.length, aiUsed: false, fallback: true });
  }
}
