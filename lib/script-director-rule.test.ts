import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateScriptDirectorRuleContentHash,
  createScriptDirectorRule,
  parseScriptDirectorRule,
  type CreateScriptDirectorRuleInput,
} from "./script-director-rule";
import {
  SCRIPT_DIRECTOR_RULE_STORAGE_KEY,
  getScriptDirectorRuleForIP,
  getScriptDirectorRules,
  saveScriptDirectorRule,
} from "./script-director-rule-store";
import { buildScriptDirectorBlock } from "./script-director-profile";
import { resolveScriptDirectorRuleForGeneration } from "./script-director-rule-resolver";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

function createValidInput(
  overrides: Partial<CreateScriptDirectorRuleInput> = {},
): CreateScriptDirectorRuleInput {
  return {
    ipId: "ip-pengpeng",
    name: "彭彭说AI专属编导规则",
    version: "1.0.0",
    rawMarkdown: "# 彭彭说AI专属编导规则\n\n禁止使用空泛开头。",
    fileName: "彭彭说AI专属编导规则.md",
    importedAt: "2026-08-21T10:00:00.000Z",
    profileContext: {
      ipNameSnapshot: "彭彭说AI",
      source: "ip_profile",
      usePlatformPositioningFromProfile: true,
    },
    targetAudience: ["希望使用AI提高效率的普通人"],
    language: {
      catchphrases: [],
      forbiddenExpressions: [{
        id: "forbidden-opening-1",
        text: "不能说“大家有没有发现一个很有意思的现象”",
        level: "quality_warning",
        enforcement: "deterministic",
        scope: "opening",
      }],
      toneGuidelines: [],
    },
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
    examples: [],
    compression: {
      enabled: false,
      targetReduction: null,
      mustKeep: [],
      preferRemove: [],
      otherRequirements: [],
    },
    specialRules: [],
    validationRequirements: [],
    ...overrides,
  };
}

