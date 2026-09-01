import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as createSourceSnapshot } from "../app/api/script-factory/sources/route";
import {
  failNextScriptSourceSnapshotWriteForTests,
} from "./script-factory-source-snapshot-server";

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/script-factory/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function withSourceLedger(run: (context: {
  directory: string;
  ledgerFile: string;
}) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-script-source-snapshot-"));
  const ledgerFile = path.join(directory, "ledger.json");
  const previous = process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE;
  process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE = ledgerFile;
  try {
    await run({ directory, ledgerFile });
  } finally {
    if (previous === undefined) delete process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE;
    else process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

test("没有显式确认老师本人原文时拒绝创建来源编号", async () => {
  await withSourceLedger(async () => {
    const response = await createSourceSnapshot(request({
      inputIntent: "teacher_original",
      ipId: "ip-shuimuran",
      title: "为什么物质越发达，我们反而越焦虑",
      rawContent: "物质越发达，人反而越焦虑。",
      idempotencyKey: "source-without-confirmation",
    }));
    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.code, "TEACHER_ORIGINAL_CONFIRMATION_REQUIRED");
  });
});

test("显式确认后由服务端创建绑定正文的老师原文来源编号", async () => {
  await withSourceLedger(async () => {
    const response = await createSourceSnapshot(request({
      inputIntent: "teacher_original",
      confirmation: "TEACHER_ORIGINAL_CONFIRMED",
      ipId: "ip-shuimuran",
      title: "为什么物质越发达，我们反而越焦虑",
      rawContent: "物质越发达，人反而越焦虑。",
      idempotencyKey: "source-confirmed-001",
    }));
    const result = await response.json();

    assert.equal(response.status, 201);
    assert.equal(result.status, "created");
    assert.match(result.sourceId, /^ipsrc_[0-9a-f-]{36}$/);
    assert.match(result.contentSha256, /^[a-f0-9]{64}$/);
    assert.equal(result.ipId, "ip-shuimuran");
    assert.equal(result.provenance, "user_declared_teacher_original");
    assert.equal(typeof result.rawContent, "undefined");
  });
});

test("来源登记重复请求保持幂等且拒绝同一幂等键替换正文", async () => {
  await withSourceLedger(async () => {
    const body = {
      inputIntent: "teacher_original",
      confirmation: "TEACHER_ORIGINAL_CONFIRMED",
      ipId: "ip-shuimuran",
      title: "为什么物质越发达，我们反而越焦虑",
      rawContent: "物质越发达，人反而越焦虑。",
      idempotencyKey: "source-idempotent-001",
    };
    const firstResponse = await createSourceSnapshot(request(body));
    const firstResult = await firstResponse.json();
    const repeatedResponse = await createSourceSnapshot(request(body));
    const repeatedResult = await repeatedResponse.json();

    assert.equal(firstResponse.status, 201);
    assert.equal(repeatedResponse.status, 201);
    assert.deepEqual(repeatedResult, firstResult);

    const conflictResponse = await createSourceSnapshot(request({
      ...body,
      rawContent: "这是一份被替换过的正文。",
    }));
    const conflict = await conflictResponse.json();
    assert.equal(conflictResponse.status, 409);
    assert.equal(conflict.code, "SOURCE_IDEMPOTENCY_CONFLICT");
  });
});

test("浏览器不能指定来源编号或正文哈希", async () => {
  await withSourceLedger(async () => {
    const response = await createSourceSnapshot(request({
      inputIntent: "teacher_original",
      confirmation: "TEACHER_ORIGINAL_CONFIRMED",
      ipId: "ip-shuimuran",
      title: "老师原文",
      rawContent: "这是一份老师原文。",
      idempotencyKey: "source-forged-id-001",
      sourceId: "ipsrc_browser_forged",
      contentSha256: "0".repeat(64),
    }));
    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.code, "INVALID_SOURCE_REQUEST");
  });
});

test("来源登记拒绝超长IP编号标题和幂等键", async () => {
  await withSourceLedger(async () => {
    const base = {
      inputIntent: "teacher_original",
      confirmation: "TEACHER_ORIGINAL_CONFIRMED",
      ipId: "ip-shuimuran",
      title: "老师原文",
      rawContent: "这是一份老师原文。",
      idempotencyKey: "source-valid-length",
    };
    for (const body of [
      { ...base, ipId: "i".repeat(129) },
      { ...base, title: "标".repeat(301) },
      { ...base, idempotencyKey: "k".repeat(201) },
    ]) {
      const response = await createSourceSnapshot(request(body));
      const result = await response.json();
      assert.equal(response.status, 400);
      assert.equal(result.code, "INVALID_SOURCE_REQUEST");
    }
  });
});

test("同一服务进程内的并发登记会排队写入且不丢失来源", async () => {
  await withSourceLedger(async () => {
    const requests = Array.from({ length: 12 }, (_, index) => ({
      inputIntent: "teacher_original",
      confirmation: "TEACHER_ORIGINAL_CONFIRMED",
      ipId: "ip-shuimuran",
      title: `并发老师原文${index + 1}`,
      rawContent: `这是第${index + 1}份并发登记的老师原文。`,
      idempotencyKey: `source-concurrent-${index + 1}`,
    }));
    const responses = await Promise.all(requests.map(body => createSourceSnapshot(request(body))));
    assert.equal(responses.every(response => response.status === 201), true);
    const results = await Promise.all(responses.map(response => response.json()));
    assert.equal(new Set(results.map(result => result.sourceId)).size, requests.length);

    const ledger = JSON.parse(await readFile(process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE!, "utf8"));
    assert.equal(ledger.sources.length, requests.length);
    assert.equal(ledger.idempotencyRecords.length, requests.length);
  });
});

