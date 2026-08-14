import assert from "node:assert/strict";
import test from "node:test";
import { POST as postCompletePlans } from "../app/api/live-clips/complete-plans/route";
import { parseCompleteVideoPlanResponse } from "./live-clips-complete-plan";
import { LiveClipResponseError } from "./live-clips-response";
import { parseLiveTranscript } from "./live-clips-transcript";

const NOW = "2026-08-14T08:00:00.000Z";

function fixture() {
  const parsed = parseLiveTranscript([
    "很多人以为知识越多，课程就越好卖。",
    "但用户买的不是知识数量，而是解决具体问题的能力。",
    "所以先讲清楚用户的问题，再证明你能解决。",
    "真正值钱的不是你懂多少，而是你能帮他改变多少。",
    "如果你需要一套完整方法，课程里有逐步练习。",
    "先解决一个具体问题，信任自然会建立起来。",
  ].join("\n"));
  const candidates = [
    { id: "opening-1", liveTranscriptId: "live-1", startParagraph: 1, endParagraph: 1, removeSuggestions: [] },
    { id: "core-1", liveTranscriptId: "live-1", startParagraph: 2, endParagraph: 3, removeSuggestions: [] },
    { id: "quote-1", liveTranscriptId: "live-1", startParagraph: 4, endParagraph: 4, removeSuggestions: [] },
    { id: "marketing-1", liveTranscriptId: "live-1", startParagraph: 5, endParagraph: 5, removeSuggestions: [] },
  ];
  return { parsed, candidates };
}

