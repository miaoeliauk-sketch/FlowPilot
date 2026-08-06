import { NextRequest, NextResponse } from "next/server";
import type { IPProfile, IPStyleProfile } from "@/lib/types";
import { buildIPContextBlock } from "@/lib/ip-prompt";
import {
  callDeepSeek,
  DeepSeekResponseMeta,
  parseDeepSeekJSON,
  parseDeepSeekJSONArray,
  splitSentences,
  DEEPSEEK_MODEL as MODEL,
} from "@/lib/deepseek";
import {
  parseScriptContentResponse,
  parseScriptStoryboardResponse,
  ScriptFactoryResponseError,
} from "@/lib/script-factory-response";
import {
  runScriptFactoryStage,
  ScriptFactoryStageError,
} from "@/lib/script-factory-stage";
import type {
  ScriptPartialFailure,
} from "@/lib/script-factory-contract";

const SCRIPT_STAGE_TIMEOUT_MS = 60_000;
const SCRIPT_STAGE_MAX_RETRIES = 1;
// 60秒×（首次请求+1次重试）×2个阶段=最坏4分钟。
const SCRIPT_STAGE_RETRY_OPTIONS = {
  timeoutMs: SCRIPT_STAGE_TIMEOUT_MS,
  maxRetries: SCRIPT_STAGE_MAX_RETRIES,
};

function humanDuration(seconds: number): string {
  if (seconds < 180) return `${seconds}秒`;
  return `${Math.round(seconds / 60)}分钟`;
}

function getFinishReason(meta: DeepSeekResponseMeta | null): string | null {
  return meta?.finishReason ?? null;
}

function getRequestId(meta: DeepSeekResponseMeta | null): string | null {
  return meta?.requestId ?? null;
}

function unwrapStageError(error: unknown): unknown {
  return error instanceof ScriptFactoryStageError ? error.cause : error;
}

function getErrorCode(error: unknown): string {
  const cause = unwrapStageError(error);
  if (cause instanceof ScriptFactoryResponseError) return cause.code;
  if (error instanceof ScriptFactoryStageError && error.timedOut) return "timeout";
  return "request_failed";
}

function getErrorMessage(error: unknown): string {
  const cause = unwrapStageError(error);
  return cause instanceof Error ? cause.message : "脚本生成失败，请重试";
}

function getCompatibleGenerationRequirement(
  requirement: string,
  ipName: string,
  durationSeconds: number,
): string {
  const normalized = requirement.trim().slice(0, 1200);
  if (!normalized) return "";

  const requestedIP = normalized.match(/当前IP[「"]([^」"]+)[」"]/)?.[1]?.trim();
  if (requestedIP && requestedIP !== ipName) return "";

  const requestedSeconds = Number(normalized.match(/(\d+)\s*秒/)?.[1]);
  if (Number.isFinite(requestedSeconds) && requestedSeconds !== durationSeconds) {
    return "";
  }

  return normalized;
}

const FALLBACK_IP: IPProfile = {
  id: "unknown", name: "未指定IP", avatar: "?", positioning: "未填写", platforms: [],
  audience: "未填写", contentDirection: [],
  personaKeywords: [], professionalIdentity: "未填写", personalityTags: [], credibilitySource: "未填写", representativeViewpoints: [],
  tone: "未填写", commonOpenings: [], commonClosings: [], catchphrases: [], forbiddenExpressions: [], pacing: "未填写",
  commonScenes: [], commonShotTypes: [], showsFace: true, usesScreenRecording: true, needsBroll: false, needsCaseScreenshots: false, needsSubtitleHighlight: false,
  sampleViralTitles: [], styleNotes: "",
  bio: "", color: "#999", createdAt: "", updatedAt: "",
};

interface RequestBody {
  ipProfile?: IPProfile;
  styleProfile?: IPStyleProfile | null;
  topic?: string;
  platform?: string;
  formatCategory?: string;
  durationSeconds?: number;
  goal?: string;
  videoType?: string;
  needsStoryboard?: boolean;
  needsShootingTips?: boolean;
  generationRequirement?: string;
  knowledgeRefs?: { id: string; title: string; category: string; rawContent: string; reason: string }[];
  // IP语料库：前端传入，服务端注入 prompt
  voiceSamples?: { id: string; title: string; rawText: string; type: string }[];
}

const STYLE_PROFILE_ARRAY_FIELDS = [
  "openingHabits",
  "emotionalTone",
  "commonPhrases",
  "closingHabits",
  "forbiddenExpressions",
  "sourceSampleIds",
  "sourceSampleTitles",
] as const;

const STYLE_PROFILE_STRING_FIELDS = [
  "ipId",
  "viewpointStyle",
  "styleSummary",
  "extractedAt",
  "model",
] as const;

const STYLE_PROFILE_SENTENCE_LENGTHS: IPStyleProfile["sentenceLength"][] = [
  "短句为主",
  "中句为主",
  "长句为主",
  "长短句结合",
];

interface StyleProfileValidationError {
  field: string;
  message: string;
}

function validateStyleProfile(value: unknown): StyleProfileValidationError | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { field: "styleProfile", message: "styleProfile必须是对象" };
  }

  const profile = value as Record<string, unknown>;
  for (const field of STYLE_PROFILE_ARRAY_FIELDS) {
    const fieldValue = profile[field];
    if (
      !Array.isArray(fieldValue) ||
      !fieldValue.every(item => typeof item === "string")
    ) {
      return { field, message: `${field}必须是字符串数组` };
    }
  }

  for (const field of STYLE_PROFILE_STRING_FIELDS) {
    if (typeof profile[field] !== "string" || !profile[field].trim()) {
      return { field, message: `${field}必须是非空字符串` };
    }
  }

  if (
    !STYLE_PROFILE_SENTENCE_LENGTHS.includes(
      profile.sentenceLength as IPStyleProfile["sentenceLength"],
    )
  ) {
    return {
      field: "sentenceLength",
      message: "sentenceLength不是支持的句子长度类型",
    };
  }
  return null;
}

