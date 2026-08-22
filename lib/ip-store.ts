"use client";
import { IPProfile, VoiceSample, IPStyleProfile, TopicAsset, CommentAsset, ScriptAsset, KnowledgeEntry, KnowledgeCategory, HookEntry, LikesSnapshot, KnowledgeUsageRecord, KnowledgeStatus, ConsumerModule, HotMaterialAnalysis, UserProfile, VideoReview, NewScriptAssetInput, ScriptKnowledgeTracking } from "./types";
import type { HotAnalysisKnowledgeSourceReference, TopicAssetStatus } from "./types";
import {
  createTopicEvaluationSummary,
  parseTopicBoardResult,
  TopicBoardContractError,
} from "./topic-board-contract";
import { buildVoiceStyleProfileForSave } from "./voice-style-profile";
import {
  isTrustedKnowledgeUsageForScript,
  parseVerifiedScriptKnowledgeTracking,
} from "./knowledge-effect-contract";
import {
  completeManualReview,
  createPendingManualReviewFields,
  migrateManualReviewFields,
  transitionManualReviewStatus,
  type CompleteManualReviewInput,
} from "./review-workflow";

const KEY_IPS = "ipwr:ips_v2";
const KEY_ACTIVE_IP = "ipwr:activeIpId";
const KEY_DEFAULT_IPS_INITIALIZED = "ipwr:defaultIPsInitialized:v1";
const KEY_VOICE_SAMPLES = "ipwr:voiceSamples";
const KEY_STYLE_PROFILES = "ipwr:ipStyleProfiles";
const KEY_TOPIC_ASSETS = "ipwr:topicAssets";
const KEY_COMMENT_ASSETS = "ipwr:commentAssets";
const KEY_SCRIPT_ASSETS = "ipwr:scriptAssets";
const KEY_KNOWLEDGE_ENTRIES = "ipwr:knowledgeEntries";
const KEY_HOOK_ENTRIES = "ipwr:hookEntries";
const KEY_HOT_ANALYSES = "ipwr:hotAnalyses";
const KEY_USER_PROFILE = "ipwr:userProfile";
const KEY_VIDEO_REVIEWS = "ipwr:videoReviews";
const KEY_COVER_REFS = "ipwr:coverRefs";
const DEFAULT_USER_PROFILE: UserProfile = { nickname: "彭彭", name: "" };

export interface CoverRef {
  id: string;
  title: string;
  imageDataUrl: string;
  imageKey?: string;
  platform: string;
  contentType: string;
  coverType: string;
  visualTags: string[];
  textStyle: string;
  layout: string;
  colorStyle: string;
  referenceReason: string;
  avoidReason: string;
  sourceUrl: string;
  scope: "global" | "ip";
  ipId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CoverRefStoreErrorCode =
  | "COVER_REF_STORAGE_READ_FAILED"
  | "COVER_REF_DATA_CORRUPTED";

export class CoverRefStoreError extends Error {
  constructor(
    public readonly code: CoverRefStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CoverRefStoreError";
  }
}

export type IPStyleProfileStoreErrorCode =
  | "STYLE_PROFILE_STORAGE_READ_FAILED"
  | "STYLE_PROFILE_DATA_CORRUPTED"
  | "STYLE_PROFILE_STORAGE_WRITE_FAILED";

export class IPStyleProfileStoreError extends Error {
  constructor(
    public readonly code: IPStyleProfileStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IPStyleProfileStoreError";
  }
}

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}

function writeJSON<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore quota errors */ }
}

function writeJSONStrict<T>(key: string, value: T, failureMessage: string): void {
  if (typeof window === "undefined") throw new Error(failureMessage);
  const serialized = JSON.stringify(value);
  try {
    localStorage.setItem(key, serialized);
    if (localStorage.getItem(key) !== serialized) {
      throw new Error("写入后校验失败");
    }
  } catch {
    throw new Error(failureMessage);
  }
}

function writeVideoReviewsStrict(
  value: VideoReview[],
  failureMessage = "复盘保存失败，请稍后重试",
): void {
  writeJSONStrict(KEY_VIDEO_REVIEWS, value, failureMessage);
}

function writeKnowledgeEntriesStrict(
  value: KnowledgeEntry[],
  failureMessage: string,
): void {
  writeJSONStrict(KEY_KNOWLEDGE_ENTRIES, value, failureMessage);
}

function readKnowledgeEntriesStrict(): KnowledgeEntry[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(KEY_KNOWLEDGE_ENTRIES);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("知识库数据已损坏，请先恢复备份；系统已阻止继续写入");
  }
  if (
    !Array.isArray(parsed)
    || parsed.some(entry => (
      typeof entry !== "object"
      || entry === null
      || Array.isArray(entry)
      || typeof (entry as Record<string, unknown>).id !== "string"
      || typeof (entry as Record<string, unknown>).category !== "string"
      || typeof (entry as Record<string, unknown>).title !== "string"
      || typeof (entry as Record<string, unknown>).createdAt !== "string"
    ))
  ) {
    throw new Error("知识库数据已损坏，请先恢复备份；系统已阻止继续写入");
  }
  return parsed as KnowledgeEntry[];
}

const COLORS = ["#7C6EE6", "#5BA4D6", "#E66E8E", "#5BC192", "#C99A1E", "#9B7ED9"];

