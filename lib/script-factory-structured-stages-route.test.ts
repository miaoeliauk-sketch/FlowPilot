import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/script-factory/route";
import type { IPProfile } from "./types";

const TEST_IP: IPProfile = {
  id: "ip-current",
  name: "当前测试IP",
  avatar: "测",
  positioning: "商业知识作者",
  platforms: ["视频号"],
  audience: "关注商业认知的人",
  contentDirection: ["商业认知"],
  personaKeywords: ["理性"],
  professionalIdentity: "商业作者",
  personalityTags: ["克制"],
  credibilitySource: "持续公开表达",
  representativeViewpoints: ["判断要有依据"],
  tone: "理性克制",
  commonOpenings: [],
  commonClosings: [],
  catchphrases: [],
  forbiddenExpressions: [],
  pacing: "层层递进",
  commonScenes: ["书房"],
  commonShotTypes: ["正面口播"],
  showsFace: true,
  usesScreenRecording: false,
  needsBroll: true,
  needsCaseScreenshots: false,
  needsSubtitleHighlight: true,
  sampleViralTitles: [],
  styleNotes: "",
  bio: "商业知识作者",
  color: "#334455",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};

const VALID_CONTENT = {
  titles: [{
    title: "普通人如何判断行业变化",
    formula: "问题+判断",
    platform: "视频号",
    whyFitsIP: "符合商业认知定位",
  }],
  coverCopy: ["变化已经开始"],
  outline: [
    { label: "现象", timeRange: "0-10秒", content: "真正的变化往往先体现在普通人的具体选择里，而不是出现在热闹的口号中。", subPoints: [] },
    { label: "误区", timeRange: "10-20秒", content: "只盯着短期结果，很容易把偶然波动误认为长期趋势，也容易错过真正重要的信号。", subPoints: [] },
    { label: "判断", timeRange: "20-35秒", content: "判断行业变化，需要同时观察真实需求、成本结构和用户行为是否持续发生变化。", subPoints: [] },
    { label: "推理", timeRange: "35-50秒", content: "当这几个信号彼此印证，变化才可能不是短暂热点，而是正在形成的新规则。", subPoints: [] },
    { label: "结论", timeRange: "50-60秒", content: "普通人真正要做的，是在规则改变时及时调整选择，而不是等所有人都确认以后才行动。", subPoints: [] },
  ],
  commentGuidance: {
    interactionPrompt: "你观察到了什么变化？",
    keywordReplies: [],
    dmGuidance: "",
    materialPackGuidance: "",
  },
  ipStyleExplanation: "使用判断式表达。",
};

const VALID_ARGUMENT_REVIEW = { issues: [] };

const VALID_STORYBOARD = {
  storyboard: [{
    time: "0-10秒",
    scene: "人物出镜",
    voiceover: "真正的变化往往先体现在选择里。",
    subtitle: "变化先改变选择",
    shot: "中景",
    material: "",
    editingTip: "关键词放大",
  }],
  shootingSuggestions: ["使用固定机位录制。"],
  shotPrompts: [],
  editingRhythm: {
    subtitleHighlights: ["变化先改变选择"],
    soundEffects: [],
    screenRecordingCuts: [],
    caseInserts: [],
    pauses: [],
  },
};

const VALID_EXECUTION = {
  shootingSuggestions: ["按章节分段录制，并在章节切换处保留停顿。"],
};

