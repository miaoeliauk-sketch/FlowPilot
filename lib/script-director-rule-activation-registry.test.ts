import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  activateScriptDirectorRuleOnServer,
  deactivateScriptDirectorRuleOnServer,
  getActiveScriptDirectorRuleOnServer,
  setScriptDirectorRuleActivationStorePathForTests,
} from "./script-director-rule-activation-registry";

test("规则停用后服务端立即撤销当前启用状态", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flowpilot-director-activation-"));
  setScriptDirectorRuleActivationStorePathForTests(path.join(directory, "active.json"));
  try {
    const active = activateScriptDirectorRuleOnServer({
      ipId: "ip-a",
      ruleId: "rule-a",
      contentHash: "a".repeat(64),
    });
    assert.equal(getActiveScriptDirectorRuleOnServer("ip-a")?.activationId, active.activationId);

    deactivateScriptDirectorRuleOnServer("ip-a", "rule-a", active.activationId);

    assert.equal(getActiveScriptDirectorRuleOnServer("ip-a"), null);
  } finally {
    setScriptDirectorRuleActivationStorePathForTests(null);
    await rm(directory, { recursive: true, force: true });
  }
});

test("同一IP重新启用规则时生成新版本并让旧版本失效", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flowpilot-director-activation-"));
  setScriptDirectorRuleActivationStorePathForTests(path.join(directory, "active.json"));
  try {
    const first = activateScriptDirectorRuleOnServer({
      ipId: "ip-a",
      ruleId: "rule-a",
      contentHash: "a".repeat(64),
    });
    const second = activateScriptDirectorRuleOnServer({
      ipId: "ip-a",
      ruleId: "rule-a",
      contentHash: "a".repeat(64),
    });

    assert.notEqual(second.activationId, first.activationId);
    assert.equal(getActiveScriptDirectorRuleOnServer("ip-a")?.activationId, second.activationId);
  } finally {
    setScriptDirectorRuleActivationStorePathForTests(null);
    await rm(directory, { recursive: true, force: true });
  }
});
