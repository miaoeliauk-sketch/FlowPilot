import assert from "node:assert/strict";
import test from "node:test";
import {
  addTopicAsset,
  addEvaluatedTopicAsset,
  getTopicAsset,
  getTopicAssets,
  saveTopicAssetContentAdaptationStrict,
  TopicAssetUpdateError,
  updateTopicAssetContentAdaptationStrict,
  updateTopicAssetEvaluation,
  updateTopicAssetStatus,
} from "./ip-store";
import type { ContentAdaptationAssessment } from "./content-adaptation";
import { TopicBoardContractError } from "./topic-board-contract";
import { createValidTopicBoardResult } from "./topic-board-contract.fixture";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

function createContentAdaptationAssessment(key: string): ContentAdaptationAssessment {
  return {
    key,
    contentProfile: {
      primaryTrack: "财经商业",
      secondaryTrack: "职场成长",
      fineTags: ["商业机会", "职业选择"],
      targetAudience: "正在判断职业机会的职场人",
      audienceTags: ["职场人", "机会判断"],
      primaryPurpose: "信任建立",
      secondaryPurpose: "流量增长",
      reasons: {
        track: "选题围绕机会判断和商业趋势展开。",
        audience: "内容直接服务于正在做职业选择的人。",
        purpose: "通过可验证的判断方法建立专业信任。",
      },
    },
    ipFit: {
      tier: "高度匹配",
      reason: "与当前IP的商业洞察定位和目标人群一致。",
    },
  };
}

test("内容适配通过受控入口单独补写并保留原评分结果", () => {
  storage.clear();
  const boardResult = createValidTopicBoardResult();
  const asset = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const evaluatedAt = asset.evaluationSummary?.evaluatedAt;
  const topicUpdatedAt = asset.updatedAt;

  const saved = saveTopicAssetContentAdaptationStrict({
    topicAssetId: asset.id,
    activeIPId: asset.ipId,
    expectedTitle: asset.title,
    assessment: createContentAdaptationAssessment(asset.id),
    generatedAt: "2026-08-26T20:00:00.000Z",
  });

  assert.equal(saved.contentAdaptation?.key, asset.id);
  assert.equal(saved.contentAdaptation?.reviewStatus, "ai_prefill");
  assert.equal(saved.boardResult?.aiBaseScore, boardResult.aiBaseScore);
  assert.equal(saved.boardResult?.evidenceAdjustment, boardResult.evidenceAdjustment);
  assert.equal(saved.boardResult?.confidenceLevel, boardResult.confidenceLevel);
  assert.equal(saved.evaluationSummary?.evaluatedAt, evaluatedAt);
  assert.equal(saved.updatedAt, topicUpdatedAt);
  assert.equal(getTopicAsset(asset.id)?.contentAdaptation?.aiOriginal.contentProfile.primaryTrack, "财经商业");

  const reviewed = updateTopicAssetContentAdaptationStrict({
    topicAssetId: asset.id,
    activeIPId: asset.ipId,
    action: { type: "confirm" },
    changedAt: "2026-08-26T20:01:00.000Z",
  });
  assert.equal(reviewed.contentAdaptation?.reviewStatus, "human_confirmed");
  assert.equal(
    reviewed.contentAdaptation?.aiOriginal.contentProfile.targetAudience,
    "正在判断职业机会的职场人",
  );
  assert.equal(reviewed.contentAdaptation?.revisions.length, 1);
  assert.equal(reviewed.evaluationSummary?.evaluatedAt, evaluatedAt);
  assert.equal(reviewed.updatedAt, topicUpdatedAt);
});

