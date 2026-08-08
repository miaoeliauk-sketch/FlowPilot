import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_MASTER_STORAGE_KEY,
  createContentMaster,
  getContentMaster,
  type ContentMasterStorage,
  type ContentMasterWriteLock,
} from "./content-master-store";
import {
  createFlowPilotBackup,
  restoreFlowPilotBackup,
} from "./settings-backup";

class MemoryStorage implements ContentMasterStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test("设置页备份可以完整导出并恢复内容母稿", async () => {
  const sourceStorage = new MemoryStorage();
  const draft = await createContentMaster({
    title: "客户信任母稿",
    sections: [{
      heading: "信任是成交的前提",
      paragraphs: ["客户愿意购买，首先取决于信任是否建立。"],
      sourceIds: ["source-1"],
    }],
    sources: [{ id: "source-1", name: "素材1" }],
  }, sourceStorage, new Date(2026, 7, 8, 9, 0, 0));

  const backup = createFlowPilotBackup(sourceStorage, new Date("2026-08-08T02:00:00.000Z"));
  const exportedMasters = backup[CONTENT_MASTER_STORAGE_KEY] as {
    drafts?: Array<{ id?: string }>;
  };
  assert.equal(exportedMasters.drafts?.[0]?.id, draft.id);

  const restoredStorage = new MemoryStorage();
  const restoredCount = await restoreFlowPilotBackup(backup, restoredStorage);
  assert.equal(restoredCount, 1);
  assert.equal(getContentMaster(draft.id, restoredStorage)?.title, "客户信任母稿");
});

test("恢复备份前完整校验母稿数据并避免部分覆盖", async () => {
  const storage = new MemoryStorage();
  storage.setItem("ipwr:activeIpId", JSON.stringify("existing-ip"));
  const malformedBackup = {
    _meta: { version: "1.0" },
    "ipwr:activeIpId": "replacement-ip",
    [CONTENT_MASTER_STORAGE_KEY]: {
      schemaVersion: 1,
      drafts: [{
        id: "MG-20260808-001",
        title: "损坏的母稿",
        fullText: "正文",
        sources: [],
        segments: [{
          id: "MG-20260808-001-P01",
          heading: "片段",
          content: "正文",
          order: 1,
          sourceIds: [],
          status: "正常",
        }],
        nextSegmentSequence: null,
        createdAt: "2026-08-08T01:00:00.000Z",
        updatedAt: "2026-08-08T01:00:00.000Z",
      }],
      nextDraftSequenceByDate: { "20260808": 2 },
    },
  };

  await assert.rejects(
    restoreFlowPilotBackup(malformedBackup, storage),
    /内容母稿备份数据格式异常/,
  );
  assert.equal(storage.getItem("ipwr:activeIpId"), JSON.stringify("existing-ip"));
  assert.equal(storage.getItem(CONTENT_MASTER_STORAGE_KEY), null);
});

test("包含母稿的备份恢复与母稿编辑共用跨标签页锁", async () => {
  const sourceStorage = new MemoryStorage();
  const lockNames: string[] = [];
  const lock: ContentMasterWriteLock = {
    async request(name, operation) {
      lockNames.push(name);
      return operation();
    },
  };
  await createContentMaster({
    title: "客户信任母稿",
    sections: [{
      heading: "信任是成交的前提",
      paragraphs: ["客户愿意购买，首先取决于信任是否建立。"],
      sourceIds: ["source-1"],
    }],
    sources: [{ id: "source-1", name: "素材1" }],
  }, sourceStorage, new Date(2026, 7, 8, 9, 0, 0), lock);
  const backup = createFlowPilotBackup(sourceStorage);

  await restoreFlowPilotBackup(backup, new MemoryStorage(), lock);

  assert.equal(lockNames.length, 2);
  assert.equal(new Set(lockNames).size, 1);
});
