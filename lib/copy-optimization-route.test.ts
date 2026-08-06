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
) {
  return new Response(JSON.stringify({
    id: `request-${finishReason}`,
    choices: [{ finish_reason: finishReason, message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: completionTokens },
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
    assert.equal(body.apiMeta && "attempts" in body.apiMeta, false);
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
    assert.equal(response.status, 502);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects source text beyond the supported size before calling the paid API", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse(JSON.stringify(validRewrite), "stop", 500);
  };

  try {
    const response = await POST(optimizationRequest("长".repeat(120_001)));
    const body = await response.json() as { error?: string };
    assert.equal(response.status, 400);
    assert.match(body.error ?? "", /12万字/);
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
