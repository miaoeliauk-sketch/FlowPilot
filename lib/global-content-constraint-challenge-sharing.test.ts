import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import { issueGlobalConstraintChallenge } from "./global-content-constraint-server";

const execFileAsync = promisify(execFile);

test("申请与确认由不同路由模块实例处理时仍共享同一枚一次性挑战", async () => {
  const script = `
    import { mkdtemp, rm } from "node:fs/promises";
    import { tmpdir } from "node:os";
    import path from "node:path";
    const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-shared-challenge-"));
    process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = path.join(directory, "ledger.json");
    try {
      const issuer = await import(\`./lib/global-content-constraint-server.ts?issuer=\${Date.now()}\`);
      const confirmer = await import(\`./lib/global-content-constraint-server.ts?confirmer=\${Date.now()}\`);
      const issued = issuer.issueGlobalConstraintChallenge("untraceable-facts-v1");
      const record = await confirmer.confirmGlobalConstraintOnServer({
        proposalId: "untraceable-facts-v1",
        challengeId: issued.challengeId,
        challenge: issued.challenge,
        idempotencyKey: "shared-module-challenge-test",
        confirmedBy: "彭彭",
        acknowledgement: "我已逐字核对并确认规则内容，检测范围待配置",
      });
      process.stdout.write(JSON.stringify({ recordType: record.recordType, proposalId: record.proposalId }));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  `;

  const { stdout } = await execFileAsync(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "-e",
    script,
  ], { cwd: process.cwd() });

  assert.deepEqual(JSON.parse(stdout), {
    recordType: "confirmed_proposal",
    proposalId: "untraceable-facts-v1",
  });
});

test("所有规则的一次性挑战统一提供至少五分钟有效期", () => {
  const issuedAt = Date.now();
  const emotional = issueGlobalConstraintChallenge("emotional-coercion-v2");
  const facts = issueGlobalConstraintChallenge("untraceable-facts-v1");
  const minimumExpiry = issuedAt + 5 * 60 * 1000;

  assert.ok(Date.parse(emotional.expiresAt) >= minimumExpiry);
  assert.ok(Date.parse(facts.expiresAt) >= minimumExpiry);
});
