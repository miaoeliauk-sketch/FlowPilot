import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  deleteHotAnalysis,
  getHotAnalysisKnowledgeGroup,
  getHotAnalysisKnowledgeGroupsByAnalysisId,
  getKnowledgeEntries,
  recordKnowledgeUsage,
  saveHotAnalysisKnowledgeEntries,
  updateKnowledgeEntry,
} from "./ip-store";
import { runHotAnalysisKnowledgePrecheck } from "./hot-analysis-knowledge";
import type { KnowledgeEntry } from "./types";

class CountingStorage implements Storage {
  private readonly values = new Map<string, string>();
  writes = 0;
  failKnowledgeWrites = false;

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
    if (this.failKnowledgeWrites && key === "ipwr:knowledgeEntries") {
      throw new Error("quota exceeded");
    }
    this.writes += 1;
    this.values.set(key, value);
  }

  seedKnowledge(entries: KnowledgeEntry[]) {
    this.values.clear();
    this.values.set("ipwr:knowledgeEntries", JSON.stringify(entries));
    this.writes = 0;
    this.failKnowledgeWrites = false;
  }

  seedHotAnalysis(id: string, ipId: string | null) {
    this.values.set("ipwr:hotAnalyses", JSON.stringify([{
      id,
      ipId,
      createdAt: "2026-08-22T00:00:00.000Z",
    }]));
  }

  seedScriptForKnowledge(knowledgeEntryId: string) {
    this.values.set("ipwr:scriptAssets", JSON.stringify([{
      id: "script-real-adoption",
      ipId: "ip-a",
      topicId: "topic-real-adoption",
      title: "真实采用脚本",
      cover: "",
      content: "最终脚本真实采用了这张方法卡。",
      status: "草稿",
      knowledgeTracking: {
        status: "verified",
        candidateKnowledgeEntryIds: [knowledgeEntryId],
        verifiedAt: "2026-08-22T01:00:00.000Z",
        usages: [{
          knowledgeEntryId,
          usageType: "argument",
          sectionLabel: "正文",
          evidenceExcerpt: "真实采用了这张方法卡",
          reason: "最终正文采用",
        }],
      },
      createdAt: "2026-08-22T01:00:00.000Z",
    }]));
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

function unsavedKnowledgeEntry(
  overrides: Partial<KnowledgeEntry> = {},
): Omit<KnowledgeEntry, "id" | "createdAt"> {
  const { id: _id, createdAt: _createdAt, ...entry } = knowledgeEntry(overrides);
  return entry;
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

test("严格保存入口强制把AI拆解方法卡标记为尚未验证", () => {
  storage.seedKnowledge([]);
  storage.seedHotAnalysis("analysis-save", "ip-a");
  const entry = {
    ...unsavedKnowledgeEntry({
      category: "开头方法库",
      title: "反常识开头法",
      rawContent: "【一句话总结】\n先给出相反结论。\n\n【核心方法】\n用具体反例制造认知冲突。",
      ipId: "ip-a",
      metrics: null,
      viralEvaluation: null,
    }),
    trustStatus: "human_confirmed_effective",
  } as Omit<KnowledgeEntry, "id" | "createdAt">;

  const saved = saveHotAnalysisKnowledgeEntries({
    analysisId: "analysis-save",
    entries: [{
      slotId: "method-card-1",
      role: "method_card",
      entry,
    }],
  });

  assert.equal(saved[0]?.id, "hot-analysis:analysis-save:method-card-1");
  assert.equal(saved[0]?.trustStatus, "ai_derived_unverified");
  assert.equal(getKnowledgeEntries()[0]?.trustStatus, "ai_derived_unverified");
  assert.equal(storage.writes, 1);
});

test("同一次分析成功保存后重复操作直接复用原方法卡", () => {
  storage.seedKnowledge([]);
  storage.seedHotAnalysis("analysis-idempotent", "ip-a");
  const input = {
    analysisId: "analysis-idempotent",
    entries: [{
      slotId: "method-card-1",
      role: "method_card" as const,
      entry: unsavedKnowledgeEntry({
        category: "选题方法库",
        title: "痛点场景选题法",
        rawContent: "【一句话总结】\n从具体痛点场景进入选题。",
        ipId: "ip-a",
        metrics: null,
        viralEvaluation: null,
      }),
    }],
  };

  const first = saveHotAnalysisKnowledgeEntries(input);
  const second = saveHotAnalysisKnowledgeEntries(input);

  assert.equal(second[0]?.id, first[0]?.id);
  assert.equal(second[0]?.createdAt, first[0]?.createdAt);
  assert.equal(getKnowledgeEntries().length, 1);
  assert.equal(storage.writes, 1);
});

test("调用方不能把方法卡伪装成爆款案例绕过未验证标记", () => {
  storage.seedKnowledge([]);
  storage.seedHotAnalysis("analysis-forged-role", "ip-a");

  assert.throws(
    () => saveHotAnalysisKnowledgeEntries({
      analysisId: "analysis-forged-role",
      entries: [{
        slotId: "method-card-1",
        role: "viral_case",
        entry: unsavedKnowledgeEntry({
          category: "开头方法库",
          title: "伪装角色的方法卡",
          rawContent: "【一句话总结】\n这仍然是一张由AI拆解产生的方法卡。",
          ipId: "ip-a",
          metrics: null,
          viralEvaluation: null,
        }),
      }],
    }),
    /知识角色与分类不一致/,
  );
  assert.deepEqual(getKnowledgeEntries(), []);
  assert.equal(storage.writes, 0);
});

test("保存时使用分析发生时的IP归属且拒绝切换IP后的串写", () => {
  storage.seedKnowledge([]);
  storage.seedHotAnalysis("analysis-ip-a", "ip-a");

  assert.throws(
    () => saveHotAnalysisKnowledgeEntries({
      analysisId: "analysis-ip-a",
      entries: [{
        slotId: "method-card-1",
        role: "method_card",
        entry: unsavedKnowledgeEntry({
          category: "选题方法库",
          title: "错误归属的方法卡",
          rawContent: "【一句话总结】\n分析完成后切换IP不能改变知识归属。",
          ipId: "ip-b",
          metrics: null,
          viralEvaluation: null,
        }),
      }],
    }),
    /不属于本次分析记录的IP/,
  );
  assert.deepEqual(getKnowledgeEntries(), []);
  assert.equal(storage.writes, 0);
});

test("同一批次存在重复方法卡编号时整体拒绝且不写入半成品", () => {
  storage.seedKnowledge([]);
  storage.seedHotAnalysis("analysis-duplicate-slot", "ip-a");
  const entry = unsavedKnowledgeEntry({
    category: "文案框架方法库",
    title: "问题解决结构法",
    rawContent: "【一句话总结】\n按照问题、原因、方案组织正文。",
    ipId: "ip-a",
    metrics: null,
    viralEvaluation: null,
  });

  assert.throws(
    () => saveHotAnalysisKnowledgeEntries({
      analysisId: "analysis-duplicate-slot",
      entries: [
        { slotId: "method-card-1", role: "method_card", entry },
        { slotId: "method-card-1", role: "method_card", entry },
      ],
    }),
    /知识编号重复/,
  );
  assert.deepEqual(getKnowledgeEntries(), []);
  assert.equal(storage.writes, 0);
});

test("浏览器拒绝严格写入时整批方法卡都不留下残留", () => {
  storage.seedKnowledge([]);
  storage.seedHotAnalysis("analysis-write-failure", "ip-a");
  storage.failKnowledgeWrites = true;
  const first = unsavedKnowledgeEntry({
    category: "选题方法库",
    title: "第一张方法卡",
    rawContent: "【一句话总结】\n第一张需要和第二张一起成功。",
    ipId: "ip-a",
    metrics: null,
    viralEvaluation: null,
  });
  const second = unsavedKnowledgeEntry({
    category: "开头方法库",
    title: "第二张方法卡",
    rawContent: "【一句话总结】\n第二张不能在第一张失败后单独残留。",
    ipId: "ip-a",
    metrics: null,
    viralEvaluation: null,
  });

  try {
    assert.throws(
      () => saveHotAnalysisKnowledgeEntries({
        analysisId: "analysis-write-failure",
        entries: [
          { slotId: "method-card-1", role: "method_card", entry: first },
          { slotId: "method-card-2", role: "method_card", entry: second },
        ],
      }),
      /爆款分析知识保存失败/,
    );
  } finally {
    storage.failKnowledgeWrites = false;
  }
  assert.deepEqual(getKnowledgeEntries(), []);
  assert.equal(storage.writes, 0);
});

test("相同稳定编号对应不同内容时拒绝覆盖原方法卡", () => {
  storage.seedKnowledge([]);
  storage.seedHotAnalysis("analysis-conflict", "ip-a");
  const original = unsavedKnowledgeEntry({
    category: "开头方法库",
    title: "冲突开头法",
    rawContent: "【一句话总结】\n先展示冲突。",
    ipId: "ip-a",
    metrics: null,
    viralEvaluation: null,
  });
  saveHotAnalysisKnowledgeEntries({
    analysisId: "analysis-conflict",
    entries: [{ slotId: "method-card-1", role: "method_card", entry: original }],
  });

  assert.throws(
    () => saveHotAnalysisKnowledgeEntries({
      analysisId: "analysis-conflict",
      entries: [{
        slotId: "method-card-1",
        role: "method_card",
        entry: { ...original, rawContent: "【一句话总结】\n已经变成另一种方法。" },
      }],
    }),
    /内容、归属或可信度不一致/,
  );
  assert.equal(getKnowledgeEntries().length, 1);
  assert.equal(getKnowledgeEntries()[0]?.rawContent, "【一句话总结】\n先展示冲突。");
  assert.equal(storage.writes, 1);
});

test("相同稳定编号只有全部保存字段完全一致时才能复用", () => {
  storage.seedKnowledge([]);
  storage.seedHotAnalysis("analysis-full-content", "ip-a");
  const original = unsavedKnowledgeEntry({
    category: "选题方法库",
    title: "完整字段幂等检查",
    rawContent: "【一句话总结】\n完整保存内容必须逐项一致。",
    tags: ["原标签"],
    keywords: ["原关键词"],
    ipId: "ip-a",
    sourceName: "原始拆解",
    sourcePlatform: "抖音",
    sourceUrl: "https://example.com/original",
    note: "原始说明",
    contentDirection: ["知识"],
    sourceTierReason: "来自原始爆款分析",
    metrics: null,
    viralEvaluation: null,
  });
  saveHotAnalysisKnowledgeEntries({
    analysisId: "analysis-full-content",
    entries: [{ slotId: "method-card-1", role: "method_card", entry: original }],
  });

  const changes: Array<[string, Partial<typeof original>]> = [
    ["关键词", { keywords: ["新关键词"] }],
    ["标签", { tags: ["新标签"] }],
    ["来源名称", { sourceName: "另一份拆解" }],
    ["来源平台", { sourcePlatform: "视频号" }],
    ["来源链接", { sourceUrl: "https://example.com/changed" }],
    ["拆解说明", { note: "拆解结果已经变化" }],
    ["内容方向", { contentDirection: ["成长"] }],
    ["来源依据", { sourceTierReason: "另一份来源依据" }],
  ];

  for (const [field, patch] of changes) {
    assert.throws(
      () => saveHotAnalysisKnowledgeEntries({
        analysisId: "analysis-full-content",
        entries: [{
          slotId: "method-card-1",
          role: "method_card",
          entry: { ...original, ...patch },
        }],
      }),
      /保存内容不一致/,
      `${field}变化时不应复用旧记录`,
    );
  }
  assert.equal(getKnowledgeEntries().length, 1);
  assert.equal(storage.writes, 1);
});

test("历史存储存在相同稳定编号的重复条目时明确拒绝保存", () => {
  const duplicateId = "hot-analysis:analysis-duplicate-history:method-card-1";
  storage.seedKnowledge([
    knowledgeEntry({
      id: duplicateId,
      category: "开头方法库",
      title: "历史重复方法卡",
      rawContent: "【一句话总结】\n历史异常不能被静默掩盖。",
      ipId: "ip-a",
      trustStatus: "ai_derived_unverified",
    }),
    knowledgeEntry({
      id: duplicateId,
      category: "开头方法库",
      title: "历史重复方法卡",
      rawContent: "【一句话总结】\n历史异常不能被静默掩盖。",
      ipId: "ip-a",
      trustStatus: "ai_derived_unverified",
    }),
  ]);
  storage.seedHotAnalysis("analysis-duplicate-history", "ip-a");

  assert.throws(
    () => saveHotAnalysisKnowledgeEntries({
      analysisId: "analysis-duplicate-history",
      entries: [{
        slotId: "method-card-1",
        role: "method_card",
        entry: unsavedKnowledgeEntry({
          category: "开头方法库",
          title: "历史重复方法卡",
          rawContent: "【一句话总结】\n历史异常不能被静默掩盖。",
          ipId: "ip-a",
          metrics: null,
          viralEvaluation: null,
        }),
      }],
    }),
    /历史知识存在相同编号的重复条目/,
  );
  assert.equal(getKnowledgeEntries().length, 2);
  assert.equal(storage.writes, 0);
});

test("严格保存为完整案例和方法卡写入同一来源组且调用方无法伪造", () => {
  storage.seedKnowledge([]);
  storage.seedHotAnalysis("analysis-source-group", "ip-a");
  const forgedReference = {
    sourceType: "hot_analysis",
    analysisId: "forged-analysis",
    role: "viral_case",
    groupItemId: "forged-item",
  };

  const saved = saveHotAnalysisKnowledgeEntries({
    analysisId: "analysis-source-group",
    entries: [
      {
        slotId: "viral-case",
        role: "viral_case",
        entry: {
          ...unsavedKnowledgeEntry({
            category: "爆款案例",
            title: "完整案例",
            rawContent: "这是一份用于拆解的完整爆款案例原文。",
            ipId: "ip-a",
          }),
          sourceReference: forgedReference,
        } as Omit<KnowledgeEntry, "id" | "createdAt">,
      },
      {
        slotId: "method-card-1",
        role: "method_card",
        entry: unsavedKnowledgeEntry({
          category: "开头方法库",
          title: "方法卡一",
          rawContent: "【核心方法】先展示反常识结论。",
          ipId: "ip-a",
          metrics: null,
          viralEvaluation: null,
        }),
      },
    ],
  });

  assert.deepEqual(saved[0]?.sourceReference, {
    sourceType: "hot_analysis",
    analysisId: "analysis-source-group",
    role: "viral_case",
    groupItemId: "viral-case",
  });
  assert.deepEqual(saved[1]?.sourceReference, {
    sourceType: "hot_analysis",
    analysisId: "analysis-source-group",
    role: "method_card",
    groupItemId: "method-card-1",
  });
});

test("来源组内编号为空时整体拒绝保存", () => {
  storage.seedKnowledge([]);
  storage.seedHotAnalysis("analysis-empty-slot", "ip-a");

  assert.throws(
    () => saveHotAnalysisKnowledgeEntries({
      analysisId: "analysis-empty-slot",
      entries: [{
        slotId: "   ",
        role: "method_card",
        entry: unsavedKnowledgeEntry({
          category: "开头方法库",
          title: "缺少组内编号的方法卡",
          rawContent: "【核心方法】组内编号不能为空。",
          ipId: "ip-a",
          metrics: null,
          viralEvaluation: null,
        }),
      }],
    }),
    /组内编号不能为空/,
  );
  assert.deepEqual(getKnowledgeEntries(), []);
  assert.equal(storage.writes, 0);
});

test("来源组支持案例与方法卡双向查询且删除分析历史后关联仍保留", () => {
  storage.seedKnowledge([]);
  storage.seedHotAnalysis("analysis-query-group", "ip-a");
  const saved = saveHotAnalysisKnowledgeEntries({
    analysisId: "analysis-query-group",
    entries: [
      {
        slotId: "viral-case",
        role: "viral_case",
        entry: unsavedKnowledgeEntry({
          category: "爆款案例",
          title: "可追溯完整案例",
          rawContent: "完整案例原文。",
          ipId: "ip-a",
        }),
      },
      {
        slotId: "method-card-1",
        role: "method_card",
        entry: unsavedKnowledgeEntry({
          category: "开头方法库",
          title: "第一张关联方法卡",
          rawContent: "【核心方法】第一张方法卡。",
          ipId: "ip-a",
          metrics: null,
          viralEvaluation: null,
        }),
      },
      {
        slotId: "method-card-2",
        role: "method_card",
        entry: unsavedKnowledgeEntry({
          category: "选题方法库",
          title: "第二张关联方法卡",
          rawContent: "【核心方法】第二张方法卡。",
          ipId: "ip-a",
          metrics: null,
          viralEvaluation: null,
        }),
      },
    ],
  });

  const fromCase = getHotAnalysisKnowledgeGroup(saved[0]!.id);
  const fromMethod = getHotAnalysisKnowledgeGroup(saved[2]!.id);
  assert.equal(fromCase?.viralCase?.id, saved[0]!.id);
  assert.deepEqual(fromCase?.methodCards.map(entry => entry.id), [saved[1]!.id, saved[2]!.id]);
  assert.deepEqual(fromMethod, fromCase);

  deleteHotAnalysis("analysis-query-group");
  assert.deepEqual(getHotAnalysisKnowledgeGroup(saved[1]!.id), fromCase);
});

test("旧知识只展示真实存在的来源关联且不根据备注补造缺失关系", () => {
  storage.seedKnowledge([
    knowledgeEntry({
      id: "legacy-case-with-note-only",
      category: "爆款案例",
      title: "只有旧备注的案例",
      note: "来源分析编号：analysis-legacy",
      ipId: "ip-a",
    }),
    knowledgeEntry({
      id: "explicitly-linked-method",
      category: "开头方法库",
      title: "真实存在关联的方法卡",
      rawContent: "【核心方法】只展示明确记录的关系。",
      ipId: "ip-a",
      trustStatus: "ai_derived_unverified",
      sourceReference: {
        sourceType: "hot_analysis",
        analysisId: "analysis-legacy",
        role: "method_card",
        groupItemId: "method-card-1",
      },
    }),
  ]);

  assert.equal(getHotAnalysisKnowledgeGroup("legacy-case-with-note-only"), null);
  const group = getHotAnalysisKnowledgeGroup("explicitly-linked-method");
  assert.equal(group?.viralCase, null);
  assert.deepEqual(
    group?.methodCards.map(entry => entry.id),
    ["explicitly-linked-method"],
  );
});

test("历史来源组查询按当前IP收窄且没有当前IP时只读取全局知识", () => {
  const linkedMethod = (id: string, analysisId: string, ipId: string | null) => knowledgeEntry({
    id,
    category: "开头方法库",
    title: id,
    rawContent: `【核心方法】${id}`,
    ipId,
    trustStatus: "ai_derived_unverified",
    sourceReference: {
      sourceType: "hot_analysis",
      analysisId,
      role: "method_card",
      groupItemId: "method-card-1",
    },
  });
  storage.seedKnowledge([
    linkedMethod("current-method", "analysis-current", "ip-a"),
    linkedMethod("other-method", "analysis-other", "ip-b"),
    linkedMethod("global-method", "analysis-global", null),
  ]);

  assert.deepEqual(
    [...getHotAnalysisKnowledgeGroupsByAnalysisId("ip-a").keys()].sort(),
    ["analysis-current", "analysis-global"],
  );
  assert.deepEqual(
    [...getHotAnalysisKnowledgeGroupsByAnalysisId(null).keys()],
    ["analysis-global"],
  );
});

test("严格保存入口忽略调用方伪造的采用记录和使用状态", () => {
  storage.seedKnowledge([]);
  storage.seedHotAnalysis("analysis-forged-lifecycle", "ip-a");
  const forgedEntry = {
    ...unsavedKnowledgeEntry({
      category: "开头方法库",
      title: "不能伪造生命周期的方法卡",
      rawContent: "【核心方法】生命周期只能由系统推进。",
      ipId: "ip-a",
      metrics: null,
      viralEvaluation: null,
    }),
    usageRecords: [{
      id: "forged-usage",
      module: "脚本工厂",
      usedAt: "2026-08-22T02:00:00.000Z",
      reason: "伪造采用",
      relevanceTier: "高度相关",
      relevanceReason: "伪造依据",
      context: "伪造上下文",
      trackingStatus: "script_adopted",
      topicId: "forged-topic",
      scriptId: "forged-script",
      reviewId: "forged-review",
      usageType: "argument",
      sectionLabel: "正文",
      evidenceExcerpt: "伪造证据",
    }],
    status: "已用于脚本",
  } as Omit<KnowledgeEntry, "id" | "createdAt">;

  const [saved] = saveHotAnalysisKnowledgeEntries({
    analysisId: "analysis-forged-lifecycle",
    entries: [{
      slotId: "method-card-1",
      role: "method_card",
      entry: forgedEntry,
    }],
  });

  assert.deepEqual(saved?.usageRecords, []);
  assert.equal(saved?.status, "未使用");
});

test("方法卡真实产生生命周期记录后重复保存仍复用原条目", () => {
  storage.seedKnowledge([]);
  storage.seedHotAnalysis("analysis-retry-after-adoption", "ip-a");
  const input = {
    analysisId: "analysis-retry-after-adoption",
    entries: [{
      slotId: "method-card-1",
      role: "method_card" as const,
      entry: unsavedKnowledgeEntry({
        category: "文案框架方法库",
        title: "真实采用后仍可幂等复用",
        rawContent: "【核心方法】真实采用记录不属于原始入库内容。",
        ipId: "ip-a",
        metrics: null,
        viralEvaluation: null,
      }),
    }],
  };
  const [first] = saveHotAnalysisKnowledgeEntries(input);
  storage.seedScriptForKnowledge(first!.id);
  recordKnowledgeUsage(first!.id, {
    module: "脚本工厂",
    usedAt: "2026-08-22T01:00:00.000Z",
    reason: "最终正文真实采用",
    relevanceTier: "高度相关",
    relevanceReason: "候选知识出现在最终正文",
    context: "真实采用测试",
  }, "已用于脚本", "script-real-adoption");

  const [retried] = saveHotAnalysisKnowledgeEntries(input);

  assert.equal(retried?.id, first?.id);
  assert.equal(retried?.createdAt, first?.createdAt);
  assert.equal(retried?.status, "已用于脚本");
  assert.equal(retried?.usageRecords.length, 1);
  assert.equal(getKnowledgeEntries().length, 1);
});

test("通用编辑入口拒绝篡改可信度和来源关系", () => {
  storage.seedKnowledge([]);
  storage.seedHotAnalysis("analysis-protected-fields", "ip-a");
  const [saved] = saveHotAnalysisKnowledgeEntries({
    analysisId: "analysis-protected-fields",
    entries: [{
      slotId: "method-card-1",
      role: "method_card",
      entry: unsavedKnowledgeEntry({
        category: "选题方法库",
        title: "系统字段不可编辑",
        rawContent: "【核心方法】可信度和来源只能由系统维护。",
        ipId: "ip-a",
        metrics: null,
        viralEvaluation: null,
      }),
    }],
  });

  assert.throws(
    () => updateKnowledgeEntry(saved!.id, {
      trustStatus: "human_confirmed_effective",
      sourceReference: {
        sourceType: "hot_analysis",
        analysisId: "forged-analysis",
        role: "viral_case",
        groupItemId: "forged-item",
      },
    } as Partial<KnowledgeEntry>),
    /系统维护字段不能通过通用编辑入口修改/,
  );
  const persisted = getKnowledgeEntries()[0];
  assert.equal(persisted?.trustStatus, "ai_derived_unverified");
  assert.equal(persisted?.sourceReference?.analysisId, "analysis-protected-fields");
  assert.equal(storage.writes, 1);
});
