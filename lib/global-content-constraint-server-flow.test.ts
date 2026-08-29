import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as issueGlobalConstraintChallenge } from "../app/api/global-content-constraint/challenge/route";
import * as globalConstraintStatusRoute from "../app/api/global-content-constraint/route";
import { POST as confirmGlobalConstraint } from "../app/api/global-content-constraint/confirm/route";

const getGlobalConstraintStatus = globalConstraintStatusRoute.GET;

function confirmationRequest(body: unknown) {
  return new NextRequest("http://localhost/api/global-content-constraint/confirm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

function challengeRequest() {
  return new NextRequest("http://localhost/api/global-content-constraint/challenge", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
    },
    body: JSON.stringify({ proposalId: "emotional-coercion-v2" }),
  });
}

test("字段全部正确但没有服务端一次性挑战时拒绝启用规则", async () => {
  const response = await confirmGlobalConstraint(confirmationRequest({
    proposalId: "emotional-coercion-v2",
    confirmedBy: "彭彭",
    acknowledgement: "我已逐字核对并确认启用",
  }));
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.code, "INVALID_CONFIRMATION_CHALLENGE");
  assert.equal(body.rule, undefined);
});

test("规则状态接口强制动态读取服务端账本而不是固化构建时状态", () => {
  assert.equal(globalConstraintStatusRoute.dynamic, "force-dynamic");
});

test("跨站页面不能申请或提交人工确认挑战", async () => {
  const forgedChallenge = new NextRequest("http://localhost/api/global-content-constraint/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
    body: JSON.stringify({ proposalId: "emotional-coercion-v2" }),
  });
  const challengeResponse = await issueGlobalConstraintChallenge(forgedChallenge);
  const challengeBody = await challengeResponse.json();
  assert.equal(challengeResponse.status, 403);
  assert.equal(challengeBody.code, "INVALID_REQUEST_ORIGIN");

  const forgedConfirmation = new NextRequest("http://localhost/api/global-content-constraint/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
    body: JSON.stringify({
      proposalId: "emotional-coercion-v2",
      challengeId: "forged",
      challenge: "forged",
      idempotencyKey: "forged",
      confirmedBy: "彭彭",
      acknowledgement: "我已逐字核对并确认启用",
    }),
  });
  const confirmResponse = await confirmGlobalConstraint(forgedConfirmation);
  const confirmBody = await confirmResponse.json();
  assert.equal(confirmResponse.status, 403);
  assert.equal(confirmBody.code, "INVALID_REQUEST_ORIGIN");
});

test("服务端挑战完成后只在服务端账本创建固定规则并可严格回读", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-constraint-ledger-"));
  const previousLedgerFile = process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
  process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = path.join(directory, "ledger.json");
  try {
    const challengeResponse = await issueGlobalConstraintChallenge(challengeRequest());
    const issued = await challengeResponse.json();
    assert.equal(challengeResponse.status, 200);

    const response = await confirmGlobalConstraint(confirmationRequest({
      proposalId: "emotional-coercion-v2",
      challengeId: issued.challengeId,
      challenge: issued.challenge,
      idempotencyKey: "test-confirmation-request-001",
      confirmedBy: "彭彭",
      acknowledgement: "我已逐字核对并确认启用",
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.rule.status, "active");
    assert.equal(body.rule.scope, "all_ips");
    assert.equal(body.rule.canonicalText, [
      "判断对象是表达动机，不是具体词汇。",
      "允许反差、悬念和适度焦虑。",
      "禁止利用受众的无力感进行情绪操纵，迫使其被动接受或行动。",
    ].join("\n"));
    assert.deepEqual(body.sourceFacts, {
      sourceType: "user_confirmed",
      confirmedBy: "彭彭",
      intakeChannel: "manual_confirmation_ui",
      sourceYear: 2026,
      sourceDate: null,
      dateStatus: "pending_exact_date",
    });

    const statusResponse = await getGlobalConstraintStatus(new NextRequest(
      "http://localhost/api/global-content-constraint",
    ));
    const status = await statusResponse.json();
    assert.equal(status.active, true);
    assert.equal(status.rule.ruleId, body.rule.ruleId);
    assert.equal(status.rule.canonicalText, body.rule.canonicalText);
  } finally {
    if (previousLedgerFile === undefined) delete process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
    else process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = previousLedgerFile;
    await rm(directory, { recursive: true, force: true });
  }
});

test("服务端账本正文被本地改写后必须拒绝加载而不是继续执行", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-constraint-ledger-"));
  const previousLedgerFile = process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
  const ledgerFile = path.join(directory, "ledger.json");
  process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = ledgerFile;
  try {
    const issued = await (await issueGlobalConstraintChallenge(challengeRequest())).json();
    const confirmed = await confirmGlobalConstraint(confirmationRequest({
      proposalId: "emotional-coercion-v2",
      challengeId: issued.challengeId,
      challenge: issued.challenge,
      idempotencyKey: "test-ledger-tamper-001",
      confirmedBy: "彭彭",
      acknowledgement: "我已逐字核对并确认启用",
    }));
    assert.equal(confirmed.status, 200);

    const ledger = JSON.parse(await readFile(ledgerFile, "utf8")) as {
      records: Array<{ rule: { canonicalText: string; sourceSnapshot: { contentHash: string } } }>;
    };
    ledger.records[0].rule.canonicalText = "被本地改写的规则正文";
    ledger.records[0].rule.sourceSnapshot.contentHash = "b".repeat(64);
    await writeFile(ledgerFile, JSON.stringify(ledger), "utf8");

    const response = await getGlobalConstraintStatus(new NextRequest(
      "http://localhost/api/global-content-constraint",
    ));
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.code, "LEDGER_CORRUPTED");
    assert.equal(body.rule, undefined);
  } finally {
    if (previousLedgerFile === undefined) delete process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
    else process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = previousLedgerFile;
    await rm(directory, { recursive: true, force: true });
  }
});

