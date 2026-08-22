import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import {
  addKnowledgeEntry,
  addVideoReview,
  addScriptAsset,
  addEvaluatedTopicAsset,
  completeVideoReview,
  deleteVideoReview,
  getKnowledgeEntries,
  getVideoReviews,
  markReviewSavedToKnowledge,
  recordKnowledgeUsage,
  updateVideoReview,
} from "./ip-store";
import { addScriptAssetForTopic } from "./topic-script-link";
import { createValidTopicBoardResult } from "./topic-board-contract.fixture";
import {
  addVideoReviewForSource,
  assessVideoReviewTraceability,
  getVideoReviewKnowledgeEffect,
  getLearningEligibleVideoReviews,
} from "./review-traceability";
import type { VideoReview } from "./types";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  private readonly failingWrites = new Set<string>();
  private readonly writeCounts = new Map<string, number>();
  private readonly failingWriteNumbers = new Map<string, Set<number>>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    const writeNumber = (this.writeCounts.get(key) ?? 0) + 1;
    this.writeCounts.set(key, writeNumber);
    if (this.failingWrites.delete(key)) {
      throw new Error(`storage write failed: ${key}`);
    }
    const failingNumbers = this.failingWriteNumbers.get(key);
    if (failingNumbers?.delete(writeNumber)) {
      throw new Error(`storage write failed: ${key}#${writeNumber}`);
    }
    this.values.set(key, value);
  }

  failNextWrite(key: string): void {
    this.failingWrites.add(key);
  }

  failWriteNumber(key: string, writeNumber: number): void {
    const failingNumbers = this.failingWriteNumbers.get(key) ?? new Set<number>();
    failingNumbers.add(writeNumber);
    this.failingWriteNumbers.set(key, failingNumbers);
  }

  clear(): void {
    this.values.clear();
    this.failingWrites.clear();
    this.writeCounts.clear();
    this.failingWriteNumbers.clear();
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

const reviewInput = {
  title: "发布后的真实内容",
  platform: "视频号",
  publishedAt: "2026-08-20",
  videoUrl: "",
  contentDirection: "认知分享",
  scriptText: "这是一段已经发布的口播稿。",
  metrics: {
    views: 1000,
    likes: 100,
    comments: 10,
    favorites: 20,
    shares: 5,
    newFollowers: 8,
    dms: 0,
    leads: 0,
    conversions: 0,
  },
  analysis: null,
};

function addReviewKnowledge(ipId: string) {
  return addKnowledgeEntry({
    category: "复盘经验库",
    title: "复盘经验",
    rawContent: "真实发布后的复盘结论。",
    tags: [],
    keywords: [],
    ipId,
    sourceTier: "高",
    sourceTierReason: "测试",
    contentDirection: [],
    sourcePlatform: "视频号",
    sourceUrl: "",
    note: "",
    extractedAt: "2026-08-20T00:00:00.000Z",
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
  });
}

function seedDuplicateReviewWithKnowledge(suffix: string) {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const knowledge = addReviewKnowledge(topic.ipId);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: topic.ipId,
    title: `读时维护失败测试脚本-${suffix}`,
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
    knowledgeTracking: {
      status: "unavailable",
      candidateKnowledgeEntryIds: [knowledge.id],
      verifiedAt: "2026-08-20T08:00:00.000Z",
      usages: [],
    },
  });
  recordKnowledgeUsage(knowledge.id, {
    module: "脚本工厂",
    usedAt: "2026-08-20T08:00:00.000Z",
    reason: "脚本生成成功",
    relevanceTier: "高度相关",
    relevanceReason: "与脚本主题直接相关",
    context: topic.title,
  }, "已用于脚本", script.id);
  const older = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: { ...reviewInput, title: `维护失败时保留的旧复盘-${suffix}` },
  });
  const newest = {
    ...older,
    id: `review-maintenance-newest-${suffix}`,
    title: `查询仍返回的最新复盘-${suffix}`,
    createdAt: "2099-08-22T12:00:00.000Z",
  };
  const storedReviews = JSON.parse(
    storage.getItem("ipwr:videoReviews") ?? "[]",
  ) as VideoReview[];
  storage.setItem("ipwr:videoReviews", JSON.stringify([...storedReviews, newest]));
  return { topic, knowledge, script, older, newest };
}

