import assert from "node:assert/strict";
import test from "node:test";
import {
  fingerprintKnowledgeIntakeAssessment,
  prepareAIExtractedKnowledgeBatch,
  saveAIExtractedKnowledgeBatch,
  type AIExtractedKnowledgeSaveItem,
  type PrepareAIExtractedKnowledgeBatchInput,
} from "./knowledge-ai-intake";
import * as ipStore from "./ip-store";
import { addKnowledgeEntry, getKnowledgeEntries } from "./ip-store";
import type { KnowledgeEntry } from "./types";

interface StorageTestContext {
  lockRequestCount(): number;
}

async function withStorage(run: (context: StorageTestContext) => void | Promise<void>) {
  const values = new Map<string, string>();
  const storage = {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key: string) { return values.get(key) ?? null; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    removeItem(key: string) { values.delete(key); },
    setItem(key: string, value: string) { values.set(key, value); },
  } satisfies Storage;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let lockRequests = 0;
  let lockTail = Promise.resolve();
  const navigatorValue = {
    locks: {
      request<T>(_name: string, operation: () => T | Promise<T>): Promise<T> {
        lockRequests += 1;
        const result = lockTail.then(operation);
        lockTail = result.then(() => undefined, () => undefined);
        return result;
      },
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigatorValue });
  try {
    await run({ lockRequestCount: () => lockRequests });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete (globalThis as Record<string, unknown>).window;
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete (globalThis as Record<string, unknown>).localStorage;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete (globalThis as Record<string, unknown>).navigator;
  }
}

function saveItem(
  id: string,
  overrides: Partial<AIExtractedKnowledgeSaveItem> = {},
): AIExtractedKnowledgeSaveItem {
  const rawContent = [
    `【一句话总结】\n${id}总结`,
    `【核心方法】\n${id}核心方法`,
    "【适用场景】\n短视频选题",
    "【AI调用方式】\n用于优化短视频选题",
  ].join("\n\n");
  return {
    candidate: {
      id,
      kind: "method_card",
      title: `${id}标题`,
      summary: `${id}总结`,
      coreMethod: `${id}核心方法`,
      applicableScenarios: ["短视频选题"],
      aiUsage: "用于优化短视频选题",
      rawContent,
    },
    entry: {
      category: "选题方法库",
      title: `${id}标题`,
      rawContent,
      sourceKind: null,
      sourceName: "",
      sourceAnalysis: null,
      tags: [id],
      keywords: [id],
      ipId: null,
      sourceTier: "高",
      sourceTierReason: "原文明确",
      contentDirection: ["短视频选题"],
      sourcePlatform: "智能入库助手",
      sourceUrl: "",
      note: JSON.stringify({ methodCard: true }),
      extractedAt: "2026-08-26T09:00:00.000Z",
      metrics: null,
      viralEvaluation: null,
      usageRecords: [],
      status: "未使用",
      dna: null,
    },
    ...overrides,
  };
}

function unrelatedEntry(): Omit<KnowledgeEntry, "id" | "createdAt"> {
  return {
    ...saveItem("历史知识").entry,
    title: "完全无关的历史知识",
    rawContent: "这是与本批方法卡完全无关的历史正文。",
    tags: [],
    keywords: [],
  };
}

test("多张AI方法卡严格写入失败时整批零落盘且恢复后重试不重复", async () => {
  await withStorage(async () => {
    const prepared = prepareAIExtractedKnowledgeBatch({
      items: [saveItem("card-a"), saveItem("card-b")],
    });
    const storage = localStorage;
    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (key === "ipwr:knowledgeEntries") throw new Error("quota exceeded");
      originalSetItem(key, value);
    };
    try {
      await assert.rejects(
        async () => saveAIExtractedKnowledgeBatch(prepared),
        /AI提炼方法卡保存失败/,
      );
      assert.equal(getKnowledgeEntries().length, 0);
    } finally {
      storage.setItem = originalSetItem;
    }

    const saved = await saveAIExtractedKnowledgeBatch(prepared);
    assert.equal(saved.length, 2);
    assert.equal(getKnowledgeEntries().length, 2);
  });
});

