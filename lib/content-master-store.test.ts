import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_MASTER_STORAGE_KEY,
  createContentMaster,
  getActiveContentMasterSegments,
  getContentMaster,
  getContentMasterSegment,
  mergeAdjacentContentMasterSegments,
  renameContentMasterSegment,
  splitContentMasterSegment,
  type ContentMasterStorage,
  type ContentMasterWriteLock,
} from "./content-master-store";

class MemoryStorage implements ContentMasterStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const SOURCE_REFS = [
  { id: "source-1", name: "素材1" },
  { id: "source-2", name: "素材2" },
];

const CANDIDATE_SECTIONS = [
  {
    heading: "信任是成交的前提",
    paragraphs: ["客户愿意购买，首先取决于信任是否建立。"],
    sourceIds: ["source-1", "source-2"],
  },
  {
    heading: "信任需要长期积累",
    paragraphs: ["稳定兑现承诺，才能逐步形成信任。"],
    sourceIds: ["source-2"],
  },
];

test("保存母稿时按本地日期分配母稿编号和初始片段编号", async () => {
  const storage = new MemoryStorage();

  const first = await createContentMaster({
    title: "建立客户信任",
    sections: CANDIDATE_SECTIONS,
    sources: SOURCE_REFS,
  }, storage, new Date(2026, 7, 8, 9, 0, 0));
  const second = await createContentMaster({
    title: "第二份母稿",
    sections: CANDIDATE_SECTIONS.slice(0, 1),
    sources: SOURCE_REFS,
  }, storage, new Date(2026, 7, 8, 18, 0, 0));
  const nextDay = await createContentMaster({
    title: "次日母稿",
    sections: CANDIDATE_SECTIONS.slice(0, 1),
    sources: SOURCE_REFS,
  }, storage, new Date(2026, 7, 9, 9, 0, 0));

  assert.equal(first.id, "MG-20260808-001");
  assert.deepEqual(first.segments.map(segment => segment.id), [
    "MG-20260808-001-P01",
    "MG-20260808-001-P02",
  ]);
  assert.equal(second.id, "MG-20260808-002");
  assert.equal(nextDay.id, "MG-20260809-001");
  assert.equal(getContentMaster(first.id, storage)?.fullText,
    "## 信任是成交的前提\n\n客户愿意购买，首先取决于信任是否建立。\n\n## 信任需要长期积累\n\n稳定兑现承诺，才能逐步形成信任。");
});

test("保存母稿时根据已用编号校准落后的本地计数器", async () => {
  const storage = new MemoryStorage();
  const first = await createContentMaster({
    title: "第一份母稿",
    sections: CANDIDATE_SECTIONS,
    sources: SOURCE_REFS,
  }, storage, new Date(2026, 7, 8, 9, 0, 0));
  const stored = JSON.parse(storage.getItem(CONTENT_MASTER_STORAGE_KEY) ?? "{}") as {
    nextDraftSequenceByDate: Record<string, number>;
    drafts: Array<{ nextSegmentSequence: number }>;
  };
  stored.nextDraftSequenceByDate["20260808"] = 1;
  stored.drafts[0].nextSegmentSequence = 1;
  storage.setItem(CONTENT_MASTER_STORAGE_KEY, JSON.stringify(stored));

  const second = await createContentMaster({
    title: "第二份母稿",
    sections: CANDIDATE_SECTIONS.slice(0, 1),
    sources: SOURCE_REFS,
  }, storage, new Date(2026, 7, 8, 10, 0, 0));
  const merged = await mergeAdjacentContentMasterSegments(
    first.id,
    `${first.id}-P01`,
    `${first.id}-P02`,
    "合并后的片段",
    storage,
  );

  assert.equal(second.id, "MG-20260808-002");
  assert.equal(merged.id, `${first.id}-P03`);
});

