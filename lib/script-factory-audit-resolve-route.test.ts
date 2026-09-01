import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as audit } from "../app/api/script-factory/audit/route";
import { POST as resolveAuditItem } from "../app/api/script-factory/audit/resolve/route";

function request(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
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

async function createBlockedAudit(input?: {
  auditSessionId?: string;
  content?: string;
  reasoningSubtype?: "unsupported_opinion" | "unsupported_specific_claim";
  pendingVerification?: string[];
}) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return deepSeekResponse(JSON.stringify({
        coverage: "NONE",
        reason: "没有老师原始内容。",
        coveredDimensions: [],
        missingDimensions: ["核心判断"],
        sourceReferences: [],
        caseNeed: "NOT_ASSESSED",
        caseReason: "需要补充原始内容。",
      }), "coverage-none");
    }
    return deepSeekResponse(JSON.stringify({
      paragraphs: [{
        paragraphId: "S1-P1",
        attributionType: "ai_reasoning",
        reasoningSubtype: input?.reasoningSubtype ?? "unsupported_specific_claim",
        sourceReferences: [],
        reason: "模型新增了输入素材没有提供的具体案例。",
      }],
      integrityIssues: [],
    }), "attribution-specific-claim");
  };

  try {
    const response = await audit(request("http://localhost/api/script-factory/audit", {
      ...(input?.auditSessionId ? { auditSessionId: input.auditSessionId } : {}),
      sources: [],
      content: {
        outline: [{
          label: "案例说明",
          timeRange: "0—20秒",
          content: input?.content ?? "我见过一家企业，后来让销售参与设计才跑通。",
          subPoints: [],
        }],
        pendingVerification: input?.pendingVerification ?? [],
      },
      caseEvidence: null,
    }));
    assert.equal(response.status, 200);
    return response.json();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("人工放行只允许处理高风险无依据具体陈述", async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "flowpilot-script-audit-resolution-type-"));
  const previousLedger = process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
  process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = path.join(fixtureDir, "ledger.json");
  try {
    const auditResult = await createBlockedAudit({
      reasoningSubtype: "unsupported_opinion",
      pendingVerification: ["这条数据需要后续核验"],
    });
    const pendingItem = auditResult.factAudit.pendingItems.find(
      (item: { subtype?: string }) => item.subtype === "declared_pending_verification",
    );
    assert.ok(pendingItem);

    const response = await resolveAuditItem(request(
      "http://localhost/api/script-factory/audit/resolve",
      {
        auditSessionId: auditResult.auditSessionId,
        auditVersion: auditResult.auditVersion,
        pendingItemId: pendingItem.id,
        resolutionStatus: "CONFIRMED_ALLOWED",
        idempotencyKey: "reject-declared-pending-verification",
      },
    ));
    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.code, "RESOLUTION_NOT_ALLOWED_FOR_PENDING_ITEM_TYPE");
  } finally {
    if (previousLedger === undefined) delete process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
    else process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = previousLedger;
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("人工处理相同请求重复提交时返回首次成功结果且不重复处理", async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "flowpilot-script-audit-"));
  const previousLedger = process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
  process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = path.join(fixtureDir, "ledger.json");
  try {
    const auditResult = await createBlockedAudit();
    const body = {
      auditSessionId: auditResult.auditSessionId,
      auditVersion: auditResult.auditVersion,
      pendingItemId: auditResult.factAudit.pendingItems[0].id,
      resolutionStatus: "CONFIRMED_ALLOWED",
      idempotencyKey: "resolve-once-001",
    };

    const firstResponse = await resolveAuditItem(request(
      "http://localhost/api/script-factory/audit/resolve",
      body,
    ));
    const firstResult = await firstResponse.json();
    const repeatedResponse = await resolveAuditItem(request(
      "http://localhost/api/script-factory/audit/resolve",
      body,
    ));
    const repeatedResult = await repeatedResponse.json();

    assert.equal(firstResponse.status, 200);
    assert.equal(repeatedResponse.status, 200);
    assert.deepEqual(repeatedResult, firstResult);
    assert.equal(firstResult.pendingItem.resolutionStatus, "CONFIRMED_ALLOWED");
    assert.deepEqual(firstResult.deliveryGate, {
      status: "OPEN",
      auditVersion: auditResult.auditVersion,
      blockerCodes: [],
      pendingItemIds: [],
    });
  } finally {
    if (previousLedger === undefined) delete process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
    else process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = previousLedger;
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("人工放行具体陈述后若只剩事实待核验项则返回对应阻断码", async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "flowpilot-script-audit-resolution-code-"));
  const previousLedger = process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
  process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = path.join(fixtureDir, "ledger.json");
  try {
    const auditResult = await createBlockedAudit({
      pendingVerification: ["案例中的增长数字仍需核验"],
    });
    const specificClaim = auditResult.factAudit.pendingItems.find(
      (item: { subtype?: string }) => item.subtype === "unsupported_specific_claim",
    );
    assert.ok(specificClaim);

    const response = await resolveAuditItem(request(
      "http://localhost/api/script-factory/audit/resolve",
      {
        auditSessionId: auditResult.auditSessionId,
        auditVersion: auditResult.auditVersion,
        pendingItemId: specificClaim.id,
        resolutionStatus: "CONFIRMED_ALLOWED",
        idempotencyKey: "resolve-specific-keep-fact-pending",
      },
    ));
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.deliveryGate.status, "BLOCKED");
    assert.deepEqual(result.deliveryGate.blockerCodes, ["UNRESOLVED_FACT_VERIFICATION"]);
    assert.equal(result.deliveryGate.pendingItemIds.length, 1);
  } finally {
    if (previousLedger === undefined) delete process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
    else process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = previousLedger;
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("同一待审稿正文变化后沿用服务端会话并拒绝旧版本确认", async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "flowpilot-script-audit-revision-"));
  const previousLedger = process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
  process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = path.join(fixtureDir, "ledger.json");
  try {
    const firstAudit = await createBlockedAudit();
    const secondAudit = await createBlockedAudit({
      auditSessionId: firstAudit.auditSessionId,
      content: "我见过另一家企业，后来让运营参与设计才跑通。",
    });

    assert.equal(secondAudit.auditSessionId, firstAudit.auditSessionId);
    assert.notEqual(secondAudit.auditVersion, firstAudit.auditVersion);

    const response = await resolveAuditItem(request(
      "http://localhost/api/script-factory/audit/resolve",
      {
        auditSessionId: firstAudit.auditSessionId,
        auditVersion: firstAudit.auditVersion,
        pendingItemId: firstAudit.factAudit.pendingItems[0].id,
        resolutionStatus: "CONFIRMED_ALLOWED",
        idempotencyKey: "resolve-obsolete-revision-001",
      },
    ));
    const result = await response.json();
    assert.equal(response.status, 409);
    assert.equal(result.code, "STALE_AUDIT_VERSION");
  } finally {
    if (previousLedger === undefined) delete process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
    else process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = previousLedger;
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("人工处理拒绝与服务端最新会话不一致的审计版本", async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "flowpilot-script-audit-stale-"));
  const previousLedger = process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
  process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = path.join(fixtureDir, "ledger.json");
  try {
    const auditResult = await createBlockedAudit();
    const response = await resolveAuditItem(request(
      "http://localhost/api/script-factory/audit/resolve",
      {
        auditSessionId: auditResult.auditSessionId,
        auditVersion: "0".repeat(64),
        pendingItemId: auditResult.factAudit.pendingItems[0].id,
        resolutionStatus: "CONFIRMED_ALLOWED",
        idempotencyKey: "resolve-stale-001",
      },
    ));
    const result = await response.json();

    assert.equal(response.status, 409);
    assert.equal(result.code, "STALE_AUDIT_VERSION");
  } finally {
    if (previousLedger === undefined) delete process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
    else process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = previousLedger;
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("浏览器不能直接声明待核验项已有支撑或已从正文删除", async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "flowpilot-script-audit-untrusted-resolution-"));
  const previousLedger = process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
  process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = path.join(fixtureDir, "ledger.json");
  try {
    const auditResult = await createBlockedAudit();
    for (const resolutionStatus of ["SUPPORTED", "REMOVED"]) {
      const response = await resolveAuditItem(request(
        "http://localhost/api/script-factory/audit/resolve",
        {
          auditSessionId: auditResult.auditSessionId,
          auditVersion: auditResult.auditVersion,
          pendingItemId: auditResult.factAudit.pendingItems[0].id,
          resolutionStatus,
          idempotencyKey: `reject-browser-${resolutionStatus}`,
        },
      ));
      const result = await response.json();
      assert.equal(response.status, 400);
      assert.equal(result.code, "SERVER_VERIFICATION_REQUIRED");
    }
  } finally {
    if (previousLedger === undefined) delete process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
    else process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = previousLedger;
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