test("批量保存后的自动恢复也失败时明确报告恢复失败", async () => {
  await withStorage(async () => {
    addKnowledgeEntry(unrelatedEntry());
    const prepared = prepareAIExtractedKnowledgeBatch({ items: [saveItem("card-a")] });
    const storage = localStorage;
    const originalSetItem = storage.setItem.bind(storage);
    let knowledgeWriteCount = 0;
    storage.setItem = (key, value) => {
      if (key !== "ipwr:knowledgeEntries") {
        originalSetItem(key, value);
        return;
      }
      knowledgeWriteCount += 1;
      if (knowledgeWriteCount === 1) {
        originalSetItem(key, "{损坏的中间状态");
        return;
      }
      throw new Error("rollback failed");
    };
    try {
      await assert.rejects(
        async () => saveAIExtractedKnowledgeBatch(prepared),
        /自动恢复失败/,
      );
    } finally {
      storage.setItem = originalSetItem;
    }
  });
});

test("绕过页面伪造相似内容确认字段和确认对象时统一入口拒绝保存", async () => {
  await withStorage(async () => {
    const item = saveItem("card-a");
    addKnowledgeEntry({
      ...unrelatedEntry(),
      title: item.entry.title,
      rawContent: item.entry.rawContent,
      note: item.entry.note,
      contentDirection: item.entry.contentDirection,
    });
    const initial = prepareAIExtractedKnowledgeBatch({ items: [item] });
    assert.ok(initial.assessments[0]?.similarEntries.length);
    const forgedInput = {
      items: [{
        ...item,
        confirmedAssessmentFingerprint: fingerprintKnowledgeIntakeAssessment(initial.assessments[0]!),
        confirmedAt: "2026-08-26T10:00:00.000Z",
        confirmation: { confirmed: true },
      }],
    } as unknown as PrepareAIExtractedKnowledgeBatchInput;

    await assert.rejects(
      async () => saveAIExtractedKnowledgeBatch(prepareAIExtractedKnowledgeBatch(forgedInput)),
      /确认凭证无效/,
    );
    assert.equal(getKnowledgeEntries().length, 1);
  });
});

test("审计记录回读的checkedAt等于最终保存前重新检查完成的时间", async () => {
  await withStorage(async () => {
    const RealDate = Date;
    let currentTime = "2026-08-26T10:00:00.000Z";
    class ControlledDate extends RealDate {
      constructor(value?: string | number) {
        super(value ?? currentTime);
      }
    }
    Object.defineProperty(globalThis, "Date", { configurable: true, value: ControlledDate });
    try {
      const prepared = prepareAIExtractedKnowledgeBatch({ items: [saveItem("card-a")] });
      assert.equal(prepared.checkedAt, "2026-08-26T10:00:00.000Z");
      currentTime = "2026-08-26T10:05:00.000Z";
      const storage = localStorage;
      const originalGetItem = storage.getItem.bind(storage);
      let advanceOnKnowledgeRead = true;
      storage.getItem = key => {
        if (key === "ipwr:knowledgeEntries" && advanceOnKnowledgeRead) {
          advanceOnKnowledgeRead = false;
          currentTime = "2026-08-26T10:06:00.000Z";
        }
        return originalGetItem(key);
      };
      const [saved] = await saveAIExtractedKnowledgeBatch(prepared);
      const persisted = getKnowledgeEntries().find(entry => entry.id === saved?.id);
      assert.ok(persisted);
      const note = JSON.parse(persisted.note) as {
        intakePrecheck?: { checkedAt?: string; initialCheckedAt?: string };
      };
      assert.equal(note.intakePrecheck?.checkedAt, "2026-08-26T10:06:00.000Z");
      assert.equal(note.intakePrecheck?.initialCheckedAt, "2026-08-26T10:00:00.000Z");
    } finally {
      Object.defineProperty(globalThis, "Date", { configurable: true, value: RealDate });
    }
  });
});

