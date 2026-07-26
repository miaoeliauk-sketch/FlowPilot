import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 24 executes this TypeScript test directly.
import { CopyOptimizationResponseError, parseCopyOptimizationResponse } from "./copy-optimization-response.ts";

const validResponse = {
  lockedItemsCheck: [
    { item: "viewpoint", label: "核心观点", preserved: true, howPreserved: "保留原观点。" },
    { item: "cases", label: "核心案例", preserved: true, howPreserved: "保留原案例。" },
    { item: "logic", label: "核心逻辑", preserved: true, howPreserved: "保留原逻辑。" },
    { item: "conclusion", label: "核心结论", preserved: true, howPreserved: "保留原结论。" },
  ],
  segments: [
    {
      original: "原文第一段。",
      rewritten: "改写后的第一段。",
      reason: "调整表达节奏。",
      changeType: ["语气"],
    },
  ],
  rewrittenFullText: "改写后的完整文案。",
  deviationScore: 12,
  deviationReason: "核心内容没有改变。",
  styleMatchScore: 86,
  ipStyleExplanation: "使用了目标IP的短句表达。",
  goalImpact: {
    direction: "更有利",
    reasoning: "开头更直接，有助于降低前段流失。",
  },
};

function expectResponseError(
  input: string,
  code: CopyOptimizationResponseError["code"],
) {
  assert.throws(
    () => parseCopyOptimizationResponse(input),
    (error: unknown) => (
      error instanceof CopyOptimizationResponseError && error.code === code
    ),
  );
}

test("parses a complete copy optimization response", () => {
  const result = parseCopyOptimizationResponse(JSON.stringify(validResponse));
  assert.equal(result.rewrittenFullText, "改写后的完整文案。");
  assert.equal(result.lockedItemsCheck.length, 4);
  assert.equal(result.goalImpact.direction, "更有利");
});

test("accepts JSON wrapped in a Markdown code block", () => {
  const input = `说明文字\n\`\`\`json\n${JSON.stringify(validResponse)}\n\`\`\`\n结束文字`;
  const result = parseCopyOptimizationResponse(input);
  assert.equal(result.segments.length, 1);
});

test("rejects empty content", () => {
  expectResponseError(" \n ", "empty_content");
});

test("rejects invalid or truncated JSON", () => {
  expectResponseError('{"lockedItemsCheck":[],"segments":[', "invalid_json");
});

test("fills safe defaults for missing optional explanatory fields", () => {
  const input = {
    ...validResponse,
    deviationReason: undefined,
    ipStyleExplanation: undefined,
    segments: [{
      original: "原文第一段。",
      rewritten: "改写后的第一段。",
      changeType: "语气",
    }],
  };
  const result = parseCopyOptimizationResponse(JSON.stringify(input));
  assert.equal(result.deviationReason, "");
  assert.equal(result.ipStyleExplanation, "");
  assert.equal(result.segments[0].reason, "");
  assert.deepEqual(result.segments[0].changeType, ["语气"]);
});

test("rejects a response without the required rewritten full text", () => {
  expectResponseError(
    JSON.stringify({ ...validResponse, rewrittenFullText: "" }),
    "missing_required_field",
  );
});

test("rejects incompatible field types instead of inventing a result", () => {
  expectResponseError(
    JSON.stringify({ ...validResponse, lockedItemsCheck: "全部保留" }),
    "invalid_field_type",
  );
});
