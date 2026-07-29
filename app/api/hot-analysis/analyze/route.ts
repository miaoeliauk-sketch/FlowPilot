import { NextRequest, NextResponse } from "next/server";
import { DEEPSEEK_MODEL as MODEL } from "@/lib/deepseek";
import {
  HotAnalysisResponseError,
  parseHotAnalysisResponse,
  parseHotAnalysisTitleResponse,
} from "@/lib/hot-analysis-response";
import {
  callStructuredDeepSeek,
  StructuredDeepSeekError,
} from "@/lib/structured-deepseek";

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？\n])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function deriveTitleFromOpening(text: string): string {
  const first = text.replace(/\s+/g, "").slice(0, 20);
  return first.length >= 20 ? `${first}…` : first;
}

interface IPContext {
  name: string;
  positioning: string;
  audience: string;
  contentDirection: string[];
  platforms: string[];
}

interface MetricsInput {
  likes: number;
  comments: number;
  shares: number;
  favorites: number;
  aboveAccountAverage: boolean;
}

type InputType = "transcript" | "copy" | "title";

interface RequestBody {
  inputType?: InputType;
  inputRaw?: string;
  sourceUrl?: string;
  ipContext?: IPContext | null;
  metrics?: MetricsInput | null;
}

interface ApiMeta {
  apiCalled: boolean;
  calledAt: string;
  model: string;
  ipUsed: string | null;
  mockHit: boolean;
  requestId?: string;
}

const HOOK_TYPES = "痛点型/反常识型/数据型/故事型/收益型/身份型/冲突型/情绪型";
const TITLE_STRUCTURES = "反差型/结果型/痛点型/悬念型/认知颠覆型";
const OPENING_HOOK_TYPES = "提问题/反常识/制造焦虑/展示结果/讲故事";
const EMOTIONS = ["焦虑", "希望", "好奇", "羡慕", "优越感", "危机感"];
const NEED_LAYERS = "知识/赚钱/效率/身份认同/情绪价值/案例参考";
const METHOD_CATEGORY_LIST = "定位方法库/选题方法库/标题方法库/开头方法库/文案框架方法库";

const TITLE_SYSTEM = `你是短视频标题的资深诊断分析师。任务：只针对一个标题（不到30字的短文本）做诊断，不要幻想它背后的完整内容，不要输出钩子评分、结构占比、情绪占比、DNA等只对完整口播稿适用的字段。

评估只覆盖5个维度：
1. titleAttraction：标题吸引力。这句话作为标题能否让人在信息流里停下来点开。
2. topicPotential：选题潜力。如果标题背后有内容支撑，这个话题的传播空间有多大。
3. painPointClarity：用户痛点清晰度。标题指向的问题、焦虑或欲望是否具体。
4. ipFit：IP匹配度。如果提供了IP信息，判断选题是否契合其定位与受众。
5. worthContinuing：是否值得补全文案。判断是否值得投入时间生产完整脚本。

严格按JSON格式输出，不要输出任何其他文字。`;

const TITLE_PROMPT = (title: string, ipContext: IPContext | null) => `待诊断的标题：
"""
${title}
"""

${ipContext
  ? `当前操盘IP：名称=${ipContext.name}，定位=${ipContext.positioning}，受众=${ipContext.audience}，内容方向=${ipContext.contentDirection.join("、")}，平台=${ipContext.platforms.join("、")}`
  : "未提供当前IP信息，ipFit.tier返回null，ipFit.reason返回空字符串。"}

请严格按以下JSON格式输出：
{
  "titleStructure": "${TITLE_STRUCTURES}（五选一）",
  "contentDirection": ["1-3个内容方向标签"],
  "titleAttraction": { "score": 0-10整数, "reason": "具体评分依据" },
  "topicPotential": { "score": 0-10整数, "reason": "选题空间判断依据" },
  "painPointClarity": { "score": 0-10整数, "painPoint": "具体人群或问题", "reason": "判断依据" },
  "ipFit": { "tier": "高度匹配｜中度匹配｜低度匹配｜null", "reason": "判断依据，没有IP信息时为空字符串" },
  "worthContinuing": { "verdict": "值得补全｜可以补全｜不建议补全", "reason": "下一步行动建议" },
  "titleDiagnosisGrade": "A｜B｜C",
  "overallSummary": "30-60字总结"
}`;

