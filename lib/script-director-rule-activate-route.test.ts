import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST } from "../app/api/script-director-rule/activate/route";
import {
  createScriptDirectorRule,
  type CreateScriptDirectorRuleInput,
  type ScriptDirectorRuleTestType,
} from "./script-director-rule";
import {
  createScriptDirectorRuleTestProof,
  verifyScriptDirectorRuleActivationProof,
} from "./script-director-rule-proof";
import {
  getActiveScriptDirectorRuleOnServer,
  setScriptDirectorRuleActivationStorePathForTests,
} from "./script-director-rule-activation-registry";
import { buildMigratedShuimuranDirectorRule } from "./shuimuran-director-rule-migration";

const SECRET = "test-only-script-director-proof-secret-32-bytes";
let registryDirectory = "";

test.before(async () => {
  registryDirectory = await mkdtemp(path.join(os.tmpdir(), "flowpilot-director-activate-route-"));
  setScriptDirectorRuleActivationStorePathForTests(path.join(registryDirectory, "active.json"));
});

test.after(async () => {
  setScriptDirectorRuleActivationStorePathForTests(null);
  await rm(registryDirectory, { recursive: true, force: true });
});

function input(): CreateScriptDirectorRuleInput {
  return {
    ipId: "ip-pengpeng",
    name: "彭彭说AI规则",
    version: "1.0.0",
    rawMarkdown: "# 彭彭说AI规则\n\n开头直接给判断。",
    fileName: "rule.md",
    importedAt: "2026-08-21T10:00:00.000Z",
    profileContext: { ipNameSnapshot: "彭彭说AI", source: "ip_profile", usePlatformPositioningFromProfile: true },
    targetAudience: [],
    language: { catchphrases: [], forbiddenExpressions: [], toneGuidelines: [] },
    opening: { requirements: [], forbiddenPatterns: [] },
    body: {
      reasoningSequence: [],
      casePolicy: { maximumCasesPerClaim: null, level: "preference", enforcement: "prompt_only", scope: "body", requirements: [] },
      materialPolicies: [],
    },
    ending: { requirements: [], forbiddenPatterns: [] },
    examples: [],
    compression: { enabled: false, targetReduction: null, mustKeep: [], preferRemove: [], otherRequirements: [] },
    specialRules: [],
    validationRequirements: [],
  };
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/script-director-rule/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("服务端核实三类测试凭证后才签发启用凭证", async () => {
  process.env.FLOWPILOT_SCRIPT_DIRECTOR_PROOF_SECRET = SECRET;
  const rule = await createScriptDirectorRule(input());
  const testTypes: ScriptDirectorRuleTestType[] = ["familiar", "unfamiliar", "stress"];
  rule.testValidation = {
    completedAt: "2026-08-21T12:00:00.000Z",
    testTypes,
    proofs: Object.fromEntries(testTypes.map(testType => [
      testType,
      createScriptDirectorRuleTestProof({
        ipId: rule.ipId,
        ruleId: rule.id,
        contentHash: rule.source.contentHash,
        testType,
      }, SECRET),
    ])) as Record<ScriptDirectorRuleTestType, string>,
  };

  const response = await POST(request({ ipId: rule.ipId, rule }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(typeof body.activationProof, "string");
  const active = getActiveScriptDirectorRuleOnServer(rule.ipId);
  assert.equal(active?.ruleId, rule.id);
  assert.equal(verifyScriptDirectorRuleActivationProof(body.activationProof, {
    ipId: rule.ipId,
    ruleId: rule.id,
    contentHash: rule.source.contentHash,
    activationId: active?.activationId ?? "",
  }, SECRET), true);
});

test("服务端拒绝前端伪造的三类测试凭证且不签发启用凭证", async () => {
  process.env.FLOWPILOT_SCRIPT_DIRECTOR_PROOF_SECRET = SECRET;
  const rule = await createScriptDirectorRule(input());
  rule.testValidation = {
    completedAt: "2026-08-21T12:00:00.000Z",
    testTypes: ["familiar", "unfamiliar", "stress"],
    proofs: { familiar: "forged", unfamiliar: "forged", stress: "forged" },
  };

  const response = await POST(request({ ipId: rule.ipId, rule }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /测试凭证无效/);
  assert.equal(body.activationProof, undefined);
});

test("水木然迁移规则也必须完成三类测试并由服务端签发启用凭证", async () => {
  process.env.FLOWPILOT_SCRIPT_DIRECTOR_PROOF_SECRET = SECRET;
  const rule = buildMigratedShuimuranDirectorRule({
    ipId: "ip-shuimuran",
    ipName: "水木然",
    migratedAt: "2026-08-21T12:00:00.000Z",
  });
  const testTypes: ScriptDirectorRuleTestType[] = ["familiar", "unfamiliar", "stress"];
  rule.testValidation = {
    completedAt: "2026-08-21T12:30:00.000Z",
    testTypes,
    proofs: Object.fromEntries(testTypes.map(testType => [
      testType,
      createScriptDirectorRuleTestProof({
        ipId: rule.ipId,
        ruleId: rule.id,
        contentHash: rule.source.contentHash,
        testType,
      }, SECRET),
    ])) as Record<ScriptDirectorRuleTestType, string>,
  };

  const response = await POST(request({ ipId: rule.ipId, rule }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(typeof body.activationProof, "string");
  assert.equal(getActiveScriptDirectorRuleOnServer(rule.ipId)?.ruleId, rule.id);
});
