import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    acknowledgement: proposalId === "emotional-coercion-v2"
      ? "我已逐字核对并确认启用"
      : "我已逐字核对并确认规则内容，检测范围待配置",
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

test("服务端固定提案库完整返回禁止越权发声规则且保持待确认、待配置状态", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-unauthorized-voice-proposal-"));
  const previousLedgerFile = process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
  process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = path.join(directory, "ledger.json");
  try {
    const response = await getGlobalConstraintProposals(new NextRequest(
      "http://localhost/api/global-content-constraint/proposals",
    ));
    const body = await response.json();
    const item = body.proposals.find((candidate: { proposal: { proposalId: string } }) => (
      candidate.proposal.proposalId === "unauthorized-ip-voice-v1"
    ));

    assert.equal(response.status, 200);
    assert.ok(item);
    assert.equal(item.confirmationStatus, "pending_confirmation");
    assert.equal(item.runtimeStatus, "detection_pending");
    assert.equal(item.proposal.title, "禁止越权代表IP主体发声");
    assert.equal(item.proposal.detectionTerms, null);
    assert.equal(item.proposal.activationMode, "confirmed_pending_detection");
    assert.deepEqual(item.proposal.judgmentStandards, [
      "第一条底线判断“这件事是否真实、有无依据”。",
      "本条底线判断“即使事情真实，系统是否有权代表IP公开说出或发送”。",
      "第一人称只是一种表达方式，不自动构成越权。依据已确权观点进行自然代笔属于允许范围。",
    ]);
    assert.equal(item.proposal.highRiskScenarios.length, 6);
    assert.match(item.proposal.canonicalText, /【核心判断】/);
    assert.match(item.proposal.canonicalText, /【判断标准】/);
    assert.match(item.proposal.canonicalText, /【适用范围】/);
    assert.match(item.proposal.canonicalText, /【必须逐次确认的高风险场景】/);
    assert.match(item.proposal.canonicalText, /【允许边界】/);
    assert.match(item.proposal.canonicalText, /【关键例子】/);
    assert.match(item.proposal.canonicalText, /“我下个月要涨价”/);
    assert.match(item.proposal.canonicalText, /决定权始终属于IP本人/);
  } finally {
    if (previousLedgerFile === undefined) delete process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
    else process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = previousLedgerFile;
    await rm(directory, { recursive: true, force: true });
  }
});

test("服务端固定提案库完整返回禁止静默修改规则及两层保护范围", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-confirmed-core-integrity-proposal-"));
  const previousLedgerFile = process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
  process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = path.join(directory, "ledger.json");
  try {
    const response = await getGlobalConstraintProposals(new NextRequest(
      "http://localhost/api/global-content-constraint/proposals",
    ));
    const body = await response.json();
    const item = body.proposals.find((candidate: { proposal: { proposalId: string } }) => (
      candidate.proposal.proposalId === "confirmed-core-integrity-v1"
    ));

    assert.equal(response.status, 200);
    assert.ok(item);
    assert.equal(item.confirmationStatus, "pending_confirmation");
    assert.equal(item.runtimeStatus, "detection_pending");
    assert.equal(item.proposal.title, "禁止静默修改已确权的核心逻辑");
    assert.equal(item.proposal.detectionTerms, null);
    assert.equal(item.proposal.activationMode, "confirmed_pending_detection");
    assert.deepEqual(item.proposal.protectedConfirmedAssets, [
      "所有IP通用底线。",
      "IP专属规则。",
      "已确认的观点、事实、判断和认知节点。",
      "与上述内容绑定的原始来源、版本和人工确认凭证。",
    ]);
    assert.deepEqual(item.proposal.protectedFormalRecords, [
      "已发布或已保存为终稿的脚本、文案和正式回复不得被静默覆盖。",
      "后续修改应形成新版本并保留历史记录。",
      "尚未保存或发布的普通草稿可以自由编辑，不要求每次修改都走正式确认。",
    ]);
    assert.match(item.proposal.canonicalText, /【核心判断】/);
    assert.match(item.proposal.canonicalText, /【第一层保护：核心确权资产】/);
    assert.match(item.proposal.canonicalText, /【第二层保护：正式内容记录】/);
    assert.match(item.proposal.canonicalText, /【典型禁止场景】/);
    assert.match(item.proposal.canonicalText, /【允许边界】/);
    assert.match(item.proposal.canonicalText, /修改规则正文后继续沿用原来的确认凭证/);
    assert.match(item.proposal.canonicalText, /系统格式升级可以执行，但必须能够证明升级前后正文、规则含义和确认关系没有改变/);
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

test("确认禁止越权发声规则时追加第三条登记且前两条记录保持不变", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-constraint-third-append-"));
  const previousLedgerFile = process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
  const ledgerFile = path.join(directory, "ledger.json");
  process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = ledgerFile;
  try {
    assert.equal((await confirmProposal("emotional-coercion-v2", "existing-emotional-rule")).status, 200);
    assert.equal((await confirmProposal("untraceable-facts-v1", "existing-untraceable-rule")).status, 200);

    const before = await readFile(ledgerFile, "utf8");
    const response = await confirmProposal("unauthorized-ip-voice-v1", "confirm-unauthorized-ip-voice");
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.confirmationStatus, "confirmed_pending_detection");
    assert.equal(body.runtimeStatus, "detection_pending");
    assert.equal(body.rule, null);
    assert.equal(body.proposal.proposalId, "unauthorized-ip-voice-v1");
    assert.match(body.proposal.canonicalText, /“我下个月要涨价”/);

    const beforeLedger = JSON.parse(before) as { records: unknown[] };
    const afterLedger = JSON.parse(await readFile(ledgerFile, "utf8")) as {
      schemaVersion: number;
      records: Array<{
        recordType: string;
        proposalId: string;
        proposal?: { detectionTerms: null };
      }>;
    };
    assert.equal(afterLedger.schemaVersion, 2);
    assert.equal(afterLedger.records.length, 3);
    assert.deepEqual(afterLedger.records.slice(0, 2), beforeLedger.records);
    const added = afterLedger.records[2];
    assert.equal(added?.recordType, "confirmed_proposal");
    assert.equal(added?.proposalId, "unauthorized-ip-voice-v1");
    assert.equal(added?.proposal?.detectionTerms, null);
  } finally {
    if (previousLedgerFile === undefined) delete process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
    else process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = previousLedgerFile;
    await rm(directory, { recursive: true, force: true });
  }
});

