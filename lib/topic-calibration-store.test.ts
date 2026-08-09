import assert from "node:assert/strict";
import test from "node:test";
import {
  getTopicCalibrationSamples,
  hasExpectedShikongTopicCalibrationSamples,
  upsertShikongTopicCalibrationSamples,
} from "./topic-calibration-store";

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

test.beforeEach(() => {
  storage.clear();
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

test("校准样本只按IP ID匹配并拒绝同名或相似名称的其他IP", () => {
  storage.setItem("ipwr:topicCalibrationSamples", JSON.stringify([
    { id: "current", ipId: "ip-a", ipName: "任意旧名称" },
    { id: "same-name", ipId: "ip-b", ipName: "水木然" },
    { id: "similar-name", ipId: "ip-c", ipName: "水木然设计" },
    { id: "legacy-name-only", ipId: null, ipName: "水木然" },
  ]));

  assert.deepEqual(
    getTopicCalibrationSamples({ id: "ip-a", name: "水木然" }).map(sample => sample.id),
    ["current"],
  );
});

test("没有明确IP ID时不返回任何校准样本", () => {
  storage.setItem("ipwr:topicCalibrationSamples", JSON.stringify([
    { id: "name-only", ipId: "ip-b", ipName: "水木然" },
  ]));

  assert.deepEqual(getTopicCalibrationSamples({ name: "水木然" }), []);
  assert.deepEqual(getTopicCalibrationSamples(null), []);
  assert.deepEqual(getTopicCalibrationSamples(undefined), []);
  assert.deepEqual(getTopicCalibrationSamples(), []);
});

test("找不到石空IP时不写入无归属的校准样本", () => {
  storage.setItem("ipwr:ips_v2", JSON.stringify([
    { id: "ip-other", name: "水木然" },
  ]));

  const result = upsertShikongTopicCalibrationSamples();

  assert.equal(result.ipMatched, false);
  assert.equal(result.ipId, null);
  assert.equal(result.total, 0);
  assert.equal(storage.getItem("ipwr:topicCalibrationSamples"), null);
});

test("存在多个石空候选IP时不擅自绑定且不改写现有数据", () => {
  storage.setItem("ipwr:ips_v2", JSON.stringify([
    { id: "ip-shikong-a", name: "设计师石空" },
    { id: "ip-shikong-b", name: "石空设计" },
  ]));
  const originalSamples = JSON.stringify([
    { id: "existing", ipId: "ip-existing", ipName: "其他IP" },
  ]);
  storage.setItem("ipwr:topicCalibrationSamples", originalSamples);

  const result = upsertShikongTopicCalibrationSamples();

  assert.equal(result.ipMatched, false);
  assert.equal(result.ipId, null);
  assert.equal(result.total, 0);
  assert.equal(storage.getItem("ipwr:topicCalibrationSamples"), originalSamples);
});

test("唯一石空IP存在时所有导入样本都绑定到该IP", () => {
  storage.setItem("ipwr:ips_v2", JSON.stringify([
    { id: "ip-shikong", name: "设计师石空" },
  ]));

  const result = upsertShikongTopicCalibrationSamples();
  const imported = getTopicCalibrationSamples({ id: "ip-shikong", name: "设计师石空" });

  assert.equal(result.ipMatched, true);
  assert.equal(result.ipId, "ip-shikong");
  assert.ok(result.total > 0);
  assert.equal(imported.length, result.total);
  assert.equal(imported.every(sample => sample.ipId === "ip-shikong"), true);
});

test("预期校准样本必须仍归属于当前唯一石空IP", () => {
  storage.setItem("ipwr:ips_v2", JSON.stringify([
    { id: "ip-shikong", name: "设计师石空" },
  ]));
  upsertShikongTopicCalibrationSamples();
  assert.equal(hasExpectedShikongTopicCalibrationSamples(), true);

  storage.setItem("ipwr:ips_v2", JSON.stringify([
    { id: "ip-replacement", name: "水木然" },
  ]));

  assert.equal(hasExpectedShikongTopicCalibrationSamples(), false);
});
