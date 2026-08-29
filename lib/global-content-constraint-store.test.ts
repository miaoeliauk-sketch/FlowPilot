import assert from "node:assert/strict";
import test from "node:test";
import {
  GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY,
  getActiveGlobalBlockingConstraints,
  loadGlobalBlockingConstraints,
  saveGlobalBlockingConstraintDraft,
  transitionStoredGlobalBlockingConstraint,
} from "./global-content-constraint-store";

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

class CorruptingStorage extends MemoryStorage {
  corruptNextWrite = false;

  override setItem(key: string, value: string): void {
    super.setItem(key, this.corruptNextWrite ? `${value}损坏` : value);
    this.corruptNextWrite = false;
  }
}

class UnavailableStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new Error("浏览器拒绝访问存储");
  }
}

class TransientReadbackFailureStorage extends MemoryStorage {
  private reads = 0;
  private armed = false;

  override getItem(key: string): string | null {
    if (this.armed) {
      this.reads += 1;
      if (this.reads === 3) throw new Error("回读暂时失败");
    }
    return super.getItem(key);
  }

  arm(): void {
    this.armed = true;
    this.reads = 0;
  }

  peek(key: string): string | null {
    return super.getItem(key);
  }
}

class ConcurrentWriteStorage extends MemoryStorage {
  concurrentValue: string | null = null;
  private reads = 0;
  private armed = false;

  override getItem(key: string): string | null {
    if (this.armed) {
      this.reads += 1;
      if (this.reads === 3 && this.concurrentValue !== null) {
        super.setItem(key, this.concurrentValue);
      }
    }
    return super.getItem(key);
  }

  arm(): void {
    this.armed = true;
    this.reads = 0;
  }

  peek(key: string): string | null {
    return super.getItem(key);
  }
}

class ConsecutiveReadbackFailureStorage extends MemoryStorage {
  private reads = 0;
  private armed = false;

  override getItem(key: string): string | null {
    if (this.armed) {
      this.reads += 1;
      if (this.reads === 3 || this.reads === 4) throw new Error("连续回读失败");
    }
    return super.getItem(key);
  }

  arm(): void {
    this.armed = true;
    this.reads = 0;
  }

  peek(key: string): string | null {
    return super.getItem(key);
  }
}

class QueuedWriteLock {
  readonly names: string[] = [];
  private tail: Promise<unknown> = Promise.resolve();

  request<T>(name: string, operation: () => T): Promise<T> {
    this.names.push(name);
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

function draftRuleFixture() {
  return {
    schemaVersion: 1,
    ruleId: "global-constraint-emotional-coercion",
    sourceKnowledgeEntryId: "knowledge-expression-motive",
    scope: "all_ips",
    category: "通用禁用规则",
    priority: "global_baseline",
    enforcement: "block",
    status: "draft",
    title: "禁止利用无力感进行情绪绑架",
    canonicalText: "判断对象是表达动机，不是具体词汇。允许反差、悬念和适度焦虑。禁止利用受众的无力感进行情绪操纵，迫使其被动接受或行动。",
    prohibitedIntent: "利用受众的无力感进行情绪操纵，迫使其被动接受或行动",
    allowedBoundaries: ["反差", "悬念", "适度焦虑"],
    detection: {
      type: "keyword",
      matchMode: "any",
      terms: ["被时代抛弃", "阶级固化"],
    },
    humanConfirmation: null,
    revision: 1,
    createdAt: "2026-08-29T14:00:00.000Z",
    updatedAt: "2026-08-29T14:00:00.000Z",
  };
}

function replaceStoredRules(storage: MemoryStorage, rules: unknown[]): void {
  const raw = storage.getItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY);
  assert.ok(raw);
  const envelope = JSON.parse(raw) as Record<string, unknown>;
  storage.setItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY, JSON.stringify({
    ...envelope,
    rules,
  }));
}

