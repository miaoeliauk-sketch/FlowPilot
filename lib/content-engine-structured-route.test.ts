import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/skill/content-engine/route";
import type { IPProfile } from "./types";

const TEST_IP: IPProfile = {
  id: "ip-test-content-engine",
  name: "测试认知作者",
  avatar: "测",
  positioning: "认知内容作者",
  platforms: ["视频号"],
  audience: "关注个人成长的职场人",
  contentDirection: ["认知成长"],
  personaKeywords: ["理性", "洞察"],
  professionalIdentity: "内容作者",
  personalityTags: ["克制"],
  credibilitySource: "长期内容创作",
  representativeViewpoints: ["先看清问题再行动"],
  tone: "理性克制",
  commonOpenings: ["很多人没意识到"],
  commonClosings: ["这才是关键"],
  catchphrases: ["换个角度看"],
  forbiddenExpressions: ["绝对化承诺"],
  pacing: "层层递进",
  commonScenes: ["书房"],
  commonShotTypes: ["正面口播"],
  showsFace: true,
  usesScreenRecording: false,
  needsBroll: true,
  needsCaseScreenshots: false,
  needsSubtitleHighlight: true,
  sampleViralTitles: ["普通人如何看清焦虑"],
  styleNotes: "从现象进入个人选择",
  bio: "关注认知成长的内容作者",
  color: "#7656D6",
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
};

function contentEngineRequest(includeApiKey = true): NextRequest {
  return new NextRequest("http://localhost/api/skill/content-engine", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(includeApiKey
        ? { "X-DeepSeek-Key": "SENSITIVE_API_KEY_MARKER" }
        : {}),
    },
    body: JSON.stringify({
      topic: "SENSITIVE_TOPIC_MARKER",
      ipProfile: TEST_IP,
      styleProfile: null,
    }),
  });
}

function deepSeekResponse(
  content: unknown,
  finishReason: string,
  completionTokens: number,
  reasoningContent?: string,
): Response {
  return new Response(JSON.stringify({
    id: "content-engine-test-request",
    choices: [{
      finish_reason: finishReason,
      message: {
        content,
        ...(reasoningContent === undefined
          ? {}
          : { reasoning_content: reasoningContent }),
      },
    }],
    usage: {
      prompt_tokens: 600,
      completion_tokens: completionTokens,
      total_tokens: 600 + completionTokens,
      completion_tokens_details: {
        reasoning_tokens: reasoningContent ? completionTokens : 0,
      },
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("Content Engine首次空正文后自动重试成功，并只记录安全诊断", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const logs: string[] = [];
  const requestBodies: Array<Record<string, unknown>> = [];
  let calls = 0;

  console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return calls === 1
      ? deepSeekResponse(null, "length", 4000, "SENSITIVE_REASONING_MARKER")
      : deepSeekResponse("{}", "stop", 20);
  };

  try {
    const response = await POST(contentEngineRequest());
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.equal(body._meta.attempts, 2);
    assert.deepEqual(requestBodies[0].thinking, { type: "disabled" });
    assert.deepEqual(requestBodies[0].response_format, { type: "json_object" });

    assert.equal(logs.length, 1);
    assert.match(logs[0], /^\[content-engine\]\s+/);
    const diagnostic = JSON.parse(
      logs[0].replace(/^\[content-engine\]\s+/, ""),
    ) as Record<string, unknown> & {
      attempts: Array<Record<string, unknown>>;
    };
    assert.match(String(diagnostic.diagnosticId), /^[0-9a-f-]{36}$/);
    assert.equal(typeof diagnostic.inputChars, "number");
    assert.equal(diagnostic.maxTokens, 4000);
    assert.equal(diagnostic.failureCode, "OUTPUT_TRUNCATED");
    assert.equal(diagnostic.attempts[0].finishReason, "length");
    assert.equal(diagnostic.attempts[0].completionTokens, 4000);
    assert.equal(diagnostic.attempts[0].responseChars, null);
    assert.equal(diagnostic.attempts[0].hasReasoningContent, true);
    assert.equal(diagnostic.attempts[0].reasoningChars, 26);
    assert.equal(diagnostic.attempts.length, 2);
    assert.deepEqual(
      Object.keys(diagnostic.attempts[0]).sort(),
      [
        "attempt",
        "completionTokens",
        "failureCode",
        "finishReason",
        "hasReasoningContent",
        "reasoningChars",
        "responseChars",
      ].sort(),
    );
    assert.deepEqual(diagnostic.attempts[1], {
      attempt: 2,
      finishReason: "stop",
      completionTokens: 20,
      responseChars: 2,
      hasReasoningContent: false,
      reasoningChars: 0,
    });

    const serialized = logs.join("\n");
    assert.doesNotMatch(
      serialized,
      /SENSITIVE_TOPIC_MARKER|SENSITIVE_API_KEY_MARKER|SENSITIVE_REASONING_MARKER|content-engine-test-request/,
    );
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
  }
});

test("Content Engine缺少API Key时返回400且不调用DeepSeek", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalEnvironmentApiKey = process.env.DEEPSEEK_API_KEY;
  const logs: string[] = [];
  let called = false;

  delete process.env.DEEPSEEK_API_KEY;
  console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  globalThis.fetch = async () => {
    called = true;
    return deepSeekResponse("{}", "stop", 20);
  };

  try {
    const response = await POST(contentEngineRequest(false));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "MISSING_API_KEY");
    assert.equal(body.apiMeta.apiCalled, false);
    assert.equal(called, false);
    assert.equal(logs.length, 1);
  } finally {
    if (originalEnvironmentApiKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = originalEnvironmentApiKey;
    }
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
  }
});

test("Content Engine两次空正文后返回稳定错误码且安全日志不含原文", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const logs: string[] = [];
  let calls = 0;

  console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse(
      null,
      "stop",
      120,
      "SENSITIVE_REASONING_MARKER",
    );
  };

  try {
    const response = await POST(contentEngineRequest());
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(calls, 2);
    assert.equal(body.code, "EMPTY_CONTENT");
    assert.match(body.diagnosticId, /^[0-9a-f-]{36}$/);
    assert.equal(body.apiMeta.attempts, 2);

    assert.equal(logs.length, 1);
    const diagnostic = JSON.parse(
      logs[0].replace(/^\[content-engine\]\s+/, ""),
    ) as Record<string, unknown> & {
      attempts: Array<Record<string, unknown>>;
    };
    assert.equal(diagnostic.failureCode, "EMPTY_CONTENT");
    assert.equal(diagnostic.attempts.length, 2);
    assert.ok(diagnostic.attempts.every((attempt) => (
      attempt.finishReason === "stop"
      && attempt.completionTokens === 120
      && attempt.responseChars === null
      && attempt.hasReasoningContent === true
      && attempt.reasoningChars === 26
      && attempt.failureCode === "EMPTY_CONTENT"
    )));

    const serialized = logs.join("\n");
    assert.doesNotMatch(
      serialized,
      /SENSITIVE_TOPIC_MARKER|SENSITIVE_API_KEY_MARKER|SENSITIVE_REASONING_MARKER|content-engine-test-request/,
    );
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
  }
});
