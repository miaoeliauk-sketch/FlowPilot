import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import {
  addKnowledgeEntry,
  addEvaluatedTopicAsset,
  completeVideoReview,
  deferVideoReview,
  getKnowledgeEntries,
  getVideoReviews,
  markReviewSavedToKnowledge,
  restoreVideoReview,
  saveReviewExperienceToKnowledge,
  updateVideoReview,
} from "./ip-store";
import {
  addVideoReviewForSource,
  getLearningEligibleVideoReviews,
  getPendingManualVideoReviews,
} from "./review-traceability";
import { addScriptAssetForTopic } from "./topic-script-link";
import { createValidTopicBoardResult } from "./topic-board-contract.fixture";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  private readonly failingWrites = new Set<string>();
  private readonly delayedFailingWrites = new Map<string, number>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failingWrites.delete(key)) {
      throw new Error(`storage write failed: ${key}`);
    }
    const remainingSuccessfulWrites = this.delayedFailingWrites.get(key);
    if (remainingSuccessfulWrites === 0) {
      this.delayedFailingWrites.delete(key);
      throw new Error(`storage write failed: ${key}`);
    }
    if (remainingSuccessfulWrites !== undefined) {
      this.delayedFailingWrites.set(key, remainingSuccessfulWrites - 1);
    }
    this.values.set(key, value);
  }

  failNextWrite(key: string): void {
    this.failingWrites.add(key);
  }

  failWriteAfter(key: string, successfulWrites: number): void {
    this.delayedFailingWrites.set(key, successfulWrites);
  }

  clear(): void {
    this.values.clear();
    this.failingWrites.clear();
    this.delayedFailingWrites.clear();
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
  title: "已发布内容",
  platform: "视频号",
  publishedAt: "2026-08-22",
  videoUrl: "",
  contentDirection: "商业洞察",
  scriptText: "这是一段已经发布的脚本正文。",
  metrics: {
    views: 0,
    likes: 0,
    comments: 0,
    favorites: 0,
    shares: 0,
    newFollowers: 0,
    dms: 0,
    leads: 0,
    conversions: 0,
  },
  analysis: null,
};

function seedTraceableReview() {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: topic.ipId,
    title: "等待人工复盘的脚本",
    cover: "",
    content: reviewInput.scriptText,
    status: "定稿",
  });
  const review = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: reviewInput,
  });
  return { topic, script, review };
}

function createReviewKnowledgeInput(ipId: string) {
  return {
    category: "复盘经验库" as const,
    title: "人工确认的复盘经验",
    rawContent: "依据真实发布表现记录的人工复盘经验。",
    tags: [],
    keywords: [],
    ipId,
    sourceTier: "高" as const,
    sourceTierReason: "来自已完成人工复盘的发布内容",
    contentDirection: [],
    sourcePlatform: "视频号",
    sourceUrl: "",
    note: "",
    extractedAt: "2026-08-22T00:00:00.000Z",
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用" as const,
    dna: null,
  };
}

test("内部脚本登记发布后进入待复盘状态且不伪造人工依据", () => {
  const { topic, review } = seedTraceableReview();

  assert.equal(review.manualReviewStatus, "pending");
  assert.deepEqual(review.manualReviewTags, []);
  assert.equal(review.manualReviewNote, "");
  assert.equal(review.updatedAt, review.createdAt);
  assert.deepEqual(getVideoReviews(topic.ipId).map(item => item.id), [review.id]);
});

test("待复盘内容可以暂不复盘并恢复且始终更新同一条记录", () => {
  const { topic, review } = seedTraceableReview();

  const deferred = deferVideoReview(review.id);
  assert.equal(deferred.id, review.id);
  assert.equal(deferred.manualReviewStatus, "deferred");
  assert.deepEqual(deferred.manualReviewTags, []);
  assert.equal(deferred.manualReviewNote, "");

  const restored = restoreVideoReview(review.id);
  assert.equal(restored.id, review.id);
  assert.equal(restored.manualReviewStatus, "pending");
  assert.deepEqual(getVideoReviews(topic.ipId).map(item => item.id), [review.id]);
});

