import assert from "node:assert/strict";
import test from "node:test";

test("脚本工厂只接收与服务端终审结果完全一致的V2认知", async () => {
  const { buildIPSourceAnalysisV2, toV1CompatibleItems } = await import("./ip-source-analysis-v2");
  const {
    buildIPSourceAnalysisProofClaims,
    buildIPSourceFinalProofClaims,
    createIPSourceFinalProof,
    digestIPSourceAnalysisProofClaims,
    digestIPSourceFinalProofClaims,
  } = await import("./ip-source-analysis-proof");
  const { initializeIPSourceLedger, finalizeIPSourceLedger } = await import("./ip-source-ledger");
  const { verifyScriptFactoryIPSourceContext } = await import("./script-factory-source-context-proof");
  const ipId = "ip-source-context-proof";
  const sourceId = "source-context-proof";
  const sourceContent = "老师明确说：判断来自真实矛盾。";
  const secret = "test-only-ip-source-analysis-proof-secret-32-bytes";
  const previousSecret = process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET;

  try {
    process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET = secret;
    const analysis = buildIPSourceAnalysisV2({
      sourceId,
      sourceContent,
      analyzedAt: "2026-08-25T10:00:00.000Z",
      createId: () => "00000000-0000-4000-8000-000000000091",
      candidate: {
        nodes: [{
          nodeRef: "N1",
          question: { content: "判断来自哪里？", derivation: "explicit", anchors: [{ quote: sourceContent }] },
          claim: { content: "判断来自真实矛盾。", anchors: [{ quote: "判断来自真实矛盾" }] },
          reasoning: { status: "not_provided", steps: [] },
          evidence: [],
          concepts: [],
        }],
        aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
      },
    });
    analysis.nodes[0]!.reviewStatus = "human_confirmed";
    const contextItems = toV1CompatibleItems(analysis);
    const analysisClaims = buildIPSourceAnalysisProofClaims({ ipId, analysis });
    const finalClaims = buildIPSourceFinalProofClaims({ ipId, analysis, contextItems });
    await initializeIPSourceLedger({
      sourceId,
      ipId,
      nonce: analysis.nonce,
      digest: digestIPSourceAnalysisProofClaims(analysisClaims),
    });
    assert.equal(await finalizeIPSourceLedger({
      sourceId,
      ipId,
      expectedNonce: analysis.nonce,
      expectedDigest: digestIPSourceAnalysisProofClaims(analysisClaims),
      finalDigest: digestIPSourceFinalProofClaims(finalClaims),
    }), true);
    const finalProof = createIPSourceFinalProof(finalClaims, secret);
    const requestItems = contextItems.map(item => ({
      parserVersion: 2 as const,
      finalProof,
      ipId,
      sourceId,
      sourceTitle: "真实判断",
      itemId: item.id,
      kind: item.kind,
      content: item.content,
      originalExcerpt: item.originalExcerpt,
      extractionStatus: item.extractionStatus,
    }));

    assert.deepEqual(await verifyScriptFactoryIPSourceContext(requestItems, ipId), { ok: true });
    assert.deepEqual(
      await verifyScriptFactoryIPSourceContext([{ ...requestItems[0]!, content: "被篡改的观点" }], ipId),
      { ok: false, error: "V2认知内容与最终凭证不一致，已拒绝生成。" },
    );
    assert.deepEqual(
      await verifyScriptFactoryIPSourceContext([{ ...requestItems[0]!, parserVersion: 1, finalProof: undefined }], ipId),
      { ok: false, error: "V2认知不能伪装成旧版数据，已拒绝生成。" },
    );
  } finally {
    if (previousSecret === undefined) delete process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET;
    else process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET = previousSecret;
  }
});

test("没有迁移凭证的历史V1认知不能注入脚本生成", async () => {
  const { verifyScriptFactoryIPSourceContext } = await import("./script-factory-source-context-proof");
  assert.deepEqual(await verifyScriptFactoryIPSourceContext([{
    parserVersion: 1,
    ipId: "ip-legacy-v1",
    sourceId: "legacy-source-without-ledger",
    sourceTitle: "历史认知",
    itemId: "legacy-item",
    kind: "claim",
    content: "这是历史人工确认观点。",
    originalExcerpt: "这是历史人工确认观点。",
    extractionStatus: "人工确认",
  }], "ip-legacy-v1"), {
    ok: false,
    error: "历史V1认知尚未完成合规登记，已拒绝生成。",
  });
});
