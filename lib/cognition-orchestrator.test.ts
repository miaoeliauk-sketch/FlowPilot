import assert from "node:assert/strict";
import test from "node:test";

import {
  loadDraftCognitionBatches,
  saveDraftCognitionBatch,
  type DraftCognitionSessionRecord,
  type DraftSessionStorageLike,
} from "./cognition-draft-session-store";
import { createDraftCognitionBatchId } from "./cognition-graph-bridge";
import { commitDraftCognitionBatch } from "./cognition-orchestrator";
import { calculateSHA256 } from "./sha256";
import type { IPSourceAnchor } from "./types";

class MemoryStorage implements DraftSessionStorageLike {
  readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

class FailingClearStorage extends MemoryStorage {
  override removeItem() { throw new Error("storage cleanup unavailable"); }
}

function anchor(quote: string): IPSourceAnchor {
  return { quote, startPosition: 0, endPosition: quote.length };
}

function makeReviewedDraft(): DraftCognitionSessionRecord {
  const ipId = "ip-pengpeng";
  const sourceId = "source-123";
  const rawContent = "持续输出来自真实问题。";
  const analyzedAt = "2026-08-28T05:00:00.000Z";
  const sourceHash = calculateSHA256(rawContent);
  return {
    schemaVersion: 2,
    batchId: createDraftCognitionBatchId({ ipId, sourceId, sourceHash, analyzedAt }),
    ipId,
    rawContent,
    sourceMetadata: {
      title: "持续输出来自真实问题",
      sourceKind: "课程内容",
      sourceName: "",
      sourceUrl: "",
    },
    analysis: {
      parserVersion: 2,
      analyzedAt,
      nonce: 2,
      sourceId,
      sourceHash,
      nodes: [{
        id: "11111111-1111-4111-8111-111111111111",
        question: {
          content: "持续输出来自哪里？",
          derivation: "inferred",
          anchors: [anchor(rawContent)],
        },
        claim: { content: rawContent, anchors: [anchor(rawContent)] },
        reasoning: { status: "not_provided", steps: [] },
        evidence: [],
        concepts: [],
        reviewStatus: "human_confirmed",
      }],
      aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
    },
    analysisToken: "fake-token-for-test",
  };
}

test("整批终审、正式写入和回读均成功后才清理草稿", async () => {
  const storage = new MemoryStorage();
  const draft = makeReviewedDraft();
  assert.equal(saveDraftCognitionBatch(storage, draft).ok, true);
  const progress: string[] = [];
  const verified = new Map<string, {
    id: string;
    ipId: string;
    rawContent: string;
    sourceFinalProof: string;
    sourceAnalysis: DraftCognitionSessionRecord["analysis"];
  }>();

  const result = await commitDraftCognitionBatch({
    storage,
    ipId: draft.ipId,
    batchId: draft.batchId,
    sourceMetadata: {
      title: "持续输出来自真实问题",
      sourceKind: "课程内容",
      sourceName: "",
      sourceUrl: "",
    },
    onProgress: status => progress.push(status),
  }, {
    finalize: async record => {
      assert.equal(record.analysisToken, "fake-token-for-test");
      return { finalProof: "fake-final-proof-for-test" };
    },
    persistVerified: async (record, _metadata, finalProof) => {
      verified.set(record.analysis.sourceId, {
        id: record.analysis.sourceId,
        ipId: record.ipId,
        rawContent: record.rawContent,
        sourceAnalysis: record.analysis,
        sourceFinalProof: finalProof,
      });
    },
    readVerified: async sourceId => verified.get(sourceId) ?? null,
  });

  assert.deepEqual(result, { ok: true, status: "COMMITTED" });
  assert.equal(verified.get(draft.analysis.sourceId)?.sourceFinalProof, "fake-final-proof-for-test");
  assert.equal(loadDraftCognitionBatches(storage, draft.ipId).records.length, 0);
  assert.deepEqual(progress, [
    "READING_DRAFT",
    "FINALIZING",
    "PERSISTING",
    "VERIFYING",
    "CLEANING",
    "COMPLETED",
  ]);
});

test("服务端终审失败时原样保留草稿且不写正式库", async () => {
  const storage = new MemoryStorage();
  const draft = makeReviewedDraft();
  assert.equal(saveDraftCognitionBatch(storage, draft).ok, true);
  let persistCalls = 0;

  await assert.rejects(
    commitDraftCognitionBatch({
      storage,
      ipId: draft.ipId,
      batchId: draft.batchId,
      sourceMetadata: {
        title: "持续输出来自真实问题",
        sourceKind: "课程内容",
        sourceName: "",
        sourceUrl: "",
      },
    }, {
      finalize: async () => { throw new Error("解析凭证无效或已过期"); },
      persistVerified: async () => { persistCalls += 1; },
      readVerified: async () => null,
    }),
    /解析凭证无效或已过期/u,
  );

  assert.equal(persistCalls, 0);
  assert.equal(loadDraftCognitionBatches(storage, draft.ipId).records.length, 1);
});

test("正式写入后的回读结果不完整时保留草稿", async () => {
  const storage = new MemoryStorage();
  const draft = makeReviewedDraft();
  assert.equal(saveDraftCognitionBatch(storage, draft).ok, true);
  let reads = 0;

  await assert.rejects(
    commitDraftCognitionBatch({
      storage,
      ipId: draft.ipId,
      batchId: draft.batchId,
      sourceMetadata: {
        title: "持续输出来自真实问题",
        sourceKind: "课程内容",
        sourceName: "",
        sourceUrl: "",
      },
    }, {
      finalize: async () => ({ finalProof: "fake-final-proof-for-test" }),
      persistVerified: async () => undefined,
      readVerified: async () => {
        reads += 1;
        return null;
      },
    }),
    /回读校验失败/u,
  );

  assert.equal(reads, 2);
  assert.equal(loadDraftCognitionBatches(storage, draft.ipId).records.length, 1);
});

test("正式认知已存在时重试只校验并清理草稿", async () => {
  const storage = new MemoryStorage();
  const draft = makeReviewedDraft();
  assert.equal(saveDraftCognitionBatch(storage, draft).ok, true);
  let finalizeCalls = 0;
  let persistCalls = 0;

  const result = await commitDraftCognitionBatch({
    storage,
    ipId: draft.ipId,
    batchId: draft.batchId,
    sourceMetadata: {
      title: "持续输出来自真实问题",
      sourceKind: "课程内容",
      sourceName: "",
      sourceUrl: "",
    },
  }, {
    finalize: async () => {
      finalizeCalls += 1;
      return { finalProof: "should-not-run" };
    },
    persistVerified: async () => { persistCalls += 1; },
    readVerified: async () => ({
      id: draft.analysis.sourceId,
      ipId: draft.ipId,
      rawContent: draft.rawContent,
      sourceFinalProof: "existing-final-proof",
      sourceAnalysis: draft.analysis,
    }),
  });

  assert.deepEqual(result, { ok: true, status: "COMMITTED" });
  assert.equal(finalizeCalls, 0);
  assert.equal(persistCalls, 0);
  assert.equal(loadDraftCognitionBatches(storage, draft.ipId).records.length, 0);
});

test("正式认知已保存但草稿清理失败时返回待清理状态", async () => {
  const storage = new FailingClearStorage();
  const draft = makeReviewedDraft();
  assert.equal(saveDraftCognitionBatch(storage, draft).ok, true);

  const result = await commitDraftCognitionBatch({
    storage,
    ipId: draft.ipId,
    batchId: draft.batchId,
    sourceMetadata: {
      title: "持续输出来自真实问题",
      sourceKind: "课程内容",
      sourceName: "",
      sourceUrl: "",
    },
  }, {
    finalize: async () => { throw new Error("should not finalize existing cognition"); },
    persistVerified: async () => { throw new Error("should not persist existing cognition"); },
    readVerified: async () => ({
      id: draft.analysis.sourceId,
      ipId: draft.ipId,
      rawContent: draft.rawContent,
      sourceFinalProof: "existing-final-proof",
      sourceAnalysis: draft.analysis,
    }),
  });

  assert.deepEqual(result, { ok: true, status: "COMMITTED_CLEANUP_PENDING" });
  assert.equal(loadDraftCognitionBatches(storage, draft.ipId).records.length, 1);
});

test("草稿缺少解析凭证时不会发起终审或清理记录", async () => {
  const storage = new MemoryStorage();
  const draft = makeReviewedDraft();
  const saved = saveDraftCognitionBatch(storage, draft);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const raw = JSON.parse(storage.getItem(saved.key)!) as Record<string, unknown>;
  delete raw.analysisToken;
  storage.setItem(saved.key, JSON.stringify(raw));
  let finalizeCalls = 0;

  await assert.rejects(
    commitDraftCognitionBatch({
      storage,
      ipId: draft.ipId,
      batchId: draft.batchId,
      sourceMetadata: {
        title: "持续输出来自真实问题",
        sourceKind: "课程内容",
        sourceName: "",
        sourceUrl: "",
      },
    }, {
      finalize: async () => {
        finalizeCalls += 1;
        return { finalProof: "should-not-run" };
      },
      persistVerified: async () => undefined,
      readVerified: async () => null,
    }),
    /找不到当前IP的认知草稿批次/u,
  );

  assert.equal(finalizeCalls, 0);
  assert.notEqual(storage.getItem(saved.key), null);
});
