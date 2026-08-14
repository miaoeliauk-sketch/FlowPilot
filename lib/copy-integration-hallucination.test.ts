import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/copy-integration/route";

function deepSeekResponse(content: string) {
  return new Response(JSON.stringify({
    id: "copy-integration-hallucination-test",
    choices: [{
      finish_reason: "stop",
      message: { content },
    }],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 240,
      total_tokens: 360,
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("拒绝母稿中没有原文证据的小韩接机案例", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  let calls = 0;
  console.error = () => undefined;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return deepSeekResponse(JSON.stringify({
        facts: [
          {
            id: "F01",
            statement: "有些追星者会把大量注意力放在偶像身上，也会担心这种状态影响自己的生活。",
            originalQuote: "有些追星者会把大量注意力放在偶像身上，也会担心这种状态影响自己的生活。",
            sourceId: "source-1",
            classification: "usable",
            confidence: "high",
          },
          {
            id: "F02",
            statement: "过度关注外界可能消耗注意力、扰乱情绪节奏。",
            originalQuote: "过度关注外界可能消耗注意力、扰乱情绪节奏。",
            sourceId: "source-2",
            classification: "usable",
            confidence: "high",
          },
          {
            id: "F03",
            statement: "可以通过静坐和观察呼吸把注意力收回来。",
            originalQuote: "可以通过静坐和观察呼吸把注意力收回来。",
            sourceId: "source-2",
            classification: "usable",
            confidence: "high",
          },
        ],
        relations: [{
          id: "R01",
          type: "complement",
          factIds: ["F01", "F02"],
          summary: "素材1描述现象，素材2补充可能的影响机制",
        }],
      }));
    }
    if (calls === 2) {
      return deepSeekResponse(JSON.stringify({
        decisions: [
          { factId: "F01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
          { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
          { factId: "F03", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
        ],
        relationDecisions: [{ relationId: "R01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "补充关系成立" }],
      }));
    }
    return deepSeekResponse(JSON.stringify({
      draft: { sections: [{
        paragraphPlans: [
          { factIds: ["F01", "F02"], text: "小韩每天刷视频、买周边、去接机，后来整个人显得很疲惫。" },
          { factIds: ["F03"] },
        ],
      }] },
    }));
  };

  try {
    const response = await POST(new NextRequest("http://localhost/api/copy-integration", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DeepSeek-Key": "test-key",
      },
      body: JSON.stringify({
        sources: [
          {
            id: "source-1",
            name: "素材1",
            content: "有些追星者会把大量注意力放在偶像身上，也会担心这种状态影响自己的生活。",
          },
          {
            id: "source-2",
            name: "素材2",
            content: "过度关注外界可能消耗注意力、扰乱情绪节奏。可以通过静坐和观察呼吸把注意力收回来。",
          },
        ],
      }),
    }));
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 502);
    assert.deepEqual(body, { error: "文案整合失败，请重试" });
    assert.equal(calls, 4);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
