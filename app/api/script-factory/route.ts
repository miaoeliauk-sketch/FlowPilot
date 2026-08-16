import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { IPProfile, IPStyleProfile } from "@/lib/types";
import { buildIPContextBlock } from "@/lib/ip-prompt";
import { buildScriptDirectorBlock, shouldUseShuimuranDirector } from "@/lib/script-director-profile";
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
import type { ScriptCompressionAudit, ScriptPartialFailure } from "@/lib/script-factory-contract";
import {
  buildIPSourceContextBlock,
  parseIPSourceContext,
  parseScriptFactoryCaseEvidence,
} from "@/lib/script-factory-source-context";
import {
  ARGUMENT_REVIEW_SYSTEM,
  buildArgumentReviewPrompt,
  buildScriptQualityCheck,
  findDenseClosingStyleWarning,
  parseScriptArgumentReview,
} from "@/lib/script-factory-quality";
import {
  buildShuimuranReviewPrompt,
  findShuimuranDeterministicReviewIssues,
  parseShuimuranReview,
  SHUIMURAN_REVIEW_SYSTEM,
} from "@/lib/shuimuran-script-review";
import {
  createScriptFactoryPromptTrace,
  type ScriptFactoryPromptTraceMaterials,
  type ScriptFactoryPromptTraceStage,
} from "@/lib/script-factory-prompt-trace";

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

