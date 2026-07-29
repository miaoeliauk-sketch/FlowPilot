export type KnowledgeSearchField =
  | "标题"
  | "标签"
  | "关键词"
  | "正文"
  | "分类"
  | "摘要"
  | "参考原因"
  | "原始数据"
  | "元数据";

export interface SearchableKnowledgeEntry {
  id: string;
  title?: string;
  category?: string;
  normalizedCategory?: string;
  tags?: string[];
  keywords?: string[];
  rawContent?: string;
  content?: string;
  summary?: string;
  referenceReason?: string;
  originalRowData?: unknown;
  metadata?: unknown;
  note?: unknown;
  ipId?: string | null;
}

export interface KnowledgeSearchMatch {
  id: string;
  title: string;
  category: string;
  normalizedCategory: string;
  reason: string;
  relevanceTier: "高度相关" | "中度相关" | "低度相关";
  relevanceReason: string;
  matchScore: number;
  matchedFields: KnowledgeSearchField[];
  matchedKeywords: string[];
  strongMatchedKeywords: string[];
  methodMatches: string[];
  methodAdvice: string;
  isStrongReference: boolean;
}

export interface KnowledgeKeywordDebug {
  queryKeywords: string[];
  expandedKeywords: string[];
  ignoredKeywords: string[];
}

const STOP_WORDS = new Set([
  "为什么", "什么", "怎么", "如何", "喜欢", "真的", "其实", "会不会", "能不能",
  "不是", "一个", "这个", "那个", "用户", "内容", "问题", "方法",
  "为什", "么喜", "喜欢", "欢钻", "这个", "那个", "的是", "有什", "什么样",
]);

const STRONG_KEYWORDS = new Set([
  "高净值客户", "高端客户", "大客户", "VIP客户", "vip客户", "高客单客户", "高消费客户",
  "普通客户", "普通用户", "普通人", "低客单客户", "价格敏感客户",
  "客户区别", "客户差异", "人群差异", "用户分层", "决策差异", "人群分层",
  "决策成本", "信任成本", "服务预期", "价值敏感", "先问价格", "先看信任",
  "人群对比", "行业巨变", "传统模式失效", "新机会", "反常识", "标题公式", "开头钩子",
  "生活现象", "好奇心科普", "动物行为", "宠物科普", "泛科普",
  "装修", "装修痛点", "装修误区", "装修预算", "装修决策", "没有高级感", "高级感",
  "比例关系", "材质关系", "灯光关系", "设计师IP", "设计师价值", "审美判断",
]);

const SYNONYM_GROUPS = [
  ["高净值客户", "高端客户", "大客户", "VIP客户", "vip客户", "高客单客户", "高消费客户"],
  ["普通客户", "普通用户", "普通人", "低客单客户", "价格敏感客户"],
  ["客户区别", "客户差异", "人群差异", "用户分层", "决策差异", "人群分层"],
];

