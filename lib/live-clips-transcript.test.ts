import assert from "node:assert/strict";
import test from "node:test";
import {
  applyVerifiedRemovals,
  buildTranscriptChunks,
  deriveSourceLocation,
  extractClipText,
  mergeAdjacentTopicBlocks,
  parseLiveTranscript,
} from "./live-clips-transcript";
import type { TopicBlock } from "./live-clips-types";

test("解析括号时间码、主播时间码和字幕时间范围，只使用原文里的真实时间", () => {
  const parsed = parseLiveTranscript([
    "[00:01:05] 大家晚上好",
    "00:01:12 主播：今天讲账号定位。",
    "00:01:20,000 --> 00:01:28,500",
    "定位不是给自己贴标签。",
  ].join("\n"));

  assert.equal(parsed.hasTimecode, true);
  assert.deepEqual(
    parsed.paragraphs.map(paragraph => [paragraph.paragraphNumber, paragraph.startTime, paragraph.endTime]),
    [
      [1, "00:01:05", null],
      [2, "00:01:12", null],
      [3, "00:01:20", "00:01:28"],
    ],
  );
  assert.equal(parsed.paragraphs[2].text, "定位不是给自己贴标签。");

  const location = deriveSourceLocation(parsed.paragraphs, 2, 2);
  assert.equal(location.startTime, "00:01:12");
  assert.equal(location.endTime, "00:01:20");
  assert.equal(location.durationBasis, "actual");
  assert.equal(location.estimatedDurationSeconds, 8);
});

test("单独占一行的方括号时间码会绑定到下一段正文", () => {
  const parsed = parseLiveTranscript([
    "[00:21:17]",
    "很多人做账号的时候，第一步就做错了。",
    "[21:29]",
    "他们先去追热点。",
  ].join("\n"));

  assert.equal(parsed.hasTimecode, true);
  assert.deepEqual(parsed.paragraphs.map(paragraph => paragraph.startTime), ["00:21:17", "00:21:29"]);
});

test("无时间逐字稿强制返回空时间，只保留段落位置和文字量估算", () => {
  const parsed = parseLiveTranscript("很多人做账号时先追爆款。\n但冷启动阶段更重要的是定位。\n定位决定你长期讲什么。");
  const location = deriveSourceLocation(parsed.paragraphs, 1, 3);

  assert.equal(parsed.hasTimecode, false);
  assert.equal(location.startTime, null);
  assert.equal(location.endTime, null);
  assert.equal(location.durationBasis, "text-estimate");
  assert.ok((location.estimatedDurationSeconds ?? 0) > 0);
});

test("长文本按完整句子分段和分块，相邻块只重叠已存在的完整段落", () => {
  const raw = Array.from({ length: 36 }, (_, index) => `这是第${index + 1}个完整观点，每个观点都应该保持句子完整。`).join("");
  const parsed = parseLiveTranscript(raw, { maxParagraphChars: 90 });
  const chunks = buildTranscriptChunks("live-1", parsed.paragraphs, {
    targetChars: 220,
    maxChars: 300,
    overlapParagraphs: 2,
    overlapChars: 120,
  });

  assert.ok(parsed.paragraphs.length > 3);
  assert.ok(chunks.length > 1);
  assert.ok(chunks[1].paragraphNumbers[0] >= chunks[0].ownedEndParagraph - 1);
  assert.ok(chunks[1].paragraphNumbers[0] <= chunks[0].ownedEndParagraph);
  assert.ok(chunks.every(chunk => chunk.text.length <= 420));
  assert.ok(parsed.paragraphs.every(paragraph => paragraph.text.endsWith("。")));
});

test("清洗稿只能删除能在指定原文段落中唯一找到的片段", () => {
  const parsed = parseLiveTranscript("大家听得到吗？今天讲定位。\n定位不是贴标签，就是选择长期解决的问题。");
  const cleaned = applyVerifiedRemovals(parsed.paragraphs, [{
    paragraphNumber: 1,
    quote: "大家听得到吗？",
    reason: "临时互动",
  }]);

  assert.equal(cleaned, "今天讲定位。\n定位不是贴标签，就是选择长期解决的问题。");
  assert.throws(() => applyVerifiedRemovals(parsed.paragraphs, [{
    paragraphNumber: 2,
    quote: "原文里不存在的话",
    reason: "无效",
  }]), /无法在原文中唯一定位/);

  const overlapping = parseLiveTranscript("重复重复核心观点。");
  assert.throws(() => applyVerifiedRemovals(overlapping.paragraphs, [
    { paragraphNumber: 1, quote: "重复重复", reason: "重复句" },
    { paragraphNumber: 1, quote: "复重", reason: "重复句" },
  ]), /相互重叠/);
});

test("切片原稿由开始句和结束句在原文段落中截取", () => {
  const parsed = parseLiveTranscript("前面的寒暄。知识付费最大的误区，就是证明自己懂得多。\n中间解释用户真正购买的是什么。\n所以内容建立的是解决问题的信任。后面的互动。");
  const clip = extractClipText(parsed.paragraphs, {
    startParagraph: 1,
    endParagraph: 3,
    startQuote: "知识付费最大的误区",
    endQuote: "解决问题的信任。",
  });

  assert.equal(clip, [
    "知识付费最大的误区，就是证明自己懂得多。",
    "中间解释用户真正购买的是什么。",
    "所以内容建立的是解决问题的信任。",
  ].join("\n"));
  assert.ok(!clip.includes("前面的寒暄"));
  assert.ok(!clip.includes("后面的互动"));
});

test("只合并来源相邻且关键词高度一致的主题块", () => {
  const base = {
    liveTranscriptId: "live-1",
    summary: "说明账号定位的核心。",
    mainPoint: "定位决定长期内容。",
    startTime: null,
    endTime: null,
    candidateStatus: "pending" as const,
    candidateError: null,
    createdAt: "2026-08-11T00:00:00.000Z",
  };
  const topics: TopicBlock[] = [
    { ...base, id: "a", title: "账号定位", startParagraph: 1, endParagraph: 3, keywords: ["定位", "账号"], sourceChunkIds: ["c1"] },
    { ...base, id: "b", title: "定位是什么", startParagraph: 4, endParagraph: 6, keywords: ["定位", "账号", "长期"], sourceChunkIds: ["c2"] },
    { ...base, id: "c", title: "直播设备", startParagraph: 7, endParagraph: 9, keywords: ["设备", "灯光"], sourceChunkIds: ["c2"] },
  ];

  const merged = mergeAdjacentTopicBlocks(topics);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].startParagraph, 1);
  assert.equal(merged[0].endParagraph, 6);
  assert.deepEqual(merged[0].sourceChunkIds, ["c1", "c2"]);
  assert.equal(merged[1].id, "c");
});