test("FlowPilot内部脚本保存复盘时写入完整选题链并标记可追溯", () => {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: topic.ipId,
    title: "已发布脚本",
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
  });

  const saved = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: reviewInput,
  });

  assert.equal(saved.ipId, topic.ipId);
  assert.equal(saved.scriptId, script.id);
  assert.equal(saved.topicId, topic.id);
  assert.equal(saved.sourceType, "flowpilot");
  assert.equal(saved.traceabilityStatus, "traceable");
  assert.deepEqual(getVideoReviews(topic.ipId).map(item => item.id), [saved.id]);
});

test("内部脚本发布复盘后把真实表现关联到该脚本的知识使用记录", () => {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const knowledge = addReviewKnowledge(topic.ipId);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: topic.ipId,
    title: "使用知识后发布的脚本",
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
    knowledgeTracking: {
      status: "unavailable",
      candidateKnowledgeEntryIds: [knowledge.id],
      verifiedAt: "2026-08-20T08:00:00.000Z",
      usages: [],
    },
  });
  recordKnowledgeUsage(knowledge.id, {
    module: "脚本工厂",
    usedAt: "2026-08-20T08:00:00.000Z",
    reason: "生成成功后记录",
    relevanceTier: "高度相关",
    relevanceReason: "与脚本主题直接相关",
    context: topic.title,
  }, "已用于脚本", script.id);

  const saved = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: reviewInput,
  });

  const usage = getKnowledgeEntries()
    .find(entry => entry.id === knowledge.id)
    ?.usageRecords.find(record => record.scriptId === script.id);
  assert.equal(usage?.topicId, topic.id);
  assert.equal(usage?.reviewId, saved.id);
  assert.deepEqual(getVideoReviewKnowledgeEffect(saved), {
    status: "tracked",
    knowledgeEntries: [{
      id: knowledge.id,
      title: knowledge.title,
      category: knowledge.category,
    }],
  });
});

test("复盘没有真正写入时绝不回填知识关联ID", () => {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const knowledge = addReviewKnowledge(topic.ipId);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: topic.ipId,
    title: "复盘写入失败的脚本",
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
    knowledgeTracking: {
      status: "unavailable",
      candidateKnowledgeEntryIds: [knowledge.id],
      verifiedAt: "2026-08-20T08:00:00.000Z",
      usages: [],
    },
  });
  recordKnowledgeUsage(knowledge.id, {
    module: "脚本工厂",
    usedAt: "2026-08-20T08:00:00.000Z",
    reason: "脚本生成成功",
    relevanceTier: "高度相关",
    relevanceReason: "与脚本主题直接相关",
    context: topic.title,
  }, "已用于脚本", script.id);
  storage.failNextWrite("ipwr:videoReviews");

  assert.throws(() => addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: reviewInput,
  }), /复盘保存失败/);

  assert.deepEqual(getVideoReviews(topic.ipId), []);
  const usage = getKnowledgeEntries()
    .find(entry => entry.id === knowledge.id)
    ?.usageRecords.find(record => record.scriptId === script.id);
  assert.equal(usage?.reviewId, null);
});

