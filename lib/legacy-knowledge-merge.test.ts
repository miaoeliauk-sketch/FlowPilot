import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import type { IPStyleProfile, KnowledgeEntry } from "./types";
import {
  LEGACY_KNOWLEDGE_MERGE_AUDIT_KEY,
  getLegacyKnowledgeMergeAuditRecords,
  mergeLegacyKnowledgeGroupStrict,
} from "./ip-store";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/knowledge-merge-maintenance",
});

const previousGlobals = {
  window: Object.getOwnPropertyDescriptor(globalThis, "window"),
  document: Object.getOwnPropertyDescriptor(globalThis, "document"),
  navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
};

Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.window.localStorage });
Object.defineProperty(dom.window.navigator, "locks", {
  configurable: true,
  value: {
    request: async (_name: string, operation: () => unknown) => operation(),
  },
});

function restoreGlobal(name: keyof typeof previousGlobals): void {
  const descriptor = previousGlobals[name];
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Object.defineProperty(globalThis, name, { configurable: true, value: undefined });
}

after(() => {
  dom.window.close();
  restoreGlobal("window");
  restoreGlobal("document");
  restoreGlobal("navigator");
  restoreGlobal("localStorage");
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("ipwr:scriptAssets", "[]");
  localStorage.setItem("ipwr:videoReviews", "[]");
  localStorage.setItem("ipwr:ipStyleProfiles", "[]");
});

function knowledge(id: string, title: string, rawContent: string): KnowledgeEntry {
  return {
    id,
    category: "定位方法库",
    title,
    rawContent,
    sourceKind: null,
    sourceName: "历史导入",
    sourceAnalysis: null,
    tags: ["心理账户"],
    keywords: ["价值表达"],
    ipId: null,
    sourceTier: "低",
    sourceTierReason: "旧知识来源待复核",
    contentDirection: [],
    sourcePlatform: "智能入库助手",
    sourceUrl: "",
    note: "旧知识",
    createdAt: "2026-01-01T00:00:00.000Z",
    extractedAt: null,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    trustStatus: null,
    sourceReference: null,
    executionTemplate: null,
    dna: null,
  };
}

const BACKUP_SHA256 = "92f23a67057063cb2859a8b22be0e8e33446973d1ea04fbbfb2bd731af152278";

function mergeInput(survivor: KnowledgeEntry, source: KnowledgeEntry) {
  return {
    groupId: "D01",
    backupContentSha256: BACKUP_SHA256,
    activeIPId: survivor.ipId,
    survivor,
    sources: [source],
    mergedContent: { rawContent: "合并后的正文" },
  };
}

function styleProfile(sourceIds: string[], sourceTitles: string[]): IPStyleProfile {
  return {
    ipId: "ip-a",
    openingHabits: ["先讲结论", "先讲案例", "先问问题"],
    viewpointStyle: "具体",
    sentenceLength: "短句为主",
    emotionalTone: ["理性", "克制"],
    commonPhrases: ["注意", "换句话说", "具体来看", "关键是", "最后"],
    closingHabits: ["总结", "给建议", "留问题"],
    forbiddenExpressions: ["空话", "套话", "口号"],
    styleSummary: "清晰直接",
    sourceSampleIds: sourceIds,
    sourceSampleTitles: sourceTitles,
    extractedAt: "2026-01-02T00:00:00.000Z",
    model: "test-model",
  };
}

