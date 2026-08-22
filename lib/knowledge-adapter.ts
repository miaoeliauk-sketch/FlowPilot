/**
 * lib/knowledge-adapter.ts
 *
 * 统一知识模型适配层（V2重构）
 *
 * 设计原则：
 * 1. 不改动任何 localStorage 数据——旧数据原封不动
 * 2. 只在读取时做逻辑转换：KnowledgeEntry → KnowledgeItem
 * 3. 写入时也做反向转换：KnowledgeItem → KnowledgeEntry
 * 4. 旧接口（/api/knowledge-search 等）继续工作，不受影响
 * 5. 新接口（/api/knowledge/search 等）通过本层操作
 */

import {
  KnowledgeEntry, KnowledgeItem, KnowledgeItemType, KnowledgeItemScene,
  CATEGORY_TO_TYPE, CATEGORY_TO_SCENE, KnowledgeUsageRecord,
} from "./types";
import {
  getKnowledgeEntries, getAllIPs, addKnowledgeEntry as legacyAdd,
  deleteKnowledgeEntry, updateKnowledgeEntry,
} from "./ip-store";
import { searchKnowledgeEntries } from "./knowledge-search-utils";

// ── 转换函数 ──

/** 旧 KnowledgeEntry → 新 KnowledgeItem（纯转换，不写存储） */
export function entryToItem(entry: KnowledgeEntry): KnowledgeItem {
  const type: KnowledgeItemType = CATEGORY_TO_TYPE[entry.category] ?? "method";
  const scene: KnowledgeItemScene[] = CATEGORY_TO_SCENE[entry.category] ?? ["idea"];

  return {
    id: entry.id,
    type,
    scene,
    title: entry.title,
    content: entry.rawContent,
    tags: entry.tags,
    keywords: entry.keywords,
    ipId: entry.ipId ?? null,
    sourceTier: entry.sourceTier as "高" | "中" | "低",
    sourceTierReason: entry.sourceTierReason,
    createdAt: entry.createdAt ?? entry.extractedAt,

    // 引用追踪——从现有 usageRecords 统计
    usageCount: entry.usageRecords?.length ?? 0,
    lastUsedAt: entry.usageRecords?.length
      ? entry.usageRecords.reduce((latest, r) => r.usedAt > latest ? r.usedAt : latest, "")
      : null,
    usedByModules: [...new Set(entry.usageRecords?.map(r => r.module) ?? [])],

    // 溯源
    legacyCategory: entry.category,
    legacyId: entry.id,

    // 可选指标（仅 case 类型有）
    metrics: entry.metrics ? {
      likes: (entry.metrics as unknown as Record<string, number>).likes ?? undefined,
      views: (entry.metrics as unknown as Record<string, number>).views ?? undefined,
      comments: (entry.metrics as unknown as Record<string, number>).comments ?? undefined,
    } : null,
  };
}

/** 新 KnowledgeItem → 旧 KnowledgeEntry 格式（用于写入） */
export function itemToEntryInput(item: Omit<KnowledgeItem, "id" | "createdAt" | "usageCount" | "lastUsedAt" | "usedByModules">): Omit<KnowledgeEntry, "id" | "createdAt"> {
  // 反向映射 type → category（取第一个匹配的旧分类）
  const categoryMap: Record<string, string> = {
    source:  "IP原始内容",
    case:    "爆款案例",
    method:  "方法论",
    hook:    "Hook",
    insight: "评论需求",
    script:  "方法论",     // script类型没有独立旧分类，映射到方法论
    persona: "IP语料库",
  };

  return {
    category: (item.legacyCategory || categoryMap[item.type] || "方法论") as KnowledgeEntry["category"],
    title: item.title,
    rawContent: item.content,
    tags: item.tags,
    keywords: item.keywords,
    ipId: item.ipId,
    sourceTier: item.sourceTier as KnowledgeEntry["sourceTier"],
    sourceTierReason: item.sourceTierReason,
    contentDirection: [],
    sourcePlatform: "",
    sourceUrl: "",
    note: "",
    extractedAt: new Date().toISOString(),
    metrics: null, // metrics不通过adapter写入，避免ViralMetrics类型冲突
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
  };
}

// ── 查询函数 ──

