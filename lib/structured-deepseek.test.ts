import assert from "node:assert/strict";
import test from "node:test";
import {
  callStructuredDeepSeek,
  StructuredDeepSeekError,
} from "./structured-deepseek";

function deepSeekResponse(content: string) {
  return new Response(JSON.stringify({
    id: "request-success",
    choices: [{
      finish_reason: "stop",
      message: { content },
    }],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 8,
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("returns parsed data and response metadata after one successful attempt", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => deepSeekResponse('{"status":"ok"}');

  try {
    const result = await callStructuredDeepSeek({
      systemPrompt: "system",
      userPrompt: "user",
      apiKey: "test-key",
      maxTokens: 100,
      temperature: 0.2,
      timeoutMs: 100,
      maxRetries: 0,
      parse: (content) => JSON.parse(content) as { status: string },
    });

    assert.deepEqual(result.data, { status: "ok" });
    assert.equal(result.attempts, 1);
    assert.deepEqual(result.responseMeta, {
      requestId: "request-success",
      finishReason: "stop",
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: null,
      reasoningTokens: null,
      hasReasoningContent: false,
      reasoningChars: 0,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retries one failed request and returns the second result", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response("temporary failure", { status: 503 });
    }
    return deepSeekResponse('{"status":"recovered"}');
  };

  try {
    const result = await callStructuredDeepSeek({
      systemPrompt: "system",
      userPrompt: "user",
      apiKey: "test-key",
      maxTokens: 100,
      timeoutMs: 100,
      maxRetries: 1,
      parse: (content) => JSON.parse(content) as { status: string },
    });

    assert.deepEqual(result.data, { status: "recovered" });
    assert.equal(result.attempts, 2);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves safe response metadata when empty content retries and then succeeds", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({
        id: "request-empty",
        choices: [{
          finish_reason: "length",
          message: { content: null, reasoning_content: "private reasoning" },
        }],
        usage: {
          prompt_tokens: 80,
          completion_tokens: 100,
          total_tokens: 180,
          completion_tokens_details: { reasoning_tokens: 100 },
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return deepSeekResponse('{"status":"recovered"}');
  };

  try {
    const result = await callStructuredDeepSeek({
      systemPrompt: "system",
      userPrompt: "private transcript",
      apiKey: "test-key",
      maxTokens: 100,
      timeoutMs: 100,
      maxRetries: 1,
      parse: (content) => JSON.parse(content) as { status: string },
    });

    assert.deepEqual(result.data, { status: "recovered" });
    assert.equal(result.attempts, 2);
    assert.deepEqual(result.attemptDiagnostics[0], {
      attempt: 1,
      stage: "request",
      failureCode: "OUTPUT_TRUNCATED",
      responseChars: null,
      finishReason: "length",
      promptTokens: 80,
      completionTokens: 100,
      totalTokens: 180,
      reasoningTokens: 100,
      hasReasoningContent: true,
      reasoningChars: 17,
    });
    assert.doesNotMatch(JSON.stringify(result.attemptDiagnostics), /private transcript|private reasoning/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts a complete parseable response even when finish reason is length", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: "request-complete-at-limit",
    choices: [{
      finish_reason: "length",
      message: { content: '{"status":"complete"}' },
    }],
    usage: { prompt_tokens: 80, completion_tokens: 100 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const result = await callStructuredDeepSeek({
      systemPrompt: "system",
      userPrompt: "user",
      apiKey: "test-key",
      maxTokens: 100,
      timeoutMs: 100,
      maxRetries: 1,
      parse: (content) => JSON.parse(content) as { status: string },
    });
    assert.deepEqual(result.data, { status: "complete" });
    assert.equal(result.attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports stable empty-content diagnostics when both attempts have no final answer", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      id: `request-empty-${calls}`,
      choices: [{ finish_reason: "stop", message: { content: "" } }],
      usage: { prompt_tokens: 20, completion_tokens: 0, total_tokens: 20 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await assert.rejects(
      () => callStructuredDeepSeek({
        systemPrompt: "system",
        userPrompt: "private transcript",
        apiKey: "test-key",
        maxTokens: 100,
        timeoutMs: 100,
        maxRetries: 1,
        parse: (content) => JSON.parse(content),
      }),
      (error: unknown) => {
        assert.ok(error instanceof StructuredDeepSeekError);
        assert.equal(error.attempts, 2);
        assert.equal(error.attemptDiagnostics.length, 2);
        assert.ok(error.attemptDiagnostics.every((attempt) =>
          attempt.failureCode === "EMPTY_CONTENT" &&
          attempt.finishReason === "stop" &&
          attempt.responseChars === 0 &&
          attempt.hasReasoningContent === false));
        return true;
      },
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retries one invalid structured response and parses the second result", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse(calls === 1 ? '{"status":' : '{"status":"valid"}');
  };

  try {
    const result = await callStructuredDeepSeek({
      systemPrompt: "system",
      userPrompt: "user",
      apiKey: "test-key",
      maxTokens: 100,
      timeoutMs: 100,
      maxRetries: 1,
      parse: (content) => JSON.parse(content) as { status: string },
    });

    assert.deepEqual(result.data, { status: "valid" });
    assert.equal(result.attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports parse stage after all structured responses are invalid", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse('{"status":');
  };

  try {
    await assert.rejects(
      () => callStructuredDeepSeek({
        systemPrompt: "system",
        userPrompt: "user",
        apiKey: "test-key",
        maxTokens: 100,
        timeoutMs: 100,
        maxRetries: 1,
        parse: (content) => JSON.parse(content) as { status: string },
      }),
      (error: unknown) =>
        error instanceof StructuredDeepSeekError &&
        error.stage === "parse" &&
        error.attempts === 2,
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("records safe metadata for every failed structured response", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const content = calls === 1 ? '{"items":[' : '{"items":[]}';
    return new Response(JSON.stringify({
      id: `request-${calls}`,
      choices: [{
        finish_reason: calls === 1 ? "length" : "stop",
        message: { content },
      }],
      usage: {
        prompt_tokens: 80,
        completion_tokens: calls === 1 ? 100 : 20,
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await assert.rejects(
      () => callStructuredDeepSeek({
        systemPrompt: "system",
        userPrompt: "private article content",
        apiKey: "test-key",
        maxTokens: 100,
        timeoutMs: 100,
        maxRetries: 1,
        parse: (content) => {
          if (content === '{"items":[') {
            throw Object.assign(new Error("truncated"), {
              diagnosticCode: "INVALID_JSON",
              diagnosticDetails: { fieldCount: 0 },
            });
          }
          throw Object.assign(new Error("empty items"), {
            diagnosticCode: "ITEMS_EMPTY",
            diagnosticDetails: { itemCount: 0, fieldCount: 1 },
          });
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof StructuredDeepSeekError);
        assert.deepEqual(error.attemptDiagnostics, [
          {
            attempt: 1,
            stage: "parse",
            failureCode: "OUTPUT_TRUNCATED",
            responseChars: 10,
            finishReason: "length",
            promptTokens: 80,
            completionTokens: 100,
            hasReasoningContent: false,
            reasoningChars: 0,
            fieldCount: 0,
          },
          {
            attempt: 2,
            stage: "parse",
            failureCode: "ITEMS_EMPTY",
            responseChars: 12,
            finishReason: "stop",
            promptTokens: 80,
            completionTokens: 20,
            hasReasoningContent: false,
            reasoningChars: 0,
            itemCount: 0,
            fieldCount: 1,
          },
        ]);
        assert.doesNotMatch(JSON.stringify(error.attemptDiagnostics), /private article content/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("aborts timed out attempts before retrying", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let aborts = 0;
  globalThis.fetch = async (_input, init) => new Promise<Response>((resolve, reject) => {
    calls += 1;
    const fallback = setTimeout(
      () => resolve(deepSeekResponse('{"status":"too-late"}')),
      100,
    );
    init?.signal?.addEventListener("abort", () => {
      aborts += 1;
      clearTimeout(fallback);
      reject(init.signal?.reason ?? new Error("aborted"));
    }, { once: true });
  });

  try {
    await assert.rejects(
      () => callStructuredDeepSeek({
        systemPrompt: "system",
        userPrompt: "user",
        apiKey: "test-key",
        maxTokens: 100,
        timeoutMs: 10,
        maxRetries: 1,
        parse: (content) => JSON.parse(content) as { status: string },
      }),
      (error: unknown) =>
        error instanceof StructuredDeepSeekError &&
        error.stage === "timeout" &&
        error.attempts === 2,
    );
    assert.equal(calls, 2);
    assert.equal(aborts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports request stage after all requests fail", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("service unavailable", { status: 503 });
  };

  try {
    await assert.rejects(
      () => callStructuredDeepSeek({
        systemPrompt: "system",
        userPrompt: "user",
        apiKey: "test-key",
        maxTokens: 100,
        timeoutMs: 100,
        maxRetries: 1,
        parse: (content) => JSON.parse(content),
      }),
      (error: unknown) =>
        error instanceof StructuredDeepSeekError &&
        error.stage === "request" &&
        error.attempts === 2,
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not retry when the DeepSeek API key is missing", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.DEEPSEEK_API_KEY;
  let calls = 0;
  delete process.env.DEEPSEEK_API_KEY;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse('{"status":"unexpected"}');
  };

  try {
    await assert.rejects(
      () => callStructuredDeepSeek({
        systemPrompt: "system",
        userPrompt: "user",
        maxTokens: 100,
        timeoutMs: 100,
        maxRetries: 1,
        parse: (content) => JSON.parse(content),
      }),
      (error: unknown) =>
        error instanceof StructuredDeepSeekError &&
        error.stage === "request" &&
        error.attempts === 1 &&
        error.message.includes("未配置 DeepSeek API Key"),
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = originalApiKey;
    }
  }
});