const METHOD_PATTERNS = [
  {
    name: "人群分层选题法",
    triggers: ["普通客户", "高净值客户", "高端客户", "大客户", "VIP客户", "高客单客户", "低客单客户", "价格敏感客户", "用户分层", "人群分层", "人群差异"],
    semantic: ["贵的客户", "贵客户", "便宜客户", "客户层级", "客户分层", "不同客户", "两类客户"],
    requiredAny: ["客户", "人群", "用户", "客单", "高净值", "高端", "大客户", "价格敏感"],
    advice: "当前选题涉及不同人群对比，应比较真实需求、决策逻辑、信任成本和行动阻力。",
  },
  {
    name: "对比型选题法",
    triggers: ["区别", "差异", "对比", "不同", "vs", "VS"],
    semantic: ["反而", "更好", "更难", "更容易", "而是"],
    requiredAny: ["客户", "人群", "用户", "行业", "产品", "价格", "信任", "服务", "新手", "老手"],
    advice: "当前选题适合用对比结构放大讨论点，把表面差异改成底层原因。",
  },
  {
    name: "用户决策差异判断法",
    triggers: ["决策差异", "决策成本", "信任成本", "服务预期", "价格敏感", "价值敏感", "先问价格", "先看信任"],
    semantic: ["好沟通", "不好沟通", "愿意付费", "不愿意付费", "为什么买"],
    requiredAny: ["客户", "用户", "买", "成交", "付费", "价格", "信任", "服务", "沟通"],
    advice: "当前选题应重点解释用户为什么这样决策，而不是只描述谁更有钱。",
  },
  {
    name: "服务型IP选题法",
    triggers: ["客户", "服务", "成交", "转化", "客单", "信任", "咨询"],
    semantic: ["沟通", "报价", "交付", "服务预期", "客户质量"],
    requiredAny: ["客户", "服务", "成交", "转化", "客单", "咨询", "报价", "交付"],
    advice: "当前选题适合结合服务交付、信任建立和成交阻力来优化角度。",
  },
  {
    name: "装修痛点选题法",
    triggers: ["装修花很多钱", "没有高级感", "装修踩坑", "预算浪费", "装修效果差", "装修痛点"],
    semantic: ["钱花错地方", "高投入低回报", "装修误区", "效果不好"],
    requiredAny: ["装修", "高级感", "预算", "设计"],
    advice: "当前选题应锁定装修投入与结果之间的落差，并把宽泛抱怨拆成具体原因。",
  },
  {
    name: "高级感拆解法",
    triggers: ["高级感", "质感", "廉价感", "空间比例", "材质搭配", "灯光设计"],
    semantic: ["比例关系", "材质关系", "灯光关系", "整体关系"],
    requiredAny: ["高级感", "质感", "装修", "设计", "空间"],
    advice: "当前选题应把抽象的高级感拆成比例、材质、灯光等可观察、可判断的维度。",
  },
  {
    name: "反常识开头法",
    triggers: ["很多人以为", "不是越贵越好", "花钱多不等于效果好", "反常识", "误区"],
    semantic: ["其实", "真正决定", "恰恰相反", "不是单品贵"],
    requiredAny: ["装修", "高级感", "预算", "设计", "误区"],
    advice: "当前选题适合先指出与用户直觉相反的判断，再用具体设计关系承接。",
  },
  {
    name: "设计师IP价值表达法",
    triggers: ["设计师IP", "设计师价值", "装修决策", "审美判断", "居住体验"],
    semantic: ["专业判断", "为什么请设计师", "长期居住", "服务价值"],
    requiredAny: ["设计师", "装修", "设计", "业主", "高级感"],
    advice: "当前选题应把设计师的专业能力表达为业主能理解的判断标准和决策帮助。",
  },
];

function normalizeText(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input.toLowerCase();
  try {
    return JSON.stringify(input).toLowerCase();
  } catch {
    return String(input).toLowerCase();
  }
}

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map(t => t.trim()).filter(t => t.length >= 2)));
}

function isStopWord(token: string): boolean {
  const normalized = token.trim().toLowerCase();
  if (STOP_WORDS.has(normalized)) return true;
  if (/^[的了呢吗啊吧呀么]$/.test(normalized)) return true;
  return false;
}

function isStrongKeyword(token: string): boolean {
  const normalized = token.trim();
  if (STRONG_KEYWORDS.has(normalized)) return true;
  return SYNONYM_GROUPS.some(group => group.includes(normalized));
}

