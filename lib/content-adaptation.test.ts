import assert from "node:assert/strict";
import test from "node:test";
import {
  applyContentAdaptationReview,
  ContentAdaptationContractError,
  createContentAdaptationRecord,
  parseContentAdaptationBatchResponse,
  restoreContentAdaptationRecord,
} from "./content-adaptation";

const VALID_AI_RESPONSE = JSON.stringify({
  items: [{
    key: "case-1",
    contentProfile: {
      primaryTrack: "财经商业",
      secondaryTrack: "知识科普",
      fineTags: ["家庭资产配置", "理财小白"],
      targetAudience: "刚开始管理家庭资产、缺少基础理财知识的年轻家庭",
      audienceTags: ["理财小白", "年轻家庭"],
      primaryPurpose: "信任建立",
      secondaryPurpose: "知识教育",
      reasons: {
        track: "内容围绕家庭资产配置方法展开",
        audience: "正文明确面向缺少理财基础的家庭",
        purpose: "主要通过解释风险建立专业信任",
      },
    },
    ipFit: {
      tier: "中度匹配",
      reason: "赛道相近，但目标人群与当前IP受众并不完全一致",
    },
  }],
});

test("适配判断把内容自身描述与当前IP匹配结果分开返回", () => {
  const parsed = parseContentAdaptationBatchResponse(
    VALID_AI_RESPONSE,
    ["case-1"],
    true,
  );

  assert.equal(parsed[0].contentProfile.primaryTrack, "财经商业");
  assert.deepEqual(parsed[0].contentProfile.fineTags, ["家庭资产配置", "理财小白"]);
  assert.equal(parsed[0].ipFit?.tier, "中度匹配");
});

test("AI不能返回固定一级赛道以外的分类", () => {
  const invalid = JSON.parse(VALID_AI_RESPONSE);
  invalid.items[0].contentProfile.primaryTrack = "玄学赛道";

  assert.throws(
    () => parseContentAdaptationBatchResponse(
      JSON.stringify(invalid),
      ["case-1"],
      true,
    ),
    /primaryTrack必须来自固定一级赛道/,
  );
});

test("AI适配结果缺失字段、标签越界或批次对应错误时会被拒绝", () => {
  const invalidCases: Array<{ mutate: (value: any) => void; field: string }> = [
    { mutate: value => { value.items[0].contentProfile.fineTags = ["只有一个"]; }, field: "fineTags" },
    { mutate: value => { value.items[0].contentProfile.audienceTags = ["重复", "重复"]; }, field: "audienceTags" },
    { mutate: value => { value.items[0].contentProfile.secondaryTrack = "财经商业"; }, field: "secondaryTrack" },
    { mutate: value => { value.items[0].contentProfile.primaryPurpose = "博眼球"; }, field: "primaryPurpose" },
    { mutate: value => { value.items[0].contentProfile.reasons.audience = " "; }, field: "reasons.audience" },
    { mutate: value => { value.items[0].key = "unexpected"; }, field: "items" },
    { mutate: value => { value.items.push(value.items[0]); }, field: "items" },
  ];

  for (const invalidCase of invalidCases) {
    const invalid = JSON.parse(VALID_AI_RESPONSE);
    invalidCase.mutate(invalid);
    assert.throws(
      () => parseContentAdaptationBatchResponse(
        JSON.stringify(invalid),
        ["case-1"],
        true,
      ),
      (error: unknown) => error instanceof ContentAdaptationContractError
        && error.field.includes(invalidCase.field),
    );
  }
});

test("有当前IP时必须返回匹配依据，没有当前IP时必须返回null", () => {
  const missingFit = JSON.parse(VALID_AI_RESPONSE);
  missingFit.items[0].ipFit = null;
  assert.throws(
    () => parseContentAdaptationBatchResponse(
      JSON.stringify(missingFit),
      ["case-1"],
      true,
    ),
    (error: unknown) => error instanceof ContentAdaptationContractError
      && error.field === "items[0].ipFit",
  );

  assert.throws(
    () => parseContentAdaptationBatchResponse(
      VALID_AI_RESPONSE,
      ["case-1"],
      false,
    ),
    (error: unknown) => error instanceof ContentAdaptationContractError
      && error.field === "items[0].ipFit",
  );
});

