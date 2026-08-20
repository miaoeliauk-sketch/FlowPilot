import assert from "node:assert/strict";
import test from "node:test";
import { segmentKnowledgeIntakeContent } from "./knowledge-intake-segmentation";

test("Markdown标题长文按完整章节组合为不超过4000字的分段", () => {
  const content = [
    "# 第一章 选题",
    "甲".repeat(2_100),
    "## 第二章 开头",
    "乙".repeat(2_100),
    "### 第三章 结尾",
    "丙".repeat(1_000),
  ].join("\n");

  const result = segmentKnowledgeIntakeContent(content);

  assert.equal(result.status, "ready");
  assert.deepEqual(result.segments.map(segment => segment.title), [
    "第一章 选题",
    "第二章 开头 等2个章节",
  ]);
  assert.ok(result.segments.every(segment => segment.charCount <= 4_000));
  assert.match(result.segments[0]?.content ?? "", /^# 第一章 选题/);
  assert.match(result.segments[1]?.content ?? "", /^## 第二章 开头/);
  assert.match(result.segments[1]?.content ?? "", /### 第三章 结尾/);
});

test("中文章节标志可以作为可靠分段边界", () => {
  const chapterContent = [
    "第一章 定位",
    "甲".repeat(1_800),
    "第二章 选题",
    "乙".repeat(1_800),
    "第三章 开头方法",
    "丙".repeat(1_800),
  ].join("\n");
  const numberedContent = [
    "一、定位",
    "甲".repeat(1_800),
    "二、选题",
    "乙".repeat(1_800),
    "三、开头方法",
    "丙".repeat(1_800),
  ].join("\n");

  const chapterResult = segmentKnowledgeIntakeContent(chapterContent);
  const numberedResult = segmentKnowledgeIntakeContent(numberedContent);

  assert.equal(chapterResult.status, "ready");
  assert.deepEqual(
    chapterResult.segments.flatMap(segment => segment.chapterTitles),
    ["第一章 定位", "第二章 选题", "第三章 开头方法"],
  );
  assert.equal(numberedResult.status, "ready");
  assert.deepEqual(
    numberedResult.segments.flatMap(segment => segment.chapterTitles),
    ["一、定位", "二、选题", "三、开头方法"],
  );
  assert.ok(chapterResult.segments.every(segment => segment.charCount <= 4_000));
  assert.ok(numberedResult.segments.every(segment => segment.charCount <= 4_000));
});

test("无可靠标题结构的长文明确退回手动分段", () => {
  const result = segmentKnowledgeIntakeContent("这是一段连续正文。".repeat(600));

  assert.deepEqual(result, {
    status: "manual_required",
    reason: "no_reliable_headings",
    message: "未识别到可靠的章节结构，请按章节手动分段后导入",
    segments: [],
  });
});

test("自动分段不把代码块中的伪标题当成边界且保留完整内容块", () => {
  const codeBlock = ["```md", "# 代码块中的伪标题", "const value = 1;", "```"].join("\n");
  const tableBlock = ["| 方法 | 用途 |", "| --- | --- |", "| 钩子 | 留人 |"].join("\n");
  const quoteBlock = ["> 这是引用第一行", "> 这是引用第二行"].join("\n");
  const listBlock = [
    "- 列表项一",
    "  # 列表内的伪标题",
    "  这句仍然属于列表项一",
    "- 列表项二",
    "- 列表项三",
  ].join("\n");
  const content = [
    "# 第一章",
    "甲".repeat(1_700),
    codeBlock,
    tableBlock,
    quoteBlock,
    listBlock,
    "## 第二章",
    "乙".repeat(1_900),
    "## 第三章",
    "丙".repeat(900),
  ].join("\n");

  const result = segmentKnowledgeIntakeContent(content);

  assert.equal(result.status, "ready");
  const chapterTitles = result.segments.flatMap(segment => segment.chapterTitles);
  assert.equal(chapterTitles.includes("代码块中的伪标题"), false);
  assert.equal(chapterTitles.includes("列表内的伪标题"), false);
  for (const block of [codeBlock, tableBlock, quoteBlock, listBlock]) {
    assert.equal(result.segments.filter(segment => segment.content.includes(block)).length, 1);
  }
});
