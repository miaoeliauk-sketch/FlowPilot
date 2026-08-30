import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET as getGlobalConstraintProposals } from "../app/api/global-content-constraint/proposals/route";
import { POST as issueGlobalConstraintChallenge } from "../app/api/global-content-constraint/challenge/route";
import { POST as confirmGlobalConstraint } from "../app/api/global-content-constraint/confirm/route";

function challengeRequest(proposalId: string) {
  return new NextRequest("http://localhost/api/global-content-constraint/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify({ proposalId }),
  });
}

function confirmationRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/global-content-constraint/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

async function confirmProposal(proposalId: string, idempotencyKey: string) {
  const issuedResponse = await issueGlobalConstraintChallenge(challengeRequest(proposalId));
  const issued = await issuedResponse.json();
  assert.equal(issuedResponse.status, 200);
  return confirmGlobalConstraint(confirmationRequest({
    proposalId,
    challengeId: issued.challengeId,
    challenge: issued.challenge,
    idempotencyKey,
    confirmedBy: "彭彭",
    acknowledgement: proposalId === "untraceable-facts-v1"
      ? "我已逐字核对并确认规则内容，检测范围待配置"
      : "我已逐字核对并确认启用",
  }));
}

test("服务端固定提案库完整返回不可溯源事实规则且浏览器只能读取待确认状态", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-constraint-proposals-"));
  const previousLedgerFile = process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
  process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = path.join(directory, "ledger.json");
  try {
    const response = await getGlobalConstraintProposals(new NextRequest(
      "http://localhost/api/global-content-constraint/proposals",
    ));
    const body = await response.json();
    const item = body.proposals.find((candidate: { proposal: { proposalId: string } }) => (
      candidate.proposal.proposalId === "untraceable-facts-v1"
    ));

    assert.equal(response.status, 200);
    assert.ok(item);
    assert.equal(item.confirmationStatus, "pending_confirmation");
    assert.equal(item.runtimeStatus, "detection_pending");
    assert.equal(item.proposal.title, "禁止编造不可溯源的事实");
    assert.equal(item.proposal.runtimePositioning, "高风险事实召回＋人工核验来源");
    assert.equal(item.proposal.detectionTerms, null);
    assert.deepEqual(item.proposal.priorityRedlines, [
      "IP本人经历",
      "客户案例",
      "业绩数据",
      "权威引语",
    ]);
    assert.match(item.proposal.canonicalText, /【核心判断】/);
    assert.match(item.proposal.canonicalText, /【可溯源标准】/);
    assert.match(item.proposal.canonicalText, /【适用范围】/);
    assert.match(item.proposal.canonicalText, /【四项最高优先级红线】/);
    assert.match(item.proposal.canonicalText, /【典型禁止场景】/);
    assert.match(item.proposal.canonicalText, /【允许边界】/);
    assert.match(item.proposal.canonicalText, /精确数据、直接引语以及医疗、金融等高风险领域的结论，需要额外对外标明来源/);
    assert.match(item.proposal.canonicalText, /文学创作可以虚构，但不得冒充真实报道、真实案例或IP亲历/);
  } finally {
    if (previousLedgerFile === undefined) delete process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
    else process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = previousLedgerFile;
    await rm(directory, { recursive: true, force: true });
  }
});

test("确认不可溯源事实规则时追加登记并完整保留已生效的禁止情绪绑架规则", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-constraint-append-"));
  const previousLedgerFile = process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
  const ledgerFile = path.join(directory, "ledger.json");
  process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = ledgerFile;
  try {
    const existingResponse = await confirmProposal("emotional-coercion-v2", "existing-emotional-rule");
    const existingBody = await existingResponse.json();
    assert.equal(existingResponse.status, 200);
    assert.equal(existingBody.rule.status, "active");

    const response = await confirmProposal("untraceable-facts-v1", "confirm-untraceable-facts");
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.confirmationStatus, "confirmed_pending_detection");
    assert.equal(body.runtimeStatus, "detection_pending");
    assert.equal(body.rule, null);
    assert.equal(body.proposal.proposalId, "untraceable-facts-v1");
    assert.match(body.proposal.canonicalText, /【四项最高优先级红线】/);

    const ledger = JSON.parse(await readFile(ledgerFile, "utf8")) as {
      schemaVersion: number;
      records: Array<{
        recordType: string;
        proposalId: string;
        rule?: { ruleId: string; status: string; canonicalText: string };
        proposal?: { proposalId: string; canonicalText: string; detectionTerms: null };
      }>;
    };
    assert.equal(ledger.schemaVersion, 2);
    assert.equal(ledger.records.length, 2);
    const existing = ledger.records.find(record => record.proposalId === "emotional-coercion-v2");
    const added = ledger.records.find(record => record.proposalId === "untraceable-facts-v1");
    assert.equal(existing?.recordType, "active_rule");
    assert.equal(existing?.rule?.status, "active");
    assert.match(existing?.rule?.canonicalText ?? "", /判断对象是表达动机/);
    assert.equal(added?.recordType, "confirmed_proposal");
    assert.equal(added?.proposal?.proposalId, "untraceable-facts-v1");
    assert.equal(added?.proposal?.detectionTerms, null);

    const statusResponse = await getGlobalConstraintProposals(new NextRequest(
      "http://localhost/api/global-content-constraint/proposals",
    ));
    const statusBody = await statusResponse.json();
    const existingStatus = statusBody.proposals.find((item: { proposal: { proposalId: string } }) => (
      item.proposal.proposalId === "emotional-coercion-v2"
    ));
    const addedStatus = statusBody.proposals.find((item: { proposal: { proposalId: string } }) => (
      item.proposal.proposalId === "untraceable-facts-v1"
    ));
    assert.equal(existingStatus.confirmationStatus, "active");
    assert.equal(existingStatus.runtimeStatus, "active");
    assert.equal(addedStatus.confirmationStatus, "confirmed_pending_detection");
    assert.equal(addedStatus.runtimeStatus, "detection_pending");
  } finally {
    if (previousLedgerFile === undefined) delete process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
    else process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = previousLedgerFile;
    await rm(directory, { recursive: true, force: true });
  }
});
