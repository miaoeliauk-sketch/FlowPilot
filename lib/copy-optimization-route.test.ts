import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/copy-optimization/route";

const validRewrite = {
  lockedItemsCheck: [
    { item: "viewpoint", label: "核心观点", preserved: true, howPreserved: "保留原观点。" },
    { item: "cases", label: "核心案例", preserved: true, howPreserved: "保留原案例。" },
    { item: "logic", label: "核心逻辑", preserved: true, howPreserved: "保留原逻辑。" },
    { item: "conclusion", label: "核心结论", preserved: true, howPreserved: "保留原结论。" },
  ],
  segments: [{
    original: "原文第一段。",
    rewritten: "改写后的第一段。",
    reason: "调整表达节奏。",
    changeType: ["语气"],
  }],
  rewrittenFullText: "改写后的完整文案。",
  deviationScore: 8,
  deviationReason: "核心内容没有改变。",
  styleMatchScore: 90,
  ipStyleExplanation: "使用了目标IP的短句表达。",
  goalImpact: { direction: "更有利", reasoning: "开头更加直接。" },
};

function deepSeekResponse(
  content: string,
  finishReason: "length" | "stop",
  completionTokens: number,
  reasoningContent?: string,
) {
  return new Response(JSON.stringify({
    id: `request-${finishReason}`,
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
      prompt_tokens: 100,
      completion_tokens: completionTokens,
      total_tokens: 100 + completionTokens,
      completion_tokens_details: {
        reasoning_tokens: reasoningContent ? completionTokens : 0,
      },
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function optimizationRequest(sourceText = "原文第一段。") {
  return new NextRequest("http://localhost/api/copy-optimization", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "test-key",
    },
    body: JSON.stringify({
      sourceText,
      breakdown: {
        coreElements: {
          viewpoint: "原观点",
          cases: ["原案例"],
          logic: "原逻辑",
          conclusion: "原结论",
        },
      },
    }),
  });
}

test("recovers when the first copy optimization response is truncated", async () => {
  const originalFetch = globalThis.fetch;
  const requestedTokenLimits: number[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const requestBody = JSON.parse(String(init?.body)) as { max_tokens: number };
    requestedTokenLimits.push(requestBody.max_tokens);
    return calls === 1
      ? deepSeekResponse('{"lockedItemsCheck":[', "length", requestBody.max_tokens)
      : deepSeekResponse(JSON.stringify(validRewrite), "stop", 500);
  };

  try {
    const response = await POST(optimizationRequest());
    const body = await response.json() as {
      rewrittenFullText?: string;
      apiMeta?: Record<string, unknown>;
    };

    assert.equal(response.status, 200);
    assert.equal(body.rewrittenFullText, "改写后的完整文案。");
    assert.equal(calls, 2);
    assert.deepEqual(requestedTokenLimits, [8_000, 16_000]);
    assert.match(String(body.apiMeta?.diagnosticId), /^[0-9a-f-]{36}$/);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(
      serialized,
      /attempts|requestId|finishReason|completionTokens|tokenBudget|failureCode|errorStage/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not retry a malformed response that was not truncated", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse('{"lockedItemsCheck":[', "stop", 500);
  };

  try {
    const response = await POST(optimizationRequest());
    const body = await response.json() as {
      error?: string;
      errorCode?: string;
      apiMeta?: Record<string, unknown>;
    };
    assert.equal(response.status, 502);
    assert.equal(calls, 1);
    assert.equal(body.error, "AI返回格式异常");
    assert.equal(body.errorCode, "invalid_json");
    assert.equal(body.apiMeta?.apiCalled, true);
    assert.equal(body.apiMeta?.model, "deepseek-v4-flash");
    assert.equal(body.apiMeta?.ipUsed, "未指定IP");
    assert.equal(body.apiMeta?.mockHit, false);
    assert.equal(body.apiMeta?.error, "AI返回格式异常");
    assert.match(String(body.apiMeta?.calledAt), /^\d{4}-\d{2}-\d{2}T/);
    assert.match(String(body.apiMeta?.diagnosticId), /^[0-9a-f-]{36}$/);
    assert.doesNotMatch(
      JSON.stringify(body),
      /attempts|requestId|finishReason|completionTokens|tokenBudget|failureCode|errorStage/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("四类输入错误保留原有安全apiMeta且不调用付费API", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse(JSON.stringify(validRewrite), "stop", 500);
  };

  try {
    const requests = [
      new NextRequest("http://localhost/api/copy-optimization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
      optimizationRequest("   "),
      optimizationRequest("长".repeat(120_001)),
      new NextRequest("http://localhost/api/copy-optimization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText: "有内容" }),
      }),
    ];

    for (const request of requests) {
      const response = await POST(request);
      const body = await response.json() as {
        error?: string;
        apiMeta?: Record<string, unknown>;
      };
      assert.equal(response.status, 400);
      assert.equal(typeof body.error, "string");
      assert.equal(body.apiMeta?.apiCalled, false);
      assert.equal(body.apiMeta?.model, "deepseek-v4-flash");
      assert.equal(body.apiMeta?.ipUsed, null);
      assert.equal(body.apiMeta?.mockHit, false);
      assert.match(String(body.apiMeta?.calledAt), /^\d{4}-\d{2}-\d{2}T/);
      assert.doesNotMatch(
        JSON.stringify(body.apiMeta),
        /diagnosticId|attempts|requestId|finishReason|completionTokens|tokenBudget|failureCode|errorStage/,
      );
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("allocates a larger first response budget for long source text", async () => {
  const originalFetch = globalThis.fetch;
  let requestedTokenLimit = 0;
  globalThis.fetch = async (_input, init) => {
    const requestBody = JSON.parse(String(init?.body)) as { max_tokens: number };
    requestedTokenLimit = requestBody.max_tokens;
    return deepSeekResponse(JSON.stringify(validRewrite), "stop", 500);
  };

  try {
    const response = await POST(optimizationRequest("长文".repeat(3_000)));
    assert.equal(response.status, 200);
    assert.equal(requestedTokenLimit, 16_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("连续两次输出截断时记录两次安全诊断且不泄露原文", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalWarn = console.warn;
  const logs: string[] = [];
  let calls = 0;

  console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const requestBody = JSON.parse(String(init?.body)) as { max_tokens: number };
    return deepSeekResponse(
      "SENSITIVE_AI_RESPONSE_MARKER",
      "length",
      requestBody.max_tokens,
      "SENSITIVE_REASONING_MARKER",
    );
  };

  try {
    const privateSource = "SENSITIVE_SOURCE_MARKER";
    const response = await POST(optimizationRequest(privateSource));
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(calls, 2);
    assert.equal(body.error, "AI返回格式异常：内容被截断，请重试");
    assert.equal(body.errorCode, "invalid_json");
    assert.equal(body.apiMeta?.apiCalled, true);
    assert.equal(body.apiMeta?.error, "AI返回格式异常：内容被截断，请重试");
    assert.match(String(body.apiMeta?.diagnosticId), /^[0-9a-f-]{36}$/);
    assert.doesNotMatch(
      JSON.stringify(body),
      /attempts|requestId|finishReason|completionTokens|tokenBudget|failureCode|errorStage|SENSITIVE/,
    );
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^\[copy-optimization\]\s+/);

    const diagnostic = JSON.parse(
      logs[0].replace(/^\[copy-optimization\]\s+/, ""),
    ) as Record<string, unknown> & {
      attempts: Array<Record<string, unknown>>;
    };
    assert.deepEqual(Object.keys(diagnostic).sort(), [
      "attempts",
      "diagnosticId",
      "failureCode",
      "inputChars",
    ]);
    assert.match(String(diagnostic.diagnosticId), /^[0-9a-f-]{36}$/);
    assert.equal(diagnostic.inputChars, privateSource.length);
    assert.equal(diagnostic.failureCode, "OUTPUT_TRUNCATED");
    assert.equal(diagnostic.attempts.length, 2);
    for (const attempt of diagnostic.attempts) {
      assert.deepEqual(Object.keys(attempt).sort(), [
        "attempt",
        "completionTokens",
        "failureCode",
        "finishReason",
        "hasReasoningContent",
        "reasoningChars",
        "responseChars",
        "tokenBudget",
      ]);
    }
    assert.deepEqual(diagnostic.attempts.map((attempt) => ({
      attempt: attempt.attempt,
      tokenBudget: attempt.tokenBudget,
      finishReason: attempt.finishReason,
      completionTokens: attempt.completionTokens,
      responseChars: attempt.responseChars,
      hasReasoningContent: attempt.hasReasoningContent,
      reasoningChars: attempt.reasoningChars,
      failureCode: attempt.failureCode,
    })), [
      {
        attempt: 1,
        tokenBudget: 8_000,
        finishReason: "length",
        completionTokens: 8_000,
        responseChars: 28,
        hasReasoningContent: true,
        reasoningChars: 26,
        failureCode: "OUTPUT_TRUNCATED",
      },
      {
        attempt: 2,
        tokenBudget: 16_000,
        finishReason: "length",
        completionTokens: 16_000,
        responseChars: 28,
        hasReasoningContent: true,
        reasoningChars: 26,
        failureCode: "OUTPUT_TRUNCATED",
      },
    ]);
    assert.doesNotMatch(
      logs.join("\n"),
      /SENSITIVE_SOURCE_MARKER|SENSITIVE_AI_RESPONSE_MARKER|SENSITIVE_REASONING_MARKER|request-length|test-key/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    console.warn = originalWarn;
  }
});
