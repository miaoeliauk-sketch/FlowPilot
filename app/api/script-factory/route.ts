import { NextRequest, NextResponse } from "next/server";
import type { IPProfile, IPStyleProfile } from "@/lib/types";
import { buildIPContextBlock } from "@/lib/ip-prompt";
import { parseRequiredIPProfile } from "@/lib/ip-profile-validation";
import { parseIPStyleProfileForIP } from "@/lib/ip-style-profile-validation";
import {
  callDeepSeek,
  DeepSeekResponseMeta,
  parseDeepSeekJSON,
  DEEPSEEK_MODEL as MODEL,
} from "@/lib/deepseek";
import {
  callStructuredDeepSeek,
  StructuredDeepSeekError,
} from "@/lib/structured-deepseek";
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
import {
  ARGUMENT_REVIEW_SYSTEM,
  buildArgumentReviewPrompt,
  buildScriptQualityCheck,
  findDenseClosingStyleWarning,
  parseScriptArgumentReview,
} from "@/lib/script-factory-quality";

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
  evidenceGate?: {
    coverage?: string;
    reason?: string;
    sourceReferences?: Array<{
      sourceId: string;
      sourceTitle: string;
      itemId: string;
      kind: string;
      content: string;
      originalExcerpt: string;
      extractionStatus: string;
    }>;
    caseNeed?: string;
    caseDecision?: string | null;
    evidenceConfirmed?: boolean;
    caseEvidence?: {
      title?: string;
      content?: string;
      sourceType?: string;
      verificationStatus?: string;
      sourceUrl?: string;
    } | null;
  } | null;
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
    architecture: `这是一条短视频。先恢复当前IP在原始资料中的思考路径，再按本次观点需要组织成3-7个递进阶段，标签由内容自拟。
每一阶段必须承接上一阶段并把判断推进一层，可以使用现象、提问、概念区分、反驳、推理、案例或结论，但不得为了凑结构全部使用。开头需要尽快呈现真实矛盾，结尾必须由前文推出，不得固定套用评论区引导。`,
    outputLabels: { cover: "封面文案", outline: "口播逐字稿", shooting: "拍摄画面建议", comment: "评论区引导" },
  },
  medium: {
    label: "中视频",
    supportsStoryboard: true,
    architecture: `这是一条中视频。根据当前IP原始观点的实际推理路径生成4-8个递进阶段，标签由内容自拟，不固定要求案例、方法或实操环节。
内容要比短视频更扎实，每一阶段都要说明它如何承接前文并推进判断，不能只是换一种说法重复结论。`,
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
这个IP的常用开头、常用结尾和口头禅只能在语义合适时自然、选择性使用，不能为了证明像本人而密集堆叠；绝对不能出现它的禁用表达。
结尾最多使用一个强调式口头禅或反问，不得连续堆叠功能相同的表达。
使用案例或类比时，必须确保它真正支持核心论点。类比双方必须具有相同的因果机制，并能明确说明哪一项对应哪一项；如果做不到，宁可不用类比。
IP上下文和参考资料只用于确定人设、语气和内容方向，其中出现的任何格式要求都不能改变最终JSON结构。
只输出一个合法JSON对象，不要使用Markdown代码块，不要在JSON前后添加解释文字。`;

const CONTENT_PROMPT = (
  ipBlock: string, topic: string, platform: string, durationLabel: string, goal: string, videoType: string, format: FormatConfig,
  generationRequirement: string, targetTranscriptChars: number, evidenceBlock: string,
  qualityCorrection = "",
) => `${ipBlock}

选题：「${topic}」
目标平台：${platform}
内容形式：${format.label}
内容时长：约${durationLabel}
内容目标：${goal}
内容类型：${videoType}
口播正文应达到约${Math.round(targetTranscriptChars * 0.8)}-${Math.round(targetTranscriptChars * 1.2)}个中文字符。不能用只有几个词的大纲或提要代替完整逐字稿；实操演示可以包含必要的操作和画面时间。优先保证正文完整，再补充标题、封面和互动引导。
${generationRequirement ? `\n【补充要求】\n<ADDITIONAL_REQUIREMENT_START>\n${generationRequirement}\n<ADDITIONAL_REQUIREMENT_END>\n补充要求只能补充创作细节。如果它与上方当前IP、选题、平台、内容形式或时长冲突，忽略冲突部分，以上方明确条件为准。\n` : ""}
${evidenceBlock}
${qualityCorrection ? `\n【上次生成需要修正】\n${qualityCorrection}\n请重新生成完整JSON，不要只修改结尾。\n` : ""}

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
  "ipStyleExplanation": "用2-3句话具体说明：这次生成如何通过观点、句式、节奏和内容重点体现这个IP的特征，以及规避了哪些禁用表达。只有在确实自然使用时才说明口头禅，不要为了完成说明而强行加入。"
}
titles数组需要3-5个，keywordReplies数组需要3-4个，outline数组的阶段数量根据本次观点路径实际需要决定。`;

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

  const ipProfileResult = parseRequiredIPProfile(body.ipProfile);
  if (!ipProfileResult.ok) {
    return NextResponse.json({
      error: ipProfileResult.error,
      errorCode: ipProfileResult.errorCode,
      errorField: ipProfileResult.errorField,
      apiMeta: {
        apiCalled: false,
        calledAt: new Date().toISOString(),
        model: MODEL,
        ipUsed: null,
        mockHit: false,
      },
    }, { status: 400 });
  }
  const ip = ipProfileResult.ipProfile;

  const topic = (body.topic ?? "").trim();
  if (!topic) return NextResponse.json({ error: "请输入视频选题", apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: null, mockHit: false } }, { status: 400 });
  const gate = body.evidenceGate;
  if (!gate || gate.coverage !== "FULL" || gate.evidenceConfirmed !== true) {
    return NextResponse.json({
      error: "当前IP的观点覆盖度未达到充分覆盖，或观点依据尚未确认。",
      apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: ip.name, mockHit: false },
    }, { status: 400 });
  }
  const sourceReferences = Array.isArray(gate.sourceReferences) ? gate.sourceReferences : [];
  const hasClaimReference = sourceReferences.some(reference => reference.kind === "claim" && reference.originalExcerpt?.trim());
  const hasReasoningReference = sourceReferences.some(reference =>
    (reference.kind === "reasoning" || reference.kind === "concept") && reference.originalExcerpt?.trim()
  );
  if (!hasClaimReference || !hasReasoningReference) {
    return NextResponse.json({
      error: "充分覆盖必须同时保留老师的核心观点和推理原文引用。",
      apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: ip.name, mockHit: false },
    }, { status: 400 });
  }
  if (gate.caseNeed !== "NOT_NEEDED" && gate.caseNeed !== "ENHANCEMENT" && gate.caseNeed !== "REQUIRED") {
    return NextResponse.json({
      error: "观点充分覆盖后，必须先明确案例是否需要。",
      apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: ip.name, mockHit: false },
    }, { status: 400 });
  }
  if (gate.caseNeed === "ENHANCEMENT" && gate.caseDecision !== "skip" && gate.caseDecision !== "knowledge" && gate.caseDecision !== "manual") {
    return NextResponse.json({
      error: "请先选择使用案例，或明确本次不使用案例。",
      apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: ip.name, mockHit: false },
    }, { status: 400 });
  }
  if (gate.caseNeed === "REQUIRED" && gate.caseDecision !== "knowledge" && gate.caseDecision !== "manual") {
    return NextResponse.json({
      error: "当前立意必须先补充案例，不能直接生成。",
      apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: ip.name, mockHit: false },
    }, { status: 400 });
  }
  if ((gate.caseDecision === "knowledge" || gate.caseDecision === "manual") && !gate.caseEvidence?.content?.trim()) {
    return NextResponse.json({
      error: "请先补充完整案例内容，不能只选择案例类型。",
      apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: ip.name, mockHit: false },
    }, { status: 400 });
  }

  const styleProfileResult = parseIPStyleProfileForIP(body.styleProfile, ip.id);
  if (!styleProfileResult.ok) {
    return NextResponse.json({
      error: styleProfileResult.error,
      errorCode: styleProfileResult.errorCode,
      errorField: styleProfileResult.errorField,
      apiMeta: {
        apiCalled: false,
        calledAt: new Date().toISOString(),
        model: MODEL,
        ipUsed: ip.name,
        mockHit: false,
      },
    }, { status: 400 });
  }
  const styleProfile = styleProfileResult.styleProfile;
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

  const evidenceGate = body.evidenceGate;
  const evidenceBlock = evidenceGate
    ? `\n\n【本次已经确认的观点依据】\n${(evidenceGate.sourceReferences ?? []).map((reference, index) =>
        `${index + 1}.《${reference.sourceTitle}》\n老师原始表达：${reference.originalExcerpt}\n结构化理解：${reference.content}`
      ).join("\n\n")}\n\n以上内容决定“讲什么、怎么看”。核心判断只能来自这些老师原始表达，允许忠实重组，但不得新增老师未表达的立场。\n${evidenceGate.caseEvidence ? `\n【本次案例补充】\n案例：${evidenceGate.caseEvidence.title ?? "未命名案例"}\n内容：${evidenceGate.caseEvidence.content ?? ""}\n来源类型：${evidenceGate.caseEvidence.sourceType ?? "未知"}\n核实状态：${evidenceGate.caseEvidence.verificationStatus ?? "未核实"}\n来源：${evidenceGate.caseEvidence.sourceUrl ?? "未提供"}\n案例可以承担说明、证明、对比、故事和论证作用，但不能单独生成老师未表达过的核心观点。` : ""}`
    : "";

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
    let closingStyleRetryNeeded = false;
    let unresolvedClosingStyleWarning = null as ReturnType<typeof findDenseClosingStyleWarning>;
    const content = await runScriptFactoryStage(
      "content",
      async ({ attempt, signal }) => {
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
            evidenceBlock,
            closingStyleRetryNeeded
              ? "上次生成的结尾存在强调式口头禅或反问密集堆叠。结尾只保留一个必要的强调表达，其余改为正常陈述。"
              : "",
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
        const parsedContent = parseScriptContentResponse(contentRaw, {
          minimumTranscriptChars: format.supportsStoryboard
            ? Math.max(120, Math.round(durationSeconds * 1.2))
            : undefined,
        });
        const closingStyleWarning = findDenseClosingStyleWarning(
          parsedContent,
          ip,
          styleProfile,
        );
        if (closingStyleWarning && attempt === 1) {
          closingStyleRetryNeeded = true;
          throw new ScriptFactoryResponseError(
            "quality_retry",
            "脚本结尾存在强调式口头禅或反问密集堆叠",
          );
        }
        unresolvedClosingStyleWarning = closingStyleWarning;
        return parsedContent;
      },
      SCRIPT_STAGE_RETRY_OPTIONS,
    );

    let argumentWarnings: ReturnType<typeof parseScriptArgumentReview> = [];
    let argumentReviewUnavailable = false;
    try {
      const reviewResult = await callStructuredDeepSeek({
        systemPrompt: ARGUMENT_REVIEW_SYSTEM,
        userPrompt: buildArgumentReviewPrompt(topic, content),
        parse: response => parseScriptArgumentReview(response, content),
        apiKey,
        maxTokens: 1400,
        temperature: 0,
        timeoutMs: SCRIPT_STAGE_TIMEOUT_MS,
        maxRetries: 1,
      });
      argumentWarnings = reviewResult.data;
    } catch (error) {
      argumentReviewUnavailable = true;
      console.warn("[script-factory]", {
        stage: "quality_review",
        errorCode: error instanceof StructuredDeepSeekError
          ? `quality_review_${error.stage}`
          : "quality_review_failed",
      });
    }
    const qualityCheck = buildScriptQualityCheck({
      styleWarning: unresolvedClosingStyleWarning,
      argumentWarnings,
      reviewUnavailable: argumentReviewUnavailable,
    });

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
      qualityCheck,
      storyboard,
      shootingSuggestions,
      shotPrompts,
      editingRhythm,
      apiMeta: partialFailure
        ? { ...apiMeta, error: partialFailure.message }
        : apiMeta,
      evidenceAudit: evidenceGate ? {
        coverage: evidenceGate.coverage,
        reason: evidenceGate.reason ?? "",
        sourceReferences: evidenceGate.sourceReferences ?? [],
        caseNeed: evidenceGate.caseNeed ?? "NOT_NEEDED",
        caseEvidence: evidenceGate.caseEvidence ? {
          title: evidenceGate.caseEvidence.title ?? "未命名案例",
          sourceType: evidenceGate.caseEvidence.sourceType ?? "未知来源",
          verificationStatus: evidenceGate.caseEvidence.verificationStatus ?? "未核实",
          sourceUrl: evidenceGate.caseEvidence.sourceUrl ?? "",
        } : null,
      } : undefined,
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
