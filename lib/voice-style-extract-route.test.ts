import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/voice-style-extract/route";

const validAnalysis = {
  openingHabits: ["先抛判断", "用问题引入", "从场景切入"],
  viewpointStyle: "先给结论，再用生活场景解释原因。",
  sentenceLength: "长短句结合",
  emotionalTone: ["犀利", "克制"],
  commonPhrases: ["你有没有发现", "真正的问题是", "换句话说", "仔细想想", "所以"],
  closingHabits: ["回到行动", "用判断收束", "留下反问"],
  forbiddenExpressions: ["空洞口号", "过度书面语", "绝对化承诺"],
  styleSummary: "先用强判断抓住注意力，再通过具体场景推进，最后回到个人行动。",
};

function requestWithSamples(rawTexts: string[]): NextRequest {
  return new NextRequest("http://localhost/api/voice-style-extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "fake-key-for-tests",
    },
    body: JSON.stringify({
      ipName: "测试IP",
      samples: rawTexts.map((rawText, index) => ({
        id: `sample-${index + 1}`,
        title: `测试标题${index + 1}`,
        rawText,
      })),
    }),
  });
}

function deepSeekResponse(
  content: unknown,
  finishReason = "stop",
  completionTokens = 100,
  reasoningContent?: string,
): Response {
  return new Response(JSON.stringify({
    id: "request-test",
    choices: [{
      finish_reason: finishReason,
      message: {
        content,
        ...(reasoningContent === undefined ? {} : { reasoning_content: reasoningContent }),
      },
    }],
    usage: {
      prompt_tokens: 80,
      completion_tokens: completionTokens,
      total_tokens: 80 + completionTokens,
      completion_tokens_details: { reasoning_tokens: reasoningContent ? completionTokens : 0 },
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("real route retries empty content once and returns the second valid profile", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const requestBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return calls === 1
      ? deepSeekResponse(null, "stop", 0)
      : deepSeekResponse(JSON.stringify(validAnalysis));
  };

  try {
    const response = await POST(requestWithSamples(["测试正文"]));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.deepEqual(body.openingHabits, validAnalysis.openingHabits);
    assert.equal(body.apiMeta.attempts, 2);
    assert.equal(body.apiMeta.attemptDiagnostics[0].failureCode, "EMPTY_CONTENT");
    assert.deepEqual(requestBodies[0].thinking, { type: "disabled" });
    assert.deepEqual(requestBodies[0].response_format, { type: "json_object" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("real route returns a stable error after two empty responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => deepSeekResponse(null, "stop", 0);
  try {
    const response = await POST(requestWithSamples(["测试正文"]));
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.code, "EMPTY_CONTENT");
    assert.equal(typeof body.diagnosticId, "string");
    assert.equal(body.apiMeta.attemptDiagnostics.length, 2);
    assert.equal("openingHabits" in body, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("real route distinguishes truncated output", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => deepSeekResponse('{"openingHabits":[', "length", 2500, "private reasoning");
  try {
    const response = await POST(requestWithSamples(["测试正文"]));
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.code, "OUTPUT_TRUNCATED");
    assert.equal(body.apiMeta.attemptDiagnostics[0].finishReason, "length");
    assert.equal(body.apiMeta.attemptDiagnostics[0].reasoningChars, 17);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const [label, content, expectedCode] of [
  ["invalid JSON", "not-json", "INVALID_JSON"],
  ["missing fields", JSON.stringify({ openingHabits: [] }), "MISSING_FIELD"],
  ["wrong field type", JSON.stringify({ ...validAnalysis, emotionalTone: "犀利" }), "INVALID_FIELD_TYPE"],
  ["array out of range", JSON.stringify({ ...validAnalysis, commonPhrases: ["一个"] }), "ARRAY_OUT_OF_RANGE"],
] as const) {
  test(`real route rejects ${label} instead of returning an empty profile`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => deepSeekResponse(content);
    try {
      const response = await POST(requestWithSamples(["测试正文"]));
      const body = await response.json();
      assert.equal(response.status, 502);
      assert.equal(body.code, expectedCode);
      assert.equal("styleSummary" in body, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("real route returns all eight validated fields on success", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => deepSeekResponse(JSON.stringify(validAnalysis));
  try {
    const response = await POST(requestWithSamples(["测试正文"]));
    const body = await response.json();
    assert.equal(response.status, 200);
    for (const field of Object.keys(validAnalysis)) assert.deepEqual(body[field], validAnalysis[field as keyof typeof validAnalysis]);
    assert.deepEqual(body.sourceSampleIds, ["sample-1"]);
    assert.deepEqual(body.sourceSampleTitles, ["测试标题1"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("real route rejects a non-object request body with a clear request error", async () => {
  const response = await POST(new NextRequest("http://localhost/api/voice-style-extract", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "fake-key-for-tests" },
    body: "null",
  }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.code, "INVALID_REQUEST");
  assert.equal(body.error, "请求格式错误");
  assert.equal(body.apiMeta.apiCalled, false);
});

for (const [label, payload, expectedCode] of [
  ["IP name", {
    ipName: "名".repeat(101),
    samples: [{ id: "sample-1", title: "标题", rawText: "正文" }],
  }, "IP_NAME_TOO_LONG"],
  ["sample title", {
    ipName: "测试IP",
    samples: [{ id: "sample-1", title: "题".repeat(201), rawText: "正文" }],
  }, "SAMPLE_TITLE_TOO_LONG"],
] as const) {
  test(`real route limits ${label} before calling AI`, async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return deepSeekResponse(JSON.stringify(validAnalysis));
    };
    try {
      const response = await POST(new NextRequest("http://localhost/api/voice-style-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "fake-key-for-tests" },
        body: JSON.stringify(payload),
      }));
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.equal(body.code, expectedCode);
      assert.equal(called, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

for (const [label, samples, expectedCode] of [
  ["sample count", Array.from({ length: 6 }, () => "短文本"), "SAMPLE_COUNT_EXCEEDED"],
  ["single sample characters", ["字".repeat(8001)], "SAMPLE_TOO_LONG"],
  ["total characters", ["字".repeat(7000), "字".repeat(7000), "字".repeat(7000), "字".repeat(7000), "字".repeat(3001)], "TOTAL_INPUT_TOO_LONG"],
] as const) {
  test(`real route enforces the ${label} limit before calling AI`, async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return deepSeekResponse(JSON.stringify(validAnalysis));
    };
    try {
      const response = await POST(requestWithSamples([...samples]));
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.equal(body.code, expectedCode);
      assert.equal(called, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("diagnostic logs never contain transcript, title, API key, reasoning, or full response", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  globalThis.fetch = async () => deepSeekResponse(null, "length", 2500, "SENSITIVE_REASONING_MARKER");
  try {
    await POST(new NextRequest("http://localhost/api/voice-style-extract", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "SENSITIVE_KEY_MARKER" },
      body: JSON.stringify({
        ipName: "测试IP",
        samples: [{ id: "sample-1", title: "SENSITIVE_TITLE_MARKER", rawText: "SENSITIVE_TEXT_MARKER" }],
      }),
    }));
    const serialized = logs.join("\n");
    assert.match(serialized, /\[voice-style-extract\]/);
    assert.doesNotMatch(serialized, /SENSITIVE_TEXT_MARKER|SENSITIVE_TITLE_MARKER|SENSITIVE_KEY_MARKER|SENSITIVE_REASONING_MARKER/);
    const diagnostic = JSON.parse(logs[0].replace(/^\[voice-style-extract\]\s+/, "")) as {
      attemptDiagnostics: Array<Record<string, unknown>>;
    };
    assert.deepEqual(
      Object.keys(diagnostic.attemptDiagnostics[0]).sort(),
      [
        "attempt",
        "completionTokens",
        "failureCode",
        "finishReason",
        "hasReasoningContent",
        "promptTokens",
        "reasoningChars",
        "reasoningTokens",
        "responseChars",
        "stage",
        "totalTokens",
      ].sort(),
    );
  } finally {
    console.error = originalError;
    globalThis.fetch = originalFetch;
  }
});