test("完成人工复盘时拒绝空白文字说明且不改变待复盘记录", () => {
  const { topic, review } = seedTraceableReview();

  assert.throws(
    () => completeVideoReview(review.id, {
      tags: ["标题结构有效"],
      note: "   ",
    }),
    /文字说明不能为空/,
  );
  const [stored] = getVideoReviews(topic.ipId);
  assert.equal(stored?.manualReviewStatus, "pending");
  assert.deepEqual(stored?.manualReviewTags, []);
  assert.equal(stored?.manualReviewNote, "");
});

test("完成人工复盘时拒绝纯符号和单字重复的无意义说明", () => {
  const { review } = seedTraceableReview();

  assert.throws(
    () => completeVideoReview(review.id, {
      tags: ["其他"],
      note: "！！！……",
    }),
    /请填写有实际内容的复盘说明/,
  );
  assert.throws(
    () => completeVideoReview(review.id, {
      tags: ["其他"],
      note: "哈哈哈哈",
    }),
    /请填写有实际内容的复盘说明/,
  );
});

test("完成人工复盘时至少选择一个真实原因标签", () => {
  const { topic, review } = seedTraceableReview();

  assert.throws(
    () => completeVideoReview(review.id, {
      tags: [],
      note: "标题在前3秒清楚表达了冲突点。",
    }),
    /至少选择一个复盘标签/,
  );
  assert.equal(getVideoReviews(topic.ipId)[0]?.manualReviewStatus, "pending");
});

test("存储入口拒绝写入约定范围外的人工复盘标签", () => {
  const { topic, review } = seedTraceableReview();
  const unsafeComplete = completeVideoReview as unknown as (
    id: string,
    input: { tags: unknown; note: unknown },
  ) => unknown;

  assert.throws(
    () => unsafeComplete(review.id, {
      tags: ["系统自动判断有效"],
      note: "这不是用户确认的标签。",
    }),
    /复盘标签无效/,
  );
  assert.equal(getVideoReviews(topic.ipId)[0]?.manualReviewStatus, "pending");
});

test("人工复盘支持多选并在修改时更新原记录而不制造重复复盘", () => {
  const { topic, review } = seedTraceableReview();

  const completed = completeVideoReview(review.id, {
    tags: ["标题结构有效", "标题结构有效", "表达风格贴合IP"],
    note: "  标题结构带来更高点击，表达也符合当前IP。  ",
  });
  assert.equal(completed.manualReviewStatus, "completed");
  assert.deepEqual(completed.manualReviewTags, ["标题结构有效", "表达风格贴合IP"]);
  assert.equal(completed.manualReviewNote, "标题结构带来更高点击，表达也符合当前IP。");

  const modified = completeVideoReview(review.id, {
    tags: ["引用具体案例或经典原文"],
    note: "修改后确认，主要依据是正文中的真实案例。",
  });
  assert.equal(modified.id, review.id);
  assert.equal(modified.createdAt, review.createdAt);
  assert.deepEqual(modified.manualReviewTags, ["引用具体案例或经典原文"]);
  assert.equal(getVideoReviews(topic.ipId).length, 1);
});

test("历史旧复盘读取时标记为待补人工复盘且不伪造标签和说明", () => {
  const { topic, review } = seedTraceableReview();
  const [stored] = JSON.parse(storage.getItem("ipwr:videoReviews") ?? "[]") as Array<Record<string, unknown>>;
  delete stored?.manualReviewStatus;
  delete stored?.manualReviewTags;
  delete stored?.manualReviewNote;
  delete stored?.updatedAt;
  storage.setItem("ipwr:videoReviews", JSON.stringify([stored]));

  const [migrated] = getVideoReviews(topic.ipId);
  assert.equal(migrated?.id, review.id);
  assert.equal(migrated?.manualReviewStatus, "legacy_needs_manual_review");
  assert.deepEqual(migrated?.manualReviewTags, []);
  assert.equal(migrated?.manualReviewNote, "");
  assert.equal(migrated?.updatedAt, review.createdAt);
});

