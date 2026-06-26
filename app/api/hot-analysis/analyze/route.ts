import { NextRequest, NextResponse } from "next/server";
import { callDeepSeek, parseDeepSeekJSON as parseJSON, parseDeepSeekJSONArray, DEEPSEEK_MODEL as MODEL } from "@/lib/deepseek";

// 按标点切句——切句本身用代码做，不依赖AI，保证后面"占比"统计的分母是确定的
function splitSentences(text: string): string[] {
  return text.split(/(?<=[。！？\n])/).map(s => s.trim()).filter(s => s.length > 0);
}

interface IPContext { name: string; positioning: string; audience: string; contentDirection: string[]; platforms: string[]; }
interface MetricsInput { likes: number; comments: number; shares: number; favorites: number; aboveAccountAverage: boolean; }
interface RequestBody {
  inputType?: "transcript" | "copy" | "title";
  inputRaw?: string;
  sourceUrl?: string;
  ipContext?: IPContext | null;
  metrics?: MetricsInput | null;
}

const HOOK_TYPES = "痛点型/反常识型/数据型/故事型/收益型/身份型/冲突型/情绪型";
const TITLE_STRUCTURES = "反差型/结果型/痛点型/悬念型/认知颠覆型";
const OPENING_HOOK_TYPES = "提问题/反常识/制造焦虑/展示结果/讲故事";
const EMOTIONS = ["焦虑", "希望", "好奇", "羡慕", "优越感", "危机感"];
const NEED_LAYERS = "知识/赚钱/效率/身份认同/情绪价值/案例参考";

const SYSTEM = `你是短视频内容的诊断分析师，任务是拆解一段内容（口播稿/文案/标题）的结构和质量，给出有据可查的诊断，不是模糊的夸夸其谈。

核心规则：
1. 基础信息（标题/作者/平台/发布时间）只能从输入文本里实际提取，提取不出来的字段必须留空字符串，绝对不能编造。
2. 评级和上次"爆款案例库"用的是同一套逻辑：内容层（至少2项：明确痛点/情绪波动/反常识表达/冲突观点/具体结果/真实案例/数字支撑/身份标签）、结构层（4项全有：3秒钩子/价值输出/结尾引导/结构完整）、钩子5维度评分（痛点强度/好奇心强度/冲突强度/收益感强度/情绪强度，各0-10）、排除标准（纯鸡汤/纯情绪发泄/无案例/无观点/流水账/AI生成痕迹明显/标题党但内容空洞）、自我检查（百万粉操盘手会不会收录）。
3. 句子级标注：输入文本已经按句子编号，你需要给每一句标注它属于内容结构的哪个阶段（Hook/Problem/Solution/Case/CTA/none）、以及包含哪些情绪（可以是多个或没有）。不要自己计算占比，占比由代码统计，你只需要逐句打标签。
4. IP匹配度：如果提供了当前IP信息，结合受众/风格/内容方向判断匹配度，给定性档位（高度匹配/中度匹配/低度匹配），不要给精确百分比——你没有能力算出真实的匹配率数字。
5. 是否值得学习：值得学习/部分学习/不建议学习，必须给具体理由，不能空泛。

严格按JSON格式输出，不要输出任何其他文字。`;

