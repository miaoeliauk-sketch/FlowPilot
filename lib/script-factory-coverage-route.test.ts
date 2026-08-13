import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/script-factory/coverage/route";

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/script-factory/coverage", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
    body: JSON.stringify(body),
  });
}

function deepSeekResponse(content: string): Response {
  return new Response(JSON.stringify({
    id: "coverage-request",
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 20, completion_tokens: 20 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("没有IP原始内容时直接返回NONE且不调用模型", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return deepSeekResponse("{}");
  };
  try {
    const response = await POST(request({
      topic: "为什么持续更新仍会被忘记？",
      angle: "从内容方向切入",
      sources: [],
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.assessment.coverage, "NONE");
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("覆盖度接口只返回当前IP资料中存在的原文引用", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => deepSeekResponse(JSON.stringify({
    coverage: "FULL",
    reason: "原文同时提供了核心判断和解释。",
    coveredDimensions: ["核心判断", "推理过程"],
    missingDimensions: [],
    sourceReferences: [
      { sourceId: "source-1", itemId: "claim-1" },
      { sourceId: "source-1", itemId: "reasoning-1" },
    ],
    caseNeed: "NOT_NEEDED",
    caseReason: "原文内部论证已经完整。",
  }));
  try {
    const response = await POST(request({
      topic: "为什么持续更新仍会被忘记？",
      angle: "从内容方向切入",
      sources: [{
        sourceId: "source-1",
        sourceTitle: "课程复盘",
        itemId: "claim-1",
        kind: "claim",
        content: "持续输出不是每天更换话题。",
        originalExcerpt: "持续输出不是每天换一个新话题，而是围绕一个值得长期回答的问题。",
        extractionStatus: "人工确认",
      }, {
        sourceId: "source-1",
        sourceTitle: "课程复盘",
        itemId: "reasoning-1",
        kind: "reasoning",
        content: "不断换题会让观众无法形成稳定记忆。",
        originalExcerpt: "每天换题，观众就不知道应该因为什么记住你。",
        extractionStatus: "人工确认",
      }],
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.assessment.coverage, "FULL");
    assert.equal(body.assessment.sourceReferences[0].originalExcerpt.includes("长期回答"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
