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
          supplementalKind: "summary_closure", supplementalSuggestion: null,
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

test("补录段落省略无来源字段时仍生成安全的完整成片方案", () => {
  const { parsed, candidates } = fixture();
  const result = parseCompleteVideoPlanResponse(JSON.stringify({
    plans: [{
      title: "知识付费真正卖的是什么",
      recommendReason: "用问题开头并在结尾收束。",
      sections: [{
        role: "opening", sourceType: "supplemental", supplementalKind: "problem_hook",
        transitionNote: "补录后直接进入主体。",
      }, {
        role: "body", sourceType: "transcript", candidateId: "core-1",
        startParagraph: 2, endParagraph: 3, startQuote: "但用户买的不是", endQuote: "证明你能解决。",
        transitionNote: "保留完整论证。",
      }, {
        role: "ending", sourceType: "supplemental", supplementalKind: "summary_closure",
        transitionNote: "单独补录结尾。",
      }],
      editingNotes: [],
    }],
  }), {
    liveTranscriptId: "live-1",
    coreCandidateId: "core-1",
    candidates,
    paragraphs: parsed.paragraphs,
    createId: () => "complete-plan-safe-omission",
    now: () => NOW,
  });

  assert.equal(result.plans[0].sections[0].sourceType, "supplemental");
  assert.equal(result.plans[0].sections[0].candidateId, null);
  assert.equal(result.plans[0].sections[0].startParagraph, null);
  assert.equal(result.plans[0].sections[2].endParagraph, null);
});

test("完整成片接口可以从整场直播补齐候选之外的原片，并返回程序截取的原文", async () => {
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
          role: "ending", sourceType: "transcript",
          startParagraph: 6, endParagraph: 6, startQuote: "先解决一个具体问题", endQuote: "建立起来。",
          supplementalKind: null, supplementalSuggestion: null, transitionNote: "用直播原话收束。",
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
    assert.equal(body.plans[0].sections[2].sourceType, "transcript");
    assert.equal(body.plans[0].sections[2].rawText, "先解决一个具体问题，信任自然会建立起来。");
    const prompt = (JSON.parse(sentBody) as { messages: Array<{ content: string }> }).messages.map(item => item.content).join("\n");
    assert.match(prompt, /同一个核心主题/);
    assert.match(prompt, /只有开头或结尾缺失时/);
    assert.match(prompt, /\[P1\] 很多人以为知识越多/);
    assert.match(prompt, /\[P6\] 先解决一个具体问题/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("完整成片接口只返回安全的主体来源诊断码，不泄露逐字稿", async () => {
  const originalFetch = globalThis.fetch;
  const { parsed, candidates } = fixture();
  globalThis.fetch = async () => aiResponse(JSON.stringify({
    plans: [{
      title: "无效方案",
      recommendReason: "主体引用了错误候选。",
      sections: [{
        role: "opening", sourceType: "supplemental", supplementalKind: "problem_hook",
        transitionNote: "补录开头。",
      }, {
        role: "body", sourceType: "transcript", candidateId: "opening-1",
        startParagraph: 1, endParagraph: 1, startQuote: "很多人以为", endQuote: "越好卖。",
        transitionNote: "错误主体。",
      }, {
        role: "ending", sourceType: "supplemental", supplementalKind: "summary_closure",
        transitionNote: "补录结尾。",
      }],
      editingNotes: [],
    }],
  }));
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
    assert.equal(response.status, 502);
    assert.equal(body.reasonCode, "FIELD_INVALID");
    assert.equal(body.validationCode, "BODY_SOURCE_INVALID");
    assert.equal(body.error, "完整成片方案生成失败：主体没有正确引用当前核心候选");
    assert.equal(JSON.stringify(body).includes("用户买的不是知识数量"), false);
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
    supplementalKind: "summary_closure", supplementalSuggestion: null, transitionNote: "结尾。",
  };
  const invalidSections = [
    [opening, { ...body, candidateId: "opening-1", startParagraph: 1, endParagraph: 1, startQuote: "很多人以为", endQuote: "越好卖。" }, ending],
    [opening, { ...body, startQuote: "AI编造的主体开头" }, ending],
    [{
      ...ending,
      role: "opening",
      supplementalKind: "problem_hook",
      candidateId: "opening-1",
      startParagraph: 1,
      endParagraph: 1,
      startQuote: "很多人以为",
      endQuote: "越好卖。",
    }, body, ending],
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

test("完整成片解析器为常见字段失败保留安全诊断类别", () => {
  const { parsed, candidates } = fixture();
  const validPlan = {
    title: "知识付费真正卖的是什么",
    recommendReason: "从误区讲到解决方法。",
    sections: [{
      role: "opening", sourceType: "supplemental", supplementalKind: "problem_hook",
      transitionNote: "补录开头。",
    }, {
      role: "body", sourceType: "transcript", candidateId: "core-1",
      startParagraph: 2, endParagraph: 3, startQuote: "但用户买的不是", endQuote: "证明你能解决。",
      transitionNote: "保留完整论证。",
    }, {
      role: "ending", sourceType: "supplemental", supplementalKind: "summary_closure",
      transitionNote: "补录结尾。",
    }],
    editingNotes: [],
  };
  const cases: Array<{ expected: string; payload: unknown }> = [
    { expected: "PLAN_COUNT_INVALID", payload: { plans: [] } },
    { expected: "PLAN_FIELD_INVALID", payload: { plans: [{ ...validPlan, title: null }] } },
    { expected: "SECTION_COUNT_INVALID", payload: { plans: [{ ...validPlan, sections: validPlan.sections.slice(0, 2) }] } },
    {
      expected: "SECTION_FIELD_INVALID",
      payload: { plans: [{ ...validPlan, sections: [{ ...validPlan.sections[0], role: "unknown" }, ...validPlan.sections.slice(1)] }] },
    },
    {
      expected: "SOURCE_REFERENCE_INVALID",
      payload: { plans: [{ ...validPlan, sections: [validPlan.sections[0], { ...validPlan.sections[1], candidateId: "missing" }, validPlan.sections[2]] }] },
    },
    {
      expected: "SOURCE_RANGE_INVALID",
      payload: { plans: [{ ...validPlan, sections: [validPlan.sections[0], { ...validPlan.sections[1], endParagraph: 6 }, validPlan.sections[2]] }] },
    },
    {
      expected: "SOURCE_QUOTE_MISSING",
      payload: { plans: [{ ...validPlan, sections: [validPlan.sections[0], { ...validPlan.sections[1], startQuote: null }, validPlan.sections[2]] }] },
    },
    {
      expected: "SUPPLEMENTAL_SECTION_INVALID",
      payload: { plans: [{ ...validPlan, sections: [{ ...validPlan.sections[0], supplementalSuggestion: "AI自由补写" }, ...validPlan.sections.slice(1)] }] },
    },
    {
      expected: "SECTION_STRUCTURE_INVALID",
      payload: { plans: [{ ...validPlan, sections: [validPlan.sections[2], validPlan.sections[1], validPlan.sections[0]] }] },
    },
  ];

  for (const item of cases) {
    assert.throws(
      () => parseCompleteVideoPlanResponse(JSON.stringify(item.payload), {
        liveTranscriptId: "live-1", coreCandidateId: "core-1", candidates, paragraphs: parsed.paragraphs,
      }),
      (error: unknown) => error instanceof LiveClipResponseError
        && error.diagnosticDetails.validationCode === item.expected,
      item.expected,
    );
  }
});
