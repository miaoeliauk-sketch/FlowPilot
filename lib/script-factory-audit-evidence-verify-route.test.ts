import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as verifyEvidence } from "../app/api/script-factory/audit/verify-evidence/route";
import { getIPSourceAnalysisProofSecret } from "./ip-source-analysis-proof";
import { createScriptAuditSession } from "./script-factory-audit-server";
import {
  digestScriptGenerationEvidenceProof,
  issueScriptGenerationEvidenceProof,
} from "./script-factory-generation-evidence-proof";

const content = {
  outline: [{
    label: "开头",
    timeRange: "0—20秒",
    content: "这是由老师原始内容生成的正文。",
    subPoints: [],
  }],
  pendingVerification: [],
};

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/script-factory/audit/verify-evidence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function withFixture(
  run: (fixture: {
    auditSessionId: string;
    auditVersion: string;
    generationEvidenceProof: string;
    generationEvidenceId: string;
    evidenceChainVersion: number;
  }) => Promise<void>,
) {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "flowpilot-audit-evidence-verify-"));
  const previousLedger = process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
  process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = path.join(fixtureDir, "ledger.json");
  try {
    const proof = issueScriptGenerationEvidenceProof({
      ipId: "ip-shuimuran",
      content,
      sources: [],
      caseEvidence: null,
      nonEvidenceReferences: [],
    }, await getIPSourceAnalysisProofSecret());
    const auditVersion = createHash("sha256").update(JSON.stringify({
      content,
      sources: [],
      caseEvidence: null,
      nonEvidenceReferences: [],
    })).digest("hex");
    const session = await createScriptAuditSession({
      auditVersion,
      generationEvidenceDigest: digestScriptGenerationEvidenceProof(proof.generationEvidenceProof),
      factAudit: {
        overallStatus: "not_checked",
        systemVerified: false,
        pendingItems: [],
        caseEvidence: null,
      },
      sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
      deliveryGate: {
        status: "OPEN",
        auditVersion,
        blockerCodes: [],
        pendingItemIds: [],
      },
    });
    await run({
      auditSessionId: session.auditSessionId,
      auditVersion,
      ...proof,
    });
  } finally {
    if (previousLedger === undefined) delete process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
    else process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = previousLedger;
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

test("恢复脚本时只有凭证、正文、IP、会话和版本全部匹配才确认可信", async () => {
  await withFixture(async fixture => {
    const response = await verifyEvidence(request({
      activeIPId: "ip-shuimuran",
      content,
      ...fixture,
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "verified",
      auditSessionId: fixture.auditSessionId,
      auditVersion: fixture.auditVersion,
      generationEvidenceId: fixture.generationEvidenceId,
      evidenceChainVersion: fixture.evidenceChainVersion,
      sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
      factAudit: {
        overallStatus: "not_checked",
        systemVerified: false,
        pendingItems: [],
        caseEvidence: null,
      },
      deliveryGate: {
        status: "OPEN",
        auditVersion: fixture.auditVersion,
        blockerCodes: [],
        pendingItemIds: [],
      },
    });
  });
});

test("恢复脚本时以服务端账本中的BLOCKED状态为准", async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "flowpilot-audit-evidence-blocked-"));
  const previousLedger = process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
  process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = path.join(fixtureDir, "ledger.json");
  try {
    const proof = issueScriptGenerationEvidenceProof({
      ipId: "ip-shuimuran",
      content,
      sources: [],
      caseEvidence: null,
      nonEvidenceReferences: [],
    }, await getIPSourceAnalysisProofSecret());
    const auditVersion = createHash("sha256").update(JSON.stringify({
      content,
      sources: [],
      caseEvidence: null,
      nonEvidenceReferences: [],
    })).digest("hex");
    const pendingItem = {
      id: `${auditVersion}:0:0:unsupported_specific_claim`,
      sectionIndex: 0,
      paragraphIndex: 0,
      subtype: "unsupported_specific_claim" as const,
      excerpt: content.outline[0].content,
      reason: "服务端记录为无依据具体陈述。",
      resolutionStatus: "PENDING" as const,
    };
    const session = await createScriptAuditSession({
      auditVersion,
      generationEvidenceDigest: digestScriptGenerationEvidenceProof(proof.generationEvidenceProof),
      factAudit: {
        overallStatus: "not_checked",
        systemVerified: false,
        pendingItems: [pendingItem],
        caseEvidence: null,
      },
      sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
      deliveryGate: {
        status: "BLOCKED",
        auditVersion,
        blockerCodes: ["UNRESOLVED_UNSUPPORTED_SPECIFIC_CLAIM"],
        pendingItemIds: [pendingItem.id],
      },
    });

    const response = await verifyEvidence(request({
      activeIPId: "ip-shuimuran",
      content,
      ...proof,
      auditSessionId: session.auditSessionId,
      auditVersion,
    }));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.deliveryGate.status, "BLOCKED");
    assert.deepEqual(payload.deliveryGate.pendingItemIds, [pendingItem.id]);
    assert.deepEqual(payload.factAudit.pendingItems, [pendingItem]);
  } finally {
    if (previousLedger === undefined) delete process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
    else process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = previousLedger;
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("人工改写复审后的正文按服务端当前审计版本恢复", async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "flowpilot-audit-evidence-rewrite-"));
  const previousLedger = process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
  process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = path.join(fixtureDir, "ledger.json");
  try {
    const proof = issueScriptGenerationEvidenceProof({
      ipId: "ip-shuimuran",
      content,
      sources: [],
      caseEvidence: null,
      nonEvidenceReferences: [],
    }, await getIPSourceAnalysisProofSecret());
    const rewrittenContent = {
      ...content,
      outline: [{ ...content.outline[0], content: "这是人工改写并已完成复审的正文。" }],
    };
    const auditVersion = createHash("sha256").update(JSON.stringify({
      content: rewrittenContent,
      sources: [],
      caseEvidence: null,
      nonEvidenceReferences: [],
    })).digest("hex");
    const session = await createScriptAuditSession({
      auditVersion,
      generationEvidenceDigest: digestScriptGenerationEvidenceProof(proof.generationEvidenceProof),
      factAudit: {
        overallStatus: "not_checked",
        systemVerified: false,
        pendingItems: [],
        caseEvidence: null,
      },
      sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
      deliveryGate: { status: "OPEN", auditVersion, blockerCodes: [], pendingItemIds: [] },
    });

    const response = await verifyEvidence(request({
      activeIPId: "ip-shuimuran",
      content: rewrittenContent,
      ...proof,
      auditSessionId: session.auditSessionId,
      auditVersion,
    }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "verified");
  } finally {
    if (previousLedger === undefined) delete process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
    else process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = previousLedger;
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("恢复脚本时拒绝浏览器伪造的证据凭证", async () => {
  await withFixture(async fixture => {
    const response = await verifyEvidence(request({
      activeIPId: "ip-shuimuran",
      content,
      ...fixture,
      generationEvidenceProof: "forged-browser-proof",
    }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "GENERATION_EVIDENCE_MISMATCH");
  });
});

test("恢复脚本时拒绝不属于当前正文或当前审计版本的证据", async () => {
  await withFixture(async fixture => {
    const wrongContentResponse = await verifyEvidence(request({
      activeIPId: "ip-shuimuran",
      content: {
        ...content,
        outline: [{ ...content.outline[0], content: "浏览器替换后的正文。" }],
      },
      ...fixture,
    }));
    assert.equal(wrongContentResponse.status, 409);
    assert.equal((await wrongContentResponse.json()).code, "GENERATION_EVIDENCE_MISMATCH");

    const newerContent = {
      ...content,
      outline: [{ ...content.outline[0], content: "服务端会话已经更新后的正文。" }],
    };
    const newerAuditVersion = createHash("sha256").update(JSON.stringify({
      content: newerContent,
      sources: [],
      caseEvidence: null,
      nonEvidenceReferences: [],
    })).digest("hex");
    await createScriptAuditSession({
      auditSessionId: fixture.auditSessionId,
      auditVersion: newerAuditVersion,
      generationEvidenceDigest: digestScriptGenerationEvidenceProof(fixture.generationEvidenceProof),
      factAudit: {
        overallStatus: "not_checked",
        systemVerified: false,
        pendingItems: [],
        caseEvidence: null,
      },
      sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
      deliveryGate: {
        status: "OPEN",
        auditVersion: newerAuditVersion,
        blockerCodes: [],
        pendingItemIds: [],
      },
    });
    const staleVersionResponse = await verifyEvidence(request({
      activeIPId: "ip-shuimuran",
      content,
      ...fixture,
      auditVersion: fixture.auditVersion,
    }));
    assert.equal(staleVersionResponse.status, 409);
    assert.equal((await staleVersionResponse.json()).code, "STALE_AUDIT_VERSION");
  });
});