test("单组严格合并先写入回读，再安全删除来源项并保存完整审计记录", async () => {
  const source = knowledge("source-a", "心理账户驱动价值表达", "来源项原文");
  const survivor = knowledge("survivor-b", "心理账户价值表达法", "保留项原文");
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([source, survivor]));

  const mergedRawContent = "保留项原文。补充来源项独有的选题使用方式。";
  const result = await mergeLegacyKnowledgeGroupStrict({
    groupId: "D01",
    backupContentSha256: BACKUP_SHA256,
    activeIPId: null,
    survivor,
    sources: [source],
    mergedContent: { rawContent: mergedRawContent },
  });

  assert.equal(result.survivor.id, survivor.id);
  assert.equal(result.survivor.rawContent, mergedRawContent);
  assert.deepEqual(result.removedEntries.map(entry => entry.id), [source.id]);

  const persisted = JSON.parse(
    localStorage.getItem("ipwr:knowledgeEntries") ?? "[]",
  ) as KnowledgeEntry[];
  assert.deepEqual(persisted.map(entry => entry.id), [survivor.id]);
  assert.equal(persisted[0]?.rawContent, mergedRawContent);
  assert.deepEqual(
    { ...persisted[0], rawContent: survivor.rawContent },
    survivor,
    "除人工合并正文外，保留项的系统字段和原始入库字段都不能变化",
  );

  const records = getLegacyKnowledgeMergeAuditRecords();
  assert.equal(LEGACY_KNOWLEDGE_MERGE_AUDIT_KEY, "ipwr:legacyKnowledgeMergeAudit:v1");
  assert.equal(records.length, 1);
  assert.equal(records[0]?.groupId, "D01");
  assert.equal(records[0]?.status, "completed");
  assert.equal(records[0]?.backupContentSha256, "92f23a67057063cb2859a8b22be0e8e33446973d1ea04fbbfb2bd731af152278");
  assert.deepEqual(records[0]?.survivorBefore, survivor);
  assert.deepEqual(records[0]?.survivorAfter, { ...survivor, rawContent: mergedRawContent });
  assert.deepEqual(records[0]?.removedEntries, [source]);
  assert.match(records[0]?.startedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.match(records[0]?.completedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
});

test("原始快照变化或调用方夹带系统字段时拒绝合并", async () => {
  const source = knowledge("source-a", "来源项", "来源项原文");
  const survivor = knowledge("survivor-b", "保留项", "保留项原文");
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    source,
    { ...survivor, trustStatus: "ai_derived_unverified" },
  ]));

  await assert.rejects(
    mergeLegacyKnowledgeGroupStrict(mergeInput(survivor, source)),
    /保留项内容已经变化/,
  );

  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([source, survivor]));
  await assert.rejects(
    mergeLegacyKnowledgeGroupStrict({
      ...mergeInput(survivor, source),
      mergedContent: {
        rawContent: "合并后的正文",
        trustStatus: "human_confirmed_effective",
      },
    } as Parameters<typeof mergeLegacyKnowledgeGroupStrict>[0]),
    /人工合并内容不完整/,
  );
  assert.deepEqual(
    JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]"),
    [source, survivor],
  );
});

test("被合并项已有生命周期证据时拒绝删除，避免合并篡改真实效果链", async () => {
  const source = {
    ...knowledge("source-a", "来源项", "来源项原文"),
    status: "已用于脚本" as const,
    usageRecords: [{
      id: "usage-1",
      module: "脚本工厂" as const,
      usedAt: "2026-02-01T00:00:00.000Z",
      reason: "脚本最终确认采用",
      relevanceTier: "高度相关" as const,
      relevanceReason: "知识内容与最终脚本正文直接对应",
      context: "测试",
      trackingStatus: "script_adopted" as const,
      topicId: "topic-1",
      scriptId: "script-1",
      reviewId: null,
      usageType: "argument" as const,
      sectionLabel: "正文",
      evidenceExcerpt: "来源项原文",
    }],
  };
  const survivor = knowledge("survivor-b", "保留项", "保留项原文");
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([source, survivor]));

  await assert.rejects(
    mergeLegacyKnowledgeGroupStrict(mergeInput(survivor, source)),
    /真实采用记录/,
  );
  assert.equal(getLegacyKnowledgeMergeAuditRecords().length, 0);
});

test("先把被删除知识的语气引用迁移到保留项并回读确认", async () => {
  const source = { ...knowledge("source-a", "旧口播", "来源项原文"), ipId: "ip-a" };
  const survivor = { ...knowledge("survivor-b", "保留口播", "保留项原文"), ipId: "ip-a" };
  const profile = styleProfile(
    ["another", source.id, survivor.id, source.id],
    ["其他样本", source.title, survivor.title, source.title],
  );
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([source, survivor]));
  localStorage.setItem("ipwr:ipStyleProfiles", JSON.stringify([profile]));

  await mergeLegacyKnowledgeGroupStrict(mergeInput(survivor, source));

  const [persistedProfile] = JSON.parse(
    localStorage.getItem("ipwr:ipStyleProfiles") ?? "[]",
  ) as IPStyleProfile[];
  assert.deepEqual(persistedProfile?.sourceSampleIds, ["another", survivor.id]);
  assert.deepEqual(persistedProfile?.sourceSampleTitles, ["其他样本", survivor.title]);
  const [record] = getLegacyKnowledgeMergeAuditRecords();
  assert.deepEqual(record?.styleProfilesBefore, [profile]);
  assert.deepEqual(record?.styleProfilesAfter, [persistedProfile]);
});