function aiResponse(content: string, finishReason = "stop") {
  return new Response(JSON.stringify({
    id: "request-complete-plan",
    choices: [{ finish_reason: finishReason, message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("完整成片方案按开头到结尾组织可追溯原文，并明确标记补录结尾", () => {
  const { parsed, candidates } = fixture();
  const result = parseCompleteVideoPlanResponse(JSON.stringify({
    plans: [{
      title: "知识付费真正卖的是什么",
      recommendReason: "从误区切入，用方法和金句建立信任，再自然承接课程。",
      sections: [
        {
          role: "opening", sourceType: "transcript", candidateId: "opening-1",
          startParagraph: 1, endParagraph: 1, startQuote: "很多人以为", endQuote: "越好卖。",
          supplementalSuggestion: null, transitionNote: "直接切入误区。",
        },
        {
          role: "body", sourceType: "transcript", candidateId: "core-1",
          startParagraph: 2, endParagraph: 3, startQuote: "但用户买的不是", endQuote: "证明你能解决。",
          supplementalSuggestion: null, transitionNote: "解释原因并给出方法。",
        },
        {
          role: "golden_quote", sourceType: "transcript", candidateId: "quote-1",
          startParagraph: 4, endParagraph: 4, startQuote: "真正值钱的", endQuote: "改变多少。",
          supplementalSuggestion: null, transitionNote: "作为记忆点停顿强调。",
        },
        {
          role: "marketing", sourceType: "transcript", candidateId: "marketing-1",
          startParagraph: 5, endParagraph: 5, startQuote: "如果你需要", endQuote: "逐步练习。",
          supplementalSuggestion: null, transitionNote: "只保留原文中的真实承接。",
        },
        {
          role: "ending", sourceType: "supplemental", candidateId: null,
          startParagraph: null, endParagraph: null, startQuote: null, endQuote: null,
          supplementalSuggestion: "补录一句对核心观点的自然收束，不增加新的事实或承诺。",
          transitionNote: "单独补录，不冒充直播原话。",
        },
      ],
      editingNotes: ["不同原片之间使用直接跳切", "金句后停顿半秒"],
    }],
  }), {
    liveTranscriptId: "live-1",
    coreCandidateId: "core-1",
    candidates,
    paragraphs: parsed.paragraphs,
    createId: () => "complete-plan-1",
    now: () => NOW,
  });

  const plan = result.plans[0];
  assert.equal(plan.id, "complete-plan-1");
  assert.deepEqual(plan.sections.map(section => section.role), ["opening", "body", "golden_quote", "marketing", "ending"]);
  assert.equal(plan.sections[0].rawText, "很多人以为知识越多，课程就越好卖。");
  assert.equal(plan.sections[0].startTime, null);
  assert.equal(plan.sections[0].endTime, null);
  assert.equal(plan.sections[1].rawText, "但用户买的不是知识数量，而是解决具体问题的能力。\n所以先讲清楚用户的问题，再证明你能解决。");
  assert.equal(plan.sections[4].rawText, null);
  assert.equal(plan.sections[4].sourceType, "supplemental");
  assert.match(plan.sections[4].supplementalSuggestion ?? "", /补录/);
  assert.equal(plan.createdAt, NOW);
});

test("完整成片接口只组合当前直播候选，并返回程序截取的原文", async () => {
  const originalFetch = globalThis.fetch;
  const { parsed, candidates } = fixture();
  let sentBody = "";
  globalThis.fetch = async (_input, init) => {
    sentBody = String(init?.body ?? "");
    return aiResponse(JSON.stringify({
      plans: [{
        title: "知识付费真正卖的是什么",
        recommendReason: "同一主题从误区讲到解决方法。",
        sections: [{
          role: "opening", sourceType: "transcript", candidateId: "opening-1",
          startParagraph: 1, endParagraph: 1, startQuote: "很多人以为", endQuote: "越好卖。",
          supplementalSuggestion: null, transitionNote: "直接进入误区。",
        }, {
          role: "body", sourceType: "transcript", candidateId: "core-1",
          startParagraph: 2, endParagraph: 3, startQuote: "但用户买的不是", endQuote: "证明你能解决。",
          supplementalSuggestion: null, transitionNote: "解释核心原因。",
        }, {
          role: "ending", sourceType: "supplemental", candidateId: null,
          startParagraph: null, endParagraph: null, startQuote: null, endQuote: null,
          supplementalSuggestion: "补录一句自然收束，不增加事实。", transitionNote: "明确标记补录。",
        }],
        editingNotes: ["原片之间直接跳切"],
      }],
    }));
  };
  try {
    const requestCandidates = candidates.map((candidate, index) => ({
      ...candidate,
      topic: ["误区开头", "核心方法", "传播金句", "课程承接"][index],
      corePoint: ["指出误区", "用户购买解决问题的能力", "强调改变", "自然承接课程"][index],
      structureRole: ["opening", "golden_quote", "golden_quote", "marketing"][index],
      recommendation: "强烈建议切",
    }));
    const response = await postCompletePlans(new Request("http://localhost/api/live-clips/complete-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({
        liveTranscriptId: "live-1",
        coreCandidateId: "core-1",
        candidates: requestCandidates,
        paragraphs: parsed.paragraphs,
        platform: "抖音",
        targetDuration: "1—3分钟",
      }),
    }) as never);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.plans[0].sections[0].rawText, "很多人以为知识越多，课程就越好卖。");
    assert.equal(body.plans[0].sections[2].sourceType, "supplemental");
    const prompt = (JSON.parse(sentBody) as { messages: Array<{ content: string }> }).messages.map(item => item.content).join("\n");
    assert.match(prompt, /同一个核心主题/);
    assert.match(prompt, /只有开头或结尾缺失时/);
    assert.match(prompt, /\[P1\] 很多人以为知识越多/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("完整成片方案拒绝换核心主体、重复原文、伪造原话和营销补录", () => {
  const { parsed, candidates } = fixture();
  const opening = {
    role: "opening", sourceType: "transcript", candidateId: "opening-1",
    startParagraph: 1, endParagraph: 1, startQuote: "很多人以为", endQuote: "越好卖。",
    supplementalSuggestion: null, transitionNote: "开头。",
  };
  const body = {
    role: "body", sourceType: "transcript", candidateId: "core-1",
    startParagraph: 2, endParagraph: 3, startQuote: "但用户买的不是", endQuote: "证明你能解决。",
    supplementalSuggestion: null, transitionNote: "主体。",
  };
  const ending = {
    role: "ending", sourceType: "supplemental", candidateId: null,
    startParagraph: null, endParagraph: null, startQuote: null, endQuote: null,
    supplementalSuggestion: "补录自然收束。", transitionNote: "结尾。",
  };
  const invalidSections = [
    [opening, { ...body, candidateId: "opening-1", startParagraph: 1, endParagraph: 1, startQuote: "很多人以为", endQuote: "越好卖。" }, ending],
    [opening, { ...body, startQuote: "AI编造的主体开头" }, ending],
    [
      { ...opening, candidateId: "core-1", startParagraph: 2, endParagraph: 2, startQuote: "但用户买的不是", endQuote: "解决具体问题的能力。" },
      body,
      ending,
    ],
    [opening, body, {
      ...ending, role: "marketing", supplementalSuggestion: "补录一个课程优惠承诺。",
    }, ending],
  ];

  for (const sections of invalidSections) {
    assert.throws(
      () => parseCompleteVideoPlanResponse(JSON.stringify({
        plans: [{ title: "无效方案", recommendReason: "无效", sections, editingNotes: [] }],
      }), {
        liveTranscriptId: "live-1", coreCandidateId: "core-1", candidates, paragraphs: parsed.paragraphs,
      }),
      (error: unknown) => error instanceof LiveClipResponseError && error.code === "SCHEMA_FAIL",
    );
  }
});
