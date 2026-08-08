import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getTopicAssets } from "./ip-store";
import {
  saveTopicBoardEvaluation,
  TopicBoardOwnershipError,
} from "./topic-board-history";
import {
  createTopicBoardIPProfile,
  createValidTopicBoardResult,
} from "./topic-board-contract.fixture";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  setItemCalls = 0;
  failOnSetItemCall: number | null = null;
  get length() { return this.data.size; }
  clear() {
    this.data.clear();
    this.setItemCalls = 0;
    this.failOnSetItemCall = null;
  }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) {
    this.setItemCalls += 1;
    if (this.setItemCalls === this.failOnSetItemCall) {
      throw new Error("模拟第二次写入失败");
    }
    this.data.set(key, value);
  }
}

const storage = new MemoryStorage();
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: globalThis,
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

after(() => {
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else delete (globalThis as Record<string, unknown>).window;

  if (previousLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
  } else {
    delete (globalThis as Record<string, unknown>).localStorage;
  }
});

test("合法董事会结果自动保存为发起请求IP的已评估选题", () => {
  storage.clear();
  const requestIP = createTopicBoardIPProfile();
  const result = createValidTopicBoardResult();

  const saved = saveTopicBoardEvaluation(requestIP, result);

  assert.equal(saved.ipId, requestIP.id);
  assert.equal(saved.status, "已评估");
  assert.equal(saved.title, result.topic);
  assert.equal(saved.boardResult?.ipId, requestIP.id);
  assert.equal(saved.evaluationSummary?.totalScore, result.totalScore);
  const storedAssets = getTopicAssets(requestIP.id);
  assert.equal(storedAssets.length, 1);
  const stored = storedAssets[0];
  assert.equal(stored.id, saved.id);
  assert.equal(stored.ipId, requestIP.id);
  assert.equal(stored.status, "已评估");
  assert.equal(stored.boardResult?.ipId, requestIP.id);
  assert.equal(stored.boardResult?.topic, result.topic);
  assert.equal(stored.evaluationSummary?.totalScore, result.totalScore);
  assert.equal(stored.evaluationSummary?.verdict, result.voteResult.verdict);
});

test("格式错误或响应IP错配时拒绝保存且不留下草稿", () => {
  storage.clear();
  const requestIP = createTopicBoardIPProfile();

  assert.throws(
    () => saveTopicBoardEvaluation(requestIP, { contractVersion: 1 }),
    /缺少字段|必须/,
  );
  assert.equal(getTopicAssets(requestIP.id).length, 0);

  const mismatchedResult = createValidTopicBoardResult();
  mismatchedResult.ipId = "ip-other";
  mismatchedResult.ipName = "其他IP";
  assert.throws(
    () => saveTopicBoardEvaluation(requestIP, mismatchedResult),
    (error: unknown) => error instanceof TopicBoardOwnershipError
      && error.code === "IP_ASSIGNMENT_MISMATCH",
  );
  assert.equal(getTopicAssets(requestIP.id).length, 0);
  assert.equal(getTopicAssets("ip-other").length, 0);
});

test("评估结果通过一次写入完整保存，不会因第二次写入失败留下孤立草稿", () => {
  storage.clear();
  storage.failOnSetItemCall = 2;
  const requestIP = createTopicBoardIPProfile();
  const result = createValidTopicBoardResult();

  saveTopicBoardEvaluation(requestIP, result);

  const storedAssets = getTopicAssets(requestIP.id);
  assert.equal(storage.setItemCalls, 1);
  assert.equal(storedAssets.length, 1);
  assert.equal(storedAssets[0].status, "已评估");
  assert.equal(storedAssets[0].boardResult?.topic, result.topic);
  assert.equal(storedAssets[0].evaluationSummary?.verdict, result.voteResult.verdict);
});
