import assert from "node:assert/strict";
import test from "node:test";
import type {
  KnowledgeEntry,
  KnowledgeUsageRecord,
  ScriptAsset,
  VideoReview,
} from "./types";
import {
  createKnowledgeLibrarySnapshot,
  loadKnowledgeLibrarySnapshot,
  queryKnowledgeLibrary,
} from "./knowledge-library-view";

function knowledgeEntry(
  id: string,
  ipId: string | null,
  overrides: Partial<KnowledgeEntry> = {},
): KnowledgeEntry {
  return {
    id,
    category: "文案框架方法库",
    title: id,
    rawContent: `${id}的知识正文`,
    sourceKind: null,
    sourceName: "",
    sourceAnalysis: null,
    tags: [],
    keywords: [],
    ipId,
    sourceTier: "中",
    sourceTierReason: "测试来源",
    contentDirection: [],
    sourcePlatform: "",
    sourceUrl: "",
    note: "",
    createdAt: "2026-08-23T00:00:00.000Z",
    extractedAt: null,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    trustStatus: null,
    sourceReference: null,
    dna: null,
    ...overrides,
  };
}

test("知识浏览快照只包含全局和当前IP知识且无当前IP时不泄露私有知识", () => {
  const entries = [
    knowledgeEntry("global-entry", null),
    knowledgeEntry("current-entry", "ip-a"),
    knowledgeEntry("other-entry", "ip-b"),
    knowledgeEntry("broken-owner", ""),
  ];

  const currentSnapshot = createKnowledgeLibrarySnapshot({
    activeIPId: "ip-a",
    entries,
  });
  assert.deepEqual(
    currentSnapshot.items.map(item => item.id).sort(),
    ["current-entry", "global-entry"],
  );

  const noIPSnapshot = createKnowledgeLibrarySnapshot({
    activeIPId: null,
    entries,
  });
  assert.deepEqual(noIPSnapshot.items.map(item => item.id), ["global-entry"]);
});

test("知识浏览查询支持搜索、分类、可信度和真实来源组合筛选", () => {
  const snapshot = createKnowledgeLibrarySnapshot({
    activeIPId: "ip-a",
    entries: [
      knowledgeEntry("method-card", "ip-a", {
        category: "开头方法库",
        title: "反常识开头方法",
        rawContent: "先给出与直觉相反的结论，再解释原因。",
        tags: ["认知冲突"],
        trustStatus: "ai_derived_unverified",
        sourceReference: {
          sourceType: "hot_analysis",
          analysisId: "analysis-a",
          role: "method_card",
          groupItemId: "method-card-1",
        },
      }),
      knowledgeEntry("external-case", null, {
        category: "爆款案例",
        title: "外部爆款案例",
        sourcePlatform: "抖音",
        sourceUrl: "https://example.com/case",
      }),
      knowledgeEntry("original-source", "ip-a", {
        category: "IP原始内容",
        title: "老师直播原文",
        sourceKind: "直播逐字稿",
      }),
      knowledgeEntry("review-experience", "ip-a", {
        category: "复盘经验库",
        title: "发布复盘经验",
      }),
      knowledgeEntry("legacy-method", null, {
        category: "方法论",
        title: "没有可信度标记的旧方法",
        trustStatus: null,
      }),
    ],
  });

  assert.deepEqual(
    queryKnowledgeLibrary(snapshot, { query: "认知冲突" }).map(item => item.id),
    ["method-card"],
  );
  assert.deepEqual(
    queryKnowledgeLibrary(snapshot, { categories: ["开头方法库"] }).map(item => item.id),
    ["method-card"],
  );
  assert.deepEqual(
    queryKnowledgeLibrary(snapshot, { trustStatuses: ["ai_derived_unverified"] }).map(item => item.id),
    ["method-card"],
  );
  assert.deepEqual(
    queryKnowledgeLibrary(snapshot, { trustStatuses: ["not_in_trust_system"] }).map(item => item.id).sort(),
    ["external-case", "legacy-method", "original-source", "review-experience"],
  );
  assert.deepEqual(
    queryKnowledgeLibrary(snapshot, { sourceKinds: ["hot_analysis_method"] }).map(item => item.id),
    ["method-card"],
  );
  assert.deepEqual(
    queryKnowledgeLibrary(snapshot, { sourceKinds: ["external_case", "review_experience"] }).map(item => item.id).sort(),
    ["external-case", "review-experience"],
  );
});

