import assert from "node:assert/strict";
import test from "node:test";
import { POST as postTopics } from "../app/api/live-clips/topics/route";
import { POST as postCandidates } from "../app/api/live-clips/candidates/route";
import { buildTranscriptChunks, parseLiveTranscript } from "./live-clips-transcript";
import type { TopicBlock } from "./live-clips-types";

function aiResponse(content: string | null, finishReason = "stop") {
  return new Response(JSON.stringify({
    id: "request-live-clips",
    choices: [{ finish_reason: finishReason, message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function fixture() {
  const parsed = parseLiveTranscript([
    "[00:01:00] 大家能听到吗？",
    "[00:01:08] 知识付费最大的误区，就是天天证明自己懂得多。",
    "[00:01:18] 用户真正购买的是解决具体问题的能力。",
    "[00:01:28] 所以内容建立的不是知识量，而是解决问题的信任。",
    "[00:01:38] 下一段我们讲产品。",
  ].join("\n"));
  return { parsed, chunk: buildTranscriptChunks("live-1", parsed.paragraphs)[0] };
}

test("主题路由使用统一结构化调用并返回可追溯主题", async () => {
  const originalFetch = globalThis.fetch;
  const { parsed, chunk } = fixture();
  globalThis.fetch = async () => aiResponse(JSON.stringify({
    removalSuggestions: [{ paragraphNumber: 1, quote: "大家能听到吗？", reason: "临时互动" }],
    topics: [{
      title: "知识付费建立的信任", summary: "讨论用户为什么付费。", startParagraph: 2, endParagraph: 4,
      keywords: ["知识付费", "信任"], mainPoint: "用户购买解决问题的能力。",
    }],
  }));
  try {
    const response = await postTopics(new Request("http://localhost/api/live-clips/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({ liveTranscriptId: "live-1", chunk, paragraphs: parsed.paragraphs }),
    }) as never);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.topics.length, 1);
    assert.equal(body.topics[0].startTime, "00:01:08");
    assert.equal(body.removalSuggestions[0].quote, "大家能听到吗？");
    assert.equal(body.apiMeta.finishReason, "stop");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("即使JSON可解析，finish_reason=length也明确返回TRUNCATED", async () => {
  const originalFetch = globalThis.fetch;
  const { parsed, chunk } = fixture();
  globalThis.fetch = async () => aiResponse(JSON.stringify({ removalSuggestions: [], topics: [] }), "length");
  try {
    const response = await postTopics(new Request("http://localhost/api/live-clips/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({ liveTranscriptId: "live-1", chunk, paragraphs: parsed.paragraphs }),
    }) as never);
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.stageCode, "TOPIC_ANALYSIS_FAIL");
    assert.equal(body.causeCode, "TRUNCATED");
    assert.equal(body.reasonCode, "OUTPUT_TRUNCATED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("候选接口安全透传开始句无法定位的稳定原因码", async () => {
  const originalFetch = globalThis.fetch;
  const { parsed } = fixture();
  const topic: TopicBlock = {
    id: "topic-reason", liveTranscriptId: "live-1", title: "主题", summary: "摘要",
    startTime: null, endTime: null, startParagraph: 2, endParagraph: 4,
    keywords: ["信任"], mainPoint: "观点", sourceChunkIds: ["chunk-1"],
    candidateStatus: "pending", candidateError: null, createdAt: "2026-08-11T00:00:00.000Z",
  };
  const invalidCandidate = {
    topic: "候选", structureRole: "opening", clipType: "opinion", secondaryTags: [], recommendation: "可以考虑",
    dimensions: { completeness: "强", hookStrength: "中", pointClarity: "强", informationDensity: "中", tension: "中", ipFit: "强" },
    recommendReason: "理由", primaryPurpose: "信任建立",
    primaryPurposeEvidence: { paragraphNumber: 4, quote: "解决问题的信任" },
    secondaryPurpose: null, secondaryPurposeEvidence: null,
    startParagraph: 2, endParagraph: 4, startQuote: "AI编造的开始句", endQuote: "解决问题的信任。",
    corePoint: "观点", removeSuggestions: [],
    titleSuggestions: ["标题一", "标题二", "标题三"], coverSuggestions: ["封面一", "封面二"],
  };
  globalThis.fetch = async () => aiResponse(JSON.stringify({ candidates: [invalidCandidate] }));
  try {
    const response = await postCandidates(new Request("http://localhost/api/live-clips/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({ liveTranscriptId: "live-1", topic, paragraphs: parsed.paragraphs }),
    }) as never);
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.causeCode, "SCHEMA_FAIL");
    assert.equal(body.reasonCode, "START_QUOTE_NOT_FOUND");
    assert.equal(body.error, "切片识别失败：开始句无法在原文中定位");
    assert.equal(JSON.stringify(body).includes("AI编造的开始句"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("候选路由拒绝Markdown代码块并区分CLIP_ANALYSIS_FAIL和JSON_PARSE_FAIL", async () => {
  const originalFetch = globalThis.fetch;
  const { parsed } = fixture();
  const topic: TopicBlock = {
    id: "topic-1", liveTranscriptId: "live-1", title: "知识付费建立的信任", summary: "摘要",
    startTime: "00:01:08", endTime: "00:01:38", startParagraph: 2, endParagraph: 4,
    keywords: ["信任"], mainPoint: "用户购买解决问题的能力。", sourceChunkIds: ["chunk-1"],
    candidateStatus: "pending", candidateError: null, createdAt: "2026-08-11T00:00:00.000Z",
  };
  globalThis.fetch = async () => aiResponse("```json\n{\"candidates\":[]}\n```");
  try {
    const response = await postCandidates(new Request("http://localhost/api/live-clips/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({
        liveTranscriptId: "live-1", topic, paragraphs: parsed.paragraphs,
        preferredClipTypes: ["opinion"], targetDuration: "1—3分钟",
        platform: "抖音", ipContext: { name: "彭彭说AI", positioning: "AI内容创作者", audience: "AI新手" },
      }),
    }) as never);
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.stageCode, "CLIP_ANALYSIS_FAIL");
    assert.equal(body.causeCode, "JSON_PARSE_FAIL");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("候选路由把空content明确映射为EMPTY_CONTENT", async () => {
  const originalFetch = globalThis.fetch;
  const { parsed } = fixture();
  const topic: TopicBlock = {
    id: "topic-1", liveTranscriptId: "live-1", title: "主题", summary: "摘要",
    startTime: null, endTime: null, startParagraph: 2, endParagraph: 4,
    keywords: ["信任"], mainPoint: "观点", sourceChunkIds: ["chunk-1"],
    candidateStatus: "pending", candidateError: null, createdAt: "2026-08-11T00:00:00.000Z",
  };
  globalThis.fetch = async () => aiResponse(null);
  try {
    const response = await postCandidates(new Request("http://localhost/api/live-clips/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({ liveTranscriptId: "live-1", topic, paragraphs: parsed.paragraphs }),
    }) as never);
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.causeCode, "EMPTY_CONTENT");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("候选提示词要求唯一结构角色并按成片价值解决分类冲突", async () => {
  const originalFetch = globalThis.fetch;
  const { parsed } = fixture();
  const topic: TopicBlock = {
    id: "topic-purpose", liveTranscriptId: "live-1", title: "知识付费建立的信任", summary: "摘要",
    startTime: "00:01:08", endTime: "00:01:38", startParagraph: 2, endParagraph: 4,
    keywords: ["课程", "信任"], mainPoint: "用户购买解决问题的能力。", sourceChunkIds: ["chunk-1"],
    candidateStatus: "pending", candidateError: null, createdAt: "2026-08-11T00:00:00.000Z",
  };
  let sentBody = "";
  globalThis.fetch = async (_input, init) => {
    sentBody = String(init?.body ?? "");
    return aiResponse(JSON.stringify({ candidates: [] }));
  };
  try {
    const response = await postCandidates(new Request("http://localhost/api/live-clips/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({ liveTranscriptId: "live-1", topic, paragraphs: parsed.paragraphs }),
    }) as never);
    assert.equal(response.status, 200);
    const request = JSON.parse(sentBody) as { messages: Array<{ content: string }> };
    const promptText = request.messages.map(message => message.content).join("\n");
    assert.ok(promptText.includes("仅仅提到课程、产品、价格或直播，不足以自动判定为成交转化或直播导流"));
    assert.ok(promptText.includes("每条候选只能选择一个主要结构角色"));
    assert.ok(promptText.includes("放在成片哪个位置价值最大"));
    assert.ok(promptText.includes("有明确产品价值、购买理由、异议处理或行动引导"));
    assert.ok(promptText.includes("不要为了凑齐四类而生成不值得剪的候选"));
    assert.ok(promptText.includes('"structureRole": "opening|golden_quote|marketing|ending"'));
    assert.ok(promptText.includes("primaryPurposeEvidence"));
    assert.ok(promptText.includes("标题和封面不得出现具体直播日期、钟点或活动地址"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
