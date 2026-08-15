import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/topic-review/route";
import { parseTopicBoardResult } from "./topic-board-contract";
import { createTopicBoardIPProfile } from "./topic-board-contract.fixture";

function mockDeepSeekResponse(systemPrompt: string): Response {
  if (systemPrompt.includes("内容安全合规官")) {
    return mockSafetyVetoResponse({ veto: false });
  }

  const content = systemPrompt.includes("JSON格式输出数组")
    ? "[]"
    : systemPrompt.includes("董事会主席")
    ? JSON.stringify({
        upgradedTopics: ["建议做升级选题"],
        titles: ["建议做标题"],
        risks: ["风险可控"],
        credScore: 90,
        credReasons: ["其他专家普遍支持"],
      })
    : "{}";
  return new Response(JSON.stringify({
    id: "mock-topic-board-contract",
    choices: [{
      finish_reason: "stop",
      message: {
        content,
      },
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function mockSafetyFieldsResponse(fields: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    id: "mock-topic-board-safety-fields",
    choices: [{
      finish_reason: "stop",
      message: { content: JSON.stringify(fields) },
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function validSafetyFields(): Record<string, unknown> {
  return {
    observation: "没有发现不可控风险。",
    reasoning: "内容边界清晰。",
    conclusion: "可以通过安全审查。",
    dims: [
      { label: "言行无害性", score: 9 },
      { label: "合规性", score: 9 },
      { label: "争议免疫力", score: 9 },
    ],
    veto: false,
    vetoReason: null,
    vote: "支持",
  };
}

function readSystemPrompt(init?: RequestInit): string {
  const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
    messages?: Array<{ role: string; content: string }>;
  };
  return requestBody.messages?.find(message => message.role === "system")?.content ?? "";
}

function mockSafetyVetoResponse({
  veto = true,
  scores = [9, 9, 9],
}: {
  veto?: boolean;
  scores?: [number, number, number];
} = {}): Response {
  return new Response(JSON.stringify({
    id: "mock-topic-board-safety-veto",
    choices: [{
      finish_reason: "stop",
      message: {
        content: JSON.stringify({
          observation: "选题涉及不可控的合规风险。",
          reasoning: "当前IP影响范围较大，不能依靠措辞规避。",
          conclusion: "不建议制作当前版本。",
          dims: [
            { label: "言行无害性", score: scores[0] },
            { label: "合规性", score: scores[1] },
            { label: "争议免疫力", score: scores[2] },
          ],
          veto,
          vetoReason: veto ? "存在不可控的合规风险。" : null,
          vote: "反对",
        }),
      },
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("真实董事会接口拒绝缺少当前IP的请求且不调用AI", async () => {
  const originalFetch = globalThis.fetch;
  let apiCalled = false;
  globalThis.fetch = async () => {
    apiCalled = true;
    return mockDeepSeekResponse("");
  };

  try {
    const response = await POST(new NextRequest("http://localhost/api/topic-review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DeepSeek-Key": "mock-key",
      },
      body: JSON.stringify({ topic: "普通人如何判断行业趋势" }),
    }));
    const result = await response.json() as { errorCode?: string; errorField?: string };

    assert.equal(response.status, 400);
    assert.equal(result.errorCode, "MISSING_IP_PROFILE");
    assert.equal(result.errorField, "ipProfile");
    assert.equal(apiCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("真实董事会接口返回共享契约并保持请求IP归属", async () => {
  const originalFetch = globalThis.fetch;
  const ipProfile = createTopicBoardIPProfile();

  globalThis.fetch = async (_input, init) => {
    const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ role: string; content: string }>;
    };
    return mockDeepSeekResponse(requestBody.messages?.[0]?.content ?? "");
  };

  try {
    const response = await POST(new NextRequest("http://localhost/api/topic-review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DeepSeek-Key": "mock-key",
      },
      body: JSON.stringify({
        topic: "普通人如何判断行业趋势",
        ipProfile,
        userPersonas: [],
        knowledgeContext: [],
        historicalData: [],
      }),
    }));
    const rawResult: unknown = await response.json();

    assert.equal(response.status, 200);
    const result = parseTopicBoardResult(rawResult);
    assert.equal(result.ipId, ipProfile.id);
    assert.equal(result.ipName, ipProfile.name);
    assert.equal(result.topic, "普通人如何判断行业趋势");
    assert.equal(result.experts.length, 9);
    assert.equal(result.votes.length, 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("安全合规官主动否决时强制覆盖所有最终结论", async () => {
  const originalFetch = globalThis.fetch;
  const ipProfile = createTopicBoardIPProfile();

  globalThis.fetch = async (_input, init) => {
    const systemPrompt = readSystemPrompt(init);
    return systemPrompt.includes("内容安全合规官")
      ? mockSafetyVetoResponse()
      : mockDeepSeekResponse(systemPrompt);
  };

  try {
    const response = await POST(new NextRequest("http://localhost/api/topic-review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DeepSeek-Key": "mock-key",
      },
      body: JSON.stringify({
        topic: "高风险选题",
        ipProfile,
        userPersonas: [],
      }),
    }));
    const rawResult: unknown = await response.json();

    assert.equal(response.status, 200);
    const result = parseTopicBoardResult(rawResult);
    const safetyExpert = result.experts.find(expert => expert.role === "安全合规官");
    assert.ok(safetyExpert);
    assert.equal(safetyExpert.veto, true);
    assert.equal(safetyExpert.vetoReason, "存在不可控的合规风险。");
    assert.equal(safetyExpert.vote, "反对");
    assert.match(safetyExpert.conclusion, /安全否决/);
    assert.equal(result.safetyVeto, true);
    assert.equal(result.safetyVetoReason, "存在不可控的合规风险。");
    assert.equal(result.decisionStatus, "blocked");
    assert.equal(result.voteResult.verdict, "已阻断");
    assert.equal(result.finalRecommendation, null);
    assert.equal(result.totalScore, null);
    assert.equal(result.scoreDisplay, null);
    assert.equal(result.beginnerAdvice.canDo, "不能做当前版本。");
    assert.equal(result.beginnerAdvice.shouldTest, "不要测试当前版本，完成安全改写后重新评估。");
    assert.equal(result.riskLevel, null);
    assert.equal(result.chiefOfficer, null);
    assert.equal(result.optimizationPlan.retestSuggestion, "当前版本不得测试；完成安全改写后重新评估。");
    assert.deepEqual(result.optimizationPlan.keepParts, []);
    assert.deepEqual(result.optimizationPlan.rewrittenDirections, []);
    assert.deepEqual(result.upgradedTopics, []);
    assert.deepEqual(result.titles, []);
    assert.equal(result.personaPreview, null);
    assert.equal(result.beginnerAdvice.canDo.includes("建议做"), false);
    assert.equal(JSON.stringify(result).includes("建议先小规模测试"), false);
    assert.equal(JSON.stringify(result).includes("建议做升级选题"), false);
    assert.equal(JSON.stringify(result).includes("建议做标题"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("安全合规官缺少任一必填字段时重试后失败关闭", async () => {
  const originalFetch = globalThis.fetch;
  const ipProfile = createTopicBoardIPProfile();
  const cases: Array<{ field: "observation" | "reasoning" | "conclusion" | "dims" | "veto" | "vetoReason" | "vote" }> = [
    { field: "observation" },
    { field: "reasoning" },
    { field: "conclusion" },
    { field: "dims" },
    { field: "veto" },
    { field: "vetoReason" },
    { field: "vote" },
  ];

  try {
    for (const testCase of cases) {
      let safetyAttempts = 0;
      globalThis.fetch = async (_input, init) => {
        const systemPrompt = readSystemPrompt(init);
        if (!systemPrompt.includes("内容安全合规官")) {
          return mockDeepSeekResponse(systemPrompt);
        }
        safetyAttempts += 1;
        const fields = validSafetyFields();
        delete fields[testCase.field];
        return mockSafetyFieldsResponse(fields);
      };

      const response = await POST(new NextRequest("http://localhost/api/topic-review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-DeepSeek-Key": "mock-key",
        },
        body: JSON.stringify({ topic: `安全字段缺失：${testCase.field}`, ipProfile, userPersonas: [] }),
      }));
      const result = await response.json() as Record<string, unknown> & {
        error?: string;
        errorCode?: string;
      };

      assert.equal(response.status, 502, testCase.field);
      assert.equal(result.errorCode, "SAFETY_REVIEW_INVALID", testCase.field);
      assert.match(result.error ?? "", /安全校验异常，无法确认/, testCase.field);
      assert.equal(safetyAttempts, 2, testCase.field);
      assert.deepEqual(
        Object.keys(result).sort(),
        ["error", "errorCode", "errorStage"],
        `${testCase.field}失败响应不得包含任何评估结果字段`,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("安全合规官首次缺字段时会纠正重试并接受第二次完整结果", async () => {
  const originalFetch = globalThis.fetch;
  const ipProfile = createTopicBoardIPProfile();
  let safetyAttempts = 0;

  globalThis.fetch = async (_input, init) => {
    const systemPrompt = readSystemPrompt(init);
    if (!systemPrompt.includes("内容安全合规官")) {
      return mockDeepSeekResponse(systemPrompt);
    }
    safetyAttempts += 1;
    if (safetyAttempts === 1) {
      const fields = validSafetyFields();
      delete fields.veto;
      return mockSafetyFieldsResponse(fields);
    }
    return mockSafetyFieldsResponse(validSafetyFields());
  };

  try {
    const response = await POST(new NextRequest("http://localhost/api/topic-review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DeepSeek-Key": "mock-key",
      },
      body: JSON.stringify({ topic: "安全字段重试", ipProfile, userPersonas: [] }),
    }));

    assert.equal(response.status, 200);
    assert.equal(safetyAttempts, 2);
    assert.equal(parseTopicBoardResult(await response.json()).safetyVeto, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("安全维度或总分过低时即使AI未主动否决也会强制拦截", async () => {
  const originalFetch = globalThis.fetch;
  const ipProfile = createTopicBoardIPProfile();
  const cases: Array<{ name: string; scores: [number, number, number] }> = [
    { name: "单项安全维度不超过3分", scores: [3, 9, 9] },
    { name: "安全总分不超过45分", scores: [4, 4, 4] },
  ];

  try {
    for (const testCase of cases) {
      globalThis.fetch = async (_input, init) => {
        const systemPrompt = readSystemPrompt(init);
        return systemPrompt.includes("内容安全合规官")
          ? mockSafetyVetoResponse({ veto: false, scores: testCase.scores })
          : mockDeepSeekResponse(systemPrompt);
      };

      const response = await POST(new NextRequest("http://localhost/api/topic-review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-DeepSeek-Key": "mock-key",
        },
        body: JSON.stringify({ topic: testCase.name, ipProfile, userPersonas: [] }),
      }));
      const result = parseTopicBoardResult(await response.json());

      assert.equal(response.status, 200, testCase.name);
      assert.equal(result.safetyVeto, true, testCase.name);
      assert.equal(result.decisionStatus, "blocked", testCase.name);
      assert.equal(result.voteResult.verdict, "已阻断", testCase.name);
      assert.equal(result.finalRecommendation, null, testCase.name);
      assert.equal(result.totalScore, null, testCase.name);
      assert.equal(result.beginnerAdvice.canDo, "不能做当前版本。", testCase.name);
      assert.equal(result.riskLevel, null, testCase.name);
      assert.equal(result.chiefOfficer, null, testCase.name);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