/** 获取所有知识条目（转换为 KnowledgeItem 格式） */
export function getAllKnowledgeItems(ipId?: string): KnowledgeItem[] {
  // 不按分类逐个取——直接取全库。旧的按分类遍历方式会漏掉
  // 新分类体系（选题方法库/IP人设资料等）下存储的条目。
  const entries: KnowledgeEntry[] = getKnowledgeEntries();
  const filtered = ipId ? entries.filter(e => !e.ipId || e.ipId === ipId) : entries;
  return filtered
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .map(entryToItem);
}

/**
 * 按 type / scene / ipId / 关键词 过滤知识条目
 * 全库检索后再过滤，不再依赖分类Tab
 */
export function filterKnowledgeItems(options: {
  types?: KnowledgeItemType[];
  scenes?: KnowledgeItemScene[];
  ipId?: string;
  keyword?: string;
  limit?: number;
}): KnowledgeItem[] {
  let items = getAllKnowledgeItems(options.ipId);

  if (options.types && options.types.length > 0) {
    items = items.filter(item => options.types!.includes(item.type));
  }

  if (options.scenes && options.scenes.length > 0) {
    items = items.filter(item =>
      item.scene.some(s => options.scenes!.includes(s))
    );
  }

  if (options.keyword?.trim()) {
    const kw = options.keyword.trim().toLowerCase();
    const matches = searchKnowledgeEntries(kw, items.map(item => ({
      id: item.id,
      title: item.title,
      category: item.legacyCategory,
      normalizedCategory: item.type,
      tags: item.tags,
      keywords: item.keywords,
      content: item.content,
      summary: item.sourceTierReason,
      metadata: { type: item.type, scene: item.scene, sourceTier: item.sourceTier },
    })), { limit: items.length || 1, minScore: 2 });
    const ids = new Set(matches.results.map(match => match.id));
    items = items.filter(item => ids.has(item.id));
  }

  if (options.limit) {
    items = items.slice(0, options.limit);
  }

  return items;
}

/** 按ID获取单个知识条目（支持新旧ID，因为legacyId === id） */
export function getKnowledgeItemById(id: string): KnowledgeItem | null {
  const all = getAllKnowledgeItems();
  return all.find(item => item.id === id) ?? null;
}

/** 创建新知识条目（通过adapter写入旧存储） */
export function createKnowledgeItem(
  input: Omit<KnowledgeItem, "id" | "createdAt" | "usageCount" | "lastUsedAt" | "usedByModules">
): KnowledgeItem {
  const entryInput = itemToEntryInput(input);
  const saved = legacyAdd(entryInput);
  return entryToItem(saved);
}

/** 记录知识条目被AI引用（写入旧 usageRecords） */
export function recordKnowledgeItemUsage(
  id: string,
  module: string,
  context: string,
): void {
  // 全库查找目标条目——不按分类遍历，避免漏掉新分类体系下的条目
  const entry = getKnowledgeEntries().find(e => e.id === id);
  if (!entry) return;
  const record: KnowledgeUsageRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    module, usedAt: new Date().toISOString(), reason: context,
    relevanceTier: "高度相关", relevanceReason: "unified search match", context,
    trackingStatus: "module_recorded",
    topicId: null,
    scriptId: null,
    reviewId: null,
    usageType: null,
    sectionLabel: null,
    evidenceExcerpt: null,
  };
  updateKnowledgeEntry(id, {
    usageRecords: [...(entry.usageRecords ?? []), record],
    status: "已用于分析" as const,
  });
}

/** 删除知识条目（通过adapter删除旧存储） */
export function deleteKnowledgeItem(id: string): void {
  deleteKnowledgeEntry(id);
}

// ── 统计函数 ──

/** 统计各 type 的数量 */
export function countByType(ipId?: string): Record<KnowledgeItemType, number> {
  const items = getAllKnowledgeItems(ipId);
  const counts: Record<KnowledgeItemType, number> = {
    source: 0, case: 0, method: 0, hook: 0, insight: 0, script: 0, persona: 0,
  };
  for (const item of items) {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
  }
  return counts;
}

/** 统计各 scene 的数量 */
export function countByScene(ipId?: string): Record<KnowledgeItemScene, number> {
  const items = getAllKnowledgeItems(ipId);
  const counts: Record<KnowledgeItemScene, number> = {
    idea: 0, script: 0, analysis: 0, comment: 0, review: 0,
  };
  for (const item of items) {
    for (const scene of item.scene) {
      counts[scene] = (counts[scene] ?? 0) + 1;
    }
  }
  return counts;
}
