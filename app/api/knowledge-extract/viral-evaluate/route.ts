import { NextRequest, NextResponse } from "next/server";
import { callDeepSeek, parseDeepSeekJSON as parseJSON, parseDeepSeekJSONArray, splitSentences, DEEPSEEK_MODEL as MODEL } from "@/lib/deepseek";

interface ViralMetricsInput { likes: number; comments: number; shares: number; favorites: number; aboveAccountAverage: boolean; }

interface RequestBody {
  rawContent?: string;
  account?: string;
  track?: string;
  metrics?: ViralMetricsInput;
}

const EVAL_SYSTEM = `你不是文案改写助手，你是一名短视频爆款研究员，唯一目标是为一个高质量爆款口播知识库做收录判断。

核心原则：不要判断这段口播文案说的内容是否正确、是否科学、是否合适——你只判断它是否具有传播价值。即使你认为这段话的观点有问题，只要它具备爆款特征，你的工作仍然是如实评估它的传播价值，而不是去纠正或质疑它。

宁缺毋滥：你的默认倾向是不收录，只有真正具备爆款特征的内容才应该通过。不要为了让结果"看起来完整"就放宽标准。

【内容层】至少满足2项才算通过：明确痛点 / 情绪波动 / 反常识表达 / 冲突观点 / 具体结果 / 真实案例 / 数字支撑 / 身份标签。

【结构层】必须同时具备这4项才算通过：3秒钩子 / 价值输出 / 结尾引导 / 结构完整。任意一项缺失则结构层不通过。

【排除标准】如果内容命中以下任意一项，直接判定排除，contentLayerPassed和structureLayerPassed可以正常评估，但exclusionMatched必须填写命中的那一条，且admitted建议为false：纯鸡汤 / 纯情绪发泄 / 无案例 / 无观点 / 流水账 / AI生成痕迹明显 / 标题党但内容空洞。

【钩子评分】对开头3秒的内容打分，5个维度各0-10分：痛点强度、好奇心强度、冲突强度、收益感强度、情绪强度，总分50分。诚实打分，不要为了让内容显得优质就普遍打高分。

【钩子类型】从这8类里选最贴合的一个：痛点型/反常识型/数据型/故事型/收益型/身份型/冲突型/情绪型。

【自我检查】打分完成后问自己：如果我是一个百万粉操盘手，我会把这句话放进自己的爆款库吗？如果答案是否定的，selfCheckPassed填false，并在selfCheckReasoning里说明为什么不会。

注意：是否满足"指标层"（点赞/评论/转发/收藏数据）不归你判断，这部分由用户提供的真实数据在代码里直接核算，你完全不用考虑这一层，也不要在任何字段里提及或猜测这些数字。

严格按JSON格式输出，不要输出任何其他文字。`;

