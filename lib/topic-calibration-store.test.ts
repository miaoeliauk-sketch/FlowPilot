import assert from "node:assert/strict";
import test from "node:test";
import { getTopicCalibrationSamples } from "./topic-calibration-store";

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

test("没有IP ID时不按名称匹配校准样本", () => {
  storage.setItem("ipwr:topicCalibrationSamples", JSON.stringify([
    { id: "name-only", ipId: "ip-b", ipName: "水木然" },
  ]));

  assert.deepEqual(getTopicCalibrationSamples({ name: "水木然" }), []);
});

test("未选择当前IP时不返回任何IP的校准样本", () => {
  storage.setItem("ipwr:topicCalibrationSamples", JSON.stringify([
    { id: "ip-a-sample", ipId: "ip-a", ipName: "水木然" },
    { id: "ip-b-sample", ipId: "ip-b", ipName: "设计师石空" },
  ]));

  assert.deepEqual(getTopicCalibrationSamples(null), []);
});

test("完全不传IP参数时也不返回任何校准样本", () => {
  storage.setItem("ipwr:topicCalibrationSamples", JSON.stringify([
    { id: "ip-a-sample", ipId: "ip-a", ipName: "水木然" },
    { id: "ip-b-sample", ipId: "ip-b", ipName: "设计师石空" },
  ]));

  assert.deepEqual(getTopicCalibrationSamples(), []);
});