function adoptedUsage(
  knowledgeEntryId: string,
  overrides: Partial<KnowledgeUsageRecord> = {},
): KnowledgeUsageRecord {
  return {
    id: `usage-${knowledgeEntryId}`,
    module: "脚本工厂",
    usedAt: "2026-08-23T01:00:00.000Z",
    reason: "最终脚本采用了该方法",
    relevanceTier: "高度相关",
    relevanceReason: "正文存在对应证据",
    context: "生成口播脚本",
    trackingStatus: "script_adopted",
    topicId: "topic-a",
    scriptId: "script-a",
    reviewId: "review-a",
    usageType: "structure",
    sectionLabel: "开头",
    evidenceExcerpt: "先给出反常识结论",
    ...overrides,
  };
}

function adoptedScript(
  knowledgeEntryId: string,
  overrides: Partial<ScriptAsset> = {},
): ScriptAsset {
  return {
    id: "script-a",
    ipId: "ip-a",
    topicId: "topic-a",
    title: "真实采用脚本",
    cover: "",
    content: "先给出反常识结论，再解释原因。",
    status: "定稿",
    knowledgeTracking: {
      status: "verified",
      candidateKnowledgeEntryIds: [knowledgeEntryId],
      verifiedAt: "2026-08-23T01:00:00.000Z",
      usages: [{
        knowledgeEntryId,
        usageType: "structure",
        sectionLabel: "开头",
        evidenceExcerpt: "先给出反常识结论",
        reason: "最终脚本采用了该方法",
      }],
    },
    createdAt: "2026-08-23T01:00:00.000Z",
    ...overrides,
  };
}

function publishedReview(overrides: Partial<VideoReview> = {}): VideoReview {
  return {
    id: "review-a",
    ipId: "ip-a",
    title: "真实发布复盘",
    platform: "抖音",
    publishedAt: "2026-08-24",
    videoUrl: "https://example.com/video",
    contentDirection: "知识",
    topicId: "topic-a",
    scriptId: "script-a",
    sourceType: "flowpilot",
    traceabilityStatus: "traceable",
    knowledgeEffectStatus: "tracked",
    scriptText: "先给出反常识结论，再解释原因。",
    metrics: {
      views: 1000,
      likes: 100,
      comments: 10,
      favorites: 20,
      shares: 5,
      newFollowers: 3,
      dms: 1,
      leads: 0,
      conversions: 0,
    },
    analysis: null,
    savedToKnowledge: false,
    knowledgeEntryId: null,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    manualReviewStatus: "pending",
    manualReviewTags: [],
    manualReviewNote: "",
    ...overrides,
  };
}

