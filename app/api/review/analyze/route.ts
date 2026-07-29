import { NextRequest, NextResponse } from "next/server";
import { DEEPSEEK_MODEL as MODEL } from "@/lib/deepseek";
import {
  callStructuredDeepSeek,
  StructuredDeepSeekError,
} from "@/lib/structured-deepseek";
import {
  parseReviewResponse,
  type ReviewAnalysis,
} from "@/lib/review-response";
import type { ReviewMetrics } from "@/lib/types";

interface HistoricalAvg {
  views: number | null;
  likes: number | null;
  comments: number | null;
  favorites: number | null;
  count: number;
}

interface RequestBody {
  title?: string;
  platform?: string;
  contentDirection?: string;
  scriptText?: string;
  metrics?: ReviewMetrics;
  historicalAvg?: HistoricalAvg;
  ipContext?: {
    name: string;
    positioning: string;
    contentDirection: string[];
  } | null;
  knowledgeContext?: { id: string; title: string; category: string }[];
}

const SYSTEM = `你是一位经验丰富的短视频内容复盘分析师，任务是基于用户提供的真实数据（播放量/点赞/评论/收藏/转发/涨粉等）和内容文本，给出有据可查的六层分析。

核心原则：
1. 绝对禁止伪造数据、虚构依据、编造用户心理。
2. 所有结论必须标注可信度：高可信度（来自真实数据/真实文本直接推断）、中可信度（来自行业通用经验）、低可信度（AI推测，无直接依据）。
3. Layer3内容结构分析：必须基于用户提供的逐字稿/口播稿，没有文本时如实说明“缺少内容文本，无法做结构分析”，不能靠标题和数据硬撑分析。
4. Layer4历史对比：历史均值数据由代码已经算好直接传给你，你不要自己编均值数字，只做比较和原因推测。
5. Layer5经验沉淀：每条经验都要有数据或内容文本的直接支撑，不能是泛泛而谈的通用道理。
6. 所有维度的评分（0-10）要基于内容文本或数据，不能凭空给分。

严格按JSON格式输出，不要输出任何其他文字。`;

const PROMPT = (body: RequestBody, hasScript: boolean) => `
视频信息：
标题：${body.title || "（未提供）"}
平台：${body.platform || "（未提供）"}
内容方向：${body.contentDirection || "（未提供）"}

真实数据（用户手动填写）：
播放量：${body.metrics?.views ?? "未填写"}
点赞：${body.metrics?.likes ?? "未填写"}  评论：${body.metrics?.comments ?? "未填写"}  收藏：${body.metrics?.favorites ?? "未填写"}  转发：${body.metrics?.shares ?? "未填写"}
涨粉：${body.metrics?.newFollowers ?? "未填写"}  私信：${body.metrics?.dms ?? "未填写"}  线索：${body.metrics?.leads ?? "未填写"}  成交：${body.metrics?.conversions ?? "未填写"}

${hasScript ? `口播稿/逐字稿（内容结构分析的直接依据）：
"""
${body.scriptText}
"""` : "【重要】用户未提供口播稿或逐字稿，Layer3内容结构分析必须标注无法完成，不要基于标题推测结构。"}

${body.historicalAvg && body.historicalAvg.count >= 3
  ? `历史均值（代码从${body.historicalAvg.count}条历史复盘实际计算，不是估算）：
