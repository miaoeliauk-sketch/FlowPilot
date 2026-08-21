import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST } from "../app/api/script-director-rule/deactivate/route";
import {
  activateScriptDirectorRuleOnServer,
  getActiveScriptDirectorRuleOnServer,
  setScriptDirectorRuleActivationStorePathForTests,
} from "./script-director-rule-activation-registry";
import { createScriptDirectorRuleActivationProof } from "./script-director-rule-proof";

const SECRET = "test-only-script-director-proof-secret-32-bytes";

test("停用接口撤销服务端启用记录使旧凭证失去对应版本", async () => {
  process.env.FLOWPILOT_SCRIPT_DIRECTOR_PROOF_SECRET = SECRET;
  const directory = await mkdtemp(path.join(os.tmpdir(), "flowpilot-director-deactivate-route-"));
  setScriptDirectorRuleActivationStorePathForTests(path.join(directory, "active.json"));
  try {
    const active = activateScriptDirectorRuleOnServer({
      ipId: "ip-a",
      ruleId: "rule-a",
      contentHash: "a".repeat(64),
    });
    const activationProof = createScriptDirectorRuleActivationProof({
      ipId: active.ipId,
      ruleId: active.ruleId,
      contentHash: active.contentHash,
      activationId: active.activationId,
    }, SECRET);
    const response = await POST(new NextRequest("http://localhost/api/script-director-rule/deactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ipId: "ip-a", ruleId: "rule-a", activationProof }),
    }));

    assert.equal(response.status, 200);
    assert.equal(getActiveScriptDirectorRuleOnServer("ip-a"), null);
  } finally {
    setScriptDirectorRuleActivationStorePathForTests(null);
    await rm(directory, { recursive: true, force: true });
  }
});

test("停用接口拒绝伪造凭证并保留当前启用记录", async () => {
  process.env.FLOWPILOT_SCRIPT_DIRECTOR_PROOF_SECRET = SECRET;
  const directory = await mkdtemp(path.join(os.tmpdir(), "flowpilot-director-deactivate-route-"));
  setScriptDirectorRuleActivationStorePathForTests(path.join(directory, "active.json"));
  try {
    const active = activateScriptDirectorRuleOnServer({
      ipId: "ip-a",
      ruleId: "rule-a",
      contentHash: "a".repeat(64),
    });
    const response = await POST(new NextRequest("http://localhost/api/script-director-rule/deactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ipId: "ip-a", ruleId: "rule-a", activationProof: "forged" }),
    }));

    assert.equal(response.status, 400);
    assert.equal(getActiveScriptDirectorRuleOnServer("ip-a")?.activationId, active.activationId);
  } finally {
    setScriptDirectorRuleActivationStorePathForTests(null);
    await rm(directory, { recursive: true, force: true });
  }
});
