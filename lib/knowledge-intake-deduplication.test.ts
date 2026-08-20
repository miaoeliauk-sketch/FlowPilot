import assert from "node:assert/strict";
import test from "node:test";
import {
  groupKnowledgeMethodCards,
  mergeKnowledgeMethodCards,
  type KnowledgeMethodCardForDeduplication,
} from "./knowledge-intake-deduplication";

function card(
  id: string,
  overrides: Partial<KnowledgeMethodCardForDeduplication> = {},
): KnowledgeMethodCardForDeduplication {
  return {
    id,
    title: "反常识选题法",
    summary: "用反常识冲突解决普通选题缺少吸引力的问题",
    coreMethod: "先指出大众默认判断，再用真实反例推翻它",
    applicableScenarios: ["知识口播", "观点短视频"],
    category: "选题方法库",
    aiUsage: "当选题缺少冲突时，用反例重构切入角度",
    sourceSegments: [{ id: `segment-${id}`, title: `章节${id}`, index: Number(id) || 1 }],
    tags: ["反常识"],
    triggerKeywords: ["选题"],
    similarPhrases: [],
    examples: [],
    unsuitableCases: [],
    ...overrides,
  };
}

test("完全重复的方法卡自动保留信息更完整的一张并合并全部来源", () => {
  const concise = card("1", {
    tags: ["第一张独有标签"],
    triggerKeywords: ["第一张触发词"],
    examples: [{ input: "第一张案例", output: "第一张结果" }],
  });
  const richer = card("2", {
    tags: ["第二张独有标签"],
    triggerKeywords: ["第二张触发词"],
    examples: [{ input: "第二张案例", output: "第二张结果" }],
    unsuitableCases: ["纯事实播报"],
  });

  const result = groupKnowledgeMethodCards([concise, richer]);

  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0]?.id, "2");
  assert.deepEqual(result.cards[0]?.sourceSegments.map(source => source.title), ["章节1", "章节2"]);
  assert.deepEqual(result.cards[0]?.tags, ["第一张独有标签", "第二张独有标签"]);
  assert.deepEqual(result.cards[0]?.triggerKeywords, ["第一张触发词", "第二张触发词"]);
  assert.deepEqual(result.cards[0]?.examples, [
    { input: "第一张案例", output: "第一张结果" },
    { input: "第二张案例", output: "第二张结果" },
  ]);
  assert.equal(result.exactDuplicateCount, 1);
  assert.equal(result.similarGroups.length, 0);
});

test("关键比较字段同时缺失时不能因空值相同而自动合并", () => {
  const first = card("1", {
    coreMethod: undefined,
    applicableScenarios: undefined,
    aiUsage: undefined,
  });
  const second = card("2", {
    coreMethod: undefined,
    applicableScenarios: undefined,
    aiUsage: undefined,
  });

  const result = groupKnowledgeMethodCards([first, second]);

  assert.equal(result.cards.length, 2);
  assert.equal(result.exactDuplicateCount, 0);
  assert.equal(result.similarGroups.length, 0);
});

test("完全重复项审核状态冲突时保守降级为待确认且不自动勾选", () => {
  type ReviewCard = KnowledgeMethodCardForDeduplication & {
    ingestRecommend: string;
    selected: boolean;
    confidence: string;
    confidenceReason: string;
    ingestReason: string;
    reusableValue: string;
  };
  const approved: ReviewCard = {
    ...card("1", { unsuitableCases: ["纯事实播报"] }),
    ingestRecommend: "建议入库",
    selected: true,
    confidence: "高",
    confidenceReason: "原文证据充分，属于高置信度",
    ingestReason: "建议直接入库使用",
    reusableValue: "用于选题策划",
  };
  const pending: ReviewCard = {
    ...card("2"),
    ingestRecommend: "待确认",
    selected: false,
    confidence: "中",
    confidenceReason: "部分判断需要人工确认",
    ingestReason: "确认适用边界后再入库",
    reusableValue: "用于观点短视频",
  };

  const result = groupKnowledgeMethodCards([approved, pending]);

  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0]?.ingestRecommend, "待确认");
  assert.equal(result.cards[0]?.selected, false);
  assert.equal(result.cards[0]?.confidence, "中");
  assert.match(result.cards[0]?.confidenceReason ?? "", /置信度判断不一致.*人工确认/);
  assert.match(result.cards[0]?.ingestReason ?? "", /入库建议不一致.*人工确认/);
  assert.match(result.cards[0]?.reusableValue ?? "", /选题策划/);
  assert.match(result.cards[0]?.reusableValue ?? "", /观点短视频/);
});

test("完全重复判断不能通过相似关系传递后链式合并", () => {
  const first = card("1", { applicableScenarios: ["场景1", "场景2", "场景3", "场景4", "场景5"] });
  const bridge = card("2", { applicableScenarios: ["场景1", "场景2", "场景3", "场景4", "场景5", "场景6"] });
  const third = card("3", { applicableScenarios: ["场景2", "场景3", "场景4", "场景5", "场景6"] });

  const result = groupKnowledgeMethodCards([first, bridge, third]);

  assert.equal(result.cards.length, 3);
  assert.equal(result.exactDuplicateCount, 0);
});

