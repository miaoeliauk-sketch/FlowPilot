import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 24 executes this TypeScript test directly.
import { SCRIPT_FACTORY_DRAFT_STORAGE_KEY, clearPartialScriptDraft, getPartialScriptDraft, savePartialScriptDraft } from "./script-factory-draft.ts";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function createDraft(ipId: string, topic: string) {
  return {
    version: 1 as const,
    ipId,
    topic,
    savedAt: "2026-07-28T12:00:00.000Z",
    failedStage: "storyboard" as const,
    warning: "分镜生成失败",
    generationSettings: {
      platform: "抖音",
      formatCategory: "short",
      durationSeconds: 60,
      goal: "建立信任",
      videoType: "口播",
      needsStoryboard: true,
      needsShootingTips: true,
    },
    result: { topic },
  };
}

test("saves and restores the latest partial draft for each IP", () => {
  const storage = createMemoryStorage();

  assert.equal(savePartialScriptDraft(createDraft("ip-a", "旧选题"), storage), true);
  assert.equal(savePartialScriptDraft(createDraft("ip-b", "另一个IP"), storage), true);
  assert.equal(savePartialScriptDraft(createDraft("ip-a", "新选题"), storage), true);

  assert.equal(getPartialScriptDraft("ip-a", storage)?.topic, "新选题");
  assert.equal(getPartialScriptDraft("ip-b", storage)?.topic, "另一个IP");
});

test("clears only the requested IP draft", () => {
  const storage = createMemoryStorage();
  savePartialScriptDraft(createDraft("ip-a", "选题A"), storage);
  savePartialScriptDraft(createDraft("ip-b", "选题B"), storage);

  assert.equal(clearPartialScriptDraft("ip-a", storage), true);
  assert.equal(getPartialScriptDraft("ip-a", storage), null);
  assert.equal(getPartialScriptDraft("ip-b", storage)?.topic, "选题B");
});

test("storage failures do not escape to the page", () => {
  const storage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };

  assert.equal(savePartialScriptDraft(createDraft("ip-a", "选题"), storage), false);
  assert.equal(getPartialScriptDraft("ip-a", storage), null);
  assert.equal(clearPartialScriptDraft("ip-a", storage), false);
});

test("does not restore an incomplete draft record", () => {
  const storage = createMemoryStorage();
  storage.setItem(
    SCRIPT_FACTORY_DRAFT_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      draftsByIP: {
        "ip-a": {
          version: 1,
          ipId: "ip-a",
          topic: "残缺草稿",
          savedAt: "2026-07-28T12:00:00.000Z",
          failedStage: "storyboard",
          warning: "失败",
          result: {},
        },
      },
    }),
  );

  assert.equal(getPartialScriptDraft("ip-a", storage), null);
});

test("preserves an optional topicId and rejects malformed linked drafts", () => {
  const storage = createMemoryStorage();
  const linkedDraft = { ...createDraft("ip-a", "关联选题"), topicId: "topic-123" };
  assert.equal(savePartialScriptDraft(linkedDraft, storage), true);
  assert.equal(
    (getPartialScriptDraft("ip-a", storage) as { topicId?: string } | null)?.topicId,
    "topic-123",
  );

  storage.setItem(
    SCRIPT_FACTORY_DRAFT_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      draftsByIP: {
        "ip-a": { ...linkedDraft, topicId: false },
      },
    }),
  );
  assert.equal(getPartialScriptDraft("ip-a", storage), null);
});

test("a browser that blocks access to localStorage does not crash the page", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      get localStorage() {
        throw new Error("storage access blocked");
      },
    },
  });

  try {
    assert.equal(savePartialScriptDraft(createDraft("ip-a", "选题")), false);
    assert.equal(getPartialScriptDraft("ip-a"), null);
    assert.equal(clearPartialScriptDraft("ip-a"), false);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
