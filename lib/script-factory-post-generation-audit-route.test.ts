import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/script-factory/audit/route";

let fixtureDir = "";
let previousLedger: string | undefined;

before(async () => {
  fixtureDir = await mkdtemp(path.join(tmpdir(), "flowpilot-script-audit-route-"));
  previousLedger = process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
  process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = path.join(fixtureDir, "ledger.json");
});

after(async () => {
  if (previousLedger === undefined) delete process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
  else process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = previousLedger;
  await rm(fixtureDir, { recursive: true, force: true });
});

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
      integrityIssues: [],
    }), "attribution");
  };

  try {
    const response = await POST(request({
      sources: SOURCES,
      content: CONTENT,
      caseEvidence: null,
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "completed");
    assert.match(body.auditVersion, /^[a-f0-9]{64}$/);
    assert.equal(body.coverageAssessment.coverage, "FULL");
    assert.equal(body.attributionAudit.auditStatus, "completed");
    assert.equal(body.attributionAudit.confidenceLevel, "high");
    assert.equal(body.attributionAudit.paragraphAttributions[0].attributionType, "faithful_rewrite");
    assert.equal(body.sourceIntegrityAudit.status, "passed");
    assert.equal(body.sourceIntegrityAudit.deliveryBlocked, false);
    assert.equal(body.factAudit.overallStatus, "pending");
    assert.equal(body.factAudit.pendingItems.length, 1);
    assert.deepEqual(body.factAudit.pendingItems[0], {
      id: `${body.auditVersion}:pending-verification:0`,
      sectionIndex: null,
      paragraphIndex: 0,
      subtype: "declared_pending_verification",
      excerpt: "案例中的增长数字仍需核验",
      reason: "生成结果明确标记该事实仍需核验。",
      resolutionStatus: "PENDING",
    });
    assert.deepEqual(body.deliveryGate, {
      status: "BLOCKED",
      auditVersion: body.auditVersion,
      blockerCodes: ["UNRESOLVED_FACT_VERIFICATION"],
      pendingItemIds: [`${body.auditVersion}:pending-verification:0`],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("人工补充案例未核实时生成服务端待核验项并阻断交付", async () => {
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
      }), "coverage-unverified-case");
    }
    return deepSeekResponse(JSON.stringify({
      paragraphs: [{
        paragraphId: "S1-P1",
        attributionType: "faithful_rewrite",
        sourceReferences: [{ sourceId: "source-1", itemId: "claim-1" }],
        reason: "段落忠实承接老师原始判断。",
      }],
      integrityIssues: [],
    }), "attribution-unverified-case");
  };

  try {
    const response = await POST(request({
      sources: SOURCES,
      content: { ...CONTENT, pendingVerification: [] },
      caseEvidence: {
        title: "销售团队使用AI的案例",
        content: "销售团队接入AI后转化率提升了30%。",
        sourceType: "人工提供",
        verificationStatus: "未经系统核验",
      },
    }));
    const body = await response.json();
    const pendingItemId = `${body.auditVersion}:case-evidence:0:declared_pending_verification`;

    assert.equal(response.status, 200);
    assert.equal(body.status, "completed");
    assert.equal(body.factAudit.overallStatus, "pending");
    assert.deepEqual(body.factAudit.pendingItems, [{
      id: pendingItemId,
      sectionIndex: null,
      paragraphIndex: 0,
      subtype: "declared_pending_verification",
      excerpt: "销售团队接入AI后转化率提升了30%。",
      reason: "人工补充案例尚未核实。",
      resolutionStatus: "PENDING",
    }]);
    assert.deepEqual(body.deliveryGate, {
      status: "BLOCKED",
      auditVersion: body.auditVersion,
      blockerCodes: ["UNRESOLVED_FACT_VERIFICATION"],
      pendingItemIds: [pendingItemId],
    });
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
      sources: SOURCES,
      content: CONTENT,
      caseEvidence: null,
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 3, "技术性解析失败允许重试一次，但不会触发正文改写");
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

test("生成后审计物理拒绝IP风格等非证据字段且不调用模型", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return deepSeekResponse("{}", "unexpected");
  };

  try {
    for (const forbidden of [
      { styleProfile: { tone: "沉稳" } },
      { contentPurpose: "建立信任" },
      { maturity: "成熟需求" },
      { formatCategory: "人物访谈" },
      { challengeResponse: "用户已经确认" },
      { topic: "不应由审计接口接收的选题" },
      { angle: "不应由审计接口接收的切入角度" },
      { sources: SOURCES.map(source => ({ ...source, ipStyle: "沉稳" })) },
      { content: { ...CONTENT, contentPurpose: "建立信任" } },
    ]) {
      const response = await POST(request({
        sources: SOURCES,
        content: CONTENT,
        caseEvidence: null,
        ...forbidden,
      }));
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, "审计接口只接受正文与证据字段");
    }
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("生成后审计命中表述失真时阻止交付但不自动改写正文", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return deepSeekResponse(JSON.stringify({
        coverage: "FULL",
        reason: "素材包含相关判断和推理。",
        coveredDimensions: ["核心判断", "推理过程"],
        missingDimensions: [],
        sourceReferences: [
          { sourceId: "source-1", itemId: "claim-1" },
          { sourceId: "source-1", itemId: "reasoning-1" },
        ],
        caseNeed: "NOT_NEEDED",
        caseReason: "不需要案例。",
      }), "coverage-integrity");
    }
    return deepSeekResponse(JSON.stringify({
      paragraphs: [{
        paragraphId: "S1-P1",
        attributionType: "faithful_rewrite",
        sourceReferences: [{ sourceId: "source-1", itemId: "claim-1" }],
        reason: "正文与原素材相关。",
      }],
      integrityIssues: [{
        code: "responsibility_subject_distortion",
        paragraphId: "S1-P1",
        sourceReferences: [{ sourceId: "source-1", itemId: "claim-1" }],
        reason: "外部质疑被改写成当事人本人前后矛盾。",
      }],
    }), "attribution-integrity");
  };

  try {
    const response = await POST(request({
      sources: SOURCES,
      content: CONTENT,
      caseEvidence: null,
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "completed");
    assert.equal(body.sourceIntegrityAudit.status, "needs_review");
    assert.equal(body.sourceIntegrityAudit.deliveryBlocked, true);
    assert.equal(body.sourceIntegrityAudit.issues[0].code, "responsibility_subject_distortion");
    assert.equal(body.sourceIntegrityAudit.issues[0].excerpt, CONTENT.outline[0].content);
    assert.equal(calls, 2, "审计失败后不得自动发起第三次改写调用");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("零素材稿只将无依据具体陈述送入事实待核验并阻断正式交付", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return deepSeekResponse(JSON.stringify({
        coverage: "NONE",
        reason: "当前没有可支撑正文的老师原始内容。",
        coveredDimensions: [],
        missingDimensions: ["核心判断", "推理过程"],
        sourceReferences: [],
        caseNeed: "NOT_ASSESSED",
        caseReason: "先补充老师原始内容。",
      }), "coverage-none");
    }
    return deepSeekResponse(JSON.stringify({
      paragraphs: [{
        paragraphId: "S1-P1",
        attributionType: "ai_reasoning",
        reasoningSubtype: "unsupported_opinion",
        sourceReferences: [],
        reason: "这是缺少素材支撑的分析性判断。",
      }, {
        paragraphId: "S2-P1",
        attributionType: "ai_reasoning",
        reasoningSubtype: "unsupported_specific_claim",
        sourceReferences: [],
        reason: "这是模型新增的无输入依据具体案例，不代表系统已判定其现实中为假。",
      }],
      integrityIssues: [],
    }), "attribution-subtypes");
  };

  try {
    const response = await POST(request({
      sources: [],
      content: {
        outline: [{
          label: "分析判断",
          timeRange: "0—20秒",
          content: "企业AI落地的关键在于技术与业务协同。",
          subPoints: [],
        }, {
          label: "案例说明",
          timeRange: "20—40秒",
          content: "我见过一家企业，销售拒绝录入数据，后来让销售参与设计才跑通。",
          subPoints: [],
        }],
        pendingVerification: [],
      },
      caseEvidence: null,
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "completed");
    assert.match(body.auditSessionId, /^[a-zA-Z0-9_-]+$/);
    assert.equal(
      body.attributionAudit.paragraphAttributions[0].reasoningSubtype,
      "unsupported_opinion",
    );
    assert.equal(
      body.attributionAudit.paragraphAttributions[1].reasoningSubtype,
      "unsupported_specific_claim",
    );
    assert.equal(body.factAudit.pendingItems.length, 1);
    assert.deepEqual(body.factAudit.pendingItems[0], {
      id: `${body.auditVersion}:1:0:unsupported_specific_claim`,
      sectionIndex: 1,
      paragraphIndex: 0,
      subtype: "unsupported_specific_claim",
      excerpt: "我见过一家企业，销售拒绝录入数据，后来让销售参与设计才跑通。",
      reason: "这是模型新增的无输入依据具体案例，不代表系统已判定其现实中为假。",
      resolutionStatus: "PENDING",
    });
    assert.deepEqual(body.deliveryGate, {
      status: "BLOCKED",
      auditVersion: body.auditVersion,
      blockerCodes: ["UNRESOLVED_UNSUPPORTED_SPECIFIC_CLAIM"],
      pendingItemIds: [`${body.auditVersion}:1:0:unsupported_specific_claim`],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