test("疑似重复组必须组内两两相似，不能通过中间卡片链式串联", () => {
  const first = card("1", { coreMethod: "先提出问题再给答案" });
  const bridge = card("2", { coreMethod: "先提出问题分析原因再给答案" });
  const third = card("3", { coreMethod: "先分析原因再给答案" });

  const result = groupKnowledgeMethodCards([first, bridge, third]);

  assert.deepEqual(result.similarGroups.map(group => group.cardIds), [["1", "2"]]);
});

test("正负号和币种符号必须参与完全重复判断", () => {
  const increase = card("1", { coreMethod: "利润增长+10%" });
  const decrease = card("2", { coreMethod: "利润增长-10%" });
  const renminbi = card("3", { coreMethod: "客单价¥99" });
  const dollar = card("4", { coreMethod: "客单价$99" });

  const result = groupKnowledgeMethodCards([increase, decrease, renminbi, dollar]);

  assert.equal(result.cards.length, 4);
  assert.equal(result.exactDuplicateCount, 0);
});

test("比较符号和运算符号必须参与完全重复判断", () => {
  const atLeast = card("1", { coreMethod: "转化率≥10%" });
  const atMost = card("2", { coreMethod: "转化率≤10%" });
  const greaterThan = card("3", { coreMethod: "温度>30℃" });
  const lessThan = card("4", { coreMethod: "温度<30℃" });
  const multiply = card("5", { coreMethod: "先计算A×B" });
  const divide = card("6", { coreMethod: "先计算A÷B" });

  const result = groupKnowledgeMethodCards([
    atLeast,
    atMost,
    greaterThan,
    lessThan,
    multiply,
    divide,
  ]);

  assert.equal(result.cards.length, 6);
  assert.equal(result.exactDuplicateCount, 0);
});

test("小数点必须参与完全重复判断", () => {
  const decimal = card("1", { coreMethod: "增长1.5倍" });
  const integer = card("2", { coreMethod: "增长15倍" });

  const result = groupKnowledgeMethodCards([decimal, integer]);

  assert.equal(result.cards.length, 2);
  assert.equal(result.exactDuplicateCount, 0);
});

test("除法斜杠必须参与完全重复判断", () => {
  const fraction = card("1", { coreMethod: "比例1/2" });
  const integer = card("2", { coreMethod: "比例12" });

  const result = groupKnowledgeMethodCards([fraction, integer]);

  assert.equal(result.cards.length, 2);
  assert.equal(result.exactDuplicateCount, 0);
});

test("比例冒号必须参与完全重复判断", () => {
  const ratio = card("1", { coreMethod: "比例1:2" });
  const integer = card("2", { coreMethod: "比例12" });

  const result = groupKnowledgeMethodCards([ratio, integer]);

  assert.equal(result.cards.length, 2);
  assert.equal(result.exactDuplicateCount, 0);
});

test("百分号、括号和等号等语义符号不会在完全重复判断中丢失", () => {
  const percentage = card("1", { coreMethod: "转化率10%" });
  const plainNumber = card("2", { coreMethod: "转化率10" });
  const groupedFormula = card("3", { coreMethod: "计算(A+B)×C" });
  const flatFormula = card("4", { coreMethod: "计算A+B×C" });
  const equality = card("5", { coreMethod: "判断A=B" });
  const letters = card("6", { coreMethod: "判断AB" });

  const result = groupKnowledgeMethodCards([
    percentage,
    plainNumber,
    groupedFormula,
    flatFormula,
    equality,
    letters,
  ]);

  assert.equal(result.cards.length, 6);
  assert.equal(result.exactDuplicateCount, 0);
});

test("上标、下标、分数字符和大小写必须参与完全重复判断", () => {
  const superscript = card("1", { coreMethod: "计算x²" });
  const plainPower = card("2", { coreMethod: "计算x2" });
  const subscript = card("3", { coreMethod: "分析H₂O" });
  const plainFormula = card("4", { coreMethod: "分析H2O" });
  const singleFraction = card("5", { coreMethod: "比例½" });
  const writtenFraction = card("6", { coreMethod: "比例1/2" });
  const uppercase = card("7", { coreMethod: "变量A" });
  const lowercase = card("8", { coreMethod: "变量a" });

  const result = groupKnowledgeMethodCards([
    superscript,
    plainPower,
    subscript,
    plainFormula,
    singleFraction,
    writtenFraction,
    uppercase,
    lowercase,
  ]);

  assert.equal(result.cards.length, 8);
  assert.equal(result.exactDuplicateCount, 0);
});

test("真正等价的全角半角和空白写法仍可识别为完全重复", () => {
  const fullWidth = card("1", { coreMethod: "计算 Ａ＋Ｂ" });
  const halfWidth = card("2", { coreMethod: "计算A+B" });

  const result = groupKnowledgeMethodCards([fullWidth, halfWidth]);

  assert.equal(result.cards.length, 1);
  assert.equal(result.exactDuplicateCount, 1);
});