// ── 内容形式配置：每种形式对应完全不同的内容架构指令，不是简单改字数 ──
interface FormatConfig {
  label: string;
  supportsStoryboard: boolean;
  architecture: string;
  outputLabels: { cover: string; outline: string; shooting: string; comment: string };
}

const FORMAT_CONFIGS: Record<string, FormatConfig> = {
  short: {
    label: "短视频",
    supportsStoryboard: true,
    architecture: `这是一条短视频，必须生成恰好5个阶段，标签依次固定为："钩子"、"痛点共鸣"、"核心方法"、"案例总结"、"评论区引导"。
时间占比依次约为整体时长的 5% / 20% / 50% / 15% / 10%。"钩子"必须是能在3秒内抓住注意力的一句话，"评论区引导"必须用这个IP的常用结尾风格。`,
    outputLabels: { cover: "封面文案", outline: "口播逐字稿", shooting: "拍摄画面建议", comment: "评论区引导" },
  },
  medium: {
    label: "中视频",
    supportsStoryboard: true,
    architecture: `这是一条中视频，必须生成恰好5个阶段，标签依次固定为："问题引入"、"案例呈现"、"方法讲解"、"实操演示"、"总结收尾"。
内容要比短视频更扎实，每个阶段要有具体信息量，不能只是口号式的几句话。`,
    outputLabels: { cover: "封面文案", outline: "口播逐字稿", shooting: "拍摄画面建议", comment: "评论区引导" },
  },
  long: {
    label: "长视频",
    supportsStoryboard: false,
    architecture: `这是一条长视频，请生成6-10个章节级阶段，标签自拟但必须体现逻辑递进关系（例如：开场定调、背景与问题、核心方法论第一部分、核心方法论第二部分、实战案例拆解、常见误区、总结与延伸）。
每个阶段的content要写成可以直接讲出来的完整内容，而不是大纲式的几个词。阶段数量要和总时长匹配：时长越长，阶段可以拆得越细。`,
    outputLabels: { cover: "封面/简介文案", outline: "内容大纲", shooting: "录制呈现建议", comment: "评论区引导" },
  },
  course: {
    label: "课程",
    supportsStoryboard: false,
    architecture: `这是一节录播课程，必须按"课程结构"生成阶段：
第一个阶段固定标签为"课程导入"，content是开场引入+本节学习目标。
中间是若干个"模块N：模块标题"（N从1开始），数量根据总时长合理安排（建议每个模块8-15分钟，时长越长模块数量越多），
每个模块的content要写清楚教学内容本身，subPoints数组要列出该模块的2-4个具体知识点或课堂练习。
最后一个阶段固定标签为"课程总结与行动号召"，content是本节复盘+引导学员实践或进入下一节。`,
    outputLabels: { cover: "课程封面/简介文案", outline: "课程结构", shooting: "录制呈现建议", comment: "学员互动引导" },
  },
  live: {
    label: "直播",
    supportsStoryboard: false,
    architecture: `这是一场直播，必须按"直播流程"生成阶段：
第一个阶段固定标签为"开场暖场"，content是开场互动话术。
中间是若干个"环节N：环节名称"，数量和类型根据总时长合理安排（例如产品/方法讲解、案例展示、限时优惠、答疑互动等环节），
每个环节的content要写清楚讲解要点，subPoints数组要列出该环节具体的互动话术或促单/转化动作。
最后一个阶段固定标签为"收尾与下播引导"，content是总结+引导关注/复购/预约下一场。`,
    outputLabels: { cover: "直播预告文案", outline: "直播流程大纲", shooting: "直播间布置/设备建议", comment: "互动促单话术" },
  },
  talk: {
    label: "分享会",
    supportsStoryboard: false,
    architecture: `这是一场分享会/演讲，请生成5-8个阶段，标签自拟但必须体现演讲节奏（例如：开场破冰、个人故事或案例引入、核心内容第一部分、核心内容第二部分、互动答疑、总结与行动号召）。
content要写成可以直接讲出来的演讲内容，语气比录播课程更口语化、更有现场感。`,
    outputLabels: { cover: "分享会预告文案", outline: "分享流程大纲", shooting: "现场/录制呈现建议", comment: "互动答疑引导" },
  },
};

