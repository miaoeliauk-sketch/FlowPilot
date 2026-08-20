import assert from "node:assert/strict";
import test from "node:test";
import { SPOKEN_PUNCTUATION_GENERATION_RULES } from "./script-spoken-punctuation-policy";

test("口播标点生成规则区分作品名、资料名、可追溯原话、强调词和模拟对话", () => {
  assert.match(SPOKEN_PUNCTUATION_GENERATION_RULES, /正式书籍、经典和影视作品名称保留书名号/);
  assert.match(SPOKEN_PUNCTUATION_GENERATION_RULES, /课程、清单、资料包等名称改成自然口语/);
  assert.match(SPOKEN_PUNCTUATION_GENERATION_RULES, /老师原话[^\n]*必须能追溯到本次提供的原始材料/);
  assert.doesNotMatch(SPOKEN_PUNCTUATION_GENERATION_RULES, /老师原话[^\n]*必须能追溯到当前IP原始内容/);
  assert.match(SPOKEN_PUNCTUATION_GENERATION_RULES, /不能因为加了引号就判定为老师原话/);
  assert.match(SPOKEN_PUNCTUATION_GENERATION_RULES, /仅用于强调的引号全部删除/);
  assert.match(SPOKEN_PUNCTUATION_GENERATION_RULES, /人物对话、经典原文和模拟对话可以保留引号/);
  assert.match(SPOKEN_PUNCTUATION_GENERATION_RULES, /统一使用中文引号“”/);
});
