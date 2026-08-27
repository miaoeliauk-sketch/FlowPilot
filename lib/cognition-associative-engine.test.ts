import assert from "node:assert/strict";
import test from "node:test";

const engineModulePath = "./cognition-associative-engine";

test("新观点与存量认知共享核心表达时进入字面候选", async () => {
  const { calculateLexicalSimilarity } = await import(engineModulePath);
  const existingNode = "IP大脑需要通过结构化账本记录认知。";
  const input = "结构化账本是IP大脑记录核心观点的关键。";

  const score = calculateLexicalSimilarity(input, existingNode);

  assert.ok(score > 0.25, `预期字面重叠度大于0.25，实际为${score}`);
});

test("完全相同的文本得到满分字面重叠度", async () => {
  const { calculateLexicalSimilarity } = await import(engineModulePath);
  const text = "结构化账本记录IP大脑认知";

  assert.equal(calculateLexicalSimilarity(text, text), 1);
});

test("完全无重叠的文本得到零分", async () => {
  const { calculateLexicalSimilarity } = await import(engineModulePath);

  assert.equal(calculateLexicalSimilarity("结构化账本", "今天下雨"), 0);
});

test("立场相反但关键词高度重合时仍得到较高字面分数", async () => {
  const { calculateLexicalSimilarity } = await import(engineModulePath);

  // 本层只衡量文字重叠，不理解“不”带来的立场反转；冲突判断属于语义审计层。
  const score = calculateLexicalSimilarity("我今天很开心", "我今天很不开心");

  assert.ok(score > 0.5, `预期字面重叠度大于0.5，实际为${score}`);
});

test("中英混合文本分别切分后合并计算", async () => {
  const { calculateLexicalSimilarity } = await import(engineModulePath);
  const score = calculateLexicalSimilarity(
    "FlowPilot通过IP大脑记录认知",
    "flowpilot使用IP大脑记录观点",
  );

  assert.ok(score > 0.4, `预期中英混合字面重叠度大于0.4，实际为${score}`);
});