const TRANSCRIPT_SYSTEM = `你是短视频完整口播或文案的资深诊断分析师。任务是拆解一段完整内容的结构和质量，并把真正可复用的做法提炼成方法卡。

核心规则：
1. 基础信息只能从输入文本里提取，提取不出来返回空字符串，绝对不能编造。没有明确标题时title留空，代码会生成临时标题。
2. 评级采用严进严出：内容层至少命中2项；结构层包含3秒钩子、价值输出、结尾引导和结构完整；钩子5个维度各评0-10分；排除低质流水账和标题党；完成自我检查。
3. 句子级标注只返回阶段和情绪，不要计算占比，占比由代码统计。
4. IP匹配度只给高度、中度、低度三个档位，不给虚构百分比。
5. 方法卡只提炼真正值得沉淀的做法，targetCategory只能来自：${METHOD_CATEGORY_LIST}。没有可沉淀方法时返回空数组。

严格按JSON格式输出，不要输出任何其他文字。`;

const TRANSCRIPT_PROMPT = (
  inputRaw: string,
  sentences: string[],
  ipContext: IPContext | null,
  hasMetrics: boolean,
) => `输入内容：
"""
${inputRaw}
"""

句子编号列表：
${sentences.map((sentence, index) => `[${index}] ${sentence}`).join("\n")}

${ipContext
  ? `当前操盘IP：名称=${ipContext.name}，定位=${ipContext.positioning}，受众=${ipContext.audience}，内容方向=${ipContext.contentDirection.join("、")}，平台=${ipContext.platforms.join("、")}`
  : "未提供当前IP信息，ipFitTier返回null，ipFitReason返回空字符串。"}

${hasMetrics
  ? "用户提供了真实互动数据，指标层由代码核算。"
  : "用户没有提供真实互动数据，指标层不适用，其余各层照常评估。"}

请严格按以下JSON格式输出：
{
  "title": "从文本提取的标题，提取不到给空字符串",
  "author": "从文本提取的作者，提取不到给空字符串",
  "platform": "从文本提取的平台，提取不到给空字符串",
  "publishedAt": "从文本提取的发布时间，提取不到给空字符串",
  "contentDirection": ["1-3个内容方向标签"],
  "hook": "开头钩子原文",
  "hookType": "${HOOK_TYPES}（八选一）",
  "hookScore": { "painPoint": 0-10整数, "curiosity": 0-10整数, "conflict": 0-10整数, "benefit": 0-10整数, "emotion": 0-10整数, "total": 五项之和 },
  "whyViral": "传播原因和具体证据",
  "structureBreakdownText": "按钩子、价值输出和结尾引导说明结构",
  "contentLayerPassed": true或false,
  "contentLayerMatched": ["命中的内容层项目"],
  "structureLayerPassed": true或false,
  "structureLayerMissing": ["缺失的结构项目"],
  "exclusionMatched": "命中的排除标准，没有则为null",
  "selfCheckPassed": true或false,
  "selfCheckReasoning": "自我检查依据",
  "worthLearning": "值得学习｜部分学习｜不建议学习",
  "worthLearningReason": "具体依据",
  "ipFitTier": "高度匹配｜中度匹配｜低度匹配｜null",
  "ipFitReason": "具体依据，没有IP信息时为空字符串",
  "titleStructure": "${TITLE_STRUCTURES}（五选一）",
  "openingHookType": "${OPENING_HOOK_TYPES}（五选一）",
  "userNeedLayer": "${NEED_LAYERS}（六选一）",
  "sentenceStageTags": [{ "index": 句子编号, "stage": "Hook｜Problem｜Solution｜Case｜CTA｜none" }],
  "sentenceEmotionTags": [{ "index": 句子编号, "emotions": ["焦虑｜希望｜好奇｜羡慕｜优越感｜危机感"] }],
  "methodCards": [{
    "name": "具体方法名",
    "targetCategory": "${METHOD_CATEGORY_LIST}（五选一）",
    "summary": "50-120字说明方法和适用场景",
    "evidenceQuote": "能证明该方法的原文"
  }]
}`;

function hasRealMetrics(metrics: MetricsInput | null): boolean {
  return !!metrics && (
    metrics.likes > 0 ||
    metrics.comments > 0 ||
    metrics.shares > 0 ||
    metrics.favorites > 0 ||
    metrics.aboveAccountAverage
  );
}

function metricsEvaluation(metrics: MetricsInput | null) {
  const hasMetrics = hasRealMetrics(metrics);
  const passed = hasMetrics && !!metrics && (
    metrics.likes > 1000 ||
    metrics.comments > 100 ||
    metrics.shares > 50 ||
    metrics.favorites > 100 ||
    metrics.aboveAccountAverage
  );
  const reason = !hasMetrics
    ? "未提供真实互动数据，本次评级仅基于内容质量与结构，不代表已验证的真实传播表现"
    : passed
      ? "提供的真实数据满足指标层阈值"
      : "提供的真实数据未达到指标层阈值（点赞>1000/评论>100/转发>50/收藏>100/播放量明显高于账号平均）";
  return { hasMetrics, passed, reason };
}

