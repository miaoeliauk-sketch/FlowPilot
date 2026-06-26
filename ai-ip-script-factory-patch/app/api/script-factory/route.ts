import { NextRequest, NextResponse } from "next/server";
import { IPProfile } from "@/lib/types";
import { buildIPContextBlock } from "@/lib/ip-prompt";

const DEEPSEEK_API = "https://api.deepseek.com/v1/chat/completions";
const MODEL = "deepseek-chat";

async function callDeepSeek(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("未配置 DEEPSEEK_API_KEY，请在 .env.local 中设置");

  const res = await fetch(DEEPSEEK_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0.8,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek API 请求失败（${res.status}）：${text}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function parseJSON<T>(text: string, fallback: T): T {
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return fallback;
  } catch {
    return fallback;
  }
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
  topic?: string;
  platform?: string;
  durationSeconds?: number;
  goal?: string;
  videoType?: string;
  needsStoryboard?: boolean;
  needsShootingTips?: boolean;
}

// ── 第一段：标题 / 封面 / 口播逐字稿 / 评论区引导 ──
const CONTENT_SYSTEM = `你是一位短视频内容主创，专门为下方给出的具体IP创作视频内容。
你必须严格代入这个IP的人设、表达风格、受众视角去写，绝对不能写成放在任何账号上都通用的AI文案。
标题、封面文案、口播逐字稿、评论区引导，全部要让熟悉这个IP的观众一听就觉得"这就是他/她会说的话"。
必须主动使用这个IP的常用开头/常用结尾/常用口头禅，绝对不能出现它的禁用表达。
严格按JSON格式输出，不要输出任何其他文字。`;

const CONTENT_PROMPT = (
  ipBlock: string, topic: string, platform: string, durationSeconds: number, goal: string, videoType: string
) => `${ipBlock}

视频选题：「${topic}」
目标平台：${platform}
视频时长：约${durationSeconds}秒
内容目标：${goal}
视频类型：${videoType}

请严格代入上面这个IP的人设和表达风格，生成以下内容。

严格按以下JSON格式输出：
{
  "titles": [
    {"title": "标题文本", "formula": "使用的标题公式，例如：数字+反差、痛点+解决方案、悬念+结果", "platform": "最适合发的平台", "whyFitsIP": "为什么这个标题符合这个IP的人设和受众（1句话，要点名IP的具体特征）"}
  ],
  "coverCopy": ["封面文案1（短、有冲击力、适合手机竖屏）", "封面文案2", "封面文案3"],
  "voiceover": {
    "hook": "开头钩子（约占时长的前5%，必须用这个IP的常用开头风格）",
    "painPoint": "痛点共鸣段（约占时长的5%-25%）",
    "core": "核心内容段（约占时长的25%-75%，按这个IP的表达节奏和口头禅写，这是正文主体）",
    "summary": "案例/方法总结段（约占时长的75%-90%）",
    "cta": "结尾评论区引导（约占时长的最后10%，必须用这个IP的常用结尾风格）"
  },
  "commentGuidance": {
    "interactionPrompt": "视频里直接喊出的互动引导话术",
    "keywordReplies": [{"keyword": "观众可能评论的关键词", "reply": "对应回复话术，符合这个IP的语气"}],
    "dmGuidance": "引导私信的话术",
    "materialPackGuidance": "引导领取资料包/福利的话术（如果这个IP的定位不适合做资料包，就给出适合它的下一步引导）"
  }
}
titles数组需要3-5个，keywordReplies数组需要3-4个。`;

// ── 第二段：分镜 / 拍摄建议 / 镜头提示词 / 剪辑节奏 ──
const STORYBOARD_SYSTEM = `你是一位短视频导演兼分镜师，专门为下方给出的具体IP设计分镜和拍摄方案。
你必须严格按照这个IP的拍摄习惯（是否露脸、是否录屏、是否需要B-roll、是否需要案例截图、常用拍摄场景、常用镜头形式）来设计，
不能给出和这个IP的实际拍摄条件不匹配的通用建议——比如一个不录屏的IP，分镜里就不该出现"切录屏"。
严格按JSON格式输出，不要输出任何其他文字。`;

const STORYBOARD_PROMPT = (ipBlock: string, topic: string, voiceoverText: string, durationSeconds: number) => `${ipBlock}

视频选题：「${topic}」
视频时长：约${durationSeconds}秒
已经写好的口播逐字稿（分5段）：
${voiceoverText}

请基于以上口播逐字稿，严格按照这个IP的实际拍摄习惯，设计分镜脚本和拍摄方案。

严格按以下JSON格式输出：
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
storyboard数组需要覆盖口播逐字稿的5个阶段，至少6-8行（可以拆得比5段更细）。`;

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  const topic = (body.topic ?? "").trim();
  if (!topic) return NextResponse.json({ error: "请输入视频选题" }, { status: 400 });

  const ip = body.ipProfile ?? FALLBACK_IP;
  const platform = body.platform || (ip.platforms[0] ?? "抖音");
  const durationSeconds = body.durationSeconds || 60;
  const goal = body.goal || "建立信任";
  const videoType = body.videoType || "口播";
  const needsStoryboard = body.needsStoryboard ?? true;
  const needsShootingTips = body.needsShootingTips ?? true;

  const ipBlock = buildIPContextBlock(ip);

  try {
    // ── 第一段：核心内容 ──
    const contentRaw = await callDeepSeek(
      CONTENT_SYSTEM,
      CONTENT_PROMPT(ipBlock, topic, platform, durationSeconds, goal, videoType),
      2000
    );
    const content = parseJSON(contentRaw, {
      titles: [{ title: `${topic}`, formula: "生成失败，使用兜底标题", platform, whyFitsIP: "" }],
      coverCopy: [topic],
      voiceover: { hook: "", painPoint: "", core: "", summary: "", cta: "" },
      commentGuidance: { interactionPrompt: "", keywordReplies: [], dmGuidance: "", materialPackGuidance: "" },
    });

    let storyboard: { time: string; scene: string; voiceover: string; subtitle: string; shot: string; material: string; editingTip: string }[] = [];
    let shootingSuggestions: string[] = [];
    let shotPrompts: { scene: string; prompt: string }[] = [];
    let editingRhythm = { subtitleHighlights: [] as string[], soundEffects: [] as string[], screenRecordingCuts: [] as string[], caseInserts: [] as string[], pauses: [] as string[] };

    // ── 第二段：分镜/拍摄（只有用户需要时才调用，节省时间） ──
    if (needsStoryboard || needsShootingTips) {
      const voiceoverText = `开头钩子：${content.voiceover?.hook ?? ""}\n痛点共鸣：${content.voiceover?.painPoint ?? ""}\n核心内容：${content.voiceover?.core ?? ""}\n方法总结：${content.voiceover?.summary ?? ""}\n评论引导：${content.voiceover?.cta ?? ""}`;
      const storyboardRaw = await callDeepSeek(
        STORYBOARD_SYSTEM,
        STORYBOARD_PROMPT(ipBlock, topic, voiceoverText, durationSeconds),
        2500
      );
      const sb = parseJSON(storyboardRaw, {
        storyboard: [], shootingSuggestions: [], shotPrompts: [],
        editingRhythm: { subtitleHighlights: [], soundEffects: [], screenRecordingCuts: [], caseInserts: [], pauses: [] },
      });
      storyboard = sb.storyboard ?? [];
      shootingSuggestions = sb.shootingSuggestions ?? [];
      shotPrompts = sb.shotPrompts ?? [];
      editingRhythm = sb.editingRhythm ?? editingRhythm;
    }

    return NextResponse.json({
      ipId: ip.id,
      ipName: ip.name,
      topic,
      platform,
      durationSeconds,
      goal,
      videoType,
      titles: content.titles ?? [],
      coverCopy: content.coverCopy ?? [],
      voiceover: content.voiceover ?? { hook: "", painPoint: "", core: "", summary: "", cta: "" },
      commentGuidance: content.commentGuidance ?? { interactionPrompt: "", keywordReplies: [], dmGuidance: "", materialPackGuidance: "" },
      storyboard,
      shootingSuggestions,
      shotPrompts,
      editingRhythm,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "脚本生成失败，请重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