test("确认禁止静默修改规则时只追加第四条且前三条记录逐字不变", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-constraint-fourth-append-"));
  const previousLedgerFile = process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
  const ledgerFile = path.join(directory, "ledger.json");
  process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = ledgerFile;
  try {
    assert.equal((await confirmProposal("emotional-coercion-v2", "existing-emotional-rule")).status, 200);
    assert.equal((await confirmProposal("untraceable-facts-v1", "existing-untraceable-rule")).status, 200);
    assert.equal((await confirmProposal("unauthorized-ip-voice-v1", "existing-unauthorized-rule")).status, 200);

    const before = JSON.parse(await readFile(ledgerFile, "utf8")) as { records: unknown[] };
    const response = await confirmProposal("confirmed-core-integrity-v1", "confirm-core-integrity");
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.confirmationStatus, "confirmed_pending_detection");
    assert.equal(body.runtimeStatus, "detection_pending");
    assert.equal(body.rule, null);
    assert.equal(body.proposal.proposalId, "confirmed-core-integrity-v1");
    assert.match(body.proposal.canonicalText, /【第一层保护：核心确权资产】/);
    assert.match(body.proposal.canonicalText, /【第二层保护：正式内容记录】/);

    const after = JSON.parse(await readFile(ledgerFile, "utf8")) as {
      schemaVersion: number;
      records: Array<{
        recordType: string;
        proposalId: string;
        proposal?: { proposalId: string; detectionTerms: null };
      }>;
    };
    assert.equal(after.schemaVersion, 2);
    assert.equal(after.records.length, 4);
    assert.deepEqual(after.records.slice(0, 3), before.records);
    assert.equal(after.records[3]?.recordType, "confirmed_proposal");
    assert.equal(after.records[3]?.proposalId, "confirmed-core-integrity-v1");
    assert.equal(after.records[3]?.proposal?.proposalId, "confirmed-core-integrity-v1");
    assert.equal(after.records[3]?.proposal?.detectionTerms, null);
  } finally {
    if (previousLedgerFile === undefined) delete process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
    else process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = previousLedgerFile;
    await rm(directory, { recursive: true, force: true });
  }
});

test("第四条规则确认后若自身正文被静默篡改则整个服务端账本拒绝读取", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-constraint-self-protection-"));
  const previousLedgerFile = process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
  const ledgerFile = path.join(directory, "ledger.json");
  process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = ledgerFile;
  try {
    assert.equal((await confirmProposal("confirmed-core-integrity-v1", "confirm-self-protection")).status, 200);
    const ledger = JSON.parse(await readFile(ledgerFile, "utf8")) as {
      records: Array<{ proposal?: { canonicalText?: string } }>;
    };
    assert.ok(ledger.records[0]?.proposal?.canonicalText);
    ledger.records[0]!.proposal!.canonicalText = "被静默篡改的规则正文";
    await writeFile(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

    const response = await getGlobalConstraintProposals(new NextRequest(
      "http://localhost/api/global-content-constraint/proposals",
    ));
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.code, "LEDGER_CORRUPTED");
  } finally {
    if (previousLedgerFile === undefined) delete process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
    else process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = previousLedgerFile;
    await rm(directory, { recursive: true, force: true });
  }
});
