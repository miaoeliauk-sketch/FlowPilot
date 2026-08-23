import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareReviewedMethodCardBatch,
  saveReviewedMethodCardBatch,
  type ReviewedMethodCardInput,
} from "./knowledge-reviewed-intake";
import { addKnowledgeEntry, getKnowledgeEntries } from "./ip-store";

function reviewedCard(
  overrides: Partial<ReviewedMethodCardInput> = {},
): ReviewedMethodCardInput {
  return {
    cardKey: "customer-view",
    title: "精准客户视角与诊断前置信息",
    category: "定位方法库",
    summary: "先明确目标客户，再从真实潜在客户视角诊断内容。",
    coreMethod: "明确行业、产品、目标客户、客户需求和认知水平，再模拟第一次刷到这个IP的潜在客户。",
    checkQuestions: ["目标客户是否明确？", "客户能否马上判断内容与自己有关？"],
    applicableScenarios: ["短视频文案诊断", "IP内容匹配检查"],
    triggerKeywords: ["精准客户", "用户视角"],
    aiUsage: "提供客户信息和完整文案，要求AI从潜在客户视角逐项诊断。",
    unsuitableCases: ["法律合规审查"],
    sourceChapterBasis: ["第二章“先锁定谁在看”"],
    sourceName: "精准客户行为诊断法",
    ...overrides,
  };
}

async function withStorage(run: () => void | Promise<void>) {
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
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try {
    await run();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete (globalThis as Record<string, unknown>).window;
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete (globalThis as Record<string, unknown>).localStorage;
  }
}

test("已审核方法卡必须先完成全库检查，随后严格保存系统生成的通用知识", async () => {
  await withStorage(() => {
    const prepared = prepareReviewedMethodCardBatch({
      collectionKey: "precise-customer-behavior-diagnosis",
      cards: [reviewedCard()],
    });

    assert.equal(prepared.assessments[0]?.quality.status, "pass");
    assert.deepEqual(prepared.assessments[0]?.similarEntries, []);

    const saved = saveReviewedMethodCardBatch(prepared);
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.id, "reviewed-method:precise-customer-behavior-diagnosis:customer-view");
    assert.equal(saved[0]?.ipId, null);
    assert.equal(saved[0]?.sourceTier, "中");
    assert.match(saved[0]?.sourceTierReason ?? "", /来源等级待确认/);
    assert.equal(saved[0]?.trustStatus, null);
    assert.equal(saved[0]?.status, "未使用");
    assert.deepEqual(saved[0]?.usageRecords, []);
    assert.equal(getKnowledgeEntries()[0]?.title, "精准客户视角与诊断前置信息");
  });
});

test("全库内容在检查后发生变化时旧确认立即失效且不写入", async () => {
  await withStorage(() => {
    const prepared = prepareReviewedMethodCardBatch({
      collectionKey: "precise-customer-behavior-diagnosis",
      cards: [reviewedCard()],
    });
    addKnowledgeEntry({
      category: "定位方法库",
      title: "检查后新增的知识",
      rawContent: "这条知识在人工确认后才进入全库，保存前必须重新检查。",
      tags: [],
      keywords: [],
      ipId: null,
      sourceTier: "中",
      sourceTierReason: "测试",
      contentDirection: [],
      sourcePlatform: "测试",
      sourceUrl: "",
      note: "",
      extractedAt: null,
      metrics: null,
      viralEvaluation: null,
      usageRecords: [],
      status: "未使用",
      dna: null,
    });

    assert.throws(
      () => saveReviewedMethodCardBatch(prepared),
      /全库检查结果已变化.*重新检查/,
    );
    assert.equal(getKnowledgeEntries().some(entry => entry.id.startsWith("reviewed-method:")), false);
  });
});

