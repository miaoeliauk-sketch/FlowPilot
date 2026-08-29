import assert from "node:assert/strict";
import test from "node:test";
import { detectGlobalBlockingConstraints } from "./global-content-constraint-detector";

function activeRuleFixture() {
  return {
    schemaVersion: 1,
    ruleId: "global-constraint-emotional-coercion",
    sourceKnowledgeEntryId: "knowledge-expression-motive",
    scope: "all_ips",
    category: "通用禁用规则",
    priority: "global_baseline",
    enforcement: "block",
    status: "active",
    title: "禁止利用无力感进行情绪绑架",
    canonicalText: "判断对象是表达动机，不是具体词汇。允许反差、悬念和适度焦虑。禁止利用受众的无力感进行情绪操纵，迫使其被动接受或行动。",
    prohibitedIntent: "利用受众的无力感进行情绪操纵，迫使其被动接受或行动",
    allowedBoundaries: ["反差", "悬念", "适度焦虑"],
    detection: {
      type: "keyword",
      matchMode: "any",
      terms: ["被时代抛弃", "阶级固化"],
    },
    humanConfirmation: {
      confirmedBy: "彭彭",
      confirmedAt: "2026-08-29T14:00:00.000Z",
    },
    revision: 1,
    createdAt: "2026-08-29T14:00:00.000Z",
    updatedAt: "2026-08-29T14:00:00.000Z",
  };
}

test("命中已启用规则的高风险短语时返回具体片段、位置和原因", () => {
  const content = "如果不立刻改变，你就会被时代抛弃。";

  assert.deepEqual(detectGlobalBlockingConstraints(content, [activeRuleFixture()]), {
    blocked: true,
    detectionMode: "keyword",
    semanticAssessment: "not_implemented",
    matches: [
      {
        ruleId: "global-constraint-emotional-coercion",
        sourceKnowledgeEntryId: "knowledge-expression-motive",
        matchedText: "被时代抛弃",
        start: content.indexOf("被时代抛弃"),
        end: content.indexOf("被时代抛弃") + "被时代抛弃".length,
        reason: "命中通用禁用规则《禁止利用无力感进行情绪绑架》：利用受众的无力感进行情绪操纵，迫使其被动接受或行动",
      },
    ],
  });
});

test("同一短语多次出现时逐处报告，停用规则不参与检测", () => {
  const content = "别用被时代抛弃制造恐慌，也别反复说被时代抛弃。";
  const disabledRule = {
    ...activeRuleFixture(),
    ruleId: "disabled-rule",
    status: "disabled",
    detection: {
      type: "keyword",
      matchMode: "any",
      terms: ["制造恐慌"],
    },
  };
  const firstStart = content.indexOf("被时代抛弃");
  const secondStart = content.indexOf("被时代抛弃", firstStart + 1);

  const result = detectGlobalBlockingConstraints(content, [disabledRule, activeRuleFixture()]);

  assert.equal(result.blocked, true);
  assert.deepEqual(
    result.matches.map(match => ({ matchedText: match.matchedText, start: match.start, end: match.end })),
    [
      { matchedText: "被时代抛弃", start: firstStart, end: firstStart + "被时代抛弃".length },
      { matchedText: "被时代抛弃", start: secondStart, end: secondStart + "被时代抛弃".length },
    ],
  );
  assert.equal(result.matches.some(match => match.ruleId === "disabled-rule"), false);
});

test("同一短语重叠出现时不漏报任何位置", () => {
  const rule = {
    ...activeRuleFixture(),
    detection: {
      type: "keyword",
      matchMode: "any",
      terms: ["哈哈"],
    },
  };

  const result = detectGlobalBlockingConstraints("哈哈哈", [rule]);

  assert.deepEqual(result.matches.map(match => [match.start, match.end]), [[0, 2], [1, 3]]);
});

test("多项命中按原文位置返回，未命中时明确放行但不冒充已做语义判断", () => {
  const rule = {
    ...activeRuleFixture(),
    detection: {
      type: "keyword",
      matchMode: "any",
      terms: ["阶级固化", "被时代抛弃"],
    },
  };
  const content = "先说被时代抛弃，再说阶级固化。";

  const blocked = detectGlobalBlockingConstraints(content, [rule]);
  assert.deepEqual(blocked.matches.map(match => match.matchedText), ["被时代抛弃", "阶级固化"]);

  assert.deepEqual(detectGlobalBlockingConstraints("允许反差、悬念和适度焦虑。", [rule]), {
    blocked: false,
    detectionMode: "keyword",
    semanticAssessment: "not_implemented",
    matches: [],
  });
});

test("待检查内容类型错误或规则损坏时明确失败，不静默放行", () => {
  assert.throws(
    () => detectGlobalBlockingConstraints(null as never, [activeRuleFixture()]),
    /待检查内容必须是字符串/,
  );
  assert.throws(
    () => detectGlobalBlockingConstraints("被时代抛弃", [
      { ...activeRuleFixture(), scope: "single_ip" },
    ]),
    /scope必须为all_ips/,
  );
});
