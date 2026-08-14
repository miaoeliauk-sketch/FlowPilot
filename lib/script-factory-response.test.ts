import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 24 executes this TypeScript test directly.
import { ScriptFactoryResponseError, parseScriptContentResponse, parseScriptStoryboardResponse } from "./script-factory-response.ts";

const VALID_CONTENT = {
  titles: [{
    title: "AI知识库到底解决什么问题",
    formula: "问题+价值",
    platform: "B站",
    whyFitsIP: "符合IP的实操定位",
  }],
  coverCopy: ["AI知识库怎么用"],
  outline: [{
    label: "问题引入",
    timeRange: "0-1分钟",
    content: "先解释为什么需要AI知识库。",
    subPoints: ["信息分散"],
  }],
  commentGuidance: {
    interactionPrompt: "你最想让AI记住什么？",
    keywordReplies: [{ keyword: "知识库", reply: "可以先从常用资料开始。" }],
    dmGuidance: "",
    materialPackGuidance: "",
  },
  ipStyleExplanation: "使用了该IP常见的实操拆解方式。",
};

const VALID_STORYBOARD = {
  storyboard: [{
    time: "0-10秒",
    scene: "人物出镜",
    voiceover: "先提出问题。",
    subtitle: "AI知识库",
    shot: "中景",
    material: "",
    editingTip: "关键词放大",
  }],
  shootingSuggestions: ["使用固定机位录制。"],
  shotPrompts: [],
  editingRhythm: {
    subtitleHighlights: ["AI知识库"],
    soundEffects: [],
    screenRecordingCuts: [],
    caseInserts: [],
    pauses: [],
  },
};

function expectError(
  callback: () => unknown,
  code: ScriptFactoryResponseError["code"],
) {
  assert.throws(
    callback,
    (error: unknown) =>
      error instanceof ScriptFactoryResponseError && error.code === code,
  );
}

test("rejects truncated core JSON instead of returning fallback script", () => {
  expectError(
    () => parseScriptContentResponse('{"titles":[],"outline":[{"content":"未结束'),
    "invalid_json",
  );
});

test("parses core JSON wrapped in a markdown code block", () => {
  const result = parseScriptContentResponse(
    `\`\`\`json\n${JSON.stringify(VALID_CONTENT)}\n\`\`\``,
  );
  assert.equal(result.outline[0].content, "先解释为什么需要AI知识库。");
});

test("normalizes safe optional core fields", () => {
  const result = parseScriptContentResponse(JSON.stringify({
    ...VALID_CONTENT,
    coverCopy: "AI知识库怎么用",
    outline: [{ ...VALID_CONTENT.outline[0], subPoints: "信息分散" }],
    commentGuidance: {
      ...VALID_CONTENT.commentGuidance,
      keywordReplies: undefined,
    },
  }));
  assert.deepEqual(result.coverCopy, ["AI知识库怎么用"]);
  assert.deepEqual(result.outline[0].subPoints, ["信息分散"]);
  assert.deepEqual(result.commentGuidance.keywordReplies, []);
});

test("水木然老师确认版只接受一个标题、完整口播和待核验清单", () => {
  const result = parseScriptContentResponse(JSON.stringify({
    titles: [
      { title: "胖东来的真正秘密，藏在《道德经》里" },
    ],
    fullScript: "胖东来真正厉害的地方，根本不是服务。完整口播正文。",
    pendingVerification: ["《道德经》原文出处待确认"],
  }), { outputMode: "shuimuran-confirmed" });

  assert.equal(result.titles.length, 1);
  assert.equal(result.outline.length, 1);
  assert.equal(result.outline[0].content, "胖东来真正厉害的地方，根本不是服务。完整口播正文。");
  assert.deepEqual(result.pendingVerification, ["《道德经》原文出处待确认"]);
  assert.deepEqual(result.coverCopy, []);
  assert.equal(result.ipStyleExplanation, "");
});

test("水木然老师确认版缺少完整口播时拒绝结果", () => {
  expectError(() => parseScriptContentResponse(JSON.stringify({
    titles: [{ title: "胖东来的真正秘密" }],
    pendingVerification: [],
  }), { outputMode: "shuimuran-confirmed" }), "incomplete_fields");
});

test("水木然老师确认版拒绝缺少待核验字段或夹带额外输出", () => {
  expectError(() => parseScriptContentResponse(JSON.stringify({
    titles: [{ title: "胖东来的真正秘密" }],
    fullScript: "完整口播正文。",
  }), { outputMode: "shuimuran-confirmed" }), "incomplete_fields");

  expectError(() => parseScriptContentResponse(JSON.stringify({
    titles: [{ title: "胖东来的真正秘密" }],
    fullScript: "完整口播正文。",
    pendingVerification: [],
    writingNotes: "不应输出的写作思路",
  }), { outputMode: "shuimuran-confirmed" }), "incomplete_fields");
});

test("rejects core response when the required transcript is missing", () => {
  expectError(
    () => parseScriptContentResponse(JSON.stringify({
      ...VALID_CONTENT,
      outline: [{ label: "问题引入", timeRange: "0-1分钟", content: "" }],
    })),
    "incomplete_fields",
  );
});

test("rejects a structurally partial transcript", () => {
  expectError(
    () => parseScriptContentResponse(
      JSON.stringify(VALID_CONTENT),
      { expectedOutlineCount: 5 },
    ),
    "incomplete_fields",
  );
});

test("rejects a transcript below the conservative duration floor", () => {
  expectError(
    () => parseScriptContentResponse(
      JSON.stringify(VALID_CONTENT),
      { minimumTranscriptChars: 100 },
    ),
    "incomplete_fields",
  );
});

test("rejects storyboard response when requested shooting advice is missing", () => {
  expectError(
    () => parseScriptStoryboardResponse(
      JSON.stringify({ ...VALID_STORYBOARD, shootingSuggestions: [] }),
      { needsStoryboard: true, needsShootingTips: true },
    ),
    "incomplete_fields",
  );
});

test("parses a complete storyboard response", () => {
  const result = parseScriptStoryboardResponse(
    JSON.stringify(VALID_STORYBOARD),
    { needsStoryboard: true, needsShootingTips: true },
  );
  assert.equal(result.storyboard.length, 1);
  assert.equal(result.shootingSuggestions.length, 1);
});
