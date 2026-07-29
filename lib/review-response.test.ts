import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/review/analyze/route";
import {
  parseReviewResponse,
  ReviewResponseError,
} from "./review-response";

const VALID_REVIEW_RESPONSE = {
  layer1: {
    grade: "A",
    performanceType: "潜力款",
    highlights: ["点赞率高于历史均值"],
    weaknesses: ["转发量偏低"],
    scoringBasis: "播放量10000，点赞量800，综合评为A级",
  },
  layer2: {
    hasViralPotential: true,
    confidenceTier: "高可信度",
    reasoning: "互动数据表现较好",
    dataEvidence: "点赞率为8%",
    structureEvidence: "开头直接提出问题",
    knowledgeEvidence: "",
  },
  layer3: {
    hasScriptText: true,
    noScriptReason: "",
    titleAnalysis: {
      score: 8,
      feedback: "标题清楚",
      suggestion: "增加结果感",
    },
    hookAnalysis: {
      score: 7,
      feedback: "开头有明确问题",
      suggestion: "进一步压缩",
    },
    middleAnalysis: {
      score: 7,
      feedback: "中段有案例",
      suggestion: "补充数据",
    },
    endingAnalysis: {
      score: 6,
      feedback: "结尾有行动引导",
      suggestion: "降低引导门槛",
    },
  },
  layer4: {
    hasHistoricalData: true,
    noHistoryReason: "",
    betterMetrics: ["播放量高于历史均值"],
    worseMetrics: ["收藏量低于历史均值"],
    changeReason: "可能与标题表达更直接有关",
    avgHistoricalViews: 6000,
    avgHistoricalLikes: 400,
    avgHistoricalComments: 60,
    avgHistoricalFavorites: 100,
  },
  layer5: {
    successPatterns: ["问题开头与高点赞率有直接支撑"],
    failurePatterns: ["转发引导不足"],
    reusableFormulas: ["痛点问题+案例拆解+行动建议"],
  },
  layer6: {
    continueSuggestions: ["继续使用问题型开头"],
    stopSuggestions: [],
    optimizeSuggestions: ["增加可转发的清单"],
    recommendedTopics: ["普通人最容易踩的三个误区"],
    recommendedTitles: ["别再这样做了，三个误区一次讲清"],
  },
};

function deepSeekResponse(content: string) {
  return new Response(JSON.stringify({
    id: "review-request",
    choices: [{
      finish_reason: "stop",
      message: { content },
    }],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 300,
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function reviewRequest(body: unknown) {
  return new NextRequest("http://localhost/api/review/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "test-key",
    },
    body: JSON.stringify(body),
  });
}

test("parseReviewResponse accepts a complete six-layer response", () => {
  assert.deepEqual(
    parseReviewResponse(JSON.stringify(VALID_REVIEW_RESPONSE)),
    VALID_REVIEW_RESPONSE,
  );
});

test("parseReviewResponse rejects truncated JSON", () => {
  assert.throws(
    () => parseReviewResponse('{"layer1":'),
    (error: unknown) =>
      error instanceof ReviewResponseError &&
      error.code === "invalid_json",
  );
});

test("parseReviewResponse rejects a response missing layer6", () => {
  const { layer6: _layer6, ...incomplete } = VALID_REVIEW_RESPONSE;
  assert.throws(
    () => parseReviewResponse(JSON.stringify(incomplete)),
    (error: unknown) =>
      error instanceof ReviewResponseError &&
      error.code === "incomplete_fields",
  );
});

test("parseReviewResponse rejects an invalid nested score", () => {
  const invalid = structuredClone(VALID_REVIEW_RESPONSE);
  invalid.layer3.hookAnalysis.score = 11;
  assert.throws(
    () => parseReviewResponse(JSON.stringify(invalid)),
    (error: unknown) =>
      error instanceof ReviewResponseError &&
      error.code === "incomplete_fields",
  );
});

test("review POST accepts the page contract and returns layer1 through layer6", async () => {
  const originalFetch = globalThis.fetch;
  let outboundBody = "";
  globalThis.fetch = async (_input, init) => {
    outboundBody = String(init?.body ?? "");
    return deepSeekResponse(JSON.stringify(VALID_REVIEW_RESPONSE));
  };

  try {
    const response = await POST(reviewRequest({
      title: "三个常见误区",
      platform: "抖音",
      contentDirection: "经验分享",
      scriptText: "你是不是也踩过这三个坑？今天一次讲清。",
      metrics: {
        views: 10000,
        likes: 800,
        comments: 120,
        favorites: 200,
        shares: 80,
        newFollowers: 50,
        dms: 10,
        leads: 4,
        conversions: 1,
      },
      historicalAvg: {
        count: 3,
        views: 6000,
        likes: 400,
        comments: 60,
        favorites: 100,
      },
      ipContext: {
        name: "测试IP",
        positioning: "知识分享",
        contentDirection: ["经验分享"],
      },
      knowledgeContext: [{
        id: "knowledge-1",
        title: "问题型开头",
        category: "爆款案例",
      }],
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    for (let layer = 1; layer <= 6; layer += 1) {
      assert.ok(body[`layer${layer}`], `response should contain layer${layer}`);
    }
    assert.equal(body.hasScript, true);
    assert.equal(body.apiMeta.attempts, 1);
    assert.match(outboundBody, /三个常见误区/);
    assert.match(outboundBody, /历史均值/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("review POST rejects the hot-analysis input contract", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse(JSON.stringify(VALID_REVIEW_RESPONSE));
  };

  try {
    const response = await POST(reviewRequest({
      inputType: "transcript",
      inputRaw: "这是一段爆款分析逐字稿",
    }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /标题|真实数据/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
