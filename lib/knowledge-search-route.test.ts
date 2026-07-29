import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/knowledge-search/route";

function deepSeekResponse(content: string) {
  return new Response(JSON.stringify({
    id: "knowledge-search-request",
    choices: [{
      finish_reason: "stop",
      message: { content },
    }],
    usage: {
      prompt_tokens: 40,
      completion_tokens: 30,
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function knowledgeSearchRequest(body: unknown, withApiKey = true) {
  return new NextRequest("http://localhost/api/knowledge-search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(withApiKey ? { "X-DeepSeek-Key": "test-key" } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("非法意图响应会重试并降级为普通本地检索", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse(JSON.stringify({
      topicType: "教程类",
      relevantLibraries: ["文案框架方法库"],
      methodKeywords: ["步骤拆解"],
    }));
  };

  try {
    const response = await POST(knowledgeSearchRequest({
      query: "教程",
      entries: [{
        id: "weak-tutorial",
        title: "教程结构",
        category: "文案框架方法库",
        normalizedCategory: "文案框架方法库",
      }],
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.deepEqual(body.results, []);
    assert.equal(body.debug.intentUsed, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("超长方法关键词会触发重试并降级为普通本地检索", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse(JSON.stringify({
      topicType: "教程类",
      audienceGuess: "第一次接触这项任务的新手",
      corePainPoint: "不知道从哪里开始",
      relevantLibraries: ["文案框架方法库"],
      methodKeywords: ["这是一条超过三十个字符而且不应该被当作正常方法关键词接受的异常长文本"],
      reasoning: "需要使用教程结构",
    }));
  };

  try {
    const response = await POST(knowledgeSearchRequest({
      query: "教程",
      entries: [{
        id: "weak-tutorial",
        title: "教程结构",
        category: "文案框架方法库",
        normalizedCategory: "文案框架方法库",
      }],
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.deepEqual(body.results, []);
    assert.equal(body.debug.intentUsed, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("skipIntent使用本地检索并返回results和debug契约", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse("{}");
  };

  try {
    const response = await POST(knowledgeSearchRequest({
      query: "高净值客户",
      skipIntent: true,
      entries: [{
        id: "strong-local",
        title: "高净值客户决策差异",
        category: "选题方法库",
      }],
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 0);
    assert.deepEqual(body.results.map((item: { id: string }) => item.id), ["strong-local"]);
    assert.equal(body.debug.intentUsed, false);
    assert.equal("apiMeta" in body, false);
    assert.deepEqual(Object.keys(body).sort(), ["debug", "results"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("合法意图只提供方法方向并由本地打分选出知识条目", async () => {
  const originalFetch = globalThis.fetch;
  let outboundBody = "";
  globalThis.fetch = async (_input, init) => {
    outboundBody = String(init?.body ?? "");
    return deepSeekResponse(JSON.stringify({
      topicType: "教程类",
      audienceGuess: "第一次接触这项任务的新手",
      corePainPoint: "不知道从哪里开始",
      relevantLibraries: ["文案框架方法库"],
      methodKeywords: ["步骤拆解", "教程结构"],
      reasoning: "需要用清晰步骤降低上手门槛",
    }));
  };

  try {
    const response = await POST(knowledgeSearchRequest({
      query: "教程",
      entries: [{
        id: "weak-tutorial",
        title: "教程结构",
        category: "文案框架方法库",
        normalizedCategory: "文案框架方法库",
        content: "按步骤拆解内容",
      }],
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.results.map((item: { id: string }) => item.id), ["weak-tutorial"]);
    assert.equal(body.results[0].isStrongReference, true);
    assert.equal(body.debug.intentUsed, true);
    assert.equal(body.debug.topicType, "教程类");
    assert.deepEqual(body.debug.intentLibraries, ["文案框架方法库"]);
    assert.doesNotMatch(outboundBody, /weak-tutorial/);
    assert.match(outboundBody, /教程/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("知识条目为空时直接返回空结果且不调用AI", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse("{}");
  };

  try {
    const response = await POST(knowledgeSearchRequest({
      query: "测试连接",
      entries: [],
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 0);
    assert.deepEqual(body.results, []);
    assert.deepEqual(body.debug, {
      queryKeywords: [],
      expandedKeywords: [],
      ignoredKeywords: [],
      intentUsed: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("缺少查询词时返回400且不调用AI", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse("{}");
  };

  try {
    const response = await POST(knowledgeSearchRequest({
      query: "   ",
      entries: [{ id: "unused", title: "不会参与检索" }],
    }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(calls, 0);
    assert.match(body.error, /检索词/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