test("读取时拒绝片段编号重复的损坏母稿数据", async () => {
  const storage = new MemoryStorage();
  const draft = await createContentMaster({
    title: "第一份母稿",
    sections: CANDIDATE_SECTIONS,
    sources: SOURCE_REFS,
  }, storage, new Date(2026, 7, 8, 9, 0, 0));
  const stored = JSON.parse(storage.getItem(CONTENT_MASTER_STORAGE_KEY) ?? "{}") as {
    drafts: Array<{ segments: Array<{ id: string }> }>;
  };
  stored.drafts[0].segments[1].id = stored.drafts[0].segments[0].id;
  storage.setItem(CONTENT_MASTER_STORAGE_KEY, JSON.stringify(stored));

  assert.throws(
    () => getContentMaster(draft.id, storage),
    /内容母稿本地数据格式异常/,
  );
});

test("所有母稿写操作使用同一把跨标签页锁", async () => {
  const storage = new MemoryStorage();
  const lockNames: string[] = [];
  const lock: ContentMasterWriteLock = {
    async request(name, operation) {
      lockNames.push(name);
      return operation();
    },
  };
  const draft = await createContentMaster({
    title: "建立客户信任",
    sections: CANDIDATE_SECTIONS,
    sources: SOURCE_REFS,
  }, storage, new Date(2026, 7, 8, 9, 0, 0), lock);
  await renameContentMasterSegment(
    draft.id,
    `${draft.id}-P01`,
    "先建立信任",
    storage,
    new Date(2026, 7, 8, 10, 0, 0),
    lock,
  );
  const merged = await mergeAdjacentContentMasterSegments(
    draft.id,
    `${draft.id}-P01`,
    `${draft.id}-P02`,
    "信任过程",
    storage,
    new Date(2026, 7, 8, 11, 0, 0),
    lock,
  );
  await splitContentMasterSegment(
    draft.id,
    merged.id,
    merged.content.indexOf("稳定兑现承诺"),
    ["信任前提", "持续兑现"],
    storage,
    new Date(2026, 7, 8, 12, 0, 0),
    lock,
  );

  assert.equal(lockNames.length, 4);
  assert.equal(new Set(lockNames).size, 1);
});

test("合并相邻片段时保留旧编号历史并生成从未使用的新编号", async () => {
  const storage = new MemoryStorage();
  const draft = await createContentMaster({
    title: "建立客户信任",
    sections: CANDIDATE_SECTIONS,
    sources: SOURCE_REFS,
  }, storage, new Date(2026, 7, 8, 9, 0, 0));
  const firstId = `${draft.id}-P01`;
  const secondId = `${draft.id}-P02`;

  await renameContentMasterSegment(draft.id, firstId, "先建立基本信任", storage);
  const merged = await mergeAdjacentContentMasterSegments(
    draft.id,
    firstId,
    secondId,
    "信任的建立过程",
    storage,
    new Date(2026, 7, 8, 10, 0, 0),
  );

  assert.equal(merged.id, `${draft.id}-P03`);
  assert.equal(getContentMasterSegment(firstId, storage)?.status, "已归并");
  assert.equal(getContentMasterSegment(firstId, storage)?.heading, "先建立基本信任");
  assert.equal(getContentMasterSegment(secondId, storage)?.status, "已归并");
  assert.deepEqual(getActiveContentMasterSegments(draft.id, storage).map(segment => segment.id), [
    `${draft.id}-P03`,
  ]);
  assert.deepEqual(merged.sourceIds, ["source-1", "source-2"]);
  assert.equal(merged.content,
    "客户愿意购买，首先取决于信任是否建立。\n\n稳定兑现承诺，才能逐步形成信任。");
  assert.equal(getContentMaster(draft.id, storage)?.fullText,
    "## 信任的建立过程\n\n客户愿意购买，首先取决于信任是否建立。\n\n稳定兑现承诺，才能逐步形成信任。");
});

