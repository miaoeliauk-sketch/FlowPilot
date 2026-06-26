import { NextRequest, NextResponse } from "next/server";
import { callDeepSeek, parseDeepSeekJSON as parseJSON, parseDeepSeekJSONArray, splitSentences, DEEPSEEK_MODEL as MODEL } from "@/lib/deepseek";

interface ComparableEntry {
  id: string; title: string; rawContent: string;
  metrics: { likes: number; comments: number; shares: number; favorites: number } | null;
  hookType: string | null;
}
interface RequestBody { title?: string; script?: string; comparables?: ComparableEntry[]; }

const DIMENSIONS = ["标题竞争力", "钩子强度", "用户痛点", "情绪价值", "转发潜力", "评论潜力", "收藏潜力", "商业价值"] as const;

const SYSTEM = `你在做爆款预测打分，这件事必须诚实，绝对禁止凭空编造分数。

规则：
1. 每个维度的打分，必须建立在"我提供给你的真实对标案例"基础上——这些案例的标题/内容/真实互动数据(点赞/评论/转发/收藏，如果有的话)都是真实存在于用户知识库里的，不是你编的。
2. 你要做的判断是：当前这条标题/口播稿，在内容特征上和这些已经验证过的高表现案例有多接近，越接近，分数越高；越远，分数越低。
3. 每个维度必须给出"matchReasoning"——具体说哪些对标案例的什么特征支撑了这个分数，必须能让人对照对标案例核实，不能写"综合判断"这种空话。
4. 如果对标案例数量很少（比如只有1-2条）或者都没有真实互动数据，你必须在reasoning里明确说"样本量小/缺乏真实数据，预测可信度有限"，不能假装很有把握。
5. 分数范围0-100，但分数本身只是你基于案例特征匹配程度给出的估计值，不是精确计算结果，这一点不需要在每条reasoning里重复说，已经在外层统一说明。

严格按JSON格式输出，不要输出任何其他文字。`;

const PROMPT = (title: string, script: string, comparables: ComparableEntry[], avgMetrics: Record<string, number | null>) => `待预测内容：
标题：${title || "（未提供标题）"}
口播稿：
"""
${script || "（未提供口播稿）"}
"""

对标案例（来自知识库，真实数据）：
${comparables.map((c, i) => `${i + 1}. 《${c.title}》钩子类型:${c.hookType ?? "未知"} | 真实数据:${c.metrics ? `点赞${c.metrics.likes} 评论${c.metrics.comments} 转发${c.metrics.shares} 收藏${c.metrics.favorites}` : "无真实数据"}\n内容片段：${c.rawContent.slice(0, 200)}`).join("\n\n")}

这批对标案例的真实数据均值（代码统计，仅供参考）：平均点赞${avgMetrics.likes ?? "无数据"} 平均评论${avgMetrics.comments ?? "无数据"} 平均转发${avgMetrics.shares ?? "无数据"} 平均收藏${avgMetrics.favorites ?? "无数据"}

请为以下8个维度打分：${DIMENSIONS.join("、")}，严格按以下JSON格式输出：
{
  "scores": [
    {"dimension": "维度名", "score": 0-100整数, "matchReasoning": "具体说和哪些对标案例的什么特征接近/不接近"}
  ]
}`;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: RequestBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  const title = (body.title ?? "").trim();
  const script = (body.script ?? "").trim();
  if (!title && !script) {
    return NextResponse.json({ error: "请至少提供标题或口播稿其中一项" }, { status: 400 });
  }

  const comparables = body.comparables ?? [];
  if (comparables.length === 0) {
    return NextResponse.json({
      error: "知识库暂无可比案例，无法给出有依据的预测。请先在知识库中心积累一些爆款案例（带真实互动数据的最好）。",
      noComparables: true,
    }, { status: 400 });
  }

  // 真实均值由代码统计，不经AI——只统计真正带了metrics的案例，没数据的不计入分母
  const withMetrics = comparables.filter(c => c.metrics);
  const avg = (key: keyof NonNullable<ComparableEntry["metrics"]>) =>
    withMetrics.length > 0 ? Math.round(withMetrics.reduce((sum, c) => sum + (c.metrics![key] ?? 0), 0) / withMetrics.length) : null;
  const avgMetrics = { likes: avg("likes"), comments: avg("comments"), shares: avg("shares"), favorites: avg("favorites") };

  const calledAt = new Date().toISOString();
  const apiMeta = { apiCalled: true, calledAt, model: MODEL, ipUsed: null as string | null, mockHit: false };

  try {
    const raw = await callDeepSeek(SYSTEM, PROMPT(title, script, comparables, avgMetrics), 2200, 0.3, apiKey);
    const parsed = parseJSON<{ scores: { dimension: string; score: number; matchReasoning: string }[] }>(raw, { scores: [] });

    return NextResponse.json({
      scores: parsed.scores,
      comparedCount: comparables.length,
      withRealDataCount: withMetrics.length,
      avgMetrics,
      confidenceNote: withMetrics.length === 0
        ? "对标案例均缺少真实互动数据，本次预测可信度较低，仅供参考"
        : comparables.length < 3
          ? "对标案例数量较少，本次预测可信度有限"
          : "预测基于知识库中检索到的真实案例及其真实互动数据",
      apiMeta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "预测失败，请重试";
    return NextResponse.json({ error: message, apiMeta: { ...apiMeta, error: message } }, { status: 500 });
  }
}
