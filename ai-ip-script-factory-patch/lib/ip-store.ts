"use client";
import { IPProfile, VoiceSample, IPStyleProfile, TopicAsset, CommentAsset, ScriptAsset, KnowledgeEntry, KnowledgeCategory, HookEntry, LikesSnapshot, KnowledgeUsageRecord, KnowledgeStatus, ConsumerModule, HotMaterialAnalysis, UserProfile, VideoReview } from "./types";

const KEY_IPS = "ipwr:ips_v2";
const KEY_ACTIVE_IP = "ipwr:activeIpId";
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
const DEFAULT_USER_PROFILE: UserProfile = { nickname: "彭彭", name: "" };

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

const COLORS = ["#7C6EE6", "#5BA4D6", "#E66E8E", "#5BC192", "#C99A1E", "#9B7ED9"];

function genId() { return `${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }

// ── IP 默认种子数据（首次使用时填充，方便用户立刻看到效果） ──
function seedDefaultIPs(): IPProfile[] {
  const now = new Date().toISOString();
  return [
    {
      id: genId(), name: "彭彭说AI", avatar: "彭",
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
      id: genId(), name: "喂鱼", avatar: "喂",
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
  if (ips.length === 0) {
    const seeded = seedDefaultIPs();
    writeJSON(KEY_IPS, seeded);
    return seeded;
  }
  return ips.map(normalizeIP);
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

export function getOrInitActiveIP(): IPProfile {
  const ips = getAllIPs();
  const activeId = getActiveIPId();
  const found = ips.find(ip => ip.id === activeId);
  if (found) return found;
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
  const existing = readJSON<KnowledgeEntry[]>(KEY_KNOWLEDGE_ENTRIES, []);
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

export function saveStyleProfile(profile: IPStyleProfile): void {
  const all = readJSON<IPStyleProfile[]>(KEY_STYLE_PROFILES, []);
  const idx = all.findIndex((p) => p.ipId === profile.ipId);
  if (idx >= 0) all[idx] = profile; else all.push(profile);
  writeJSON(KEY_STYLE_PROFILES, all);
}

export function deleteStyleProfile(ipId: string): void {
  const all = readJSON<IPStyleProfile[]>(KEY_STYLE_PROFILES, []);
  writeJSON(KEY_STYLE_PROFILES, all.filter((p) => p.ipId !== ipId));
}

// ── IP 资产库：选题 ──
export function getTopicAssets(ipId: string): TopicAsset[] {
  const all = readJSON<TopicAsset[]>(KEY_TOPIC_ASSETS, []);
  return all.filter(a => a.ipId === ipId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addTopicAsset(input: Omit<TopicAsset, "id" | "createdAt">): TopicAsset {
  const all = readJSON<TopicAsset[]>(KEY_TOPIC_ASSETS, []);
  const asset: TopicAsset = { ...input, id: genId(), createdAt: new Date().toISOString() };
  writeJSON(KEY_TOPIC_ASSETS, [...all, asset]);
  return asset;
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
export function getScriptAssets(ipId: string): ScriptAsset[] {
  const all = readJSON<ScriptAsset[]>(KEY_SCRIPT_ASSETS, []);
  return all.filter(a => a.ipId === ipId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addScriptAsset(input: Omit<ScriptAsset, "id" | "createdAt">): ScriptAsset {
  const all = readJSON<ScriptAsset[]>(KEY_SCRIPT_ASSETS, []);
  const asset: ScriptAsset = { ...input, id: genId(), createdAt: new Date().toISOString() };
  writeJSON(KEY_SCRIPT_ASSETS, [...all, asset]);
  return asset;
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
    usageRecords: e.usageRecords ?? [],
    status: e.status ?? "未使用",
    dna: e.dna ?? null,
  };
}

export function getKnowledgeEntries(category?: KnowledgeCategory): KnowledgeEntry[] {
  const all = readJSON<KnowledgeEntry[]>(KEY_KNOWLEDGE_ENTRIES, []).map(migrateKnowledgeEntry);
  const filtered = category ? all.filter((e) => e.category === category) : all;
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addKnowledgeEntry(input: Omit<KnowledgeEntry, "id" | "createdAt">): KnowledgeEntry {
  const all = readJSON<KnowledgeEntry[]>(KEY_KNOWLEDGE_ENTRIES, []);
  const entry: KnowledgeEntry = { ...input, id: genId(), createdAt: new Date().toISOString() };
  writeJSON(KEY_KNOWLEDGE_ENTRIES, [...all, entry]);
  return entry;
}

export function updateKnowledgeEntry(id: string, patch: Partial<KnowledgeEntry>): void {
  const all = readJSON<KnowledgeEntry[]>(KEY_KNOWLEDGE_ENTRIES, []);
  writeJSON(KEY_KNOWLEDGE_ENTRIES, all.map((e) => (e.id === id ? { ...e, ...patch } : e)));
}

export function deleteKnowledgeEntry(id: string): void {
  const all = readJSON<KnowledgeEntry[]>(KEY_KNOWLEDGE_ENTRIES, []);
  writeJSON(KEY_KNOWLEDGE_ENTRIES, all.filter((e) => e.id !== id));
}

// 记录一次知识被某个模块引用——"被哪些模块调用"和"调用次数"都从usageRecords派生，
// 不单独维护计数字段，避免两边数字对不上。newStatus可选：只有真正进入下一阶段时才推进状态，
// 单纯被检索到、还没被实际采用，不强制变更status。
export function recordKnowledgeUsage(entryId: string, usage: Omit<KnowledgeUsageRecord, "id">, newStatus?: KnowledgeStatus): void {
  const all = readJSON<KnowledgeEntry[]>(KEY_KNOWLEDGE_ENTRIES, []).map(migrateKnowledgeEntry);
  writeJSON(KEY_KNOWLEDGE_ENTRIES, all.map((e) => {
    if (e.id !== entryId) return e;
    const record: KnowledgeUsageRecord = { ...usage, id: genId() };
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
export function getVideoReviews(ipId?: string): VideoReview[] {
  const all = readJSON<VideoReview[]>(KEY_VIDEO_REVIEWS, []);
  const filtered = ipId ? all.filter(r => r.ipId === ipId) : all;
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addVideoReview(input: Omit<VideoReview, "id" | "createdAt" | "savedToKnowledge" | "knowledgeEntryId">): VideoReview {
  const all = readJSON<VideoReview[]>(KEY_VIDEO_REVIEWS, []);
  const review: VideoReview = { ...input, id: genId(), createdAt: new Date().toISOString(), savedToKnowledge: false, knowledgeEntryId: null };
  writeJSON(KEY_VIDEO_REVIEWS, [...all, review]);
  return review;
}

export function updateVideoReview(id: string, patch: Partial<VideoReview>): void {
  const all = readJSON<VideoReview[]>(KEY_VIDEO_REVIEWS, []);
  writeJSON(KEY_VIDEO_REVIEWS, all.map(r => r.id === id ? { ...r, ...patch } : r));
}

export function deleteVideoReview(id: string): void {
  const all = readJSON<VideoReview[]>(KEY_VIDEO_REVIEWS, []);
  writeJSON(KEY_VIDEO_REVIEWS, all.filter(r => r.id !== id));
}

// 标记某条复盘的经验已保存进知识库（方法论分类）
export function markReviewSavedToKnowledge(reviewId: string, knowledgeEntryId: string): void {
  const all = readJSON<VideoReview[]>(KEY_VIDEO_REVIEWS, []);
  writeJSON(KEY_VIDEO_REVIEWS, all.map(r => r.id === reviewId ? { ...r, savedToKnowledge: true, knowledgeEntryId } : r));
}
