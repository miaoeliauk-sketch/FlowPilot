import assert from "node:assert/strict";
import test from "node:test";

import { auditScriptFactoryGlobalConstraints } from "./script-factory-global-constraint-audit";

function activeRuleFixture() {
  return {
    schemaVersion: 2,
    ruleId: "global-constraint-emotional-coercion",
    sourceKnowledgeEntryId: "knowledge-expression-motive",
    sourceSnapshot: {
      title: "禁止情绪绑架",
      rawContentSha256: "a".repeat(64),
    },
    scope: "all_ips",
    category: "通用禁用规则",
    priority: "global_baseline",
    enforcement: "block",
    status: "active",
    title: "禁止利用无力感进行情绪绑架",
    canonicalText: "禁止利用受众的无力感进行情绪操纵。",
    prohibitedIntent: "利用受众的无力感进行情绪操纵",
    allowedBoundaries: ["引用", "批判"],
    detection: {
      type: "keyword",
      matchMode: "any",
      terms: ["被时代抛弃"],
    },
    humanConfirmation: {
      confirmedBy: "彭彭",
      confirmedAt: "2026-08-29T14:00:00.000Z",
      confirmationMethod: "explicit_ui_action",
      identityAssurance: "self_asserted",
    },
    revision: 1,
    createdAt: "2026-08-29T14:00:00.000Z",
    updatedAt: "2026-08-29T14:00:00.000Z",
  };
}

function emptyAuditInput() {
  return {
    titles: [] as Array<{ title: string }>,
    coverCopy: [] as string[],
    outline: [] as Array<{ content: string }>,
    commentGuidance: {
      interactionPrompt: "",
      keywordReplies: [] as Array<{ keyword: string; reply: string }>,
      dmGuidance: "",
      materialPackGuidance: "",
    },
    storyboard: [] as Array<{
      time: string;
      scene: string;
      voiceover: string;
      subtitle: string;
      shot: string;
      material: string;
      editingTip: string;
    }>,
    shootingSuggestions: [] as string[],
    shotPrompts: [] as Array<{ scene: string; prompt: string }>,
    editingRhythm: {
      subtitleHighlights: [] as string[],
      soundEffects: [] as string[],
      screenRecordingCuts: [] as string[],
      caseInserts: [] as string[],
      pauses: [] as string[],
    },
  };
}

test("同一句口播被分镜口播和字幕复用时合并展示并列出全部来源", () => {
  const sentence = "我们反对用被时代抛弃这种说法贩卖焦虑。";
  const input = emptyAuditInput();
  input.outline = [{ content: sentence }];
  input.storyboard = [{
    time: "0—5秒",
    scene: "人物正面口播",
    voiceover: sentence,
    subtitle: sentence,
    shot: "中景",
    material: "",
    editingTip: "",
  }];

  const result = auditScriptFactoryGlobalConstraints(input, [activeRuleFixture()]);

  assert.equal(result.matches.length, 1);
  assert.deepEqual(result.matches[0]?.sources, ["口播正文", "分镜口播", "分镜字幕"]);
  assert.equal(result.matches[0]?.matchedText, "被时代抛弃");
});

test("口播正文中两个独立句子真实出现同一短语时仍分别报告", () => {
  const input = emptyAuditInput();
  input.outline = [{
    content: "有人担心自己会被时代抛弃。也有人反复警告别人会被时代抛弃。",
  }];

  const result = auditScriptFactoryGlobalConstraints(input, [activeRuleFixture()]);

  assert.equal(result.matches.length, 2);
  assert.deepEqual(
    result.matches.map(match => ({ matchedText: match.matchedText, sources: match.sources })),
    [
      { matchedText: "被时代抛弃", sources: ["口播正文"] },
      { matchedText: "被时代抛弃", sources: ["口播正文"] },
    ],
  );
  assert.notEqual(result.matches[0]?.start, result.matches[1]?.start);
});

test("分镜在同一句口播前增加呈现提示时仍合并为同一逻辑命中", () => {
  const sentence = "不要用被时代抛弃制造焦虑。";
  const input = emptyAuditInput();
  input.outline = [{ content: sentence }];
  input.storyboard = [{
    time: "0—5秒",
    scene: "人物正面口播",
    voiceover: `主播强调：${sentence}`,
    subtitle: sentence,
    shot: "中景",
    material: "",
    editingTip: "",
  }];

  const result = auditScriptFactoryGlobalConstraints(input, [activeRuleFixture()]);

  assert.equal(result.matches.length, 1);
  assert.deepEqual(result.matches[0]?.sources, ["口播正文", "分镜口播", "分镜字幕"]);
});

