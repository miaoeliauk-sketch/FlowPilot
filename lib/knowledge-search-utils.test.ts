import assert from "node:assert/strict";
import test from "node:test";

import {
  SearchableKnowledgeEntry,
  TopicIntentLike,
  searchKnowledgeEntries,
  searchKnowledgeEntriesWithIntent,
} from "./knowledge-search-utils";

const weakEntry: SearchableKnowledgeEntry = {
  id: "weak-tutorial",
  title: "教程结构",
  category: "文案框架方法库",
  normalizedCategory: "文案框架方法库",
  content: "按步骤展开内容",
};

const tutorialIntent: TopicIntentLike = {
  topicType: "教程类",
  audienceGuess: "需要入门指导的新手",
  corePainPoint: "不知道如何开始",
  relevantLibraries: ["文案框架方法库"],
  methodKeywords: ["步骤拆解"],
  reasoning: "需要使用教程结构",
};

test("普通检索会过滤只有弱相关信号的条目", () => {
  const result = searchKnowledgeEntries("教程", [weakEntry]);

  assert.deepEqual(result.results, []);
});

test("弱相关条目命中意图分类后能够被加权选中", () => {
  const result = searchKnowledgeEntriesWithIntent("教程", [weakEntry], tutorialIntent);

  assert.deepEqual(result.results.map(item => item.id), ["weak-tutorial"]);
  assert.equal(result.results[0]?.isStrongReference, true);
  assert.equal(result.debug.fallbackMode, "none");
});

test("没有意图时与普通检索结果一致", () => {
  const entries: SearchableKnowledgeEntry[] = [
    weakEntry,
    {
      id: "strong-title",
      title: "反常识标题公式",
      category: "标题方法库",
      normalizedCategory: "标题方法库",
      content: "先打破直觉，再解释原因",
    },
  ];

  const ordinary = searchKnowledgeEntries("反常识标题公式", entries);
  const withoutIntent = searchKnowledgeEntriesWithIntent("反常识标题公式", entries, null);

  assert.deepEqual(withoutIntent.results, ordinary.results);
});

test("意图关键词完全落空时使用对应方法库的宽泛参考兜底", () => {
  const entries: SearchableKnowledgeEntry[] = [
    {
      id: "broad-b",
      title: "结构模板乙",
      category: "文案框架方法库",
      normalizedCategory: "文案框架方法库",
    },
    {
      id: "broad-a",
      title: "结构模板甲",
      category: "文案框架方法库",
      normalizedCategory: "文案框架方法库",
    },
  ];

  const result = searchKnowledgeEntriesWithIntent(
    "完全无关的主题",
    entries,
    { ...tutorialIntent, methodKeywords: ["未命中的方法词"] },
  );

  assert.equal(result.debug.fallbackMode, "broad-reference");
  assert.deepEqual(result.results.map(item => item.id), ["broad-a", "broad-b"]);
  assert.ok(result.results.every(item => item.relevanceTier === "低度相关"));
});

test("同分结果排序稳定，不受输入顺序影响", () => {
  const entries: SearchableKnowledgeEntry[] = [
    { id: "stable-b", title: "高净值客户乙" },
    { id: "stable-a", title: "高净值客户甲" },
  ];

  const forward = searchKnowledgeEntries("高净值客户", entries);
  const reversed = searchKnowledgeEntries("高净值客户", [...entries].reverse());

  assert.deepEqual(forward.results.map(item => item.id), ["stable-a", "stable-b"]);
  assert.deepEqual(reversed.results.map(item => item.id), ["stable-a", "stable-b"]);
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test("适配层能够检索新分类内容", async () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

  const { addKnowledgeEntry } = await import("./ip-store");
  const { filterKnowledgeItems } = await import("./knowledge-adapter");

  addKnowledgeEntry({
    category: "标题方法库",
    title: "反常识标题公式",
    rawContent: "先打破直觉，再解释底层原因",
    tags: [],
    keywords: ["反常识"],
    ipId: null,
    sourceTier: "高",
    sourceTierReason: "测试新分类检索",
    contentDirection: [],
    sourcePlatform: "测试",
    sourceUrl: "",
    note: "",
    extractedAt: "2026-07-29T00:00:00.000Z",
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
  });

  const result = filterKnowledgeItems({ keyword: "反常识" });

  assert.deepEqual(result.map(item => item.title), ["反常识标题公式"]);
});