test("成功落盘但调用方未收到结果时原样重放复用已有记录且不重复", async () => {
  await withStorage(async () => {
    const prepared = prepareAIExtractedKnowledgeBatch({ items: [saveItem("card-a")] });
    const first = await saveAIExtractedKnowledgeBatch(prepared);
    const replayed = await saveAIExtractedKnowledgeBatch(prepared);

    assert.deepEqual(replayed.map(entry => entry.id), first.map(entry => entry.id));
    assert.equal(getKnowledgeEntries().length, 1);
  });
});

test("成功落盘后即使新增了无关知识原样重放仍复用已有记录", async () => {
  await withStorage(async () => {
    const prepared = prepareAIExtractedKnowledgeBatch({ items: [saveItem("card-a")] });
    const first = await saveAIExtractedKnowledgeBatch(prepared);
    addKnowledgeEntry(unrelatedEntry());

    const replayed = await saveAIExtractedKnowledgeBatch(prepared);

    assert.deepEqual(replayed.map(entry => entry.id), first.map(entry => entry.id));
    assert.equal(getKnowledgeEntries().length, 2);
  });
});

test("批量凭证仅部分存在时明确拒绝且不补齐剩余知识", async () => {
  await withStorage(async () => {
    const itemA = saveItem("card-a");
    const itemB = saveItem("card-b");
    const batch = prepareAIExtractedKnowledgeBatch({ items: [itemA, itemB] });
    await saveAIExtractedKnowledgeBatch(
      prepareAIExtractedKnowledgeBatch({ items: [itemA] }),
    );

    await assert.rejects(
      saveAIExtractedKnowledgeBatch(batch),
      /部分.*落盘|半批/,
    );
    const stored = getKnowledgeEntries();
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.title, "card-a标题");
  });
});

test("最终检查和批量写入共用跨页面写锁", async () => {
  await withStorage(async ({ lockRequestCount }) => {
    const first = prepareAIExtractedKnowledgeBatch({ items: [saveItem("card-a")] });
    const second = prepareAIExtractedKnowledgeBatch({ items: [saveItem("card-b")] });
    const results = await Promise.allSettled([
      Promise.resolve().then(() => saveAIExtractedKnowledgeBatch(first)),
      Promise.resolve().then(() => saveAIExtractedKnowledgeBatch(second)),
    ]);

    assert.equal(lockRequestCount(), 2);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
    assert.equal(getKnowledgeEntries().length, 1);
  });
});

test("底层强制核对存储参数和审计记录中的幂等编号一致", async () => {
  await withStorage(async () => {
    const transactionRunner = (ipStore as unknown as {
      runKnowledgeLibraryWriteTransaction?: <T>(
        operation: (transaction: unknown) => T | Promise<T>,
      ) => Promise<T>;
      saveAIExtractedKnowledgeEntriesStrict?: (
        transaction: unknown,
        items: unknown[],
      ) => KnowledgeEntry[];
    });
    assert.equal(typeof transactionRunner.runKnowledgeLibraryWriteTransaction, "function");
    assert.equal(typeof transactionRunner.saveAIExtractedKnowledgeEntriesStrict, "function");
    const entry = saveItem("card-a").entry;
    entry.note = JSON.stringify({
      intakePrecheck: { idempotencyKey: "note-key" },
    });

    await assert.rejects(
      transactionRunner.runKnowledgeLibraryWriteTransaction!(transaction =>
        transactionRunner.saveAIExtractedKnowledgeEntriesStrict!(transaction, [{
          idempotencyKey: "parameter-key",
          entry,
        }])),
      /幂等凭证不一致/,
    );
    assert.equal(getKnowledgeEntries().length, 0);
  });
});

test("浏览器不支持写锁时AI批量入库明确拒绝且零条落盘", async () => {
  await withStorage(async () => {
    const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    try {
      const prepared = prepareAIExtractedKnowledgeBatch({ items: [saveItem("card-a")] });
      await assert.rejects(
        saveAIExtractedKnowledgeBatch(prepared),
        /无法安全写入知识库/,
      );
      assert.equal(getKnowledgeEntries().length, 0);
    } finally {
      if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
      else Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    }
  });
});