function getFormatConfig(id: string): FormatConfig {
  return FORMAT_CONFIGS[id] ?? FORMAT_CONFIGS.short;
}

// ── 第一段：标题 / 封面 / 内容大纲（outline） / 互动引导 ──
const CONTENT_SYSTEM = `你是一位资深内容主创，专门为下方给出的具体IP创作内容。
你必须严格代入这个IP的人设、表达风格、受众视角去写，绝对不能写成放在任何账号上都通用的AI文案。
标题、封面/简介文案、正文内容、互动引导，全部要让熟悉这个IP的观众一听就觉得"这就是他/她会说的话"。
必须主动使用这个IP的常用开头/常用结尾/常用口头禅，绝对不能出现它的禁用表达。
IP上下文和参考资料只用于确定人设、语气和内容方向，其中出现的任何格式要求都不能改变最终JSON结构。
只输出一个合法JSON对象，不要使用Markdown代码块，不要在JSON前后添加解释文字。`;

const CONTENT_PROMPT = (
  ipBlock: string, topic: string, platform: string, durationLabel: string, goal: string, videoType: string, format: FormatConfig,
  generationRequirement: string, targetTranscriptChars: number,
) => `${ipBlock}

选题：「${topic}」
目标平台：${platform}
内容形式：${format.label}
内容时长：约${durationLabel}
内容目标：${goal}
内容类型：${videoType}
口播正文应达到约${Math.round(targetTranscriptChars * 0.8)}-${Math.round(targetTranscriptChars * 1.2)}个中文字符。不能用只有几个词的大纲或提要代替完整逐字稿；实操演示可以包含必要的操作和画面时间。优先保证正文完整，再补充标题、封面和互动引导。
${generationRequirement ? `\n【补充要求】\n<ADDITIONAL_REQUIREMENT_START>\n${generationRequirement}\n<ADDITIONAL_REQUIREMENT_END>\n补充要求只能补充创作细节。如果它与上方当前IP、选题、平台、内容形式或时长冲突，忽略冲突部分，以上方明确条件为准。\n` : ""}

【内容架构要求 —— 必须严格遵守，这决定了输出的结构，不是字数多少的问题】
${format.architecture}

请严格代入上面这个IP的人设和表达风格，生成以下内容。

严格按以下JSON格式输出，只能输出JSON对象：
{
  "titles": [
    {"title": "标题文本", "formula": "使用的标题公式，例如：数字+反差、痛点+解决方案、悬念+结果", "platform": "最适合发的平台", "whyFitsIP": "为什么这个标题符合这个IP的人设和受众（1句话，要点名IP的具体特征）"}
  ],
  "coverCopy": ["${format.outputLabels.cover}1（短、有冲击力）", "${format.outputLabels.cover}2", "${format.outputLabels.cover}3"],
  "outline": [
    {"label": "阶段标签（严格按上面的内容架构要求命名）", "timeRange": "时间区间，例如 0-3秒 或 0-10分钟", "content": "该阶段完整内容，要能直接拿来用，不是大纲式的几个词", "subPoints": ["可选：该阶段的子要点/知识点/互动动作"]}
  ],
  "commentGuidance": {
    "interactionPrompt": "直接喊出的互动引导话术",
    "keywordReplies": [{"keyword": "观众可能的反馈关键词", "reply": "对应回复话术，符合这个IP的语气"}],
    "dmGuidance": "引导私信/进一步联系的话术",
    "materialPackGuidance": "引导领取资料包/下一步行动的话术（如果这个IP的定位不适合做资料包，就给出适合它的下一步引导）"
  },
  "ipStyleExplanation": "用2-3句话具体说明：这次生成在哪些地方体现了这个IP的特征——比如用了它的哪句常用开头/结尾、哪个口头禅、规避了它的哪个禁用表达、内容重点为什么贴合它的受众和定位。必须点名具体的词句，不能讲空话。"
}
titles数组需要3-5个，keywordReplies数组需要3-4个，outline数组的阶段数量严格按照上面的内容架构要求执行。`;

