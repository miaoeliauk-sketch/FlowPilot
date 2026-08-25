import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { NextRequest } from "next/server";
import {
  buildIPSourceAnalysisProofClaims,
  createIPSourceAnalysisToken,
  digestIPSourceAnalysisProofClaims,
} from "./ip-source-analysis-proof";
import { initializeIPSourceLedger } from "./ip-source-ledger";
import { buildIPSourceAnalysisV2 } from "./ip-source-analysis-v2";

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

function createReviewedAnalysis(sourceId: string, reviewed = true) {
  const rawContent = "老师明确说：真正重要的是判断力。";
  const analysis = buildIPSourceAnalysisV2({
    sourceId,
    sourceContent: rawContent,
    analyzedAt: "2026-08-25T09:00:00.000Z",
    createId: () => "00000000-0000-4000-8000-000000000081",
    candidate: {
      nodes: [{
        nodeRef: "N1",
        question: { content: "什么最重要？", derivation: "inferred", anchors: [{ quote: rawContent }] },
        claim: { content: "真正重要的是判断力。", anchors: [{ quote: "真正重要的是判断力" }] },
        reasoning: { status: "not_provided", steps: [] },
        evidence: [],
        concepts: [],
      }],
      aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
    },
  });
  if (reviewed) analysis.nodes[0]!.reviewStatus = "human_confirmed";
  return { rawContent, analysis };
}

function request(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function register(ipId: string, analysis: ReturnType<typeof createReviewedAnalysis>["analysis"]) {
  const claims = buildIPSourceAnalysisProofClaims({ ipId, analysis });
  await initializeIPSourceLedger({
    sourceId: analysis.sourceId,
    ipId,
    nonce: analysis.nonce,
    digest: digestIPSourceAnalysisProofClaims(claims),
  });
  return createIPSourceAnalysisToken(claims, PROOF_SECRET);
}

test("V2认知仍有未审核节点时不能签发最终入库凭证", async () => {
  const { POST } = await import("../app/api/ip-source-analysis/finalize/route");
  const ipId = "ip-finalize-unreviewed";
  const { rawContent, analysis } = createReviewedAnalysis("source-finalize-unreviewed", false);
  const analysisToken = await register(ipId, analysis);

  const response = await POST(request("http://localhost/api/ip-source-analysis/finalize", {
    activeIPId: ipId,
    sourceId: analysis.sourceId,
    rawContent,
    analysis,
    analysisToken,
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "请先完成全部认知节点审核" });
});

test("最终入库凭证只能验证签发时绑定的IP、Source和认知结果", async () => {
  const { POST: finalizePOST } = await import("../app/api/ip-source-analysis/finalize/route");
  const { POST: verifyPOST } = await import("../app/api/ip-source-analysis/verify/route");
  const ipId = "ip-finalize-valid";
  const { rawContent, analysis } = createReviewedAnalysis("source-finalize-valid");
  const analysisToken = await register(ipId, analysis);
  const finalized = await finalizePOST(request("http://localhost/api/ip-source-analysis/finalize", {
    activeIPId: ipId,
    sourceId: analysis.sourceId,
    rawContent,
    analysis,
    analysisToken,
  }));
  const finalizedBody = await finalized.json();

  assert.equal(finalized.status, 200);
  assert.equal(typeof finalizedBody.finalProof, "string");

  const valid = await verifyPOST(request("http://localhost/api/ip-source-analysis/verify", {
    activeIPId: ipId,
    sourceId: analysis.sourceId,
    rawContent,
    analysis,
    finalProof: finalizedBody.finalProof,
  }));
  const forged = await verifyPOST(request("http://localhost/api/ip-source-analysis/verify", {
    activeIPId: ipId,
    sourceId: analysis.sourceId,
    rawContent,
    analysis,
    finalProof: "forged-final-proof",
  }));

  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { verified: true });
  assert.equal(forged.status, 400);
  assert.deepEqual(await forged.json(), { error: "最终入库凭证无效" });
});
