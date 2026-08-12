import assert from "node:assert/strict";
import test from "node:test";
import {
  containsSpecificLiveScheduleOrAddress,
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
      primaryPurpose: "信任建立",
      primaryPurposeEvidence: { paragraphNumber: 4, quote: "解决问题的信任" },
      secondaryPurpose: "流量增长",
      secondaryPurposeEvidence: { paragraphNumber: 2, quote: "知识付费最大的误区" },
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
  assert.equal(candidate.primaryPurpose, "信任建立");
  assert.equal(candidate.primaryPurposeEvidence?.quote, "解决问题的信任");
  assert.equal(candidate.secondaryPurpose, "流量增长");
  assert.equal(candidate.secondaryPurposeEvidence?.quote, "知识付费最大的误区");
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
      recommendReason: "结构完整。", primaryPurpose: "信任建立",
      primaryPurposeEvidence: { paragraphNumber: 1, quote: "第一段先讲问题" },
      secondaryPurpose: null, secondaryPurposeEvidence: null, startParagraph: 1, endParagraph: 2,
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

test("包装建议只拦截具体直播时间和活动地址，不误伤普通城市观点", () => {
  assert.equal(containsSpecificLiveScheduleOrAddress("杭州适合创业的三个原因"), false);
  assert.equal(containsSpecificLiveScheduleOrAddress("合肥投资的长期逻辑"), false);
  assert.equal(containsSpecificLiveScheduleOrAddress("今晚8点直播讲城市选择"), true);
  assert.equal(containsSpecificLiveScheduleOrAddress("8月15日晚上8点开播"), true);
  assert.equal(containsSpecificLiveScheduleOrAddress("20:00开始直播"), true);
  assert.equal(containsSpecificLiveScheduleOrAddress("8点开播"), true);
  assert.equal(containsSpecificLiveScheduleOrAddress("活动在星河酒店3楼举行"), true);
  assert.equal(containsSpecificLiveScheduleOrAddress("地址是中山路88号"), true);
});

test("候选拒绝带具体直播时间的标题和具体活动地址的封面", () => {
  const { parsed } = topicFixture();
  const topic = {
    id: "topic-guard", liveTranscriptId: "live-1", title: "主题", summary: "摘要",
    startTime: null, endTime: null, startParagraph: 2, endParagraph: 4,
    keywords: ["信任"], mainPoint: "观点", sourceChunkIds: ["c1"],
    candidateStatus: "pending", candidateError: null, createdAt: NOW,
  } satisfies TopicBlock;
  const base = {
    topic: "候选", clipType: "opinion", secondaryTags: [], recommendation: "可以考虑",
    dimensions: { completeness: "强", hookStrength: "中", pointClarity: "强", informationDensity: "中", tension: "中", ipFit: "强" },
    recommendReason: "理由", primaryPurpose: "信任建立",
    primaryPurposeEvidence: { paragraphNumber: 4, quote: "解决问题的信任" },
    secondaryPurpose: null, secondaryPurposeEvidence: null,
    startParagraph: 2, endParagraph: 4, startQuote: "知识付费最大的误区", endQuote: "解决问题的信任。",
    corePoint: "观点", removeSuggestions: [],
    titleSuggestions: ["杭州适合创业", "城市选择逻辑", "今晚8点直播讲城市选择"],
    coverSuggestions: ["城市选择", "去星河酒店3楼听分享"],
  };

  for (const candidate of [
    { ...base, coverSuggestions: ["城市选择", "投资逻辑"] },
    { ...base, titleSuggestions: ["杭州适合创业", "城市选择逻辑", "投资长期逻辑"] },
  ]) {
    assert.throws(
      () => parseCandidateAnalysisResponse(JSON.stringify({ candidates: [candidate] }), {
        liveTranscriptId: "live-1", topic, paragraphs: parsed.paragraphs,
      }),
      (error: unknown) => error instanceof LiveClipResponseError && error.code === "SCHEMA_FAIL",
    );
  }
});

test("候选必须有一个主要目的及证据，辅助目的最多一个且不能与主要目的重复", () => {
  const { parsed } = topicFixture();
  const topic = {
    id: "topic-purpose-contract", liveTranscriptId: "live-1", title: "主题", summary: "摘要",
    startTime: null, endTime: null, startParagraph: 2, endParagraph: 4,
    keywords: ["信任"], mainPoint: "观点", sourceChunkIds: ["c1"],
    candidateStatus: "pending", candidateError: null, createdAt: NOW,
  } satisfies TopicBlock;
  const base = {
    topic: "候选", clipType: "opinion", secondaryTags: [], recommendation: "可以考虑",
    dimensions: { completeness: "强", hookStrength: "中", pointClarity: "强", informationDensity: "中", tension: "中", ipFit: "强" },
    recommendReason: "理由", primaryPurpose: "信任建立",
    primaryPurposeEvidence: { paragraphNumber: 4, quote: "解决问题的信任" },
    secondaryPurpose: null, secondaryPurposeEvidence: null,
    startParagraph: 2, endParagraph: 4, startQuote: "知识付费最大的误区", endQuote: "解决问题的信任。",
    corePoint: "观点", removeSuggestions: [],
    titleSuggestions: ["标题一", "标题二", "标题三"], coverSuggestions: ["封面一", "封面二"],
  };
  const invalidCandidates = [
    { ...base, primaryPurpose: undefined },
    { ...base, primaryPurposeEvidence: { paragraphNumber: 4, quote: "AI编造的目的证据" } },
    {
      ...base,
      startQuote: "最大的误区",
      primaryPurposeEvidence: { paragraphNumber: 2, quote: "知识付费" },
    },
    { ...base, secondaryPurpose: "流量增长", secondaryPurposeEvidence: null },
    { ...base, secondaryPurpose: "信任建立", secondaryPurposeEvidence: { paragraphNumber: 2, quote: "知识付费最大的误区" } },
  ];

  for (const candidate of invalidCandidates) {
    assert.throws(
      () => parseCandidateAnalysisResponse(JSON.stringify({ candidates: [candidate] }), {
        liveTranscriptId: "live-1", topic, paragraphs: parsed.paragraphs,
      }),
      (error: unknown) => error instanceof LiveClipResponseError && error.code === "SCHEMA_FAIL",
    );
  }
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
    recommendReason: "理由", primaryPurpose: "信任建立",
    primaryPurposeEvidence: { paragraphNumber: 4, quote: "解决问题的信任" },
    secondaryPurpose: null, secondaryPurposeEvidence: null, startParagraph: 2, endParagraph: 4,
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

test("候选原话追溯失败时返回稳定细分原因码", () => {
  const { parsed } = topicFixture();
  const topic = {
    id: "topic-reason", liveTranscriptId: "live-1", title: "主题", summary: "摘要",
    startTime: null, endTime: null, startParagraph: 2, endParagraph: 4,
    keywords: ["信任"], mainPoint: "观点", sourceChunkIds: ["c1"],
    candidateStatus: "pending", candidateError: null, createdAt: NOW,
  } satisfies TopicBlock;
  const base = {
    topic: "候选", clipType: "opinion", secondaryTags: [], recommendation: "可以考虑",
    dimensions: { completeness: "强", hookStrength: "中", pointClarity: "强", informationDensity: "中", tension: "中", ipFit: "强" },
    recommendReason: "理由", primaryPurpose: "信任建立",
    primaryPurposeEvidence: { paragraphNumber: 4, quote: "解决问题的信任" },
    secondaryPurpose: null, secondaryPurposeEvidence: null,
    startParagraph: 2, endParagraph: 4, startQuote: "知识付费最大的误区", endQuote: "解决问题的信任。",
    corePoint: "观点", removeSuggestions: [],
    titleSuggestions: ["标题一", "标题二", "标题三"], coverSuggestions: ["封面一", "封面二"],
  };
  const cases = [
    [{ ...base, startQuote: "AI编造的开始句" }, "START_QUOTE_NOT_FOUND"],
    [{ ...base, endQuote: "AI编造的结束句" }, "END_QUOTE_NOT_FOUND"],
    [{ ...base, removeSuggestions: [{ paragraphNumber: 3, quote: "AI编造的删除片段", reason: "冗余" }] }, "REMOVAL_QUOTE_NOT_FOUND"],
    [{ ...base, startQuote: "最大的误区", removeSuggestions: [{ paragraphNumber: 2, quote: "知识付费", reason: "冗余" }] }, "REMOVAL_QUOTE_NOT_FOUND"],
    [{ ...base, primaryPurposeEvidence: { paragraphNumber: 3, quote: "AI编造的目的证据" } }, "PURPOSE_EVIDENCE_NOT_FOUND"],
    [{ ...base, clipType: "tutorial" }, "FIELD_INVALID"],
  ] as const;

  for (const [candidate, reasonCode] of cases) {
    assert.throws(
      () => parseCandidateAnalysisResponse(JSON.stringify({ candidates: [candidate] }), {
        liveTranscriptId: "live-1", topic, paragraphs: parsed.paragraphs,
      }),
      (error: unknown) => error instanceof LiveClipResponseError
        && error.code === "SCHEMA_FAIL"
        && error.diagnosticDetails.reasonCode === reasonCode,
    );
  }
});