test("规则草稿写入独立存储并可严格回读，不复用普通知识键", async () => {
  const storage = new MemoryStorage();
  const draft = draftRuleFixture();

  assert.deepEqual(await saveGlobalBlockingConstraintDraft(storage, draft), draft);
  assert.deepEqual(loadGlobalBlockingConstraints(storage), [draft]);
  assert.ok(storage.getItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY));
  assert.equal(storage.getItem("ipwr:knowledgeEntries"), null);
});

test("规则只有经过人工确认启用后才进入生成流程可读集合", async () => {
  const storage = new MemoryStorage();
  const draft = await saveGlobalBlockingConstraintDraft(storage, draftRuleFixture());

  assert.deepEqual(getActiveGlobalBlockingConstraints(storage), []);

  const active = await transitionStoredGlobalBlockingConstraint(storage, draft.ruleId, {
    type: "activate",
    confirmedBy: "彭彭",
    at: "2026-08-29T15:00:00.000Z",
  });
  assert.equal(active.status, "active");
  assert.deepEqual(active.humanConfirmation, {
    confirmedBy: "彭彭",
    confirmedAt: "2026-08-29T15:00:00.000Z",
  });
  assert.deepEqual(getActiveGlobalBlockingConstraints(storage), [active]);

  const disabled = await transitionStoredGlobalBlockingConstraint(storage, draft.ruleId, {
    type: "disable",
    at: "2026-08-29T16:00:00.000Z",
  });
  assert.equal(disabled.status, "disabled");
  assert.deepEqual(getActiveGlobalBlockingConstraints(storage), []);
});

test("拒绝直接伪造已启用规则、普通知识记录和重复来源，失败后原存储不变", async () => {
  const storage = new MemoryStorage();
  const draft = draftRuleFixture();
  await saveGlobalBlockingConstraintDraft(storage, draft);
  const original = storage.getItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY);

  await assert.rejects(
    saveGlobalBlockingConstraintDraft(storage, {
      ...draft,
      status: "active",
      humanConfirmation: {
        confirmedBy: "智能入库助手",
        confirmedAt: "2026-08-29T15:00:00.000Z",
      },
      updatedAt: "2026-08-29T15:00:00.000Z",
    }),
    /只能通过草稿入口创建规则/,
  );
  await assert.rejects(
    saveGlobalBlockingConstraintDraft(storage, {
      id: "knowledge-expression-motive",
      category: "通用禁用规则",
      rawContent: draft.canonicalText,
      sourcePlatform: "智能入库助手",
    }),
    /字段不完整或包含未定义字段/,
  );
  await assert.rejects(
    saveGlobalBlockingConstraintDraft(storage, draft),
    /规则编号已存在/,
  );
  await assert.rejects(
    saveGlobalBlockingConstraintDraft(storage, {
      ...draft,
      ruleId: "another-rule-id",
    }),
    /原知识已经绑定强制规则/,
  );
  assert.equal(storage.getItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY), original);
});

test("损坏数据停止读取和写入，回读不一致时恢复写入前原文", async () => {
  const corruptedStorage = new MemoryStorage();
  corruptedStorage.setItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY, "{损坏JSON");
  const corruptedOriginal = corruptedStorage.getItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY);
  await assert.rejects(
    saveGlobalBlockingConstraintDraft(corruptedStorage, draftRuleFixture()),
    /数据损坏，已停止读取和写入/,
  );
  assert.equal(corruptedStorage.getItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY), corruptedOriginal);

  const storage = new CorruptingStorage();
  await saveGlobalBlockingConstraintDraft(storage, draftRuleFixture());
  const original = storage.getItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY);
  storage.corruptNextWrite = true;
  await assert.rejects(
    transitionStoredGlobalBlockingConstraint(
      storage,
      draftRuleFixture().ruleId,
      { type: "activate", confirmedBy: "彭彭", at: "2026-08-29T15:00:00.000Z" },
    ),
    /状态保存后回读不一致/,
  );
  assert.equal(storage.getItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY), original);
});

