import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { NextRequest } from "next/server";

const PROOF_SECRET = "test-only-ip-source-analysis-proof-secret-32-bytes";
const originalProofSecret = process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET;

before(() => {
  process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET = PROOF_SECRET;
});

after(() => {
  if (originalProofSecret === undefined) delete process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET;
  else process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET = originalProofSecret;
});

test("历史V1完成服务端登记后才能注入脚本生成", async () => {
  const { resetIPSourceLedgerForTests } = await import("./ip-source-ledger");
  const { POST } = await import("../app/api/ip-source-analysis/legacy/register/route");
  const { verifyScriptFactoryIPSourceContext } = await import("./script-factory-source-context-proof");
  await resetIPSourceLedgerForTests();
  const ipId = "ip-legacy-registered";
  const sourceId = "source-legacy-registered";
  const rawContent = "老师明确说：真正重要的是判断力。";
  const analysis = {
    analyzedAt: "2026-08-25T12:00:00.000Z",
    parserVersion: 1 as const,
    items: [{
      id: "legacy-claim-1",
      kind: "claim" as const,
      content: "真正重要的是判断力。",
      sourceId,
      startPosition: 6,
      endPosition: 15,
      originalExcerpt: "真正重要的是判断力",
      extractionStatus: "人工确认" as const,
    }],
  };
  const { buildIPSourceLegacyProofClaims } = await import("./ip-source-analysis-proof");
  const { trustLegacyMigrationForTests } = await import("./ip-source-ledger");
  await trustLegacyMigrationForTests(buildIPSourceLegacyProofClaims({
    ipId,
    sourceId,
    rawContent,
    contextItems: analysis.items,
  }));
  const response = await POST(new NextRequest(
    "http://localhost/api/ip-source-analysis/legacy/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeIPId: ipId, sourceIPId: ipId, sourceId, rawContent, analysis }),
    },
  ));
  const body = await response.json() as { legacyProof?: string };
  assert.equal(response.status, 200);
  assert.equal(typeof body.legacyProof, "string");

  assert.deepEqual(await verifyScriptFactoryIPSourceContext([{
    parserVersion: 1,
    legacyProof: body.legacyProof,
    ipId,
    sourceId,
    sourceTitle: "历史判断",
    itemId: "legacy-claim-1",
    kind: "claim",
    content: "真正重要的是判断力。",
    originalExcerpt: "真正重要的是判断力",
    extractionStatus: "人工确认",
  }], ipId), { ok: true });
});

test("历史V1登记时拒绝与当前IP不一致的归属", async () => {
  const { POST } = await import("../app/api/ip-source-analysis/legacy/register/route");
  const response = await POST(new NextRequest(
    "http://localhost/api/ip-source-analysis/legacy/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activeIPId: "ip-current",
        sourceIPId: "ip-other",
        sourceId: "source-cross-ip",
        rawContent: "老师原文",
        analysis: { analyzedAt: "2026-08-25T12:00:00.000Z", parserVersion: 1, items: [] },
      }),
    },
  ));
  const body = await response.json() as { error?: string };
  assert.equal(response.status, 403);
  assert.match(body.error ?? "", /不属于当前IP/);
});

test("不在服务端可信迁移清单中的V1认知不能获得凭证", async () => {
  const { resetIPSourceLedgerForTests } = await import("./ip-source-ledger");
  const { POST } = await import("../app/api/ip-source-analysis/legacy/register/route");
  await resetIPSourceLedgerForTests();
  const ipId = "ip-untrusted-legacy";
  const sourceId = "source-untrusted-legacy";
  const rawContent = "老师明确说：不能把未登记内容当成历史认知。";
  const response = await POST(new NextRequest(
    "http://localhost/api/ip-source-analysis/legacy/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activeIPId: ipId,
        sourceIPId: ipId,
        sourceId,
        rawContent,
        analysis: {
          analyzedAt: "2026-08-25T12:00:00.000Z",
          parserVersion: 1,
          items: [{
            id: "legacy-untrusted-claim",
            kind: "claim",
            content: "不能把未登记内容当成历史认知。",
            sourceId,
            startPosition: 6,
            endPosition: rawContent.length - 1,
            originalExcerpt: "不能把未登记内容当成历史认知",
            extractionStatus: "人工确认",
          }],
        },
      }),
    },
  ));
  const body = await response.json() as { error?: string };
  assert.equal(response.status, 403);
  assert.match(body.error ?? "", /可信迁移清单/);
});