test("待复盘清单只返回当前IP内部可追溯且仍待处理的发布内容", () => {
  const first = seedTraceableReview();
  const second = seedTraceableReview();
  deferVideoReview(second.review.id);
  addVideoReviewForSource({
    activeIPId: first.topic.ipId,
    source: { type: "external" },
    review: { ...reviewInput, title: "外部发布内容" },
  });

  assert.deepEqual(
    getPendingManualVideoReviews(first.topic.ipId).map(item => item.id),
    [first.review.id],
  );
});

test("只有已完成人工复盘且内部关联可信的记录可以参与学习", () => {
  const pending = seedTraceableReview();
  const deferred = seedTraceableReview();
  deferVideoReview(deferred.review.id);
  const completed = seedTraceableReview();
  completeVideoReview(completed.review.id, {
    tags: ["选题角度新颖"],
    note: "发布后的真实数据证明这个选题角度值得继续观察。",
  });
  const legacy = seedTraceableReview();
  const broken = seedTraceableReview();
  completeVideoReview(broken.review.id, {
    tags: ["标题结构有效"],
    note: "这条记录随后会被模拟成关联损坏。",
  });
  const external = addVideoReviewForSource({
    activeIPId: pending.topic.ipId,
    source: { type: "external" },
    review: { ...reviewInput, title: "外部内容复盘" },
  });
  completeVideoReview(external.id, {
    tags: ["发布时间平台选得好"],
    note: "外部内容即使完成人工复盘也不能进入学习闭环。",
  });

  const stored = JSON.parse(storage.getItem("ipwr:videoReviews") ?? "[]") as Array<Record<string, unknown>>;
  storage.setItem("ipwr:videoReviews", JSON.stringify(stored.map(item => {
    if (item.id === legacy.review.id) {
      const migratedLegacy = { ...item };
      delete migratedLegacy.manualReviewStatus;
      delete migratedLegacy.manualReviewTags;
      delete migratedLegacy.manualReviewNote;
      delete migratedLegacy.updatedAt;
      return migratedLegacy;
    }
    return item.id === broken.review.id
      ? { ...item, scriptId: "missing-script" }
      : item;
  })));

  assert.deepEqual(
    getLearningEligibleVideoReviews(pending.topic.ipId).map(item => item.id),
    [completed.review.id],
  );
});

test("通用更新入口不能绕过人工复盘契约伪造已完成状态", () => {
  const { topic, review } = seedTraceableReview();
  const unsafeUpdate = updateVideoReview as unknown as (
    id: string,
    patch: Record<string, unknown>,
  ) => void;

  assert.throws(
    () => unsafeUpdate(review.id, {
      manualReviewStatus: "completed",
      manualReviewTags: ["标题结构有效"],
      manualReviewNote: "",
    }),
    /不能修改复盘归属、追溯或人工复盘契约字段/,
  );
  assert.equal(getVideoReviews(topic.ipId)[0]?.manualReviewStatus, "pending");
});

test("同一脚本再次保存复盘时保留已确认的人工依据并只更新原记录", () => {
  const { topic, script, review } = seedTraceableReview();
  const completed = completeVideoReview(review.id, {
    tags: ["引用具体案例或经典原文"],
    note: "正文引用的真实案例带来了更高收藏。",
  });

  const savedAgain = addVideoReviewForSource({
    activeIPId: topic.ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: { ...reviewInput, title: "更新后的同一内容复盘" },
  });

  assert.equal(savedAgain.id, review.id);
  assert.equal(savedAgain.createdAt, review.createdAt);
  assert.equal(savedAgain.manualReviewStatus, "completed");
  assert.deepEqual(savedAgain.manualReviewTags, completed.manualReviewTags);
  assert.equal(savedAgain.manualReviewNote, completed.manualReviewNote);
  assert.equal(getVideoReviews(topic.ipId).length, 1);
});

