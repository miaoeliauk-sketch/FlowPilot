import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeClipCandidates,
  LiveClipResponseError,
  parseCandidateAnalysisResponse,
  parseTopicAnalysisResponse,
} from "./live-clips-response";
import { buildTranscriptChunks, parseLiveTranscript } from "./live-clips-transcript";
import type { TopicBlock } from "./live-clips-types";

const NOW = "2026-08-11T08:00:00.000Z";

function topicFixture() {
  const parsed = parseLiveTranscript([
    "[00:01:00] 大家能听到吗？",
    "[00:01:08] 知识付费最大的误区，就是天天证明自己懂得多。",
    "[00:01:18] 用户真正购买的是解决具体问题的能力。",
    "[00:01:28] 所以内容建立的不是知识量，而是解决问题的信任。",
    "[00:01:38] 下一段我们讲产品。",
  ].join("\n"));
  const chunk = buildTranscriptChunks("live-1", parsed.paragraphs)[0];
  return { parsed, chunk };
}

test("主题返回严格接受JSON对象，并把时间从原文段落映射到主题块", () => {
  const { parsed, chunk } = topicFixture();
  const result = parseTopicAnalysisResponse(JSON.stringify({
    removalSuggestions: [{ paragraphNumber: 1, quote: "大家能听到吗？", reason: "临时互动" }],
    topics: [{
      title: "知识付费内容建立什么信任",
      summary: "讨论知识量和解决问题能力的区别。",
      startParagraph: 2,
      endParagraph: 4,
      keywords: ["知识付费", "信任", "解决问题"],
      mainPoint: "用户为解决问题的能力付费。",
    }],
  }), {
    liveTranscriptId: "live-1",
    chunk,
    paragraphs: parsed.paragraphs,
    createId: () => "topic-1",
    now: () => NOW,
  });

  assert.equal(result.topics[0].startTime, "00:01:08");
  assert.equal(result.topics[0].endTime, "00:01:38");
  assert.equal(result.topics[0].candidateStatus, "pending");
  assert.equal(result.removalSuggestions[0].quote, "大家能听到吗？");
});

test("Markdown代码块和JSON前后解释文字都按JSON_PARSE_FAIL拒绝", () => {
  const { parsed, chunk } = topicFixture();
  for (const content of [
    "```json\n{\"topics\":[],\"removalSuggestions\":[]}\n```",
    "以下是结果：{\"topics\":[],\"removalSuggestions\":[]}",
  ]) {
    assert.throws(
      () => parseTopicAnalysisResponse(content, {
        liveTranscriptId: "live-1",
        chunk,
        paragraphs: parsed.paragraphs,
      }),
      (error: unknown) => error instanceof LiveClipResponseError && error.code === "JSON_PARSE_FAIL",
    );
  }
});

test("主题缺少必填字段或删除片段不在原文时按SCHEMA_FAIL拒绝", () => {
  const { parsed, chunk } = topicFixture();
  const invalidPayloads = [
    { removalSuggestions: [], topics: [{ title: "缺字段" }] },
    {
      removalSuggestions: [{ paragraphNumber: 1, quote: "AI编造的话", reason: "无效" }],
      topics: [],
    },
  ];
  for (const payload of invalidPayloads) {
    assert.throws(
      () => parseTopicAnalysisResponse(JSON.stringify(payload), {
        liveTranscriptId: "live-1",
        chunk,
        paragraphs: parsed.paragraphs,
      }),
      (error: unknown) => error instanceof LiveClipResponseError && error.code === "SCHEMA_FAIL",
    );
  }
});