平均播放：${body.historicalAvg.views ?? "无数据"}  平均点赞：${body.historicalAvg.likes ?? "无数据"}  平均评论：${body.historicalAvg.comments ?? "无数据"}  平均收藏：${body.historicalAvg.favorites ?? "无数据"}`
  : `历史数据：不足3条（当前${body.historicalAvg?.count ?? 0}条），Layer4历史对比必须如实说明数据不足，不能做虚假对比。`}

${body.ipContext ? `当前IP信息：${body.ipContext.name}，定位：${body.ipContext.positioning}，内容方向：${body.ipContext.contentDirection.join("、")}` : "未提供IP信息。"}

${body.knowledgeContext && body.knowledgeContext.length > 0
  ? `知识库可参考案例（可在Layer2中引用）：${body.knowledgeContext.map((item) => `[${item.category}]${item.title}`).join("、")}`
  : "知识库暂无可参考案例，Layer2知识库依据留空。"}

请严格按以下JSON格式输出六层分析：
{
  "layer1": {
    "grade": "S|A|B|C（综合评分，S=各项数据均突出，C=多项数据偏低）",
    "performanceType": "爆款|潜力款|普通款|失败款",
    "highlights": ["数据亮点，每条说具体哪个指标、高于什么基准"],
    "weaknesses": ["数据短板，每条说具体哪个指标偏低及影响"],
    "scoringBasis": "综合评分S/A/B/C的判断依据，要引用具体数字"
  },
  "layer2": {
    "hasViralPotential": true或false,
    "confidenceTier": "高可信度|中可信度|低可信度",
    "reasoning": "综合判断依据",
    "dataEvidence": "引用的实际数据，例如点赞率X%",
    "structureEvidence": "引用的内容结构特征（有逐字稿时才能写实质内容，没有就写空字符串）",
    "knowledgeEvidence": "引用的知识库案例（没有可比案例时写空字符串）"
  },
  "layer3": {
    "hasScriptText": ${hasScript},
    "noScriptReason": "${hasScript ? "" : "用户未提供口播稿或逐字稿，内容结构分析需要完整文本作为依据，无法基于标题和数据做结构评分"}",
    "titleAnalysis": {"score": 0-10, "feedback": "标题分析", "suggestion": "改进建议"},
    "hookAnalysis": {"score": ${hasScript ? "0-10" : 0}, "feedback": "${hasScript ? "开头钩子分析（基于逐字稿前几句）" : "无文本，无法评分"}", "suggestion": ""},
    "middleAnalysis": {"score": ${hasScript ? "0-10" : 0}, "feedback": "${hasScript ? "中段价值分析" : "无文本，无法评分"}", "suggestion": ""},
    "endingAnalysis": {"score": ${hasScript ? "0-10" : 0}, "feedback": "${hasScript ? "结尾分析" : "无文本，无法评分"}", "suggestion": ""}
  },
  "layer4": {
    "hasHistoricalData": ${(body.historicalAvg?.count ?? 0) >= 3},
    "noHistoryReason": "${(body.historicalAvg?.count ?? 0) >= 3 ? "" : `当前仅有${body.historicalAvg?.count ?? 0}条历史复盘，需至少3条才能做有意义的横向对比`}",
    "betterMetrics": ["优于历史均值的指标及具体数字对比"],
    "worseMetrics": ["低于历史均值的指标及具体数字对比"],
    "changeReason": "变化原因推测（须标注这是AI推测）",
    "avgHistoricalViews": ${body.historicalAvg?.views ?? null},
    "avgHistoricalLikes": ${body.historicalAvg?.likes ?? null},
    "avgHistoricalComments": ${body.historicalAvg?.comments ?? null},
    "avgHistoricalFavorites": ${body.historicalAvg?.favorites ?? null}
  },
  "layer5": {
    "successPatterns": ["成功经验，每条要有数据或文本的直接支撑，不能是通用道理"],
    "failurePatterns": ["失败经验，同上，如果数据正常则返回空数组"],
    "reusableFormulas": ["可复用内容公式，例如「反常识开头+工具演示+结果展示+评论区领取」"]
  },
  "layer6": {
    "continueSuggestions": ["建议继续做的方向，附理由"],
    "stopSuggestions": ["建议停止做的方向，附理由，如果没有就返回空数组"],
    "optimizeSuggestions": ["建议优化的具体方法"],
    "recommendedTopics": ["推荐3-5个具体选题"],
    "recommendedTitles": ["推荐3-5个具体标题"]
  }
}`;

function normalizeReliableFields(
  analysis: ReviewAnalysis,
  body: RequestBody,
  hasScript: boolean,
): ReviewAnalysis {
  const historyCount = body.historicalAvg?.count ?? 0;
  const hasHistoricalData = historyCount >= 3;

  return {
    ...analysis,
    layer3: {
      ...analysis.layer3,
      hasScriptText: hasScript,
      noScriptReason: hasScript
        ? ""
        : "用户未提供口播稿或逐字稿，内容结构分析需要完整文本作为依据，无法基于标题和数据做结构评分",
    },
    layer4: {
      ...analysis.layer4,
      hasHistoricalData,
      noHistoryReason: hasHistoricalData
        ? ""
        : `当前仅有${historyCount}条历史复盘，需至少3条才能做有意义的横向对比`,
      avgHistoricalViews: body.historicalAvg?.views ?? null,
      avgHistoricalLikes: body.historicalAvg?.likes ?? null,
      avgHistoricalComments: body.historicalAvg?.comments ?? null,
      avgHistoricalFavorites: body.historicalAvg?.favorites ?? null,
    },
  };
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const hasMetrics = !!body.metrics &&
    Object.values(body.metrics).some((value) => value > 0);
  if (!body.title?.trim() && !hasMetrics) {
    return NextResponse.json(
      { error: "请至少提供视频标题或一项真实数据" },
      { status: 400 },
    );
  }

  const hasScript = !!body.scriptText?.trim();
  const calledAt = new Date().toISOString();
  const baseApiMeta = {
    apiCalled: true,
    calledAt,
    model: MODEL,
    ipUsed: body.ipContext?.name ?? null,
    mockHit: false,
  };

  try {
    const result = await callStructuredDeepSeek({
      systemPrompt: SYSTEM,
      userPrompt: PROMPT(body, hasScript),
      parse: parseReviewResponse,
      apiKey,
      maxTokens: 4000,
      temperature: 0.3,
    });
    const analysis = normalizeReliableFields(result.data, body, hasScript);

    return NextResponse.json({
      ...analysis,
      hasScript,
      apiMeta: {
        ...baseApiMeta,
        attempts: result.attempts,
        requestId: result.responseMeta.requestId,
        finishReason: result.responseMeta.finishReason,
      },
    });
  } catch (error) {
    const structuredError = error instanceof StructuredDeepSeekError
      ? error
      : null;
    const message = structuredError?.stage === "timeout"
      ? "分析生成超时，已自动重试，请稍后再试"
      : structuredError?.stage === "parse"
        ? "AI返回格式不完整，已自动重试，请稍后再试"
        : error instanceof Error
          ? error.message
          : "分析失败，请重试";
    const status = structuredError?.stage === "timeout" ? 504 : 500;

    return NextResponse.json(
      {
        error: message,
        apiMeta: {
          ...baseApiMeta,
          attempts: structuredError?.attempts ?? 1,
          error: message,
        },
      },
      { status },
    );
  }
}