test("同一脚本只保留一份有效复盘且删除后可以重新建立知识关联", () => {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const knowledge = addReviewKnowledge(topic.ipId);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: topic.ipId,
    title: "只保留一份有效复盘的脚本",
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
    knowledgeTracking: {
      status: "unavailable",
      candidateKnowledgeEntryIds: [knowledge.id],
      verifiedAt: "2026-08-20T08:00:00.000Z",
      usages: [],
    },
  });
  recordKnowledgeUsage(knowledge.id, {
    module: "脚本工厂",
    usedAt: "2026-08-20T08:00:00.000Z",
    reason: "脚本生成成功",
    relevanceTier: "高度相关",
    relevanceReason: "与脚本主题直接相关",
    context: topic.title,
  }, "已用于脚本", script.id);

  const first = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: { ...reviewInput, title: "第一次复盘" },
  });
  const updated = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: { ...reviewInput, title: "更新后的有效复盘" },
  });

  assert.equal(updated.id, first.id);
  assert.deepEqual(
    getVideoReviews(topic.ipId).map(review => review.title),
    ["更新后的有效复盘"],
  );
  let usage = getKnowledgeEntries()
    .find(entry => entry.id === knowledge.id)
    ?.usageRecords.find(record => record.scriptId === script.id);
  assert.equal(usage?.reviewId, updated.id);

  deleteVideoReview(updated.id);
  assert.deepEqual(getVideoReviews(topic.ipId), []);
  usage = getKnowledgeEntries()
    .find(entry => entry.id === knowledge.id)
    ?.usageRecords.find(record => record.scriptId === script.id);
  assert.equal(usage?.reviewId, null);

  const recreated = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: { ...reviewInput, title: "删除后重新复盘" },
  });
  usage = getKnowledgeEntries()
    .find(entry => entry.id === knowledge.id)
    ?.usageRecords.find(record => record.scriptId === script.id);
  assert.equal(usage?.reviewId, recreated.id);
});

test("历史上同一脚本已有多条复盘时保存会彻底收口为最新一条", () => {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: topic.ipId,
    title: "存在历史重复复盘的脚本",
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
  });
  const first = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: { ...reviewInput, title: "历史较早复盘" },
  });
  const newestHistoricalId = "review-historical-newest";
  storage.setItem("ipwr:videoReviews", JSON.stringify([
    first,
    {
      ...first,
      id: newestHistoricalId,
      title: "历史较新复盘",
      createdAt: "2099-08-21T12:00:00.000Z",
    },
  ]));

  const saved = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: { ...reviewInput, title: "本次更新后的唯一复盘" },
  });

  const reviews = getVideoReviews(topic.ipId);
  assert.equal(saved.id, newestHistoricalId);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0]?.id, newestHistoricalId);
  assert.equal(reviews[0]?.title, "本次更新后的唯一复盘");
});

test("直接读取历史重复复盘时会自动清理并只返回最新一条", () => {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: topic.ipId,
    title: "读取时收口历史重复复盘的脚本",
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
  });
  const older = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: { ...reviewInput, title: "读取时应被清理的旧复盘" },
  });
  const newest = {
    ...older,
    id: "review-read-dedup-newest",
    title: "读取时应保留的最新复盘",
    createdAt: "2099-08-22T12:00:00.000Z",
  };
  storage.setItem("ipwr:videoReviews", JSON.stringify([older, newest]));

  const reviews = getVideoReviews(topic.ipId);

  assert.deepEqual(reviews.map(review => review.id), [newest.id]);
  assert.deepEqual(
    JSON.parse(storage.getItem("ipwr:videoReviews") ?? "[]")
      .map((review: VideoReview) => review.id),
    [newest.id],
  );
});

test("读时收口会先把旧复盘的知识关联迁移到保留复盘", () => {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const knowledge = addReviewKnowledge(topic.ipId);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: topic.ipId,
    title: "需要迁移历史知识关联的脚本",
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
    knowledgeTracking: {
      status: "unavailable",
      candidateKnowledgeEntryIds: [knowledge.id],
      verifiedAt: "2026-08-20T08:00:00.000Z",
      usages: [],
    },
  });
  recordKnowledgeUsage(knowledge.id, {
    module: "脚本工厂",
    usedAt: "2026-08-20T08:00:00.000Z",
    reason: "脚本生成成功",
    relevanceTier: "高度相关",
    relevanceReason: "与脚本主题直接相关",
    context: topic.title,
  }, "已用于脚本", script.id);
  const older = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: { ...reviewInput, title: "知识仍关联在这里的旧复盘" },
  });
  const newest = {
    ...older,
    id: "review-relocation-newest",
    title: "迁移后保留的最新复盘",
    createdAt: "2099-08-22T12:00:00.000Z",
    knowledgeEffectStatus: "no_linked_knowledge" as const,
  };
  storage.setItem("ipwr:videoReviews", JSON.stringify([older, newest]));

  const reviews = getVideoReviews(topic.ipId);

  assert.deepEqual(reviews.map(review => review.id), [newest.id]);
  const usage = getKnowledgeEntries()
    .find(entry => entry.id === knowledge.id)
    ?.usageRecords.find(record => record.scriptId === script.id);
  assert.equal(usage?.reviewId, newest.id);
  assert.equal(getVideoReviewKnowledgeEffect(reviews[0]!).status, "tracked");
});