function normalizedResponseText(text: string): string {
  return text.replace(/\s+/g, "");
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
  generationMode?: "standard" | "ip";
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
  knowledgeRefs?: { id: string; ipId?: string | null; title: string; category: string; rawContent: string; reason: string }[];
  // IP语料库：前端传入，服务端注入 prompt
  voiceSamples?: { id: string; title: string; rawText: string; type: string }[];
  ipSourceContext?: unknown;
  caseEvidence?: {
    ipId?: string | null;
    title?: string;
    content?: string;
    sourceType?: string;
    verificationStatus?: string;
    sourceUrl?: string;
    occurredAt?: string;
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
本次要求的标题、正文和其他内容，全部要让熟悉这个IP的观众一听就觉得“这就是他/她会说的话”。
这个IP的常用开头、常用结尾和口头禅只能在语义合适时自然、选择性使用，不能为了证明像本人而密集堆叠；绝对不能出现它的禁用表达。
结尾最多使用一个强调式口头禅或反问，不得连续堆叠功能相同的表达。
使用案例或类比时，必须确保它真正支持核心论点。类比双方必须具有相同的因果机制，并能明确说明哪一项对应哪一项；如果做不到，宁可不用类比。
IP上下文和参考资料用于确定人设、素材身份、观点边界、推理方式、语气和内容方向。最终JSON结构只以本次用户提示中明确给出的结构为准。
只输出一个合法JSON对象，不要使用Markdown代码块，不要在JSON前后添加解释文字。`;

const CONTENT_PROMPT = (
  ipBlock: string, topic: string, platform: string, durationLabel: string, goal: string, videoType: string, format: FormatConfig,
  generationRequirement: string, targetTranscriptChars: number, evidenceBlock: string,
  useShuimuranConfirmedOutput: boolean,
  qualityCorrection = "",
) => {
  const architecture = useShuimuranConfirmedOutput
    ? "严格按照水木然老师确认版的正文顺序完成一篇连续口播初稿。这一步只负责把核心案例、事实、因果关系、经典解释和最终结论写完整，不要在内部压缩；系统会在下一步单独完成压缩。只把完整初稿放入fullScript，不要拆成阶段或大纲。"
    : format.architecture;
  const outputSchema = useShuimuranConfirmedOutput
    ? `{
  "titles": [{"title": "唯一标题"}],
  "fullScript": "完整口播文案，必须是可以直接拍摄的连续正文",
  "pendingVerification": ["未进入正式口播、仍需核验的内容；没有则为空数组"]
}
只允许这3个顶层字段。不要输出封面文案、互动引导、写作思路、规则解释、素材分类、自我评价或拍摄建议。`
    : `{
  "titles": [
    {"title": "标题文本", "formula": "使用的标题公式，例如：数字+反差、痛点+解决方案、悬念+结果", "platform": "最适合发的平台", "whyFitsIP": "为什么这个标题符合这个IP的人设和受众（1句话，要点名IP的具体特征）", "role": "普通；如果IP启用了专属标题规则，则按规则填写", "recommended": false}
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
titles数组需要3-5个。keywordReplies数组需要3-4个，outline数组的阶段数量根据本次观点路径实际需要决定。`;

  return `${ipBlock}

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
${architecture}

请严格代入上面这个IP的人设和表达风格，生成以下内容。

严格按以下JSON格式输出，只能输出JSON对象：
${outputSchema}`;
};

const SHUIMURAN_COMPRESSION_SYSTEM = `你是水木然IP专属脚本的压缩编辑。你的唯一任务是在不改变核心观点、不新增事实的前提下，把正文压缩到指定的精确字数区间。
取舍优先级：先保证事实和因果不失真，再保留核心案例、主要经典解释和最终结论，最后按指定方法删减次要内容，直至达到字数要求。
保留是保留原意和关键信息，不要求逐字保留。不得为了凑字数删除因果关系或改变结论。
只输出一个合法JSON对象，不要输出Markdown或解释。`;

function visibleCharacterCount(text: string): number {
  return Array.from(text.replace(/\s+/g, "")).length;
}

function compressionTarget(initialScript: string): {
  initialLength: number;
  minimumLength: number;
  maximumLength: number;
  acceptableMinimumLength: number;
  acceptableMaximumLength: number;
} {
  const initialLength = visibleCharacterCount(initialScript);
  const [idealMinimumRatio, idealMaximumRatio, acceptableMinimumRatio, acceptableMaximumRatio] =
    initialLength <= 400
      ? [0.8, 0.9, 0.8, 0.95]
      : initialLength <= 800
        ? [0.7, 0.8, 0.7, 0.9]
        : initialLength <= 1500
          ? [0.7, 0.8, 0.7, 0.85]
          : [0.7, 0.8, 0.7, 0.82];
  return {
    initialLength,
    minimumLength: Math.ceil(initialLength * idealMinimumRatio),
    maximumLength: Math.floor(initialLength * idealMaximumRatio),
    acceptableMinimumLength: Math.ceil(initialLength * acceptableMinimumRatio),
    acceptableMaximumLength: Math.floor(initialLength * acceptableMaximumRatio),
  };
}

function compressionRatio(actualLength: number, initialLength: number): number {
  return initialLength > 0 ? Number((actualLength / initialLength).toFixed(4)) : 0;
}

function compressionDistance(length: number, minimum: number, maximum: number): number {
  if (length < minimum) return minimum - length;
  if (length > maximum) return length - maximum;
  return 0;
}

function buildCompressionAudit(
  status: ScriptCompressionAudit["status"],
  target: ReturnType<typeof compressionTarget>,
  actualChars: number,
  selectedAttempt: ScriptCompressionAudit["selectedAttempt"],
): ScriptCompressionAudit {
  const messages: Record<ScriptCompressionAudit["status"], string> = {
    precise: "本稿已达到理想压缩比例。",
    tolerated: "本稿未达到理想压缩比例，但已进入短稿可接受区间。",
    closest_fallback: "本次压缩未能精确达到目标比例，已采用最接近的版本。",
    unavailable: "本次压缩未能产生可用版本，已保留完整初稿。",
  };
  return {
    status,
    initialChars: target.initialLength,
    idealMinimumChars: target.minimumLength,
    idealMaximumChars: target.maximumLength,
    acceptableMinimumChars: target.acceptableMinimumLength,
    acceptableMaximumChars: target.acceptableMaximumLength,
    actualChars,
    actualRatio: compressionRatio(actualChars, target.initialLength),
    selectedAttempt,
    message: messages[status],
  };
}

function compressionRetryInstruction(input: {
  retryReason: string | null;
  target: ReturnType<typeof compressionTarget>;
  previousCompression: ReturnType<typeof parseScriptContentResponse> | null;
}): string {
  const { retryReason, target, previousCompression } = input;
  if (!retryReason) return "";
  if (/JSON|格式|解析|截断|字段|不完整/.test(retryReason)) {
    return `重试要求：上一次压缩稿格式不合法：${retryReason}。请只返回完整、合法的JSON，并保持规定字段。`;
  }

  const correctionInstructions: string[] = [];
  if (/标题/.test(retryReason)) {
    correctionInstructions.push("上一次压缩改变了初稿标题，这次必须保持标题完全不变。");
  }
  if (/待核验/.test(retryReason)) {
    correctionInstructions.push("上一次压缩改变了待核验内容，这次必须原样保留待核验内容。");
  }
  if (/压缩稿为\d+个有效字符，目标为\d+至\d+个/.test(retryReason) && previousCompression) {
    const previousLength = visibleCharacterCount(
      previousCompression.outline[0]?.content ?? "",
    );
    if (previousLength > target.maximumLength) {
      correctionInstructions.push(
        `上一次压缩稿长度不符合要求。上次返回${previousLength}个有效字符，目标上限为${target.maximumLength}个，至少还需要删除${previousLength - target.maximumLength}个有效字符。\n请在这个版本基础上继续删减，不要回到初稿重新生成。`,
      );
    }
    if (previousLength < target.minimumLength) {
      correctionInstructions.push(
        `上一次压缩稿长度不符合要求。上次返回${previousLength}个有效字符，目标下限为${target.minimumLength}个，至少还需要补回${target.minimumLength - previousLength}个有效字符。\n请在这个版本基础上补回必要的因果关系或关键解释，不要回到初稿重新生成。`,
      );
    }
  }
  if (correctionInstructions.length > 0) {
    return `重试要求：上一次压缩稿存在以下问题：${retryReason}。\n${correctionInstructions.join("\n")}`;
  }
  return `重试要求：上一次压缩未通过校验：${retryReason}。请修正该问题后重新压缩。`;
}

function hasSamePendingVerification(
  initial: string[],
  compressed: string[],
): boolean {
  return initial.length === compressed.length &&
    initial.every((item, index) => item === compressed[index]);
}

function buildShuimuranCompressionPrompt(
  content: ReturnType<typeof parseScriptContentResponse>,
  retryReason: string | null,
  previousCompression: ReturnType<typeof parseScriptContentResponse> | null,
): string {
  const initialScript = content.outline[0]?.content ?? "";
  const target = compressionTarget(initialScript);
  const previousCompressionBlock = previousCompression
    ? `\n上一次压缩稿：\n${previousCompression.outline[0]?.content ?? ""}\n`
    : "";
  return `初稿共${target.initialLength}个有效字符（不计空格和换行，标点计入）。本次压缩稿必须控制在${target.minimumLength}至${target.maximumLength}个有效字符之间，少于${target.minimumLength}个或超过${target.maximumLength}个都不合格。

硬性要求：
1. 保留核心案例、事实、因果关系、经典解释和最终结论。
2. 不得新增人物、事件、数字、引语、观点或待核验内容。
3. 标题保持不变，只压缩fullScript。
4. 优先删除重复表达同一观点的段落、相近排比、反复反问、空泛过渡和通用感悟。
5. 多个并列观点只完整保留论证最充分的1至2个，其余压缩成一句话带过。
6. 多个经典引用只保留真正参与核心论证的一句。
7. 保留是保留原意和关键信息，不要求逐字保留；不得通过删除因果关系来凑字数。
${compressionRetryInstruction({ retryReason, target, previousCompression })}

初稿标题：${content.titles[0]?.title ?? ""}
初稿正文：
${initialScript}
${previousCompressionBlock}

待核验内容：${content.pendingVerification.join("；") || "无"}

严格输出：
{
  "titles": [{"title": "与初稿完全相同的唯一标题"}],
  "fullScript": "压缩后的完整口播文案",
  "pendingVerification": ["与初稿相同的待核验内容；没有则为空数组"]
}`;
}

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
  if (body.generationMode !== undefined && body.generationMode !== "standard" && body.generationMode !== "ip") {
    return NextResponse.json({
      error: "脚本生成模式无效，请重新选择。",
      apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: ip.name, mockHit: false },
    }, { status: 400 });
  }
  const generationMode = body.generationMode === "ip" ? "ip" : "standard";
  const isIPSpecificGeneration = generationMode === "ip";
  const isShuimuranDedicatedGeneration = shouldUseShuimuranDirector({
    generationMode,
    ipName: ip.name,
    profileId: ip.scriptDirectorProfileId,
  });
  const sourceContextResult = parseIPSourceContext(
    isIPSpecificGeneration ? body.ipSourceContext : undefined,
    ip.id,
  );
  if (!sourceContextResult.ok) {
    return NextResponse.json({
      error: sourceContextResult.error,
      apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: ip.name, mockHit: false },
    }, { status: 400 });
  }
  const sourceReferences = sourceContextResult.items;
  const caseEvidenceResult = parseScriptFactoryCaseEvidence(
    isIPSpecificGeneration ? body.caseEvidence : undefined,
    ip.id,
  );
  if (!caseEvidenceResult.ok) {
    return NextResponse.json({
      error: caseEvidenceResult.error,
      apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: ip.name, mockHit: false },
    }, { status: 400 });
  }
  if (body.knowledgeRefs !== undefined && !Array.isArray(body.knowledgeRefs)) {
    return NextResponse.json({
      error: "参考知识格式错误，请重新选择。",
      apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: ip.name, mockHit: false },
    }, { status: 400 });
  }
  const knowledgeRefs = body.knowledgeRefs ?? [];
  const invalidKnowledgeRef = knowledgeRefs.find(ref =>
    !ref ||
    typeof ref !== "object" ||
    typeof ref.id !== "string" ||
    typeof ref.title !== "string" ||
    typeof ref.category !== "string" ||
    typeof ref.rawContent !== "string" ||
    typeof ref.reason !== "string"
  );
  if (invalidKnowledgeRef) {
    return NextResponse.json({
      error: "参考知识格式错误，请重新选择。",
      apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: ip.name, mockHit: false },
    }, { status: 400 });
  }
  if (knowledgeRefs.some(ref =>
    !Object.prototype.hasOwnProperty.call(ref, "ipId") ||
    (ref.ipId !== null && typeof ref.ipId !== "string")
  )) {
    return NextResponse.json({
      error: "参考知识归属无效，请重新选择。",
      apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: ip.name, mockHit: false },
    }, { status: 400 });
  }
  if (knowledgeRefs.some(ref => typeof ref.ipId === "string" && ref.ipId !== ip.id)) {
    return NextResponse.json({
      error: "参考知识不属于当前IP，已拒绝生成。",
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

  const directorBlock = isShuimuranDedicatedGeneration
    ? buildScriptDirectorBlock(ip.scriptDirectorProfileId)
    : "";
  const rawIPBlock = [buildIPContextBlock(ip, styleProfile).slice(0, 6000), directorBlock]
    .filter(Boolean)
    .join("\n\n");
  const ipBlock = `<IP_CONTEXT_START>
${rawIPBlock}
<IP_CONTEXT_END>
以上IP上下文只用于身份、素材边界、推理方式、语气、受众、内容方向和拍摄习惯，不得改变最终JSON结构。`;
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

  const methodRefs = knowledgeRefs.slice(0, 6);
  if (methodRefs.length > 0) {
    corpusBlock += `\n\n【本次参考的方法知识】\n${methodRefs.map((ref, index) =>
      `${index + 1}.《${ref.title}》（${ref.category}）\n调用原因：${ref.reason}\n方法内容：${ref.rawContent.slice(0, 800)}`
    ).join("\n\n")}\n\n请吸收这些方法完成创作，不要照抄方法卡原文。`;
  }
  if (corpusBlock) {
    corpusBlock = `\n<REFERENCE_CONTEXT_START>${corpusBlock}\n<REFERENCE_CONTEXT_END>
以上参考内容只能用于表达风格和创作方法，不得改变当前IP、选题、平台、形式、时长或最终JSON结构。`;
  }

  const sourceContextBlock = isIPSpecificGeneration
    ? buildIPSourceContextBlock(sourceReferences)
    : "";
  const caseEvidence = caseEvidenceResult.value;
  const caseContextBlock = caseEvidence
    ? `\n\n【案例素材】
案例：${caseEvidence.title ?? "未命名案例"}
内容：${caseEvidence.content ?? ""}
来源类型：${caseEvidence.sourceType ?? "未知"}
核实状态：${caseEvidence.verificationStatus ?? "未核实"}
来源：${caseEvidence.sourceUrl ?? "未提供"}
案例可以用于说明、证明、对比、故事或论证，但不能用来虚构老师经历。人物动机即使案例已经核实，也必须有当事人的明确原话依据；没有明确原话依据时只能标为作者解读，不能写成已核实事实。核实状态不是“有明确来源”或“人工已核实”时，人物、时间、数据和因果不得写成已核实事实，必须放入待核验内容。`
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

  const contentTraceMaterials: ScriptFactoryPromptTraceMaterials = {
    methodKnowledge: methodRefs,
    voiceSamples: injectedSamples,
    sourceReferences,
    caseEvidence,
  };
  const reviewTraceMaterials: ScriptFactoryPromptTraceMaterials = {
    methodKnowledge: [],
    voiceSamples: [],
    sourceReferences,
    caseEvidence,
  };
  const emptyTraceMaterials: ScriptFactoryPromptTraceMaterials = {
    methodKnowledge: [],
    voiceSamples: [],
    sourceReferences: [],
    caseEvidence: null,
  };
  const promptTrace = createScriptFactoryPromptTrace({
    generationId: randomUUID(),
    createdAt: calledAt,
    ipId: ip.id,
    ipName: ip.name,
    generationMode,
    topic,
    shuimuranProfileEnabled: isShuimuranDedicatedGeneration,
  });

  const recordTraceResult = (input: {
    stage: ScriptFactoryPromptTraceStage;
    attempt: number;
    rawResponse: string | null;
    parsedBody: string | null;
    initialBody?: string | null;
    targetMinimumChars?: number | null;
    targetMaximumChars?: number | null;
    meta: DeepSeekResponseMeta | null;
    failureCode: string | null;
  }) => {
    const parsedBodyVisibleChars = input.parsedBody === null
      ? null
      : visibleCharacterCount(input.parsedBody);
    const initialBodyVisibleChars = input.initialBody == null
      ? null
      : visibleCharacterCount(input.initialBody);
    return promptTrace.recordResult({
      stage: input.stage,
      attempt: input.attempt,
      rawResponse: input.rawResponse,
      parsedBodyVisibleChars,
      initialBodyVisibleChars,
      targetMinimumChars: input.targetMinimumChars ?? null,
      targetMaximumChars: input.targetMaximumChars ?? null,
      actualCompressionRatio: initialBodyVisibleChars && parsedBodyVisibleChars !== null
        ? Number((parsedBodyVisibleChars / initialBodyVisibleChars).toFixed(4))
        : null,
      exactlyMatchesInitial: input.initialBody == null || input.parsedBody === null
        ? null
        : input.parsedBody === input.initialBody,
      normalizedMatchesInitial: input.initialBody == null || input.parsedBody === null
        ? null
        : normalizedResponseText(input.parsedBody) === normalizedResponseText(input.initialBody),
      requestId: input.meta?.requestId ?? null,
      finishReason: input.meta?.finishReason ?? null,
      tokenUsage: {
        promptTokens: input.meta?.promptTokens ?? null,
        completionTokens: input.meta?.completionTokens ?? null,
        totalTokens: input.meta?.totalTokens ?? null,
        reasoningTokens: input.meta?.reasoningTokens ?? null,
      },
      failureCode: input.failureCode,
    });
  };

  let failedStage = "request";
  let responseMeta: DeepSeekResponseMeta | null = null;
  try {
    // ── 第一段：核心内容（标题/封面/大纲/互动引导）──
    failedStage = "content";
    const targetTranscriptChars = Math.max(180, Math.round(durationSeconds * 3.5));
    let closingStyleRetryNeeded = false;
    let unresolvedClosingStyleWarning = null as ReturnType<typeof findDenseClosingStyleWarning>;
    const generateContent = async (
      signal: AbortSignal,
      traceInput: {
        stage: Extract<ScriptFactoryPromptTraceStage, "content-initial" | "content-format-retry" | "content-rewrite">;
        attempt: number;
        qualityCorrection?: string;
        retryReason: string | null;
      },
    ) => {
      responseMeta = null;
      let contentRaw: string | null = null;
      let parsedBody: string | null = null;
      let failureCode: string | null = null;
      const contentUserPrompt = CONTENT_PROMPT(
        ipBlock + corpusBlock,
        topic,
        platform,
        durationLabel,
        goal,
        videoType,
        format,
        generationRequirement,
        targetTranscriptChars,
        sourceContextBlock + caseContextBlock,
        isShuimuranDedicatedGeneration,
        traceInput.qualityCorrection ?? "",
      );
      await promptTrace.recordCall({
        stage: traceInput.stage,
        attempt: traceInput.attempt,
        systemPrompt: CONTENT_SYSTEM,
        userPrompt: contentUserPrompt,
        retryReason: traceInput.retryReason,
        materials: contentTraceMaterials,
      });
      try {
        contentRaw = await callDeepSeek(
          CONTENT_SYSTEM,
          contentUserPrompt,
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
          outputMode: isShuimuranDedicatedGeneration ? "shuimuran-confirmed" : "default",
          minimumTranscriptChars: format.supportsStoryboard
            ? Math.max(120, Math.round(durationSeconds * 1.2))
            : undefined,
        });
        parsedBody = parsedContent.outline[0]?.content ?? "";
        return parsedContent;
      } catch (error) {
        failureCode = getErrorCode(error);
        throw error;
      } finally {
        await recordTraceResult({
          stage: traceInput.stage,
          attempt: traceInput.attempt,
          rawResponse: contentRaw,
          parsedBody,
          meta: responseMeta,
          failureCode,
        });
      }
    };

    let content = await runScriptFactoryStage(
      "content",
      async ({ attempt, signal, retryReason }) => {
        const parsedContent = await generateContent(signal, {
          stage: attempt === 1 ? "content-initial" : "content-format-retry",
          attempt,
          qualityCorrection: closingStyleRetryNeeded
            ? "上次生成的结尾存在强调式口头禅或反问密集堆叠。结尾只保留一个必要的强调表达，其余改为正常陈述。"
            : "",
          retryReason,
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

    let compressionAudit: ScriptCompressionAudit | undefined;
    if (isShuimuranDedicatedGeneration) {
      const compressContent = async (initialDraft: typeof content) => {
        let previousCompression: typeof content | null = null;
        const target = compressionTarget(initialDraft.outline[0]?.content ?? "");
        const candidates: Array<{
          content: typeof content;
          attempt: 1 | 2;
          length: number;
        }> = [];
        try {
          return await runScriptFactoryStage(
            "content",
            async ({ attempt, signal, retryReason }) => {
            responseMeta = null;
            let compressedRaw: string | null = null;
            let parsedBody: string | null = null;
            let failureCode: string | null = null;
            const compressionUserPrompt = buildShuimuranCompressionPrompt(
              initialDraft,
              retryReason,
              previousCompression,
            );
            await promptTrace.recordCall({
              stage: "content-compression",
              attempt,
              systemPrompt: SHUIMURAN_COMPRESSION_SYSTEM,
              userPrompt: compressionUserPrompt,
              retryReason,
              materials: contentTraceMaterials,
            });
            try {
              compressedRaw = await callDeepSeek(
                SHUIMURAN_COMPRESSION_SYSTEM,
                compressionUserPrompt,
                6000,
                0.1,
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
                  "AI返回的压缩稿被截断",
                );
              }
              const compressed = parseScriptContentResponse(compressedRaw, {
                outputMode: "shuimuran-confirmed",
              });
              parsedBody = compressed.outline[0]?.content ?? "";
              previousCompression = compressed;
              const validationIssues: string[] = [];
              if (compressed.titles[0]?.title !== initialDraft.titles[0]?.title) {
                validationIssues.push("压缩稿改变了初稿标题");
              }
              if (!hasSamePendingVerification(
                initialDraft.pendingVerification,
                compressed.pendingVerification,
              )) {
                validationIssues.push("压缩稿改变了待核验内容");
              }
              const compressedLength = visibleCharacterCount(parsedBody);
              if (validationIssues.length === 0) {
                candidates.push({
                  content: compressed,
                  attempt: attempt as 1 | 2,
                  length: compressedLength,
                });
              }
              if (
                compressedLength < target.minimumLength ||
                compressedLength > target.maximumLength
              ) {
                validationIssues.push(
                  `压缩稿为${compressedLength}个有效字符，目标为${target.minimumLength}至${target.maximumLength}个`,
                );
              }
              if (validationIssues.length > 0) {
                throw new ScriptFactoryResponseError(
                  "quality_retry",
                  validationIssues.join("；"),
                );
              }
              compressionAudit = buildCompressionAudit(
                "precise",
                target,
                compressedLength,
                attempt as 1 | 2,
              );
              return compressed;
            } catch (error) {
              failureCode = getErrorCode(error);
              throw error;
            } finally {
              await recordTraceResult({
                stage: "content-compression",
                attempt,
                rawResponse: compressedRaw,
                parsedBody,
                initialBody: initialDraft.outline[0]?.content ?? "",
                targetMinimumChars: target.minimumLength,
                targetMaximumChars: target.maximumLength,
                meta: responseMeta,
                failureCode,
              });
            }
            },
            SCRIPT_STAGE_RETRY_OPTIONS,
          );
        } catch {
          const rankedCandidates = [...candidates].sort((left, right) => {
            const leftDistance = compressionDistance(
              left.length,
              target.minimumLength,
              target.maximumLength,
            );
            const rightDistance = compressionDistance(
              right.length,
              target.minimumLength,
              target.maximumLength,
            );
            return leftDistance - rightDistance || right.attempt - left.attempt;
          });
          const selected = rankedCandidates[0];
          if (!selected) {
            const initialLength = visibleCharacterCount(initialDraft.outline[0]?.content ?? "");
            compressionAudit = buildCompressionAudit("unavailable", target, initialLength, 0);
            return initialDraft;
          }
          const withinAcceptableRange = selected.length >= target.acceptableMinimumLength
            && selected.length <= target.acceptableMaximumLength;
          compressionAudit = buildCompressionAudit(
            withinAcceptableRange ? "tolerated" : "closest_fallback",
            target,
            selected.length,
            selected.attempt,
          );
          return selected.content;
        }
      };

      let compressionSourceDraft = content;
      content = await compressContent(compressionSourceDraft);

      const reviewContent = async (
        candidate: typeof content,
        retryReason: string | null = null,
        sourceDraft: typeof content = compressionSourceDraft,
      ) => {
        try {
          const deterministicIssues = findShuimuranDeterministicReviewIssues({
            title: candidate.titles[0]?.title ?? "",
            fullScript: candidate.outline[0]?.content ?? "",
          });
          const reviewUserPrompt = buildShuimuranReviewPrompt({
            title: candidate.titles[0]?.title ?? "",
            fullScript: candidate.outline[0]?.content ?? "",
            pendingVerification: candidate.pendingVerification,
            reviewedAt: calledAt,
            sourceReferences: sourceReferences.map(reference => ({
              sourceTitle: reference.sourceTitle,
              kind: reference.kind,
              originalExcerpt: reference.originalExcerpt,
              extractionStatus: reference.extractionStatus,
            })),
            caseEvidence,
            compressionSourceScript: sourceDraft.outline[0]?.content ?? "",
          });
          const modelReview = (await callStructuredDeepSeek({
            systemPrompt: SHUIMURAN_REVIEW_SYSTEM,
            userPrompt: reviewUserPrompt,
            parse: parseShuimuranReview,
            apiKey,
            maxTokens: 900,
            temperature: 0,
            timeoutMs: SCRIPT_STAGE_TIMEOUT_MS,
            maxRetries: 0,
            onAttemptPrompt: prompt => promptTrace.recordCall({
              stage: "shuimuran-review",
              attempt: prompt.attempt,
              systemPrompt: prompt.systemPrompt,
              userPrompt: prompt.userPrompt,
              retryReason: prompt.retryReason
                ? `${prompt.retryReason.stage}:${prompt.retryReason.failureCode}`
                : retryReason,
              materials: reviewTraceMaterials,
            }).then(() => undefined),
            onAttemptResult: result => recordTraceResult({
              stage: "shuimuran-review",
              attempt: result.attempt,
              rawResponse: result.rawResponse,
              parsedBody: null,
              meta: result.responseMeta,
              failureCode: result.failureCode,
            }).then(() => undefined),
          })).data;
          return {
            passed: deterministicIssues.length === 0 && modelReview.passed,
            issues: [...deterministicIssues, ...modelReview.issues],
          };
        } catch {
          throw new ScriptFactoryResponseError(
            "quality_retry",
            "水木然脚本生成后检查未完成",
          );
        }
      };

      let review = await reviewContent(content, null, compressionSourceDraft);
      if (!review.passed) {
        const reviewIssues = review.issues;
        const revisedDraft = await runScriptFactoryStage(
          "content",
          async ({ signal }) => {
            const revisedContent = await generateContent(signal, {
              stage: "content-rewrite",
              attempt: 1,
              qualityCorrection: `上次没有通过水木然老师确认版终审：${reviewIssues.join("；")}。逐项修正后重新生成。`,
              retryReason: `水木然终审未通过：${reviewIssues.join("；")}`,
            });
            const closingStyleWarning = findDenseClosingStyleWarning(
              revisedContent,
              ip,
              styleProfile,
            );
            if (closingStyleWarning) {
              throw new ScriptFactoryResponseError(
                "quality_retry",
                "重写后的脚本结尾仍存在强调式口头禅或反问密集堆叠",
              );
            }
            unresolvedClosingStyleWarning = null;
            return revisedContent;
          },
          { timeoutMs: SCRIPT_STAGE_TIMEOUT_MS, maxRetries: 0 },
        );
        compressionSourceDraft = revisedDraft;
        content = await compressContent(revisedDraft);
        review = await reviewContent(content, "终审未通过后的二次检查", revisedDraft);
        if (!review.passed) {
          throw new ScriptFactoryResponseError(
            "quality_retry",
            `水木然脚本重写后仍未通过老师确认版终审：${review.issues.join("；")}`,
          );
        }
      }
    }

    let argumentWarnings: ReturnType<typeof parseScriptArgumentReview> = [];
    let argumentReviewUnavailable = false;
    try {
      const argumentReviewUserPrompt = buildArgumentReviewPrompt(topic, content);
      const reviewResult = await callStructuredDeepSeek({
        systemPrompt: ARGUMENT_REVIEW_SYSTEM,
        userPrompt: argumentReviewUserPrompt,
        parse: response => parseScriptArgumentReview(response, content),
        apiKey,
        maxTokens: 1400,
        temperature: 0,
        timeoutMs: SCRIPT_STAGE_TIMEOUT_MS,
        maxRetries: 1,
        onAttemptPrompt: prompt => promptTrace.recordCall({
          stage: "argument-review",
          attempt: prompt.attempt,
          systemPrompt: prompt.systemPrompt,
          userPrompt: prompt.userPrompt,
          retryReason: prompt.retryReason
            ? `${prompt.retryReason.stage}:${prompt.retryReason.failureCode}`
            : null,
          materials: emptyTraceMaterials,
        }).then(() => undefined),
        onAttemptResult: result => recordTraceResult({
          stage: "argument-review",
          attempt: result.attempt,
          rawResponse: result.rawResponse,
          parsedBody: null,
          meta: result.responseMeta,
          failureCode: result.failureCode,
        }).then(() => undefined),
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
    if (!isShuimuranDedicatedGeneration && format.supportsStoryboard && (needsStoryboard || needsShootingTips)) {
      failedStage = "storyboard";
      try {
        const parsedStoryboard = await runScriptFactoryStage(
          "storyboard",
          async ({ attempt, signal, retryReason }) => {
            responseMeta = null;
            let storyboardRaw: string | null = null;
            let failureCode: string | null = null;
            const storyboardUserPrompt = STORYBOARD_PROMPT(
              ipBlock,
              topic,
              outlineText,
              durationLabel,
            );
            await promptTrace.recordCall({
              stage: "storyboard",
              attempt,
              systemPrompt: STORYBOARD_SYSTEM,
              userPrompt: storyboardUserPrompt,
              retryReason,
              materials: emptyTraceMaterials,
            });
            try {
              storyboardRaw = await callDeepSeek(
                STORYBOARD_SYSTEM,
                storyboardUserPrompt,
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
            } catch (error) {
              failureCode = getErrorCode(error);
              throw error;
            } finally {
              await recordTraceResult({
                stage: "storyboard",
                attempt,
                rawResponse: storyboardRaw,
                parsedBody: null,
                meta: responseMeta,
                failureCode,
              });
            }
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
    } else if (!isShuimuranDedicatedGeneration && !format.supportsStoryboard && needsShootingTips) {
      failedStage = "execution";
      try {
        shootingSuggestions = await runScriptFactoryStage(
          "execution",
          async ({ attempt, signal, retryReason }) => {
            responseMeta = null;
            let execRaw: string | null = null;
            let failureCode: string | null = null;
            const executionUserPrompt = EXECUTION_PROMPT(ipBlock, topic, outlineText, format);
            await promptTrace.recordCall({
              stage: "execution",
              attempt,
              systemPrompt: EXECUTION_SYSTEM,
              userPrompt: executionUserPrompt,
              retryReason,
              materials: emptyTraceMaterials,
            });
            try {
              execRaw = await callDeepSeek(
                EXECUTION_SYSTEM,
                executionUserPrompt,
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
            } catch (error) {
              failureCode = getErrorCode(error);
              throw error;
            } finally {
              await recordTraceResult({
                stage: "execution",
                attempt,
                rawResponse: execRaw,
                parsedBody: null,
                meta: responseMeta,
                failureCode,
              });
            }
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
      generationMode,
      outputMode: isShuimuranDedicatedGeneration ? "shuimuran-confirmed" : "default",
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
      pendingVerification: content.pendingVerification,
      compressionAudit,
      qualityCheck,
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
