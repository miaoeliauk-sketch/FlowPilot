import assert from "node:assert/strict";
import test from "node:test";
import {
  attachManualTranscript,
  buildTranscriptText,
  type TranscriptSource,
} from "./transcription-source";

test("批量抖音逐字稿保留每条原文和来源链接", () => {
  const source: TranscriptSource = {
    kind: "douyin",
    items: [
      { title: "第一条", text: "第一条原文", sourceUrl: "https://v.douyin.com/a/" },
      { title: "第二条", text: "第二条原文", sourceUrl: "https://v.douyin.com/b/" },
    ],
  };
  assert.equal(buildTranscriptText(source), "【第一条】\n第一条原文\n\n【第二条】\n第二条原文");
  assert.deepEqual(source.items.map(item => item.sourceUrl), [
    "https://v.douyin.com/a/",
    "https://v.douyin.com/b/",
  ]);
});

test("手动输入在清洗前补成明确的原文来源", () => {
  const source = attachManualTranscript({ kind: "manual", items: [] }, "未经清洗的原始逐字稿");
  assert.equal(source.kind, "manual");
  assert.equal(source.items[0]?.text, "未经清洗的原始逐字稿");
  const updated = attachManualTranscript(source, "用户返回后修改的原始逐字稿");
  assert.equal(updated.items[0]?.text, "用户返回后修改的原始逐字稿");
});

test("用户编辑合并稿时不覆盖抖音逐条原文", () => {
  const source: TranscriptSource = {
    kind: "douyin",
    items: [{ title: "原视频", text: "原始逐字稿", sourceUrl: "https://v.douyin.com/a/" }],
  };
  assert.equal(attachManualTranscript(source, "编辑后的合并稿").items[0]?.text, "原始逐字稿");
});