test("候选的原始稿和清洗稿全部由原文位置及删除片段生成", () => {
  const { parsed } = topicFixture();
  const topic: TopicBlock = {
    id: "topic-1",
    liveTranscriptId: "live-1",
    title: "知识付费内容建立什么信任",
    summary: "讨论知识量和解决问题能力的区别。",
    startTime: "00:01:08",
    endTime: "00:01:38",
    startParagraph: 2,
    endParagraph: 4,
    keywords: ["知识付费", "信任"],
    mainPoint: "用户为解决问题的能力付费。",
    sourceChunkIds: ["chunk-1"],
    candidateStatus: "pending",
    candidateError: null,
    createdAt: NOW,
  };
  const result = parseCandidateAnalysisResponse(JSON.stringify({
    candidates: [{
      topic: "为什么知识付费不能只证明懂得多",
      clipType: "counterintuitive",
      secondaryTags: ["opinion"],
      recommendation: "强烈建议切",
      dimensions: {
        completeness: "强",
        hookStrength: "强",
        pointClarity: "强",
        informationDensity: "强",
        tension: "中",
        ipFit: "强"
      },
      recommendReason: "观点完整，有清晰反差。",
      startParagraph: 2,
      endParagraph: 4,
      startQuote: "知识付费最大的误区",
      endQuote: "解决问题的信任。",
      corePoint: "用户购买的是解决问题的能力。",
      removeSuggestions: [{ paragraphNumber: 2, quote: "就是天天", reason: "口语冗余" }],
      titleSuggestions: ["知识付费别只讲干货", "用户到底为什么付费", "内容要建立什么信任"],
      coverSuggestions: ["别再证明你懂得多", "用户买的是解决问题"],
    }],
  }), {
    liveTranscriptId: "live-1",
    topic,
    paragraphs: parsed.paragraphs,
    createId: () => "candidate-1",
    now: () => NOW,
  });

  const candidate = result.candidates[0];
  assert.equal(candidate.startTime, "00:01:08");
  assert.equal(candidate.endTime, "00:01:38");
  assert.ok(candidate.rawClipText.startsWith("知识付费最大的误区"));
  assert.ok(candidate.rawClipText.endsWith("解决问题的信任。"));
  assert.ok(candidate.rawClipText.includes("就是天天"));
  assert.ok(!candidate.cleanedClipText.includes("就是天天"));
  assert.ok(parsed.paragraphs.some(paragraph => paragraph.text.includes(candidate.startQuote)));
  assert.ok(parsed.paragraphs.some(paragraph => paragraph.text.includes(candidate.endQuote)));

  const deduped = dedupeClipCandidates([
    { ...candidate, id: "candidate-weaker", recommendation: "可以考虑" },
    candidate,
    { ...candidate, id: "candidate-other-live", liveTranscriptId: "live-2" },
  ]);
  assert.deepEqual(deduped.map(item => item.id), ["candidate-1", "candidate-other-live"]);
});

test("相同语气词出现在不同段落时，按段落身份分别清理", () => {
  const parsed = parseLiveTranscript("嗯第一段先讲问题。\n嗯第二段再讲方法。");
  const topic = {
    id: "topic-voice", liveTranscriptId: "live-1", title: "主题", summary: "摘要",
    startTime: null, endTime: null, startParagraph: 1, endParagraph: 2,
    keywords: ["问题"], mainPoint: "先问题后方法", sourceChunkIds: ["c1"],
    candidateStatus: "pending", candidateError: null, createdAt: NOW,
  } satisfies TopicBlock;
  const payload = {
    candidates: [{
      topic: "先问题后方法", clipType: "method", secondaryTags: [], recommendation: "可以考虑",
      dimensions: { completeness: "强", hookStrength: "中", pointClarity: "强", informationDensity: "中", tension: "弱", ipFit: "强" },
      recommendReason: "结构完整。", startParagraph: 1, endParagraph: 2,
      startQuote: "嗯第一段", endQuote: "再讲方法。", corePoint: "先讲问题再讲方法。",
      removeSuggestions: [
        { paragraphNumber: 1, quote: "嗯", reason: "语气词" },
        { paragraphNumber: 2, quote: "嗯", reason: "语气词" },
      ],
      titleSuggestions: ["标题一", "标题二", "标题三"], coverSuggestions: ["封面一", "封面二"],
    }],
  };

  const result = parseCandidateAnalysisResponse(JSON.stringify(payload), {
    liveTranscriptId: "live-1",
    topic,
    paragraphs: parsed.paragraphs,
    createId: () => "candidate-voice",
    now: () => NOW,
  });

  assert.equal(result.candidates[0].cleanedClipText, "第一段先讲问题。\n第二段再讲方法。");
});

test("候选伪造开始句、时间字段或错误枚举时按SCHEMA_FAIL拒绝", () => {
  const { parsed } = topicFixture();
  const topic = {
    id: "topic-1", liveTranscriptId: "live-1", title: "主题", summary: "摘要",
    startTime: null, endTime: null, startParagraph: 2, endParagraph: 4,
    keywords: ["信任"], mainPoint: "观点", sourceChunkIds: ["c1"],
    candidateStatus: "pending", candidateError: null, createdAt: NOW,
  } satisfies TopicBlock;
  const base = {
    topic: "候选", clipType: "opinion", secondaryTags: [], recommendation: "可以考虑",
    dimensions: { completeness: "强", hookStrength: "中", pointClarity: "强", informationDensity: "中", tension: "中", ipFit: "强" },
    recommendReason: "理由", startParagraph: 2, endParagraph: 4,
    startQuote: "AI写出的漂亮开头", endQuote: "解决问题的信任。", corePoint: "观点",
    removeSuggestions: [], titleSuggestions: ["标题1", "标题2", "标题3"], coverSuggestions: ["封面1", "封面2"],
  };
  for (const candidate of [base, { ...base, startQuote: "知识付费最大的误区", startTime: "00:01:08" }, { ...base, startQuote: "知识付费最大的误区", clipType: "tutorial" }]) {
    assert.throws(
      () => parseCandidateAnalysisResponse(JSON.stringify({ candidates: [candidate] }), {
        liveTranscriptId: "live-1",
        topic,
        paragraphs: parsed.paragraphs,
      }),
      (error: unknown) => error instanceof LiveClipResponseError && error.code === "SCHEMA_FAIL",
    );
  }
});