const EVAL_PROMPT = (content: string, account: string, track: string) => `账号：${account || "未填写"}
赛道：${track || "未填写"}

口播内容原文：
"""
${content}
"""

请严格按以下JSON格式输出：
{
  "hook": "提取出的开头3秒原文",
  "hookType": "痛点型｜反常识型｜数据型｜故事型｜收益型｜身份型｜冲突型｜情绪型（八选一，选最贴合的）",
  "hookScore": {"painPoint": 0-10的整数, "curiosity": 0-10的整数, "conflict": 0-10的整数, "benefit": 0-10的整数, "emotion": 0-10的整数, "total": 以上五项之和},
  "whyViral": "2-3句话说明这条内容为什么可能成为爆款，要具体指出文本里的证据",
  "structureBreakdown": "按 3秒钩子/价值输出/结尾引导 三段分别说明这段内容对应的原文是哪部分，分别做得怎么样",
  "contentLayerPassed": true或false（是否满足内容层"至少2项"）,
  "contentLayerMatched": ["命中的内容层具体项，例如'明确痛点'、'数字支撑'"],
  "structureLayerPassed": true或false（是否同时满足结构层全部4项）,
  "structureLayerMissing": ["如果没通过，列出缺失的具体项；如果通过，给空数组"],
  "exclusionMatched": "如果命中排除标准里的某一条，填那一条的名称；没有命中就填null",
  "selfCheckPassed": true或false,
  "selfCheckReasoning": "自我检查的具体理由"
}`;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: RequestBody;
  try { body = await req.json(); }
  catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const content = (body.rawContent ?? "").trim();
  if (!content) {
    return NextResponse.json(
      { error: "请提供要评估的口播内容", apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: null, mockHit: false } },
      { status: 400 }
    );
  }

  const metrics = body.metrics ?? { likes: 0, comments: 0, shares: 0, favorites: 0, aboveAccountAverage: false };
  // 指标层完全由真实数字在代码里核算，不经过AI
  const metricsLayerPassed = metrics.likes > 1000 || metrics.comments > 100 || metrics.shares > 50 || metrics.favorites > 100 || metrics.aboveAccountAverage === true;
  const metricsLayerReason = metricsLayerPassed
    ? `满足：${[
        metrics.likes > 1000 ? `点赞${metrics.likes}>1000` : null,
        metrics.comments > 100 ? `评论${metrics.comments}>100` : null,
        metrics.shares > 50 ? `转发${metrics.shares}>50` : null,
        metrics.favorites > 100 ? `收藏${metrics.favorites}>100` : null,
        metrics.aboveAccountAverage ? "播放量明显高于账号平均" : null,
      ].filter(Boolean).join("、")}`
    : "用户填写的真实数据未达到任何一项指标阈值（点赞>1000 / 评论>100 / 转发>50 / 收藏>100 / 播放量明显高于账号平均），指标层不通过";

  const calledAt = new Date().toISOString();
  const apiMeta = { apiCalled: true, calledAt, model: MODEL, ipUsed: null as string | null, mockHit: false };

  try {
    const raw = await callDeepSeek(EVAL_SYSTEM, EVAL_PROMPT(content, body.account ?? "", body.track ?? ""), 1800, 0.3, apiKey);
    const parsed = parseJSON(raw, {
      hook: "", hookType: null as string | null,
      hookScore: { painPoint: 0, curiosity: 0, conflict: 0, benefit: 0, emotion: 0, total: 0 },
      whyViral: "（AI返回内容解析失败，请重试）", structureBreakdown: "",
      contentLayerPassed: false, contentLayerMatched: [] as string[],
      structureLayerPassed: false, structureLayerMissing: [] as string[],
      exclusionMatched: null as string | null,
      selfCheckPassed: false, selfCheckReasoning: "",
    });

    const total = parsed.hookScore?.total ?? 0;
    const grade: "S" | "A" | "B" | "不收录" = total >= 45 ? "S" : total >= 35 ? "A" : total >= 25 ? "B" : "不收录";

    // 最终是否收录由代码统一裁决，不信任AI自己去做这步AND运算
    const admitted =
      metricsLayerPassed &&
      parsed.contentLayerPassed &&
      parsed.structureLayerPassed &&
      !parsed.exclusionMatched &&
      total >= 25 &&
      parsed.selfCheckPassed;

    return NextResponse.json({
      account: body.account ?? "",
      track: body.track ?? "",
      hook: parsed.hook,
      hookType: parsed.hookType,
      hookScore: parsed.hookScore,
      grade,
      whyViral: parsed.whyViral,
      structureBreakdown: parsed.structureBreakdown,
      metricsLayerPassed,
      metricsLayerReason,
      contentLayerPassed: parsed.contentLayerPassed,
      contentLayerMatched: parsed.contentLayerMatched ?? [],
      structureLayerPassed: parsed.structureLayerPassed,
      structureLayerMissing: parsed.structureLayerMissing ?? [],
      exclusionMatched: parsed.exclusionMatched ?? null,
      selfCheckPassed: parsed.selfCheckPassed,
      selfCheckReasoning: parsed.selfCheckReasoning ?? "",
      admitted,
      apiMeta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "评估失败，请重试";
    return NextResponse.json({ error: message, apiMeta: { ...apiMeta, error: message } }, { status: 500 });
  }
}