test("未完成人工复盘的记录不能通过旧入口写入经验库", () => {
  const { topic, review } = seedTraceableReview();
  const knowledge = addKnowledgeEntry({
    category: "复盘经验库",
    title: "不应被关联的经验",
    rawContent: "待复盘记录不能直接进入经验库。",
    tags: [],
    keywords: [],
    ipId: topic.ipId,
    sourceTier: "高",
    sourceTierReason: "测试",
    contentDirection: [],
    sourcePlatform: "视频号",
    sourceUrl: "",
    note: "",
    extractedAt: "2026-08-22T00:00:00.000Z",
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
  });

  assert.throws(
    () => markReviewSavedToKnowledge(review.id, knowledge.id),
    /只有已完成人工复盘的内部内容才能进入学习知识库/,
  );
  assert.equal(getVideoReviews(topic.ipId)[0]?.savedToKnowledge, false);
});

test("暂不复盘状态必须先恢复后才能完成复盘", () => {
  const { topic, review } = seedTraceableReview();
  deferVideoReview(review.id);

  assert.throws(
    () => completeVideoReview(review.id, {
      tags: ["表达风格贴合IP"],
      note: "不能绕过恢复动作直接完成。",
    }),
    /请先恢复为待复盘/,
  );
  assert.equal(getVideoReviews(topic.ipId)[0]?.manualReviewStatus, "deferred");

  restoreVideoReview(review.id);
  assert.equal(
    completeVideoReview(review.id, {
      tags: ["表达风格贴合IP"],
      note: "恢复后可以正常完成复盘。",
    }).manualReviewStatus,
    "completed",
  );
});

test("通用复盘更新写入失败时明确报错且不伪装成功", () => {
  const { topic, review } = seedTraceableReview();
  storage.failNextWrite("ipwr:videoReviews");

  assert.throws(
    () => updateVideoReview(review.id, { title: "不应假装保存成功的新标题" }),
    /复盘更新保存失败/,
  );
  assert.equal(getVideoReviews(topic.ipId)[0]?.title, review.title);
});

test("知识库保存标记写入失败时明确报错且不伪装已入库", () => {
  const { topic, review } = seedTraceableReview();
  completeVideoReview(review.id, {
    tags: ["引用具体案例或经典原文"],
    note: "人工确认后才尝试显式保存到经验库。",
  });
  const knowledge = addKnowledgeEntry({
    category: "复盘经验库",
    title: "等待关联的复盘经验",
    rawContent: "存储失败时不能显示已入库。",
    tags: [], keywords: [], ipId: topic.ipId,
    sourceTier: "高", sourceTierReason: "测试", contentDirection: [],
    sourcePlatform: "视频号", sourceUrl: "", note: "",
    extractedAt: "2026-08-22T00:00:00.000Z",
    metrics: null, viralEvaluation: null, usageRecords: [],
    status: "未使用", dna: null,
  });
  storage.failNextWrite("ipwr:videoReviews");

  assert.throws(
    () => markReviewSavedToKnowledge(review.id, knowledge.id),
    /知识库标记保存失败/,
  );
  const [stored] = getVideoReviews(topic.ipId);
  assert.equal(stored?.savedToKnowledge, false);
  assert.equal(stored?.knowledgeEntryId, null);
});