test("同一批已审核方法卡重复执行只复用原条目且不会制造重复知识", async () => {
  await withStorage(() => {
    const input = {
      collectionKey: "precise-customer-behavior-diagnosis",
      cards: [reviewedCard()],
    };
    const first = saveReviewedMethodCardBatch(prepareReviewedMethodCardBatch(input));
    const second = saveReviewedMethodCardBatch(prepareReviewedMethodCardBatch(input));

    assert.equal(second[0]?.id, first[0]?.id);
    assert.equal(getKnowledgeEntries().length, 1);
  });
});

test("检查完成后方法卡原始字段被改动时必须重新检查而不能沿用旧确认", async () => {
  await withStorage(() => {
    const prepared = prepareReviewedMethodCardBatch({
      collectionKey: "precise-customer-behavior-diagnosis",
      cards: [reviewedCard()],
    });
    const mutableCards = prepared.cards as ReviewedMethodCardInput[];
    mutableCards[0] = { ...mutableCards[0]!, sourceName: "检查后被替换的来源" };

    assert.throws(
      () => saveReviewedMethodCardBatch(prepared),
      /方法卡内容已变化.*重新检查/,
    );
    assert.equal(getKnowledgeEntries().length, 0);
  });
});

test("检查完成后集合编号被改动时必须重新检查而不能生成另一组知识", async () => {
  await withStorage(() => {
    const prepared = prepareReviewedMethodCardBatch({
      collectionKey: "precise-customer-behavior-diagnosis",
      cards: [reviewedCard()],
    });
    const mutablePrepared = prepared as { collectionKey: string };
    mutablePrepared.collectionKey = "another-collection";

    assert.throws(
      () => saveReviewedMethodCardBatch(prepared),
      /方法卡内容已变化.*重新检查/,
    );
    assert.equal(getKnowledgeEntries().length, 0);
  });
});

test("严格写入失败时不报成功且恢复存储后可以安全重试", async () => {
  await withStorage(() => {
    const prepared = prepareReviewedMethodCardBatch({
      collectionKey: "precise-customer-behavior-diagnosis",
      cards: [reviewedCard()],
    });
    const storage = localStorage;
    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (key === "ipwr:knowledgeEntries") throw new Error("quota exceeded");
      originalSetItem(key, value);
    };
    try {
      assert.throws(
        () => saveReviewedMethodCardBatch(prepared),
        /人工确认方法卡保存失败/,
      );
      assert.equal(getKnowledgeEntries().length, 0);
    } finally {
      storage.setItem = originalSetItem;
    }

    const saved = saveReviewedMethodCardBatch(prepared);
    assert.equal(saved.length, 1);
    assert.equal(getKnowledgeEntries().length, 1);
  });
});

test("同一编号只有全部审核内容一致时才幂等复用，任一原始字段变化都拒绝覆盖", async () => {
  await withStorage(() => {
    const baseInput = {
      collectionKey: "precise-customer-behavior-diagnosis",
      cards: [reviewedCard()],
    };
    saveReviewedMethodCardBatch(prepareReviewedMethodCardBatch(baseInput));

    const changedInput = {
      ...baseInput,
      cards: [reviewedCard({ aiUsage: "已经变更的AI调用方式" })],
    };
    assert.throws(
      () => saveReviewedMethodCardBatch(prepareReviewedMethodCardBatch(changedInput)),
      /同一方法卡编号已存在.*审核内容不一致.*拒绝覆盖/,
    );
    assert.equal(getKnowledgeEntries().length, 1);
    assert.equal(getKnowledgeEntries()[0]?.note.includes("已经变更"), false);
  });
});

test("历史存储中同一方法卡编号重复时明确报错而不是静默选取", async () => {
  await withStorage(() => {
    const input = {
      collectionKey: "precise-customer-behavior-diagnosis",
      cards: [reviewedCard()],
    };
    saveReviewedMethodCardBatch(prepareReviewedMethodCardBatch(input));
    const [saved] = getKnowledgeEntries();
    localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([saved, saved]));

    assert.throws(
      () => saveReviewedMethodCardBatch(prepareReviewedMethodCardBatch(input)),
      /历史知识存在重复的方法卡编号/,
    );
  });
});