function responseApiMeta(
  base: ApiMeta,
  result: {
    attempts: number;
    responseMeta: { requestId: string | null; finishReason: string | null };
  },
) {
  return {
    ...base,
    attempts: result.attempts,
    providerRequestId: result.responseMeta.requestId,
    finishReason: result.responseMeta.finishReason,
  };
}

async function handleTitleMode(
  inputRaw: string,
  ipContext: IPContext | null,
  apiKey: string,
  apiMeta: ApiMeta,
) {
  const result = await callStructuredDeepSeek({
    systemPrompt: TITLE_SYSTEM,
    userPrompt: TITLE_PROMPT(inputRaw, ipContext),
    parse: parseHotAnalysisTitleResponse,
    apiKey,
    maxTokens: 1500,
    temperature: 0.3,
  });
  const parsed = result.data;

  return NextResponse.json({
    mode: "title",
    title: inputRaw,
    author: "",
    platform: "",
    publishedAt: "",
    contentDirection: parsed.contentDirection,
    titleStructure: parsed.titleStructure,
    titleEvaluation: {
      titleAttraction: parsed.titleAttraction,
      topicPotential: parsed.topicPotential,
      painPointClarity: parsed.painPointClarity,
      ipFit: parsed.ipFit,
      worthContinuing: parsed.worthContinuing,
      titleDiagnosisGrade: parsed.titleDiagnosisGrade,
      overallSummary: parsed.overallSummary,
    },
    evaluation: null,
    dna: null,
    methodCards: [],
    hasRealMetrics: false,
    ipFitTier: parsed.ipFit.tier,
    ipFitReason: parsed.ipFit.reason,
    worthLearning: parsed.worthContinuing.verdict,
    worthLearningReason: parsed.worthContinuing.reason,
    apiMeta: responseApiMeta(apiMeta, result),
  });
}

async function handleContentMode(
  inputRaw: string,
  ipContext: IPContext | null,
  metrics: MetricsInput | null,
  apiKey: string,
  apiMeta: ApiMeta,
  inputType: "transcript" | "copy",
) {
  const sentences = splitSentences(inputRaw);
  const metricsResult = metricsEvaluation(metrics);
  const result = await callStructuredDeepSeek({
    systemPrompt: TRANSCRIPT_SYSTEM,
    userPrompt: TRANSCRIPT_PROMPT(
      inputRaw,
      sentences,
      ipContext,
      metricsResult.hasMetrics,
    ),
    parse: parseHotAnalysisResponse,
    apiKey,
    maxTokens: 3500,
    temperature: 0.3,
  });
  const parsed = result.data;
  const title = parsed.title || deriveTitleFromOpening(inputRaw);
  const titleAutoGenerated = !parsed.title;
  const total = parsed.hookScore.total;
  const grade: "S" | "A" | "B" | "不收录" = total >= 45
    ? "S"
    : total >= 35
      ? "A"
      : total >= 25
        ? "B"
        : "不收录";
  const admitted = (metricsResult.hasMetrics ? metricsResult.passed : true) &&
    parsed.contentLayerPassed &&
    parsed.structureLayerPassed &&
    !parsed.exclusionMatched &&
    total >= 25 &&
    parsed.selfCheckPassed;

  const evaluation = {
    account: "",
    track: "",
    hook: parsed.hook,
    hookType: parsed.hookType,
    hookScore: parsed.hookScore,
    grade,
    whyViral: parsed.whyViral,
    structureBreakdown: parsed.structureBreakdownText,
    metricsLayerPassed: metricsResult.passed,
    metricsLayerReason: metricsResult.reason,
    contentLayerPassed: parsed.contentLayerPassed,
    contentLayerMatched: parsed.contentLayerMatched,
    structureLayerPassed: parsed.structureLayerPassed,
    structureLayerMissing: parsed.structureLayerMissing,
    exclusionMatched: parsed.exclusionMatched,
    selfCheckPassed: parsed.selfCheckPassed,
    selfCheckReasoning: parsed.selfCheckReasoning,
    admitted,
  };

  const totalChars = sentences.reduce(
    (sum, sentence) => sum + sentence.length,
    0,
  ) || 1;
  const stages = ["Hook", "Problem", "Solution", "Case", "CTA"] as const;
  const structureBreakdown = stages.map((stage) => {
    const matched = parsed.sentenceStageTags
      .filter((tag) => tag.stage === stage)
      .map((tag) => sentences[tag.index])
      .filter(Boolean);
    const characters = matched.reduce(
      (sum, sentence) => sum + sentence.length,
      0,
    );
    return {
      stage,
      percentage: Math.round((characters / totalChars) * 100),
      content: matched.join(""),
    };
  });
  const sentenceCount = sentences.length || 1;
  const emotionValue = EMOTIONS.map((emotion) => {
    const count = parsed.sentenceEmotionTags
      .filter((tag) => tag.emotions.includes(emotion))
      .length;
    return {
      emotion,
      percentage: Math.round((count / sentenceCount) * 100),
    };
  }).filter((item) => item.percentage > 0);

  return NextResponse.json({
    mode: inputType,
    title,
    titleAutoGenerated,
    author: parsed.author,
    platform: parsed.platform,
    publishedAt: parsed.publishedAt,
    contentDirection: parsed.contentDirection,
    evaluation,
    hasRealMetrics: metricsResult.hasMetrics,
    worthLearning: parsed.worthLearning,
    worthLearningReason: parsed.worthLearningReason,
    ipFitTier: parsed.ipFitTier,
    ipFitReason: parsed.ipFitReason,
    dna: {
      titleStructure: parsed.titleStructure,
      openingHookType: parsed.openingHookType,
      openingHookText: parsed.hook,
      structureBreakdown,
      emotionValue,
      userNeedLayer: parsed.userNeedLayer,
    },
    methodCards: parsed.methodCards,
    titleEvaluation: null,
    apiMeta: responseApiMeta(apiMeta, result),
  });
}

