import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyCoverageAssessment,
  parseCoverageAssessment,
  resolveGenerationPermission,
  type CoverageSourceReference,
} from "./script-factory-coverage";

const REFERENCES: CoverageSourceReference[] = [{
  sourceId: "source-1", sourceTitle: "直播复盘", itemId: "claim-1", kind: "claim",
  content: "持续输出不是每天更换话题。", originalExcerpt: "持续输出不是每天换一个新话题。", extractionStatus: "人工确认",
}, {
  sourceId: "source-1", sourceTitle: "直播复盘", itemId: "reasoning-1", kind: "reasoning",
  content: "不断换题会让用户无法形成稳定记忆。", originalExcerpt: "每天换题，用户就不知道应该因为什么记住你。", extractionStatus: "人工确认",
}];

test("没有原始内容时阻断生成", () => {
  const assessment = createEmptyCoverageAssessment("测试选题");
  assert.equal(assessment.coverage, "NONE");
  assert.equal(resolveGenerationPermission(assessment, "skip", true).allowed, false);
});

test("PARTIAL必须引用老师明确表达的核心判断", () => {
  assert.throws(() => parseCoverageAssessment(JSON.stringify({
    coverage: "PARTIAL",
    reason: "只有相近选题，没有老师的明确判断。",
    coveredDimensions: ["核心判断"],
    missingDimensions: ["推理过程"],
    sourceReferences: [{ sourceId: "source-1", itemId: "reasoning-1" }],
    caseNeed: "NOT_ASSESSED",
    caseReason: "覆盖度未通过前不判断案例需求。",
  }), REFERENCES), /PARTIAL必须引用老师明确表达的核心判断/);
});

test("有核心判断但缺少推理时允许判为PARTIAL", () => {
  const assessment = parseCoverageAssessment(JSON.stringify({
    coverage: "PARTIAL",
    reason: "老师表达过核心判断，但缺少本次选题所需的推理。",
    coveredDimensions: ["核心判断"],
    missingDimensions: ["推理过程"],
    sourceReferences: [{ sourceId: "source-1", itemId: "claim-1" }],
    caseNeed: "NOT_ASSESSED",
    caseReason: "覆盖度未通过前不判断案例需求。",
  }), REFERENCES);

  assert.equal(assessment.coverage, "PARTIAL");
  assert.equal(assessment.sourceReferences[0]?.kind, "claim");
});

test("三档覆盖度对应正式稿、待审核稿和探索稿权限", () => {
  const partial = parseCoverageAssessment(JSON.stringify({
    coverage: "PARTIAL",
    reason: "有核心判断，缺少推理。",
    coveredDimensions: ["核心判断"],
    missingDimensions: ["推理过程"],
    sourceReferences: [{ sourceId: "source-1", itemId: "claim-1" }],
    caseNeed: "NOT_ASSESSED",
    caseReason: "覆盖度未通过前不判断案例需求。",
  }), REFERENCES);
  const none = createEmptyCoverageAssessment("测试选题");

  assert.deepEqual(resolveGenerationPermission(partial, null, false, false), {
    allowed: false,
    tier: "review",
    reason: "请先确认：当前缺失的推理需要老师审核，生成结果只能作为待审核稿。",
  });
  assert.deepEqual(resolveGenerationPermission(partial, null, false, true), {
    allowed: true,
    tier: "review",
    reason: "已确认观点缺口，可以生成待审核稿。",
  });
  assert.deepEqual(resolveGenerationPermission(none, null, false, false), {
    allowed: false,
    tier: "exploratory",
    reason: "请先确认：当前没有老师的观点依据，生成结果只能作为探索稿，不能代表老师立场。",
  });
  assert.deepEqual(resolveGenerationPermission(none, null, false, true), {
    allowed: true,
    tier: "exploratory",
    reason: "已确认当前没有老师观点依据，可以生成探索稿。",
  });
});

test("FULL必须同时引用老师的核心判断和推理依据", () => {
  assert.throws(() => parseCoverageAssessment(JSON.stringify({
    coverage: "FULL",
    reason: "观点完整。",
    coveredDimensions: ["核心判断", "推理过程"],
    missingDimensions: [],
    sourceReferences: [{ sourceId: "source-1", itemId: "claim-1" }],
    caseNeed: "NOT_NEEDED",
    caseReason: "不需要案例。",
  }), REFERENCES), /核心判断和推理依据/);
});

test("充分覆盖并确认案例边界后才允许生成", () => {
  const assessment = parseCoverageAssessment(JSON.stringify({
    coverage: "FULL",
    reason: "观点和推理都有出处。",
    coveredDimensions: ["核心判断", "推理过程"],
    missingDimensions: [],
    sourceReferences: [
      { sourceId: "source-1", itemId: "claim-1" },
      { sourceId: "source-1", itemId: "reasoning-1" },
    ],
    caseNeed: "ENHANCEMENT",
    caseReason: "案例只增强画面。",
  }), REFERENCES);
  assert.deepEqual(resolveGenerationPermission(assessment, null, true), {
    allowed: false,
    tier: "formal",
    reason: "请先选择使用案例，或明确本次不使用案例。",
  });
  assert.deepEqual(resolveGenerationPermission(assessment, "skip", true), {
    allowed: true,
    tier: "formal",
    reason: "观点依据和案例边界已确认，可以生成正式稿。",
  });
});

test("模型引用不存在的资料时拒绝覆盖度结果", () => {
  assert.throws(() => parseCoverageAssessment(JSON.stringify({
    coverage: "FULL", reason: "有依据。", coveredDimensions: ["核心判断", "推理过程"], missingDimensions: [],
    sourceReferences: [{ sourceId: "fake", itemId: "fake" }], caseNeed: "NOT_NEEDED", caseReason: "不需要案例。",
  }), REFERENCES), /不存在的原始内容/);
});

test("充分覆盖后仍未判断案例需求时拒绝结果", () => {
  assert.throws(() => parseCoverageAssessment(JSON.stringify({
    coverage: "FULL", reason: "观点和推理均存在。", coveredDimensions: ["核心判断", "推理过程"], missingDimensions: [],
    sourceReferences: [
      { sourceId: "source-1", itemId: "claim-1" },
      { sourceId: "source-1", itemId: "reasoning-1" },
    ],
    caseNeed: "NOT_ASSESSED", caseReason: "尚未判断。",
  }), REFERENCES), /案例是否需要/);
});