test("知识关联迁移失败时不清理复盘且不阻断查询", () => {
  const { topic, knowledge, script, older, newest } =
    seedDuplicateReviewWithKnowledge("relocation-failure");
  storage.failNextWrite("ipwr:knowledgeEntries");

  const reviews = getVideoReviews(topic.ipId);

  assert.deepEqual(reviews.map(review => review.id), [newest.id]);
  assert.deepEqual(
    JSON.parse(storage.getItem("ipwr:videoReviews") ?? "[]")
      .map((review: VideoReview) => review.id),
    [older.id, newest.id],
  );
  const usage = getKnowledgeEntries()
    .find(entry => entry.id === knowledge.id)
    ?.usageRecords.find(record => record.scriptId === script.id);
  assert.equal(usage?.reviewId, older.id);
});

test("复盘清理失败时回滚知识迁移且不阻断查询", () => {
  const { topic, knowledge, script, older, newest } =
    seedDuplicateReviewWithKnowledge("cleanup-failure");
  storage.failNextWrite("ipwr:videoReviews");

  const reviews = getVideoReviews(topic.ipId);

  assert.deepEqual(reviews.map(review => review.id), [newest.id]);
  assert.deepEqual(
    JSON.parse(storage.getItem("ipwr:videoReviews") ?? "[]")
      .map((review: VideoReview) => review.id),
    [older.id, newest.id],
  );
  const usage = getKnowledgeEntries()
    .find(entry => entry.id === knowledge.id)
    ?.usageRecords.find(record => record.scriptId === script.id);
  assert.equal(usage?.reviewId, older.id);
});

test("读时收口拒绝迁移legacy未验证记录且不会标记为tracked", () => {
  const { topic, knowledge, script, newest } =
    seedDuplicateReviewWithKnowledge("legacy-unverified");
  const storedEntries = JSON.parse(
    storage.getItem("ipwr:knowledgeEntries") ?? "[]",
  ) as Array<{ id: string; usageRecords: Array<Record<string, unknown>> }>;
  storage.setItem("ipwr:knowledgeEntries", JSON.stringify(
    storedEntries.map(entry => entry.id === knowledge.id
      ? {
          ...entry,
          usageRecords: entry.usageRecords.map(record =>
            record.scriptId === script.id
              ? { ...record, trackingStatus: "legacy_unverified" }
              : record
          ),
        }
      : entry),
  ));

  const reviews = getVideoReviews(topic.ipId);

  assert.deepEqual(reviews.map(review => review.id), [newest.id]);
  const usage = getKnowledgeEntries()
    .find(entry => entry.id === knowledge.id)
    ?.usageRecords.find(record => record.scriptId === script.id);
  assert.equal(usage?.reviewId, null);
  assert.equal(reviews[0]?.knowledgeEffectStatus, "no_linked_knowledge");
  assert.equal(getVideoReviewKnowledgeEffect(reviews[0]!).status, "not_counted");
});

