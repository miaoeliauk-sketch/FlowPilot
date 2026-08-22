import assert from "node:assert/strict";
import test from "node:test";
import {
  compareKnowledgeSimilarity,
  groupPairwiseMatches,
  normalizeKnowledgeText,
  type KnowledgeSimilarityContent,
} from "./knowledge-similarity";

function content(
  overrides: Partial<KnowledgeSimilarityContent> = {},
): KnowledgeSimilarityContent {
  return {
    title: "反常识选题法",
    summary: "用反常识冲突解决普通选题缺少吸引力的问题",
    coreMethod: "先指出大众默认判断，再用真实反例推翻它",
    applicableScenarios: ["知识口播", "观点短视频"],
    aiUsage: "当选题缺少冲突时，用反例重构切入角度",
    ...overrides,
  };
}

test("相似度基础契约区分完全相同、高度相似、部分相似和不相似", () => {
  const exact = compareKnowledgeSimilarity(
    content({ coreMethod: "计算 Ａ＋Ｂ" }),
    content({ coreMethod: "计算A+B" }),
  );
  const high = compareKnowledgeSimilarity(
    content(),
    content({
      title: "用反常识制造选题冲突",
      summary: "通过反常识冲突解决知识类选题吸引力不足的问题",
      coreMethod: "先写出大众默认判断，再用一个真实反例完成推翻",
      aiUsage: "选题没有冲突时，调用真实反例重新设计切入角度",
    }),
  );
  const partial = compareKnowledgeSimilarity(
    content(),
    content({
      title: "普通观点怎样改成反常识选题",
      summary: "把大家熟悉的观点换一个方向表达",
      coreMethod: "先列出大众默认判断，再寻找能够推翻判断的反例",
      applicableScenarios: ["知识口播"],
      aiUsage: "寻找观点中可以被真实反例挑战的部分",
    }),
  );
  const none = compareKnowledgeSimilarity(
    content(),
    content({
      title: "发布时间记录表",
      summary: "登记不同平台每天的发布时间",
      coreMethod: "按照日期填写发布平台和具体时刻",
      applicableScenarios: ["运营排期"],
      aiUsage: "生成每周发布日历",
    }),
  );

  assert.equal(exact.tier, "exact");
  assert.equal(high.tier, "high");
  assert.equal(partial.tier, "partial");
  assert.equal(none.tier, "none");
  assert.match(high.reasons.join("；"), /核心方法/);
  assert.match(partial.reasons.join("；"), /相似|重合/);
});

test("文字标准化只统一等价写法，不丢失有实际含义的符号", () => {
  assert.equal(normalizeKnowledgeText("利润 ＋１０％"), "利润+10%");
  assert.notEqual(normalizeKnowledgeText("利润+10%"), normalizeKnowledgeText("利润-10%"));
  assert.notEqual(normalizeKnowledgeText("转化率≥10%"), normalizeKnowledgeText("转化率≤10%"));
  assert.notEqual(normalizeKnowledgeText("比例1:2"), normalizeKnowledgeText("比例12"));
  assert.notEqual(normalizeKnowledgeText("增长1.5倍"), normalizeKnowledgeText("增长15倍"));
});

test("两两校验分组不会通过中间项形成链式误并", () => {
  const matches = new Set(["A:B", "B:A", "B:C", "C:B"]);
  const groups = groupPairwiseMatches(["A", "B", "C"], (left, right) =>
    matches.has(`${left}:${right}`));

  assert.deepEqual(groups, [["A", "B"], ["C"]]);
});
