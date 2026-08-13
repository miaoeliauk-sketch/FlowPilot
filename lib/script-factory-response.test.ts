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

test("水木然专属标题必须同时提供主推、流量和安全三个版本", () => {
  const result = parseScriptContentResponse(JSON.stringify({
    ...VALID_CONTENT,
    titles: [
      { title: "主推标题", formula: "核心冲突", platform: "视频号", whyFitsIP: "切中核心判断", role: "主推", recommended: true },
      { title: "流量标题", formula: "危机感", platform: "视频号", whyFitsIP: "力度更强", role: "流量", recommended: false },
      { title: "安全标题", formula: "克制判断", platform: "视频号", whyFitsIP: "表达更稳妥", role: "安全", recommended: false },
    ],
  }), { titleMode: "shuimuran" });

  assert.equal(result.titles.length, 3);
  assert.equal(result.titles[0].recommended, true);
});

test("水木然专属标题缺少任一版本时拒绝结果", () => {
  expectError(() => parseScriptContentResponse(JSON.stringify({
    ...VALID_CONTENT,
    titles: [
      { title: "主推标题", role: "主推", recommended: true },
      { title: "流量标题", role: "流量", recommended: false },
    ],
  }), { titleMode: "shuimuran" }), "incomplete_fields");
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