test("内容适配受控入口拒绝跨IP、错编号和覆盖已有记录", () => {
  storage.clear();
  const boardResult = createValidTopicBoardResult();
  const asset = addEvaluatedTopicAsset({
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);

  assert.throws(() => saveTopicAssetContentAdaptationStrict({
    topicAssetId: asset.id,
    activeIPId: "ip-other",
    expectedTitle: asset.title,
    assessment: createContentAdaptationAssessment(asset.id),
    generatedAt: "2026-08-26T20:00:00.000Z",
  }), /不属于当前IP/);
  assert.throws(() => saveTopicAssetContentAdaptationStrict({
    topicAssetId: asset.id,
    activeIPId: asset.ipId,
    expectedTitle: asset.title,
    assessment: createContentAdaptationAssessment("topic-wrong"),
    generatedAt: "2026-08-26T20:00:00.000Z",
  }), /编号不匹配/);

  saveTopicAssetContentAdaptationStrict({
    topicAssetId: asset.id,
    activeIPId: asset.ipId,
    expectedTitle: asset.title,
    assessment: createContentAdaptationAssessment(asset.id),
    generatedAt: "2026-08-26T20:00:00.000Z",
  });
  assert.throws(() => saveTopicAssetContentAdaptationStrict({
    topicAssetId: asset.id,
    activeIPId: asset.ipId,
    expectedTitle: asset.title,
    assessment: createContentAdaptationAssessment(asset.id),
    generatedAt: "2026-08-26T20:02:00.000Z",
  }), /拒绝覆盖/);
});

test("损坏的历史内容适配被隔离但不阻断选题评估读取", () => {
  storage.clear();
  const boardResult = createValidTopicBoardResult();
  storage.setItem("ipwr:topicAssets", JSON.stringify([{
    id: "topic-with-broken-adaptation",
    ipId: boardResult.ipId,
    title: boardResult.topic,
    source: "manual",
    status: "已评估",
    boardResult,
    contentAdaptation: {
      key: "topic-with-broken-adaptation",
      reviewStatus: "human_modified",
    },
    createdAt: "2026-08-26T19:00:00.000Z",
    updatedAt: "2026-08-26T19:00:00.000Z",
  }]));

  const restored = getTopicAsset("topic-with-broken-adaptation");
  assert.equal(restored?.boardResult?.topic, boardResult.topic);
  assert.equal(restored?.contentAdaptation, null);
});

test("旧选题补齐更新时间，新选题同时写入创建和更新时间", () => {
  storage.clear();
  storage.setItem("ipwr:topicAssets", JSON.stringify([{
    id: "topic-legacy",
    ipId: "ip-a",
    title: "旧选题",
    source: "manual",
    status: "草稿",
    createdAt: "2026-08-01T00:00:00.000Z",
  }]));

  const legacy = getTopicAsset("topic-legacy");
  assert.equal(legacy?.updatedAt, "2026-08-01T00:00:00.000Z");

  storage.clear();
  const created = addTopicAsset({
    ipId: "ip-a",
    title: "新选题",
    source: "manual",
  });
  assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(created.updatedAt, created.createdAt);
  assert.equal(created.status, "草稿");
  assert.equal(getTopicAsset(created.id)?.ipId, "ip-a");
});

test("读取旧数据时隔离非法评估结果但保留选题记录", () => {
  storage.clear();
  const invalidBoardResult = createValidTopicBoardResult() as unknown as Record<string, unknown>;
  invalidBoardResult.contractVersion = 0;
  storage.setItem("ipwr:topicAssets", JSON.stringify([{
    id: "topic-invalid-history",
    ipId: "ip-shuimuran",
    title: "需要重新评估的旧选题",
    source: "manual",
    status: "已采用",
    boardResult: invalidBoardResult,
    evaluationSummary: {
      evaluatedAt: "2026-08-01T01:00:00.000Z",
      totalScore: 72,
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T01:00:00.000Z",
  }]));

  const asset = getTopicAsset("topic-invalid-history");
  assert.equal(asset?.title, "需要重新评估的旧选题");
  assert.equal(asset?.status, "草稿");
  assert.equal(asset?.boardResult, undefined);
  assert.equal(asset?.evaluationSummary, undefined);
  assert.equal(asset?.evaluationIssue?.code, "INVALID_LEGACY_BOARD_RESULT");
  assert.match(asset?.evaluationIssue?.message ?? "", /重新评估/);
  assert.equal(getTopicAssets("ip-shuimuran")[0]?.evaluationIssue?.code, "INVALID_LEGACY_BOARD_RESULT");

  const stored = JSON.parse(storage.getItem("ipwr:topicAssets") ?? "[]");
  assert.equal(stored[0].boardResult.contractVersion, 0);
});

test("读取旧评估时不把非预期程序错误伪装成历史数据损坏", () => {
  storage.clear();
  const boardResult = createValidTopicBoardResult() as unknown as Record<string, unknown>;
  boardResult.triggerUnexpectedError = true;
  storage.setItem("ipwr:topicAssets", JSON.stringify([{
    id: "topic-unexpected-error",
    ipId: "ip-shuimuran",
    title: "不应掩盖程序错误",
    source: "manual",
    status: "已评估",
    boardResult,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T01:00:00.000Z",
  }]));

  const unexpectedError = new Error("unexpected parser failure");
  const originalIsArray = Array.isArray;
  Array.isArray = ((value: unknown) => {
    if (
      typeof value === "object"
      && value !== null
      && "triggerUnexpectedError" in value
    ) {
      throw unexpectedError;
    }
    return originalIsArray(value);
  }) as typeof Array.isArray;

  let caught: unknown;
  try {
    getTopicAsset("topic-unexpected-error");
  } catch (error) {
    caught = error;
  } finally {
    Array.isArray = originalIsArray;
  }

  assert.equal(caught, unexpectedError);
});

test("选题列表保持按创建时间排序，不受更新时间影响", () => {
  storage.clear();
  storage.setItem("ipwr:topicAssets", JSON.stringify([
    {
      id: "topic-created-first",
      ipId: "ip-a",
      title: "较早创建但最近更新",
      source: "manual",
      status: "草稿",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-08T00:00:00.000Z",
    },
    {
      id: "topic-created-later",
      ipId: "ip-a",
      title: "较晚创建",
      source: "manual",
      status: "草稿",
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    },
  ]));

  assert.deepEqual(
    getTopicAssets("ip-a").map(asset => asset.id),
    ["topic-created-later", "topic-created-first"],
  );
});

test("非法旧记录重新评估成功后彻底清除历史错误标记", () => {
  storage.clear();
  const invalidBoardResult = createValidTopicBoardResult() as unknown as Record<string, unknown>;
  invalidBoardResult.contractVersion = 0;
  storage.setItem("ipwr:topicAssets", JSON.stringify([{
    id: "topic-recovered-history",
    ipId: "ip-shuimuran",
    title: "重新评估后可恢复",
    source: "manual",
    status: "已评估",
    boardResult: invalidBoardResult,
    evaluationIssue: {
      code: "INVALID_LEGACY_BOARD_RESULT",
      message: "历史评估数据不完整，请重新评估此选题",
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T01:00:00.000Z",
  }]));

  assert.equal(getTopicAsset("topic-recovered-history")?.evaluationIssue?.code, "INVALID_LEGACY_BOARD_RESULT");
  const evaluated = updateTopicAssetEvaluation("topic-recovered-history", createValidTopicBoardResult());
  assert.equal(evaluated?.status, "已评估");
  assert.equal(Object.prototype.hasOwnProperty.call(evaluated, "evaluationIssue"), false);

  const stored = JSON.parse(storage.getItem("ipwr:topicAssets") ?? "[]");
  assert.equal(Object.prototype.hasOwnProperty.call(stored[0], "evaluationIssue"), false);
  assert.equal(stored[0].boardResult.contractVersion, 1);
});

test("保存完整评估结果和独立摘要，并按顺序流转到已拍摄", () => {
  storage.clear();
  const created = addTopicAsset({
    ipId: "ip-shuimuran",
    title: "普通人如何判断一个机会是否适合自己？",
    source: "manual",
  });

  const evaluated = updateTopicAssetEvaluation(created.id, createValidTopicBoardResult());
  assert.equal(evaluated?.status, "已评估");
  assert.equal(evaluated?.boardResult?.ipName, "水木然");
  assert.equal(evaluated?.evaluationSummary?.totalScore, 72);
  assert.equal(evaluated?.evaluationSummary?.verdict, "通过");
  assert.equal(evaluated?.evaluationSummary?.evaluatedAt, evaluated?.updatedAt);

  const adopted = updateTopicAssetStatus(created.id, "已采用");
  assert.equal(adopted?.status, "已采用");
  assert.equal(adopted?.ipId, "ip-shuimuran");

  const filmed = updateTopicAssetStatus(created.id, "已拍摄");
  assert.equal(filmed?.status, "已拍摄");
  assert.equal(getTopicAsset(created.id)?.boardResult?.contractVersion, 1);
});

test("拒绝跨IP评估、非法结果和越级状态变化", () => {
  storage.clear();
  const created = addTopicAsset({
    ipId: "ip-a",
    title: "待评估选题",
    source: "manual",
  });

  const invalidManualStatus = "已评估" as unknown as Parameters<typeof updateTopicAssetStatus>[1];
  assert.throws(
    () => updateTopicAssetStatus(created.id, invalidManualStatus),
    (error: unknown) => error instanceof TopicAssetUpdateError
      && error.code === "INVALID_STATUS_TRANSITION",
  );
  assert.equal(getTopicAsset(created.id)?.status, "草稿");
  assert.equal(getTopicAsset(created.id)?.boardResult, undefined);

  assert.throws(
    () => updateTopicAssetStatus(created.id, "已采用"),
    (error: unknown) => error instanceof TopicAssetUpdateError
      && error.code === "INVALID_STATUS_TRANSITION",
  );

  const otherIPResult = createValidTopicBoardResult();
  assert.throws(
    () => updateTopicAssetEvaluation(created.id, otherIPResult),
    (error: unknown) => error instanceof TopicAssetUpdateError
      && error.code === "IP_MISMATCH",
  );
  assert.equal(getTopicAsset(created.id)?.status, "草稿");
  assert.equal(getTopicAsset(created.id)?.ipId, "ip-a");

  const invalidResult = createValidTopicBoardResult() as unknown as Record<string, unknown>;
  delete invalidResult.voteResult;
  assert.throws(
    () => updateTopicAssetEvaluation(created.id, invalidResult),
    (error: unknown) => error instanceof TopicBoardContractError
      && error.field === "voteResult",
  );

  assert.equal(updateTopicAssetEvaluation("missing-id", createValidTopicBoardResult()), null);
  assert.equal(updateTopicAssetStatus("missing-id", "已采用"), null);
});

test("普通状态变更入口始终拒绝设置为已评估", () => {
  storage.clear();
  const callFromUntypedClient = updateTopicAssetStatus as unknown as (
    id: string,
    nextStatus: string,
  ) => ReturnType<typeof updateTopicAssetStatus>;

  assert.throws(
    () => callFromUntypedClient("missing-id", "已评估"),
    (error: unknown) => error instanceof TopicAssetUpdateError
      && error.code === "INVALID_STATUS_TRANSITION",
  );
});

test("已评估和已采用可以废弃，废弃后不能再次流转", () => {
  storage.clear();
  const evaluatedTopic = addTopicAsset({ ipId: "ip-shuimuran", title: "选题A", source: "manual" });
  updateTopicAssetEvaluation(evaluatedTopic.id, createValidTopicBoardResult());
  assert.equal(updateTopicAssetStatus(evaluatedTopic.id, "已废弃")?.status, "已废弃");
  assert.throws(
    () => updateTopicAssetStatus(evaluatedTopic.id, "已采用"),
    (error: unknown) => error instanceof TopicAssetUpdateError
      && error.code === "INVALID_STATUS_TRANSITION",
  );

  const adoptedTopic = addTopicAsset({ ipId: "ip-shuimuran", title: "选题B", source: "manual" });
  updateTopicAssetEvaluation(adoptedTopic.id, createValidTopicBoardResult());
  updateTopicAssetStatus(adoptedTopic.id, "已采用");
  assert.equal(updateTopicAssetStatus(adoptedTopic.id, "已废弃")?.status, "已废弃");
});