test("读时收口拒绝迁移跨IP知识记录且不会标记为tracked", () => {
  const { topic, knowledge, script, newest } =
    seedDuplicateReviewWithKnowledge("cross-ip");
  const storedEntries = JSON.parse(
    storage.getItem("ipwr:knowledgeEntries") ?? "[]",
  ) as Array<{ id: string; ipId: string | null }>;
  storage.setItem("ipwr:knowledgeEntries", JSON.stringify(
    storedEntries.map(entry => entry.id === knowledge.id
      ? { ...entry, ipId: "ip-other" }
      : entry),
  ));

  const reviews = getVideoReviews(topic.ipId);

  const usage = getKnowledgeEntries()
    .find(entry => entry.id === knowledge.id)
    ?.usageRecords.find(record => record.scriptId === script.id);
  assert.equal(usage?.reviewId, null);
  assert.equal(reviews.find(review => review.id === newest.id)?.knowledgeEffectStatus, "no_linked_knowledge");
});

test("多组重复复盘收口时只迁移各自通过统一校验的知识关联", () => {
  const trusted = seedDuplicateReviewWithKnowledge("multi-trusted");
  const candidateMismatch = seedDuplicateReviewWithKnowledge("multi-candidate");
  const topicMismatch = seedDuplicateReviewWithKnowledge("multi-topic");
  const storedScripts = JSON.parse(
    storage.getItem("ipwr:scriptAssets") ?? "[]",
  ) as Array<{
    id: string;
    knowledgeTracking: { candidateKnowledgeEntryIds: string[] };
  }>;
  storage.setItem("ipwr:scriptAssets", JSON.stringify(
    storedScripts.map(script => script.id === candidateMismatch.script.id
      ? {
          ...script,
          knowledgeTracking: {
            ...script.knowledgeTracking,
            candidateKnowledgeEntryIds: [],
          },
        }
      : script),
  ));
  const storedEntries = JSON.parse(
    storage.getItem("ipwr:knowledgeEntries") ?? "[]",
  ) as Array<{ id: string; usageRecords: Array<Record<string, unknown>> }>;
  storage.setItem("ipwr:knowledgeEntries", JSON.stringify(
    storedEntries.map(entry => entry.id === topicMismatch.knowledge.id
      ? {
          ...entry,
          usageRecords: entry.usageRecords.map(record =>
            record.scriptId === topicMismatch.script.id
              ? { ...record, topicId: "topic-mismatch" }
              : record
          ),
        }
      : entry),
  ));

  const reviews = getVideoReviews();
  const entries = getKnowledgeEntries();

  assert.deepEqual(
    new Set(reviews.map(review => review.id)),
    new Set([
      trusted.newest.id,
      candidateMismatch.newest.id,
      topicMismatch.newest.id,
    ]),
  );
  const reviewIdFor = (knowledgeId: string, scriptId: string) => entries
    .find(entry => entry.id === knowledgeId)
    ?.usageRecords.find(record => record.scriptId === scriptId)?.reviewId;
  assert.equal(reviewIdFor(trusted.knowledge.id, trusted.script.id), trusted.newest.id);
  assert.equal(reviewIdFor(candidateMismatch.knowledge.id, candidateMismatch.script.id), null);
  assert.equal(reviewIdFor(topicMismatch.knowledge.id, topicMismatch.script.id), null);
  const statusById = new Map(reviews.map(review => [review.id, review.knowledgeEffectStatus]));
  assert.equal(statusById.get(trusted.newest.id), "tracked");
  assert.equal(statusById.get(candidateMismatch.newest.id), "no_linked_knowledge");
  assert.equal(statusById.get(topicMismatch.newest.id), "no_linked_knowledge");
});

test("删除复盘时知识关联清理失败会保留原复盘并明确报错", () => {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const knowledge = addReviewKnowledge(topic.ipId);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: topic.ipId,
    title: "删除关联失败时必须保留的脚本",
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
    knowledgeTracking: {
      status: "unavailable",
      candidateKnowledgeEntryIds: [knowledge.id],
      verifiedAt: "2026-08-20T08:00:00.000Z",
      usages: [],
    },
  });
  recordKnowledgeUsage(knowledge.id, {
    module: "脚本工厂",
    usedAt: "2026-08-20T08:00:00.000Z",
    reason: "脚本生成成功",
    relevanceTier: "高度相关",
    relevanceReason: "与脚本主题直接相关",
    context: topic.title,
  }, "已用于脚本", script.id);
  const saved = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: reviewInput,
  });
  storage.failNextWrite("ipwr:knowledgeEntries");

  assert.throws(
    () => deleteVideoReview(saved.id),
    /知识关联清理失败，复盘未删除/,
  );

  assert.deepEqual(getVideoReviews(topic.ipId).map(review => review.id), [saved.id]);
  const usage = getKnowledgeEntries()
    .find(entry => entry.id === knowledge.id)
    ?.usageRecords.find(record => record.scriptId === script.id);
  assert.equal(usage?.reviewId, saved.id);
});

