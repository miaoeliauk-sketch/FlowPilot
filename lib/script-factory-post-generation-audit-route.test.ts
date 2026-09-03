import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/script-factory/audit/route";
import { POST as registerLegacySource } from "../app/api/ip-source-analysis/legacy/register/route";
import { buildIPSourceLegacyProofClaims, getIPSourceAnalysisProofSecret } from "./ip-source-analysis-proof";
import { trustLegacyMigrationForTests } from "./ip-source-ledger";
import { createScriptGenerationEvidenceProof } from "./script-factory-generation-evidence-proof";
import { createTeacherOriginalSourceSnapshot } from "./script-factory-source-snapshot-server";

let fixtureDir = "";
let previousLedger: string | undefined;
let previousSourceLedger: string | undefined;
const ACTIVE_IP_ID = "ip-shuimuran";

before(async () => {
  fixtureDir = await mkdtemp(path.join(tmpdir(), "flowpilot-script-audit-route-"));
  previousLedger = process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
  previousSourceLedger = process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE;
  process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = path.join(fixtureDir, "ledger.json");
  process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE = path.join(fixtureDir, "source-ledger.json");
  const rawContent = "不要只看结果，要看结果背后的判断方式。\n判断方式会改变人的选择。";
  const analysis = {
    analyzedAt: "2026-09-01T00:00:00.000Z",
    parserVersion: 1 as const,
    items: SOURCE_ITEMS.map((item, index) => ({
      id: item.itemId,
      kind: item.kind,
      content: item.content,
      sourceId: item.sourceId,
      startPosition: index === 0 ? 0 : rawContent.indexOf(item.originalExcerpt),
      endPosition: (index === 0 ? 0 : rawContent.indexOf(item.originalExcerpt)) + item.originalExcerpt.length,
      originalExcerpt: item.originalExcerpt,
      extractionStatus: item.extractionStatus,
    })),
  };
  await trustLegacyMigrationForTests(buildIPSourceLegacyProofClaims({
    ipId: ACTIVE_IP_ID,
    sourceId: "source-1",
    rawContent,
    contextItems: analysis.items,
  }));
  const registered = await registerLegacySource(new NextRequest(
    "http://localhost/api/ip-source-analysis/legacy/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activeIPId: ACTIVE_IP_ID,
        sourceIPId: ACTIVE_IP_ID,
        sourceId: "source-1",
        rawContent,
        analysis,
      }),
    },
  ));
  const registration = await registered.json() as { legacyProof?: string; error?: string };
  assert.equal(registered.status, 200, registration.error);
  SOURCES = SOURCE_ITEMS.map(item => ({
    parserVersion: 1 as const,
    legacyProof: registration.legacyProof!,
    ipId: ACTIVE_IP_ID,
    ...item,
  }));
});

after(async () => {
  if (previousLedger === undefined) delete process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
  else process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = previousLedger;
  if (previousSourceLedger === undefined) delete process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE;
  else process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE = previousSourceLedger;
  await rm(fixtureDir, { recursive: true, force: true });
});

const SOURCE_ITEMS = [{
  sourceId: "source-1",
  sourceTitle: "老师直播原文",
  itemId: "claim-1",
  kind: "claim" as const,
  content: "不要只看结果，要看结果背后的判断方式。",
  originalExcerpt: "不要只看结果，要看结果背后的判断方式。",
  extractionStatus: "人工确认" as const,
}, {
  sourceId: "source-1",
  sourceTitle: "老师直播原文",
  itemId: "reasoning-1",
  kind: "reasoning" as const,
  content: "判断方式会改变人的选择。",
  originalExcerpt: "判断方式会改变人的选择。",
  extractionStatus: "人工确认" as const,
}];

let SOURCES = SOURCE_ITEMS.map(item => ({
  parserVersion: 1 as const,
  legacyProof: "not-registered",
  ipId: ACTIVE_IP_ID,
  ...item,
}));

const CONTENT = {
  outline: [{
    label: "核心判断",
    timeRange: "0—30秒",
    content: "很多人只看见结果，却没有追问结果背后的判断方式。",
    subPoints: [],
  }],
  pendingVerification: ["案例中的增长数字仍需核验"],
};

function rawRequest(body: unknown): NextRequest {
  const requestBody = body && typeof body === "object" && !Array.isArray(body)
    ? { activeIPId: ACTIVE_IP_ID, ...body as Record<string, unknown> }
    : body;
  return new NextRequest("http://localhost/api/script-factory/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
    body: JSON.stringify(requestBody),
  });
}

