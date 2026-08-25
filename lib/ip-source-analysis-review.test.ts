import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { NextRequest } from "next/server";
import {
  buildIPSourceAnalysisProofClaims,
  createIPSourceAnalysisToken,
  digestIPSourceAnalysisProofClaims,
} from "./ip-source-analysis-proof";
import { initializeIPSourceLedger, resetIPSourceLedgerForTests } from "./ip-source-ledger";
import { buildIPSourceAnalysisV2 } from "./ip-source-analysis-v2";

const SOURCE_CONTENT = "老师明确说：不要追随已经形成的共识。";
const SOURCE_ID = "source-cognition-review";
const NODE_ID = "00000000-0000-4000-8000-000000000031";
const PROOF_SECRET = "test-only-ip-source-analysis-proof-secret-32-bytes";
const originalProofSecret = process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET;

before(() => {
  process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET = PROOF_SECRET;
});

after(() => {
  if (originalProofSecret === undefined) {
    delete process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET;
  } else {
    process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET = originalProofSecret;
  }
});

function createAnalysis() {
  return buildIPSourceAnalysisV2({
    sourceId: SOURCE_ID,
    sourceContent: SOURCE_CONTENT,
    analyzedAt: "2026-08-24T12:00:00.000Z",
    createId: () => NODE_ID,
    candidate: {
      nodes: [{
        nodeRef: "N1",
        question: {
          content: "选题是否应该追随共识？",
          derivation: "inferred",
          anchors: [{ quote: SOURCE_CONTENT }],
        },
        claim: {
          content: "不要追随已经形成的共识。",
          anchors: [{ quote: "不要追随已经形成的共识" }],
        },
        reasoning: { status: "not_provided", steps: [] },
        evidence: [],
        concepts: [],
      }],
      aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
    },
  });
}

