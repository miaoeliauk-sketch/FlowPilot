import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/script-factory/audit/route";

const SOURCES = [{
  sourceId: "source-1",
  sourceTitle: "老师直播原文",
  itemId: "claim-1",
  kind: "claim",
  content: "不要只看结果，要看结果背后的判断方式。",
  originalExcerpt: "不要只看结果，要看结果背后的判断方式。",
  extractionStatus: "人工确认",
}, {
  sourceId: "source-1",
  sourceTitle: "老师直播原文",
  itemId: "reasoning-1",
  kind: "reasoning",
  content: "判断方式会改变人的选择。",
  originalExcerpt: "判断方式会改变人的选择。",
  extractionStatus: "人工确认",
}];

const CONTENT = {
  outline: [{
    label: "核心判断",
    timeRange: "0—30秒",
    content: "很多人只看见结果，却没有追问结果背后的判断方式。",
    subPoints: [],
  }],
  pendingVerification: ["案例中的增长数字仍需核验"],
};

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/script-factory/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
    body: JSON.stringify(body),
  });
}

function deepSeekResponse(content: string, id: string): Response {
  return new Response(JSON.stringify({
    id,
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 20, completion_tokens: 20 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("生成后审计独立返回覆盖度、段落归属和事实核验", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return deepSeekResponse(JSON.stringify({
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
      }), "coverage");
    }
    return deepSeekResponse(JSON.stringify({
      paragraphs: [{
        paragraphId: "S1-P1",
        attributionType: "faithful_rewrite",
        sourceReferences: [{ sourceId: "source-1", itemId: "claim-1" }],
        reason: "段落忠实承接老师原始判断。",
      }],
    }), "attribution");
  };

  try {
    const response = await POST(request({
      topic: "变化背后的原因",
      angle: "从判断方式切入",
      sources: SOURCES,
      content: CONTENT,
      caseEvidence: null,
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "completed");
    assert.equal(body.coverageAssessment.coverage, "FULL");
    assert.equal(body.attributionAudit.auditStatus, "completed");
    assert.equal(body.attributionAudit.confidenceLevel, "high");
    assert.equal(body.attributionAudit.paragraphAttributions[0].attributionType, "faithful_rewrite");
    assert.equal(body.factAudit.overallStatus, "pending");
    assert.deepEqual(body.factAudit.pendingItems, ["案例中的增长数字仍需核验"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("覆盖度分析失败时返回分析未完成并保留独立事实核验", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse("不是合法JSON", `coverage-${calls}`);
  };

  try {
    const response = await POST(request({
      topic: "变化背后的原因",
      angle: "从判断方式切入",
      sources: SOURCES,
      content: CONTENT,
      caseEvidence: null,
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.equal(body.status, "unavailable");
    assert.equal(body.message, "本次归属分析暂未完成");
    assert.equal(body.coverageAssessment, undefined);
    assert.equal(body.attributionAudit, undefined);
    assert.equal(body.factAudit.overallStatus, "pending");
    assert.deepEqual(body.factAudit.pendingItems, ["案例中的增长数字仍需核验"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("段落归属分析失败时保留覆盖度结果并返回分析未完成", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return deepSeekResponse(JSON.stringify({
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
      }), "coverage");
    }
    return deepSeekResponse("不是合法JSON", "attribution");
  };

  try {
    const response = await POST(request({
      topic: "变化背后的原因",
      angle: "从判断方式切入",
      sources: SOURCES,
      content: CONTENT,
      caseEvidence: null,
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.equal(body.status, "unavailable");
    assert.equal(body.message, "本次归属分析暂未完成");
    assert.equal(body.coverageAssessment.coverage, "FULL");
    assert.equal(body.attributionAudit.auditStatus, "unavailable");
    assert.equal(body.attributionAudit.confidenceLevel, "low");
    assert.equal(body.factAudit.overallStatus, "pending");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("生成后审计拒绝非法请求且不调用模型", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return deepSeekResponse("{}", "unexpected");
  };

  try {
    const response = await POST(request(null));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error, "请求格式错误");
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
