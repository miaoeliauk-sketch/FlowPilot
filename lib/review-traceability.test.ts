import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import {
  addKnowledgeEntry,
  addVideoReview,
  addScriptAsset,
  addEvaluatedTopicAsset,
  getVideoReviews,
  markReviewSavedToKnowledge,
  updateVideoReview,
} from "./ip-store";
import { addScriptAssetForTopic } from "./topic-script-link";
import { createValidTopicBoardResult } from "./topic-board-contract.fixture";
import {
  addVideoReviewForSource,
  assessVideoReviewTraceability,
  getLearningEligibleVideoReviews,
} from "./review-traceability";

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

test("四种追溯状态可区分，只有完整关联记录具备学习资格", () => {
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
  const external = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "external" },
    review: { ...reviewInput, title: "外部内容" },
  });
  const stored = JSON.parse(storage.getItem("ipwr:videoReviews") ?? "[]");
  storage.setItem("ipwr:videoReviews", JSON.stringify([
    ...stored,
    {
      ...traceable,
      id: "review-legacy",
      sourceType: undefined,
      traceabilityStatus: undefined,
      topicId: null,
      scriptId: null,
    },
    {
      ...traceable,
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
  assert.throws(
    () => markReviewSavedToKnowledge(traceable.id, otherIPKnowledge.id),
    /复盘与知识条目不属于同一IP/,
  );
});
