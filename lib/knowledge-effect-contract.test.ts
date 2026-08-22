import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  clear(): void {
    this.values.clear();
  }
}

const storage = new MemoryStorage();
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { localStorage: storage },
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

beforeEach(() => storage.clear());

after(() => {
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else delete (globalThis as Record<string, unknown>).window;
  if (previousLocalStorage) Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
  else delete (globalThis as Record<string, unknown>).localStorage;
});

test("旧知识调用和旧脚本读取后明确标记为不可追溯", async () => {
  storage.setItem("ipwr:knowledgeEntries", JSON.stringify([{
    id: "knowledge-legacy",
    category: "方法论",
    title: "历史知识",
    rawContent: "历史知识正文",
    tags: [],
    keywords: [],
    ipId: null,
    sourceTier: "高",
    sourceTierReason: "历史数据",
    contentDirection: [],
    sourcePlatform: "",
    sourceUrl: "",
    note: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    extractedAt: "2026-08-01T00:00:00.000Z",
    metrics: null,
    viralEvaluation: null,
    usageRecords: [{
      id: "usage-legacy",
      module: "脚本工厂",
      usedAt: "2026-08-01T01:00:00.000Z",
      reason: "历史调用",
      relevanceTier: "高度相关",
      relevanceReason: "历史记录没有关联编号",
      context: "历史选题",
    }],
    status: "已用于脚本",
    dna: null,
  }]));
  storage.setItem("ipwr:scriptAssets", JSON.stringify([{
    id: "script-legacy",
    ipId: "ip-a",
    title: "历史脚本",
    cover: "",
    content: "历史脚本正文",
    status: "草稿",
    createdAt: "2026-08-01T02:00:00.000Z",
  }]));

  const { getKnowledgeEntries, getScriptAssets } = await import("./ip-store");
  const usage = getKnowledgeEntries()[0]?.usageRecords[0];
  const script = getScriptAssets("ip-a")[0];

  assert.equal(usage?.trackingStatus, "legacy_unverified");
  assert.equal(usage?.topicId, null);
  assert.equal(usage?.scriptId, null);
  assert.equal(usage?.reviewId, null);
  assert.equal(usage?.usageType, null);
  assert.equal(usage?.sectionLabel, null);
  assert.equal(usage?.evidenceExcerpt, null);
  assert.deepEqual(script?.knowledgeTracking, {
    status: "not_tracked",
    candidateKnowledgeEntryIds: [],
    verifiedAt: null,
    usages: [],
  });
});

test("普通模块调用不会被记成脚本真实采用", async () => {
  storage.setItem("ipwr:knowledgeEntries", JSON.stringify([{
    id: "knowledge-current",
    category: "方法论",
    title: "当前知识",
    rawContent: "当前知识正文",
    tags: [],
    keywords: [],
    ipId: null,
    sourceTier: "高",
    sourceTierReason: "人工确认",
    contentDirection: [],
    sourcePlatform: "",
    sourceUrl: "",
    note: "",
    createdAt: "2026-08-22T00:00:00.000Z",
    extractedAt: "2026-08-22T00:00:00.000Z",
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
  }]));

  const { getKnowledgeEntries, recordKnowledgeUsage } = await import("./ip-store");
  recordKnowledgeUsage("knowledge-current", {
    module: "脚本工厂",
    usedAt: "2026-08-22T01:00:00.000Z",
    reason: "检索候选",
    relevanceTier: "高度相关",
    relevanceReason: "与选题相关",
    context: "当前选题",
  });

  const usage = getKnowledgeEntries()[0]?.usageRecords[0];
  assert.equal(usage?.trackingStatus, "module_recorded");
  assert.equal(usage?.topicId, null);
  assert.equal(usage?.scriptId, null);
  assert.equal(usage?.reviewId, null);
  assert.equal(usage?.usageType, null);
  assert.equal(usage?.sectionLabel, null);
  assert.equal(usage?.evidenceExcerpt, null);
});

test("脚本知识采用契约只接受候选知识和最终稿中的真实证据", async () => {
  const { parseVerifiedScriptKnowledgeTracking } = await import("./knowledge-effect-contract");
  const finalScriptText = "开头先讲结论。中段用真实案例解释。";

  const tracking = parseVerifiedScriptKnowledgeTracking({
    candidateKnowledgeEntryIds: ["knowledge-a", "knowledge-b"],
    finalScriptText,
    verifiedAt: "2026-08-22T02:00:00.000Z",
    usages: [{
      knowledgeEntryId: "knowledge-a",
      usageType: "case",
      sectionLabel: "中段",
      evidenceExcerpt: "中段用真实案例解释",
      reason: "采用了知识中的案例表达",
    }],
  });

  assert.deepEqual(tracking, {
    status: "verified",
    candidateKnowledgeEntryIds: ["knowledge-a", "knowledge-b"],
    verifiedAt: "2026-08-22T02:00:00.000Z",
    usages: [{
      knowledgeEntryId: "knowledge-a",
      usageType: "case",
      sectionLabel: "中段",
      evidenceExcerpt: "中段用真实案例解释",
      reason: "采用了知识中的案例表达",
    }],
  });

  assert.throws(() => parseVerifiedScriptKnowledgeTracking({
    candidateKnowledgeEntryIds: ["knowledge-a"],
    finalScriptText,
    verifiedAt: "2026-08-22T02:00:00.000Z",
    usages: [{
      knowledgeEntryId: "knowledge-outside-candidates",
      usageType: "argument",
      sectionLabel: "开头",
      evidenceExcerpt: "脚本中并不存在的证据",
      reason: "错误引用",
    }],
  }), /候选知识|最终脚本/);
});

test("脚本保存入口拒绝绕过契约写入伪造的已验证采用记录", async () => {
  const { addScriptAsset, getScriptAssets } = await import("./ip-store");
  const baseScript = {
    ipId: "ip-a",
    title: "待保存脚本",
    cover: "",
    content: "开头先讲结论。中段用真实案例解释。",
    status: "草稿" as const,
  };

  assert.throws(() => addScriptAsset({
    ...baseScript,
    knowledgeTracking: {
      status: "verified",
      candidateKnowledgeEntryIds: ["knowledge-a"],
      verifiedAt: "2026-08-22T03:00:00.000Z",
      usages: [{
        knowledgeEntryId: "knowledge-outside-candidates",
        usageType: "case",
        sectionLabel: "中段",
        evidenceExcerpt: "中段用真实案例解释",
        reason: "伪造的候选知识",
      }],
    },
  }), /候选知识/);

  assert.throws(() => addScriptAsset({
    ...baseScript,
    knowledgeTracking: {
      status: "verified",
      candidateKnowledgeEntryIds: ["knowledge-a"],
      verifiedAt: "2026-08-22T03:00:00.000Z",
      usages: [{
        knowledgeEntryId: "knowledge-a",
        usageType: "case",
        sectionLabel: "中段",
        evidenceExcerpt: "最终正文里不存在的引用",
        reason: "伪造的正文证据",
      }],
    },
  }), /最终脚本/);

  assert.deepEqual(getScriptAssets("ip-a"), []);
});