test("知识浏览条目聚合真实来源组、采用脚本和发布复盘证据", () => {
  const method = knowledgeEntry("method-card", "ip-a", {
    category: "开头方法库",
    trustStatus: "ai_derived_unverified",
    usageRecords: [adoptedUsage("method-card")],
    sourceReference: {
      sourceType: "hot_analysis",
      analysisId: "analysis-a",
      role: "method_card",
      groupItemId: "method-1",
    },
  });
  const viralCase = knowledgeEntry("viral-case", "ip-a", {
    category: "爆款案例",
    sourceReference: {
      sourceType: "hot_analysis",
      analysisId: "analysis-a",
      role: "viral_case",
      groupItemId: "case-1",
    },
  });
  const orphanMethod = knowledgeEntry("orphan-method", "ip-a", {
    category: "标题方法库",
    trustStatus: "ai_derived_unverified",
    sourceReference: {
      sourceType: "hot_analysis",
      analysisId: "missing-analysis",
      role: "method_card",
      groupItemId: "orphan-1",
    },
  });

  const snapshot = createKnowledgeLibrarySnapshot({
    activeIPId: "ip-a",
    entries: [method, viralCase, orphanMethod],
    scripts: [adoptedScript(method.id)],
    reviews: [publishedReview()],
  });
  const methodItem = snapshot.items.find(item => item.id === method.id)!;
  const caseItem = snapshot.items.find(item => item.id === viralCase.id)!;

  assert.equal(methodItem.trustStatus, "effect_evidence_awaiting_judgment");
  assert.equal(methodItem.effect.adoptedScriptCount, 1);
  assert.equal(methodItem.effect.reviewedScriptCount, 1);
  assert.equal(methodItem.effect.scripts[0]?.script.title, "真实采用脚本");
  assert.equal(methodItem.effect.scripts[0]?.review?.metrics.views, 1000);
  assert.deepEqual(methodItem.relatedKnowledge.map(item => item.id), ["viral-case"]);
  assert.deepEqual(caseItem.relatedKnowledge.map(item => item.id), ["method-card"]);
  assert.deepEqual(
    snapshot.items.find(item => item.id === orphanMethod.id)?.relatedKnowledge,
    [],
  );
});

test("知识浏览效果证据只使用当前IP且不把跨IP记录计入全局知识", () => {
  const globalMethod = knowledgeEntry("global-method", null, {
    category: "开头方法库",
    trustStatus: "ai_derived_unverified",
    usageRecords: [adoptedUsage("global-method", {
      topicId: "topic-b",
      scriptId: "script-b",
      reviewId: "review-b",
    })],
    sourceReference: {
      sourceType: "hot_analysis",
      analysisId: "analysis-global",
      role: "method_card",
      groupItemId: "global-method-1",
    },
  });
  const crossIPScript = adoptedScript(globalMethod.id, {
    id: "script-b",
    ipId: "ip-b",
    topicId: "topic-b",
  });
  const crossIPReview = publishedReview({
    id: "review-b",
    ipId: "ip-b",
    topicId: "topic-b",
    scriptId: "script-b",
  });

  const snapshot = createKnowledgeLibrarySnapshot({
    activeIPId: "ip-a",
    entries: [globalMethod],
    scripts: [crossIPScript],
    reviews: [crossIPReview],
  });

  assert.equal(snapshot.items[0]?.effect.adoptedScriptCount, 0);
  assert.equal(snapshot.items[0]?.effect.reviewedScriptCount, 0);
  assert.equal(snapshot.items[0]?.trustStatus, "ai_derived_unverified");
});

test("统一加载入口只读当前IP快照且没有当前IP时只返回全局知识", () => {
  const values = new Map<string, string>();
  let writeCount = 0;
  const storage = {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key: string) { return values.get(key) ?? null; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    removeItem(key: string) { values.delete(key); },
    setItem(key: string, value: string) { writeCount += 1; values.set(key, value); },
  } satisfies Storage;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });

  try {
    storage.setItem("ipwr:knowledgeEntries", JSON.stringify([
      knowledgeEntry("global-entry", null),
      knowledgeEntry("current-entry", "ip-a"),
      knowledgeEntry("other-entry", "ip-b"),
    ]));
    storage.setItem("ipwr:scriptAssets", JSON.stringify([]));
    storage.setItem("ipwr:videoReviews", JSON.stringify([]));
    writeCount = 0;

    assert.deepEqual(
      loadKnowledgeLibrarySnapshot("ip-a").items.map(item => item.id).sort(),
      ["current-entry", "global-entry"],
    );
    assert.deepEqual(
      loadKnowledgeLibrarySnapshot(null).items.map(item => item.id),
      ["global-entry"],
    );
    assert.equal(writeCount, 0);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete (globalThis as Record<string, unknown>).window;
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete (globalThis as Record<string, unknown>).localStorage;
  }
});