test("通用编导规则契约保留原始Markdown、归属、版本和规则强度", async () => {
  const rule = await createScriptDirectorRule(createValidInput());

  assert.equal(rule.ipId, "ip-pengpeng");
  assert.equal(rule.version, "1.0.0");
  assert.equal(rule.status, "draft");
  assert.deepEqual(rule.profileContext, {
    ipNameSnapshot: "彭彭说AI",
    source: "ip_profile",
    usePlatformPositioningFromProfile: true,
  });
  assert.equal("platformPositioning" in rule.profileContext, false);
  assert.deepEqual(rule.targetAudience, ["希望使用AI提高效率的普通人"]);
  assert.equal(rule.source.rawMarkdown.includes("禁止使用空泛开头"), true);
  assert.match(rule.source.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(rule.language.forbiddenExpressions[0]?.level, "quality_warning");
  assert.equal(rule.language.forbiddenExpressions[0]?.enforcement, "deterministic");
});

test("通用编导规则契约拒绝无归属、非法版本和未知规则强度", async () => {
  await assert.rejects(
    createScriptDirectorRule(createValidInput({ ipId: "" })),
    /规则归属IP不能为空/,
  );
  await assert.rejects(
    createScriptDirectorRule(createValidInput({ version: "第一版" })),
    /规则版本格式无效/,
  );

  const valid = await createScriptDirectorRule(createValidInput());
  const tampered = structuredClone(valid) as unknown as Record<string, unknown>;
  const language = tampered.language as { forbiddenExpressions: Array<Record<string, unknown>> };
  language.forbiddenExpressions[0]!.level = "always_block_everything";

  assert.deepEqual(parseScriptDirectorRule(tampered), {
    ok: false,
    error: "专属编导规则内容损坏：language.forbiddenExpressions[0].level",
  });

  await assert.rejects(
    createScriptDirectorRule(createValidInput({
      compression: {
        enabled: true,
        targetReduction: {
          minimumPercent: 30,
          maximumPercent: 20,
          level: "quality_warning",
          enforcement: "deterministic",
          scope: "compression",
        },
        mustKeep: [],
        preferRemove: [],
        otherRequirements: [],
      },
    })),
    /compression.targetReduction/,
  );
});

test("规则库存储完整原文并严格按IP隔离读取", async () => {
  storage.clear();
  const ruleA = await createScriptDirectorRule(createValidInput());
  const ruleB = await createScriptDirectorRule(createValidInput({
    ipId: "ip-other",
    name: "其他IP专属规则",
    profileContext: {
      ipNameSnapshot: "其他IP",
      source: "ip_profile",
      usePlatformPositioningFromProfile: true,
    },
  }));

  saveScriptDirectorRule(ruleA);
  saveScriptDirectorRule(ruleB);

  assert.deepEqual(getScriptDirectorRules("ip-pengpeng").map(rule => rule.id), [ruleA.id]);
  assert.equal(getScriptDirectorRuleForIP("ip-pengpeng", ruleB.id), null);
  assert.equal(
    getScriptDirectorRuleForIP("ip-pengpeng", ruleA.id)?.source.rawMarkdown,
    ruleA.source.rawMarkdown,
  );
  assert.equal(
    getScriptDirectorRuleForIP("ip-pengpeng", ruleA.id)?.source.contentHash,
    ruleA.source.contentHash,
  );
});

test("规则库损坏时明确报错并阻止覆盖原始数据", async () => {
  storage.clear();
  const corrupted = "{不是合法JSON";
  storage.setItem(SCRIPT_DIRECTOR_RULE_STORAGE_KEY, corrupted);
  const rule = await createScriptDirectorRule(createValidInput());

  assert.throws(() => getScriptDirectorRules("ip-pengpeng"), /专属编导规则库数据损坏/);
  assert.throws(() => saveScriptDirectorRule(rule), /专属编导规则库数据损坏/);
  assert.equal(storage.getItem(SCRIPT_DIRECTOR_RULE_STORAGE_KEY), corrupted);
});

test("旧shuimuran-v1绑定通过兼容层保持完全相同的生成规则", () => {
  storage.clear();
  const resolved = resolveScriptDirectorRuleForGeneration({
    generationMode: "ip",
    ipId: "ip-shuimuran",
    ipName: "水木然",
    activeRuleId: null,
    legacyProfileId: "shuimuran-v1",
  });

  assert.equal(resolved.enabled, true);
  if (!resolved.enabled) return;
  assert.equal(resolved.ruleId, "shuimuran-v1");
  assert.equal(resolved.version, "1.0.0");
  assert.equal(resolved.source, "legacy_builtin");
  assert.equal(resolved.promptBlock, buildScriptDirectorBlock("shuimuran-v1"));
});

test("兼容层不会把水木然规则泄漏到固定生成、其他IP或旧空记录", () => {
  storage.clear();
  const cases = [
    {
      generationMode: "standard" as const,
      ipId: "ip-shuimuran",
      ipName: "水木然",
      activeRuleId: null,
      legacyProfileId: "shuimuran-v1" as const,
    },
    {
      generationMode: "ip" as const,
      ipId: "ip-other",
      ipName: "其他IP",
      activeRuleId: null,
      legacyProfileId: "shuimuran-v1" as const,
    },
    {
      generationMode: "ip" as const,
      ipId: "ip-old",
      ipName: "旧IP",
      activeRuleId: null,
      legacyProfileId: null,
    },
  ];

  for (const input of cases) {
    assert.deepEqual(resolveScriptDirectorRuleForGeneration(input), {
      enabled: false,
      reason: "no_applicable_rule",
    });
  }
});

test("生成规则解析会复核存储层返回的IP归属并拒绝跨IP规则", async () => {
  const otherIPRule = await createScriptDirectorRule(createValidInput({
    ipId: "ip-other",
    name: "其他IP专属规则",
    profileContext: {
      ipNameSnapshot: "其他IP",
      source: "ip_profile",
      usePlatformPositioningFromProfile: true,
    },
  }));

  const resolved = resolveScriptDirectorRuleForGeneration({
    generationMode: "ip",
    ipId: "ip-pengpeng",
    ipName: "彭彭说AI",
    activeRuleId: otherIPRule.id,
    legacyProfileId: null,
    repository: {
      getForIP: () => ({ ...otherIPRule, status: "active" }),
    },
  });

  assert.deepEqual(resolved, {
    enabled: false,
    reason: "rule_ip_mismatch",
  });
});

test("NaN压缩比例会在保存前被拒绝且不会改写原规则库", async () => {
  storage.clear();
  const valid = await createScriptDirectorRule(createValidInput());
  saveScriptDirectorRule(valid);
  const originalStorage = storage.getItem(SCRIPT_DIRECTOR_RULE_STORAGE_KEY);
  const invalid = {
    ...valid,
    compression: {
      ...valid.compression,
      enabled: true,
      targetReduction: {
        minimumPercent: Number.NaN,
        maximumPercent: 30,
        level: "quality_warning" as const,
        enforcement: "deterministic" as const,
        scope: "compression" as const,
      },
    },
  };

  assert.throws(
    () => saveScriptDirectorRule(invalid),
    /compression.targetReduction/,
  );
  assert.equal(storage.getItem(SCRIPT_DIRECTOR_RULE_STORAGE_KEY), originalStorage);
});

test("规则正文与内容哈希不一致时拒绝读取和后续覆盖", async () => {
  storage.clear();
  const valid = await createScriptDirectorRule(createValidInput());
  const tampered = {
    ...valid,
    source: {
      ...valid.source,
      rawMarkdown: `${valid.source.rawMarkdown}\n被悄悄追加的内容`,
    },
  };
  const originalTamperedStorage = JSON.stringify([tampered]);
  storage.setItem(SCRIPT_DIRECTOR_RULE_STORAGE_KEY, originalTamperedStorage);

  assert.throws(
    () => getScriptDirectorRules("ip-pengpeng"),
    /规则正文与内容哈希不一致/,
  );
  assert.throws(
    () => saveScriptDirectorRule(valid),
    /规则正文与内容哈希不一致/,
  );
  assert.equal(storage.getItem(SCRIPT_DIRECTOR_RULE_STORAGE_KEY), originalTamperedStorage);
});

test("生成入口拒绝存储适配器返回的正文哈希不一致规则", async () => {
  const valid = await createScriptDirectorRule(createValidInput());
  const tampered = {
    ...valid,
    status: "active" as const,
    source: {
      ...valid.source,
      rawMarkdown: `${valid.source.rawMarkdown}\n被悄悄追加的内容`,
    },
  };

  assert.deepEqual(resolveScriptDirectorRuleForGeneration({
    generationMode: "ip",
    ipId: valid.ipId,
    ipName: valid.profileContext.ipNameSnapshot,
    activeRuleId: valid.id,
    legacyProfileId: null,
    repository: { getForIP: () => tampered },
  }), {
    enabled: false,
    reason: "rule_invalid",
  });
});

test("规则内容哈希符合SHA-256标准向量", () => {
  assert.equal(
    calculateScriptDirectorRuleContentHash("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("案例数量和压缩比例规则缺少强度或执行方式时拒绝通过契约", async () => {
  const current = await createScriptDirectorRule(createValidInput());
  const missingCaseMetadata = structuredClone(current) as unknown as Record<string, unknown>;
  const body = missingCaseMetadata.body as { casePolicy: Record<string, unknown> };
  delete body.casePolicy.level;
  delete body.casePolicy.enforcement;

  assert.deepEqual(parseScriptDirectorRule(missingCaseMetadata), {
    ok: false,
    error: "专属编导规则内容损坏：body.casePolicy.level",
  });

  const missingCompressionMetadata = structuredClone(current) as unknown as Record<string, unknown>;
  const compression = missingCompressionMetadata.compression as Record<string, unknown>;
  compression.enabled = true;
  compression.targetReduction = { minimumPercent: 20, maximumPercent: 30 };

  assert.deepEqual(parseScriptDirectorRule(missingCompressionMetadata), {
    ok: false,
    error: "专属编导规则内容损坏：compression.targetReduction.level",
  });
});