function genId() { return `${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }

// ── IP 默认种子数据（首次使用时填充，方便用户立刻看到效果） ──
function seedDefaultIPs(): IPProfile[] {
  const now = new Date().toISOString();
  return [
    {
      id: "demo-ip-pengpeng-ai-v1", name: "彭彭说AI", avatar: "彭",
      positioning: "AI内容创作者IP，专注AI工具教程、AI workflow与内容创作方法论，以学习者视角记录真实AI实践，账号处于早期成长阶段",
      platforms: ["抖音", "小红书", "B站", "视频号"],
      audience: "AI新手学习者、刚入行的内容创作者、自媒体从业者",
      contentDirection: ["AI工具实测", "AI workflow方法论", "真实学习踩坑记录", "视频制作技巧拆解"],
      personaKeywords: ["AI学习者", "真实记录", "陪伴式成长", "不装专家"],
      professionalIdentity: "AI内容创作者 / 自媒体新人操盘手，还在探索阶段的实践者，不是行业专家",
      personalityTags: ["真诚", "接地气", "爱踩坑", "自嘲幽默", "有耐心"],
      credibilitySource: "真实的学习过程和踩坑记录，所有方法都是自己亲手试过的，不是转述别人的结论",
      representativeViewpoints: ["AI工具门槛比想象中低，普通人也能上手", "踩坑比看教程更有用，因为坑是真实存在的", "持续记录比一次性爆款更重要"],
      tone: "亲切真诚的同行者视角，像朋友一样分享踩坑经验，不装专家，敢于暴露自己的失败和笨办法，带一点自嘲幽默",
      commonOpenings: ["最近我发现一个特别好用的AI工具", "今天又踩了一个坑，分享给大家", "作为一个还在摸索的AI创作者"],
      commonClosings: ["关注我，一起从AI小白慢慢进化", "评论区告诉我你踩过的坑", "下期接着拆给你看"],
      catchphrases: ["说实话", "我也是踩坑过来的", "别问我懂不懂，我边学边讲"],
      forbiddenExpressions: ["颠覆性", "革命性", "绝对", "震惊", "你必须知道"],
      pacing: "节奏偏慢，留出停顿和反应时间，像在跟朋友聊天，不追求信息密度",
      commonScenes: ["居家书桌前", "电脑屏幕录屏", "手机自拍口播"],
      commonShotTypes: ["正面口播为主", "录屏配合鼠标指引", "手写笔记特写"],
      showsFace: true, usesScreenRecording: true, needsBroll: false, needsCaseScreenshots: true, needsSubtitleHighlight: true,
      sampleViralTitles: ["我花了一周搞懂的AI工具，3分钟讲给你", "AI小白第一次用Codex踩了多少坑", "原来AI视频制作没那么难"],
      styleNotes: "爆款规律：标题里带「小白/第一次/踩坑」等词，开头先暴露自己的失败，中间用录屏演示具体操作，结尾留一个具体的小任务给观众",
      bio: "AI+IP内容创作者，分享AI工具实测、视频制作方法论与真实学习记录",
      color: COLORS[0], createdAt: now, updatedAt: now,
    },
    {
      id: "demo-ip-weiyu-v1", name: "喂鱼", avatar: "喂",
      positioning: "AI+IP自媒体，专注AI工具与效率工作流分享，账号已有成熟粉丝基础（约3.9万粉丝），定位为可信赖的方法论输出者",
      platforms: ["抖音", "视频号", "小红书", "B站"],
      audience: "AI+IP内容创作者、有一定基础的自媒体从业者、想要复制成功路径的操盘手",
      contentDirection: ["AI工具评测与选型", "IP操盘方法论", "效率工作流搭建", "行业趋势观察"],
      personaKeywords: ["操盘手", "效率优先", "方法论输出", "结果导向"],
      professionalIdentity: "AI+IP自媒体操盘手，已带出多个成熟账号的实战经验者",
      personalityTags: ["直接", "干脆", "理性", "不绕弯子", "强逻辑"],
      credibilitySource: "账号已有3.9万真实粉丝积累，方法论来自实际操盘多个IP的成功路径，不是纸上谈兵",
      representativeViewpoints: ["内容生产要工业化，不能靠灵感", "IP增长的核心是可复制的工作流，不是天赋", "效率才是普通人能复制的护城河"],
      tone: "专业老练的操盘手视角，直接给结论和可执行方法论，强调效率和结果，语气干脆，不绕弯子，少用模糊词",
      commonOpenings: ["很多人问我", "今天直接说重点", "这件事我必须跟你讲清楚"],
      commonClosings: ["按这个方法做，你也能复制", "想要更多方法论，持续关注", "评论区交流你的实操情况"],
      catchphrases: ["直接说结论", "这件事的本质是", "按这个流程走就行"],
      forbiddenExpressions: ["小白", "新手向", "可能", "也许", "我也不太确定"],
      pacing: "节奏偏快，信息密度高，少废话，每句话都要承载信息量",
      commonScenes: ["专业录播间", "电脑屏幕录屏配数据看板", "office场景口播"],
      commonShotTypes: ["中景口播配字幕强调关键词", "录屏配合高亮框", "数据图表特写"],
      showsFace: true, usesScreenRecording: true, needsBroll: true, needsCaseScreenshots: true, needsSubtitleHighlight: true,
      sampleViralTitles: ["普通人做IP最容易踩的3个效率陷阱", "我是怎么用AI把内容产能翻3倍的", "IP增长的本质：把灵感变成流程"],
      styleNotes: "爆款规律：标题直接给结论或数字，开头点出问题本质，中间给出可复制的步骤化方法论，结尾强调「按这个做就能复制」",
      bio: "专注AI工具教学和内容创作方法论的成熟自媒体账号",
      color: COLORS[1], createdAt: now, updatedAt: now,
    },
  ];
}

// 防御性补全：任何缺失的新增字段都补上安全默认值，避免老版本数据触发 .map() 崩溃
function normalizeIP(raw: IPProfile): IPProfile {
  return {
    ...raw,
    contentDirection: raw.contentDirection ?? [],
    personaKeywords: raw.personaKeywords ?? [],
    professionalIdentity: raw.professionalIdentity ?? "",
    personalityTags: raw.personalityTags ?? [],
    credibilitySource: raw.credibilitySource ?? "",
    representativeViewpoints: raw.representativeViewpoints ?? [],
    commonOpenings: raw.commonOpenings ?? [],
    commonClosings: raw.commonClosings ?? [],
    catchphrases: raw.catchphrases ?? [],
    forbiddenExpressions: raw.forbiddenExpressions ?? [],
    pacing: raw.pacing ?? "",
    commonScenes: raw.commonScenes ?? [],
    commonShotTypes: raw.commonShotTypes ?? [],
    showsFace: raw.showsFace ?? true,
    usesScreenRecording: raw.usesScreenRecording ?? true,
    needsBroll: raw.needsBroll ?? false,
    needsCaseScreenshots: raw.needsCaseScreenshots ?? false,
    needsSubtitleHighlight: raw.needsSubtitleHighlight ?? false,
    sampleViralTitles: raw.sampleViralTitles ?? [],
    styleNotes: raw.styleNotes ?? "",
  };
}

// ── IP CRUD ──
export function getAllIPs(): IPProfile[] {
  const ips = readJSON<IPProfile[]>(KEY_IPS, []);
  return ips.map(normalizeIP);
}

export function initializeIPs(): IPProfile[] {
  if (typeof window === "undefined") return [];

  const storedIPs = localStorage.getItem(KEY_IPS);
  const initialized = readJSON<boolean>(KEY_DEFAULT_IPS_INITIALIZED, false);
  if (storedIPs !== null) {
    if (!initialized) writeJSON(KEY_DEFAULT_IPS_INITIALIZED, true);
    return getAllIPs();
  }
  if (initialized) return [];

  const seeded = seedDefaultIPs();
  writeJSON(KEY_IPS, seeded);
  writeJSON(KEY_DEFAULT_IPS_INITIALIZED, true);
  return seeded;
}

export function getIP(id: string): IPProfile | null {
  return getAllIPs().find(ip => ip.id === id) ?? null;
}

export function createIP(input: Omit<IPProfile, "id"|"createdAt"|"updatedAt"|"color">): IPProfile {
  const ips = getAllIPs();
  const now = new Date().toISOString();
  const newIP: IPProfile = {
    ...input, id: genId(), color: COLORS[ips.length % COLORS.length],
    createdAt: now, updatedAt: now,
  };
  writeJSON(KEY_IPS, [...ips, newIP]);
  return newIP;
}

export function updateIP(id: string, patch: Partial<IPProfile>): void {
  const ips = getAllIPs().map(ip => ip.id === id ? { ...ip, ...patch, updatedAt: new Date().toISOString() } : ip);
  writeJSON(KEY_IPS, ips);
}

export function deleteIP(id: string): void {
  const ips = getAllIPs().filter(ip => ip.id !== id);
  writeJSON(KEY_IPS, ips);
  if (getActiveIPId() === id) {
    setActiveIPId(ips[0]?.id ?? null);
  }
}

// ── 当前激活 IP ──
export function getActiveIPId(): string | null {
  return readJSON<string | null>(KEY_ACTIVE_IP, null);
}

export function setActiveIPId(id: string | null): void {
  writeJSON(KEY_ACTIVE_IP, id);
}

export function getOrInitActiveIP(): IPProfile | null {
  const ips = getAllIPs();
  const activeId = getActiveIPId();
  const found = ips.find(ip => ip.id === activeId);
  if (found) return found;
  if (ips.length === 0) return null;
  // 没有激活IP，默认选第一个
  setActiveIPId(ips[0].id);
  return ips[0];
}

// ── IP语料库（原VoiceSample，透明兼容迁移） ──
// 函数签名与原来完全一致，调用方（IP身份中心/知识库中心）无需修改任何代码。
// 内部实现改为读写 KnowledgeEntry(category="IP语料库")，
// 不再读写 KEY_VOICE_SAMPLES（旧key保留用于一次性数据迁移，迁移完成后不再写入）。

// 把 VoiceSample 转换为 KnowledgeEntry 格式的辅助函数
function voiceSampleToEntry(s: VoiceSample): Omit<KnowledgeEntry, "id" | "createdAt"> {
  return {
    category: "IP语料库",
    title: s.title,
    rawContent: s.rawText,
    tags: [s.type],
    keywords: [],
    ipId: s.ipId,
    sourceTier: "高",
    sourceTierReason: "来自IP本人的真实口播样本",
    contentDirection: [],
    sourcePlatform: "录音/转写",
    sourceUrl: "",
    note: s.note,
    extractedAt: s.createdAt,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
  };
}

// 一次性迁移旧 VoiceSample 数据到知识库 IP语料库 分类。
// 幂等：通过 KEY_VOICE_SAMPLES_MIGRATED 标志防止重复迁移。
// 由 app/layout.tsx 在首次加载时自动触发，用户无感知。
const KEY_VOICE_SAMPLES_MIGRATED = "ipwr:voiceSamplesMigrated";

export function migrateVoiceSamplesToKnowledge(): void {
  if (readJSON<boolean>(KEY_VOICE_SAMPLES_MIGRATED, false)) return; // 已迁移，跳过
  const legacy = readJSON<VoiceSample[]>(KEY_VOICE_SAMPLES, []);
  if (legacy.length === 0) {
    writeJSON(KEY_VOICE_SAMPLES_MIGRATED, true);
    return;
  }
  const existing = readKnowledgeEntriesStrict();
  const existingIds = new Set(existing.map(e => e.id));
  // 用旧id作为新KnowledgeEntry的id，确保重复迁移时不会产生重复条目
  const newEntries: KnowledgeEntry[] = legacy
    .filter(s => !existingIds.has(s.id))
    .map(s => ({ ...voiceSampleToEntry(s), id: s.id, createdAt: s.createdAt }));
  if (newEntries.length > 0) {
    writeJSON(KEY_KNOWLEDGE_ENTRIES, [...existing, ...newEntries]);
  }
  writeJSON(KEY_VOICE_SAMPLES_MIGRATED, true);
}

// 透明兼容：函数签名不变，改为读知识库 IP语料库 分类
export function getVoiceSamples(ipId: string): VoiceSample[] {
  return getKnowledgeEntries("IP语料库")
    .filter(e => e.ipId === ipId)
    .map(e => ({ id: e.id, ipId: e.ipId ?? "", title: e.title, type: (e.tags[0] ?? "口播逐字稿") as VoiceSample["type"], rawText: e.rawContent, note: e.note, createdAt: e.createdAt }));
}

// 透明兼容：跨IP查看所有口播样本
export function getAllVoiceSamples(): VoiceSample[] {
  return getKnowledgeEntries("IP语料库")
    .map(e => ({ id: e.id, ipId: e.ipId ?? "", title: e.title, type: (e.tags[0] ?? "口播逐字稿") as VoiceSample["type"], rawText: e.rawContent, note: e.note, createdAt: e.createdAt }));
}

// 透明兼容：写入改为写知识库
export function addVoiceSample(input: Omit<VoiceSample, "id" | "createdAt">): VoiceSample {
  const entry = addKnowledgeEntry(voiceSampleToEntry({ ...input, id: "", createdAt: "" }));
  return { id: entry.id, ipId: entry.ipId ?? "", title: entry.title, type: (entry.tags[0] ?? "口播逐字稿") as VoiceSample["type"], rawText: entry.rawContent, note: entry.note, createdAt: entry.createdAt };
}

// 透明兼容：删除改为从知识库删除
export function deleteVoiceSample(id: string): void {
  deleteKnowledgeEntry(id);
}

// ── IP风格画像（从样本库提取，供文案改写工作台等模块复用） ──
export function getStyleProfile(ipId: string): IPStyleProfile | null {
  const all = readJSON<IPStyleProfile[]>(KEY_STYLE_PROFILES, []);
  return all.find((p) => p.ipId === ipId) ?? null;
}

function readStyleProfilesForWrite(): IPStyleProfile[] {
  if (typeof window === "undefined") {
    throw new IPStyleProfileStoreError(
      "STYLE_PROFILE_STORAGE_READ_FAILED",
      "语气画像保存失败：当前环境无法访问本地存储",
    );
  }

  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY_STYLE_PROFILES);
  } catch {
    throw new IPStyleProfileStoreError(
      "STYLE_PROFILE_STORAGE_READ_FAILED",
      "语气画像保存失败：无法读取原有数据",
    );
  }
  if (raw === null) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed)
      || !parsed.every((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return false;
        const ipId = (item as { ipId?: unknown }).ipId;
        return typeof ipId === "string"
          && ipId.trim().length > 0
          && buildVoiceStyleProfileForSave(item, ipId) !== null;
      })
    ) {
      throw new Error("invalid style profile collection");
    }
    return parsed as IPStyleProfile[];
  } catch {
    throw new IPStyleProfileStoreError(
      "STYLE_PROFILE_DATA_CORRUPTED",
      "语气画像数据已损坏，本次结果没有保存，请先备份并修复原数据",
    );
  }
}

export function saveStyleProfile(profile: IPStyleProfile): void {
  const all = readStyleProfilesForWrite();
  const idx = all.findIndex((p) => p.ipId === profile.ipId);
  if (idx >= 0) all[idx] = profile; else all.push(profile);
  try {
    localStorage.setItem(KEY_STYLE_PROFILES, JSON.stringify(all));
  } catch {
    throw new IPStyleProfileStoreError(
      "STYLE_PROFILE_STORAGE_WRITE_FAILED",
      "语气画像保存失败，本次结果没有写入，请检查浏览器存储空间后重试",
    );
  }
}

export function deleteStyleProfile(ipId: string): void {
  const all = readJSON<IPStyleProfile[]>(KEY_STYLE_PROFILES, []);
  writeJSON(KEY_STYLE_PROFILES, all.filter((p) => p.ipId !== ipId));
}

// ── IP 资产库：选题 ──
export class TopicAssetUpdateError extends Error {
  readonly code: "IP_MISMATCH" | "INVALID_STATUS_TRANSITION";

  constructor(code: TopicAssetUpdateError["code"], message: string) {
    super(message);
    this.name = "TopicAssetUpdateError";
    this.code = code;
  }
}

type TopicAssetManualStatus = Exclude<TopicAssetStatus, "已评估">;

const TOPIC_STATUS_TRANSITIONS: Record<TopicAssetStatus, TopicAssetManualStatus[]> = {
  "草稿": [],
  "已评估": ["已采用", "已废弃"],
  "已采用": ["已拍摄", "已废弃"],
  "已拍摄": [],
  "已废弃": [],
};

type StoredTopicAsset = Omit<TopicAsset, "boardResult" | "evaluationSummary" | "updatedAt"> & {
  boardResult?: unknown;
  evaluationSummary?: unknown;
  updatedAt?: string;
};

function normalizeTopicAsset(asset: StoredTopicAsset): TopicAsset {
  const {
    boardResult: storedBoardResult,
    evaluationSummary: _storedEvaluationSummary,
    ...baseAsset
  } = asset;
  const updatedAt = asset.updatedAt ?? asset.createdAt;
  const normalized: TopicAsset = {
    ...baseAsset,
    updatedAt,
  };

  if (storedBoardResult === undefined) return normalized;

  try {
    const boardResult = parseTopicBoardResult(storedBoardResult);
    if (boardResult.ipId !== asset.ipId) {
      throw new TopicAssetUpdateError("IP_MISMATCH", "旧评估结果所属IP与选题所属IP不一致");
    }
    return {
      ...normalized,
      boardResult,
      evaluationSummary: createTopicEvaluationSummary(boardResult, updatedAt),
      evaluationIssue: undefined,
    };
  } catch (error) {
    const isExpectedContractError = error instanceof TopicBoardContractError;
    const isExpectedIPError = error instanceof TopicAssetUpdateError && error.code === "IP_MISMATCH";
    if (!isExpectedContractError && !isExpectedIPError) throw error;

    return {
      ...normalized,
      status: "草稿",
      boardResult: undefined,
      evaluationSummary: undefined,
      evaluationIssue: {
        code: "INVALID_LEGACY_BOARD_RESULT",
        message: "历史评估数据不完整，请重新评估此选题",
      },
    };
  }
}

export function getTopicAssets(ipId: string): TopicAsset[] {
  const all = readJSON<StoredTopicAsset[]>(KEY_TOPIC_ASSETS, []);
  return all
    .map(normalizeTopicAsset)
    .filter(a => a.ipId === ipId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getTopicAsset(id: string): TopicAsset | null {
  const all = readJSON<StoredTopicAsset[]>(KEY_TOPIC_ASSETS, []);
  const asset = all.find(item => item.id === id);
  return asset ? normalizeTopicAsset(asset) : null;
}

export function addTopicAsset(
  input: Pick<TopicAsset, "ipId" | "title" | "source">,
): TopicAsset {
  const all = readJSON<TopicAsset[]>(KEY_TOPIC_ASSETS, []);
  const now = new Date().toISOString();
  const asset: TopicAsset = {
    ...input,
    id: genId(),
    status: "草稿",
    createdAt: now,
    updatedAt: now,
  };
  writeJSON(KEY_TOPIC_ASSETS, [...all, asset]);
  return asset;
}

export function addEvaluatedTopicAsset(
  input: Pick<TopicAsset, "ipId" | "title" | "source">,
  boardResultInput: unknown,
): TopicAsset {
  const boardResult = parseTopicBoardResult(boardResultInput);
  if (boardResult.ipId !== input.ipId) {
    throw new TopicAssetUpdateError(
      "IP_MISMATCH",
      `评估结果所属IP（${boardResult.ipId}）与选题所属IP（${input.ipId}）不一致`,
    );
  }

  const all = readJSON<TopicAsset[]>(KEY_TOPIC_ASSETS, []);
  const now = new Date().toISOString();
  const asset: TopicAsset = {
    ...input,
    id: genId(),
    status: "已评估",
    boardResult,
    evaluationSummary: createTopicEvaluationSummary(boardResult, now),
    createdAt: now,
    updatedAt: now,
  };
  writeJSON(KEY_TOPIC_ASSETS, [...all, asset]);
  return asset;
}

export function updateTopicAssetEvaluation(
  id: string,
  boardResultInput: unknown,
): TopicAsset | null {
  const all = readJSON<Array<TopicAsset & { updatedAt?: string }>>(KEY_TOPIC_ASSETS, []);
  const index = all.findIndex(asset => asset.id === id);
  if (index < 0) return null;

  const current = normalizeTopicAsset(all[index]);
  const boardResult = parseTopicBoardResult(boardResultInput);
  if (boardResult.ipId !== current.ipId) {
    throw new TopicAssetUpdateError(
      "IP_MISMATCH",
      `评估结果所属IP（${boardResult.ipId}）与选题所属IP（${current.ipId}）不一致`,
    );
  }
  if (current.status !== "草稿" && current.status !== "已评估") {
    throw new TopicAssetUpdateError(
      "INVALID_STATUS_TRANSITION",
      `状态为${current.status}的选题不能重新保存评估结果`,
    );
  }

  const now = new Date().toISOString();
  const { evaluationIssue: _previousEvaluationIssue, ...currentWithoutEvaluationIssue } = current;
  const updated: TopicAsset = {
    ...currentWithoutEvaluationIssue,
    status: "已评估",
    boardResult,
    evaluationSummary: createTopicEvaluationSummary(boardResult, now),
    updatedAt: now,
  };
  all[index] = updated;
  writeJSON(KEY_TOPIC_ASSETS, all);
  return updated;
}

export function updateTopicAssetStatus(
  id: string,
  nextStatus: TopicAssetManualStatus,
): TopicAsset | null;
export function updateTopicAssetStatus(
  id: string,
  nextStatus: TopicAssetStatus,
): TopicAsset | null {
  if (nextStatus === "已评估") {
    throw new TopicAssetUpdateError(
      "INVALID_STATUS_TRANSITION",
      "已评估状态只能通过保存完整评估结果产生",
    );
  }

  const all = readJSON<Array<TopicAsset & { updatedAt?: string }>>(KEY_TOPIC_ASSETS, []);
  const index = all.findIndex(asset => asset.id === id);
  if (index < 0) return null;

  const current = normalizeTopicAsset(all[index]);
  if (!TOPIC_STATUS_TRANSITIONS[current.status]?.includes(nextStatus)) {
    throw new TopicAssetUpdateError(
      "INVALID_STATUS_TRANSITION",
      `选题状态不能从${current.status}变更为${nextStatus}`,
    );
  }

  const updated: TopicAsset = {
    ...current,
    status: nextStatus,
    updatedAt: new Date().toISOString(),
  };
  all[index] = updated;
  writeJSON(KEY_TOPIC_ASSETS, all);
  return updated;
}

export function deleteTopicAsset(id: string): void {
  const all = readJSON<TopicAsset[]>(KEY_TOPIC_ASSETS, []);
  writeJSON(KEY_TOPIC_ASSETS, all.filter(a => a.id !== id));
}

// ── IP 资产库：评论分析 ──
export function getCommentAssets(ipId: string): CommentAsset[] {
  const all = readJSON<CommentAsset[]>(KEY_COMMENT_ASSETS, []);
  return all.filter(a => a.ipId === ipId).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

export function addCommentAsset(input: Omit<CommentAsset, "id" | "importedAt">): CommentAsset {
  const all = readJSON<CommentAsset[]>(KEY_COMMENT_ASSETS, []);
  const asset: CommentAsset = { ...input, id: genId(), importedAt: new Date().toISOString() };
  writeJSON(KEY_COMMENT_ASSETS, [...all, asset]);
  return asset;
}

export function deleteCommentAsset(id: string): void {
  const all = readJSON<CommentAsset[]>(KEY_COMMENT_ASSETS, []);
  writeJSON(KEY_COMMENT_ASSETS, all.filter(a => a.id !== id));
}

// ── IP 资产库：脚本 ──
function createNotTrackedKnowledgeState(): ScriptKnowledgeTracking {
  return {
    status: "not_tracked",
    candidateKnowledgeEntryIds: [],
    verifiedAt: null,
    usages: [],
  };
}

function migrateScriptAsset(asset: ScriptAsset): ScriptAsset {
  return {
    ...asset,
    knowledgeTracking: asset.knowledgeTracking ?? createNotTrackedKnowledgeState(),
  };
}

export function getScriptAssets(ipId: string): ScriptAsset[] {
  const all = readJSON<ScriptAsset[]>(KEY_SCRIPT_ASSETS, []);
  return all
    .map(migrateScriptAsset)
    .filter(a => a.ipId === ipId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addScriptAsset(input: NewScriptAssetInput): ScriptAsset {
  const all = readJSON<ScriptAsset[]>(KEY_SCRIPT_ASSETS, []);
  const knowledgeTracking = input.knowledgeTracking?.status === "verified"
    ? parseVerifiedScriptKnowledgeTracking({
        candidateKnowledgeEntryIds: input.knowledgeTracking.candidateKnowledgeEntryIds,
        finalScriptText: input.content,
        verifiedAt: input.knowledgeTracking.verifiedAt,
        usages: input.knowledgeTracking.usages,
      })
    : input.knowledgeTracking ?? createNotTrackedKnowledgeState();
  const asset: ScriptAsset = {
    ...input,
    knowledgeTracking,
    id: genId(),
    createdAt: new Date().toISOString(),
  };
  writeJSON(KEY_SCRIPT_ASSETS, [...all, asset]);
  return asset;
}

export function updateScriptAssetResult(id: string, ipId: string, scriptResult: unknown): boolean {
  const all = readJSON<ScriptAsset[]>(KEY_SCRIPT_ASSETS, []);
  const target = all.find(asset => asset.id === id);
  if (!target || target.ipId !== ipId) return false;
  writeJSON(KEY_SCRIPT_ASSETS, all.map(asset =>
    asset.id === id ? { ...asset, scriptResult } : asset
  ));
  return true;
}

export function deleteScriptAsset(id: string): void {
  const all = readJSON<ScriptAsset[]>(KEY_SCRIPT_ASSETS, []);
  writeJSON(KEY_SCRIPT_ASSETS, all.filter(a => a.id !== id));
}

// ── 知识库中心：爆款案例库 / 方法论库 / 评论库 ──
// （IP口播库不在这里，复用上面的 VoiceSample / getAllVoiceSamples）
// 迁移旧数据：(1) 分类"评论"改名为"评论需求"，含义不变 (2) 补全这一轮新加的usageRecords/status字段，
// 防止本次升级之前存的旧条目读出来缺字段导致页面渲染报错。
function migrateKnowledgeEntry(e: Omit<KnowledgeEntry, "category"> & { category: string }): KnowledgeEntry {
  return {
    ...e,
    category: e.category === "评论" ? "评论需求" : (e.category as KnowledgeCategory),
    usageRecords: (Array.isArray(e.usageRecords) ? e.usageRecords : []).map(record => ({
      ...record,
      trackingStatus: record.trackingStatus ?? "legacy_unverified",
      topicId: record.topicId ?? null,
      scriptId: record.scriptId ?? null,
      reviewId: record.reviewId ?? null,
      usageType: record.usageType ?? null,
      sectionLabel: record.sectionLabel ?? null,
      evidenceExcerpt: record.evidenceExcerpt ?? null,
    })),
    status: e.status ?? "未使用",
    trustStatus: e.trustStatus ?? null,
    sourceReference: e.sourceReference ?? null,
    dna: e.dna ?? null,
    sourceKind: e.sourceKind ?? null,
    sourceName: e.sourceName ?? "",
    sourceAnalysis: e.sourceAnalysis ?? null,
  };
}

export function getKnowledgeEntries(category?: KnowledgeCategory): KnowledgeEntry[] {
  const all = readKnowledgeEntriesStrict().map(migrateKnowledgeEntry);
  const filtered = category ? all.filter((e) => e.category === category) : all;
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getKnowledgeEntriesForFullLibraryComparison(): KnowledgeEntry[] {
  return getKnowledgeEntries();
}

export function addKnowledgeEntry(input: Omit<KnowledgeEntry, "id" | "createdAt">): KnowledgeEntry {
  const all = readKnowledgeEntriesStrict();
  const entry: KnowledgeEntry = { ...input, id: genId(), createdAt: new Date().toISOString() };
  writeJSON(KEY_KNOWLEDGE_ENTRIES, [...all, entry]);
  return entry;
}

export function addKnowledgeEntryWithId(input: Omit<KnowledgeEntry, "createdAt">): KnowledgeEntry {
  const all = readKnowledgeEntriesStrict();
  if (all.some(entry => entry.id === input.id)) {
    throw new Error("知识条目编号重复，未保存任何内容");
  }
  const entry: KnowledgeEntry = { ...input, createdAt: new Date().toISOString() };
  writeJSON(KEY_KNOWLEDGE_ENTRIES, [...all, entry]);
  const persisted = readKnowledgeEntriesStrict()
    .find(saved => saved.id === entry.id);
  if (!persisted) throw new Error("IP原始内容写入失败，未保存半成品");
  return migrateKnowledgeEntry(persisted);
}

export interface HotAnalysisKnowledgeSaveEntry {
  slotId: string;
  role: "viral_case" | "method_card";
  entry: Omit<
    KnowledgeEntry,
    | "id"
    | "createdAt"
    | "usageRecords"
    | "status"
    | "trustStatus"
    | "sourceReference"
  >;
}

export interface HotAnalysisKnowledgeSaveInput {
  analysisId: string;
  entries: HotAnalysisKnowledgeSaveEntry[];
}

function serializeKnowledgeSaveContent(entry: KnowledgeEntry): string {
  const {
    createdAt: _createdAt,
    usageRecords: _usageRecords,
    status: _status,
    trustStatus: _trustStatus,
    ...content
  } = entry;
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  };
  return JSON.stringify(normalize(content));
}

export function saveHotAnalysisKnowledgeEntries(
  input: HotAnalysisKnowledgeSaveInput,
): KnowledgeEntry[] {
  const analysis = getHotAnalyses().find(item => item.id === input.analysisId);
  if (!analysis) throw new Error("没有找到需要沉淀的爆款分析记录");
  if (input.entries.some(item =>
    (item.role === "viral_case") !== (item.entry.category === "爆款案例")
  )) {
    throw new Error("爆款分析知识角色与分类不一致，已拒绝保存");
  }
  if (input.entries.some(item => item.entry.ipId !== analysis.ipId)) {
    throw new Error("待保存知识不属于本次分析记录的IP，已拒绝保存");
  }
  if (input.entries.some(item => !item.slotId.trim())) {
    throw new Error("爆款分析知识的组内编号不能为空，已拒绝保存");
  }
  const all = readKnowledgeEntriesStrict();
  const createdAt = new Date().toISOString();
  const candidates = input.entries.map(item => {
    const groupItemId = item.slotId.trim();
    return migrateKnowledgeEntry({
      ...item.entry,
      id: `hot-analysis:${input.analysisId}:${groupItemId}`,
      createdAt,
      usageRecords: [],
      status: "未使用" as const,
      trustStatus: item.role === "method_card"
        ? "ai_derived_unverified" as const
        : null,
      sourceReference: {
        sourceType: "hot_analysis" as const,
        analysisId: input.analysisId,
        role: item.role,
        groupItemId,
      },
    });
  });
  if (new Set(candidates.map(entry => entry.id)).size !== candidates.length) {
    throw new Error("同一批次存在知识编号重复，已拒绝保存");
  }
  const candidateIds = new Set(candidates.map(entry => entry.id));
  const existingIdCounts = new Map<string, number>();
  for (const entry of all) {
    if (!candidateIds.has(entry.id)) continue;
    existingIdCounts.set(entry.id, (existingIdCounts.get(entry.id) ?? 0) + 1);
  }
  if ([...existingIdCounts.values()].some(count => count > 1)) {
    throw new Error("历史知识存在相同编号的重复条目，已拒绝保存，请先修复异常数据");
  }
  const existingById = new Map(all.map(entry => [entry.id, migrateKnowledgeEntry(entry)]));
  const additions: KnowledgeEntry[] = [];
  const resolved = candidates.map(candidate => {
    const existing = existingById.get(candidate.id);
    if (!existing) {
      additions.push(candidate);
      return candidate;
    }
    if (serializeKnowledgeSaveContent(existing) !== serializeKnowledgeSaveContent(candidate)) {
      throw new Error("爆款分析存在同编号知识，但保存内容不一致；内容、归属或可信度不一致，已拒绝重复保存");
    }
    return existing;
  });
  if (additions.length === 0) return resolved;
  writeKnowledgeEntriesStrict(
    [...all, ...additions],
    "爆款分析知识保存失败，请稍后重试",
  );
  const persistedById = new Map(
    readKnowledgeEntriesStrict().map(entry => [entry.id, entry]),
  );
  return resolved.map(entry => {
    const persisted = persistedById.get(entry.id);
    if (!persisted) throw new Error("爆款分析知识保存失败，请稍后重试");
    return migrateKnowledgeEntry(persisted);
  });
}

export interface HotAnalysisKnowledgeGroup {
  analysisId: string;
  viralCase: KnowledgeEntry | null;
  methodCards: KnowledgeEntry[];
}

function getValidHotAnalysisSourceReference(
  entry: KnowledgeEntry,
): HotAnalysisKnowledgeSourceReference | null {
  const reference = entry.sourceReference;
  if (
    !reference ||
    reference.sourceType !== "hot_analysis" ||
    typeof reference.analysisId !== "string" ||
    !reference.analysisId ||
    (reference.role !== "viral_case" && reference.role !== "method_card") ||
    typeof reference.groupItemId !== "string" ||
    !reference.groupItemId ||
    (reference.role === "viral_case") !== (entry.category === "爆款案例")
  ) {
    return null;
  }
  return reference;
}

export function getHotAnalysisKnowledgeGroup(
  knowledgeEntryId: string,
): HotAnalysisKnowledgeGroup | null {
  const all = getKnowledgeEntries();
  const anchors = all.filter(entry => entry.id === knowledgeEntryId);
  if (anchors.length !== 1) return null;
  const anchor = anchors[0]!;
  const anchorReference = getValidHotAnalysisSourceReference(anchor);
  if (!anchorReference) return null;
  const members = all
    .map(entry => ({ entry, reference: getValidHotAnalysisSourceReference(entry) }))
    .filter(item =>
      item.reference?.analysisId === anchorReference.analysisId &&
      item.entry.ipId === anchor.ipId
    )
    .sort((left, right) =>
      left.reference!.groupItemId.localeCompare(right.reference!.groupItemId)
    );
  const viralCases = members.filter(item => item.reference!.role === "viral_case");
  return {
    analysisId: anchorReference.analysisId,
    viralCase: viralCases.length === 1 ? viralCases[0]!.entry : null,
    methodCards: members
      .filter(item => item.reference!.role === "method_card")
      .map(item => item.entry),
  };
}

export type KnowledgeEntryEditablePatch = Omit<
  Partial<KnowledgeEntry>,
  "trustStatus" | "sourceReference"
>;

export function updateKnowledgeEntry(id: string, patch: KnowledgeEntryEditablePatch): void {
  if (
    Object.prototype.hasOwnProperty.call(patch, "trustStatus") ||
    Object.prototype.hasOwnProperty.call(patch, "sourceReference")
  ) {
    throw new Error("系统维护字段不能通过通用编辑入口修改");
  }
  const all = readKnowledgeEntriesStrict();
  writeJSON(KEY_KNOWLEDGE_ENTRIES, all.map((e) => (e.id === id ? { ...e, ...patch } : e)));
}

export function deleteKnowledgeEntry(id: string): void {
  const all = readKnowledgeEntriesStrict();
  writeJSON(KEY_KNOWLEDGE_ENTRIES, all.filter((e) => e.id !== id));
}

// 记录一次知识被某个模块引用——"被哪些模块调用"和"调用次数"都从usageRecords派生，
// 不单独维护计数字段，避免两边数字对不上。newStatus可选：只有真正进入下一阶段时才推进状态，
// 单纯被检索到、还没被实际采用，不强制变更status。
type ModuleKnowledgeUsageInput = Omit<
  KnowledgeUsageRecord,
  | "id"
  | "trackingStatus"
  | "topicId"
  | "scriptId"
  | "reviewId"
  | "usageType"
  | "sectionLabel"
  | "evidenceExcerpt"
>;

export function recordKnowledgeUsage(
  entryId: string,
  usage: ModuleKnowledgeUsageInput,
  newStatus?: KnowledgeStatus,
  scriptId?: string,
): void {
  const all = readKnowledgeEntriesStrict().map(migrateKnowledgeEntry);
  const targetEntry = all.find(entry => entry.id === entryId);
  if (!targetEntry) return;
  if (newStatus === "已用于脚本" && !scriptId) {
    throw new Error("已用于脚本记录缺少脚本编号，已拒绝写入");
  }
  const linkedScript = scriptId
    ? readJSON<ScriptAsset[]>(KEY_SCRIPT_ASSETS, []).map(migrateScriptAsset)
      .find(script => script.id === scriptId)
    : null;
  if (scriptId && !linkedScript) {
    throw new Error("没有找到知识记录对应的脚本，已拒绝写入");
  }
  if (linkedScript && targetEntry.ipId && targetEntry.ipId !== linkedScript.ipId) {
    throw new Error("知识与脚本不属于同一IP，已拒绝写入");
  }
  const candidateKnowledgeEntryIds: readonly string[] = linkedScript
    ? linkedScript.knowledgeTracking.candidateKnowledgeEntryIds
    : [];
  if (
    linkedScript
    && !candidateKnowledgeEntryIds.includes(entryId)
  ) {
    throw new Error("知识不在该脚本当时的候选知识清单中，已拒绝写入");
  }
  writeJSON(KEY_KNOWLEDGE_ENTRIES, all.map((e) => {
    if (e.id !== entryId) return e;
    const record: KnowledgeUsageRecord = {
      ...usage,
      id: genId(),
      trackingStatus: "module_recorded",
      topicId: linkedScript?.topicId ?? null,
      scriptId: linkedScript?.id ?? null,
      reviewId: null,
      usageType: null,
      sectionLabel: null,
      evidenceExcerpt: null,
    };
    return { ...e, usageRecords: [...e.usageRecords, record], status: newStatus ?? e.status };
  }));
}

// ── Hook知识库：广度层 ──
export function getHookEntries(): HookEntry[] {
  return readJSON<HookEntry[]>(KEY_HOOK_ENTRIES, []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getUnanalyzedHookEntries(): HookEntry[] {
  return getHookEntries().filter((h) => !h.analyzed);
}

export function addHookEntry(input: Omit<HookEntry, "id" | "createdAt" | "analyzed" | "analyzedAt">): HookEntry {
  const all = readJSON<HookEntry[]>(KEY_HOOK_ENTRIES, []);
  const entry: HookEntry = { ...input, id: genId(), createdAt: new Date().toISOString(), analyzed: false, analyzedAt: null };
  writeJSON(KEY_HOOK_ENTRIES, [...all, entry]);
  return entry;
}

export function addHookEntriesBatch(inputs: Omit<HookEntry, "id" | "createdAt" | "analyzed" | "analyzedAt">[]): HookEntry[] {
  const all = readJSON<HookEntry[]>(KEY_HOOK_ENTRIES, []);
  const entries: HookEntry[] = inputs.map((input) => ({ ...input, id: genId(), createdAt: new Date().toISOString(), analyzed: false, analyzedAt: null }));
  writeJSON(KEY_HOOK_ENTRIES, [...all, ...entries]);
  return entries;
}

export function deleteHookEntry(id: string): void {
  const all = readJSON<HookEntry[]>(KEY_HOOK_ENTRIES, []);
  writeJSON(KEY_HOOK_ENTRIES, all.filter((h) => h.id !== id));
}

export function addLikesSnapshot(id: string, snapshot: LikesSnapshot): void {
  const all = readJSON<HookEntry[]>(KEY_HOOK_ENTRIES, []);
  writeJSON(KEY_HOOK_ENTRIES, all.map((h) => (h.id === id ? { ...h, likesHistory: [...h.likesHistory, snapshot] } : h)));
}

// 批量分析结果写回——只更新hookType/trackConfirmed/analyzed/analyzedAt，其余字段不动
export function applyHookAnalysisResults(results: { id: string; hookType: HookEntry["hookType"]; trackConfirmed: string }[]): void {
  const all = readJSON<HookEntry[]>(KEY_HOOK_ENTRIES, []);
  const resultMap = new Map(results.map((r) => [r.id, r]));
  const now = new Date().toISOString();
  writeJSON(KEY_HOOK_ENTRIES, all.map((h) => {
    const r = resultMap.get(h.id);
    if (!r) return h;
    return { ...h, hookType: r.hookType, trackConfirmed: r.trackConfirmed, analyzed: true, analyzedAt: now };
  }));
}

// ── 爆款分析中心：素材雷达的每次分析留痕，独立于知识库——分析记录是过程留痕，
// 知识库条目是被认定值得长期复用的精华，两者生命周期不同，不合并存储。 ──
export function getHotAnalyses(): HotMaterialAnalysis[] {
  return readJSON<HotMaterialAnalysis[]>(KEY_HOT_ANALYSES, []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addHotAnalysis(input: Omit<HotMaterialAnalysis, "id" | "createdAt" | "addedToKnowledgeBase" | "knowledgeEntryId">): HotMaterialAnalysis {
  const all = readJSON<HotMaterialAnalysis[]>(KEY_HOT_ANALYSES, []);
  const entry: HotMaterialAnalysis = { ...input, id: genId(), createdAt: new Date().toISOString(), addedToKnowledgeBase: false, knowledgeEntryId: null };
  writeJSON(KEY_HOT_ANALYSES, [...all, entry]);
  return entry;
}

export function deleteHotAnalysis(id: string): void {
  const all = readJSON<HotMaterialAnalysis[]>(KEY_HOT_ANALYSES, []);
  writeJSON(KEY_HOT_ANALYSES, all.filter((a) => a.id !== id));
}

// 标记某条分析已经被提升进知识库，避免重复提升、也方便从知识库条目反查是哪次分析产生的
export function markHotAnalysisAdded(analysisId: string, knowledgeEntryId: string): void {
  const all = readJSON<HotMaterialAnalysis[]>(KEY_HOT_ANALYSES, []);
  writeJSON(KEY_HOT_ANALYSES, all.map((a) => (a.id === analysisId ? { ...a, addedToKnowledgeBase: true, knowledgeEntryId } : a)));
}

// ── 用户配置：操盘人信息，独立于IPProfile（操盘人和当前操盘IP是两件事，互不影响） ──
export function getUserProfile(): UserProfile {
  return readJSON<UserProfile>(KEY_USER_PROFILE, DEFAULT_USER_PROFILE);
}

export function setUserProfile(profile: UserProfile): void {
  writeJSON(KEY_USER_PROFILE, profile);
}

// 昵称优先；昵称为空时退回真实姓名；姓名也为空时退回默认昵称"彭彭"——这是兜底默认值，不是写死的展示值
export function getOperatorDisplayName(profile?: UserProfile): string {
  const p = profile ?? getUserProfile();
  return p.nickname.trim() || p.name.trim() || DEFAULT_USER_PROFILE.nickname;
}

// ── 发布复盘：每次复盘独立存储，独立于知识库条目——复盘是过程记录，经验沉淀后才入库 ──
interface VideoReviewCollapseResult {
  reviews: VideoReview[];
  retainedReviewIdByRemovedId: Map<string, string>;
}

function collapseDuplicateVideoReviews(reviews: VideoReview[]): VideoReviewCollapseResult {
  const retainedIndexByScript = new Map<string, number>();
  reviews.forEach((review, index) => {
    if (review.sourceType !== "flowpilot" || !review.ipId || !review.scriptId) return;
    const key = JSON.stringify([review.ipId, review.scriptId]);
    const retainedIndex = retainedIndexByScript.get(key);
    if (
      retainedIndex === undefined ||
      review.createdAt.localeCompare(reviews[retainedIndex]!.createdAt) > 0
    ) {
      retainedIndexByScript.set(key, index);
    }
  });
  const retainedReviewIdByRemovedId = new Map<string, string>();
  const collapsed = reviews.filter((review, index) => {
    if (review.sourceType !== "flowpilot" || !review.ipId || !review.scriptId) return true;
    const retainedIndex = retainedIndexByScript.get(JSON.stringify([review.ipId, review.scriptId]));
    if (retainedIndex === index) return true;
    retainedReviewIdByRemovedId.set(review.id, reviews[retainedIndex!]!.id);
    return false;
  });
  return { reviews: collapsed, retainedReviewIdByRemovedId };
}

function reportVideoReviewMaintenanceFailure(stage: string): void {
  console.warn("[video-review-maintenance]", { stage });
}

function maintainCollapsedVideoReviews(
  collapseResult: VideoReviewCollapseResult,
): void {
  if (collapseResult.retainedReviewIdByRemovedId.size === 0) return;
  let knowledgeEntries: KnowledgeEntry[];
  try {
    knowledgeEntries = readKnowledgeEntriesStrict().map(migrateKnowledgeEntry);
  } catch {
    reportVideoReviewMaintenanceFailure("knowledge_read_failed");
    return;
  }
  const retainedReviewIds = new Set(
    collapseResult.retainedReviewIdByRemovedId.values(),
  );
  const scriptByRetainedReviewId = new Map<string, ScriptAsset>();
  for (const review of collapseResult.reviews) {
    if (
      !retainedReviewIds.has(review.id) ||
      review.sourceType !== "flowpilot" ||
      review.traceabilityStatus !== "traceable" ||
      !review.ipId ||
      !review.scriptId ||
      !review.topicId
    ) continue;
    const script = getScriptAssets(review.ipId)
      .find(item => item.id === review.scriptId);
    const topic = getTopicAsset(review.topicId);
    if (
      script &&
      topic &&
      script.ipId === review.ipId &&
      topic.ipId === review.ipId &&
      script.topicId === topic.id
    ) {
      scriptByRetainedReviewId.set(review.id, script);
    }
  }
  let knowledgeChanged = false;
  const relocatedKnowledgeEntries = knowledgeEntries.map(entry => ({
    ...entry,
    usageRecords: entry.usageRecords.map(record => {
      if (!record.reviewId) return record;
      const retainedReviewId = collapseResult.retainedReviewIdByRemovedId.get(record.reviewId);
      if (!retainedReviewId) return record;
      knowledgeChanged = true;
      const script = scriptByRetainedReviewId.get(retainedReviewId);
      return script && isTrustedKnowledgeUsageForScript(entry, record, script)
        ? { ...record, reviewId: retainedReviewId }
        : { ...record, reviewId: null };
    }),
  }));
  if (knowledgeChanged) {
    try {
      writeKnowledgeEntriesStrict(
        relocatedKnowledgeEntries,
        "复盘知识关联迁移失败",
      );
    } catch {
      reportVideoReviewMaintenanceFailure("knowledge_relocation_failed");
      return;
    }
    const reviewsWithTrustedKnowledge = new Set<string>();
    for (const review of collapseResult.reviews) {
      const script = scriptByRetainedReviewId.get(review.id);
      if (
        script &&
        relocatedKnowledgeEntries.some(entry =>
          entry.usageRecords.some(record =>
            record.reviewId === review.id &&
            isTrustedKnowledgeUsageForScript(entry, record, script)
          )
        )
      ) {
        reviewsWithTrustedKnowledge.add(review.id);
      }
    }
    collapseResult.reviews = collapseResult.reviews.map(review =>
      retainedReviewIds.has(review.id)
        ? {
            ...review,
            knowledgeEffectStatus: reviewsWithTrustedKnowledge.has(review.id)
              ? "tracked"
              : "no_linked_knowledge",
          }
        : review
    );
  }
  try {
    writeVideoReviewsStrict(collapseResult.reviews);
  } catch {
    if (knowledgeChanged) {
      try {
        writeKnowledgeEntriesStrict(
          knowledgeEntries,
          "复盘知识关联恢复失败",
        );
      } catch {
        reportVideoReviewMaintenanceFailure("knowledge_rollback_failed");
      }
    }
    reportVideoReviewMaintenanceFailure("review_cleanup_failed");
  }
}

function retryPendingVideoReviewKnowledgeStatuses(
  reviews: VideoReview[],
): VideoReview[] {
  const pendingReviews = reviews.filter(review =>
    review.sourceType === "flowpilot" &&
    review.traceabilityStatus === "traceable" &&
    (review.knowledgeEffectStatus === "tracked_status_pending" ||
      review.knowledgeEffectStatus === "knowledge_unavailable") &&
    review.ipId &&
    review.scriptId &&
    review.topicId
  );
  if (pendingReviews.length === 0) return reviews;
  let knowledgeEntries: KnowledgeEntry[];
  try {
    knowledgeEntries = readKnowledgeEntriesStrict().map(migrateKnowledgeEntry);
  } catch {
    return reviews;
  }
  const repairedReviewIds = new Set<string>();
  for (const review of pendingReviews) {
    const script = getScriptAssets(review.ipId!).find(item => item.id === review.scriptId);
    const topic = getTopicAsset(review.topicId!);
    if (
      !script ||
      !topic ||
      script.ipId !== review.ipId ||
      topic.ipId !== review.ipId ||
      script.topicId !== topic.id
    ) continue;
    if (knowledgeEntries.some(entry =>
      entry.usageRecords.some(record =>
        record.reviewId === review.id &&
        isTrustedKnowledgeUsageForScript(entry, record, script)
      )
    )) {
      repairedReviewIds.add(review.id);
    }
  }
  if (repairedReviewIds.size === 0) return reviews;
  const repairedReviews = reviews.map(review =>
    repairedReviewIds.has(review.id)
      ? { ...review, knowledgeEffectStatus: "tracked" as const }
      : review
  );
  try {
    writeVideoReviewsStrict(repairedReviews);
    return repairedReviews;
  } catch {
    reportVideoReviewMaintenanceFailure("knowledge_status_retry_failed");
    return reviews.map(review =>
      repairedReviewIds.has(review.id)
        ? { ...review, knowledgeEffectStatus: "tracked_status_pending" as const }
        : review
    );
  }
}

export function getVideoReviews(ipId?: string): VideoReview[] {
  const all = readJSON<VideoReview[]>(KEY_VIDEO_REVIEWS, [])
    .map(migrateManualReviewFields);
  const collapseResult = collapseDuplicateVideoReviews(all);
  maintainCollapsedVideoReviews(collapseResult);
  collapseResult.reviews = retryPendingVideoReviewKnowledgeStatuses(
    collapseResult.reviews,
  );
  const filtered = ipId
    ? collapseResult.reviews.filter(r => r.ipId === ipId)
    : collapseResult.reviews;
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface VideoReviewReadOnlySnapshot {
  reviews: VideoReview[];
  retainedReviewIdByRemovedId: ReadonlyMap<string, string>;
}

function isReadableVideoReview(value: unknown): value is VideoReview {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const review = value as Record<string, unknown>;
  return typeof review.id === "string" && review.id.length > 0 &&
    typeof review.createdAt === "string" && review.createdAt.length > 0;
}

export function getVideoReviewsReadOnly(ipId?: string): VideoReviewReadOnlySnapshot {
  const storedReviews = readJSON<unknown>(KEY_VIDEO_REVIEWS, []);
  const readableReviews = Array.isArray(storedReviews)
    ? storedReviews.filter(isReadableVideoReview).map(migrateManualReviewFields)
    : [];
  const collapseResult = collapseDuplicateVideoReviews(
    readableReviews,
  );
  const filtered = ipId
    ? collapseResult.reviews.filter(review => review.ipId === ipId)
    : collapseResult.reviews;
  return {
    reviews: filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    retainedReviewIdByRemovedId: collapseResult.retainedReviewIdByRemovedId,
  };
}

type AddVideoReviewInput = Omit<
  VideoReview,
  | "id"
  | "ipId"
  | "topicId"
  | "scriptId"
  | "sourceType"
  | "traceabilityStatus"
  | "knowledgeEffectStatus"
  | "createdAt"
  | "updatedAt"
  | "manualReviewStatus"
  | "manualReviewTags"
  | "manualReviewNote"
  | "savedToKnowledge"
  | "knowledgeEntryId"
> & ({
  ipId: string;
  topicId: string;
  scriptId: string;
  sourceType: "flowpilot";
  traceabilityStatus: "traceable";
} | {
  ipId: string;
  topicId: null;
  scriptId: null;
  sourceType: "external";
  traceabilityStatus: "external_untraceable";
});

export function addVideoReview(input: AddVideoReviewInput): VideoReview {
  const ipId = typeof input.ipId === "string" ? input.ipId.trim() : "";
  if (!ipId) throw new Error("复盘来源契约不完整：缺少当前IP");
  if (input.sourceType === "external") {
    if (
      input.traceabilityStatus !== "external_untraceable" ||
      input.topicId !== null ||
      input.scriptId !== null
    ) {
      throw new Error("复盘来源契约不完整：外部内容不能伪造内部关联");
    }
  } else if (input.sourceType === "flowpilot") {
    const script = getScriptAssets(ipId).find(item => item.id === input.scriptId);
    const topic = getTopicAsset(input.topicId);
    if (
      input.traceabilityStatus !== "traceable" ||
      !script ||
      !topic ||
      script.ipId !== ipId ||
      topic.ipId !== ipId ||
      script.topicId !== topic.id
    ) {
      throw new Error("复盘来源契约不完整：选题、脚本与当前IP关联无效");
    }
  } else {
    throw new Error("复盘来源契约不完整：来源类型无效");
  }
  const all = readJSON<VideoReview[]>(KEY_VIDEO_REVIEWS, []);
  const reviewsForScript = input.sourceType === "flowpilot"
    ? all.filter(item =>
        item.ipId === ipId &&
        item.sourceType === "flowpilot" &&
        item.scriptId === input.scriptId
      )
    : [];
  const existingReview = reviewsForScript
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const now = new Date().toISOString();
  const createdAt = existingReview?.createdAt ?? now;
  const existingManualReview = existingReview
    ? migrateManualReviewFields(existingReview)
    : null;
  let review: VideoReview = {
    ...input,
    ipId,
    id: existingReview?.id ?? genId(),
    createdAt,
    ...(existingManualReview
      ? {
          manualReviewStatus: existingManualReview.manualReviewStatus,
          manualReviewTags: existingManualReview.manualReviewTags,
          manualReviewNote: existingManualReview.manualReviewNote,
          updatedAt: now,
        }
      : createPendingManualReviewFields(createdAt)),
    savedToKnowledge: existingReview?.savedToKnowledge ?? false,
    knowledgeEntryId: existingReview?.knowledgeEntryId ?? null,
    knowledgeEffectStatus: input.sourceType === "flowpilot"
      ? "knowledge_unavailable"
      : undefined,
  };
  const reviewsAfterDeduplication = existingReview
    ? [
        ...all.filter(item => !reviewsForScript.some(existing => existing.id === item.id)),
        review,
      ]
    : [...all, review];
  writeVideoReviewsStrict(reviewsAfterDeduplication);
  if (input.sourceType === "flowpilot") {
    let knowledgeAssociationWritten = false;
    try {
      const script = getScriptAssets(ipId).find(item => item.id === input.scriptId);
      if (script) {
        const knowledgeEntries = readKnowledgeEntriesStrict().map(migrateKnowledgeEntry);
        const hasTrustedKnowledge = knowledgeEntries.some(entry =>
          entry.usageRecords.some(record =>
            isTrustedKnowledgeUsageForScript(entry, record, script)
          )
        );
        if (!hasTrustedKnowledge) {
          review = { ...review, knowledgeEffectStatus: "no_linked_knowledge" };
          writeVideoReviewsStrict(reviewsAfterDeduplication.map(item =>
            item.id === review.id ? review : item
          ));
          return review;
        }
        const linkedEntries = knowledgeEntries.map(entry => {
          return {
            ...entry,
            usageRecords: entry.usageRecords.map(record =>
              isTrustedKnowledgeUsageForScript(entry, record, script) &&
              record.reviewId !== review.id
                ? { ...record, reviewId: review.id }
                : record
            ),
          };
        });
        writeKnowledgeEntriesStrict(linkedEntries, "知识关联写入失败");
        knowledgeAssociationWritten = true;
        review = { ...review, knowledgeEffectStatus: "tracked" };
        writeVideoReviewsStrict(reviewsAfterDeduplication.map(item =>
          item.id === review.id ? review : item
        ));
      }
    } catch {
      if (knowledgeAssociationWritten) {
        review = { ...review, knowledgeEffectStatus: "tracked_status_pending" };
        try {
          writeVideoReviewsStrict(reviewsAfterDeduplication.map(item =>
            item.id === review.id ? review : item
          ));
        } catch {
          reportVideoReviewMaintenanceFailure("knowledge_status_pending_save_failed");
        }
      }
    }
  }
  return review;
}

type UpdateVideoReviewPatch = Partial<Omit<
  VideoReview,
  | "id"
  | "ipId"
  | "topicId"
  | "scriptId"
  | "sourceType"
  | "traceabilityStatus"
  | "knowledgeEffectStatus"
  | "createdAt"
  | "updatedAt"
  | "manualReviewStatus"
  | "manualReviewTags"
  | "manualReviewNote"
  | "savedToKnowledge"
  | "knowledgeEntryId"
>>;

const VIDEO_REVIEW_PROTECTED_FIELDS = [
  "id",
  "ipId",
  "topicId",
  "scriptId",
  "sourceType",
  "traceabilityStatus",
  "knowledgeEffectStatus",
  "createdAt",
  "updatedAt",
  "manualReviewStatus",
  "manualReviewTags",
  "manualReviewNote",
  "savedToKnowledge",
  "knowledgeEntryId",
] as const;

export function updateVideoReview(id: string, patch: UpdateVideoReviewPatch): void {
  if (VIDEO_REVIEW_PROTECTED_FIELDS.some(field => Object.prototype.hasOwnProperty.call(patch, field))) {
    throw new Error("不能修改复盘归属、追溯或人工复盘契约字段");
  }
  const all = readJSON<VideoReview[]>(KEY_VIDEO_REVIEWS, []);
  writeVideoReviewsStrict(
    all.map(r => r.id === id ? { ...r, ...patch } : r),
    "复盘更新保存失败，请稍后重试",
  );
}

function updateManualReviewStatus(
  id: string,
  targetStatus: "pending" | "deferred",
): VideoReview {
  const all = readJSON<VideoReview[]>(KEY_VIDEO_REVIEWS, []);
  const review = all.find(item => item.id === id);
  if (!review) throw new Error("没有找到需要更新的复盘");
  const updated = transitionManualReviewStatus(
    review,
    targetStatus,
    new Date().toISOString(),
  );
  writeVideoReviewsStrict(all.map(item => item.id === id ? updated : item));
  return updated;
}

export function deferVideoReview(id: string): VideoReview {
  return updateManualReviewStatus(id, "deferred");
}

export function restoreVideoReview(id: string): VideoReview {
  return updateManualReviewStatus(id, "pending");
}

export function completeVideoReview(
  id: string,
  input: CompleteManualReviewInput,
): VideoReview {
  const all = readJSON<VideoReview[]>(KEY_VIDEO_REVIEWS, []);
  const review = all.find(item => item.id === id);
  if (!review) throw new Error("没有找到需要完成的复盘");
  const completed = completeManualReview(
    review,
    input,
    new Date().toISOString(),
  );
  writeVideoReviewsStrict(all.map(item => item.id === id ? completed : item));
  return completed;
}

export function deleteVideoReview(id: string): void {
  const all = readJSON<VideoReview[]>(KEY_VIDEO_REVIEWS, []);
  const review = all.find(item => item.id === id);
  if (!review || review.sourceType !== "flowpilot") {
    writeVideoReviewsStrict(all.filter(r => r.id !== id));
    return;
  }
  let knowledgeEntries: KnowledgeEntry[];
  try {
    knowledgeEntries = readKnowledgeEntriesStrict().map(migrateKnowledgeEntry);
  } catch {
    throw new Error("知识关联清理失败，复盘未删除");
  }
  const hasLinkedKnowledge = knowledgeEntries.some(entry =>
    entry.usageRecords.some(record => record.reviewId === review.id)
  );
  if (!hasLinkedKnowledge) {
    writeVideoReviewsStrict(all.filter(r => r.id !== id));
    return;
  }
  const unlinkedEntries = knowledgeEntries.map(entry => ({
      ...entry,
      usageRecords: entry.usageRecords.map(record =>
        record.reviewId === review.id
          ? { ...record, reviewId: null }
          : record
      ),
    }));
  writeKnowledgeEntriesStrict(
    unlinkedEntries,
    "知识关联清理失败，复盘未删除",
  );
  try {
    writeVideoReviewsStrict(all.filter(r => r.id !== id));
  } catch (error) {
    writeKnowledgeEntriesStrict(
      knowledgeEntries,
      "复盘删除失败，知识关联恢复失败",
    );
    throw error;
  }
}

function getValidatedReviewKnowledgeContext(reviewId: string): {
  all: VideoReview[];
  review: VideoReview;
} {
  const all = readJSON<VideoReview[]>(KEY_VIDEO_REVIEWS, []);
  const storedReview = all.find(item => item.id === reviewId);
  if (!storedReview) throw new Error("没有找到需要关联的复盘");
  const review = migrateManualReviewFields(storedReview);
  const script = review.ipId && review.scriptId
    ? getScriptAssets(review.ipId).find(item => item.id === review.scriptId)
    : null;
  const topic = review.topicId ? getTopicAsset(review.topicId) : null;
  if (
    review.sourceType !== "flowpilot" ||
    review.traceabilityStatus !== "traceable" ||
    !review.ipId ||
    !script ||
    !topic ||
    script.ipId !== review.ipId ||
    topic.ipId !== review.ipId ||
    script.topicId !== topic.id
  ) {
    throw new Error("只有可追溯复盘才能进入学习知识库");
  }
  if (review.manualReviewStatus !== "completed") {
    throw new Error("只有已完成人工复盘的内部内容才能进入学习知识库");
  }
  return { all, review };
}

// 标记某条复盘的经验已保存进知识库（方法论分类）
export function markReviewSavedToKnowledge(reviewId: string, knowledgeEntryId: string): void {
  const { all, review } = getValidatedReviewKnowledgeContext(reviewId);
  const knowledge = getKnowledgeEntries().find(item => item.id === knowledgeEntryId);
  if (!knowledge) throw new Error("没有找到需要关联的知识条目");
  if (knowledge.ipId !== review.ipId) {
    throw new Error("复盘与知识条目不属于同一IP");
  }
  writeVideoReviewsStrict(
    all.map(r => r.id === reviewId ? { ...r, savedToKnowledge: true, knowledgeEntryId } : r),
    "知识库标记保存失败，请稍后重试",
  );
}

export function saveReviewExperienceToKnowledge(
  reviewId: string,
  input: Omit<KnowledgeEntry, "id" | "createdAt">,
): KnowledgeEntry {
  const { review } = getValidatedReviewKnowledgeContext(reviewId);
  const allKnowledge = readKnowledgeEntriesStrict();
  if (review.savedToKnowledge) {
    const existing = review.knowledgeEntryId
      ? allKnowledge.find(item => item.id === review.knowledgeEntryId)
      : null;
    if (
      !existing ||
      existing.category !== "复盘经验库" ||
      existing.ipId !== review.ipId
    ) {
      throw new Error("复盘已有知识标记，但原关联数据不完整，请前往知识库检查");
    }
    return migrateKnowledgeEntry(existing);
  }
  if (input.category !== "复盘经验库" || input.ipId !== review.ipId) {
    throw new Error("复盘经验知识的分类或IP归属不正确");
  }
  const knowledgeId = `review-experience:${reviewId}`;
  const residualKnowledge = allKnowledge.find(item => item.id === knowledgeId);
  if (
    residualKnowledge &&
    (
      residualKnowledge.category !== input.category ||
      residualKnowledge.ipId !== input.ipId ||
      residualKnowledge.title !== input.title ||
      residualKnowledge.rawContent !== input.rawContent
    )
  ) {
    throw new Error("复盘存在同编号知识，但内容或归属不一致，已拒绝重复保存");
  }
  let persistedKnowledge = residualKnowledge;
  if (!persistedKnowledge) {
    const knowledge: KnowledgeEntry = {
      ...input,
      id: knowledgeId,
      createdAt: new Date().toISOString(),
    };
    writeKnowledgeEntriesStrict(
      [...allKnowledge, knowledge],
      "知识条目保存失败，请稍后重试",
    );
    persistedKnowledge = readKnowledgeEntriesStrict()
      .find(item => item.id === knowledge.id);
    if (!persistedKnowledge) {
      throw new Error("知识条目保存失败，请稍后重试");
    }
  }
  try {
    markReviewSavedToKnowledge(reviewId, persistedKnowledge.id);
  } catch (associationError) {
    try {
      const current = readKnowledgeEntriesStrict();
      writeKnowledgeEntriesStrict(
        current.filter(item => item.id !== persistedKnowledge.id),
        "知识回滚失败",
      );
    } catch {
      throw new Error("关联失败且知识回滚失败，可能存在待清理知识，请前往知识库检查");
    }
    throw associationError;
  }
  return migrateKnowledgeEntry(persistedKnowledge);
}

// ── 用户人格：从评论聚类生成，保存至评论需求库KnowledgeEntry，额外维护独立列表供选题董事会调用 ──
const KEY_USER_PERSONAS = "ipwr:userPersonas";

import { CommentPersonaResult, UserPersona } from "./types";

export function getUserPersonas(ipId?: string): CommentPersonaResult[] {
  const all = readJSON<CommentPersonaResult[]>(KEY_USER_PERSONAS, []);
  return ipId ? all.filter(r => r.ipId === ipId) : all;
}

export function savePersonaResult(result: CommentPersonaResult): void {
  const all = readJSON<CommentPersonaResult[]>(KEY_USER_PERSONAS, []);
  writeJSON(KEY_USER_PERSONAS, [result, ...all].slice(0, 20)); // 最多保留20次分析结果
}

// 获取当前IP最新一次分析的用户人格列表（供选题董事会调用）
export function getLatestPersonas(ipId: string): UserPersona[] {
  const results = getUserPersonas(ipId);
  if (results.length === 0) return [];
  return results[0].personas; // 最新一次的人格列表
}

// 只返回明确全局或属于当前IP的封面参考；归属不明确的数据不进入统计。
function requireCoverActiveIPId(activeIPId: string | null | undefined): string {
  const normalized = activeIPId?.trim();
  if (!normalized) throw new Error("必须明确提供当前IP ID");
  return normalized;
}

function writeCoverRefs(refs: CoverRef[]): void {
  if (typeof window === "undefined") {
    throw new Error("封面参考保存失败：当前环境无法访问浏览器存储");
  }
  try {
    window.localStorage.setItem(KEY_COVER_REFS, JSON.stringify(refs));
  } catch {
    throw new Error("封面参考保存失败，请检查浏览器存储空间");
  }
}

const COVER_REF_STRING_FIELDS = [
  "id",
  "title",
  "imageDataUrl",
  "platform",
  "contentType",
  "coverType",
  "textStyle",
  "layout",
  "colorStyle",
  "referenceReason",
  "avoidReason",
  "sourceUrl",
  "createdAt",
  "updatedAt",
] as const;

function isCoverRef(value: unknown): value is CoverRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!COVER_REF_STRING_FIELDS.every(field => typeof record[field] === "string")) return false;
  if (record.id === "" || record.title === "") return false;
  if (
    "imageKey" in record
    && (typeof record.imageKey !== "string" || record.imageKey.trim() === "")
  ) {
    return false;
  }
  if (record.imageDataUrl === "" && typeof record.imageKey !== "string") return false;
  if (Number.isNaN(Date.parse(record.createdAt as string)) || Number.isNaN(Date.parse(record.updatedAt as string))) {
    return false;
  }
  if (!Array.isArray(record.visualTags) || !record.visualTags.every(tag => typeof tag === "string")) {
    return false;
  }
  if (record.scope === "global") return record.ipId === null;
  if (record.scope === "ip") return typeof record.ipId === "string" && record.ipId.trim() !== "";
  return false;
}

function readCoverRefsStrict(): CoverRef[] {
  if (typeof window === "undefined") {
    throw new CoverRefStoreError("COVER_REF_STORAGE_READ_FAILED", "封面参考读取失败：当前环境无法访问浏览器存储");
  }
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY_COVER_REFS);
  } catch {
    throw new CoverRefStoreError("COVER_REF_STORAGE_READ_FAILED", "封面参考读取失败，请检查浏览器存储权限");
  }
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("封面存储内容不是有效记录数组");
    }
    const invalidIndex = parsed.findIndex(item => !isCoverRef(item));
    if (invalidIndex !== -1) {
      throw new CoverRefStoreError(
        "COVER_REF_DATA_CORRUPTED",
        `封面参考读取失败：第${invalidIndex + 1}项不是有效封面记录`,
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof CoverRefStoreError) throw error;
    throw new CoverRefStoreError("COVER_REF_DATA_CORRUPTED", "封面参考读取失败：存储数据损坏");
  }
}

export function getGlobalCoverRefs(): CoverRef[] {
  return readCoverRefsStrict()
    .filter(ref => ref.scope === "global" && ref.ipId === null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getCoverRefs(activeIPId: string | null = null): CoverRef[] {
  const normalizedActiveIPId = activeIPId?.trim();
  if (!normalizedActiveIPId) return [];
  return readCoverRefsStrict()
    .filter((ref) => (
      (ref.scope === "global" && ref.ipId === null)
      || (ref.scope === "ip" && ref.ipId === normalizedActiveIPId)
    ))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addCoverRef(
  activeIPId: string,
  input: Omit<CoverRef, "id" | "scope" | "ipId" | "createdAt" | "updatedAt">,
): CoverRef {
  const normalizedActiveIPId = requireCoverActiveIPId(activeIPId);
  const now = new Date().toISOString();
  const entry: CoverRef = {
    ...input,
    id: genId(),
    scope: "ip",
    ipId: normalizedActiveIPId,
    createdAt: now,
    updatedAt: now,
  };
  const all = readCoverRefsStrict();
  if (all.some(ref => ref.id === entry.id)) {
    throw new Error("存在重复封面ID，已拒绝新增");
  }
  writeCoverRefs([entry, ...all]);
  return entry;
}

export function deleteCoverRef(id: string, activeIPId: string): CoverRef {
  const normalizedActiveIPId = requireCoverActiveIPId(activeIPId);
  const all = readCoverRefsStrict();
  const matches = all.filter(cover => cover.id === id);
  if (matches.length === 0) throw new Error("没有找到该封面");
  if (matches.some(cover => cover.scope !== "ip" || cover.ipId !== normalizedActiveIPId)) {
    throw new Error("该封面不属于当前IP，已拒绝删除");
  }
  if (matches.length !== 1) {
    throw new Error("存在重复封面ID，已拒绝删除");
  }
  const [target] = matches;
  writeCoverRefs(all.filter(c => c.id !== id));
  return target;
}