test("复盘成功但知识关联写入失败时明确标记为知识关联暂不可用", () => {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const knowledge = addReviewKnowledge(topic.ipId);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: topic.ipId,
    title: "知识关联写入失败的脚本",
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
    knowledgeTracking: {
      status: "unavailable",
      candidateKnowledgeEntryIds: [knowledge.id],
      verifiedAt: "2026-08-20T08:00:00.000Z",
      usages: [],
    },
  });
  recordKnowledgeUsage(knowledge.id, {
    module: "脚本工厂",
    usedAt: "2026-08-20T08:00:00.000Z",
    reason: "脚本生成成功",
    relevanceTier: "高度相关",
    relevanceReason: "与脚本主题直接相关",
    context: topic.title,
  }, "已用于脚本", script.id);
  storage.failNextWrite("ipwr:knowledgeEntries");

  const saved = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: reviewInput,
  });

  assert.deepEqual(getVideoReviews(topic.ipId).map(review => review.id), [saved.id]);
  assert.deepEqual(getVideoReviewKnowledgeEffect(saved), {
    status: "not_counted",
    knowledgeEntries: [],
    reason: "knowledge_unavailable",
  });
});

test("知识关联成功但复盘状态保存失败时展示部分完成并在读取时自动恢复", () => {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const knowledge = addReviewKnowledge(topic.ipId);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: topic.ipId,
    title: "关联成功但状态待同步的脚本",
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
    knowledgeTracking: {
      status: "unavailable",
      candidateKnowledgeEntryIds: [knowledge.id],
      verifiedAt: "2026-08-20T08:00:00.000Z",
      usages: [],
    },
  });
  recordKnowledgeUsage(knowledge.id, {
    module: "脚本工厂",
    usedAt: "2026-08-20T08:00:00.000Z",
    reason: "脚本生成成功",
    relevanceTier: "高度相关",
    relevanceReason: "与脚本主题直接相关",
    context: topic.title,
  }, "已用于脚本", script.id);
  storage.failWriteNumber("ipwr:videoReviews", 2);

  const saved = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: reviewInput,
  });

  assert.deepEqual(getVideoReviewKnowledgeEffect(saved), {
    status: "tracked_status_pending",
    knowledgeEntries: [{
      id: knowledge.id,
      title: knowledge.title,
      category: knowledge.category,
    }],
  });
  assert.equal(
    getKnowledgeEntries()
      .find(entry => entry.id === knowledge.id)
      ?.usageRecords.find(record => record.scriptId === script.id)
      ?.reviewId,
    saved.id,
  );

  const [repaired] = getVideoReviews(topic.ipId);
  assert.equal(repaired?.knowledgeEffectStatus, "tracked");
  assert.equal(getVideoReviewKnowledgeEffect(repaired!).status, "tracked");
});

