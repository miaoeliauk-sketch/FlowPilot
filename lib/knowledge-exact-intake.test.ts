import assert from "node:assert/strict";
import test from "node:test";
import {
  addKnowledgeEntry,
  getKnowledgeEntries,
  saveExactKnowledgeTemplateEntry,
  updateKnowledgeEntry,
} from "./ip-store";
import { saveExactKnowledgeTemplate } from "./knowledge-exact-intake";
import type { KnowledgeEntry } from "./types";

function templateInput(overrides: Partial<Parameters<typeof saveExactKnowledgeTemplate>[0]> = {}) {
  return {
    templateKey: "precise-customer-behavior-diagnosis",
    version: "1.0.0",
    title: "精准客户行为诊断法｜标准执行模板v1",
    rawContent: "# 标准诊断 Prompt\n\n```text\n请逐字保留“中文引号”和换行。\n```\n",
    category: "文案框架方法库" as const,
    sourceName: "FlowPilot_精准客户行为诊断法.md",
    sourceUrl: "",
    tags: ["执行模板", "精准客户诊断"],
    keywords: ["标准Prompt", "固定输出格式"],
    ...overrides,
  };
}

async function withStorage(
  run: (values: Map<string, string>, storage: Storage) => void | Promise<void>,
) {
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
    await run(values, storage);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete (globalThis as Record<string, unknown>).window;
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete (globalThis as Record<string, unknown>).localStorage;
  }
}

test("保真入口逐字保存模板并由系统生成受保护身份和生命周期", async () => {
  await withStorage(async () => {
    const input = templateInput();
    const saved = await saveExactKnowledgeTemplate(input);

    assert.equal(saved.rawContent, input.rawContent);
    assert.equal(saved.ipId, null);
    assert.equal(saved.status, "未使用");
    assert.deepEqual(saved.usageRecords, []);
    assert.equal(saved.trustStatus, null);
    assert.equal(saved.sourceReference, null);
    assert.equal(saved.executionTemplate?.templateKey, input.templateKey);
    assert.equal(saved.executionTemplate?.version, input.version);
    assert.match(saved.executionTemplate?.contentHash ?? "", /^[a-f0-9]{64}$/);
    assert.equal(saved.sourcePlatform, "用户提供文档");
    assert.equal(saved.sourceName, input.sourceName);
  });
});

test("同一模板版本重复保存只复用原记录且忽略后续真实生命周期变化", async () => {
  await withStorage(async values => {
    const first = await saveExactKnowledgeTemplate(templateInput());
    const stored = JSON.parse(values.get("ipwr:knowledgeEntries") ?? "[]") as KnowledgeEntry[];
    stored[0] = {
      ...stored[0]!,
      status: "已用于脚本",
      usageRecords: [{
        id: "usage-real",
        module: "脚本工厂",
        usedAt: "2026-08-23T00:00:00.000Z",
        reason: "真实采用",
        relevanceTier: "高度相关",
        relevanceReason: "正文采用",
        context: "测试",
        trackingStatus: "script_adopted",
        topicId: "topic-a",
        scriptId: "script-a",
        reviewId: null,
        usageType: "argument",
        sectionLabel: "正文",
        evidenceExcerpt: "逐字保留",
      }],
    };
    values.set("ipwr:knowledgeEntries", JSON.stringify(stored));

    const retried = await saveExactKnowledgeTemplate(templateInput());
    assert.equal(retried.id, first.id);
    assert.equal(retried.status, "已用于脚本");
    assert.equal(retried.usageRecords.length, 1);
    assert.equal(getKnowledgeEntries().length, 1);
  });
});

test("同一模板版本对应不同原文时明确拒绝且不覆盖", async () => {
  await withStorage(async values => {
    const first = await saveExactKnowledgeTemplate(templateInput());
    const original = values.get("ipwr:knowledgeEntries");

    await assert.rejects(
      saveExactKnowledgeTemplate(templateInput({ rawContent: "被篡改的新正文" })),
      /同一模板版本.*正文不一致/,
    );
    assert.equal(values.get("ipwr:knowledgeEntries"), original);
    assert.equal(getKnowledgeEntries()[0]?.id, first.id);
  });
});

