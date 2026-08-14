import assert from "node:assert/strict";
import test from "node:test";
import {
  LiveClipStorageError,
  createClipPlans,
  createEmptyLiveClipState,
  loadLiveClipState,
  saveLiveClipState,
} from "./live-clips-store";
import { LIVE_CLIP_STORAGE_KEY, type ClipCandidate, type LiveTranscript } from "./live-clips-types";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const transcript: LiveTranscript = {
  id: "live-1", title: "8月10日直播", ipId: "ip-1", platform: "抖音",
  rawTranscript: "原始逐字稿", cleanedTranscript: "原始逐字稿", hasTimecode: false,
  sourceType: "paste", targetDuration: "1—3分钟", preferredClipTypes: ["opinion"],
  paragraphs: [{
    paragraphNumber: 1, text: "原始逐字稿", rawLine: "原始逐字稿", startOffset: 0, endOffset: 6,
    startTime: null, endTime: null, startSeconds: null, endSeconds: null,
  }],
  analysisStatus: "imported", createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z",
};

const candidate: ClipCandidate = {
  id: "candidate-1", liveTranscriptId: "live-1", topicBlockId: "topic-1", topic: "主题",
  structureRole: "golden_quote",
  clipType: "opinion", secondaryTags: [], recommendation: "强烈建议切",
  dimensions: { completeness: "强", hookStrength: "强", pointClarity: "强", informationDensity: "强", tension: "中", ipFit: "强" },
  recommendReason: "值得剪", primaryPurpose: "信任建立",
  primaryPurposeEvidence: { paragraphNumber: 1, quote: "原始逐字稿" },
  secondaryPurpose: null, secondaryPurposeEvidence: null,
  startTime: null, endTime: null, startParagraph: 1, endParagraph: 1,
  estimatedDurationSeconds: 20, durationBasis: "text-estimate", corePoint: "核心观点",
  startQuote: "原始", endQuote: "逐字稿", rawClipText: "原始逐字稿", cleanedClipText: "原始逐字稿",
  removeSuggestions: [], titleSuggestions: ["标题1", "标题2", "标题3"], coverSuggestions: ["封面1", "封面2"],
  createdAt: "2026-08-11T00:00:00.000Z",
};

test("原始逐字稿状态写入后立即回读校验，并能完整恢复", () => {
  const storage = new MemoryStorage();
  const state = { ...createEmptyLiveClipState(), activeLiveTranscriptId: transcript.id, liveTranscripts: [transcript] };
  saveLiveClipState(state, storage);

  assert.ok(storage.getItem(LIVE_CLIP_STORAGE_KEY)?.includes("原始逐字稿"));
  assert.deepEqual(loadLiveClipState(storage), state);
});

test("旧版候选缺少内容目的字段时仍可读取并安全补为空值", () => {
  const storage = new MemoryStorage();
  const legacyCandidate = { ...candidate } as Record<string, unknown>;
  delete legacyCandidate.primaryPurpose;
  delete legacyCandidate.primaryPurposeEvidence;
  delete legacyCandidate.secondaryPurpose;
  delete legacyCandidate.secondaryPurposeEvidence;
  delete legacyCandidate.structureRole;
  const partialCandidate = { ...candidate, id: "candidate-partial", primaryPurposeEvidence: undefined };
  const legacyPlan = {
    id: "plan-old", liveTranscriptId: "live-1", clipCandidateId: "candidate-1", ipId: "ip-1",
    topic: "旧方案", clipType: "opinion", recommendation: "可以考虑", startTime: null, endTime: null,
    startParagraph: 1, endParagraph: 1, corePoint: "旧观点", rawClipText: "原始逐字稿",
    cleanedClipText: "原始逐字稿", removeSuggestions: [], titleSuggestions: ["旧标题"],
    coverSuggestions: ["旧封面"], userAccepted: true, createdAt: "2026-08-11T00:00:00.000Z",
  };
  storage.setItem(LIVE_CLIP_STORAGE_KEY, JSON.stringify({
    ...createEmptyLiveClipState(),
    clipCandidates: [legacyCandidate, partialCandidate],
    clipPlans: [legacyPlan],
  }));

  const restored = loadLiveClipState(storage);
  assert.equal(restored.clipCandidates[0].primaryPurpose, null);
  assert.equal(restored.clipCandidates[0].primaryPurposeEvidence, null);
  assert.equal(restored.clipCandidates[0].secondaryPurpose, null);
  assert.equal(restored.clipCandidates[0].structureRole, null);
  assert.equal(restored.clipCandidates[1].primaryPurpose, null);
  assert.equal(restored.clipCandidates[1].primaryPurposeEvidence, null);
  assert.equal(restored.clipPlans[0].primaryPurpose, null);
  assert.equal(restored.clipPlans[0].secondaryPurposeEvidence, null);
  assert.equal(restored.clipPlans[0].structureRole, null);
});

