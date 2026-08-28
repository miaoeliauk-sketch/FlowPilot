import assert from "node:assert/strict";
import test from "node:test";

import {
  bridgeDraftCognitionGraph,
  createDraftCognitionBatchId,
} from "./cognition-graph-bridge";
import type {
  DraftCognitionSessionRecord,
  DraftSessionStorageLike,
  LegacyDraftCognitionSessionRecord,
} from "./cognition-draft-session-store";
import { calculateSHA256 } from "./sha256";
import type { IPSourceAnalysisV2, IPSourceAnchor } from "./types";

const storeModulePath = "./cognition-draft-session-store";
const STORAGE_KEY_PREFIX_V1 = "FP_COGNITION_DRAFT_V1:";
const STORAGE_KEY_PREFIX_V2 = "FP_COGNITION_DRAFT_V2:";

type DraftStoreModule = typeof import("./cognition-draft-session-store");

class MemoryStorage implements DraftSessionStorageLike {
  readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

async function loadDraftStoreModule(): Promise<DraftStoreModule> {
  let loaded: unknown;
  try {
    loaded = await import(storeModulePath);
  } catch {
    assert.fail("草稿会话存储适配器模块尚未实现");
  }
  const module = loaded as Partial<DraftStoreModule>;
  assert.equal(typeof module.saveDraftCognitionBatch, "function");
  assert.equal(typeof module.loadDraftCognitionBatches, "function");
  assert.equal(typeof module.updateDraftSourceMetadata, "function");
  return module as DraftStoreModule;
}

function anchor(quote: string, startPosition: number): IPSourceAnchor {
  return {
    quote,
    startPosition,
    endPosition: startPosition + quote.length,
  };
}

function makeRecord(input: {
  ipId: string;
  sourceId: string;
  analyzedAt: string;
  token?: string;
}): DraftCognitionSessionRecord {
  const rawContent = `持续输出来自${input.ipId}的真实问题。`;
  const analysis: IPSourceAnalysisV2 = {
    analyzedAt: input.analyzedAt,
    parserVersion: 2,
    nonce: 1,
    sourceId: input.sourceId,
    sourceHash: calculateSHA256(rawContent),
    nodes: [{
      id: "11111111-1111-4111-8111-111111111111",
      question: {
        content: "持续输出来自哪里？",
        derivation: "inferred",
        anchors: [anchor(rawContent, 0)],
      },
      claim: {
        content: rawContent,
        anchors: [anchor(rawContent, 0)],
      },
      reasoning: { status: "not_provided", steps: [] },
      evidence: [],
      concepts: [],
      reviewStatus: "ai_extracted",
    }],
    aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
  };
  return {
    schemaVersion: 2,
    batchId: createDraftCognitionBatchId({
      ipId: input.ipId,
      sourceId: input.sourceId,
      sourceHash: analysis.sourceHash,
      analyzedAt: input.analyzedAt,
    }),
    ipId: input.ipId,
    rawContent,
    sourceMetadata: {
      title: `认知草稿-${input.sourceId}`,
      sourceKind: "课程内容",
      sourceName: "",
      sourceUrl: "",
    },
    analysis,
    analysisToken: input.token ?? "fake-token-for-test",
  };
}

function legacyStorageKey(record: LegacyDraftCognitionSessionRecord): string {
  const identity = JSON.stringify([
    record.ipId,
    record.analysis.sourceId,
    record.batchId,
  ]);
  return `${STORAGE_KEY_PREFIX_V1}${calculateSHA256(identity)}`;
}

function makeLegacyRecord(
  record: DraftCognitionSessionRecord,
  preserveMetadata = false,
): LegacyDraftCognitionSessionRecord {
  return {
    schemaVersion: 1,
    batchId: record.batchId,
    ipId: record.ipId,
    rawContent: record.rawContent,
    sourceMetadata: preserveMetadata ? record.sourceMetadata : null,
    analysis: record.analysis,
    analysisToken: record.analysisToken,
  };
}

test("同一草稿批次重复保存时覆盖原记录而不累积副本", async () => {
  const { saveDraftCognitionBatch, loadDraftCognitionBatches } = await loadDraftStoreModule();
  const storage = new MemoryStorage();
  const original = makeRecord({
    ipId: "ip-a",
    sourceId: "source-a",
    analyzedAt: "2026-08-27T10:00:00.000Z",
  });
  const firstSave = saveDraftCognitionBatch(storage, original);
  assert.equal(firstSave.ok, true);
  if (!firstSave.ok) return;
  assert.match(firstSave.key, /^FP_COGNITION_DRAFT_V2:[a-f0-9]{64}$/u);

  const reviewed: DraftCognitionSessionRecord = {
    ...original,
    analysis: {
      ...original.analysis,
      nonce: 2,
      nodes: original.analysis.nodes.map(node => ({
        ...node,
        reviewStatus: "human_confirmed" as const,
      })),
    },
    analysisToken: "fake-token-for-test-after-review",
  };
  const secondSave = saveDraftCognitionBatch(storage, reviewed);

  assert.deepEqual(secondSave, firstSave);
  assert.equal(storage.length, 1);
  const loaded = loadDraftCognitionBatches(storage, "ip-a");
  assert.equal(loaded.corruptedRecordCount, 0);
  assert.equal(loaded.records.length, 1);
  assert.equal(loaded.records[0]!.analysis.nonce, 2);
  assert.equal(loaded.records[0]!.analysisToken, "fake-token-for-test-after-review");
});

test("浏览器容量不足时返回明确状态且保留原有批次", async () => {
  const { saveDraftCognitionBatch } = await loadDraftStoreModule();
  const underlying = new MemoryStorage();
  const original = makeRecord({
    ipId: "ip-a",
    sourceId: "source-quota",
    analyzedAt: "2026-08-27T10:01:00.000Z",
  });
  const initialSave = saveDraftCognitionBatch(underlying, original);
  assert.equal(initialSave.ok, true);
  if (!initialSave.ok) return;
  const originalSerialized = underlying.getItem(initialSave.key);
  const quotaStorage: DraftSessionStorageLike = {
    get length() { return underlying.length; },
    key: index => underlying.key(index),
    getItem: key => underlying.getItem(key),
    setItem() {
      throw new DOMException("sessionStorage quota exceeded", "QuotaExceededError");
    },
    removeItem: key => underlying.removeItem(key),
  };

  const result = saveDraftCognitionBatch(quotaStorage, {
    ...original,
    analysisToken: "fake-token-for-test-new-value",
  });

  assert.deepEqual(result, { ok: false, code: "QUOTA_EXCEEDED" });
  assert.equal(underlying.getItem(initialSave.key), originalSerialized);
});

test("存储不可用或发生普通写入错误时返回WRITE_FAILED", async () => {
  const { saveDraftCognitionBatch } = await loadDraftStoreModule();
  const record = makeRecord({
    ipId: "ip-a",
    sourceId: "source-unavailable",
    analyzedAt: "2026-08-27T10:02:00.000Z",
  });
  const failingStorage: DraftSessionStorageLike = {
    length: 0,
    key: () => null,
    getItem: () => null,
    setItem() { throw new Error("storage unavailable"); },
    removeItem: () => undefined,
  };

  assert.deepEqual(
    saveDraftCognitionBatch(null, record),
    { ok: false, code: "WRITE_FAILED" },
  );
  assert.deepEqual(
    saveDraftCognitionBatch(failingStorage, record),
    { ok: false, code: "WRITE_FAILED" },
  );
});

test("混合IP读取严格隔离并保留损坏和未知版本原文", async () => {
  const { saveDraftCognitionBatch, loadDraftCognitionBatches } = await loadDraftStoreModule();
  const storage = new MemoryStorage();
  const ipARecords = [
    makeRecord({
      ipId: "ip-a",
      sourceId: "source-a-1",
      analyzedAt: "2026-08-27T10:03:00.000Z",
    }),
    makeRecord({
      ipId: "ip-a",
      sourceId: "source-a-2",
      analyzedAt: "2026-08-27T10:04:00.000Z",
    }),
  ];
  const ipBRecord = makeRecord({
    ipId: "ip-b",
    sourceId: "source-b-1",
    analyzedAt: "2026-08-27T10:05:00.000Z",
  });
  [...ipARecords, ipBRecord].forEach(record => {
    assert.equal(saveDraftCognitionBatch(storage, record).ok, true);
  });

  const brokenKey = `${STORAGE_KEY_PREFIX_V2}broken-json`;
  const futureKey = `${STORAGE_KEY_PREFIX_V2}future-schema`;
  const missingTokenKey = `${STORAGE_KEY_PREFIX_V2}missing-token`;
  const brokenRaw = "{broken";
  const futureRaw = JSON.stringify({ ...ipARecords[0], schemaVersion: 3 });
  const { analysisToken: _ignored, ...withoutToken } = ipARecords[1]!;
  const missingTokenRaw = JSON.stringify(withoutToken);
  storage.setItem(brokenKey, brokenRaw);
  storage.setItem(futureKey, futureRaw);
  storage.setItem(missingTokenKey, missingTokenRaw);

  const loadedA = loadDraftCognitionBatches(storage, "ip-a");
  const loadedB = loadDraftCognitionBatches(storage, "ip-b");

  assert.deepEqual(
    loadedA.records.map(record => record.batchId).sort(),
    ipARecords.map(record => record.batchId).sort(),
  );
  assert.deepEqual(
    loadedB.records.map(record => record.batchId),
    [ipBRecord.batchId],
  );
  assert.equal(loadedA.corruptedRecordCount, 3);
  assert.equal(storage.getItem(brokenKey), brokenRaw);
  assert.equal(storage.getItem(futureKey), futureRaw);
  assert.equal(storage.getItem(missingTokenKey), missingTokenRaw);
});

test("读取时拒绝存储键与记录内容不一致的重复草稿", async () => {
  const { saveDraftCognitionBatch, loadDraftCognitionBatches } = await loadDraftStoreModule();
  const storage = new MemoryStorage();
  const record = makeRecord({
    ipId: "ip-a",
    sourceId: "source-key-check",
    analyzedAt: "2026-08-27T10:06:00.000Z",
  });
  const saved = saveDraftCognitionBatch(storage, record);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const serialized = storage.getItem(saved.key);
  assert.ok(serialized);
  storage.setItem(`${STORAGE_KEY_PREFIX_V2}${"f".repeat(64)}`, serialized);

  const loaded = loadDraftCognitionBatches(storage, "ip-a");

  assert.equal(loaded.records.length, 1);
  assert.equal(loaded.records[0]?.batchId, record.batchId);
  assert.equal(loaded.corruptedRecordCount, 1);
});

test("读取存储失败时返回明确错误且不暴露部分结果", async () => {
  const { loadDraftCognitionBatches } = await loadDraftStoreModule();
  const lengthFailure: DraftSessionStorageLike = {
    get length(): number { throw new Error("storage blocked"); },
    key: () => null,
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  const readFailure: DraftSessionStorageLike = {
    length: 1,
    key: () => `${STORAGE_KEY_PREFIX_V2}${"a".repeat(64)}`,
    getItem() { throw new Error("storage read failed"); },
    setItem: () => undefined,
    removeItem: () => undefined,
  };

  assert.deepEqual(loadDraftCognitionBatches(lengthFailure, "ip-a"), {
    records: [],
    metadataRequiredRecords: [],
    corruptedRecordCount: 0,
    errorCode: "READ_FAILED",
  });
  assert.deepEqual(loadDraftCognitionBatches(readFailure, "ip-a"), {
    records: [],
    metadataRequiredRecords: [],
    corruptedRecordCount: 0,
    errorCode: "READ_FAILED",
  });
});

test("按批次清除只移除目标草稿且重复调用安全", async () => {
  const {
    saveDraftCognitionBatch,
    loadDraftCognitionBatches,
    removeDraftsByBatch,
  } = await loadDraftStoreModule();
  const storage = new MemoryStorage();
  const target = makeRecord({
    ipId: "ip-a",
    sourceId: "source-remove-target",
    analyzedAt: "2026-08-27T10:07:00.000Z",
  });
  const sameIP = makeRecord({
    ipId: "ip-a",
    sourceId: "source-keep-same-ip",
    analyzedAt: "2026-08-27T10:08:00.000Z",
  });
  const otherIP = makeRecord({
    ipId: "ip-b",
    sourceId: "source-keep-other-ip",
    analyzedAt: "2026-08-27T10:09:00.000Z",
  });
  [target, sameIP, otherIP].forEach(record => {
    assert.equal(saveDraftCognitionBatch(storage, record).ok, true);
  });
  const brokenKey = `${STORAGE_KEY_PREFIX_V2}keep-broken`;
  storage.setItem(brokenKey, "{broken");

  assert.deepEqual(removeDraftsByBatch(storage, "ip-a", target.batchId), {
    ok: true,
    removedCount: 1,
  });
  assert.deepEqual(removeDraftsByBatch(storage, "ip-a", target.batchId), {
    ok: true,
    removedCount: 0,
  });
  assert.deepEqual(
    loadDraftCognitionBatches(storage, "ip-a").records.map(record => record.batchId),
    [sameIP.batchId],
  );
  assert.deepEqual(
    loadDraftCognitionBatches(storage, "ip-b").records.map(record => record.batchId),
    [otherIP.batchId],
  );
  assert.equal(storage.getItem(brokenKey), "{broken");
});

test("按IP清除只移除该IP的全部合法草稿", async () => {
  const {
    saveDraftCognitionBatch,
    loadDraftCognitionBatches,
    clearAllDraftsForIP,
  } = await loadDraftStoreModule();
  const storage = new MemoryStorage();
  const ipARecords = [
    makeRecord({
      ipId: "ip-a",
      sourceId: "source-clear-a-1",
      analyzedAt: "2026-08-27T10:10:00.000Z",
    }),
    makeRecord({
      ipId: "ip-a",
      sourceId: "source-clear-a-2",
      analyzedAt: "2026-08-27T10:11:00.000Z",
    }),
  ];
  const ipBRecord = makeRecord({
    ipId: "ip-b",
    sourceId: "source-clear-b-1",
    analyzedAt: "2026-08-27T10:12:00.000Z",
  });
  [...ipARecords, ipBRecord].forEach(record => {
    assert.equal(saveDraftCognitionBatch(storage, record).ok, true);
  });
  const brokenKey = `${STORAGE_KEY_PREFIX_V2}keep-broken-after-clear`;
  storage.setItem(brokenKey, "{broken");

  assert.deepEqual(clearAllDraftsForIP(storage, "ip-a"), {
    ok: true,
    removedCount: 2,
  });
  assert.equal(loadDraftCognitionBatches(storage, "ip-a").records.length, 0);
  assert.deepEqual(
    loadDraftCognitionBatches(storage, "ip-b").records.map(record => record.batchId),
    [ipBRecord.batchId],
  );
  assert.equal(storage.getItem(brokenKey), "{broken");
});

test("清理存储异常时返回明确错误且不抛出异常", async () => {
  const {
    saveDraftCognitionBatch,
    removeDraftsByBatch,
    clearAllDraftsForIP,
  } = await loadDraftStoreModule();
  const record = makeRecord({
    ipId: "ip-a",
    sourceId: "source-cleanup-error",
    analyzedAt: "2026-08-27T10:13:00.000Z",
  });
  const readFailure: DraftSessionStorageLike = {
    get length(): number { throw new Error("storage blocked"); },
    key: () => null,
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  assert.deepEqual(removeDraftsByBatch(readFailure, record.ipId, record.batchId), {
    ok: false,
    code: "READ_FAILED",
  });
  assert.deepEqual(clearAllDraftsForIP(readFailure, record.ipId), {
    ok: false,
    code: "READ_FAILED",
  });

  const underlying = new MemoryStorage();
  const saved = saveDraftCognitionBatch(underlying, record);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const writeFailure: DraftSessionStorageLike = {
    get length() { return underlying.length; },
    key: index => underlying.key(index),
    getItem: key => underlying.getItem(key),
    setItem: (key, value) => underlying.setItem(key, value),
    removeItem() { throw new Error("storage removal failed"); },
  };
  assert.deepEqual(removeDraftsByBatch(writeFailure, record.ipId, record.batchId), {
    ok: false,
    code: "WRITE_FAILED",
  });
  assert.ok(underlying.getItem(saved.key));
});

test("按IP清除中途失败时回滚已删除草稿", async () => {
  const {
    saveDraftCognitionBatch,
    loadDraftCognitionBatches,
    clearAllDraftsForIP,
  } = await loadDraftStoreModule();
  const underlying = new MemoryStorage();
  const records = [
    makeRecord({
      ipId: "ip-a",
      sourceId: "source-rollback-a-1",
      analyzedAt: "2026-08-27T10:14:00.000Z",
    }),
    makeRecord({
      ipId: "ip-a",
      sourceId: "source-rollback-a-2",
      analyzedAt: "2026-08-27T10:15:00.000Z",
    }),
  ];
  records.forEach(record => {
    assert.equal(saveDraftCognitionBatch(underlying, record).ok, true);
  });
  let removalCount = 0;
  const partialFailure: DraftSessionStorageLike = {
    get length() { return underlying.length; },
    key: index => underlying.key(index),
    getItem: key => underlying.getItem(key),
    setItem: (key, value) => underlying.setItem(key, value),
    removeItem(key) {
      removalCount += 1;
      if (removalCount === 2) throw new Error("second removal failed");
      underlying.removeItem(key);
    },
  };

  assert.deepEqual(clearAllDraftsForIP(partialFailure, "ip-a"), {
    ok: false,
    code: "WRITE_FAILED",
  });
  assert.deepEqual(
    loadDraftCognitionBatches(underlying, "ip-a").records
      .map(record => record.batchId).sort(),
    records.map(record => record.batchId).sort(),
  );
});

test("草稿保存读取后桥接为幽灵节点", async () => {
  const { saveDraftCognitionBatch, loadDraftCognitionBatches } = await loadDraftStoreModule();
  const storage = new MemoryStorage();
  const record = makeRecord({
    ipId: "ip-a",
    sourceId: "source-draft-bridge",
    analyzedAt: "2026-08-27T10:16:00.000Z",
  });
  assert.equal(saveDraftCognitionBatch(storage, record).ok, true);

  const loaded = loadDraftCognitionBatches(storage, "ip-a");
  assert.equal(loaded.errorCode, null);
  assert.equal(loaded.records.length, 1);
  const restored = loaded.records[0]!;
  const graph = bridgeDraftCognitionGraph({
    batchId: restored.batchId,
    ipId: restored.ipId,
    analysis: restored.analysis,
  });

  assert.ok(graph.nodes.length > 0);
  assert.ok(graph.nodes.every(node => node.data.isDraft === true));
  assert.ok(graph.nodes.every(node => node.data.draftProvenance.batchId === record.batchId));
});

test("V2草稿往返读取后完整保留来源信息", async () => {
  const { saveDraftCognitionBatch, loadDraftCognitionBatches } = await loadDraftStoreModule();
  const storage = new MemoryStorage();
  const record: DraftCognitionSessionRecord = {
    ...makeRecord({
      ipId: "ip-a",
      sourceId: "source-metadata-round-trip",
      analyzedAt: "2026-08-27T10:17:00.000Z",
    }),
    sourceMetadata: {
      title: "  老师的完整课程资料  ",
      sourceKind: "课程内容",
      sourceName: "课程原稿.md",
      sourceUrl: "https://example.com/source",
    },
  };

  const saved = saveDraftCognitionBatch(storage, record);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.match(saved.key, /^FP_COGNITION_DRAFT_V2:[a-f0-9]{64}$/u);

  const loaded = loadDraftCognitionBatches(storage, "ip-a");
  assert.equal(loaded.metadataRequiredRecords.length, 0);
  assert.deepEqual(loaded.records[0]?.sourceMetadata, {
    title: "老师的完整课程资料",
    sourceKind: "课程内容",
    sourceName: "课程原稿.md",
    sourceUrl: "https://example.com/source",
  });
});

test("V1草稿只读识别为来源信息待补全且不改写原记录", async () => {
  const { loadDraftCognitionBatches } = await loadDraftStoreModule();
  const storage = new MemoryStorage();
  const legacy = makeLegacyRecord(makeRecord({
    ipId: "ip-a",
    sourceId: "source-legacy-metadata",
    analyzedAt: "2026-08-27T10:18:00.000Z",
  }));
  const key = legacyStorageKey(legacy);
  const serialized = JSON.stringify({
    ...legacy,
    sourceMetadata: undefined,
  });
  storage.setItem(key, serialized);

  const loaded = loadDraftCognitionBatches(storage, "ip-a");

  assert.equal(loaded.records.length, 0);
  assert.equal(loaded.corruptedRecordCount, 0);
  assert.equal(loaded.metadataRequiredRecords.length, 1);
  assert.equal(loaded.metadataRequiredRecords[0]?.status, "metadata_required");
  assert.equal(loaded.metadataRequiredRecords[0]?.record.batchId, legacy.batchId);
  assert.equal(loaded.metadataRequiredRecords[0]?.record.sourceMetadata, null);
  assert.equal(storage.getItem(key), serialized);
});

test("同批次同时存在V1和V2时只返回可确权的V2草稿", async () => {
  const { saveDraftCognitionBatch, loadDraftCognitionBatches } = await loadDraftStoreModule();
  const storage = new MemoryStorage();
  const current = makeRecord({
    ipId: "ip-a",
    sourceId: "source-version-dedup",
    analyzedAt: "2026-08-27T10:19:00.000Z",
  });
  const legacy = makeLegacyRecord(current, true);
  storage.setItem(legacyStorageKey(legacy), JSON.stringify(legacy));
  assert.equal(saveDraftCognitionBatch(storage, current).ok, true);

  const loaded = loadDraftCognitionBatches(storage, "ip-a");

  assert.deepEqual(loaded.records.map(record => record.batchId), [current.batchId]);
  assert.equal(loaded.metadataRequiredRecords.length, 0);
  assert.equal(storage.length, 2);
});

test("更新来源信息只覆盖元数据并保持批次身份和解析凭证", async () => {
  const {
    saveDraftCognitionBatch,
    loadDraftCognitionBatches,
    updateDraftSourceMetadata,
  } = await loadDraftStoreModule();
  const storage = new MemoryStorage();
  const record = makeRecord({
    ipId: "ip-a",
    sourceId: "source-update-metadata",
    analyzedAt: "2026-08-27T10:20:00.000Z",
  });
  const saved = saveDraftCognitionBatch(storage, record);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;

  const updated = updateDraftSourceMetadata(storage, "ip-a", record.batchId, {
    title: "  修改后的来源标题  ",
    sourceKind: "文章",
    sourceName: "老师文章",
    sourceUrl: "https://example.com/updated",
  });

  assert.deepEqual(updated, saved);
  assert.equal(storage.length, 1);
  const restored = loadDraftCognitionBatches(storage, "ip-a").records[0]!;
  assert.deepEqual(restored.sourceMetadata, {
    title: "修改后的来源标题",
    sourceKind: "文章",
    sourceName: "老师文章",
    sourceUrl: "https://example.com/updated",
  });
  assert.equal(restored.rawContent, record.rawContent);
  assert.deepEqual(restored.analysis, record.analysis);
  assert.equal(restored.analysisToken, record.analysisToken);
});

test("非法元数据和跨IP更新均不会改写草稿", async () => {
  const { saveDraftCognitionBatch, updateDraftSourceMetadata } = await loadDraftStoreModule();
  const storage = new MemoryStorage();
  const record = makeRecord({
    ipId: "ip-a",
    sourceId: "source-reject-metadata-update",
    analyzedAt: "2026-08-27T10:21:00.000Z",
  });
  const saved = saveDraftCognitionBatch(storage, record);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const originalSerialized = storage.getItem(saved.key);

  assert.deepEqual(updateDraftSourceMetadata(storage, "ip-a", record.batchId, {
    ...record.sourceMetadata,
    title: "   ",
  }), { ok: false, code: "INVALID_METADATA" });
  assert.deepEqual(updateDraftSourceMetadata(storage, "ip-b", record.batchId, {
    ...record.sourceMetadata,
    title: "不应写入的标题",
  }), { ok: false, code: "DRAFT_NOT_FOUND" });
  assert.equal(storage.getItem(saved.key), originalSerialized);
});

test("来源信息更新区分读取失败和容量不足", async () => {
  const { saveDraftCognitionBatch, updateDraftSourceMetadata } = await loadDraftStoreModule();
  const record = makeRecord({
    ipId: "ip-a",
    sourceId: "source-update-storage-errors",
    analyzedAt: "2026-08-27T10:22:00.000Z",
  });
  const readFailure: DraftSessionStorageLike = {
    get length(): number { throw new Error("storage blocked"); },
    key: () => null,
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  assert.deepEqual(updateDraftSourceMetadata(
    readFailure,
    record.ipId,
    record.batchId,
    record.sourceMetadata,
  ), { ok: false, code: "READ_FAILED" });

  const underlying = new MemoryStorage();
  const saved = saveDraftCognitionBatch(underlying, record);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const originalSerialized = underlying.getItem(saved.key);
  const quotaStorage: DraftSessionStorageLike = {
    get length() { return underlying.length; },
    key: index => underlying.key(index),
    getItem: key => underlying.getItem(key),
    setItem() {
      throw new DOMException("sessionStorage quota exceeded", "QuotaExceededError");
    },
    removeItem: key => underlying.removeItem(key),
  };

  assert.deepEqual(updateDraftSourceMetadata(
    quotaStorage,
    record.ipId,
    record.batchId,
    { ...record.sourceMetadata, title: "无法写入的新标题" },
  ), { ok: false, code: "QUOTA_EXCEEDED" });
  assert.equal(underlying.getItem(saved.key), originalSerialized);
});