test("人工修改只更新当前结果并保留不可覆盖的AI原始判断和修改记录", () => {
  const assessment = parseContentAdaptationBatchResponse(
    VALID_AI_RESPONSE,
    ["case-1"],
    true,
  )[0];
  const originalRecord = createContentAdaptationRecord(
    assessment,
    "2026-08-23T10:00:00.000Z",
  );
  const modifiedProfile = {
    ...assessment.contentProfile,
    primaryTrack: "知识科普" as const,
    secondaryTrack: null,
    fineTags: ["家庭财务", "风险启蒙"],
  };

  const updated = applyContentAdaptationReview(originalRecord, {
    type: "modify",
    contentProfile: modifiedProfile,
  }, "2026-08-23T10:05:00.000Z");

  assert.equal(updated.aiOriginal.contentProfile.primaryTrack, "财经商业");
  assert.deepEqual(updated.aiOriginal.contentProfile.fineTags, ["家庭资产配置", "理财小白"]);
  assert.equal(updated.current?.contentProfile.primaryTrack, "知识科普");
  assert.deepEqual(updated.current?.contentProfile.fineTags, ["家庭财务", "风险启蒙"]);
  assert.equal(updated.reviewStatus, "human_modified");
  assert.equal(updated.ipFitStatus, "needs_refresh");
  assert.equal(updated.revisions.length, 1);
  assert.equal(updated.revisions[0].action, "modify");
  assert.equal(updated.revisions[0].changedAt, "2026-08-23T10:05:00.000Z");
  assert.equal(updated.revisions[0].before?.contentProfile.primaryTrack, "财经商业");
  assert.equal(updated.revisions[0].after?.contentProfile.primaryTrack, "知识科普");
});

test("人工可以确认或移除AI预填，但移除后原始判断仍保留", () => {
  const assessment = parseContentAdaptationBatchResponse(
    VALID_AI_RESPONSE,
    ["case-1"],
    true,
  )[0];
  const originalRecord = createContentAdaptationRecord(
    assessment,
    "2026-08-23T10:00:00.000Z",
  );
  const confirmed = applyContentAdaptationReview(originalRecord, {
    type: "confirm",
  }, "2026-08-23T10:01:00.000Z");
  const removed = applyContentAdaptationReview(confirmed, {
    type: "remove",
  }, "2026-08-23T10:02:00.000Z");

  assert.equal(confirmed.reviewStatus, "human_confirmed");
  assert.equal(confirmed.ipFitStatus, "current");
  assert.equal(removed.current, null);
  assert.equal(removed.reviewStatus, "human_removed");
  assert.equal(removed.aiOriginal.contentProfile.primaryTrack, "财经商业");
  assert.deepEqual(removed.revisions.map(revision => revision.action), ["confirm", "remove"]);
});

test("直接创建AI原始记录也不能绕过统一契约写入非法判断", () => {
  const assessment = parseContentAdaptationBatchResponse(
    VALID_AI_RESPONSE,
    ["case-1"],
    true,
  )[0];
  const forged = {
    ...assessment,
    contentProfile: {
      ...assessment.contentProfile,
      primaryTrack: "调用方伪造赛道",
    },
  };

  assert.throws(
    () => createContentAdaptationRecord(
      forged as typeof assessment,
      "2026-08-23T10:00:00.000Z",
    ),
    (error: unknown) => error instanceof ContentAdaptationContractError
      && error.field === "assessment.contentProfile.primaryTrack",
  );
});

test("调用方不能绕过审核入口直接改写AI原始判断、当前结果或修改历史", () => {
  const assessment = parseContentAdaptationBatchResponse(
    VALID_AI_RESPONSE,
    ["case-1"],
    true,
  )[0];
  const created = createContentAdaptationRecord(
    assessment,
    "2026-08-23T10:00:00.000Z",
  );
  const confirmed = applyContentAdaptationReview(created, {
    type: "confirm",
  }, "2026-08-23T10:01:00.000Z");

  assert.throws(() => {
    (confirmed.aiOriginal.contentProfile as { primaryTrack: string }).primaryTrack = "伪造赛道";
  }, TypeError);
  assert.throws(() => {
    (confirmed.current!.contentProfile.fineTags as string[]).push("绕过留痕");
  }, TypeError);
  assert.throws(() => {
    (confirmed.revisions as unknown[]).length = 0;
  }, TypeError);
  assert.equal(confirmed.aiOriginal.contentProfile.primaryTrack, "财经商业");
  assert.deepEqual(confirmed.current?.contentProfile.fineTags, ["家庭资产配置", "理财小白"]);
  assert.equal(confirmed.revisions.length, 1);
});