test("复盘经验整体保存成功时同时产生唯一知识条目和复盘关联", () => {
  const { topic, review } = seedTraceableReview();
  completeVideoReview(review.id, {
    tags: ["选题角度新颖"],
    note: "该角度获得了真实发布数据支持。",
  });

  const knowledge = saveReviewExperienceToKnowledge(
    review.id,
    createReviewKnowledgeInput(topic.ipId),
  );

  assert.deepEqual(getKnowledgeEntries().map(item => item.id), [knowledge.id]);
  const [storedReview] = getVideoReviews(topic.ipId);
  assert.equal(storedReview?.savedToKnowledge, true);
  assert.equal(storedReview?.knowledgeEntryId, knowledge.id);
});

test("复盘经验第一步写入失败时严格报错且不产生任何关联", () => {
  const { topic, review } = seedTraceableReview();
  completeVideoReview(review.id, {
    tags: ["选题角度新颖"],
    note: "该角度获得了真实发布数据支持。",
  });
  storage.failNextWrite("ipwr:knowledgeEntries");

  assert.throws(
    () => saveReviewExperienceToKnowledge(
      review.id,
      createReviewKnowledgeInput(topic.ipId),
    ),
    /知识条目保存失败/,
  );
  assert.deepEqual(getKnowledgeEntries(), []);
  const [storedReview] = getVideoReviews(topic.ipId);
  assert.equal(storedReview?.savedToKnowledge, false);
  assert.equal(storedReview?.knowledgeEntryId, null);
});

test("复盘经验保存成功后重复操作直接返回原关联且不新增知识", () => {
  const { topic, review } = seedTraceableReview();
  completeVideoReview(review.id, {
    tags: ["选题角度新颖"],
    note: "该角度获得了真实发布数据支持。",
  });
  const input = createReviewKnowledgeInput(topic.ipId);

  const first = saveReviewExperienceToKnowledge(review.id, input);
  const second = saveReviewExperienceToKnowledge(review.id, input);

  assert.equal(second.id, first.id);
  assert.deepEqual(getKnowledgeEntries().map(item => item.id), [first.id]);
  assert.equal(getVideoReviews(topic.ipId)[0]?.knowledgeEntryId, first.id);
});

test("复盘关联写入失败时整体保存会回滚新建知识且不留残存", () => {
  const { topic, review } = seedTraceableReview();
  completeVideoReview(review.id, {
    tags: ["选题角度新颖"],
    note: "该角度获得了真实发布数据支持。",
  });
  storage.failNextWrite("ipwr:videoReviews");

  assert.throws(
    () => saveReviewExperienceToKnowledge(
      review.id,
      createReviewKnowledgeInput(topic.ipId),
    ),
    /知识库标记保存失败/,
  );

  assert.deepEqual(getKnowledgeEntries(), []);
  const [storedReview] = getVideoReviews(topic.ipId);
  assert.equal(storedReview?.savedToKnowledge, false);
  assert.equal(storedReview?.knowledgeEntryId, null);
});

test("复盘关联和知识回滚都失败时明确告知可能存在待清理知识", () => {
  const { topic, review } = seedTraceableReview();
  completeVideoReview(review.id, {
    tags: ["选题角度新颖"],
    note: "该角度获得了真实发布数据支持。",
  });
  storage.failNextWrite("ipwr:videoReviews");
  storage.failWriteAfter("ipwr:knowledgeEntries", 1);

  assert.throws(
    () => saveReviewExperienceToKnowledge(
      review.id,
      createReviewKnowledgeInput(topic.ipId),
    ),
    /关联失败且知识回滚失败.*可能存在待清理知识.*前往知识库检查/,
  );
  const [residual] = getKnowledgeEntries("复盘经验库");
  assert.ok(residual);

  const retried = saveReviewExperienceToKnowledge(
    review.id,
    createReviewKnowledgeInput(topic.ipId),
  );

  assert.equal(retried.id, residual.id);
  assert.deepEqual(getKnowledgeEntries("复盘经验库").map(item => item.id), [residual.id]);
  assert.equal(getVideoReviews(topic.ipId)[0]?.knowledgeEntryId, residual.id);
});
