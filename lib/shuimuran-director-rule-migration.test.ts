import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMigratedShuimuranDirectorRule,
  ensureShuimuranDirectorRuleMigrated,
} from "./shuimuran-director-rule-migration";
import {
  SCRIPT_DIRECTOR_RULE_STORAGE_KEY,
  getScriptDirectorRules,
  saveScriptDirectorRule,
} from "./script-director-rule-store";
import { calculateScriptDirectorRuleContentHash } from "./script-director-rule";

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

test("旧shuimuran-v1绑定迁移为当前IP名下的标准通用规则", async () => {
  storage.clear();
  const migrated = await ensureShuimuranDirectorRuleMigrated({
    ipId: "ip-shuimuran",
    ipName: "水木然",
    legacyProfileId: "shuimuran-v1",
    migratedAt: "2026-08-21T12:00:00.000Z",
  });

  assert.equal(migrated?.ipId, "ip-shuimuran");
  assert.equal(migrated?.status, "draft");
  assert.equal(migrated?.source.type, "built_in");
  assert.equal(migrated?.testValidation, undefined);
  assert.equal(getScriptDirectorRules("ip-shuimuran").length, 1);
});

test("迁移规则完整保留真实选题回归所需的质量、压缩和口播标点边界", async () => {
  storage.clear();
  const migrated = await ensureShuimuranDirectorRuleMigrated({
    ipId: "ip-shuimuran",
    ipName: "水木然",
    legacyProfileId: "shuimuran-v1",
    migratedAt: "2026-08-21T12:00:00.000Z",
  });
  assert.ok(migrated);

  const raw = migrated.source.rawMarkdown;
  for (const expected of [
    "大家有没有发现一个很有意思的现象",
    "每篇内容只保留一条核心思想",
    "机械清单",
    "值得反复琢磨",
    "20%至30%",
    "老师原话必须逐字对应水木然IP原始内容",
    "普通概念和判断不能用引号制造强调",
  ]) {
    assert.equal(raw.includes(expected), true, `迁移规则缺少：${expected}`);
  }
  assert.equal(migrated.compression.enabled, true);
  assert.deepEqual(migrated.compression.targetReduction && {
    minimumPercent: migrated.compression.targetReduction.minimumPercent,
    maximumPercent: migrated.compression.targetReduction.maximumPercent,
  }, { minimumPercent: 20, maximumPercent: 30 });
});

test("迁移幂等且不会覆盖用户已经导入的通用规则库", async () => {
  storage.clear();
  const input = {
    ipId: "ip-shuimuran",
    ipName: "水木然",
    legacyProfileId: "shuimuran-v1" as const,
    migratedAt: "2026-08-21T12:00:00.000Z",
  };
  const first = await ensureShuimuranDirectorRuleMigrated(input);
  const second = await ensureShuimuranDirectorRuleMigrated(input);
  assert.equal(first?.id, second?.id);
  assert.equal(getScriptDirectorRules(input.ipId).length, 1);

  storage.clear();
  const customRaw = "# 用户自己导入的水木然新规则\n\n只使用这份新版规则。";
  const customBase = buildMigratedShuimuranDirectorRule({
    ipId: input.ipId,
    ipName: input.ipName,
    migratedAt: input.migratedAt,
  });
  const customRule = {
    ...customBase,
    id: `director-rule:${input.ipId}:2.0.0:${calculateScriptDirectorRuleContentHash(customRaw).slice(0, 12)}`,
    version: "2.0.0",
    source: {
      ...customBase.source,
      type: "markdown" as const,
      rawMarkdown: customRaw,
      contentHash: calculateScriptDirectorRuleContentHash(customRaw),
    },
  };
  saveScriptDirectorRule(customRule);

  const skipped = await ensureShuimuranDirectorRuleMigrated(input);
  assert.equal(skipped, null);
  assert.deepEqual(getScriptDirectorRules(input.ipId).map(rule => rule.id), [customRule.id]);
});

test("固定生成、其他IP和无旧绑定记录不会触发水木然迁移", async () => {
  storage.clear();
  for (const input of [
    { ipId: "ip-other", ipName: "其他IP", legacyProfileId: "shuimuran-v1" as const },
    { ipId: "ip-shuimuran", ipName: "水木然", legacyProfileId: null },
  ]) {
    const result = await ensureShuimuranDirectorRuleMigrated({
      ...input,
      migratedAt: "2026-08-21T12:00:00.000Z",
    });
    assert.equal(result, null);
  }
  assert.equal(storage.getItem(SCRIPT_DIRECTOR_RULE_STORAGE_KEY), null);
});
