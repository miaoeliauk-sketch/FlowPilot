import assert from "node:assert/strict";
import test from "node:test";

import { createScriptDirectorRule } from "./script-director-rule";
import { detectScriptDirectorExampleContamination } from "./script-director-rule-contamination";

async function ruleWithEntities(rawMarkdown: string, protectedEntities: string[]) {
  return createScriptDirectorRule({
    ipId: "ip-test",
    name: "测试IP专属编导规则",
    version: "1.0.0",
    rawMarkdown,
    fileName: null,
    importedAt: "2026-08-21T12:00:00.000Z",
    profileContext: {
      ipNameSnapshot: "测试IP",
      source: "ip_profile",
      usePlatformPositioningFromProfile: true,
    },
    targetAudience: [],
    language: { catchphrases: [], forbiddenExpressions: [], toneGuidelines: [] },
    opening: { requirements: [], forbiddenPatterns: [] },
    body: {
      reasoningSequence: [],
      casePolicy: {
        maximumCasesPerClaim: null,
        level: "quality_warning",
        enforcement: "deterministic",
        scope: "body",
        requirements: [],
      },
      materialPolicies: [],
    },
    ending: { requirements: [], forbiddenPatterns: [] },
    examples: [{
      id: "example-1",
      kind: "body",
      content: "格式范例",
      demonstrates: "演示结构",
      sourceReference: "导入文档",
      confirmationStatus: "confirmed",
      materialPermission: false,
      protectedEntities,
    }],
    compression: { enabled: false, targetReduction: null, mustKeep: [], preferRemove: [], otherRequirements: [] },
    specialRules: [],
    validationRequirements: [],
  });
}

test("具体名称出现2至3次时逐项提醒但不阻止保存", async () => {
  const rule = await ruleWithEntities(
    "胖东来只用于标题示例。胖东来不属于本次素材。华为用于结构示例，华为不得复用，华为也不是默认案例。",
    ["胖东来", "华为", "胖东来"],
  );

  const result = detectScriptDirectorExampleContamination(rule);

  assert.equal(result.status, "warning");
  assert.deepEqual(result.items, [
    { name: "华为", count: 3, severity: "warning" },
    { name: "胖东来", count: 2, severity: "warning" },
  ]);
  assert.equal(result.canSave, true);
});

test("具体名称出现超过3次时硬性阻止保存并排除当前IP名称", async () => {
  const rule = await ruleWithEntities(
    "测试IP的规则。胖东来是示例。胖东来只演示标题。胖东来只演示开头。胖东来不得复用。",
    ["测试IP", "胖东来"],
  );

  const result = detectScriptDirectorExampleContamination(rule);

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.items, [{ name: "胖东来", count: 4, severity: "blocked" }]);
  assert.equal(result.canSave, false);
});

test("具体名称只出现1次时不产生污染提示", async () => {
  const rule = await ruleWithEntities("胖东来只用于唯一标题范例。", ["胖东来"]);

  assert.deepEqual(detectScriptDirectorExampleContamination(rule), {
    status: "clean",
    canSave: true,
    items: [],
  });
});
