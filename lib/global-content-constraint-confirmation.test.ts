import assert from "node:assert/strict";
import test from "node:test";
import {
  GLOBAL_BLOCKING_CONSTRAINT_CONFIRMATION_STATEMENT,
  confirmGlobalBlockingConstraintFromKnowledge,
} from "./global-content-constraint-confirmation";
import {
  GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY,
  getActiveGlobalBlockingConstraints,
} from "./global-content-constraint-store";
import { calculateSHA256 } from "./sha256";

const KNOWLEDGE_STORAGE_KEY = "ipwr:knowledgeEntries";
const FULL_RULE_TEXT = [
  "判断对象是表达动机，不是具体词汇。",
  "允许反差、悬念和适度焦虑。",
  "禁止利用受众的无力感进行情绪操纵，迫使其被动接受或行动。",
].join("\n");

class MemoryStorage {
  protected readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class RuleWriteFailureStorage extends MemoryStorage {
  override setItem(key: string, value: string): void {
    if (key === GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY) {
      throw new Error("模拟配额不足");
    }
    super.setItem(key, value);
  }
}

class SourceChangesDuringConfirmationStorage extends MemoryStorage {
  sourceChanged = false;

  override setItem(key: string, value: string): void {
    if (key === GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY && !this.sourceChanged) {
      this.sourceChanged = true;
      const entries = JSON.parse(super.getItem(KNOWLEDGE_STORAGE_KEY) ?? "[]") as Record<string, unknown>[];
      super.setItem(KNOWLEDGE_STORAGE_KEY, JSON.stringify(entries.map(item => ({
        ...item,
        rawContent: "确认过程中被另一处修改",
      }))));
    }
    super.setItem(key, value);
  }
}

function knowledgeFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "knowledge-emotional-coercion",
    title: "禁止利用无力感进行情绪绑架",
    category: "通用禁用规则",
    ipId: null,
    rawContent: FULL_RULE_TEXT,
    ...overrides,
  };
}

function requestFixture(overrides: Record<string, unknown> = {}) {
  return {
    sourceKnowledgeEntryId: "knowledge-emotional-coercion",
    expectedSourceTitle: "禁止利用无力感进行情绪绑架",
    expectedSourceRawContent: FULL_RULE_TEXT,
    confirmedBy: "彭彭",
    confirmationStatement: GLOBAL_BLOCKING_CONSTRAINT_CONFIRMATION_STATEMENT,
    rule: {
      title: "禁止利用无力感进行情绪绑架",
      canonicalText: FULL_RULE_TEXT,
      prohibitedIntent: "利用受众的无力感进行情绪操纵，迫使其被动接受或行动",
      allowedBoundaries: ["反差", "悬念", "适度焦虑", "引用", "批判", "合理语境"],
      detectionTerms: ["被时代抛弃", "阶级固化"],
    },
    ...overrides,
  };
}

function seedKnowledge(storage: MemoryStorage, entries: unknown[]): string {
  const raw = JSON.stringify(entries);
  storage.setItem(KNOWLEDGE_STORAGE_KEY, raw);
  return raw;
}

test("人工逐字确认后创建全IP启用规则，并完成严格回读", async () => {
  const storage = new MemoryStorage();
  const originalKnowledge = seedKnowledge(storage, [knowledgeFixture()]);

  const active = await confirmGlobalBlockingConstraintFromKnowledge(storage, requestFixture());

  assert.equal(active.status, "active");
  assert.equal(active.scope, "all_ips");
  assert.equal(active.sourceKnowledgeEntryId, "knowledge-emotional-coercion");
  assert.equal(active.canonicalText, FULL_RULE_TEXT);
  assert.deepEqual(active.sourceSnapshot, {
    title: "禁止利用无力感进行情绪绑架",
    rawContentSha256: calculateSHA256(FULL_RULE_TEXT),
  });
  assert.equal(active.humanConfirmation?.confirmedBy, "彭彭");
  assert.deepEqual(getActiveGlobalBlockingConstraints(storage), [active]);
  assert.equal(storage.getItem(KNOWLEDGE_STORAGE_KEY), originalKnowledge);
});

