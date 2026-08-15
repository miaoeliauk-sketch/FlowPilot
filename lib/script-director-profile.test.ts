import assert from "node:assert/strict";
import test from "node:test";
import { buildScriptDirectorBlock, isScriptDirectorProfileId, shouldUseShuimuranDirector } from "./script-director-profile";

test("水木然老师确认版规则包含时效、悬念、压缩和最终输出约束", () => {
  const block = buildScriptDirectorBlock("shuimuran-v1");

  assert.match(block, /老师最新修改意见＞老师已经通过的成稿/);
  assert.match(block, /不超过24小时，可以直接追热点/);
  assert.match(block, /标题要有神秘、幽深和窥探感/);
  assert.match(block, /胖东来的经营秘诀，就是《道德经》的这八个字/);
  assert.match(block, /开头前15秒依次完成/);
  assert.match(block, /强制进行一次20%至30%的精简/);
  assert.match(block, /只输出以下内容/);
  assert.match(block, /标题：[\s\S]*完整口播文案：[\s\S]*待核验内容：/);
});

test("水木然增量修正规则追加在原规则之后且只允许IP专属模式启用", () => {
  const block = buildScriptDirectorBlock("shuimuran-v1");

  assert.ok(
    block.indexOf("【水木然IP专属脚本生成规则｜老师确认版】")
      < block.indexOf("【水木然IP专属生成｜增量修正规则】"),
  );
  assert.match(block, /老师最新修改意见和已通过文案＞本增量规则＞原有水木然规则＞通用脚本规则/);
  assert.match(block, /胖东来不依赖低价竞争/);
  assert.match(block, /胖东来不少门店实行周二闭店/);
  assert.match(block, /胖东来看似退出了规模竞争，实际上守住了品质、信任和口碑/);
  assert.match(block, /最终只能输出：[\s\S]*标题[\s\S]*完整口播文案[\s\S]*待核实信息/);
  assert.match(block, /任何一项不符合，都必须修改后再输出/);

  assert.equal(shouldUseShuimuranDirector({
    generationMode: "ip",
    ipName: "水木然",
    profileId: "shuimuran-v1",
  }), true);
  assert.equal(shouldUseShuimuranDirector({
    generationMode: "standard",
    ipName: "水木然",
    profileId: "shuimuran-v1",
  }), false);
  assert.equal(shouldUseShuimuranDirector({
    generationMode: "ip",
    ipName: "其他IP",
    profileId: "shuimuran-v1",
  }), false);
});

test("未设置专属编导规则时不注入水木然母题", () => {
  assert.equal(buildScriptDirectorBlock(undefined), "");
  assert.equal(buildScriptDirectorBlock(null), "");
});

test("只接受已经登记的专属编导规则编号", () => {
  assert.equal(isScriptDirectorProfileId("shuimuran-v1"), true);
  assert.equal(isScriptDirectorProfileId("unknown"), false);
});