test("旧版分块和主题缺少细分原因时补为null，已保存原因刷新后保留", () => {
  const storage = new MemoryStorage();
  storage.setItem(LIVE_CLIP_STORAGE_KEY, JSON.stringify({
    ...createEmptyLiveClipState(),
    transcriptChunks: [{
      id: "chunk-old", liveTranscriptId: "live-1", paragraphNumbers: [1],
      ownedStartParagraph: 1, ownedEndParagraph: 1, startParagraph: 1, endParagraph: 1,
      startTime: null, endTime: null, text: "原文", status: "failed",
      errorStage: "TOPIC_ANALYSIS_FAIL", errorCause: "SCHEMA_FAIL", removalSuggestions: [],
    }],
    topicBlocks: [{
      id: "topic-reason", liveTranscriptId: "live-1", title: "主题", summary: "摘要",
      startTime: null, endTime: null, startParagraph: 1, endParagraph: 1,
      keywords: ["原文"], mainPoint: "观点", sourceChunkIds: ["chunk-old"],
      candidateStatus: "failed", candidateError: "SCHEMA_FAIL",
      candidateErrorReason: "START_QUOTE_NOT_FOUND", createdAt: "2026-08-11T00:00:00.000Z",
    }, {
      id: "topic-invalid-reason", liveTranscriptId: "live-1", title: "主题2", summary: "摘要2",
      startTime: null, endTime: null, startParagraph: 1, endParagraph: 1,
      keywords: ["原文"], mainPoint: "观点2", sourceChunkIds: ["chunk-old"],
      candidateStatus: "failed", candidateError: "SCHEMA_FAIL",
      candidateErrorReason: "UNKNOWN_REASON", createdAt: "2026-08-11T00:00:00.000Z",
    }],
  }));

  const restored = loadLiveClipState(storage);
  assert.equal(restored.transcriptChunks[0].errorReason, null);
  assert.equal(restored.topicBlocks[0].candidateErrorReason, "START_QUOTE_NOT_FOUND");
  assert.equal(restored.topicBlocks[1].candidateErrorReason, null);
});

test("浏览器拒绝写入时抛出明确错误，不伪装成保存成功", () => {
  const storage = {
    getItem: () => null,
    setItem: () => { throw new Error("quota exceeded"); },
    removeItem: () => undefined,
  };
  assert.throws(
    () => saveLiveClipState(createEmptyLiveClipState(), storage),
    (error: unknown) => error instanceof LiveClipStorageError && error.code === "WRITE_FAILED",
  );
});

test("损坏的本地直播切片数据会停止读取，不用空数据覆盖", () => {
  const storage = new MemoryStorage();
  storage.setItem(LIVE_CLIP_STORAGE_KEY, "{broken");
  assert.throws(
    () => loadLiveClipState(storage),
    (error: unknown) => error instanceof LiveClipStorageError && error.code === "CORRUPTED",
  );
});

test("只有用户勾选的候选会生成正式ClipPlan，重复生成不会重复追加", () => {
  const state = {
    ...createEmptyLiveClipState(),
    activeLiveTranscriptId: transcript.id,
    liveTranscripts: [transcript],
    clipCandidates: [candidate, { ...candidate, id: "candidate-2", topic: "另一个主题" }],
  };
  const first = createClipPlans(state, "live-1", ["candidate-1"], {
    createId: () => "plan-1",
    now: () => "2026-08-11T01:00:00.000Z",
  });
  const second = createClipPlans(first, "live-1", ["candidate-1"], {
    createId: () => "plan-2",
    now: () => "2026-08-11T02:00:00.000Z",
  });

  assert.equal(first.clipPlans.length, 1);
  assert.equal(first.clipPlans[0].clipCandidateId, "candidate-1");
  assert.equal(first.clipPlans[0].ipId, "ip-1");
  assert.equal(first.clipPlans[0].primaryPurpose, "信任建立");
  assert.equal(first.clipPlans[0].structureRole, "golden_quote");
  assert.deepEqual(first.clipPlans[0].primaryPurposeEvidence, { paragraphNumber: 1, quote: "原始逐字稿" });
  assert.equal(second.clipPlans.length, 1);
  assert.equal(second.clipPlans[0].id, "plan-1");
});

test("浏览器不支持randomUUID时仍能生成唯一的正式切片方案编号", () => {
  const originalCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto) },
  });
  try {
    const state = {
      ...createEmptyLiveClipState(),
      activeLiveTranscriptId: transcript.id,
      liveTranscripts: [transcript],
      clipCandidates: [candidate, { ...candidate, id: "candidate-2", topic: "另一个主题" }],
    };
    const result = createClipPlans(state, transcript.id, ["candidate-1", "candidate-2"]);
    assert.equal(result.clipPlans.length, 2);
    assert.notEqual(result.clipPlans[0].id, result.clipPlans[1].id);
    assert.ok(result.clipPlans.every(plan => plan.id.length > 0));
  } finally {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: originalCrypto });
  }
});