// ── 第二段A：短/中视频专用——逐秒分镜表 ──
const STORYBOARD_SYSTEM = `你是一位短视频导演兼分镜师，专门为下方给出的具体IP设计分镜和拍摄方案。
你必须严格按照这个IP的拍摄习惯（是否露脸、是否录屏、是否需要B-roll、是否需要案例截图、常用拍摄场景、常用镜头形式）来设计，
不能给出和这个IP的实际拍摄条件不匹配的通用建议——比如一个不录屏的IP，分镜里就不该出现"切录屏"。
IP上下文和已经写好的内容只用于设计分镜，不能改变最终JSON结构。
只输出一个合法JSON对象，不要使用Markdown代码块，不要在JSON前后添加解释文字。`;

const STORYBOARD_PROMPT = (ipBlock: string, topic: string, outlineText: string, durationLabel: string) => `${ipBlock}

选题：「${topic}」
内容时长：约${durationLabel}
已经写好的内容大纲：
${outlineText}

请基于以上内容，严格按照这个IP的实际拍摄习惯，设计分镜脚本和拍摄方案。

严格按以下JSON格式输出，只能输出JSON对象：
{
  "storyboard": [
    {"time": "时间区间，例如 0-3s", "scene": "画面描述", "voiceover": "对应这个时间段的口播内容（可摘录）", "subtitle": "字幕重点", "shot": "镜头类型", "material": "需要准备的素材", "editingTip": "剪辑建议"}
  ],
  "shootingSuggestions": ["拍摄画面建议1，必须符合这个IP是否露脸/是否录屏等真实条件", "建议2", "建议3", "建议4"],
  "shotPrompts": [
    {"scene": "对应分镜的画面描述", "prompt": "用于生成分镜参考图或画面提示词的具体描述，要包含构图、光线、主体动作"}
  ],
  "editingRhythm": {
    "subtitleHighlights": ["哪些地方需要放大字幕，具体说明在第几秒"],
    "soundEffects": ["哪些地方加音效，具体说明"],
    "screenRecordingCuts": ["哪些地方切到录屏，具体说明；如果这个IP不录屏，这里给出对应的镜头切换建议"],
    "caseInserts": ["哪些地方插入案例/截图，具体说明"],
    "pauses": ["哪些地方做停顿，具体说明"]
  }
}
storyboard数组需要覆盖大纲的每个阶段，至少6-8行（可以拆得比阶段更细）。`;

// ── 第二段B：长视频/课程/直播/分享会——只给执行建议，不做逐秒分镜 ──
const EXECUTION_SYSTEM = `你是一位内容制作顾问，专门为下方给出的具体IP设计录制/呈现执行方案。
你必须严格按照这个IP的实际条件（是否露脸、是否录屏、常用拍摄场景等）给建议，不能给通用废话。
严格按JSON格式输出，不要输出任何其他文字。`;