test("拒绝伪造来源、篡改原文、错误分类、IP私有来源和伪造确认句", async () => {
  const cases = [
    {
      entries: [knowledgeFixture()],
      request: requestFixture({ sourceKnowledgeEntryId: "missing-entry" }),
      message: /没有找到待确认的原知识/,
    },
    {
      entries: [knowledgeFixture()],
      request: requestFixture({ expectedSourceRawContent: "被替换的原文" }),
      message: /原知识内容已经变化/,
    },
    {
      entries: [knowledgeFixture({ category: "文案框架方法库" })],
      request: requestFixture(),
      message: /不是通用禁用规则/,
    },
    {
      entries: [knowledgeFixture({ ipId: "ip-a" })],
      request: requestFixture(),
      message: /必须属于通用知识库/,
    },
    {
      entries: [knowledgeFixture()],
      request: requestFixture({ confirmationStatement: "智能入库助手已确认" }),
      message: /缺少完整的显式确认记录/,
    },
    {
      entries: [knowledgeFixture()],
      request: requestFixture({ confirmedBy: "智能入库助手" }),
      message: /确认名称不能填写明确的系统或助手身份/,
    },
  ];

  for (const item of cases) {
    const storage = new MemoryStorage();
    const originalKnowledge = seedKnowledge(storage, item.entries);
    await assert.rejects(
      confirmGlobalBlockingConstraintFromKnowledge(storage, item.request),
      item.message,
    );
    assert.equal(storage.getItem(KNOWLEDGE_STORAGE_KEY), originalKnowledge);
    assert.equal(storage.getItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY), null);
  }
});

test("快速重复确认同一份规则保持幂等，不创建第二条记录或增加修订号", async () => {
  const storage = new MemoryStorage();
  seedKnowledge(storage, [knowledgeFixture()]);

  const [first, second] = await Promise.all([
    confirmGlobalBlockingConstraintFromKnowledge(storage, requestFixture()),
    confirmGlobalBlockingConstraintFromKnowledge(storage, requestFixture()),
  ]);

  assert.equal(second.ruleId, first.ruleId);
  assert.equal(second.revision, first.revision);
  assert.deepEqual(getActiveGlobalBlockingConstraints(storage), [first]);
});

test("确认过程中原知识发生变化时回滚规则写入并保留变化现场", async () => {
  const storage = new SourceChangesDuringConfirmationStorage();
  seedKnowledge(storage, [knowledgeFixture()]);

  await assert.rejects(
    confirmGlobalBlockingConstraintFromKnowledge(storage, requestFixture()),
    /确认过程中发生变化/,
  );
  assert.equal(storage.getItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY), null);
  assert.match(storage.getItem(KNOWLEDGE_STORAGE_KEY) ?? "", /确认过程中被另一处修改/);
});

test("规则写入失败时不返回成功，原知识逐字不变", async () => {
  const storage = new RuleWriteFailureStorage();
  const originalKnowledge = seedKnowledge(storage, [knowledgeFixture()]);

  await assert.rejects(
    confirmGlobalBlockingConstraintFromKnowledge(storage, requestFixture()),
    /通用强制规则写入失败/,
  );
  assert.equal(storage.getItem(KNOWLEDGE_STORAGE_KEY), originalKnowledge);
  assert.equal(storage.getItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY), null);
});

test("确认规则不绑定当前IP，且拒绝把任一IP私有知识转成全局规则", async () => {
  const storage = new MemoryStorage();
  seedKnowledge(storage, [
    knowledgeFixture(),
    knowledgeFixture({ id: "private-a", ipId: "ip-a" }),
    knowledgeFixture({ id: "private-b", ipId: "ip-b" }),
  ]);

  storage.setItem("ipwr:activeIpId", JSON.stringify("ip-a"));
  const active = await confirmGlobalBlockingConstraintFromKnowledge(storage, requestFixture());
  assert.equal(active.scope, "all_ips");
  assert.equal("ipId" in active, false);
  assert.equal(storage.getItem("ipwr:activeIpId"), JSON.stringify("ip-a"));
  storage.setItem("ipwr:activeIpId", JSON.stringify("ip-b"));
  assert.deepEqual(getActiveGlobalBlockingConstraints(storage), [active]);

  for (const sourceKnowledgeEntryId of ["private-a", "private-b"]) {
    await assert.rejects(
      confirmGlobalBlockingConstraintFromKnowledge(storage, requestFixture({
        sourceKnowledgeEntryId,
      })),
      /必须属于通用知识库/,
    );
  }
  assert.equal(getActiveGlobalBlockingConstraints(storage).length, 1);
});
