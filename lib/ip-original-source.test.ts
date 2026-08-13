import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  clear() {
    this.values.clear();
  }
}

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const storage = new MemoryStorage();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
});

afterEach(() => {
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else delete (globalThis as Record<string, unknown>).window;
  if (previousLocalStorage) Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
  else delete (globalThis as Record<string, unknown>).localStorage;
});

test("IP原始内容只保存一份原文，解析结果都回溯到最终Source编号", async () => {
  const { addIPOriginalSource, getIPOriginalSource } = await import("./ip-original-source");
  const originalContent = "第一段：持续输出不是每天换话题。\n\n第二段：它是在围绕一个长期问题持续回答。";

  const saved = addIPOriginalSource({
    ipId: "ip-shuimuran",
    title: "持续输出的真正含义",
    sourceKind: "直播逐字稿",
    originalContent,
    sourceName: "直播整理.txt",
    sourceUrl: "",
    analysis: {
      analyzedAt: "2026-08-13T10:00:00.000Z",
      parserVersion: 1,
      items: [{
        id: "A01",
        kind: "claim",
        content: "持续输出不是不断更换话题。",
        sourceId: "draft-source",
        startPosition: 4,
        endPosition: 16,
        originalExcerpt: "持续输出不是每天换话题。",
        extractionStatus: "AI提取",
      }],
    },
  });

  const loaded = getIPOriginalSource(saved.id);
  assert.equal(loaded?.rawContent, originalContent);
  assert.equal(loaded?.category, "IP原始内容");
  assert.equal(loaded?.ipId, "ip-shuimuran");
  assert.equal(loaded?.sourceAnalysis?.items[0]?.sourceId, saved.id);
  assert.equal(
    loaded?.rawContent.slice(
      loaded.sourceAnalysis.items[0].startPosition,
      loaded.sourceAnalysis.items[0].endPosition,
    ),
    loaded?.sourceAnalysis?.items[0]?.originalExcerpt,
  );
});

test("重新解析只替换解析层，不改动Source原文", async () => {
  const {
    addIPOriginalSource,
    getIPOriginalSource,
    replaceIPOriginalSourceAnalysis,
  } = await import("./ip-original-source");
  const originalContent = "老师原话：真正的长期主义不是重复，而是能力持续增长。";
  const saved = addIPOriginalSource({
    ipId: "ip-shuimuran",
    title: "长期主义",
    sourceKind: "课程内容",
    originalContent,
    sourceName: "",
    sourceUrl: "",
    analysis: {
      analyzedAt: "2026-08-13T10:00:00.000Z",
      parserVersion: 1,
      items: [],
    },
  });

  replaceIPOriginalSourceAnalysis(saved.id, {
    analyzedAt: "2026-08-13T11:00:00.000Z",
    parserVersion: 1,
    items: [{
      id: "A01",
      kind: "claim",
      content: "长期主义要求能力增长。",
      sourceId: "another-draft-id",
      startPosition: 5,
      endPosition: originalContent.length,
      originalExcerpt: "真正的长期主义不是重复，而是能力持续增长。",
      extractionStatus: "人工确认",
    }],
  });

  const loaded = getIPOriginalSource(saved.id);
  assert.equal(loaded?.rawContent, originalContent);
  assert.equal(loaded?.sourceAnalysis?.items[0]?.sourceId, saved.id);
  assert.equal(loaded?.sourceAnalysis?.items[0]?.extractionStatus, "人工确认");
});