test("单进程部署不会读取或依赖跨进程锁文件", async () => {
  await withSourceLedger(async ({ ledgerFile }) => {
    const externalLockFile = `${ledgerFile}.lock`;
    await writeFile(externalLockFile, "这是旧版跨进程锁遗留文件", { encoding: "utf8", mode: 0o600 });

    const response = await createSourceSnapshot(request({
      inputIntent: "teacher_original",
      confirmation: "TEACHER_ORIGINAL_CONFIRMED",
      ipId: "ip-shuimuran",
      title: "单进程来源登记",
      rawContent: "当前架构只由单个FlowPilot服务实例写入账本。",
      idempotencyKey: "source-single-process-boundary",
    }));

    assert.equal(response.status, 201);
    assert.equal(await readFile(externalLockFile, "utf8"), "这是旧版跨进程锁遗留文件");
  });
});

test("损坏账本中的重复悬空或错配关联全部拒绝读取", async () => {
  const corruptions: Array<{
    name: string;
    apply: (ledger: {
      sources: Array<Record<string, unknown>>;
      idempotencyRecords: Array<Record<string, unknown>>;
    }) => void;
  }> = [
    {
      name: "来源编号重复",
      apply: ledger => { ledger.sources.push({ ...ledger.sources[0] }); },
    },
    {
      name: "幂等键重复",
      apply: ledger => { ledger.idempotencyRecords.push({ ...ledger.idempotencyRecords[0] }); },
    },
    {
      name: "幂等记录悬空",
      apply: ledger => { ledger.idempotencyRecords[0].sourceId = "ipsrc_99999999-9999-4999-8999-999999999999"; },
    },
    {
      name: "请求哈希与来源错配",
      apply: ledger => { ledger.idempotencyRecords[0].requestHash = "0".repeat(64); },
    },
  ];

  for (const corruption of corruptions) {
    await withSourceLedger(async ({ ledgerFile }) => {
      const initial = await createSourceSnapshot(request({
        inputIntent: "teacher_original",
        confirmation: "TEACHER_ORIGINAL_CONFIRMED",
        ipId: "ip-a",
        title: "原始标题",
        rawContent: "原始正文",
        idempotencyKey: `valid-before-${corruption.name}`,
      }));
      assert.equal(initial.status, 201);
      const ledger = JSON.parse(await readFile(ledgerFile, "utf8"));
      corruption.apply(ledger);
      await writeFile(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

      const response = await createSourceSnapshot(request({
        inputIntent: "teacher_original",
        confirmation: "TEACHER_ORIGINAL_CONFIRMED",
        ipId: "ip-b",
        title: "新正文",
        rawContent: "新正文内容",
        idempotencyKey: `new-after-${corruption.name}`,
      }));
      const result = await response.json();

      assert.equal(response.status, 500, corruption.name);
      assert.equal(result.code, "SOURCE_LEDGER_READ_FAILED", corruption.name);
      assert.match(result.error, /读取|损坏/, corruption.name);
    });
  }
});

test("账本写入失败时返回准确错误且不会留下假成功来源", async () => {
  await withSourceLedger(async ({ ledgerFile }) => {
    const body = {
      inputIntent: "teacher_original",
      confirmation: "TEACHER_ORIGINAL_CONFIRMED",
      ipId: "ip-shuimuran",
      title: "无法落盘的老师原文",
      rawContent: "这次写入必须失败。",
      idempotencyKey: "source-write-failure",
    };
    failNextScriptSourceSnapshotWriteForTests();
    const response = await createSourceSnapshot(request(body));
    const result = await response.json();

    assert.equal(response.status, 500);
    assert.equal(result.code, "SOURCE_LEDGER_WRITE_FAILED");
    assert.equal(typeof result.sourceId, "undefined");

    const retried = await createSourceSnapshot(request(body));
    const retriedResult = await retried.json();
    assert.equal(retried.status, 201);
    assert.match(retriedResult.sourceId, /^ipsrc_[0-9a-f-]{36}$/);
    const ledger = JSON.parse(await readFile(ledgerFile, "utf8"));
    assert.equal(ledger.sources.length, 1);
    assert.equal(ledger.idempotencyRecords.length, 1);
  });
});

test("正文变化并使用新幂等键时创建新来源且旧来源仍可重放", async () => {
  await withSourceLedger(async () => {
    const base = {
      inputIntent: "teacher_original",
      confirmation: "TEACHER_ORIGINAL_CONFIRMED",
      ipId: "ip-shuimuran",
      title: "老师原文",
    };
    const firstBody = {
      ...base,
      rawContent: "第一版老师原文。",
      idempotencyKey: "source-version-one",
    };
    const secondBody = {
      ...base,
      rawContent: "第二版老师原文。",
      idempotencyKey: "source-version-two",
    };
    const first = await createSourceSnapshot(request(firstBody));
    const firstResult = await first.json();
    const second = await createSourceSnapshot(request(secondBody));
    const secondResult = await second.json();
    const replay = await createSourceSnapshot(request(firstBody));
    const replayResult = await replay.json();

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.notEqual(secondResult.sourceId, firstResult.sourceId);
    assert.equal(replay.status, 201);
    assert.equal(replayResult.sourceId, firstResult.sourceId);
    assert.notEqual(replayResult.sourceId, secondResult.sourceId);
    assert.equal((await readFile(process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE!, "utf8")).includes(firstResult.sourceId), true);
  });
});