test("标题说明和口播结构字段保持原有审计覆盖面", () => {
  const input = {
    ...emptyAuditInput(),
    titles: [{
      title: "安全标题",
      formula: "被时代抛弃",
      platform: "视频号",
      whyFitsIP: "安全说明",
    }],
    outline: [{
      label: "安全段落",
      timeRange: "0—60秒",
      content: "安全正文",
      subPoints: ["被时代抛弃"],
    }],
  };

  const result = auditScriptFactoryGlobalConstraints(input, [activeRuleFixture()]);

  assert.equal(result.matches.length, 2);
  assert.deepEqual(result.matches.map(match => match.sources), [["标题"], ["口播正文"]]);
});

test("多个标题候选产生完全相同的命中时只展示一条标题记录", () => {
  const input = {
    ...emptyAuditInput(),
    titles: [
      { title: "别再用被时代抛弃制造焦虑" },
      { title: "别再用被时代抛弃制造焦虑" },
    ],
  };

  const result = auditScriptFactoryGlobalConstraints(input, [activeRuleFixture()]);

  assert.equal(result.matches.length, 1);
  assert.deepEqual(result.matches[0]?.sources, ["标题"]);
  assert.equal(result.matches[0]?.matchedText, "被时代抛弃");
});

test("同一标题句子中的真实多次命中保留且标题说明副本不重复展示", () => {
  const input = {
    ...emptyAuditInput(),
    titles: [{
      title: "担心被时代抛弃，不等于可以警告别人会被时代抛弃",
      formula: "被时代抛弃",
    }],
  };

  const result = auditScriptFactoryGlobalConstraints(input, [activeRuleFixture()]);

  assert.equal(result.matches.length, 2);
  assert.deepEqual(result.matches.map(match => match.sources), [["标题"], ["标题"]]);
  assert.notEqual(result.matches[0]?.start, result.matches[1]?.start);
});

test("拍摄制作层的情绪操纵执行指令会被通用规则拦截", () => {
  const input = emptyAuditInput();
  input.storyboard = [{
    time: "0—8秒",
    scene: "人物正面口播",
    voiceover: "先解释这种焦虑从哪里来。",
    subtitle: "先看清焦虑来源",
    shot: "中景",
    material: "",
    editingTip: "加入紧张的心跳声或低频音效，营造焦虑感",
  }];
  input.shootingSuggestions = ["通过压低光线强化无力感"];
  input.editingRhythm.subtitleHighlights = ["放大警告字幕，制造恐慌"];

  const result = auditScriptFactoryGlobalConstraints(input, [activeRuleFixture()]);

  assert.equal(result.reviewRequired, true);
  assert.deepEqual(
    result.matches.map(match => ({ matchedText: match.matchedText, sources: match.sources })),
    [
      { matchedText: "营造焦虑感", sources: ["分镜剪辑建议"] },
      { matchedText: "强化无力感", sources: ["拍摄建议"] },
      { matchedText: "制造恐慌", sources: ["剪辑建议"] },
    ],
  );
});

test("明确风险短语即使处于批评语境也只做召回并交由人工判断", () => {
  const input = emptyAuditInput();
  input.storyboard = [{
    time: "0—8秒",
    scene: "人物正面口播",
    voiceover: "先解释这种焦虑从哪里来。",
    subtitle: "先看清焦虑来源",
    shot: "中景",
    material: "",
    editingTip: "不要加入心跳声营造焦虑感",
  }];
  input.shootingSuggestions = ["避免通过压低光线强化无力感"];
  input.editingRhythm.subtitleHighlights = ["反对用放大字幕制造恐慌"];

  const result = auditScriptFactoryGlobalConstraints(input, [activeRuleFixture()]);

  assert.equal(result.reviewRequired, true);
  assert.deepEqual(
    result.matches.map(match => ({ matchedText: match.matchedText, sources: match.sources })),
    [
      { matchedText: "营造焦虑感", sources: ["分镜剪辑建议"] },
      { matchedText: "强化无力感", sources: ["拍摄建议"] },
      { matchedText: "制造恐慌", sources: ["剪辑建议"] },
    ],
  );
});

test("音效字段中的情绪操纵执行指令会被拦截", () => {
  const input = emptyAuditInput();
  input.editingRhythm.soundEffects = ["持续叠加低频心跳声，营造焦虑感"];

  const result = auditScriptFactoryGlobalConstraints(input, [activeRuleFixture()]);

  assert.equal(result.reviewRequired, true);
  assert.deepEqual(
    result.matches.map(match => ({ matchedText: match.matchedText, sources: match.sources })),
    [{ matchedText: "营造焦虑感", sources: ["剪辑建议"] }],
  );
});
