import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/transcribe/clean/route";

const VALID_RESULT = {
  cleaned: "清洗后的完整逐字稿",
  segmented: "【第一部分】\n分段后的完整逐字稿",
  summary: {
    theme: "一位科研创业者的选择",
    keyPoints: ["关键观点一", "关键观点二", "关键观点三"],
    cases: ["回国参与商业航天创业"],
    quotables: ["把长期目标拆成今天能完成的事情"],
  },
};

function deepSeekResponse(content: unknown, finishReason = "stop") {
  return new Response(JSON.stringify({
    id: "request-transcribe-clean",
    choices: [{
      finish_reason: finishReason,
      message: { content },
    }],
    usage: {
      prompt_tokens: 2_000,
      completion_tokens: 1_000,
      total_tokens: 3_000,
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function cleanRequest() {
  return new NextRequest("http://localhost/api/transcribe/clean", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "test-key",
    },
    body: JSON.stringify({
      rawText: "这是一段长度足够的原始逐字稿，用于验证首次返回空正文时能够自动恢复。".repeat(4),
    }),
  });
}

function cleanRequestWithoutKey() {
  return new NextRequest("http://localhost/api/transcribe/clean", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawText: "这是一段长度足够的原始逐字稿，用于验证没有配置密钥时仍返回准确提示。".repeat(4),
    }),
  });
}

test("逐字稿清洗首次返回空正文时自动重试并交付完整结果", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<Record<string, unknown>> = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return calls === 1
      ? deepSeekResponse(null, "length")
      : deepSeekResponse(JSON.stringify(VALID_RESULT));
  };

  try {
    const response = await POST(cleanRequest());
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.deepEqual(body.cleaned, VALID_RESULT.cleaned);
    assert.deepEqual(body.summary, VALID_RESULT.summary);
    assert.equal(requestBodies[0]?.max_tokens, 8_000);
    assert.deepEqual(requestBodies[0]?.thinking, { type: "disabled" });
    assert.deepEqual(requestBodies[0]?.response_format, { type: "json_object" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("逐字稿清洗首次返回非法JSON时纠正重试", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? deepSeekResponse("不是JSON")
      : deepSeekResponse(JSON.stringify(VALID_RESULT));
  };

  try {
    const response = await POST(cleanRequest());
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.equal(body.segmented, VALID_RESULT.segmented);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("逐字稿清洗连续返回残缺字段时明确失败且不伪装成功", async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const diagnostics: string[] = [];
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse(JSON.stringify({
      cleaned: "只有清洗版",
      segmented: "",
      summary: { theme: "", keyPoints: [], cases: [], quotables: [] },
    }));
  };
  console.error = (...args: unknown[]) => {
    diagnostics.push(args.map(String).join(" "));
  };

  try {
    const response = await POST(cleanRequest());
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(calls, 2);
    assert.equal(body.error, "AI返回格式不完整，已自动重试，请稍后再试。");
    assert.equal("cleaned" in body, false);
    assert.doesNotMatch(diagnostics.join("\n"), /原始逐字稿|test-key|private reasoning/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test("逐字稿清洗缺少API密钥时保留原有配置提示", async () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;

  try {
    const response = await POST(cleanRequestWithoutKey());
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.match(body.error, /未配置 DeepSeek API Key/);
  } finally {
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});
