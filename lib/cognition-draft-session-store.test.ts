import assert from "node:assert/strict";
import test from "node:test";

import {
  bridgeDraftCognitionGraph,
  createDraftCognitionBatchId,
} from "./cognition-graph-bridge";
import { calculateSHA256 } from "./sha256";
import type { IPSourceAnalysisV2, IPSourceAnchor } from "./types";

const storeModulePath = "./cognition-draft-session-store";
const STORAGE_KEY_PREFIX = "FP_COGNITION_DRAFT_V1:";

interface DraftSessionStorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface DraftCognitionSessionRecord {
  schemaVersion: 1;
  batchId: string;
  ipId: string;
  rawContent: string;
  analysis: IPSourceAnalysisV2;
  analysisToken: string;
}

type SaveDraftResult =
  | { ok: true; key: string }
  | { ok: false; code: "QUOTA_EXCEEDED" | "WRITE_FAILED" };

type RemoveDraftResult =
  | { ok: true; removedCount: number }
  | { ok: false; code: "READ_FAILED" | "WRITE_FAILED" };

interface LoadDraftResult {
  records: DraftCognitionSessionRecord[];
  corruptedRecordCount: number;
  errorCode: "READ_FAILED" | null;
}

type DraftStoreModule = {
  saveDraftCognitionBatch: (
    storage: DraftSessionStorageLike | null,
    record: DraftCognitionSessionRecord,
  ) => SaveDraftResult;
  loadDraftCognitionBatches: (
    storage: DraftSessionStorageLike | null,
    ipId: string,
  ) => LoadDraftResult;
  removeDraftsByBatch: (
    storage: DraftSessionStorageLike | null,
    ipId: string,
    batchId: string,
  ) => RemoveDraftResult;
  clearAllDraftsForIP: (
    storage: DraftSessionStorageLike | null,
    ipId: string,
  ) => RemoveDraftResult;
};

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
    schemaVersion: 1,
    batchId: createDraftCognitionBatchId({
      ipId: input.ipId,
      sourceId: input.sourceId,
      sourceHash: analysis.sourceHash,
      analyzedAt: input.analyzedAt,
    }),
    ipId: input.ipId,
    rawContent,
    analysis,
    analysisToken: input.token ?? "fake-token-for-test",
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
  assert.match(firstSave.key, /^FP_COGNITION_DRAFT_V1:[a-f0-9]{64}$/u);

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

  const brokenKey = `${STORAGE_KEY_PREFIX}broken-json`;
  const futureKey = `${STORAGE_KEY_PREFIX}future-schema`;
  const missingTokenKey = `${STORAGE_KEY_PREFIX}missing-token`;
  const brokenRaw = "{broken";
  const futureRaw = JSON.stringify({ ...ipARecords[0], schemaVersion: 2 });
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
  storage.setItem(`${STORAGE_KEY_PREFIX}${"f".repeat(64)}`, serialized);

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
    key: () => `${STORAGE_KEY_PREFIX}${"a".repeat(64)}`,
    getItem() { throw new Error("storage read failed"); },
    setItem: () => undefined,
    removeItem: () => undefined,
  };

  assert.deepEqual(loadDraftCognitionBatches(lengthFailure, "ip-a"), {
    records: [],
    corruptedRecordCount: 0,
    errorCode: "READ_FAILED",
  });
  assert.deepEqual(loadDraftCognitionBatches(readFailure, "ip-a"), {
    records: [],
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
  const brokenKey = `${STORAGE_KEY_PREFIX}keep-broken`;
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
  const brokenKey = `${STORAGE_KEY_PREFIX}keep-broken-after-clear`;
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