function getErrorStage(error: unknown) {
  if (error instanceof StructuredDeepSeekError) {
    if (error.cause instanceof HotAnalysisResponseError) {
      return error.cause.code;
    }
    if (error.stage === "timeout") return "timeout";
    if (error.stage === "request") return "request_failed";
    return "processing_failed";
  }
  if (error instanceof HotAnalysisResponseError) return error.code;
  return "processing_failed";
}

function errorMessage(stage: string): string {
  if (stage === "empty_content") return "AI未返回有效内容";
  if (stage === "invalid_json") return "AI返回格式异常";
  if (stage === "incomplete_fields") return "分析结果字段不完整";
  if (stage === "timeout") return "分析生成超时，已自动重试，请稍后再试";
  if (stage === "request_failed") return "AI请求失败";
  return "分析失败，请重试";
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const inputType = body.inputType ?? "transcript";
  if (!["transcript", "copy", "title"].includes(inputType)) {
    return NextResponse.json({ error: "不支持的分析模式" }, { status: 400 });
  }
  const inputRaw = (body.inputRaw ?? "").trim();
  if (!inputRaw) {
    return NextResponse.json(
      {
        error: "请提供要分析的内容",
        apiMeta: {
          apiCalled: false,
          calledAt: new Date().toISOString(),
          model: MODEL,
          ipUsed: null,
          mockHit: false,
        },
      },
      { status: 400 },
    );
  }

  const requestId = crypto.randomUUID();
  const isDevelopment = process.env.NODE_ENV !== "production";
  const apiMeta: ApiMeta = {
    apiCalled: true,
    calledAt: new Date().toISOString(),
    model: MODEL,
    ipUsed: body.ipContext?.name ?? null,
    mockHit: false,
    ...(isDevelopment ? { requestId } : {}),
  };

  try {
    if (inputType === "title") {
      return await handleTitleMode(
        inputRaw,
        body.ipContext ?? null,
        apiKey,
        apiMeta,
      );
    }
    return await handleContentMode(
      inputRaw,
      body.ipContext ?? null,
      body.metrics ?? null,
      apiKey,
      apiMeta,
      inputType,
    );
  } catch (error) {
    const stage = getErrorStage(error);
    const message = errorMessage(stage);
    if (isDevelopment) {
      console.error("[hot-analysis]", {
        requestId,
        errorStage: stage,
        message: error instanceof Error ? error.message : "未知错误",
      });
    }
    return NextResponse.json(
      {
        error: message,
        ...(isDevelopment ? { errorCode: stage, requestId } : {}),
        apiMeta: {
          ...apiMeta,
          error: message,
          attempts: error instanceof StructuredDeepSeekError
            ? error.attempts
            : 1,
          ...(isDevelopment ? { errorStage: stage } : {}),
        },
      },
      { status: stage === "timeout" ? 504 : 500 },
    );
  }
}
