import assert from "node:assert/strict";
import test from "node:test";
import { getCoverRefs } from "./ip-store";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
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
  storage.setItem("ipwr:coverRefs", JSON.stringify([
    { id: "global", scope: "global", ipId: null, createdAt: "2026-08-08T10:00:00.000Z" },
    { id: "current", scope: "ip", ipId: "ip-a", createdAt: "2026-08-08T11:00:00.000Z" },
    { id: "other", scope: "ip", ipId: "ip-b", createdAt: "2026-08-08T12:00:00.000Z" },
    { id: "conflict", scope: "global", ipId: "ip-b", createdAt: "2026-08-08T13:00:00.000Z" },
    { id: "legacy", createdAt: "2026-08-08T14:00:00.000Z" },
  ]));

  assert.deepEqual(getCoverRefs("ip-a").map(cover => cover.id), ["current", "global"]);
});
