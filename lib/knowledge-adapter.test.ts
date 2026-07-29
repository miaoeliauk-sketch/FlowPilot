import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

test("全库适配能读取新分类并记录引用", async () => {
  const { addKnowledgeEntry, getKnowledgeEntries } = await import("./ip-store");
  const { getAllKnowledgeItems, recordKnowledgeItemUsage } = await import("./knowledge-adapter");
  const addEntry = (category: "方法论" | "IP人设资料", title: string) => addKnowledgeEntry({
    category,
    title,
    rawContent: `${title}正文`,
    tags: [],
    keywords: [],
    ipId: category === "IP人设资料" ? "ip-1" : null,
    sourceTier: "高",
    sourceTierReason: "测试数据",
    contentDirection: [],
    sourcePlatform: "测试",
    sourceUrl: "",
    note: "",
    extractedAt: "2026-07-29T00:00:00.000Z",
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
  });

  storage.clear();
  addEntry("方法论", "旧分类条目");
  const ipEntry = addEntry("IP人设资料", "IP人设条目");

  const items = getAllKnowledgeItems();
  assert.deepEqual(
    items.map(item => item.title).sort(),
    ["IP人设条目", "旧分类条目"].sort(),
  );

  recordKnowledgeItemUsage(ipEntry.id, "知识库测试", "验证新分类引用");

  const saved = getKnowledgeEntries().find(entry => entry.id === ipEntry.id);
  assert.equal(saved?.status, "已用于分析");
  assert.equal(saved?.usageRecords.length, 1);
  assert.equal(saved?.usageRecords[0]?.module, "知识库测试");
});