test("历史存储存在重复模板编号时明确拒绝", async () => {
  await withStorage(async values => {
    const saved = await saveExactKnowledgeTemplate(templateInput());
    const stored = JSON.parse(values.get("ipwr:knowledgeEntries") ?? "[]") as KnowledgeEntry[];
    values.set("ipwr:knowledgeEntries", JSON.stringify([stored[0], { ...stored[0], title: "重复记录" }]));

    await assert.rejects(
      saveExactKnowledgeTemplate(templateInput()),
      /重复模板编号/,
    );
    assert.equal(getKnowledgeEntries().filter(entry => entry.id === saved.id).length, 2);
  });
});

test("模板严格写入失败时明确报错且不伪装成功", async () => {
  await withStorage(async (values, storage) => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        ...storage,
        get length() { return values.size; },
        setItem() { throw new Error("quota"); },
      },
    });
    await assert.rejects(
      saveExactKnowledgeTemplate(templateInput()),
      /执行模板保存失败/,
    );
    assert.equal(values.get("ipwr:knowledgeEntries"), undefined);
  });
});

test("通用新增和编辑入口不能伪造或篡改执行模板身份", async () => {
  await withStorage(async () => {
    const forged = addKnowledgeEntry({
      category: "文案框架方法库",
      title: "普通知识",
      rawContent: "普通正文",
      tags: [],
      keywords: [],
      ipId: null,
      sourceTier: "中",
      sourceTierReason: "测试",
      contentDirection: [],
      sourcePlatform: "手动添加",
      sourceUrl: "",
      note: "",
      extractedAt: null,
      metrics: null,
      viralEvaluation: null,
      usageRecords: [],
      status: "未使用",
      dna: null,
      executionTemplate: {
        templateKey: "forged-template",
        version: "1.0.0",
        contentHash: "a".repeat(64),
      },
    } as never);
    assert.equal(forged.executionTemplate, null);

    assert.throws(() => updateKnowledgeEntry(forged.id, {
      executionTemplate: {
        templateKey: "forged-template",
        version: "2.0.0",
        contentHash: "b".repeat(64),
      },
    } as never), /系统维护字段/);
    assert.equal(getKnowledgeEntries()[0]?.executionTemplate, null);
  });
});

test("直接调用底层存储也不能伪造模板编号、版本和正文哈希", async () => {
  await withStorage(async () => {
    const saved = await saveExactKnowledgeTemplateEntry({
      id: "forged-template-id",
      templateKey: "precise-customer-behavior-diagnosis",
      version: "1.0.0",
      category: "文案框架方法库",
      title: "精准客户行为诊断法｜标准执行模板v1",
      rawContent: "系统必须根据这份真实正文生成哈希",
      sourceName: "FlowPilot_精准客户行为诊断法.md",
      tags: ["执行模板"],
      keywords: ["标准Prompt"],
      sourceUrl: "",
      executionTemplate: {
        templateKey: "forged-key",
        version: "9.9.9",
        contentHash: "f".repeat(64),
      },
    } as never);

    assert.equal(saved.id, "knowledge-template:precise-customer-behavior-diagnosis:1.0.0");
    assert.equal(saved.executionTemplate?.templateKey, "precise-customer-behavior-diagnosis");
    assert.equal(saved.executionTemplate?.version, "1.0.0");
    assert.notEqual(saved.executionTemplate?.contentHash, "f".repeat(64));
  });
});

test("通用编辑入口不能修改已保存模板的编号或正文", async () => {
  await withStorage(async () => {
    const saved = await saveExactKnowledgeTemplate(templateInput());

    assert.throws(
      () => updateKnowledgeEntry(saved.id, { rawContent: "篡改后的正文" }),
      /保真执行模板.*不能编辑/,
    );
    assert.throws(
      () => updateKnowledgeEntry(saved.id, { id: "forged-template-id" }),
      /保真执行模板.*不能编辑/,
    );

    const persisted = getKnowledgeEntries()[0];
    assert.equal(persisted?.id, saved.id);
    assert.equal(persisted?.rawContent, templateInput().rawContent);
    assert.equal(
      persisted?.executionTemplate?.contentHash,
      saved.executionTemplate?.contentHash,
    );
  });
});