test("历史知识提取时间为空字符串时，完成合并后仍能读取原样审计记录", async () => {
  const sourceA = {
    ...knowledge("source-a", "旧口播A", "相同原文"),
    ipId: "ip-a",
    extractedAt: "",
  };
  const sourceB = {
    ...knowledge("source-b", "旧口播B", "相同原文"),
    ipId: "ip-a",
    extractedAt: "",
  };
  const survivor = {
    ...knowledge("survivor-c", "保留口播", "相同原文"),
    ipId: "ip-a",
    extractedAt: "",
  };
  const profile = styleProfile(
    [survivor.id, sourceB.id],
    [survivor.title, sourceB.title],
  );
  localStorage.setItem(
    "ipwr:knowledgeEntries",
    JSON.stringify([sourceA, sourceB, survivor]),
  );
  localStorage.setItem("ipwr:ipStyleProfiles", JSON.stringify([profile]));

  await mergeLegacyKnowledgeGroupStrict({
    groupId: "D03",
    backupContentSha256: BACKUP_SHA256,
    activeIPId: "ip-a",
    survivor,
    sources: [sourceA, sourceB],
    mergedContent: { rawContent: survivor.rawContent },
  });

  const [record] = getLegacyKnowledgeMergeAuditRecords();
  assert.equal(record?.status, "completed");
  assert.equal(record?.survivorBefore.extractedAt, "");
  assert.deepEqual(
    record?.removedEntries.map(entry => entry.extractedAt),
    ["", ""],
  );
});

test("审计记录中的非空非法提取时间仍会被拒绝", async () => {
  const source = knowledge("source-a", "来源项", "来源项原文");
  const survivor = knowledge("survivor-b", "保留项", "保留项原文");
  localStorage.setItem(
    "ipwr:knowledgeEntries",
    JSON.stringify([source, survivor]),
  );
  await mergeLegacyKnowledgeGroupStrict(mergeInput(survivor, source));

  const [record] = getLegacyKnowledgeMergeAuditRecords();
  localStorage.setItem(LEGACY_KNOWLEDGE_MERGE_AUDIT_KEY, JSON.stringify([{
    ...record,
    survivorBefore: { ...record!.survivorBefore, extractedAt: "错误时间" },
    survivorAfter: { ...record!.survivorAfter, extractedAt: "错误时间" },
  }]));

  assert.throws(
    () => getLegacyKnowledgeMergeAuditRecords(),
    /合并记录已损坏/,
  );
});

test("删除阶段失败时恢复保留项、来源项、引用和审计记录", async () => {
  const source = { ...knowledge("source-a", "来源项", "来源项原文"), ipId: "ip-a" };
  const survivor = { ...knowledge("survivor-b", "保留项", "保留项原文"), ipId: "ip-a" };
  const profile = styleProfile([source.id], [source.title]);
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([source, survivor]));
  localStorage.setItem("ipwr:ipStyleProfiles", JSON.stringify([profile]));
  localStorage.setItem("ipwr:scriptAssets", "{损坏数据");

  await assert.rejects(
    mergeLegacyKnowledgeGroupStrict(mergeInput(survivor, source)),
    /脚本库数据已损坏/,
  );
  assert.deepEqual(
    JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]"),
    [source, survivor],
  );
  assert.deepEqual(
    JSON.parse(localStorage.getItem("ipwr:ipStyleProfiles") ?? "[]"),
    [profile],
  );
  assert.equal(localStorage.getItem(LEGACY_KNOWLEDGE_MERGE_AUDIT_KEY), null);
});

test("最终操作记录写入失败时不假成功并恢复整组数据", async () => {
  const source = knowledge("source-a", "来源项", "来源项原文");
  const survivor = knowledge("survivor-b", "保留项", "保留项原文");
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([source, survivor]));
  const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
  const originalSetItem = storagePrototype.setItem;
  let auditWrites = 0;
  storagePrototype.setItem = function setItem(key: string, value: string): void {
    if (key === LEGACY_KNOWLEDGE_MERGE_AUDIT_KEY && ++auditWrites === 2) {
      throw new Error("quota");
    }
    originalSetItem.call(this, key, value);
  };
  try {
    await assert.rejects(
      mergeLegacyKnowledgeGroupStrict(mergeInput(survivor, source)),
      /操作记录保存失败/,
    );
  } finally {
    storagePrototype.setItem = originalSetItem;
  }
  assert.deepEqual(
    JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]"),
    [source, survivor],
  );
  assert.equal(localStorage.getItem(LEGACY_KNOWLEDGE_MERGE_AUDIT_KEY), null);
});