function reviewRequest(body: unknown) {
  return new NextRequest("http://localhost/api/ip-source-analysis/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function analysisToken(analysis = createAnalysis(), ipId = "ip-shuimuran") {
  return createIPSourceAnalysisToken(
    buildIPSourceAnalysisProofClaims({ ipId, analysis }),
    PROOF_SECRET,
  );
}

async function registerAnalysis(analysis = createAnalysis(), ipId = "ip-shuimuran") {
  const claims = buildIPSourceAnalysisProofClaims({ ipId, analysis });
  await initializeIPSourceLedger({
    sourceId: analysis.sourceId,
    ipId,
    nonce: analysis.nonce,
    digest: digestIPSourceAnalysisProofClaims(claims),
  });
}

beforeEach(async () => {
  await resetIPSourceLedgerForTests();
  await registerAnalysis();
});

test("审核接口拒绝被篡改后与V2证据归属不一致的Source编号", async () => {
  const { POST } = await import("../app/api/ip-source-analysis/review/route");
  const response = await POST(reviewRequest({
    activeIPId: "ip-shuimuran",
    sourceId: "source-tampered",
    rawContent: SOURCE_CONTENT,
    analysis: createAnalysis(),
    analysisToken: analysisToken(),
    action: { type: "confirm", nodeId: NODE_ID },
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "V2认知解析的Source编号与知识记录不一致",
  });
});

test("人工修订另存权威版本且不覆盖AI原始内容和原文锚点", async () => {
  const { POST } = await import("../app/api/ip-source-analysis/review/route");
  const original = createAnalysis();
  const originalClaim = structuredClone(original.nodes[0]!.claim);
  const response = await POST(reviewRequest({
    activeIPId: "ip-shuimuran",
    sourceId: SOURCE_ID,
    rawContent: SOURCE_CONTENT,
    analysis: original,
    analysisToken: analysisToken(original),
    action: {
      type: "revise",
      nodeId: NODE_ID,
      humanRevision: {
        claim: "不要追随已经被所有人接受的共识。",
      },
    },
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.analysis.nodes[0].claim, originalClaim);
  assert.deepEqual(original.nodes[0]!.claim, originalClaim);
  assert.equal(body.analysis.nodes[0].reviewStatus, "human_confirmed");
  assert.equal(
    body.analysis.nodes[0].humanRevision.claim,
    "不要追随已经被所有人接受的共识。",
  );
  assert.ok(!Number.isNaN(Date.parse(body.analysis.nodes[0].humanRevision.updatedAt)));
});

test("同一个解析凭证连续审核两次时第二次因服务端版本已推进而被拒绝", async () => {
  const { POST } = await import("../app/api/ip-source-analysis/review/route");
  const analysis = createAnalysis();
  const token = analysisToken(analysis);
  const requestBody = {
    activeIPId: "ip-shuimuran",
    sourceId: SOURCE_ID,
    rawContent: SOURCE_CONTENT,
    analysis,
    analysisToken: token,
    action: { type: "confirm", nodeId: NODE_ID },
  };

  const first = await POST(reviewRequest(requestBody));
  const second = await POST(reviewRequest(requestBody));

  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.deepEqual(await second.json(), {
    error: "解析凭证已过期，请使用最新审核结果",
  });
});

test("审核接口拒绝借审核动作直接覆盖AI原始观点", async () => {
  const { POST } = await import("../app/api/ip-source-analysis/review/route");
  const response = await POST(reviewRequest({
    activeIPId: "ip-shuimuran",
    sourceId: SOURCE_ID,
    rawContent: SOURCE_CONTENT,
    analysis: createAnalysis(),
    analysisToken: analysisToken(),
    action: {
      type: "confirm",
      nodeId: NODE_ID,
      content: "被篡改的观点",
    },
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "审核操作格式错误" });
});

test("审核接口拒绝使用伪造凭证确认被篡改的AI原始观点", async () => {
  const { POST } = await import("../app/api/ip-source-analysis/review/route");
  const analysis = createAnalysis();
  analysis.nodes[0]!.claim.content = "前端篡改后的AI原始观点";
  const response = await POST(reviewRequest({
    activeIPId: "ip-shuimuran",
    sourceId: SOURCE_ID,
    rawContent: SOURCE_CONTENT,
    analysis,
    analysisToken: "forged-analysis-token",
    action: { type: "confirm", nodeId: NODE_ID },
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "解析凭证无效或与当前IP、Source不一致" });
});

test("解析凭证只能由签发时绑定的IP审核", async () => {
  const { POST } = await import("../app/api/ip-source-analysis/review/route");
  const analysis = createAnalysis();
  const response = await POST(reviewRequest({
    activeIPId: "ip-other",
    sourceId: SOURCE_ID,
    rawContent: SOURCE_CONTENT,
    analysis,
    analysisToken: analysisToken(analysis, "ip-shuimuran"),
    action: { type: "confirm", nodeId: NODE_ID },
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "解析凭证无效或与当前IP、Source不一致" });
});

test("旧解析凭证不能确认前端自行伪造的人工修订状态", async () => {
  const { POST } = await import("../app/api/ip-source-analysis/review/route");
  const original = createAnalysis();
  const token = analysisToken(original);
  const tampered = structuredClone(original);
  tampered.nodes[0]!.reviewStatus = "human_confirmed";
  tampered.nodes[0]!.humanRevision = {
    claim: "前端绕过审核接口伪造的人工修订",
    updatedAt: "2026-08-24T17:30:00.000Z",
  };
  const response = await POST(reviewRequest({
    activeIPId: "ip-shuimuran",
    sourceId: SOURCE_ID,
    rawContent: SOURCE_CONTENT,
    analysis: tampered,
    analysisToken: token,
    action: { type: "confirm", nodeId: NODE_ID },
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "解析凭证无效或与当前IP、Source不一致" });
});

test("拒绝认知节点时清除旧修订且保留可校验的原始证据", async () => {
  const { POST } = await import("../app/api/ip-source-analysis/review/route");
  const analysis = createAnalysis();
  analysis.nodes[0]!.reviewStatus = "human_confirmed";
  analysis.nodes[0]!.humanRevision = {
    claim: "曾经确认过的人工修订",
    updatedAt: "2026-08-24T12:30:00.000Z",
  };
  await resetIPSourceLedgerForTests();
  await registerAnalysis(analysis);
  const response = await POST(reviewRequest({
    activeIPId: "ip-shuimuran",
    sourceId: SOURCE_ID,
    rawContent: SOURCE_CONTENT,
    analysis,
    analysisToken: analysisToken(analysis),
    action: { type: "reject", nodeId: NODE_ID },
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.analysis.nodes[0].reviewStatus, "rejected");
  assert.equal(Object.hasOwn(body.analysis.nodes[0], "humanRevision"), false);
  assert.equal(body.analysis.nodes[0].claim.content, "不要追随已经形成的共识。");
});

test("V2消费适配优先人工修订并剔除拒绝节点和AI建议", async () => {
  const { toV1CompatibleItems } = await import("./ip-source-analysis-v2");
  const analysis = createAnalysis();
  analysis.nodes[0]!.reviewStatus = "human_confirmed";
  analysis.nodes[0]!.humanRevision = {
    claim: "不要追随已经被所有人接受的共识。",
    updatedAt: "2026-08-24T12:30:00.000Z",
  };
  analysis.nodes.push({
    ...structuredClone(analysis.nodes[0]!),
    id: "00000000-0000-4000-8000-000000000032",
    claim: {
      content: "这条被拒绝的观点不能进入下游。",
      anchors: analysis.nodes[0]!.claim.anchors,
    },
    reviewStatus: "rejected",
    humanRevision: undefined,
  });
  analysis.aiSuggestions.topicPotential = [{
    content: "AI建议也不能进入下游。",
    basedOnNodeIds: [NODE_ID],
  }];

  const items = toV1CompatibleItems(analysis);
  const claim = items.find(item => item.id === `${NODE_ID}:claim`);
  assert.equal(claim?.content, "不要追随已经被所有人接受的共识。");
  assert.equal(claim?.originalExcerpt, "不要追随已经形成的共识");
  assert.equal(claim?.extractionStatus, "人工确认");
  assert.equal(items.some(item => item.content.includes("被拒绝")), false);
  assert.equal(items.some(item => item.content.includes("AI建议")), false);
});
