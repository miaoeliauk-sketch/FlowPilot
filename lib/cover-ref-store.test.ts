import assert from "node:assert/strict";
import test from "node:test";
import { addCoverRef, deleteCoverRef, getCoverRefs } from "./ip-store";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  clear(): void {
    this.values.clear();
  }
}

const storage = new MemoryStorage();
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { localStorage: storage },
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

test.after(() => {
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else delete (globalThis as Record<string, unknown>).window;

  if (previousLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
  } else {
    delete (globalThis as Record<string, unknown>).localStorage;
  }
});

test("封面读取只返回明确全局和当前IP的数据", () => {
  storage.clear();
  storage.setItem("ipwr:coverRefs", JSON.stringify([
    { id: "global", scope: "global", ipId: null, createdAt: "2026-08-08T10:00:00.000Z" },
    { id: "current", scope: "ip", ipId: "ip-a", createdAt: "2026-08-08T11:00:00.000Z" },
    { id: "other", scope: "ip", ipId: "ip-b", createdAt: "2026-08-08T12:00:00.000Z" },
    { id: "conflict", scope: "global", ipId: "ip-b", createdAt: "2026-08-08T13:00:00.000Z" },
    { id: "legacy", createdAt: "2026-08-08T14:00:00.000Z" },
  ]));

  assert.deepEqual(getCoverRefs("ip-a").map(cover => cover.id), ["current", "global"]);
});

test("没有当前IP或漏传参数时只返回明确全局封面", () => {
  storage.clear();
  storage.setItem("ipwr:coverRefs", JSON.stringify([
    { id: "global", scope: "global", ipId: null, createdAt: "2026-08-08T10:00:00.000Z" },
    { id: "private", scope: "ip", ipId: "ip-a", createdAt: "2026-08-08T11:00:00.000Z" },
    { id: "broken", scope: "ip", ipId: "", createdAt: "2026-08-08T12:00:00.000Z" },
  ]));

  assert.deepEqual(getCoverRefs(null).map(cover => cover.id), ["global"]);
  assert.deepEqual(getCoverRefs().map(cover => cover.id), ["global"]);
});

test("新增封面由数据层强制绑定当前IP", () => {
  storage.clear();

  const created = addCoverRef("ip-a", {
    title: "当前IP封面",
    imageDataUrl: "data:image/png;base64,current",
    platform: "抖音",
    contentType: "知识口播",
    coverType: "大字标题",
    visualTags: ["高对比"],
    textStyle: "短句",
    layout: "中心大标题",
    colorStyle: "黑底黄字",
    referenceReason: "标题清晰",
    avoidReason: "",
    sourceUrl: "",
  });

  assert.equal(created.scope, "ip");
  assert.equal(created.ipId, "ip-a");
  assert.deepEqual(getCoverRefs("ip-a").map(cover => cover.id), [created.id]);
  assert.deepEqual(getCoverRefs("ip-b"), []);
});

test("没有明确当前IP时拒绝新增封面且不写入数据", () => {
  storage.clear();

  assert.throws(() => addCoverRef("", {
    title: "无归属封面",
    imageDataUrl: "",
    platform: "抖音",
    contentType: "知识口播",
    coverType: "大字标题",
    visualTags: [],
    textStyle: "短句",
    layout: "中心大标题",
    colorStyle: "黑底黄字",
    referenceReason: "",
    avoidReason: "",
    sourceUrl: "",
  }), /当前IP/);

  assert.equal(storage.getItem("ipwr:coverRefs"), null);
});

test("调用方伪造归属字段也只能写入当前IP", () => {
  storage.clear();
  const forgedInput = {
    title: "伪造归属封面",
    imageDataUrl: "",
    platform: "抖音",
    contentType: "知识口播",
    coverType: "大字标题",
    visualTags: [],
    textStyle: "短句",
    layout: "中心大标题",
    colorStyle: "黑底黄字",
    referenceReason: "",
    avoidReason: "",
    sourceUrl: "",
    scope: "global" as const,
    ipId: "ip-b",
  };

  const created = addCoverRef("ip-a", forgedInput);

  assert.equal(created.scope, "ip");
  assert.equal(created.ipId, "ip-a");
});

test("当前IP不能删除其他IP的封面且拒绝后数据完全不变", () => {
  storage.clear();
  const original = JSON.stringify([
    { id: "current", scope: "ip", ipId: "ip-a", createdAt: "2026-08-08T11:00:00.000Z" },
    { id: "other", scope: "ip", ipId: "ip-b", createdAt: "2026-08-08T12:00:00.000Z" },
  ]);
  storage.setItem("ipwr:coverRefs", original);

  assert.throws(() => deleteCoverRef("other", "ip-a"), /不属于当前IP/);
  assert.equal(storage.getItem("ipwr:coverRefs"), original);
});

test("全局封面只读且没有当前IP时不能执行删除", () => {
  storage.clear();
  const original = JSON.stringify([
    { id: "global", scope: "global", ipId: null, createdAt: "2026-08-08T10:00:00.000Z" },
    { id: "current", scope: "ip", ipId: "ip-a", createdAt: "2026-08-08T11:00:00.000Z" },
  ]);
  storage.setItem("ipwr:coverRefs", original);

  assert.throws(() => deleteCoverRef("global", "ip-a"), /不属于当前IP/);
  assert.throws(() => deleteCoverRef("current", ""), /当前IP/);
  assert.equal(storage.getItem("ipwr:coverRefs"), original);
});

test("当前IP可以删除自己的封面且只删除目标记录", () => {
  storage.clear();
  storage.setItem("ipwr:coverRefs", JSON.stringify([
    { id: "current", scope: "ip", ipId: "ip-a", createdAt: "2026-08-08T11:00:00.000Z" },
    { id: "other", scope: "ip", ipId: "ip-b", createdAt: "2026-08-08T12:00:00.000Z" },
  ]));

  const deleted = deleteCoverRef("current", "ip-a");

  assert.equal(deleted.id, "current");
  assert.deepEqual(JSON.parse(storage.getItem("ipwr:coverRefs") ?? "[]").map((cover: { id: string }) => cover.id), ["other"]);
});
