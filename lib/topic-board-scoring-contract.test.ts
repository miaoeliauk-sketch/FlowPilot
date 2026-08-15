import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/topic-review/route";
import { createTopicEvaluationSummary, parseTopicBoardResult } from "./topic-board-contract";
import { createTopicBoardIPProfile, createValidTopicBoardResult } from "./topic-board-contract.fixture";

function deepSeekResponse(content: unknown): Response {
  return new Response(JSON.stringify({
    id: "mock-topic-board-scoring",
    choices: [{
      finish_reason: "stop",
      message: { content: JSON.stringify(content) },
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function systemPromptFrom(init?: RequestInit): string {
  const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
    messages?: Array<{ role: string; content: string }>;
  };
  return requestBody.messages?.find(message => message.role === "system")?.content ?? "";
}

function installScoringMock(options: { safetyVeto?: boolean } = {}) {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = async (_input, init) => {
    callCount += 1;
    const systemPrompt = systemPromptFrom(init);
    if (systemPrompt.includes("内容安全合规官")) {
      return deepSeekResponse({
        observation: options.safetyVeto ? "存在不可控风险。" : "未发现不可控风险。",
        reasoning: options.safetyVeto ? "风险无法通过措辞消除。" : "内容边界清晰。",
        conclusion: options.safetyVeto ? "应停止推进。" : "可以继续评审。",
        dims: [
          { label: "言行无害性", score: options.safetyVeto ? 9 : 5 },
          { label: "合规性", score: options.safetyVeto ? 9 : 5 },
          { label: "争议免疫力", score: options.safetyVeto ? 9 : 5 },
        ],
        veto: options.safetyVeto ?? false,
        vetoReason: options.safetyVeto ? "存在不可控的安全合规风险。" : null,
        vote: options.safetyVeto ? "反对" : "支持",
      });
    }
    if (systemPrompt.includes("JSON格式输出数组")) return deepSeekResponse([]);
    if (systemPrompt.includes("董事会主席")) {
      return deepSeekResponse({
        upgradedTopics: ["升级选题"],
        titles: ["升级标题"],
        risks: [],
        credScore: 70,
        credReasons: ["AI多角色评审结论一致。"],
      });
    }
    if (systemPrompt.includes("首席反对官")) {
      return deepSeekResponse({
        reasons: ["需要先验证。"],
        riskLevel: "中风险",
        failProbability: 40,
        dismissalSuggestion: "建议小范围测试。",
      });
    }
    return deepSeekResponse({
      observation: "选题具备明确价值。",
      reasoning: "根据当前IP定位给出判断。",
      conclusion: "建议继续。",
      dims: [
        { label: "维度一", score: 8 },
        { label: "维度二", score: 8 },
      ],
      vote: "支持",
    });
  };

  return {
    restore() {
      globalThis.fetch = originalFetch;
    },
    getCallCount() {
      return callCount;
    },
  };
}

async function reviewTopic(topic: string, historicalData: unknown[] = []) {
  const response = await POST(new NextRequest("http://localhost/api/topic-review", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "mock-key",
    },
    body: JSON.stringify({
      topic,
      ipProfile: createTopicBoardIPProfile(),
      knowledgeContext: [],
      historicalData,
      userPersonas: [],
    }),
  }));
  return {
    response,
    result: await response.json() as Record<string, unknown>,
  };
}

test("AI多角色评审分决定基础分且安全合规官不参与内容价值平均", async () => {
  const mock = installScoringMock();
  try {
    const ordinary = await reviewTopic("普通人如何判断行业趋势");
    const keywordRich = await reviewTopic("为什么这个赚钱案例有3个数字秘密");

    assert.equal(ordinary.response.status, 200);
    assert.equal(keywordRich.response.status, 200);
    assert.equal(ordinary.result.decisionStatus, "evaluated");
    assert.equal(ordinary.result.aiBaseScore, 80);
    assert.equal(keywordRich.result.aiBaseScore, 80);
    assert.equal(ordinary.result.finalReferenceScore, 80);
    assert.equal(keywordRich.result.finalReferenceScore, 80);
    assert.equal(ordinary.result.evidenceAdjustment, 0);
    assert.equal(keywordRich.result.evidenceAdjustment, 0);
  } finally {
    mock.restore();
  }
});

test("历史证据逐项透明调整且总幅度严格限制在正负10分", async () => {
  const mock = installScoringMock();
  const highPerformanceSamples = Array.from({ length: 4 }, (_, index) => ({
    id: `sample-high-${index + 1}`,
    title: `高表现样本${index + 1}`,
    source: "发布复盘",
    content: "与当前选题属于同类内容。",
    metrics: { calibrationPerformanceLevel: "high" },
    performanceLevel: "A类高表现",
    matchScore: 8 - index,
  }));

  try {
    const withEvidence = await reviewTopic("普通人如何判断行业趋势", highPerformanceSamples);
    const lowPerformanceSamples = highPerformanceSamples.map((sample, index) => ({
      ...sample,
      id: `sample-low-${index + 1}`,
      title: `低表现样本${index + 1}`,
      metrics: { calibrationPerformanceLevel: "low" },
      performanceLevel: "C类低表现",
    }));
    const withNegativeEvidence = await reviewTopic("普通人如何判断行业趋势", lowPerformanceSamples);
    const withoutEvidence = await reviewTopic("普通人如何判断行业趋势");
    const adjustmentItems = withEvidence.result.evidenceAdjustmentItems as Array<{
      sampleId: string;
      title: string;
      performanceLevel: string;
      adjustment: number;
      reason: string;
    }>;

    assert.equal(withEvidence.response.status, 200);
    assert.equal(withEvidence.result.aiBaseScore, 80);
    assert.equal(withEvidence.result.evidenceAdjustment, 10);
    assert.equal(withEvidence.result.finalReferenceScore, 90);
    assert.equal(adjustmentItems.length, 4);
    assert.equal(adjustmentItems[0].sampleId, "sample-high-1");
    assert.equal(adjustmentItems[0].title, "高表现样本1");
    assert.equal(adjustmentItems[0].performanceLevel, "A类高表现");
    assert.match(adjustmentItems[0].reason, /高表现/);
    assert.equal(adjustmentItems.reduce((sum, item) => sum + item.adjustment, 0), 10);
    assert.equal(withEvidence.result.confidenceLevel, "高");

    assert.equal(withNegativeEvidence.result.evidenceAdjustment, -10);
    assert.equal(withNegativeEvidence.result.finalReferenceScore, 70);
    assert.equal(
      (withNegativeEvidence.result.evidenceAdjustmentItems as Array<{ adjustment: number }>).reduce(
        (sum, item) => sum + item.adjustment,
        0,
      ),
      -10,
    );

    assert.equal(withoutEvidence.result.evidenceAdjustment, 0);
    assert.equal(withoutEvidence.result.finalReferenceScore, 80);
    assert.equal(withoutEvidence.result.confidenceLevel, "低");
    assert.equal(withoutEvidence.result.confidenceReason, "可信度较低，建议小范围测试。");
  } finally {
    mock.restore();
  }
});

test("安全否决只返回已阻断状态且不生成普通评分和首席反对官占位结论", async () => {
  const mock = installScoringMock({ safetyVeto: true });
  try {
    const blocked = await reviewTopic("存在不可控安全风险的选题");

    assert.equal(blocked.response.status, 200);
    assert.equal(mock.getCallCount(), 9);
    assert.equal(blocked.result.decisionStatus, "blocked");
    assert.equal(blocked.result.safetyVeto, true);
    assert.equal(blocked.result.voteResult && (blocked.result.voteResult as { verdict?: string }).verdict, "已阻断");
    assert.equal(blocked.result.chiefOfficer, null);
    assert.equal(blocked.result.totalScore, null);
    assert.equal(blocked.result.scoreDisplay, null);
    assert.equal(blocked.result.riskLevel, null);
    assert.equal(blocked.result.finalRecommendation, null);
    assert.equal(blocked.result.aiBaseScore, null);
    assert.equal(blocked.result.finalReferenceScore, null);
    assert.equal(blocked.result.confidenceLevel, null);
    assert.equal(blocked.result.confidenceReason, "安全边界已触发，不进行内容价值评分。");
    assert.deepEqual(blocked.result.weights, []);
    assert.deepEqual(blocked.result.scoreBreakdown, []);
    assert.equal(JSON.stringify(blocked.result).includes("低风险"), false);

    const parsed = parseTopicBoardResult(blocked.result);
    const summary = createTopicEvaluationSummary(parsed, "2026-08-15T00:00:00.000Z");
    assert.equal(summary.decisionStatus, "blocked");
    assert.equal(summary.totalScore, null);
    assert.equal(summary.scoreDisplay, null);
    assert.equal(summary.finalRecommendation, null);
  } finally {
    mock.restore();
  }
});

test("已评估状态不能同时携带安全否决", async () => {
  const mock = installScoringMock();
  try {
    const evaluated = await reviewTopic("普通选题");
    assert.equal(evaluated.response.status, 200);
    assert.equal(evaluated.result.decisionStatus, "evaluated");

    const contradictoryResult = {
      ...evaluated.result,
      safetyVeto: true,
      safetyVetoReason: "人为构造的矛盾数据。",
    };

    assert.throws(
      () => parseTopicBoardResult(contradictoryResult),
      /已评估结果不能同时包含安全否决/,
    );
  } finally {
    mock.restore();
  }
});

test("旧版选题记录缺少新评分字段时仍按旧版契约正常打开", () => {
  const legacyResult = createValidTopicBoardResult();
  const parsed = parseTopicBoardResult(legacyResult);

  assert.equal(parsed.topic, legacyResult.topic);
  assert.equal(parsed.totalScore, 72);
  assert.equal(parsed.decisionStatus, undefined);
  assert.equal(parsed.aiBaseScore, undefined);
  assert.equal(parsed.evidenceAdjustmentItems, undefined);
});
