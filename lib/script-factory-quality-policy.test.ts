import assert from "node:assert/strict";
import test from "node:test";
import {
  HARD_BLOCK_RULES,
  QUALITY_WARNING_GROUPS,
  SHUIMURAN_CHECK_TO_WARNING_GROUP,
  SHUIMURAN_REVIEW_CHECK_KEYS,
  classifyScriptDelivery,
} from "./script-factory-quality-policy";

test("质量规则统一分为2项硬阻断和7项质量提示", () => {
  assert.deepEqual(HARD_BLOCK_RULES.map(rule => rule.code), [
    "cross_ip_material",
    "fabricated_teacher_attribution",
  ]);
  assert.equal(HARD_BLOCK_RULES.every(rule => rule.severity === "hard_block"), true);

  assert.deepEqual(QUALITY_WARNING_GROUPS.map(rule => rule.code), [
    "mechanical_structure",
    "generic_ending",
    "dense_catchphrases",
    "core_focus",
    "reasoning_support",
    "compression_quality",
    "structure_and_style",
  ]);
  assert.equal(QUALITY_WARNING_GROUPS.every(rule => rule.severity === "quality_warning"), true);
});

test("现有13项水木然终审全部且仅映射到7项质量提示", () => {
  assert.deepEqual(
    Object.keys(SHUIMURAN_CHECK_TO_WARNING_GROUP).sort(),
    [...SHUIMURAN_REVIEW_CHECK_KEYS].sort(),
  );

  for (const checkKey of SHUIMURAN_REVIEW_CHECK_KEYS) {
    const group = SHUIMURAN_CHECK_TO_WARNING_GROUP[checkKey];
    assert.equal(
      QUALITY_WARNING_GROUPS.some(rule => rule.code === group),
      true,
      `${checkKey}没有映射到质量提示组`,
    );
  }
});

test("普通质量问题只形成提示，不阻断正文交付", () => {
  const result = classifyScriptDelivery({
    hasUsableContent: true,
    hardBlockCodes: [],
    warningCodes: ["mechanical_structure", "generic_ending"],
  });

  assert.equal(result.status, "deliverable_with_warnings");
  assert.deepEqual(result.hardBlockCodes, []);
  assert.deepEqual(result.warningCodes, ["mechanical_structure", "generic_ending"]);
});

test("跨IP混用或伪造老师确认观点会阻断正文交付", () => {
  const result = classifyScriptDelivery({
    hasUsableContent: true,
    hardBlockCodes: ["fabricated_teacher_attribution"],
    warningCodes: ["structure_and_style"],
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.hardBlockCodes, ["fabricated_teacher_attribution"]);
  assert.deepEqual(result.warningCodes, ["structure_and_style"]);
});

test("技术上没有可用正文与文案质量不够好是两种不同状态", () => {
  const result = classifyScriptDelivery({
    hasUsableContent: false,
    hardBlockCodes: [],
    warningCodes: ["reasoning_support"],
  });

  assert.equal(result.status, "no_usable_content");
  assert.deepEqual(result.hardBlockCodes, []);
  assert.deepEqual(result.warningCodes, ["reasoning_support"]);
});
