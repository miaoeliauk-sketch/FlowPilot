import { NextRequest, NextResponse } from "next/server";
import { callDeepSeek, parseDeepSeekJSON as parseJSON, parseDeepSeekJSONArray, splitSentences, DEEPSEEK_MODEL as MODEL } from "@/lib/deepseek";

interface IPRef { id: string; name: string; }

interface RequestBody {
  category?: "爆款案例" | "方法论" | "评论";
  rawContent?: string;
  sourcePlatform?: string;
  sourceUrl?: string;
  availableIPs?: IPRef[];
}

const CATEGORY_HINT: Record<string, string> = {
  "爆款案例": "这是一篇爆款内容的逐字稿/文案，提取时关注它为什么可能成为爆款的特征（开头/结构/情绪/选题角度）。",
  "方法论": "这是一段方法论/经验总结类内容，提取时关注它在讲什么具体方法、适用什么场景。",
  "评论": "这是从评论区收集来的用户评论/反馈，提取时关注评论反映出的用户需求、争议点或情绪倾向。",
};

const EXTRACT_SYSTEM = `你是知识库的自动整理助手，任务是给用户粘贴/上传的一段内容打上结构化标签，方便以后被检索复用。

你必须诚实评估"来源等级"，不能为了让条目看起来更有价值就乱给高等级：
- 高：内容里包含可验证的具体信号，例如提供了真实链接、提到了具体可查的播放/点赞数据，或者来源平台明确且内容本身是对真实发布内容的转录（不是用户自己的总结）
- 中：来源平台/大致出处说得清楚，但没有可验证的具体数据，或者是用户对某个内容的转述/整理（不是原文转录）
- 低：来源不明确，或者是用户自己的笔记、感想、二手听说的经验，无法验证真实性

给出来源等级时必须说明具体理由，理由要点出"为什么是这个等级"的具体依据（比如"提供了原始链接"或"没有任何可验证信息，仅为用户笔记"），不能只写"内容可信"这种空话。

所属IP的判断：只有当内容里有明确证据表明属于用户列出的某个IP（比如内容本身就是这个IP发布的、或者用户备注里提到了这个IP名字）才匹配，没有把握就返回null，不要瞎猜。

严格按JSON格式输出，不要输出任何其他文字。`;

const EXTRACT_PROMPT = (category: string, content: string, platform: string, url: string, ips: IPRef[]) => `分类：${category}
${CATEGORY_HINT[category] ?? ""}
来源平台：${platform || "未填写"}
来源链接：${url || "未提供"}
可选所属IP列表：${ips.length > 0 ? ips.map(ip => `${ip.name}(id:${ip.id})`).join("、") : "暂无可选IP"}

内容原文：
"""
${content}
"""

请严格按以下JSON格式输出：
{
  "title": "给这条内容起一个简短标题（不超过25字），概括核心内容",
  "tags": ["3-6个标签，描述内容性质，例如'反问开头'、'对比论证'、'高互动'"],
  "keywords": ["3-8个关键词，提取内容里的实际高频词/核心概念"],
  "ipId": "如果明确属于可选IP列表里的某一个，填它的id；没有把握就填null",
  "sourceTier": "高｜中｜低（三选一）",
  "sourceTierReason": "为什么是这个等级，给出具体依据",
  "contentDirection": ["1-3个内容方向标签，例如'AI工具'、'职场成长'、'情感'"]
}`;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: RequestBody;
  try { body = await req.json(); }
  catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const content = (body.rawContent ?? "").trim();
  const category = body.category ?? "方法论";
  if (!content) {
    return NextResponse.json(
      { error: "请提供要提取的内容", apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: null, mockHit: false } },
      { status: 400 }
    );
  }

  const calledAt = new Date().toISOString();
  const apiMeta = { apiCalled: true, calledAt, model: MODEL, ipUsed: null as string | null, mockHit: false };

  try {
    const raw = await callDeepSeek(
      EXTRACT_SYSTEM,
      EXTRACT_PROMPT(category, content, body.sourcePlatform ?? "", body.sourceUrl ?? "", body.availableIPs ?? []),
      1200
    , 0.3, apiKey);
    const parsed = parseJSON(raw, {
      title: content.slice(0, 20),
      tags: [] as string[],
      keywords: [] as string[],
      ipId: null as string | null,
      sourceTier: "低" as "高" | "中" | "低",
      sourceTierReason: "（AI返回内容解析失败，默认按低可信度处理，请手动核实）",
      contentDirection: [] as string[],
    });

    return NextResponse.json({
      title: parsed.title || content.slice(0, 20),
      tags: parsed.tags ?? [],
      keywords: parsed.keywords ?? [],
      ipId: parsed.ipId ?? null,
      sourceTier: parsed.sourceTier ?? "低",
      sourceTierReason: parsed.sourceTierReason ?? "",
      contentDirection: parsed.contentDirection ?? [],
      apiMeta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "提取失败，请重试";
    return NextResponse.json({ error: message, apiMeta: { ...apiMeta, error: message } }, { status: 500 });
  }
}