export function buildKnowledgeSearchKeywords(query: string): KnowledgeKeywordDebug {
  const normalized = compactText(query).toLowerCase();
  const baseOriginal = normalized
    .replace(/[，。！？、：；,.!?:"'《》【】（）()\-_/\\|]/g, " ")
    .split(/\s+/)
    .flatMap(part => {
      if (!part) return [] as string[];
      const tokens: string[] = [part];
      // 先按"连续中文段 / 连续非中文段"切开，双字滑窗只在纯中文段内做，
      // 避免产出 "用c" "ch" "gp" 这类跨边界废字符对
      const runs = part.match(/[\u4e00-\u9fa5]+|[^\u4e00-\u9fa5]+/g) ?? [];
      for (const run of runs) {
        if (/^[\u4e00-\u9fa5]+$/.test(run)) {
          if (run.length >= 2 && run !== part) tokens.push(run);
          if (run.length > 2) {
            for (let i = 0; i <= run.length - 2; i++) tokens.push(run.slice(i, i + 2));
          }
        } else if (run.length >= 2 && run !== part) {
          tokens.push(run);   // 英文/数字段整体保留（如 chatgpt），不切碎
        }
      }
      return tokens;
    });
  const expanded = [...baseOriginal];

  for (const group of SYNONYM_GROUPS) {
    if (group.some(word => normalized.includes(word.toLowerCase()))) {
      expanded.push(...group);
    }
  }

  if (normalized.includes("高净值") || normalized.includes("高端") || normalized.includes("大客户")) {
    expanded.push("高净值客户", "高端客户", "大客户", "高客单客户", "高消费客户");
  }
  if (normalized.includes("普通客户") || normalized.includes("普通用户") || normalized.includes("普通人")) {
    expanded.push("普通客户", "普通用户", "普通人", "低客单客户", "价格敏感客户");
  }
  if (normalized.includes("区别") || normalized.includes("差异") || normalized.includes("分层")) {
    expanded.push("客户区别", "客户差异", "人群差异", "用户分层", "决策差异", "人群分层");
  }
  if (normalized.includes("客户") && (normalized.includes("区别") || normalized.includes("差异"))) {
    expanded.push("普通客户", "高净值客户", "普通用户", "高端客户");
  }
  if (normalized.includes("贵") && normalized.includes("客户")) {
    expanded.push("高净值客户", "高端客户", "高客单客户", "高消费客户", "客户分层", "信任成本", "服务预期");
  }
  if (normalized.includes("好沟通") || normalized.includes("更好沟通")) {
    expanded.push("决策成本", "信任成本", "服务预期", "客户差异", "高客单客户");
  }

  const rawQueryKeywords = unique(baseOriginal);
  const ignoredKeywords = rawQueryKeywords.filter(isStopWord);
  const queryKeywords = rawQueryKeywords.filter(t => !isStopWord(t)).slice(0, 32);
  const expandedKeywords = unique(expanded.filter(t => !queryKeywords.includes(t) && !isStopWord(t))).slice(0, 48);
  return { queryKeywords, expandedKeywords, ignoredKeywords };
}

function detectMethodMatches(query: string, keywords: string[]) {
  const text = `${query} ${keywords.join(" ")}`.toLowerCase();
  return METHOD_PATTERNS.filter(method =>
    method.requiredAny.some(word => text.includes(word.toLowerCase())) &&
    [...method.triggers, ...method.semantic].some(word => text.includes(word.toLowerCase()))
  );
}

function entryFields(entry: SearchableKnowledgeEntry): Record<KnowledgeSearchField, string> {
  return {
    "标题": normalizeText(entry.title),
    "标签": normalizeText(entry.tags ?? []),
    "关键词": normalizeText(entry.keywords ?? []),
    "正文": normalizeText(entry.rawContent ?? entry.content ?? ""),
    "分类": normalizeText(`${entry.category ?? ""} ${entry.normalizedCategory ?? ""}`),
    "摘要": normalizeText(entry.summary),
    "参考原因": normalizeText(entry.referenceReason),
    "原始数据": normalizeText(entry.originalRowData),
    "元数据": normalizeText(`${normalizeText(entry.metadata)} ${normalizeText(entry.note)}`),
  };
}

function scoreKnowledgeEntries(
  query: string,
  entries: SearchableKnowledgeEntry[],
): { results: KnowledgeSearchMatch[]; debug: KnowledgeKeywordDebug } {
  const debug = buildKnowledgeSearchKeywords(query);
  const keywords = unique([...debug.queryKeywords, ...debug.expandedKeywords]);
  const queryMethodMatches = detectMethodMatches(query, keywords);

  const results = entries
    .map(entry => {
      const fields = entryFields(entry);
      const matchedFields: KnowledgeSearchField[] = [];
      const matchedKeywords: string[] = [];
      const strongMatchedKeywords: string[] = [];
      const methodMatches: string[] = [];
      let score = 0;

      for (const keyword of keywords) {
        if (isStopWord(keyword)) continue;
        let hitThisKeyword = false;
        for (const [field, value] of Object.entries(fields) as [KnowledgeSearchField, string][]) {
          if (!value || !value.includes(keyword.toLowerCase())) continue;
          if (!matchedFields.includes(field)) matchedFields.push(field);
          hitThisKeyword = true;
          if (field === "标题") score += 4;
          else if (field === "标签" || field === "关键词" || field === "分类") score += 3;
          else if (field === "正文" || field === "摘要") score += 2;
          else score += 1;
        }
        if (hitThisKeyword) matchedKeywords.push(keyword);
        if (hitThisKeyword && isStrongKeyword(keyword)) strongMatchedKeywords.push(keyword);
      }

      if (matchedKeywords.includes("普通客户") && matchedKeywords.includes("高净值客户")) score += 5;
      if (matchedKeywords.some(k => ["客户区别", "客户差异", "人群差异", "用户分层", "决策差异", "人群分层"].includes(k))) score += 3;
      for (const method of queryMethodMatches) {
        const methodText = `${method.name} ${method.triggers.join(" ")} ${method.semantic.join(" ")}`.toLowerCase();
        const entryText = Object.values(fields).join(" ");
        if (entryText.includes(method.name.toLowerCase()) || method.triggers.some(t => entryText.includes(t.toLowerCase())) || method.semantic.some(t => entryText.includes(t.toLowerCase()))) {
          methodMatches.push(method.name);
          score += 6;
        }
        if (methodText && matchedKeywords.some(k => methodText.includes(k.toLowerCase()))) score += 1;
      }

      const hasStrongSignal = strongMatchedKeywords.length > 0 || methodMatches.length > 0;
      const relevanceTier = hasStrongSignal && score >= 12 ? "高度相关" : hasStrongSignal && score >= 8 ? "中度相关" : "低度相关";
      const fieldText = matchedFields.join("、") || "无";
      const keywordText = unique(matchedKeywords).slice(0, 8).join("、") || "无";
      const isStrongReference = hasStrongSignal && score >= 8;

      return {
        id: entry.id,
        title: entry.title || "未命名知识",
        category: entry.category || "",
        normalizedCategory: entry.normalizedCategory || entry.category || "",
        reason: `命中字段：${fieldText}；命中关键词：${keywordText}`,
        relevanceTier,
        relevanceReason: isStrongReference
          ? (score >= 12 ? "命中强关键词或明确方法场景，和本次选题高度相关" : "命中强关键词或方法场景，可作为候选参考")
          : "只命中泛词或弱相关表达，未达到正式参考门槛",
        matchScore: score,
        matchedFields,
        matchedKeywords: unique(matchedKeywords),
        strongMatchedKeywords: unique(strongMatchedKeywords),
        methodMatches: unique(methodMatches),
        methodAdvice: unique(methodMatches).length > 0
          ? queryMethodMatches.filter(m => methodMatches.includes(m.name)).map(m => m.advice).join(" ")
          : "",
        isStrongReference,
      } satisfies KnowledgeSearchMatch;
    })
    .sort((a, b) => b.matchScore - a.matchScore || a.id.localeCompare(b.id));

  return { results, debug };
}

export function searchKnowledgeEntries(
  query: string,
  entries: SearchableKnowledgeEntry[],
  options: { limit?: number; minScore?: number } = {},
): { results: KnowledgeSearchMatch[]; debug: KnowledgeKeywordDebug } {
  const scored = scoreKnowledgeEntries(query, entries);
  const results = scored.results
    .filter(item => item.matchScore >= (options.minScore ?? 2) && item.isStrongReference)
    .slice(0, options.limit ?? 8);

  return { results, debug: scored.debug };
}

// ══════════════════════════════════════════════════════════════
// Plan B · 意图感知检索
// 在字面检索之上叠加「方法论意图」加权：
//   1. 方法卡分类命中 intent.relevantLibraries → 大幅加分
//   2. intent.methodKeywords 命中方法卡字段 → 按字段加分
//   3. 有意图信号时放宽 isStrongReference 门槛（字面强词缺席不再一票否决）
//   4. 全部落空时兜底：返回意图相关分类下的头部方法卡，标记为"宽泛参考"
// ══════════════════════════════════════════════════════════════

export interface TopicIntentLike {
  topicType: string;
  audienceGuess: string;
  corePainPoint: string;
  relevantLibraries: string[];
  methodKeywords: string[];
  reasoning: string;
}

export interface IntentSearchDebug extends KnowledgeKeywordDebug {
  intentUsed: boolean;
  topicType?: string;
  intentLibraries?: string[];
  intentKeywords?: string[];
  intentReasoning?: string;
  fallbackMode?: "none" | "broad-reference";
}

export function searchKnowledgeEntriesWithIntent(
  query: string,
  entries: SearchableKnowledgeEntry[],
  intent: TopicIntentLike | null,
  options: { limit?: number; minScore?: number } = {},
): { results: KnowledgeSearchMatch[]; debug: IntentSearchDebug } {
  const base = scoreKnowledgeEntries(query, entries);
  const limit = options.limit ?? 8;

  // 没拿到意图（AI失败/没key）→ 原样降级为字面检索
  if (!intent) {
    const results = base.results
      .filter(r => r.isStrongReference && r.matchScore >= (options.minScore ?? 2))
      .slice(0, limit);
    return { results, debug: { ...base.debug, intentUsed: false, fallbackMode: "none" } };
  }

  const intentLibrarySet = new Set(intent.relevantLibraries);
  const intentKeywords = intent.methodKeywords.map(k => k.toLowerCase());

  // 需要重算：意图加权要访问原始 entry 字段
  const entryById = new Map(entries.map(e => [e.id, e]));

  const boosted = base.results.map(match => {
    const entry = entryById.get(match.id);
    if (!entry) return match;

    let bonus = 0;
    const bonusReasons: string[] = [];

    // ① 方法论关键词命中（标题+4，其余字段+2）
    const titleText = (entry.title ?? "").toLowerCase();
    const bodyText = `${entry.rawContent ?? entry.content ?? ""} ${(entry.tags ?? []).join(" ")} ${(entry.keywords ?? []).join(" ")} ${entry.summary ?? ""}`.toLowerCase();
    const hitKeywords: string[] = [];
    for (const kw of intentKeywords) {
      if (titleText.includes(kw)) { bonus += 4; hitKeywords.push(kw); }
      else if (bodyText.includes(kw)) { bonus += 2; hitKeywords.push(kw); }
    }
    if (hitKeywords.length > 0) bonusReasons.push(`命中方法论关键词：${hitKeywords.slice(0, 5).join("、")}`);

    // ② 分类命中用于放大已有的字面或方法关键词信号。
    // 如果候选和查询、方法关键词都完全无关，则留给下方的宽泛参考兜底，
    // 避免只凭分类就伪装成正式命中。
    const entryCategory = entry.normalizedCategory || entry.category || "";
    if (intentLibrarySet.has(entryCategory) && (match.matchScore > 0 || hitKeywords.length > 0)) {
      bonus += 8;
      bonusReasons.unshift(`分类「${entryCategory}」命中选题类型「${intent.topicType}」应参考的方法库`);
    }

    if (bonus === 0) return match;

    const newScore = match.matchScore + bonus;
    // 有意图信号时，强参考门槛放宽为：意图加分≥8（分类命中）或 总分≥10
    const isStrongReference = match.isStrongReference || bonus >= 8 || newScore >= 10;
    const relevanceTier = newScore >= 16 ? "高度相关" : newScore >= 10 ? "中度相关" : match.relevanceTier;

    return {
      ...match,
      matchScore: newScore,
      isStrongReference,
      relevanceTier,
      reason: `${match.reason}；${bonusReasons.join("；")}`,
      relevanceReason: isStrongReference
        ? `按选题方法论意图（${intent.topicType}）匹配：${bonusReasons[0] ?? "意图加权命中"}`
        : match.relevanceReason,
    } satisfies KnowledgeSearchMatch;
  });

  let results = boosted
    .filter(r => r.isStrongReference && r.matchScore >= (options.minScore ?? 2))
    .sort((a, b) => b.matchScore - a.matchScore || a.id.localeCompare(b.id))
    .slice(0, limit);

  let fallbackMode: "none" | "broad-reference" = "none";

  // ③ 兜底：正常检索全落空，但意图给出了方法库方向 → 取这些库的头部卡作"宽泛参考"
  if (results.length === 0 && intentLibrarySet.size > 0) {
    fallbackMode = "broad-reference";
    results = entries
      .filter(e => intentLibrarySet.has(e.normalizedCategory || e.category || ""))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, 3)
      .map(e => ({
        id: e.id,
        title: e.title || "未命名知识",
        category: e.category || "",
        normalizedCategory: e.normalizedCategory || e.category || "",
        reason: `选题被识别为「${intent.topicType}」，本条来自其应参考的「${e.normalizedCategory || e.category}」`,
        relevanceTier: "低度相关" as const,
        relevanceReason: "未命中具体方法，作为该类选题的宽泛方法参考提供",
        matchScore: 1,
        matchedFields: [] as KnowledgeSearchField[],
        matchedKeywords: [] as string[],
        strongMatchedKeywords: [] as string[],
        methodMatches: [] as string[],
        methodAdvice: "",
        isStrongReference: false,
      } satisfies KnowledgeSearchMatch));
  }

  return {
    results,
    debug: {
      ...base.debug,
      intentUsed: true,
      topicType: intent.topicType,
      intentLibraries: intent.relevantLibraries,
      intentKeywords: intent.methodKeywords,
      intentReasoning: intent.reasoning,
      fallbackMode,
    },
  };
}
