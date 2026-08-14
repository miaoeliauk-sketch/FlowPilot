import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/copy-optimization/breakdown/route";

function breakdownRequest(): NextRequest {
  return new NextRequest("http://localhost/api/copy-optimization/breakdown", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "SENSITIVE_BREAKDOWN_API_KEY",
    },
    body: JSON.stringify({
      sourceText: "SENSITIVE_BREAKDOWN_SOURCE_TEXT".repeat(400),
    }),
  });
}

function truncatedDeepSeekResponse(): Response {
  return new Response(JSON.stringify({
    id: "SENSITIVE_PROVIDER_REQUEST_ID",
    choices: [{
      finish_reason: "length",
      message: {
        content: null,
        reasoning_content: "SENSITIVE_BREAKDOWN_REASONING",
      },
    }],
    usage: {
      prompt_tokens: 9_000,
      completion_tokens: 1_800,
      total_tokens: 10_800,
      completion_tokens_details: { reasoning_tokens: 1_800 },
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function successfulDeepSeekResponse(): Response {
  return new Response(JSON.stringify({
    id: "SENSITIVE_PROVIDER_SUCCESS_ID",
    choices: [{
      finish_reason: "stop",
      message: {
        content: JSON.stringify({
          coreElements: {
            viewpoint: "核心观点",
            cases: ["案例一"],
            logic: "先提出问题，再给出结论",
            conclusion: "核心结论",
          },
          expressionAnalysis: {
            openingHook: "直接提问",
            narrativeRhythm: "短句为主",
            emotionalTone: "克制理性",
            rhetoricDevices: ["对比"],
            closingStyle: "总结收尾",
          },
        }),
      },
    }],
    usage: {
      prompt_tokens: 300,
      completion_tokens: 120,
      total_tokens: 420,
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function invalidStructuredDeepSeekResponse(): Response {
  return new Response(JSON.stringify({
    id: "SENSITIVE_PROVIDER_INVALID_ID",
    choices: [{
      finish_reason: "stop",
      message: { content: "not valid json" },
    }],
    usage: {
      prompt_tokens: 300,
      completion_tokens: 20,
      total_tokens: 320,
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("文案拆解成功响应不包含内部诊断字段", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => successfulDeepSeekResponse();

  try {
    const response = await POST(breakdownRequest());
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.coreElements.viewpoint, "核心观点");
    assert.doesNotMatch(
      JSON.stringify(body),
      /diagnosticId|attempts|requestId|finishReason|completionTokens|tokenBudget|failureCode|errorStage|SENSITIVE/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("文案拆解成功响应明确排除apiMeta", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => successfulDeepSeekResponse();

  try {
    const response = await POST(breakdownRequest());
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal("apiMeta" in body, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("文案拆解遇到非法JSON时重试并只接受第二次完整结果", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? invalidStructuredDeepSeekResponse()
      : successfulDeepSeekResponse();
  };

  try {
    const response = await POST(breakdownRequest());
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.equal(body.coreElements.viewpoint, "核心观点");
    assert.notEqual(body.coreElements.viewpoint, "（AI返回内容解析失败，请重试）");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("文案拆解空内容只返回友好提示", async () => {
  const request = new NextRequest("http://localhost/api/copy-optimization/breakdown", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceText: "   " }),
  });

  const response = await POST(request);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "请提供要拆解的原始内容" });
});

test("文案拆解拒绝错误的sourceText类型且不调用AI", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return successfulDeepSeekResponse();
  };

  try {
    const request = new NextRequest("http://localhost/api/copy-optimization/breakdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceText: false }),
    });

    const response = await POST(request);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "请求格式错误" });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("文案拆解失败时只返回友好提示，并在服务器记录安全诊断", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const logs: string[] = [];

  console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  globalThis.fetch = async () => truncatedDeepSeekResponse();

  try {
    const response = await POST(breakdownRequest());
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.deepEqual(body, { error: "内容拆解失败，请重试" });
    assert.doesNotMatch(
      JSON.stringify(body),
      /diagnosticId|attempts|requestId|finishReason|completionTokens|failureCode|code|errorStage|SENSITIVE/,
    );

    assert.equal(logs.length, 1);
    assert.match(logs[0], /^\[copy-optimization-breakdown\]\s+/);
    const diagnostic = JSON.parse(
      logs[0].replace(/^\[copy-optimization-breakdown\]\s+/, ""),
    ) as Record<string, unknown> & {
      attempts: Array<Record<string, unknown>>;
    };

    assert.equal(diagnostic.phase, "breakdown");
    assert.equal(typeof diagnostic.inputChars, "number");
    assert.equal(diagnostic.maxTokens, 1_800);
    assert.equal(diagnostic.failureCode, "OUTPUT_TRUNCATED");
    assert.deepEqual(diagnostic.attempts, [1, 2].map(attempt => ({
      attempt,
      stage: "request",
      failureCode: "OUTPUT_TRUNCATED",
      finishReason: "length",
      completionTokens: 1_800,
      responseChars: null,
      hasReasoningContent: true,
      reasoningChars: 29,
    })));

    assert.deepEqual(
      Object.keys(diagnostic).sort(),
      [
        "attempts",
        "calledAt",
        "diagnosticId",
        "failureCode",
        "inputChars",
        "maxTokens",
        "phase",
      ].sort(),
    );

    const serialized = logs.join("\n");
    assert.doesNotMatch(
      serialized,
      /SENSITIVE_BREAKDOWN_SOURCE_TEXT|SENSITIVE_BREAKDOWN_API_KEY|SENSITIVE_BREAKDOWN_REASONING|SENSITIVE_PROVIDER_REQUEST_ID/,
    );
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
  }
});