test("旧数据缺少适配记录时安全兼容，损坏记录不会被伪装成有效判断", () => {
  const missing = restoreContentAdaptationRecord(undefined);
  assert.deepEqual(missing, { status: "missing", record: null });

  const assessment = parseContentAdaptationBatchResponse(
    VALID_AI_RESPONSE,
    ["case-1"],
    true,
  )[0];
  const created = createContentAdaptationRecord(
    assessment,
    "2026-08-23T10:00:00.000Z",
  );
  const restored = restoreContentAdaptationRecord(JSON.parse(JSON.stringify(created)));
  assert.equal(restored.status, "valid");
  assert.equal(restored.record?.aiOriginal.contentProfile.primaryTrack, "财经商业");
  assert.throws(() => {
    (restored.record!.current!.contentProfile as { primaryTrack: string }).primaryTrack = "绕过恢复入口";
  }, TypeError);

  const corrupt = JSON.parse(JSON.stringify(created));
  corrupt.reviewStatus = "human_confirmed";
  corrupt.current = null;
  const rejected = restoreContentAdaptationRecord(corrupt);
  assert.deepEqual(rejected, { status: "invalid", record: null });
});

test("人工可以删除部分AI预填项，不受AI输出的最少标签数量限制", () => {
  const assessment = parseContentAdaptationBatchResponse(
    VALID_AI_RESPONSE,
    ["case-1"],
    true,
  )[0];
  const created = createContentAdaptationRecord(
    assessment,
    "2026-08-23T10:00:00.000Z",
  );

  const updated = applyContentAdaptationReview(created, {
    type: "modify",
    contentProfile: {
      ...assessment.contentProfile,
      fineTags: ["家庭资产配置"],
      targetAudience: null,
      audienceTags: [],
      primaryPurpose: null,
      secondaryPurpose: null,
      reasons: {
        ...assessment.contentProfile.reasons,
        audience: null,
        purpose: null,
      },
    },
  }, "2026-08-23T10:03:00.000Z");

  assert.deepEqual(updated.current?.contentProfile.fineTags, ["家庭资产配置"]);
  assert.equal(updated.current?.contentProfile.targetAudience, null);
  assert.equal(updated.current?.contentProfile.primaryPurpose, null);
  assert.equal(updated.aiOriginal.contentProfile.targetAudience.includes("年轻家庭"), true);
});

test("人工修改后IP匹配会失效，明确重算后才能恢复为当前状态", () => {
  const assessment = parseContentAdaptationBatchResponse(
    VALID_AI_RESPONSE,
    ["case-1"],
    true,
  )[0];
  const created = createContentAdaptationRecord(
    assessment,
    "2026-08-23T10:00:00.000Z",
  );
  const modified = applyContentAdaptationReview(created, {
    type: "modify",
    contentProfile: {
      ...assessment.contentProfile,
      primaryTrack: "知识科普",
      secondaryTrack: null,
    },
  }, "2026-08-23T10:03:00.000Z");
  const refreshed = applyContentAdaptationReview(modified, {
    type: "refresh_ip_fit",
    ipFit: {
      tier: "低度匹配",
      reason: "人工修改后的目标人群与当前IP受众不一致",
    },
  }, "2026-08-23T10:04:00.000Z");

  assert.equal(modified.ipFitStatus, "needs_refresh");
  assert.equal(refreshed.ipFitStatus, "current");
  assert.equal(refreshed.current?.ipFit?.tier, "低度匹配");
  assert.equal(refreshed.reviewStatus, "human_modified");
  assert.equal(refreshed.aiOriginal.ipFit?.tier, "中度匹配");
  assert.deepEqual(refreshed.revisions.map(revision => revision.action), [
    "modify",
    "refresh_ip_fit",
  ]);
});

test("人工审核时间早于上一版本更新时间时会被拒绝且不改变原记录", () => {
  const assessment = parseContentAdaptationBatchResponse(
    VALID_AI_RESPONSE,
    ["case-1"],
    true,
  )[0];
  const created = createContentAdaptationRecord(
    assessment,
    "2026-08-23T10:00:00.000Z",
  );
  const confirmed = applyContentAdaptationReview(created, {
    type: "confirm",
  }, "2026-08-23T10:05:00.000Z");

  assert.throws(
    () => applyContentAdaptationReview(confirmed, {
      type: "modify",
      contentProfile: {
        ...assessment.contentProfile,
        fineTags: ["家庭财务", "风险启蒙"],
      },
    }, "2026-08-23T10:04:59.999Z"),
    (error: unknown) => error instanceof ContentAdaptationContractError
      && error.field === "changedAt",
  );
  assert.equal(confirmed.updatedAt, "2026-08-23T10:05:00.000Z");
  assert.equal(confirmed.revisions.length, 1);
  assert.equal(confirmed.reviewStatus, "human_confirmed");
});