test("统一加载入口不会让其他IP的损坏采用记录阻断当前IP浏览", () => {
  const values = new Map<string, string>();
  const storage = {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key: string) { return values.get(key) ?? null; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    removeItem(key: string) { values.delete(key); },
    setItem(key: string, value: string) { values.set(key, value); },
  } satisfies Storage;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

  try {
    storage.setItem("ipwr:knowledgeEntries", JSON.stringify([
      knowledgeEntry("global-entry", null),
      knowledgeEntry("current-entry", "ip-a"),
      {
        ...knowledgeEntry("other-broken-entry", "ip-b"),
        usageRecords: [null],
      },
    ]));
    storage.setItem("ipwr:scriptAssets", JSON.stringify([]));
    storage.setItem("ipwr:videoReviews", JSON.stringify([]));

    assert.deepEqual(
      loadKnowledgeLibrarySnapshot("ip-a").items.map(item => item.id).sort(),
      ["current-entry", "global-entry"],
    );
    assert.deepEqual(
      loadKnowledgeLibrarySnapshot(null).items.map(item => item.id),
      ["global-entry"],
    );
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete (globalThis as Record<string, unknown>).window;
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete (globalThis as Record<string, unknown>).localStorage;
  }
});

test("知识浏览安全降级损坏的可选字段且不伪造可信度或来源关系", () => {
  const broken = {
    ...knowledgeEntry("broken-entry", null),
    category: "未知旧分类",
    rawContent: undefined,
    tags: [null, "有效标签"],
    keywords: "损坏关键词",
    trustStatus: "human_confirmed_effective_forged",
    sourceReference: {
      sourceType: "hot_analysis",
      analysisId: "",
      role: "viral_case",
      groupItemId: "",
    },
  } as unknown as KnowledgeEntry;

  const snapshot = createKnowledgeLibrarySnapshot({
    activeIPId: null,
    entries: [broken],
  });
  const item = snapshot.items[0]!;

  assert.equal(item.content, "");
  assert.deepEqual(item.tags, ["有效标签"]);
  assert.deepEqual(item.keywords, []);
  assert.equal(item.trustStatus, "not_in_trust_system");
  assert.equal(item.source.kind, "unknown");
  assert.deepEqual(item.relatedKnowledge, []);
  assert.doesNotThrow(() => queryKnowledgeLibrary(snapshot, { query: "有效标签" }));
});

test("损坏记录不能把爆款案例伪装成方法卡并建立虚假来源关系", () => {
  const viralCase = knowledgeEntry("viral-case", null, {
    category: "爆款案例",
    sourceReference: {
      sourceType: "hot_analysis",
      analysisId: "analysis-a",
      role: "viral_case",
      groupItemId: "case-1",
    },
  });
  const forgedMethod = knowledgeEntry("forged-method", null, {
    category: "爆款案例",
    sourceReference: {
      sourceType: "hot_analysis",
      analysisId: "analysis-a",
      role: "method_card",
      groupItemId: "method-1",
    },
  });
  const incompleteMethod = knowledgeEntry("incomplete-method", null, {
    category: "开头方法库",
    sourceReference: {
      sourceType: "hot_analysis",
      analysisId: "",
      role: "method_card",
      groupItemId: "",
    },
  });

  const snapshot = createKnowledgeLibrarySnapshot({
    activeIPId: null,
    entries: [viralCase, forgedMethod, incompleteMethod],
  });

  assert.deepEqual(
    snapshot.items.find(item => item.id === viralCase.id)?.relatedKnowledge,
    [],
  );
  assert.equal(
    snapshot.items.find(item => item.id === forgedMethod.id)?.source.kind,
    "external_case",
  );
  assert.equal(
    snapshot.items.find(item => item.id === incompleteMethod.id)?.source.kind,
    "unknown",
  );
});

