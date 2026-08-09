import assert from "node:assert/strict";
import test from "node:test";
import { addCoverRef, deleteCoverRef, getCoverRefs, getGlobalCoverRefs } from "./ip-store";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  private readFailure = false;
  private writeFailure = false;

  getItem(key: string): string | null {
    if (this.readFailure) throw new Error("模拟存储读取失败");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.writeFailure) throw new Error("模拟存储写入失败");
    this.values.set(key, value);
  }

  clear(): void {
    this.values.clear();
    this.readFailure = false;
    this.writeFailure = false;
  }

  setReadFailure(enabled: boolean): void {
    this.readFailure = enabled;
  }

  setWriteFailure(enabled: boolean): void {
    this.writeFailure = enabled;
  }
}

const storage = new MemoryStorage();
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function coverInput(title: string) {
  return {
    title,
    imageDataUrl: "data:image/png;base64,cover",
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
  };
}

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

test("没有当前IP、漏传参数或传入空白ID时默认拒绝读取", () => {
  storage.clear();
  storage.setItem("ipwr:coverRefs", JSON.stringify([
    { id: "global", scope: "global", ipId: null, createdAt: "2026-08-08T10:00:00.000Z" },
    { id: "private", scope: "ip", ipId: "ip-a", createdAt: "2026-08-08T11:00:00.000Z" },
    { id: "broken", scope: "ip", ipId: "", createdAt: "2026-08-08T12:00:00.000Z" },
  ]));

  assert.deepEqual(getCoverRefs(null), []);
  assert.deepEqual(getCoverRefs(), []);
  assert.deepEqual(getCoverRefs(""), []);
  assert.deepEqual(getCoverRefs("   "), []);
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

test("新增封面遇到重复ID时明确拒绝且不覆盖原数据", () => {
  storage.clear();
  const originalDateNow = Date.now;
  const originalRandom = Math.random;
  Date.now = () => 1_800_000_000_000;
  Math.random = () => 0.25;

  try {
    const first = addCoverRef("ip-a", coverInput("第一张封面"));
    const beforeConflict = storage.getItem("ipwr:coverRefs");

    assert.throws(
      () => addCoverRef("ip-a", coverInput("冲突封面")),
      /重复封面ID/,
    );
    assert.equal(storage.getItem("ipwr:coverRefs"), beforeConflict);
    assert.deepEqual(
      JSON.parse(storage.getItem("ipwr:coverRefs") ?? "[]").map((cover: { id: string }) => cover.id),
      [first.id],
    );
  } finally {
    Date.now = originalDateNow;
    Math.random = originalRandom;
  }
});

test("封面新增或删除写入失败时明确报错且不伪装成功", () => {
  storage.clear();
  storage.setWriteFailure(true);

  assert.throws(
    () => addCoverRef("ip-a", coverInput("无法保存的封面")),
    /封面参考保存失败/,
  );
  assert.equal(storage.getItem("ipwr:coverRefs"), null);

  storage.clear();
  const original = JSON.stringify([
    { id: "current", scope: "ip", ipId: "ip-a", createdAt: "2026-08-08T11:00:00.000Z" },
  ]);
  storage.setItem("ipwr:coverRefs", original);
  storage.setWriteFailure(true);

  assert.throws(
    () => deleteCoverRef("current", "ip-a"),
    /封面参考保存失败/,
  );
  assert.equal(storage.getItem("ipwr:coverRefs"), original);
});

test("通用封面只能通过独立接口读取且排除伪全局数据", () => {
  storage.clear();
  storage.setItem("ipwr:coverRefs", JSON.stringify([
    { id: "global", scope: "global", ipId: null, createdAt: "2026-08-08T10:00:00.000Z" },
    { id: "private", scope: "ip", ipId: "ip-a", createdAt: "2026-08-08T11:00:00.000Z" },
    { id: "forged-global", scope: "global", ipId: "ip-b", createdAt: "2026-08-08T12:00:00.000Z" },
    { id: "legacy", createdAt: "2026-08-08T13:00:00.000Z" },
  ]));

  assert.deepEqual(getGlobalCoverRefs().map(cover => cover.id), ["global"]);
});

test("删除前核对全部同ID记录且任一记录跨IP就拒绝", () => {
  storage.clear();
  const original = JSON.stringify([
    { id: "duplicate", scope: "ip", ipId: "ip-a", createdAt: "2026-08-08T11:00:00.000Z" },
    { id: "duplicate", scope: "ip", ipId: "ip-b", createdAt: "2026-08-08T12:00:00.000Z" },
  ]);
  storage.setItem("ipwr:coverRefs", original);

  assert.throws(
    () => deleteCoverRef("duplicate", "ip-a"),
    /不属于当前IP/,
  );
  assert.equal(storage.getItem("ipwr:coverRefs"), original);
});

test("同一IP存在重复封面ID时拒绝批量删除", () => {
  storage.clear();
  const original = JSON.stringify([
    { id: "duplicate", scope: "ip", ipId: "ip-a", title: "第一条", createdAt: "2026-08-08T11:00:00.000Z" },
    { id: "duplicate", scope: "ip", ipId: "ip-a", title: "第二条", createdAt: "2026-08-08T12:00:00.000Z" },
  ]);
  storage.setItem("ipwr:coverRefs", original);

  assert.throws(
    () => deleteCoverRef("duplicate", "ip-a"),
    /重复封面ID/,
  );
  assert.equal(storage.getItem("ipwr:coverRefs"), original);
});

test("封面存储读取抛错时新增和删除都中止且原数据不变", () => {
  storage.clear();
  const original = JSON.stringify([
    { id: "current", scope: "ip", ipId: "ip-a", createdAt: "2026-08-08T11:00:00.000Z" },
  ]);
  storage.setItem("ipwr:coverRefs", original);
  storage.setReadFailure(true);

  assert.throws(
    () => addCoverRef("ip-a", coverInput("不应覆盖原库")),
    /封面参考读取失败/,
  );
  assert.throws(
    () => deleteCoverRef("current", "ip-a"),
    /封面参考读取失败/,
  );

  storage.setReadFailure(false);
  assert.equal(storage.getItem("ipwr:coverRefs"), original);
});

test("封面存储JSON损坏时新增和删除都中止且原始内容不变", () => {
  storage.clear();
  const corrupted = "{损坏的封面数据";
  storage.setItem("ipwr:coverRefs", corrupted);

  assert.throws(
    () => addCoverRef("ip-a", coverInput("不应覆盖损坏数据")),
    /封面参考读取失败.*数据损坏/,
  );
  assert.throws(
    () => deleteCoverRef("current", "ip-a"),
    /封面参考读取失败.*数据损坏/,
  );
  assert.equal(storage.getItem("ipwr:coverRefs"), corrupted);
});

test("封面存储JSON结构损坏时新增和删除都中止且原始内容不变", () => {
  for (const structurallyCorrupted of ["{}", "null"]) {
    storage.clear();
    storage.setItem("ipwr:coverRefs", structurallyCorrupted);

    assert.throws(
      () => addCoverRef("ip-a", coverInput("不应覆盖结构损坏数据")),
      /封面参考读取失败.*数据损坏/,
    );
    assert.throws(
      () => deleteCoverRef("current", "ip-a"),
      /封面参考读取失败.*数据损坏/,
    );
    assert.equal(storage.getItem("ipwr:coverRefs"), structurallyCorrupted);
  }
});