test("复盘回填只接受归属一致且可信的知识使用记录", () => {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const trustedKnowledge = addReviewKnowledge(topic.ipId);
  const legacyKnowledge = addReviewKnowledge(topic.ipId);
  const otherIPKnowledge = addReviewKnowledge("ip-other");
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: topic.ipId,
    title: "需要防止跨IP串联的脚本",
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
    knowledgeTracking: {
      status: "unavailable",
      candidateKnowledgeEntryIds: [
        trustedKnowledge.id,
        legacyKnowledge.id,
        otherIPKnowledge.id,
      ],
      verifiedAt: "2026-08-20T08:00:00.000Z",
      usages: [],
    },
  });
  for (const knowledge of [trustedKnowledge, legacyKnowledge]) {
    recordKnowledgeUsage(knowledge.id, {
      module: "脚本工厂",
      usedAt: "2026-08-20T08:00:00.000Z",
      reason: "脚本生成成功",
      relevanceTier: "高度相关",
      relevanceReason: "与脚本主题直接相关",
      context: topic.title,
    }, "已用于脚本", script.id);
  }
  const storedEntries = getKnowledgeEntries().map(entry => {
    if (entry.id === legacyKnowledge.id) {
      return {
        ...entry,
        usageRecords: entry.usageRecords.map(record => ({
          ...record,
          trackingStatus: "legacy_unverified",
        })),
      };
    }
    if (entry.id === otherIPKnowledge.id) {
      return {
        ...entry,
        usageRecords: [{
          id: "forged-cross-ip-usage",
          module: "脚本工厂",
          usedAt: "2026-08-20T08:00:00.000Z",
          reason: "伪造关联",
          relevanceTier: "高度相关",
          relevanceReason: "伪造关联",
          context: topic.title,
          trackingStatus: "module_recorded",
          topicId: topic.id,
          scriptId: script.id,
          reviewId: null,
          usageType: null,
          sectionLabel: null,
          evidenceExcerpt: null,
        }],
      };
    }
    return entry;
  });
  storage.setItem("ipwr:knowledgeEntries", JSON.stringify(storedEntries));

  const saved = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: reviewInput,
  });

  const entriesById = new Map(getKnowledgeEntries().map(entry => [entry.id, entry]));
  assert.equal(entriesById.get(trustedKnowledge.id)?.usageRecords[0]?.reviewId, saved.id);
  assert.equal(entriesById.get(legacyKnowledge.id)?.usageRecords[0]?.reviewId, null);
  assert.equal(entriesById.get(otherIPKnowledge.id)?.usageRecords[0]?.reviewId, null);
  assert.deepEqual(
    getVideoReviewKnowledgeEffect(saved).status,
    "tracked",
  );
});

test("外部或临时内容明确保存为不可追溯且不伪造选题关联", () => {
  const saved = addVideoReviewForSource({
    activeIPId: "ip-shuimuran",
    source: { type: "external" },
    review: reviewInput,
  });

  assert.equal(saved.ipId, "ip-shuimuran");
  assert.equal(saved.scriptId, null);
  assert.equal(saved.topicId, null);
  assert.equal(saved.sourceType, "external");
  assert.equal(saved.traceabilityStatus, "external_untraceable");
});

test("知识关联暂时不可读取时仍保存复盘并明确不计入知识使用统计", () => {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: topic.ipId,
    title: "知识关联暂不可用的脚本",
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
  });
  storage.setItem("ipwr:knowledgeEntries", "{damaged-json");

  const saved = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: reviewInput,
  });

  assert.deepEqual(getVideoReviews(topic.ipId).map(review => review.id), [saved.id]);
  assert.deepEqual(getVideoReviewKnowledgeEffect(saved), {
    status: "not_counted",
    knowledgeEntries: [],
    reason: "knowledge_unavailable",
  });
});

test("未关联选题的内部脚本被拒绝且不写入复盘", () => {
  const script = addScriptAsset({
    ipId: "ip-shuimuran",
    title: "没有来源选题的脚本",
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
  });

  assert.throws(
    () => addVideoReviewForSource({
      activeIPId: script.ipId,
      source: { type: "flowpilot", scriptId: script.id },
      review: reviewInput,
    }),
    /没有关联选题/,
  );
  assert.deepEqual(getVideoReviews(script.ipId), []);
});

test("其他IP不能借用当前IP的脚本和选题创建复盘", () => {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: topic.ipId,
    title: "只属于原IP的脚本",
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
  });

  assert.throws(
    () => addVideoReviewForSource({
      activeIPId: "ip-other",
      source: { type: "flowpilot", scriptId: script.id },
      review: reviewInput,
    }),
    /没有找到属于当前IP的脚本/,
  );
  assert.deepEqual(getVideoReviews(topic.ipId), []);
  assert.deepEqual(getVideoReviews("ip-other"), []);
});