async function request(body: unknown): Promise<NextRequest> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return rawRequest(body);
  const input = { ...body as Record<string, unknown> };
  const content = input.content as typeof CONTENT;
  const proofSources = (input.proofSources ?? input.sources ?? []) as typeof SOURCE_ITEMS;
  const caseEvidence = (input.caseEvidence ?? null) as null | {
    title: string; content?: string; sourceType: string; verificationStatus: string; sourceUrl?: string; occurredAt?: string;
  };
  const nonEvidenceReferences = ((input.nonEvidenceReferences ?? []) as Array<Record<string, unknown>>)
    .map(reference => ({ ...reference, evidenceRole: "non_evidence" as const })) as Array<{
      id: string; title: string; category: string; reason: string; evidenceRole: "non_evidence";
    }>;
  delete input.sources;
  delete input.teacherOriginalSources;
  delete input.nonEvidenceReferences;
  delete input.proofSources;
  delete input.caseEvidence;
  input.generationEvidenceProof = createScriptGenerationEvidenceProof({
    ipId: typeof input.activeIPId === "string" ? input.activeIPId : ACTIVE_IP_ID,
    content,
    sources: proofSources,
    caseEvidence,
    nonEvidenceReferences,
  }, await getIPSourceAnalysisProofSecret());
  return rawRequest(input);
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
    const response = await POST(await request({
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
    const response = await POST(await request({
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
    const response = await POST(await request({
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
    const response = await POST(await request({
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
    const response = await POST(rawRequest(null));
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
      { content: { ...CONTENT, contentPurpose: "建立信任" } },
    ]) {
      const response = await POST(await request({
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

test("生成后审计拒绝浏览器重新提交来源选集且不调用模型", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return deepSeekResponse("{}", "unexpected-untrusted-source");
  };

  try {
    const response = await POST(rawRequest({
      sources: SOURCE_ITEMS,
      content: CONTENT,
      caseEvidence: null,
    }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "GENERATION_EVIDENCE_MISMATCH");
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("生成后审计拒绝伪造的生成证据凭证且不调用模型", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return deepSeekResponse("{}", "unexpected-forged-generation-proof");
  };

  try {
    const response = await POST(rawRequest({
      generationEvidenceProof: "browser-forged-proof",
      content: CONTENT,
    }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "GENERATION_EVIDENCE_MISMATCH");
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("生成后审计拒绝浏览器替换生成时实际使用的案例证据", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return deepSeekResponse("{}", "unexpected-swapped-case-evidence");
  };
  try {
    const signedRequest = await request({
      sources: SOURCES,
      content: CONTENT,
      caseEvidence: {
        title: "生成时采用的案例A",
        content: "案例A的真实内容。",
        sourceType: "人工提供",
        verificationStatus: "有明确来源",
      },
    });
    const signedBody = await signedRequest.json() as Record<string, unknown>;
    const response = await POST(rawRequest({
      ...signedBody,
      caseEvidence: {
        title: "送审时替换的案例B",
        content: "案例B的不同内容。",
        sourceType: "人工提供",
        verificationStatus: "有明确来源",
      },
    }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "GENERATION_EVIDENCE_MISMATCH");
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("生成后审计只从服务端来源编号读取老师原文并将其他材料记录为非证据参考", async () => {
  const source = await createTeacherOriginalSourceSnapshot({
    ipId: "ip-shuimuran",
    title: "老师关于焦虑的原文",
    rawContent: "物质越发达，人反而越焦虑，因为原来的参照锚点正在消失。",
    idempotencyKey: "audit-trusted-source-001",
  });
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    prompts.push((requestBody.messages ?? []).map(message => message.content ?? "").join("\n"));
    if (prompts.length === 1) {
      return deepSeekResponse(JSON.stringify({
        coverage: "PARTIAL",
        reason: "老师原文提供了核心判断，但仍需补充更多推理。",
        coveredDimensions: ["核心判断"],
        missingDimensions: ["推理过程"],
        sourceReferences: [{ sourceId: source.sourceId, itemId: "teacher-original" }],
        caseNeed: "NOT_ASSESSED",
        caseReason: "覆盖度未完整前不判断案例。",
      }), "coverage-trusted-source");
    }
    return deepSeekResponse(JSON.stringify({
      paragraphs: [{
        paragraphId: "S1-P1",
        attributionType: "faithful_rewrite",
        sourceReferences: [{ sourceId: source.sourceId, itemId: "teacher-original" }],
        reason: "正文忠实承接老师原文。",
      }],
      integrityIssues: [],
    }), "attribution-trusted-source");
  };

  try {
    const response = await POST(await request({
      activeIPId: "ip-shuimuran",
      sources: [],
      teacherOriginalSources: [{
        sourceId: source.sourceId,
        contentSha256: source.contentSha256,
      }],
      proofSources: [{
        sourceId: source.sourceId,
        sourceTitle: source.title,
        itemId: "teacher-original",
        kind: "claim",
        content: source.rawContent,
        originalExcerpt: source.rawContent,
        extractionStatus: "人工确认",
      }],
      nonEvidenceReferences: [{
        id: "method-card-1",
        title: "三段式方法卡",
        category: "通用方法库",
        reason: "辅助组织文章结构",
      }, {
        id: "voice-sample-1",
        title: "历史口播样本",
        category: "IP表达语料",
        reason: "仅参考表达风格",
      }],
      content: {
        ...CONTENT,
        pendingVerification: [],
      },
      caseEvidence: null,
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "completed");
    assert.equal(body.coverageAssessment.sourceReferences[0].sourceId, source.sourceId);
    assert.equal(prompts.every(prompt => prompt.includes(source.rawContent)), true);
    assert.equal(prompts.every(prompt => !prompt.includes("三段式方法卡")), true);
    assert.equal(prompts.every(prompt => !prompt.includes("历史口播样本")), true);
    assert.deepEqual(body.referenceMaterials.nonEvidenceReferences, [{
      id: "method-card-1",
      title: "三段式方法卡",
      category: "通用方法库",
      reason: "辅助组织文章结构",
      evidenceRole: "non_evidence",
    }, {
      id: "voice-sample-1",
      title: "历史口播样本",
      category: "IP表达语料",
      reason: "仅参考表达风格",
      evidenceRole: "non_evidence",
    }]);
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
    const response = await POST(await request({
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
    const response = await POST(await request({
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