test("知识详情如实区分四类原始来源并保留模板版本", () => {
  const snapshot = createKnowledgeLibrarySnapshot({
    activeIPId: "ip-a",
    entries: [
      knowledgeEntry("ip-original", "ip-a", {
        category: "IP原始内容",
        title: "直播原文",
        rawContent: "老师直播逐字原文。",
        sourceKind: "直播逐字稿",
      }),
      knowledgeEntry("viral-case", "ip-a", {
        category: "爆款案例",
        title: "完整爆款案例",
        rawContent: "完整案例正文。",
        sourceReference: {
          sourceType: "hot_analysis",
          analysisId: "analysis-detail",
          role: "viral_case",
          groupItemId: "case-1",
        },
      }),
      knowledgeEntry("reviewed-method", null, {
        title: "人工审核方法卡",
        rawContent: "审核后的方法卡正文。",
        sourceName: "精准客户行为诊断法",
        sourcePlatform: "人工确认方法卡",
        tags: ["人工确认方法卡"],
      }),
      knowledgeEntry("exact-template", null, {
        title: "标准执行模板",
        rawContent: "必须逐字保留的模板正文。",
        sourcePlatform: "原文保真保存",
        sourceName: "精准客户行为诊断法",
        executionTemplate: {
          templateKey: "precise-customer-behavior-diagnosis",
          version: "1.0.0",
          contentHash: "a".repeat(64),
        },
      }),
    ],
  });

  assert.deepEqual(
    snapshot.items.map(item => ({
      id: item.id,
      kind: item.detail.originalSource.kind,
      content: item.detail.originalSource.content,
      version: item.detail.originalSource.templateVersion,
      reviewStatus: item.detail.originalSource.reviewStatus,
    })),
    [
      { id: "ip-original", kind: "ip_original", content: "老师直播逐字原文。", version: null, reviewStatus: null },
      { id: "viral-case", kind: "hot_analysis_case", content: "完整案例正文。", version: null, reviewStatus: null },
      { id: "reviewed-method", kind: "reviewed_method", content: "审核后的方法卡正文。", version: null, reviewStatus: "人工已审核，来源和效果仍待验证" },
      { id: "exact-template", kind: "exact_template", content: "必须逐字保留的模板正文。", version: "1.0.0", reviewStatus: null },
    ],
  );
  assert.deepEqual(
    snapshot.items.find(item => item.id === "reviewed-method")?.relatedKnowledge,
    [{ id: "exact-template", title: "标准执行模板", category: "文案框架方法库", role: "execution_template" }],
  );
});

test("知识详情陈列真实采用证据并把历史未验证记录单独隔离", () => {
  const trusted = adoptedUsage("method-detail");
  const legacy = adoptedUsage("method-detail", {
    id: "legacy-usage",
    trackingStatus: "legacy_unverified",
    scriptId: null,
    reviewId: null,
    usedAt: "2025-01-01T00:00:00.000Z",
    reason: "历史记录无法核验",
  });
  const method = knowledgeEntry("method-detail", "ip-a", {
    trustStatus: "ai_derived_unverified",
    usageRecords: [legacy, trusted],
  });
  const snapshot = createKnowledgeLibrarySnapshot({
    activeIPId: "ip-a",
    entries: [method],
    scripts: [adoptedScript(method.id)],
    reviews: [publishedReview()],
  });
  const detail = snapshot.items[0]!.detail;

  assert.equal(detail.effectEvidence[0]?.scriptTitle, "真实采用脚本");
  assert.equal(detail.effectEvidence[0]?.reviewTitle, "真实发布复盘");
  assert.equal(detail.effectEvidence[0]?.metrics?.views, 1000);
  assert.deepEqual(detail.legacyUnverifiedRecords, [{
    id: "legacy-usage",
    usedAt: "2025-01-01T00:00:00.000Z",
    module: "脚本工厂",
    reason: "历史记录无法核验",
  }]);
});