test("读取时拒绝重复规则编号和同一原知识的多份强制规则", async () => {
  const storage = new MemoryStorage();
  const draft = draftRuleFixture();
  await saveGlobalBlockingConstraintDraft(storage, draft);
  replaceStoredRules(storage, [draft, draft]);
  assert.throws(() => loadGlobalBlockingConstraints(storage), /重复的规则编号/);

  replaceStoredRules(storage, [
    draft,
    { ...draft, ruleId: "another-rule-id" },
  ]);
  assert.throws(() => loadGlobalBlockingConstraints(storage), /同一原知识重复绑定强制规则/);
});

test("浏览器存储不可访问时返回清晰错误，不暴露底层异常", () => {
  const storage = new UnavailableStorage();

  assert.throws(
    () => loadGlobalBlockingConstraints(storage),
    /通用强制规则读取失败：浏览器拒绝访问存储/,
  );
});

test("写入后的瞬时回读失败会恢复原内容，不留下未经确认的新状态", async () => {
  const storage = new TransientReadbackFailureStorage();
  await saveGlobalBlockingConstraintDraft(storage, draftRuleFixture());
  const original = storage.peek(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY);
  storage.arm();

  await assert.rejects(
    transitionStoredGlobalBlockingConstraint(
      storage,
      draftRuleFixture().ruleId,
      { type: "activate", confirmedBy: "彭彭", at: "2026-08-29T15:00:00.000Z" },
    ),
    /读取失败：回读暂时失败/,
  );
  assert.equal(storage.peek(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY), original);
});

test("回读发现另一标签页的新写入时停止并保留对方内容，不用旧值覆盖", async () => {
  const storage = new ConcurrentWriteStorage();
  await saveGlobalBlockingConstraintDraft(storage, draftRuleFixture());
  const concurrentRule = {
    ...draftRuleFixture(),
    title: "另一标签页保存的新标题",
    revision: 2,
    updatedAt: "2026-08-29T15:30:00.000Z",
  };
  const concurrentStorage = new MemoryStorage();
  await saveGlobalBlockingConstraintDraft(concurrentStorage, concurrentRule);
  storage.concurrentValue = concurrentStorage.getItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY);
  storage.arm();

  await assert.rejects(
    transitionStoredGlobalBlockingConstraint(
      storage,
      draftRuleFixture().ruleId,
      { type: "activate", confirmedBy: "彭彭", at: "2026-08-29T16:00:00.000Z" },
    ),
    /并发写入冲突/,
  );
  assert.equal(storage.peek(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY), storage.concurrentValue);
});

test("连续回读失败时仍在写锁内恢复原内容", async () => {
  const storage = new ConsecutiveReadbackFailureStorage();
  await saveGlobalBlockingConstraintDraft(storage, draftRuleFixture());
  const original = storage.peek(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY);
  storage.arm();

  await assert.rejects(
    transitionStoredGlobalBlockingConstraint(
      storage,
      draftRuleFixture().ruleId,
      { type: "activate", confirmedBy: "彭彭", at: "2026-08-29T17:00:00.000Z" },
    ),
    /读取失败：连续回读失败/,
  );
  assert.equal(storage.peek(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY), original);
});

test("所有写入共用同一把跨标签页锁，并发保存不会互相覆盖", async () => {
  const storage = new MemoryStorage();
  const lock = new QueuedWriteLock();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const first = draftRuleFixture();
  const second = {
    ...draftRuleFixture(),
    ruleId: "global-constraint-fear-mongering",
    sourceKnowledgeEntryId: "knowledge-fear-mongering",
    title: "禁止贩卖恐慌",
  };

  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { locks: lock },
  });
  try {
    await Promise.all([
      saveGlobalBlockingConstraintDraft(storage, first),
      saveGlobalBlockingConstraintDraft(storage, second),
    ]);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }

  assert.deepEqual(
    loadGlobalBlockingConstraints(storage).map(rule => rule.ruleId),
    [first.ruleId, second.ruleId],
  );
  assert.equal(lock.names.length, 2);
  assert.equal(new Set(lock.names).size, 1);
});
