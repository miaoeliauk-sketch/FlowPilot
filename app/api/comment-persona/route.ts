import { NextRequest, NextResponse } from "next/server";
import { callDeepSeek, DEEPSEEK_MODEL, parseDeepSeekJSON } from "@/lib/deepseek";

const SYSTEM = `你是一位专业的用户研究分析师，擅长从社交媒体评论中提取真实用户需求并生成用户人格画像。

核心原则：
1. 绝对禁止凭空编造人格——每个人格必须有真实评论作为证据支撑。
2. 清洗阶段必须严格过滤噪音，宁可少留也不要保留低质量评论。
3. 人格聚类基于评论内容的语义相似性，不是随意分类。
4. 购买意向判断要基于评论中的具体信号（"多少钱"/"有课吗"/"怎么买"），不能猜测。
5. 所有输出严格按JSON格式，不输出任何其他文字。`;

const CLEAN_PROMPT = (comments: string, total: number) => `以下是从社交媒体导入的 ${total} 条评论原文：

"""
${comments}
"""

**第一步：评论清洗**
过滤掉以下类型（不要保留）：
- 只有 @某人 的评论
- 纯表情符号评论
- "666"/"哈哈"/"来了"/"支持"/"加油"等无实质内容的评论
- 重复或高度相似的评论（相似度>80%只保留一条）
- 明显的广告评论（含网址/联系方式/推销话语）
- 无法判断语义的评论

保留以下类型（必须保留）：
- 提问类："怎么做""哪里学""多久能会"
- 求教程/求资料/求链接/求步骤
- 表达顾虑："会不会""有没有用""值不值""骗不骗"
- 求变现相关："能赚钱吗""怎么变现"
- 真实情绪反馈："我试了""我也是""终于""一直想"
- 质疑类：表达不信任或挑战观点的评论

**第二步：用户人格聚类**
从清洗后的有效评论中，识别2-5个真实用户人格（不是越多越好，没有足够证据就不要造）。

每个人格必须：
1. 有至少3条原始评论作为证据
2. 名称要生动具体（"焦虑型AI小白"而不是"新手用户"）
3. 需求/顾虑基于评论内容推断，不能添加评论里没有的内容

**严格按以下JSON格式输出，不要输出任何其他文字：**
{
  "cleanedComments": ["有效评论1", "有效评论2", ...],
  "filteredCount": 过滤掉的数量（整数）,
  "personas": [
    {
      "name": "人格名称（生动具体）",
      "representativeComments": ["代表性原始评论1", "代表性评论2", "代表性评论3"],
      "keywords": ["关键词1", "关键词2", "关键词3", "关键词4", "关键词5"],
      "coreNeeds": ["真实需求1", "真实需求2"],
      "coreConcerns": ["核心顾虑1", "核心顾虑2"],
      "contentPreferences": ["喜欢路线图", "喜欢步骤类", "喜欢案例"],
      "purchaseIntent": "高|中|低",
      "topicFocus": "这类用户最关心选题的哪个角度",
      "commentCount": 支撑该人格的评论条数
    }
  ]
}`;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";

  let body: {
    rawComments: string;
    platform?: string;
    ipId?: string | null;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  const raw = (body.rawComments ?? "").trim();
  if (!raw) {
    return NextResponse.json({ error: "请提供评论内容" }, { status: 400 });
  }

  // 简单分行统计总数
  const lines = raw.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const totalComments = lines.length;

  if (totalComments < 5) {
    return NextResponse.json({ error: "评论数量太少，请至少提供5条评论" }, { status: 400 });
  }

  // 防止超长输入：最多取前500条
  const inputComments = lines.slice(0, 500).join("\n");
  const calledAt = new Date().toISOString();

  try {
    const raw_result = await callDeepSeek(SYSTEM, CLEAN_PROMPT(inputComments, totalComments), 4000, 0.3, apiKey);

    const parsed = parseDeepSeekJSON<{
      cleanedComments: string[];
      filteredCount: number;
      personas: {
        name: string;
        representativeComments: string[];
        keywords: string[];
        coreNeeds: string[];
        coreConcerns: string[];
        contentPreferences: string[];
        purchaseIntent: string;
        topicFocus: string;
        commentCount: number;
      }[];
    }>(raw_result, {
      cleanedComments: [],
      filteredCount: 0,
      personas: [],
    });

    const validComments = parsed.cleanedComments.length;

    // 可信度判断（纯代码，不让AI决定）
    let confidenceTier: "高" | "中" | "低";
    let confidenceReason: string;
    if (validComments >= 500) {
      confidenceTier = "高";
      confidenceReason = `有效评论 ${validComments} 条，样本充足，用户人格可信度高`;
    } else if (validComments >= 50) {
      confidenceTier = "中";
      confidenceReason = `有效评论 ${validComments} 条，样本基本够用，用户人格有一定参考价值`;
    } else {
      confidenceTier = "低";
      confidenceReason = `有效评论仅 ${validComments} 条（少于50条），样本不足，用户人格可信度较低，建议补充更多评论再分析`;
    }

    // 给每个persona加id
    const personas = (parsed.personas ?? []).map((p, i) => ({
      id: `persona-${Date.now()}-${i}`,
      ...p,
      purchaseIntent: (["高", "中", "低"].includes(p.purchaseIntent) ? p.purchaseIntent : "低") as "高" | "中" | "低",
    }));

    return NextResponse.json({
      totalComments,
      validComments,
      filteredCount: parsed.filteredCount,
      cleanedComments: parsed.cleanedComments,
      personas,
      confidenceTier,
      confidenceReason,
      ipId: body.ipId ?? null,
      platform: body.platform ?? "未指定",
      createdAt: calledAt,
      apiMeta: { apiCalled: true, calledAt, model: DEEPSEEK_MODEL },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "分析失败，请重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
