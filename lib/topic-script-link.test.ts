import assert from "node:assert/strict";
import test from "node:test";
import {
  addEvaluatedTopicAsset,
  addScriptAsset,
  addTopicAsset,
  getScriptAssets,
  updateTopicAssetStatus,
} from "./ip-store";
import { createValidTopicBoardResult } from "./topic-board-contract.fixture";
import {
  addScriptAssetForTopic,
  resolveTopicForScript,
  TopicScriptLinkError,
} from "./topic-script-link";

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

test.beforeEach(() => {
  storage.clear();
});

test.after(() => {
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else delete (globalThis as Record<string, unknown>).window;

  if (previousLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
  } else {
    delete (globalThis as Record<string, unknown>).localStorage;
  }
});

test("已评估选题保存脚本时写入真实topicId和相同IP", () => {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);

  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: boardResult.ipId,
    title: "从选题生成的脚本",
    cover: "封面",
    content: "脚本正文",
    status: "草稿",
    scriptResult: { generationStatus: "complete" },
  });

  assert.equal(script.topicId, topic.id);
  assert.equal(script.ipId, topic.ipId);
  assert.deepEqual(getScriptAssets(topic.ipId).map(asset => asset.id), [script.id]);
});

test("选题IP与脚本IP不一致时拒绝写入", () => {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);

  assert.throws(
    () => addScriptAssetForTopic({
      topicId: topic.id,
      ipId: "ip-other",
      title: "错误关联",
      cover: "",
      content: "不应写入",
      status: "草稿",
    }),
    (error: unknown) =>
      error instanceof TopicScriptLinkError && error.code === "TOPIC_IP_MISMATCH",
  );

  assert.equal(getScriptAssets(topic.ipId).length, 0);
  assert.equal(getScriptAssets("ip-other").length, 0);
});

test("草稿、已拍摄和已废弃选题不能建立脚本关联", () => {
  const boardResult = createValidTopicBoardResult();
  const draft = addTopicAsset({
    ipId: boardResult.ipId,
    title: "草稿选题",
    source: "manual",
  });
  const filmed = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: "已拍摄选题",
    source: "manual",
  }, boardResult);
  updateTopicAssetStatus(filmed.id, "已采用");
  updateTopicAssetStatus(filmed.id, "已拍摄");
  const discarded = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: "已废弃选题",
    source: "manual",
  }, boardResult);
  updateTopicAssetStatus(discarded.id, "已废弃");

  for (const topic of [draft, filmed, discarded]) {
    assert.throws(
      () => addScriptAssetForTopic({
        topicId: topic.id,
        ipId: topic.ipId,
        title: "不应保存",
        cover: "",
        content: "不应写入",
        status: "草稿",
      }),
      (error: unknown) =>
        error instanceof TopicScriptLinkError && error.code === "TOPIC_NOT_ELIGIBLE",
    );
  }

  assert.equal(getScriptAssets(boardResult.ipId).length, 0);
});

test("已采用选题可以解析为脚本工厂的选题来源", () => {
  const boardResult = createValidTopicBoardResult();
  const evaluated = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const adopted = updateTopicAssetStatus(evaluated.id, "已采用");
  assert.ok(adopted);

  const resolved = resolveTopicForScript(adopted.id, adopted.ipId);

  assert.equal(resolved.id, adopted.id);
  assert.equal(resolved.ipId, adopted.ipId);
  assert.equal(resolved.status, "已采用");
  assert.equal(resolved.title, boardResult.topic);
});

test("空字符串和非字符串ID在读取存储前被拒绝", () => {
  const unsafeResolve = resolveTopicForScript as unknown as (
    topicId: unknown,
    activeIPId: unknown,
  ) => unknown;

  for (const invalidTopicId of ["", false, 0]) {
    assert.throws(
      () => unsafeResolve(invalidTopicId, "ip-shuimuran"),
      (error: unknown) =>
        error instanceof TopicScriptLinkError && error.code === "INVALID_TOPIC_ID",
    );
  }
  for (const invalidIPId of ["", false, 0]) {
    assert.throws(
      () => unsafeResolve("topic-id", invalidIPId),
      (error: unknown) =>
        error instanceof TopicScriptLinkError && error.code === "INVALID_IP_ID",
    );
  }
});

test("保存时使用选题存储中的标准topicId和ipId", () => {
  const boardResult = createValidTopicBoardResult();
  const topic = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);

  const script = addScriptAssetForTopic({
    topicId: `  ${topic.id}  `,
    ipId: `  ${topic.ipId}  `,
    title: "标准关联ID",
    cover: "",
    content: "脚本正文",
    status: "草稿",
  });

  assert.equal(script.topicId, topic.id);
  assert.equal(script.ipId, topic.ipId);
  assert.equal(getScriptAssets(topic.ipId).length, 1);
});

test("不存在的选题返回稳定错误且不写入脚本", () => {
  assert.throws(
    () => resolveTopicForScript("topic-missing", "ip-shuimuran"),
    (error: unknown) =>
      error instanceof TopicScriptLinkError && error.code === "TOPIC_NOT_FOUND",
  );
  assert.equal(getScriptAssets("ip-shuimuran").length, 0);
});

test("评估结果损坏的旧选题不能建立脚本关联", () => {
  const now = new Date().toISOString();
  storage.setItem("ipwr:topicAssets", JSON.stringify([{
    id: "topic-invalid-history",
    ipId: "ip-shuimuran",
    title: "损坏的历史选题",
    source: "manual",
    status: "已评估",
    boardResult: { contractVersion: 1 },
    createdAt: now,
    updatedAt: now,
  }]));

  assert.throws(
    () => resolveTopicForScript("topic-invalid-history", "ip-shuimuran"),
    (error: unknown) =>
      error instanceof TopicScriptLinkError && error.code === "TOPIC_NOT_ELIGIBLE",
  );
  assert.equal(getScriptAssets("ip-shuimuran").length, 0);
});

test("未关联选题的原有脚本保存流程保持兼容", () => {
  const script = addScriptAsset({
    ipId: "ip-shuimuran",
    title: "手工输入选题生成的脚本",
    cover: "",
    content: "脚本正文",
    status: "草稿",
  });

  assert.equal(script.topicId, undefined);
  assert.equal(getScriptAssets("ip-shuimuran").length, 1);
});
