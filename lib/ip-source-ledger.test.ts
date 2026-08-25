import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

beforeEach(async () => {
  const { resetIPSourceLedgerForTests } = await import("./ip-source-ledger");
  await resetIPSourceLedgerForTests();
});

test("同一Source编号已有状态后不能被重新初始化回滚", async () => {
  const {
    advanceIPSourceLedger,
    initializeIPSourceLedger,
  } = await import("./ip-source-ledger");
  const sourceId = `source-ledger-no-reset-${Date.now()}-${Math.random()}`;
  const firstDigest = "1".repeat(64);
  const reviewedDigest = "2".repeat(64);

  assert.equal(await initializeIPSourceLedger({
    sourceId,
    ipId: "ip-ledger-no-reset",
    nonce: 1,
    digest: firstDigest,
  }), true);
  assert.equal(await advanceIPSourceLedger({
    sourceId,
    ipId: "ip-ledger-no-reset",
    expectedNonce: 1,
    expectedDigest: firstDigest,
    nextNonce: 2,
    nextDigest: reviewedDigest,
  }), true);

  assert.equal(await initializeIPSourceLedger({
    sourceId,
    ipId: "ip-ledger-no-reset",
    nonce: 1,
    digest: firstDigest,
  }), false);
});

test("同一进程内的并发账本操作按顺序执行且不会丢失记录", async () => {
  const { initializeIPSourceLedger, getIPSourceLedgerRecord } = await import("./ip-source-ledger");
  const attempts = Array.from({ length: 12 }, (_, index) => initializeIPSourceLedger({
    sourceId: `source-queued-${index}`,
    ipId: "ip-queued",
    nonce: 1,
    digest: String(index).padStart(64, "0"),
  }));

  assert.deepEqual(await Promise.all(attempts), Array(12).fill(true));
  const records = await Promise.all(Array.from(
    { length: 12 },
    (_, index) => getIPSourceLedgerRecord(`source-queued-${index}`),
  ));
  assert.equal(records.every(record => record?.ipId === "ip-queued"), true);
});

test("原子替换失败时保留正式账本且后续队列仍可继续", async () => {
  const {
    advanceIPSourceLedger,
    failNextIPSourceLedgerWriteForTests,
    getIPSourceLedgerRecord,
    initializeIPSourceLedger,
  } = await import("./ip-source-ledger");
  const sourceId = "source-atomic-write";
  const originalDigest = "a".repeat(64);
  const nextDigest = "b".repeat(64);
  assert.equal(await initializeIPSourceLedger({
    sourceId,
    ipId: "ip-atomic-write",
    nonce: 1,
    digest: originalDigest,
  }), true);

  failNextIPSourceLedgerWriteForTests();
  await assert.rejects(
    advanceIPSourceLedger({
      sourceId,
      ipId: "ip-atomic-write",
      expectedNonce: 1,
      expectedDigest: originalDigest,
      nextNonce: 2,
      nextDigest,
    }),
    /模拟账本写入失败/,
  );
  assert.deepEqual(await getIPSourceLedgerRecord(sourceId), {
    kind: "v2",
    ipId: "ip-atomic-write",
    currentNonce: 1,
    lastDigest: originalDigest,
    finalizedDigest: null,
  });
  assert.equal(await advanceIPSourceLedger({
    sourceId,
    ipId: "ip-atomic-write",
    expectedNonce: 1,
    expectedDigest: originalDigest,
    nextNonce: 2,
    nextDigest,
  }), true);
});
