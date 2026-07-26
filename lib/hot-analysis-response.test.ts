import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 24 executes this TypeScript test directly.
import { HotAnalysisResponseError, parseHotAnalysisResponse } from "./hot-analysis-response.ts";

const VALID_RESPONSE = {
  title: "",
  author: "",
  platform: "",
  publishedAt: "",
  contentDirection: ["装修避坑"],
  hook: "很多人以为贵材料等于高级感。",
  hookType: "反常识型",
  hookScore: {
    painPoint: 8,
    curiosity: 8,
    conflict: 7,
    benefit: 6,
    emotion: 5,
    total: 34,
  },
  whyViral: "开头制造认知反差，并给出具体判断标准。",
  structureBreakdownText: "开头提出误区，正文拆解原因，结尾给出行动建议。",
  contentLayerPassed: true,
  contentLayerMatched: ["明确痛点"],
  structureLayerPassed: true,
  structureLayerMissing: [],
  exclusionMatched: null,
  selfCheckPassed: true,
  selfCheckReasoning: "内容有明确观点和证据。",
  worthLearning: "值得学习",
  worthLearningReason: "判断标准可以复用。",
  ipFitTier: null,
  ipFitReason: "",
  titleStructure: "认知颠覆型",
  openingHookType: "反常识",
  userNeedLayer: "知识",
  sentenceStageTags: [{ index: 0, stage: "Hook" }],
  sentenceEmotionTags: [{ index: 0, emotions: ["好奇"] }],
};

function expectError(input: unknown, code: HotAnalysisResponseError["code"]) {
  assert.throws(
    () => parseHotAnalysisResponse(input),
    (error: unknown) =>
      error instanceof HotAnalysisResponseError && error.code === code,
  );
}

test("rejects empty AI content with an explicit stage", () => {
  expectError("   ", "empty_content");
});

test("rejects truncated JSON instead of guessing missing content", () => {
  expectError('{"title":"","hookScore":{"total":34},', "invalid_json");
});

test("rejects a complete but illegal JSON object", () => {
  expectError('{"title": }', "invalid_json");
});

test("parses JSON wrapped in a markdown code block", () => {
  const result = parseHotAnalysisResponse(
    `\`\`\`json\n${JSON.stringify(VALID_RESPONSE)}\n\`\`\``,
  );
  assert.equal(result.hookScore.total, 34);
});

test("extracts one complete JSON object from surrounding explanation", () => {
  const result = parseHotAnalysisResponse(
    `以下是分析结果：\n${JSON.stringify(VALID_RESPONSE)}\n分析结束。`,
  );
  assert.equal(result.worthLearning, "值得学习");
});

test("normalizes safe optional string arrays", () => {
  const result = parseHotAnalysisResponse(JSON.stringify({
    ...VALID_RESPONSE,
    contentDirection: "装修避坑",
    contentLayerMatched: "明确痛点",
    structureLayerMissing: undefined,
    sentenceEmotionTags: [{ index: 0, emotions: "好奇" }],
  }));
  assert.deepEqual(result.contentDirection, ["装修避坑"]);
  assert.deepEqual(result.contentLayerMatched, ["明确痛点"]);
  assert.deepEqual(result.structureLayerMissing, []);
  assert.deepEqual(result.sentenceEmotionTags[0].emotions, ["好奇"]);
});

test("rejects a response missing required analysis fields", () => {
  const { hookScore: _hookScore, ...incomplete } = VALID_RESPONSE;
  expectError(JSON.stringify(incomplete), "incomplete_fields");
});
