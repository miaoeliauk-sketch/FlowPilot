import assert from "node:assert/strict";
import { after, test } from "node:test";
import { runHotAnalysisKnowledgePrecheck } from "./hot-analysis-knowledge";
import type { KnowledgeEntry } from "./types";

class CountingStorage implements Storage {
  private readonly values = new Map<string, string>();
  writes = 0;

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
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.writes += 1;
    this.values.set(key, value);
  }

  seedKnowledge(entries: KnowledgeEntry[]) {
    this.values.set("ipwr:knowledgeEntries", JSON.stringify(entries));
    this.writes = 0;
  }
}

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const storage = new CountingStorage();
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

after(() => {
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else delete (globalThis as Record<string, unknown>).window;
  if (previousLocalStorage) Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
  else delete (globalThis as Record<string, unknown>).localStorage;
});

function knowledgeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "existing-case",
    category: "爆款案例",
    title: "为什么越努力越焦虑",
    rawContent: "很多人以为只要更努力就能摆脱焦虑，但真正的问题是目标没有边界。先定义停止条件，再安排每天最重要的一件事。",
    sourceKind: null,
    sourceName: "",
    sourceAnalysis: null,
    tags: ["焦虑"],
    keywords: ["目标边界"],
    ipId: "ip-b",
    sourceTier: "高",
    sourceTierReason: "真实数据已验证",
    contentDirection: ["成长"],
    sourcePlatform: "抖音",
    sourceUrl: "https://example.com/case",
    note: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    extractedAt: "2026-08-01T00:00:00.000Z",
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
    ...overrides,
  };
}

test("完整爆款案例使用最终完整原文跨全库比较且保持只读", () => {
  const rawContent = "很多人以为只要更努力就能摆脱焦虑，但真正的问题是目标没有边界。先定义停止条件，再安排每天最重要的一件事。";
  storage.seedKnowledge([
    knowledgeEntry(),
    knowledgeEntry({
      id: "global-unrelated",
      title: "不相关的全局知识",
      rawContent: "直播开场前需要检查灯光、收音和网络状态，避免设备问题影响最终呈现。",
      ipId: null,
    }),
  ]);

  const result = runHotAnalysisKnowledgePrecheck({
    analysisId: "analysis-1",
    viralCase: {
      title: "为什么越努力越焦虑",
      rawContent,
    },
    methodCards: [],
    ipNamesById: { "ip-b": "对标账号" },
    alreadySavedKnowledgeEntryIds: [],
  });

  assert.deepEqual(result.viralCase?.similarEntries, [{
    knowledgeId: "existing-case",
    tier: "exact",
    reasons: ["原文内容完全一致"],
    title: "为什么越努力越焦虑",
    category: "爆款案例",
    ownershipLabel: "对标账号IP",
    sourceDescription: "抖音",
    sourceUrl: "https://example.com/case",
    createdAt: "2026-08-01T00:00:00.000Z",
  }]);
  assert.deepEqual(result.methodCards, []);
  assert.equal(storage.writes, 0);
});

test("爆款分析方法卡使用最终保存结构跨全库比较", () => {
  storage.seedKnowledge([knowledgeEntry({
    id: "existing-method",
    category: "开头方法库",
    title: "反常识冲突开头法",
    rawContent: [
      "【一句话总结】\n先说出用户默认相信的结论，再用一个具体反例制造认知冲突。",
      "【核心方法】\n开头先复述常见判断，紧接着给出相反事实，不铺垫背景。",
      "【适用场景】\n知识口播、观点短视频",
      "【触发关键词】\n反常识、冲突开头",
      "【AI调用方式】\n当普通开头缺少停留理由时，用相反事实重写前三秒。",
      "【示例】\n你越努力，可能离目标越远。",
      "【不适用情况】\n严肃公告不适合刻意制造冲突。",
    ].join("\n\n"),
    contentDirection: ["知识口播", "观点短视频"],
    ipId: "ip-a",
    sourcePlatform: "爆款分析中心",
    sourceUrl: "https://example.com/method-source",
  })]);

  const result = runHotAnalysisKnowledgePrecheck({
    analysisId: "analysis-2",
    viralCase: null,
    methodCards: [{
      name: "反常识冲突开头法",
      targetCategory: "开头方法库",
      summary: "先说出用户默认相信的结论，再用一个具体反例制造认知冲突。",
      coreMethod: "开头先复述常见判断，紧接着给出相反事实，不铺垫背景。",
      applicableScenes: ["知识口播", "观点短视频"],
      triggerKeywords: ["反常识", "冲突开头"],
      aiUsage: "当普通开头缺少停留理由时，用相反事实重写前三秒。",
      example: "你越努力，可能离目标越远。",
      unsuitableCases: "严肃公告不适合刻意制造冲突。",
    }],
    ipNamesById: { "ip-a": "当前账号" },
    alreadySavedKnowledgeEntryIds: [],
  });

  assert.equal(result.viralCase, null);
  assert.deepEqual(result.methodCards[0]?.similarEntries, [{
    knowledgeId: "existing-method",
    tier: "exact",
    reasons: ["标题、内容摘要、核心方法、适用场景和使用方式完全一致"],
    title: "反常识冲突开头法",
    category: "开头方法库",
    ownershipLabel: "当前账号IP",
    sourceDescription: "爆款分析中心",
    sourceUrl: "https://example.com/method-source",
    createdAt: "2026-08-01T00:00:00.000Z",
  }]);
  assert.equal(storage.writes, 0);
});

test("重试检查排除本次分析已经成功保存的自身条目", () => {
  const rawContent = "完整外部逐字稿用于验证重试检查不会把本次分析已经保存的知识误报为全库重复内容。";
  storage.seedKnowledge([
    knowledgeEntry({
      id: "saved-by-current-analysis",
      rawContent,
      title: "当前分析已保存案例",
      ipId: "ip-a",
    }),
    knowledgeEntry({
      id: "same-content-from-another-analysis",
      rawContent,
      title: "另一分析保存的案例",
      ipId: "ip-b",
    }),
  ]);

  const result = runHotAnalysisKnowledgePrecheck({
    analysisId: "analysis-retry",
    viralCase: {
      title: "重新检查的完整案例",
      rawContent,
    },
    methodCards: [],
    alreadySavedKnowledgeEntryIds: ["saved-by-current-analysis"],
  });

  assert.deepEqual(
    result.viralCase?.similarEntries.map(entry => entry.knowledgeId),
    ["same-content-from-another-analysis"],
  );
  assert.equal(storage.writes, 0);
});
