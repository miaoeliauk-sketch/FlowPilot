import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/ip-source-analysis/route";

function deepSeekResponse(content: string) {
  return new Response(JSON.stringify({
    id: "ip-source-analysis-request",
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 200 },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function analysisRequest(body: unknown) {
  return new NextRequest("http://localhost/api/ip-source-analysis", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "test-key",
    },
    body: JSON.stringify(body),
  });
}

test("解析结果由服务端根据原文快照生成准确位置，不接受AI自报位置", async () => {
  const originalFetch = globalThis.fetch;
  const rawContent = "很多人以为持续输出就是每天更新。真正的问题不是频率，而是有没有围绕同一个问题持续回答。";
  globalThis.fetch = async () => deepSeekResponse(JSON.stringify({
    items: [{
      kind: "claim",
      content: "持续输出的关键不是更新频率。",
      originalExcerpt: "真正的问题不是频率，而是有没有围绕同一个问题持续回答。",
      startPosition: 999,
      endPosition: 1000,
      extractionStatus: "人工确认",
    }],
  }));

  try {
    const response = await POST(analysisRequest({
      sourceId: "draft-source-1",
      activeIPId: "ip-shuimuran",
      rawContent,
    }));
    const body = await response.json();
    const item = body.analysis.items[0];

    assert.equal(response.status, 200);
    assert.equal(item.sourceId, "draft-source-1");
    assert.equal(item.originalExcerpt, "真正的问题不是频率，而是有没有围绕同一个问题持续回答。");
    assert.equal(rawContent.slice(item.startPosition, item.endPosition), item.originalExcerpt);
    assert.equal(item.extractionStatus, "AI提取");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI给出的内容在原文中无法定位时，解析失败且不返回无出处条目", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse(JSON.stringify({
      items: [{
        kind: "claim",
        content: "老师从未表达过的新观点。",
        originalExcerpt: "这句话在原文中并不存在。",
      }],
    }));
  };

  try {
    const response = await POST(analysisRequest({
      sourceId: "draft-source-2",
      activeIPId: "ip-shuimuran",
      rawContent: "老师只说：做内容要先回答真实问题。",
    }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(calls, 2);
    assert.match(body.error, /原文|出处|定位/);
    assert.equal(body.analysis, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("长逐字稿分段解析后仍统一回溯到完整Source位置", async () => {
  const originalFetch = globalThis.fetch;
  const firstExcerpt = "第一部分的核心判断。";
  const secondExcerpt = "第二部分的核心判断。";
  const rawContent = `${firstExcerpt}${"甲".repeat(8_100)}\n${secondExcerpt}`;
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    const prompt = requestBody.messages?.map(message => message.content ?? "").join("\n") ?? "";
    const excerpt = prompt.includes(secondExcerpt) ? secondExcerpt : firstExcerpt;
    return deepSeekResponse(JSON.stringify({
      items: [{ kind: "claim", content: excerpt, originalExcerpt: excerpt }],
    }));
  };

  try {
    const response = await POST(analysisRequest({
      sourceId: "long-source",
      activeIPId: "ip-shuimuran",
      rawContent,
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.deepEqual(
      body.analysis.items.map((item: { originalExcerpt: string }) => item.originalExcerpt),
      [firstExcerpt, secondExcerpt],
    );
    for (const item of body.analysis.items) {
      assert.equal(rawContent.slice(item.startPosition, item.endPosition), item.originalExcerpt);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
