import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 24 executes this TypeScript test directly.
import { isCopyOptimizationTaskNotExecuted } from "./copy-optimization-result-state.ts";

test("treats an explicitly null optimizedText as not executed", () => {
  assert.equal(
    isCopyOptimizationTaskNotExecuted({
      optimizedText: null,
      rewrittenFullText: "不应展示的兜底内容",
      impactAnalysis: "预计更有利",
    }),
    true,
  );
});

test("treats an impact error as not executed", () => {
  assert.equal(
    isCopyOptimizationTaskNotExecuted({
      optimizedText: "改写内容",
      impactAnalysis: "未提供原文，无法执行改写。",
    }),
    true,
  );
});

test("recognizes the current API parse-fallback result", () => {
  assert.equal(
    isCopyOptimizationTaskNotExecuted({
      rewrittenFullText: "",
      goalImpact: {
        direction: "中性",
        reasoning: "（AI返回内容解析失败）",
      },
    }),
    true,
  );
});

test("does not mistake a real zero deviation score for failure", () => {
  assert.equal(
    isCopyOptimizationTaskNotExecuted({
      rewrittenFullText: "这是有效改写内容。",
      goalImpact: {
        direction: "更有利",
        reasoning: "开头更直接，有利于完播率。",
      },
      deviationScore: 0,
    }),
    false,
  );
});
