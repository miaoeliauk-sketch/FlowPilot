import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalSyncManager } from "./local-sync-manager";

async function withTemporaryDataDir(
  run: (dataDir: string) => Promise<void>,
) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "flowpilot-local-sync-"));
  try {
    await run(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

test("本地同步保存白名单内的字符串字段", async () => {
  await withTemporaryDataDir(async dataDir => {
    const manager = new LocalSyncManager({
      dataDir,
      now: () => new Date("2026-08-11T08:00:00.000Z"),
    });

    await manager.update({
      "ipwr:activeIpId": "ip-shuimuran",
      "ipwr:topicAssets": "[]",
    });

    assert.deepEqual(await manager.read(), {
      updatedAt: "2026-08-11T08:00:00.000Z",
      data: {
        "ipwr:activeIpId": "ip-shuimuran",
        "ipwr:topicAssets": "[]",
      },
    });
  });
});

test("快照包含未知字段或错误类型时整次拒绝且不覆盖旧数据", async () => {
  await withTemporaryDataDir(async dataDir => {
    const manager = new LocalSyncManager({ dataDir });
    await manager.update({ "ipwr:activeIpId": "ip-safe" });

    await assert.rejects(
      manager.update({
        "unknown:key": "不应写入",
        "ipwr:scriptAssets": { forged: true },
      }),
      /本地同步快照包含不支持的字段或数据类型/,
    );
    assert.deepEqual((await manager.read()).data, {
      "ipwr:activeIpId": "ip-safe",
    });
  });
});

test("主文件结构损坏时拒绝覆盖并保留原文件", async () => {
  await withTemporaryDataDir(async dataDir => {
    const syncFile = path.join(dataDir, "flowpilot-local-sync.json");
    const damagedContent = JSON.stringify({ updatedAt: 42, data: [] });
    await writeFile(syncFile, damagedContent, "utf8");
    const manager = new LocalSyncManager({ dataDir });

    await assert.rejects(
      manager.update({ "ipwr:activeIpId": "ip-shuimuran" }),
      /本地同步主文件损坏/,
    );
    assert.equal(await readFile(syncFile, "utf8"), damagedContent);
  });
});

test("完整快照可以更新同ID内容、删除旧字段并切换当前IP", async () => {
  await withTemporaryDataDir(async dataDir => {
    const manager = new LocalSyncManager({ dataDir });
    await manager.update({
      "ipwr:activeIpId": "ip-existing",
      "ipwr:topicAssets": JSON.stringify([{ id: "topic-1", title: "原选题" }]),
      "ipwr:scriptAssets": JSON.stringify([{ id: "script-1" }]),
    });

    await manager.update({
      "ipwr:activeIpId": "ip-incoming",
      "ipwr:topicAssets": JSON.stringify([{ id: "topic-1", title: "修改后选题" }]),
    });

    const stored = await manager.read();
    assert.equal(stored.data["ipwr:activeIpId"], "ip-incoming");
    assert.deepEqual(JSON.parse(stored.data["ipwr:topicAssets"]), [
      { id: "topic-1", title: "修改后选题" },
    ]);
    assert.equal(stored.data["ipwr:scriptAssets"], undefined);
  });
});

test("新备份只在managed目录轮转且不碰旧备份", async () => {
  await withTemporaryDataDir(async dataDir => {
    const legacyBackupDir = path.join(dataDir, "backups");
    const legacyBackup = path.join(legacyBackupDir, "legacy-evidence.json");
    await mkdir(legacyBackupDir, { recursive: true });
    await writeFile(legacyBackup, "历史备份", "utf8");
    let tick = 0;
    const manager = new LocalSyncManager({
      dataDir,
      backupLimit: 2,
      now: () => new Date(1_786_435_200_000 + tick++),
    });

    await manager.update({ "ipwr:activeIpId": "ip-1" });
    await manager.update({ "ipwr:topicAssets": "[]" });
    await manager.update({ "ipwr:scriptAssets": "[]" });
    await manager.update({ "ipwr:knowledgeEntries": "[]" });

    const managedFiles = await readdir(path.join(legacyBackupDir, "managed"));
    assert.equal(managedFiles.length, 2);
    assert.equal(await readFile(legacyBackup, "utf8"), "历史备份");
  });
});

test("并发更新按顺序执行且不会互相覆盖", async () => {
  await withTemporaryDataDir(async dataDir => {
    const manager = new LocalSyncManager({ dataDir });

    await Promise.all([
      manager.update({ "ipwr:topicAssets": JSON.stringify([{ id: "topic-1" }]) }),
      manager.update({
        "ipwr:topicAssets": JSON.stringify([{ id: "topic-1" }]),
        "ipwr:scriptAssets": JSON.stringify([{ id: "script-1" }]),
      }),
    ]);

    const stored = await manager.read();
    assert.equal(stored.data["ipwr:topicAssets"], JSON.stringify([{ id: "topic-1" }]));
    assert.equal(stored.data["ipwr:scriptAssets"], JSON.stringify([{ id: "script-1" }]));
  });
});
