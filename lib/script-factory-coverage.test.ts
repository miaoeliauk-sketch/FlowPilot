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
  assert.equal(resolveGenerationPermission(assessment, null, true).allowed, false);
  assert.equal(resolveGenerationPermission(assessment, "skip", true).allowed, true);
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
