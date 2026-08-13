import assert from "node:assert/strict";
import test from "node:test";
import { buildScriptDirectorBlock, isScriptDirectorProfileId } from "./script-director-profile";

test("水木然专属编导规则强调动态结构和观点出处", () => {
  const block = buildScriptDirectorBlock("shuimuran-v1");

  assert.match(block, /不能替IP创造老师从未表达过的核心判断/);
  assert.match(block, /按素材选择需要的动作/);
  assert.match(block, /不得强制走满/);
  assert.match(block, /动物人/);
  assert.match(block, /只有.*原始表达.*支撑/);
  assert.match(block, /认知分层/);
  assert.match(block, /即时刺激/);
  assert.match(block, /标题优先采用“时代趋势＋明确人群＋明确结果”/);
  assert.match(block, /生成时必须区分：已核实事实、老师观点、文化传说、待核验内容/);
  assert.match(block, /主推标题[\s\S]*流量标题[\s\S]*安全标题/);
});

test("未设置专属编导规则时不注入水木然母题", () => {
  assert.equal(buildScriptDirectorBlock(undefined), "");
  assert.equal(buildScriptDirectorBlock(null), "");
});

test("只接受已经登记的专属编导规则编号", () => {
  assert.equal(isScriptDirectorProfileId("shuimuran-v1"), true);
  assert.equal(isScriptDirectorProfileId("unknown"), false);
});