test("四种追溯状态可区分，只有关联完整且完成人工复盘的记录具备学习资格", () => {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: topic.ipId,
    title: "可追溯脚本",
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
  });
  const traceable = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: reviewInput,
  });
  const completedTraceable = completeVideoReview(traceable.id, {
    tags: ["选题角度新颖"],
    note: "人工确认该选题角度与真实发布表现有关。",
  });
  const external = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "external" },
    review: { ...reviewInput, title: "外部内容" },
  });
  const stored = JSON.parse(storage.getItem("ipwr:videoReviews") ?? "[]");
  storage.setItem("ipwr:videoReviews", JSON.stringify([
    ...stored,
    {
      ...completedTraceable,
      id: "review-legacy",
      sourceType: undefined,
      traceabilityStatus: undefined,
      topicId: null,
      scriptId: null,
    },
    {
      ...completedTraceable,
      id: "review-broken",
      scriptId: "script-missing",
    },
  ]));

  const reviews = getVideoReviews(topic.ipId);
  const byId = new Map(reviews.map(item => [item.id, item]));
  assert.equal(assessVideoReviewTraceability(byId.get(traceable.id)!), "traceable");
  assert.equal(assessVideoReviewTraceability(byId.get(external.id)!), "external_untraceable");
  assert.equal(assessVideoReviewTraceability(byId.get("review-legacy")!), "legacy_missing_link");
  assert.equal(assessVideoReviewTraceability(byId.get("review-broken")!), "broken_link");
  assert.deepEqual(
    getLearningEligibleVideoReviews(topic.ipId).map(item => item.id),
    [traceable.id],
  );
});

test("底层保存接口拒绝绕过来源契约的新复盘", () => {
  const unsafeAdd = addVideoReview as unknown as (input: Record<string, unknown>) => unknown;

  assert.throws(
    () => unsafeAdd({
      ...reviewInput,
      ipId: "ip-shuimuran",
      topicId: null,
      scriptId: null,
    }),
    /复盘来源契约不完整/,
  );
  assert.deepEqual(getVideoReviews("ip-shuimuran"), []);
});

test("底层更新接口拒绝修改复盘归属和追溯字段", () => {
  const saved = addVideoReviewForSource({
    activeIPId: "ip-shuimuran",
    source: { type: "external" },
    review: reviewInput,
  });
  const unsafeUpdate = updateVideoReview as unknown as (
    id: string,
    patch: Record<string, unknown>,
  ) => void;

  assert.throws(
    () => unsafeUpdate(saved.id, {
      ipId: "ip-other",
      sourceType: "flowpilot",
      topicId: "topic-forged",
      scriptId: "script-forged",
      traceabilityStatus: "traceable",
    }),
    /不能修改复盘归属/,
  );
  assert.deepEqual(getVideoReviews("ip-shuimuran").map(item => item.id), [saved.id]);
  assert.deepEqual(getVideoReviews("ip-other"), []);
});

test("知识关联拒绝跨IP条目和不可追溯复盘", () => {
  const external = addVideoReviewForSource({
    activeIPId: "ip-shuimuran",
    source: { type: "external" },
    review: reviewInput,
  });
  const sameIPKnowledge = addReviewKnowledge("ip-shuimuran");
  const otherIPKnowledge = addReviewKnowledge("ip-other");

  assert.throws(
    () => markReviewSavedToKnowledge(external.id, sameIPKnowledge.id),
    /只有可追溯复盘才能进入学习知识库/,
  );

  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: topic.ipId,
    title: "内部脚本",
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
  });
  const traceable = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: reviewInput,
  });
  completeVideoReview(traceable.id, {
    tags: ["引用具体案例或经典原文"],
    note: "先完成可信人工复盘，再单独验证跨IP归属保护。",
  });
  assert.throws(
    () => markReviewSavedToKnowledge(traceable.id, otherIPKnowledge.id),
    /复盘与知识条目不属于同一IP/,
  );
});