function deepSeekResponse(
  content: string,
  id: string,
  finishReason: "stop" | "length" = "stop",
): Response {
  return new Response(JSON.stringify({
    id,
    choices: [{ finish_reason: finishReason, message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 200 },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function request(overrides: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("http://localhost/api/script-factory", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "test-key",
    },
    body: JSON.stringify({
      generationMode: "standard",
      ipProfile: TEST_IP,
      styleProfile: null,
      topic: "普通人如何判断行业变化",
      platform: "视频号",
      formatCategory: "short",
      durationSeconds: 60,
      goal: "建立信任",
      videoType: "口播",
      needsStoryboard: true,
      needsShootingTips: true,
      ...overrides,
    }),
  });
}

function combinedPrompt(init?: RequestInit): string {
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    messages?: Array<{ content?: string }>;
  };
  return (body.messages ?? []).map(message => message.content ?? "").join("\n");
}

function requestOptions(init?: RequestInit): {
  thinking?: { type?: string };
  response_format?: { type?: string };
} {
  return JSON.parse(String(init?.body ?? "{}")) as {
    thinking?: { type?: string };
    response_format?: { type?: string };
  };
}

test("分镜格式不完整时带着明确纠错要求重试且最多调用两次", async () => {
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  const options: ReturnType<typeof requestOptions>[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    prompts.push(combinedPrompt(init));
    options.push(requestOptions(init));
    if (calls === 1) return deepSeekResponse(JSON.stringify(VALID_CONTENT), "content");
    if (calls === 2) return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "argument-review");
    if (calls === 3) return deepSeekResponse('{"storyboard":[', "storyboard-invalid");
    return deepSeekResponse(JSON.stringify(VALID_STORYBOARD), "storyboard-valid");
  };

  try {
    const response = await POST(request());
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.generationStatus, "complete");
    assert.equal(calls, 4);
    assert.match(prompts[3] ?? "", /上次输出纠错要求/);
    assert.match(prompts[3] ?? "", /JSON|字段|格式/);
    assert.match(prompts[3] ?? "", /IP名称：当前测试IP/);
    assert.doesNotMatch(prompts[3] ?? "", /其他IP/);
    for (const stageRequest of options.slice(2)) {
      assert.equal(stageRequest.thinking?.type, "disabled");
      assert.equal(stageRequest.response_format?.type, "json_object");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("拍摄执行建议缺字段时带着明确纠错要求重试且最多调用两次", async () => {
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  const options: ReturnType<typeof requestOptions>[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    prompts.push(combinedPrompt(init));
    options.push(requestOptions(init));
    if (calls === 1) return deepSeekResponse(JSON.stringify(VALID_CONTENT), "content");
    if (calls === 2) return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "argument-review");
    if (calls === 3) return deepSeekResponse(JSON.stringify({ shootingSuggestions: [] }), "execution-invalid");
    return deepSeekResponse(JSON.stringify(VALID_EXECUTION), "execution-valid");
  };

  try {
    const response = await POST(request({
      formatCategory: "long",
      needsStoryboard: false,
      needsShootingTips: true,
    }));
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.generationStatus, "complete");
    assert.deepEqual(result.shootingSuggestions, VALID_EXECUTION.shootingSuggestions);
    assert.equal(calls, 4);
    assert.match(prompts[3] ?? "", /上次输出纠错要求/);
    assert.match(prompts[3] ?? "", /shootingSuggestions|字段|JSON/);
    assert.match(prompts[3] ?? "", /IP名称：当前测试IP/);
    assert.doesNotMatch(prompts[3] ?? "", /其他IP/);
    for (const stageRequest of options.slice(2)) {
      assert.equal(stageRequest.thinking?.type, "disabled");
      assert.equal(stageRequest.response_format?.type, "json_object");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("分镜连续两次格式不完整时仍交付核心脚本并标记部分完成", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return deepSeekResponse(JSON.stringify(VALID_CONTENT), "content");
    if (calls === 2) return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "argument-review");
    return deepSeekResponse('{"storyboard":[', `storyboard-invalid-${calls}`);
  };

  try {
    const response = await POST(request());
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 4);
    assert.equal(result.generationStatus, "partial");
    assert.equal(result.partialFailure?.stage, "storyboard");
    assert.equal(result.outline.length, VALID_CONTENT.outline.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("拍摄执行建议连续两次缺字段时仍交付核心脚本并标记部分完成", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return deepSeekResponse(JSON.stringify(VALID_CONTENT), "content");
    if (calls === 2) return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "argument-review");
    return deepSeekResponse(JSON.stringify({ shootingSuggestions: [] }), `execution-invalid-${calls}`);
  };

  try {
    const response = await POST(request({
      formatCategory: "long",
      needsStoryboard: false,
      needsShootingTips: true,
    }));
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 4);
    assert.equal(result.generationStatus, "partial");
    assert.equal(result.partialFailure?.stage, "execution");
    assert.equal(result.outline.length, VALID_CONTENT.outline.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("分镜返回完整JSON但结束原因为length时仍判定截断并重试", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return deepSeekResponse(JSON.stringify(VALID_CONTENT), "content");
    if (calls === 2) return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "argument-review");
    if (calls === 3) {
      return deepSeekResponse(JSON.stringify(VALID_STORYBOARD), "storyboard-truncated", "length");
    }
    return deepSeekResponse(JSON.stringify(VALID_STORYBOARD), "storyboard-complete");
  };

  try {
    const response = await POST(request());
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.generationStatus, "complete");
    assert.equal(calls, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("拍摄执行建议返回完整JSON但结束原因为length时仍判定截断并重试", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return deepSeekResponse(JSON.stringify(VALID_CONTENT), "content");
    if (calls === 2) return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "argument-review");
    if (calls === 3) {
      return deepSeekResponse(JSON.stringify(VALID_EXECUTION), "execution-truncated", "length");
    }
    return deepSeekResponse(JSON.stringify(VALID_EXECUTION), "execution-complete");
  };

  try {
    const response = await POST(request({
      formatCategory: "long",
      needsStoryboard: false,
      needsShootingTips: true,
    }));
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.generationStatus, "complete");
    assert.equal(calls, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("分镜连续两次结束原因为length时准确记录OUTPUT_TRUNCATED", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return deepSeekResponse(JSON.stringify(VALID_CONTENT), "content");
    if (calls === 2) return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "argument-review");
    return deepSeekResponse(JSON.stringify(VALID_STORYBOARD), `storyboard-truncated-${calls}`, "length");
  };

  try {
    const response = await POST(request());
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 4);
    assert.equal(result.generationStatus, "partial");
    assert.equal(result.partialFailure?.stage, "storyboard");
    assert.equal(result.partialFailure?.errorCode, "OUTPUT_TRUNCATED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("拍摄执行建议连续两次结束原因为length时准确记录OUTPUT_TRUNCATED", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return deepSeekResponse(JSON.stringify(VALID_CONTENT), "content");
    if (calls === 2) return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "argument-review");
    return deepSeekResponse(JSON.stringify(VALID_EXECUTION), `execution-truncated-${calls}`, "length");
  };

  try {
    const response = await POST(request({
      formatCategory: "long",
      needsStoryboard: false,
      needsShootingTips: true,
    }));
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 4);
    assert.equal(result.generationStatus, "partial");
    assert.equal(result.partialFailure?.stage, "execution");
    assert.equal(result.partialFailure?.errorCode, "OUTPUT_TRUNCATED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("分镜解析失败在本机诊断留痕中分别记录真实失败原因", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnabled = process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS;
  const originalCwd = process.cwd();
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "script-factory-stage-trace-"));
  const rootDir = path.join(projectDir, ".flowpilot-diagnostics", "script-factory");
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return deepSeekResponse(JSON.stringify(VALID_CONTENT), "content");
    if (calls === 2) return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "argument-review");
    if (calls === 3) return deepSeekResponse('{"storyboard":[', "storyboard-invalid-json");
    return deepSeekResponse(JSON.stringify({
      ...VALID_STORYBOARD,
      shootingSuggestions: [],
    }), "storyboard-incomplete-fields");
  };
  process.chdir(projectDir);
  process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS = "1";

  try {
    const response = await POST(request());
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.generationStatus, "partial");

    const generationDirectories = await readdir(rootDir);
    assert.equal(generationDirectories.length, 1);
    const generationDir = path.join(rootDir, generationDirectories[0]!);
    const callFiles = (await readdir(generationDir)).sort();
    const storyboardFiles = callFiles.filter(file => file.includes("storyboard"));
    assert.equal(storyboardFiles.length, 2);
    const attempts = await Promise.all(storyboardFiles.map(async file =>
      JSON.parse(await readFile(path.join(generationDir, file), "utf8")) as {
        failureCode: string | null;
      }
    ));
    assert.deepEqual(
      attempts.map(attempt => attempt.failureCode),
      ["INVALID_JSON", "INCOMPLETE_FIELDS"],
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    if (originalEnabled === undefined) delete process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS;
    else process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS = originalEnabled;
    await rm(projectDir, { recursive: true, force: true });
  }
});