test("合法挑战也不能夹带或修改服务端固定的规则正文", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-constraint-ledger-"));
  const previousLedgerFile = process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
  process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = path.join(directory, "ledger.json");
  try {
    const challengeResponse = await issueGlobalConstraintChallenge(challengeRequest());
    const issued = await challengeResponse.json();
    const response = await confirmGlobalConstraint(confirmationRequest({
      proposalId: "emotional-coercion-v2",
      challengeId: issued.challengeId,
      challenge: issued.challenge,
      idempotencyKey: "test-forged-content-001",
      confirmedBy: "彭彭",
      acknowledgement: "我已逐字核对并确认启用",
      canonicalText: "浏览器试图替换规则正文",
    }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_CONFIRMATION_REQUEST");
    const status = await (await getGlobalConstraintStatus(new NextRequest(
      "http://localhost/api/global-content-constraint",
    ))).json();
    assert.equal(status.active, false);
    assert.equal(status.rule, null);
  } finally {
    if (previousLedgerFile === undefined) delete process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
    else process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = previousLedgerFile;
    await rm(directory, { recursive: true, force: true });
  }
});

test("重复提交保持幂等且一次性挑战不能换请求编号重放", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-constraint-ledger-"));
  const previousLedgerFile = process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
  process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = path.join(directory, "ledger.json");
  try {
    const issued = await (await issueGlobalConstraintChallenge(challengeRequest())).json();
    const body = {
      proposalId: "emotional-coercion-v2",
      challengeId: issued.challengeId,
      challenge: issued.challenge,
      idempotencyKey: "test-idempotent-confirmation-001",
      confirmedBy: "彭彭",
      acknowledgement: "我已逐字核对并确认启用",
    };
    const first = await confirmGlobalConstraint(confirmationRequest(body));
    const firstBody = await first.json();
    const repeated = await confirmGlobalConstraint(confirmationRequest(body));
    const repeatedBody = await repeated.json();

    assert.equal(first.status, 200);
    assert.equal(repeated.status, 200);
    assert.equal(repeatedBody.rule.ruleId, firstBody.rule.ruleId);
    assert.equal(repeatedBody.rule.humanConfirmation.confirmedAt, firstBody.rule.humanConfirmation.confirmedAt);

    const replay = await confirmGlobalConstraint(confirmationRequest({
      ...body,
      idempotencyKey: "test-replay-with-different-key-002",
    }));
    const replayBody = await replay.json();
    assert.equal(replay.status, 403);
    assert.equal(replayBody.code, "INVALID_CONFIRMATION_CHALLENGE");
  } finally {
    if (previousLedgerFile === undefined) delete process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
    else process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = previousLedgerFile;
    await rm(directory, { recursive: true, force: true });
  }
});

test("服务端账本写入失败不得假成功且同一挑战可以安全重试", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-constraint-ledger-"));
  const previousLedgerFile = process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
  const unwritableDirectory = path.join(directory, "read-only");
  await mkdir(unwritableDirectory);
  await chmod(unwritableDirectory, 0o500);
  process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = path.join(unwritableDirectory, "ledger.json");
  try {
    const issued = await (await issueGlobalConstraintChallenge(challengeRequest())).json();
    const body = {
      proposalId: "emotional-coercion-v2",
      challengeId: issued.challengeId,
      challenge: issued.challenge,
      idempotencyKey: "test-write-failure-retry-001",
      confirmedBy: "彭彭",
      acknowledgement: "我已逐字核对并确认启用",
    };
    const failed = await confirmGlobalConstraint(confirmationRequest(body));
    const failedBody = await failed.json();
    assert.equal(failed.status, 500);
    assert.equal(failedBody.code, "LEDGER_WRITE_FAILED");
    assert.equal(failedBody.rule, undefined);

    process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = path.join(directory, "ledger.json");
    const retried = await confirmGlobalConstraint(confirmationRequest(body));
    const retriedBody = await retried.json();
    assert.equal(retried.status, 200);
    assert.equal(retriedBody.rule.status, "active");
  } finally {
    await chmod(unwritableDirectory, 0o700);
    if (previousLedgerFile === undefined) delete process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
    else process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = previousLedgerFile;
    await rm(directory, { recursive: true, force: true });
  }
});
