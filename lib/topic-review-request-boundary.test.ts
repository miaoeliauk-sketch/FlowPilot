import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/topic-review/route";
import { createTopicBoardIPProfile } from "./topic-board-contract.fixture";

const VALID_BASE = {
  topic: "普通人如何判断行业趋势",
  ipProfile: createTopicBoardIPProfile(),
};

async function postJSON(body: unknown) {
  return POST(new NextRequest("http://localhost/api/topic-review", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "mock-key",
    },
    body: JSON.stringify(body),
  }));
}

test("董事会接口拒绝非法请求结构且不调用AI", async () => {
  const originalFetch = globalThis.fetch;
  let aiCallCount = 0;
  globalThis.fetch = async () => {
    aiCallCount += 1;
    throw new Error("非法请求不应调用AI");
  };

  const cases: Array<{ name: string; body: unknown; errorField: string }> = [
    { name: "请求体为null", body: null, errorField: "body" },
    { name: "请求体为数组", body: [], errorField: "body" },
    { name: "topic不是字符串", body: { ...VALID_BASE, topic: 123 }, errorField: "topic" },
    {
      name: "knowledgeContext不是数组",
      body: { ...VALID_BASE, knowledgeContext: {} },
      errorField: "knowledgeContext",
    },
    {
      name: "historicalData不是数组",
      body: { ...VALID_BASE, historicalData: "错误" },
      errorField: "historicalData",
    },
    {
      name: "userPersonas不是数组",
      body: { ...VALID_BASE, userPersonas: null },
      errorField: "userPersonas",
    },
    {
      name: "knowledgeContext条目结构错误",
      body: { ...VALID_BASE, knowledgeContext: [{}] },
      errorField: "knowledgeContext[0].id",
    },
    {
      name: "historicalData条目结构错误",
      body: {
        ...VALID_BASE,
        historicalData: [{
          id: "history-1",
          title: "历史内容",
          source: "发布复盘",
          content: "内容",
          metrics: [],
          performanceLevel: "高表现",
        }],
      },
      errorField: "historicalData[0].metrics",
    },
    {
      name: "userPersonas条目结构错误",
      body: {
        ...VALID_BASE,
        userPersonas: [{
          name: "谨慎型用户",
          coreNeeds: "需要可靠信息",
          coreConcerns: [],
          contentPreferences: [],
          purchaseIntent: "低",
          topicFocus: "内容是否可靠",
          representativeComments: [],
        }],
      },
      errorField: "userPersonas[0].coreNeeds",
    },
  ];

  try {
    for (const testCase of cases) {
      const response = await postJSON(testCase.body);
      const result = await response.json() as {
        error?: string;
        errorCode?: string;
        errorField?: string;
      };

      assert.equal(response.status, 400, testCase.name);
      assert.equal(result.error, "请求格式错误", testCase.name);
      assert.equal(result.errorCode, "INVALID_REQUEST", testCase.name);
      assert.equal(result.errorField, testCase.errorField, testCase.name);
      assert.equal(aiCallCount, 0, testCase.name);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