test("历史操作记录逐条结构损坏时拒绝继续追加且知识完全不变", async () => {
  const source = knowledge("source-a", "来源项", "来源项原文");
  const survivor = knowledge("survivor-b", "保留项", "保留项原文");
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([source, survivor]));
  localStorage.setItem(LEGACY_KNOWLEDGE_MERGE_AUDIT_KEY, JSON.stringify([{
    groupId: "D00",
    status: "completed",
  }]));

  await assert.rejects(
    mergeLegacyKnowledgeGroupStrict(mergeInput(survivor, source)),
    /合并记录已损坏/,
  );
  assert.deepEqual(
    JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]"),
    [source, survivor],
  );
});

test("近似合法但metrics或usageRecords内部残缺的伪造审计记录会被拒绝", async () => {
  const oldSource = knowledge("old-source", "旧来源项", "旧来源项原文");
  const oldSurvivor = knowledge("old-survivor", "旧保留项", "旧保留项原文");
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([oldSource, oldSurvivor]));
  await mergeLegacyKnowledgeGroupStrict(mergeInput(oldSurvivor, oldSource));

  const [completedRecord] = getLegacyKnowledgeMergeAuditRecords();
  const forgedRecord = {
    ...completedRecord,
    survivorBefore: {
      ...completedRecord!.survivorBefore,
      metrics: { likes: 1 },
      usageRecords: [{}],
    },
    survivorAfter: {
      ...completedRecord!.survivorAfter,
      metrics: { likes: 1 },
      usageRecords: [{}],
    },
  };
  localStorage.setItem(LEGACY_KNOWLEDGE_MERGE_AUDIT_KEY, JSON.stringify([forgedRecord]));

  const source = knowledge("source-a", "来源项", "来源项原文");
  const survivor = knowledge("survivor-b", "保留项", "保留项原文");
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([source, survivor]));
  await assert.rejects(
    mergeLegacyKnowledgeGroupStrict({
      ...mergeInput(survivor, source),
      groupId: "D02",
    }),
    /合并记录已损坏/,
  );
  assert.deepEqual(
    JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]"),
    [source, survivor],
  );
});

test("存在上次中断留下的in_progress记录时阻止发起下一组合并", async () => {
  const oldSource = knowledge("old-source", "旧来源项", "旧来源项原文");
  const oldSurvivor = knowledge("old-survivor", "旧保留项", "旧保留项原文");
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([oldSource, oldSurvivor]));
  await mergeLegacyKnowledgeGroupStrict(mergeInput(oldSurvivor, oldSource));

  const [completedRecord] = getLegacyKnowledgeMergeAuditRecords();
  localStorage.setItem(LEGACY_KNOWLEDGE_MERGE_AUDIT_KEY, JSON.stringify([{
    ...completedRecord,
    status: "in_progress",
    completedAt: null,
  }]));

  const source = knowledge("source-a", "来源项", "来源项原文");
  const survivor = knowledge("survivor-b", "保留项", "保留项原文");
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([source, survivor]));
  await assert.rejects(
    mergeLegacyKnowledgeGroupStrict({
      ...mergeInput(survivor, source),
      groupId: "D02",
    }),
    /尚未完成.*先恢复|先恢复.*尚未完成/,
  );
  assert.deepEqual(
    JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]"),
    [source, survivor],
  );
});

test("自动恢复写入被静默吞掉时明确报告恢复失败", async () => {
  const source = knowledge("source-a", "来源项", "来源项原文");
  const survivor = knowledge("survivor-b", "保留项", "保留项原文");
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([source, survivor]));
  const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
  const originalSetItem = storagePrototype.setItem;
  let auditWrites = 0;
  let swallowKnowledgeRestore = false;
  storagePrototype.setItem = function setItem(key: string, value: string): void {
    if (key === LEGACY_KNOWLEDGE_MERGE_AUDIT_KEY && ++auditWrites === 2) {
      swallowKnowledgeRestore = true;
      throw new Error("quota");
    }
    if (key === "ipwr:knowledgeEntries" && swallowKnowledgeRestore) return;
    originalSetItem.call(this, key, value);
  };
  try {
    await assert.rejects(
      mergeLegacyKnowledgeGroupStrict(mergeInput(survivor, source)),
      /恢复失败/,
    );
  } finally {
    storagePrototype.setItem = originalSetItem;
  }
});