test("拆分片段时保留旧编号和原文并为两个新片段继续递增编号", async () => {
  const storage = new MemoryStorage();
  const draft = await createContentMaster({
    title: "建立客户信任",
    sections: CANDIDATE_SECTIONS,
    sources: SOURCE_REFS,
  }, storage, new Date(2026, 7, 8, 9, 0, 0));
  const merged = await mergeAdjacentContentMasterSegments(
    draft.id,
    `${draft.id}-P01`,
    `${draft.id}-P02`,
    "信任的建立过程",
    storage,
  );
  const splitAt = merged.content.indexOf("稳定兑现承诺");

  const [first, second] = await splitContentMasterSegment(
    draft.id,
    merged.id,
    splitAt,
    ["信任是购买前提", "信任来自持续兑现"],
    storage,
    new Date(2026, 7, 8, 11, 0, 0),
  );

  assert.equal(first.id, `${draft.id}-P04`);
  assert.equal(second.id, `${draft.id}-P05`);
  assert.equal(first.content, "客户愿意购买，首先取决于信任是否建立。");
  assert.equal(second.content, "稳定兑现承诺，才能逐步形成信任。");
  assert.equal(getContentMasterSegment(merged.id, storage)?.status, "已拆分");
  assert.equal(getContentMasterSegment(merged.id, storage)?.content, merged.content);
  assert.deepEqual(getActiveContentMasterSegments(draft.id, storage).map(segment => segment.id), [
    `${draft.id}-P04`,
    `${draft.id}-P05`,
  ]);
  assert.equal(getContentMaster(draft.id, storage)?.fullText,
    "## 信任是购买前提\n\n客户愿意购买，首先取决于信任是否建立。\n\n## 信任来自持续兑现\n\n稳定兑现承诺，才能逐步形成信任。");
});

test("保存和拆分母稿时按段落保留真实来源而不复制全部来源", async () => {
  const storage = new MemoryStorage();
  const draft = await createContentMaster({
    title: "段落来源母稿",
    sections: [{
      heading: "现象与原因",
      paragraphs: [
        { text: "素材1描述现象。", sourceIds: ["source-1"] },
        { text: "素材2解释原因。", sourceIds: ["source-2"] },
      ],
      sourceIds: ["source-1", "source-2"],
    }],
    sources: SOURCE_REFS,
  }, storage, new Date(2026, 7, 8, 9, 0, 0));
  const original = draft.segments[0];
  const splitAt = original.content.indexOf("素材2");

  const [first, second] = await splitContentMasterSegment(
    draft.id,
    original.id,
    splitAt,
    ["现象", "原因"],
    storage,
  );

  assert.deepEqual(original.paragraphSourceIds, [["source-1"], ["source-2"]]);
  assert.deepEqual(first.sourceIds, ["source-1"]);
  assert.deepEqual(first.paragraphSourceIds, [["source-1"]]);
  assert.deepEqual(second.sourceIds, ["source-2"]);
  assert.deepEqual(second.paragraphSourceIds, [["source-2"]]);
});

test("段落正文含额外空行时保存和拆分仍保持来源对应", async () => {
  const storage = new MemoryStorage();
  const draft = await createContentMaster({
    title: "空行来源母稿",
    sections: [{
      heading: "现象与原因",
      paragraphs: [
        { text: "现象第一层。\n\n现象第二层。", sourceIds: ["source-1"] },
        { text: "原因说明。", sourceIds: ["source-2"] },
      ],
      sourceIds: ["source-1", "source-2"],
    }],
    sources: SOURCE_REFS,
  }, storage, new Date(2026, 7, 8, 9, 0, 0));
  const original = draft.segments[0];

  assert.deepEqual(original.paragraphSourceIds, [["source-1"], ["source-1"], ["source-2"]]);
  const splitAt = original.content.indexOf("原因说明");
  const [first, second] = await splitContentMasterSegment(
    draft.id,
    original.id,
    splitAt,
    ["现象", "原因"],
    storage,
  );

  assert.deepEqual(first.paragraphSourceIds, [["source-1"], ["source-1"]]);
  assert.deepEqual(first.sourceIds, ["source-1"]);
  assert.deepEqual(second.paragraphSourceIds, [["source-2"]]);
  assert.deepEqual(second.sourceIds, ["source-2"]);
});