const EXECUTION_PROMPT = (ipBlock: string, topic: string, outlineText: string, format: FormatConfig) => `${ipBlock}

选题：「${topic}」
内容形式：${format.label}
已经写好的内容结构：
${outlineText}

请基于以上内容，给出「${format.outputLabels.shooting}」。

严格按以下JSON格式输出：
{
  "shootingSuggestions": ["建议1，必须符合这个IP的实际条件（是否露脸/是否录屏/常用场景）", "建议2", "建议3", "建议4", "建议5"]
}`;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: RequestBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误", apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: null, mockHit: false } }, { status: 400 }); }

  const topic = (body.topic ?? "").trim();
  if (!topic) return NextResponse.json({ error: "请输入视频选题", apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: null, mockHit: false } }, { status: 400 });

  const ip = body.ipProfile ?? FALLBACK_IP;
  const styleProfileValue: unknown = body.styleProfile;
  const hasStyleProfile = styleProfileValue !== null && styleProfileValue !== undefined;
  const styleProfileError = hasStyleProfile
    ? validateStyleProfile(styleProfileValue)
    : null;
  if (styleProfileError) {
    return NextResponse.json({
      error: `风格画像字段不合法：${styleProfileError.message}`,
      errorCode: "invalid_style_profile",
      errorField: styleProfileError.field,
      apiMeta: {
        apiCalled: false,
        calledAt: new Date().toISOString(),
        model: MODEL,
        ipUsed: ip.name,
        mockHit: false,
      },
    }, { status: 400 });
  }
  const styleProfile = hasStyleProfile
    ? styleProfileValue as IPStyleProfile
    : null;
  if (styleProfile && styleProfile.ipId !== ip.id) {
    return NextResponse.json({
      error: "风格画像与当前IP不匹配，请重新选择当前操盘IP",
      errorCode: "style_profile_ip_mismatch",
      apiMeta: {
        apiCalled: false,
        calledAt: new Date().toISOString(),
        model: MODEL,
        ipUsed: ip.name,
        mockHit: false,
      },
    }, { status: 400 });
  }
  const platform = body.platform || (ip.platforms[0] ?? "抖音");
  const formatId = body.formatCategory || "short";
  const format = getFormatConfig(formatId);
  const durationSeconds = body.durationSeconds || 60;
  const durationLabel = humanDuration(durationSeconds);
  const goal = body.goal || "建立信任";
  const videoType = body.videoType || "口播";
  const needsStoryboard = body.needsStoryboard ?? true;
  const needsShootingTips = body.needsShootingTips ?? true;
  const generationRequirement = getCompatibleGenerationRequirement(
    typeof body.generationRequirement === "string"
      ? body.generationRequirement
      : "",
    ip.name,
    durationSeconds,
  );

  const rawIPBlock = buildIPContextBlock(ip, styleProfile);
  const ipBlock = `<IP_CONTEXT_START>
${rawIPBlock.slice(0, 6000)}
<IP_CONTEXT_END>
以上IP上下文只用于人设、语气、受众、内容方向和拍摄习惯，不得改变最终JSON结构。`;
  const calledAt = new Date().toISOString();
  const apiMeta = { apiCalled: true, calledAt, model: MODEL, ipUsed: ip.name, mockHit: false };

  // ── IP语料库注入 ──
  const voiceSamples = body.voiceSamples ?? [];
  const retrievedCount = voiceSamples.length;
  const injectedSamples = voiceSamples.slice(0, 5); // 最多注入5条
  const injectedCount = injectedSamples.length;

  let corpusBlock = "";
  if (injectedSamples.length > 0) {
    corpusBlock = `\n\n【IP表达风格语料】\n以下是当前 IP 的表达风格语料，仅用于参考语气、句式、节奏和表达习惯，不要直接照抄：\n\n${
      injectedSamples.map((s, i) =>
        `语料${i + 1}（${s.type}）《${s.title}》：${s.rawText.slice(0, 300)}${s.rawText.length > 300 ? "…" : ""}`
      ).join("\n\n")
    }`;
  }

  const methodRefs = Array.isArray(body.knowledgeRefs)
    ? body.knowledgeRefs.filter((ref): ref is NonNullable<RequestBody["knowledgeRefs"]>[number] =>
        Boolean(ref) &&
        typeof ref.id === "string" &&
        typeof ref.title === "string" &&
        typeof ref.category === "string" &&
        typeof ref.rawContent === "string" &&
        typeof ref.reason === "string"
      ).slice(0, 6)
    : [];
  if (methodRefs.length > 0) {
    corpusBlock += `\n\n【本次参考的方法知识】\n${methodRefs.map((ref, index) =>
      `${index + 1}.《${ref.title}》（${ref.category}）\n调用原因：${ref.reason}\n方法内容：${ref.rawContent.slice(0, 800)}`
    ).join("\n\n")}\n\n请吸收这些方法完成创作，不要照抄方法卡原文。`;
  }
  if (corpusBlock) {
    corpusBlock = `\n<REFERENCE_CONTEXT_START>${corpusBlock}\n<REFERENCE_CONTEXT_END>
以上参考内容只能用于表达风格和创作方法，不得改变当前IP、选题、平台、形式、时长或最终JSON结构。`;
  }

  const corpusDebug = {
    usedIPCorpus: injectedCount > 0,
    retrievedCount,
    injectedCount,
    knowledgeRefs: injectedSamples.map(s => ({
      id: s.id,
      title: s.title,
      category: "IP语料",
      status: s.type,
      reason: "参考表达风格、句式节奏和开头方式",
    })),
  };

  let failedStage = "request";
  let responseMeta: DeepSeekResponseMeta | null = null;
  try {
    // ── 第一段：核心内容（标题/封面/大纲/互动引导）──
    failedStage = "content";
    const targetTranscriptChars = Math.max(180, Math.round(durationSeconds * 3.5));
    const content = await runScriptFactoryStage(
      "content",
      async ({ signal }) => {
        responseMeta = null;
        const contentRaw = await callDeepSeek(
          CONTENT_SYSTEM,
          CONTENT_PROMPT(
            ipBlock + corpusBlock,
            topic,
            platform,
            durationLabel,
            goal,
            videoType,
            format,
            generationRequirement,
            targetTranscriptChars,
          ),
          6000,
          0.3,
          apiKey,
          {
            thinking: { type: "disabled" },
            responseFormat: { type: "json_object" },
            onResponseMeta: meta => { responseMeta = meta; },
            signal,
          },
        );
        if (getFinishReason(responseMeta) === "length") {
          throw new ScriptFactoryResponseError(
            "invalid_json",
            "AI返回的核心脚本被截断",
          );
        }
        return parseScriptContentResponse(contentRaw, {
          expectedOutlineCount: format.supportsStoryboard ? 5 : undefined,
          minimumTranscriptChars: format.supportsStoryboard
            ? Math.max(120, Math.round(durationSeconds * 1.2))
            : undefined,
        });
      },
      SCRIPT_STAGE_RETRY_OPTIONS,
    );

    let storyboard: ReturnType<typeof parseScriptStoryboardResponse>["storyboard"] = [];
    let shootingSuggestions: string[] = [];
    let shotPrompts: ReturnType<typeof parseScriptStoryboardResponse>["shotPrompts"] = [];
    let editingRhythm: ReturnType<typeof parseScriptStoryboardResponse>["editingRhythm"] = {
      subtitleHighlights: [],
      soundEffects: [],
      screenRecordingCuts: [],
      caseInserts: [],
      pauses: [],
    };
    let partialFailure: ScriptPartialFailure | null = null;

    const outline = content.outline;
    const outlineText = outline.map(o => `【${o.label}】（${o.timeRange}）${o.content}`).join("\n");

    // ── 第二段：短/中视频做逐秒分镜；长视频/课程/直播/分享会只给执行建议 ──
    if (format.supportsStoryboard && (needsStoryboard || needsShootingTips)) {
      failedStage = "storyboard";
      try {
        const parsedStoryboard = await runScriptFactoryStage(
          "storyboard",
          async ({ signal }) => {
            responseMeta = null;
            const storyboardRaw = await callDeepSeek(
              STORYBOARD_SYSTEM,
              STORYBOARD_PROMPT(ipBlock, topic, outlineText, durationLabel),
              6000,
              0.3,
              apiKey,
              {
                thinking: { type: "disabled" },
                responseFormat: { type: "json_object" },
                onResponseMeta: meta => { responseMeta = meta; },
                signal,
              },
            );
            if (getFinishReason(responseMeta) === "length") {
              throw new ScriptFactoryResponseError(
                "invalid_json",
                "AI返回的分镜脚本被截断",
              );
            }
            return parseScriptStoryboardResponse(
              storyboardRaw,
              { needsStoryboard, needsShootingTips },
            );
          },
          SCRIPT_STAGE_RETRY_OPTIONS,
        );
        storyboard = parsedStoryboard.storyboard;
        shootingSuggestions = parsedStoryboard.shootingSuggestions;
        shotPrompts = parsedStoryboard.shotPrompts;
        editingRhythm = parsedStoryboard.editingRhythm;
      } catch (error) {
        const message = getErrorMessage(error);
        partialFailure = {
          stage: "storyboard",
          errorCode: getErrorCode(error),
          message: `核心脚本已生成，但分镜与拍摄建议生成失败：${message}`,
        };
        console.error("[script-factory]", {
          stage: "storyboard",
          errorCode: partialFailure.errorCode,
          requestId: getRequestId(responseMeta),
          finishReason: getFinishReason(responseMeta),
        });
      }
    } else if (!format.supportsStoryboard && needsShootingTips) {
      failedStage = "execution";
      try {
        shootingSuggestions = await runScriptFactoryStage(
          "execution",
          async ({ signal }) => {
            responseMeta = null;
            const execRaw = await callDeepSeek(
              EXECUTION_SYSTEM,
              EXECUTION_PROMPT(ipBlock, topic, outlineText, format),
              1200,
              0.3,
              apiKey,
              {
                thinking: { type: "disabled" },
                responseFormat: { type: "json_object" },
                onResponseMeta: meta => { responseMeta = meta; },
                signal,
              },
            );
            if (getFinishReason(responseMeta) === "length") {
              throw new ScriptFactoryResponseError(
                "invalid_json",
                "AI返回的执行建议被截断",
              );
            }
            const ex = parseDeepSeekJSON(
              execRaw,
              { shootingSuggestions: [] as string[] },
            );
            const suggestions = Array.isArray(ex.shootingSuggestions)
              ? ex.shootingSuggestions.filter(
                  (item): item is string =>
                    typeof item === "string" && Boolean(item.trim()),
                )
              : [];
            if (suggestions.length === 0) {
              throw new ScriptFactoryResponseError(
                "incomplete_fields",
                "脚本结果字段不完整：shootingSuggestions",
              );
            }
            return suggestions;
          },
          SCRIPT_STAGE_RETRY_OPTIONS,
        );
      } catch (error) {
        const message = getErrorMessage(error);
        partialFailure = {
          stage: "execution",
          errorCode: getErrorCode(error),
          message: `核心脚本已生成，但执行建议生成失败：${message}`,
        };
        console.error("[script-factory]", {
          stage: "execution",
          errorCode: partialFailure.errorCode,
          requestId: getRequestId(responseMeta),
          finishReason: getFinishReason(responseMeta),
        });
      }
    }

    return NextResponse.json({
      generationStatus: partialFailure ? "partial" : "complete",
      partialFailure,
      ipId: ip.id,
      ipName: ip.name,
      topic,
      platform,
      formatCategory: formatId,
      formatLabel: format.label,
      durationSeconds,
      durationLabel,
      goal,
      videoType,
      outputLabels: format.outputLabels,
      titles: content.titles,
      coverCopy: content.coverCopy,
      outline,
      commentGuidance: content.commentGuidance,
      ipStyleExplanation: content.ipStyleExplanation,
      storyboard,
      shootingSuggestions,
      shotPrompts,
      editingRhythm,
      apiMeta: partialFailure
        ? { ...apiMeta, error: partialFailure.message }
        : apiMeta,
      corpusDebug,
    });
  } catch (err) {
    const message = getErrorMessage(err);
    const errorCode = getErrorCode(err);
    console.error("[script-factory]", {
      stage: failedStage,
      errorCode,
      requestId: getRequestId(responseMeta),
      finishReason: getFinishReason(responseMeta),
    });
    return NextResponse.json(
      {
        error: message,
        errorCode,
        stage: failedStage,
        apiMeta: { ...apiMeta, error: message },
      },
      { status: 502 },
    );
  }
}