const PROMPT = (inputRaw: string, sentences: string[], ipContext: IPContext | null, hasMetrics: boolean) => `输入内容：
"""
${inputRaw}
"""

句子编号列表（标注时用编号引用，不要重复抄写原文）：
${sentences.map((s, i) => `[${i}] ${s}`).join("\n")}

${ipContext ? `当前操盘IP信息：名称=${ipContext.name}，定位=${ipContext.positioning}，受众=${ipContext.audience}，内容方向=${ipContext.contentDirection.join("、")}，平台=${ipContext.platforms.join("、")}` : "未提供当前IP信息，ipFitTier和ipFitReason都返回null/空字符串"}

${hasMetrics ? "用户提供了真实互动数据，指标层会在代码里另行核算，你不用考虑这一层。" : "用户没有提供真实互动数据，指标层视为不适用，contentLayerPassed/structureLayerPassed/钩子评分/自我检查照常评估，但admitted不要求指标层通过。"}

请严格按以下JSON格式输出：
{
  "title": "从文本提取的标题，提取不出来给空字符串",
  "author": "从文本提取的作者/账号，提取不出来给空字符串",
  "platform": "从文本提取的平台，提取不出来给空字符串",
  "publishedAt": "从文本提取的发布时间，提取不出来给空字符串",
  "contentDirection": ["1-3个内容方向标签"],

  "hook": "开头钩子原文（前几句）",
  "hookType": "${HOOK_TYPES}（八选一）",
  "hookScore": {"painPoint": 0-10整数, "curiosity": 0-10整数, "conflict": 0-10整数, "benefit": 0-10整数, "emotion": 0-10整数, "total": 五项之和},
  "whyViral": "为什么这条内容可能传播好，给具体证据",
  "structureBreakdownText": "按3秒钩子/价值输出/结尾引导说明对应原文",
  "contentLayerPassed": true或false,
  "contentLayerMatched": ["命中的内容层具体项"],
  "structureLayerPassed": true或false,
  "structureLayerMissing": ["缺失的结构层具体项，没缺失给空数组"],
  "exclusionMatched": "命中的排除标准，没命中给null",
  "selfCheckPassed": true或false,
  "selfCheckReasoning": "自我检查理由",

  "worthLearning": "值得学习｜部分学习｜不建议学习",
  "worthLearningReason": "具体理由",
  "ipFitTier": "高度匹配｜中度匹配｜低度匹配｜null（没有IP信息时给null）",
  "ipFitReason": "为什么是这个匹配档位，没有IP信息给空字符串",

  "titleStructure": "${TITLE_STRUCTURES}（五选一，从标题判断，没有明显标题就从开头几句判断）",
  "openingHookType": "${OPENING_HOOK_TYPES}（五选一）",
  "userNeedLayer": "${NEED_LAYERS}（六选一，判断用户主要在看什么）",
  "sentenceStageTags": [{"index": 句子编号, "stage": "Hook｜Problem｜Solution｜Case｜CTA｜none"}],
  "sentenceEmotionTags": [{"index": 句子编号, "emotions": ["焦虑/希望/好奇/羡慕/优越感/危机感中命中的，可以是空数组"]}]
}`;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: RequestBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  const inputRaw = (body.inputRaw ?? "").trim();
  if (!inputRaw) {
    return NextResponse.json(
      { error: "请提供要分析的内容", apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: null, mockHit: false } },
      { status: 400 }
    );
  }

  const sentences = splitSentences(inputRaw);
  const hasRealMetrics = !!body.metrics && (body.metrics.likes > 0 || body.metrics.comments > 0 || body.metrics.shares > 0 || body.metrics.favorites > 0 || body.metrics.aboveAccountAverage);
  const calledAt = new Date().toISOString();
  const apiMeta = { apiCalled: true, calledAt, model: MODEL, ipUsed: null as string | null, mockHit: false };

  try {
    const raw = await callDeepSeek(SYSTEM, PROMPT(inputRaw, sentences, body.ipContext ?? null, hasRealMetrics), 3000, 0.3, apiKey);
    const parsed = parseJSON(raw, null as Record<string, unknown> | null);
    if (!parsed) throw new Error("AI返回内容解析失败，请重试");

    // ── 指标层：代码核算，AI不参与 ──
    const m = body.metrics;
    const metricsLayerPassed = hasRealMetrics && !!m && (m.likes > 1000 || m.comments > 100 || m.shares > 50 || m.favorites > 100 || m.aboveAccountAverage);
    const metricsLayerReason = !hasRealMetrics
      ? "未提供真实互动数据，本次评级仅基于内容质量与结构，不代表已验证的真实传播表现"
      : metricsLayerPassed
        ? "提供的真实数据满足指标层阈值"
        : "提供的真实数据未达到指标层阈值（点赞>1000/评论>100/转发>50/收藏>100/播放量明显高于账号平均）";

    const total = (parsed.hookScore as { total?: number } | undefined)?.total ?? 0;
    const grade: "S" | "A" | "B" | "不收录" = total >= 45 ? "S" : total >= 35 ? "A" : total >= 25 ? "B" : "不收录";

    // 没有真实数据时，admitted的判断里跳过指标层这一项，只要求内容层+结构层+排除+钩子分+自我检查
    const admitted = (hasRealMetrics ? metricsLayerPassed : true)
      && !!parsed.contentLayerPassed && !!parsed.structureLayerPassed
      && !parsed.exclusionMatched && total >= 25 && !!parsed.selfCheckPassed;

    const evaluation = {
      account: "", track: "",
      hook: parsed.hook ?? "", hookType: parsed.hookType ?? null,
      hookScore: parsed.hookScore ?? { painPoint: 0, curiosity: 0, conflict: 0, benefit: 0, emotion: 0, total: 0 },
      grade, whyViral: parsed.whyViral ?? "", structureBreakdown: parsed.structureBreakdownText ?? "",
      metricsLayerPassed, metricsLayerReason,
      contentLayerPassed: !!parsed.contentLayerPassed, contentLayerMatched: (parsed.contentLayerMatched as string[]) ?? [],
      structureLayerPassed: !!parsed.structureLayerPassed, structureLayerMissing: (parsed.structureLayerMissing as string[]) ?? [],
      exclusionMatched: (parsed.exclusionMatched as string | null) ?? null,
      selfCheckPassed: !!parsed.selfCheckPassed, selfCheckReasoning: parsed.selfCheckReasoning ?? "",
      admitted,
    };

    // ── DNA：句子级标签由AI给，占比由代码统计字数，不让AI报数字 ──
    const stageTags = (parsed.sentenceStageTags as { index: number; stage: string }[]) ?? [];
    const emotionTags = (parsed.sentenceEmotionTags as { index: number; emotions: string[] }[]) ?? [];
    const totalChars = sentences.reduce((sum, s) => sum + s.length, 0) || 1;

    const STAGES = ["Hook", "Problem", "Solution", "Case", "CTA"] as const;
    const structureBreakdown = STAGES.map((stage) => {
      const matchedSentences = stageTags.filter(t => t.stage === stage).map(t => sentences[t.index]).filter(Boolean);
      const chars = matchedSentences.reduce((sum, s) => sum + s.length, 0);
      return { stage, percentage: Math.round((chars / totalChars) * 100), content: matchedSentences.join("") };
    });

    const totalSentences = sentences.length || 1;
    const emotionValue = EMOTIONS.map((emotion) => {
      const count = emotionTags.filter(t => t.emotions?.includes(emotion)).length;
      return { emotion, percentage: Math.round((count / totalSentences) * 100) };
    }).filter(e => e.percentage > 0);

    const dna = {
      titleStructure: parsed.titleStructure ?? "",
      openingHookType: parsed.openingHookType ?? "",
      openingHookText: parsed.hook ?? "",
      structureBreakdown, emotionValue,
      userNeedLayer: parsed.userNeedLayer ?? "",
    };

    return NextResponse.json({
      title: parsed.title ?? "", author: parsed.author ?? "", platform: parsed.platform ?? "",
      publishedAt: parsed.publishedAt ?? "", contentDirection: parsed.contentDirection ?? [],
      evaluation, hasRealMetrics,
      worthLearning: parsed.worthLearning ?? "不建议学习", worthLearningReason: parsed.worthLearningReason ?? "",
      ipFitTier: parsed.ipFitTier ?? null, ipFitReason: parsed.ipFitReason ?? "",
      dna, apiMeta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "分析失败，请重试";
    return NextResponse.json({ error: message, apiMeta: { ...apiMeta, error: message } }, { status: 500 });
  }
}