test("全角半角货币符号按同币种合并且不同币种保持区分", () => {
  const fullWidthYen = card("1", { coreMethod: "客单价￥99" });
  const yen = card("2", { coreMethod: "客单价¥99" });
  const fullWidthPound = card("3", { coreMethod: "客单价￡99" });
  const pound = card("4", { coreMethod: "客单价£99" });
  const fullWidthWon = card("5", { coreMethod: "客单价￦99" });
  const won = card("6", { coreMethod: "客单价₩99" });
  const fullWidthDollar = card("7", { coreMethod: "客单价＄99" });
  const dollar = card("8", { coreMethod: "客单价$99" });

  for (const pair of [
    [fullWidthYen, yen],
    [fullWidthPound, pound],
    [fullWidthWon, won],
    [fullWidthDollar, dollar],
  ]) {
    const pairResult = groupKnowledgeMethodCards(pair);
    assert.equal(pairResult.cards.length, 1);
    assert.equal(pairResult.exactDuplicateCount, 1);
  }

  const distinctCurrencies = groupKnowledgeMethodCards([yen, pound, won, dollar]);
  assert.equal(distinctCurrencies.cards.length, 4);
  assert.equal(distinctCurrencies.exactDuplicateCount, 0);
});

test("仅置信度冲突时审核说明不能误报入库建议冲突", () => {
  const high = card("1", {
    ingestRecommend: "建议入库",
    ingestReason: "方法完整，可以入库",
    selected: true,
    confidence: "高",
    confidenceReason: "原文证据充分",
  });
  const medium = card("2", {
    ingestRecommend: "建议入库",
    ingestReason: "方法完整，可以入库",
    selected: true,
    confidence: "中",
    confidenceReason: "部分边界需要确认",
  });

  const result = groupKnowledgeMethodCards([high, medium]);
  const merged = result.cards[0];

  assert.equal(merged?.ingestRecommend, "待确认");
  assert.equal(merged?.selected, false);
  assert.equal(merged?.confidence, "中");
  assert.match(merged?.ingestReason ?? "", /置信度判断不一致/);
  assert.doesNotMatch(merged?.ingestReason ?? "", /入库建议不一致/);
  assert.match(merged?.confidenceReason ?? "", /置信度判断不一致/);
});

test("核心内容高度相似但并非完全一致时保留两张并归入疑似重复组", () => {
  const first = card("1");
  const second = card("2", {
    title: "用反常识制造选题冲突",
    summary: "通过反常识冲突解决知识类选题吸引力不足的问题",
    coreMethod: "先写出大众默认判断，再用一个真实反例完成推翻",
    aiUsage: "选题没有冲突时，调用真实反例重新设计切入角度",
  });

  const result = groupKnowledgeMethodCards([first, second]);

  assert.equal(result.cards.length, 2);
  assert.equal(result.exactDuplicateCount, 0);
  assert.deepEqual(result.similarGroups.map(group => group.cardIds), [["1", "2"]]);
});

test("只有标题关键词相似但核心方法和用途不同的方法卡正常保留", () => {
  const selection = card("1");
  const opening = card("2", {
    title: "反常识开头法",
    summary: "解决口播前3秒留不住人的问题",
    coreMethod: "先展示结果画面，再隐藏关键答案制造悬念",
    applicableScenarios: ["短视频开头"],
    category: "开头方法库",
    aiUsage: "生成开头时用结果前置和信息缺口提高停留",
  });

  const result = groupKnowledgeMethodCards([selection, opening]);

  assert.equal(result.cards.length, 2);
  assert.equal(result.exactDuplicateCount, 0);
  assert.equal(result.similarGroups.length, 0);
});

test("用户合并疑似重复组时保留较完整内容并汇总字段和来源", () => {
  const first = card("1", { applicableScenarios: ["知识口播"] });
  const second = card("2", {
    title: "用反常识制造选题冲突",
    applicableScenarios: ["观点短视频"],
    examples: [{ input: "普通观点", output: "反常识切入" }],
  });

  const merged = mergeKnowledgeMethodCards([first, second]);

  assert.deepEqual(merged.applicableScenarios, ["知识口播", "观点短视频"]);
  assert.deepEqual(merged.sourceSegments.map(source => source.title), ["章节1", "章节2"]);
  assert.equal(merged.examples?.length ?? 0, 1);
});

test("示例输入输出包含冒号时使用无歧义组合键并保留两条独有示例", () => {
  const first = card("1", {
    examples: [{ input: "比例1:2", output: "适用" }],
  });
  const second = card("2", {
    examples: [{ input: "比例1", output: "2:适用" }],
  });

  const merged = mergeKnowledgeMethodCards([first, second]);

  assert.deepEqual(merged.examples, [
    { input: "比例1:2", output: "适用" },
    { input: "比例1", output: "2:适用" },
  ]);
});
