import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/script-factory/route";
import type { IPProfile } from "./types";

const IP: IPProfile = {
  id: "ip-attribution",
  name: "测试老师",
  avatar: "测",
  positioning: "商业观察",
  platforms: ["视频号"],
  audience: "创业者",
  contentDirection: ["商业"],
  personaKeywords: [],
  professionalIdentity: "作者",
  personalityTags: [],
  credibilitySource: "公开写作",
  representativeViewpoints: [],
  tone: "克制",
  commonOpenings: [],
  commonClosings: [],
  catchphrases: [],
  forbiddenExpressions: [],
  pacing: "递进",
  commonScenes: [],
  commonShotTypes: [],
  showsFace: true,
  usesScreenRecording: false,
  needsBroll: false,
  needsCaseScreenshots: false,
  needsSubtitleHighlight: false,
  sampleViralTitles: [],
  styleNotes: "",
  bio: "",
  color: "#000000",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

const CONTENT = {
  titles: [{
    title: "真正值得关注的变化",
    formula: "对象＋悬念",
    platform: "视频号",
    whyFitsIP: "承接老师原有判断",
  }],
  coverCopy: ["变化已经发生"],
  outline: [{
    label: "课程导入",
    timeRange: "0—30秒",
    content: "很多人只看见结果发生变化，却没有追问推动结果变化的原因。老师原来谈过这个判断，这里先把问题讲清楚。",
    subPoints: [],
  }],
  commentGuidance: {
    interactionPrompt: "你观察到了什么变化？",
    keywordReplies: [],
    dmGuidance: "",
    materialPackGuidance: "",
  },
  ipStyleExplanation: "从具体问题进入判断。",
  pendingVerification: ["案例中的增长数字仍需核验"],
};

function deepSeekResponse(content: unknown, id: string): Response {
  return new Response(JSON.stringify({
    id,
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 200 },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function requestFor(
  coverage: "FULL" | "PARTIAL" | "NONE",
  sourceReferences: Array<Record<string, string>>,
): NextRequest {
  return new NextRequest("http://localhost/api/script-factory", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "test-key",
    },
    body: JSON.stringify({
      generationMode: "ip",
      ipProfile: IP,
      topic: "变化背后的原因",
      formatCategory: "course",
      needsStoryboard: false,
      needsShootingTips: false,
      evidenceGate: {
        coverage,
        coveredDimensions: coverage === "NONE" ? [] : ["核心判断"],
        missingDimensions: coverage === "FULL" ? [] : ["推理过程"],
        evidenceConfirmed: coverage === "FULL",
        limitationsAcknowledged: coverage !== "FULL",
        caseNeed: coverage === "FULL" ? "NOT_NEEDED" : "NOT_ASSESSED",
        caseDecision: coverage === "FULL" ? "skip" : null,
        sourceReferences,
        // 客户端即使伪造正式稿身份，服务端也必须忽略。
        outputStatus: "formal",
      },
    }),
  });
}

test("PARTIAL生成后由独立审计返回待审核身份，并单独返回事实核验状态", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return deepSeekResponse(JSON.stringify(CONTENT), "content");
    if (calls === 2) return deepSeekResponse(JSON.stringify({ issues: [] }), "argument-review");
    return deepSeekResponse(JSON.stringify({
      paragraphs: [{
        paragraphId: "S1-P1",
        attributionType: "faithful_rewrite",
        sourceReferences: [{ sourceId: "source-1", itemId: "claim-1" }],
        reason: "段落忠实承接老师明确表达的核心判断。",
      }],
    }), "attribution-audit");
  };

  try {
    const response = await POST(requestFor("PARTIAL", [{
      sourceId: "source-1",
      sourceTitle: "老师直播原文",
      itemId: "claim-1",
      kind: "claim",
      content: "结果变化之前，判断方式已经变化。",
      originalExcerpt: "不要只看结果，要看结果背后的判断方式。",
      extractionStatus: "人工确认",
    }]));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 3);
    assert.equal(body.attributionAudit.outputStatus, "review");
    assert.equal(body.attributionAudit.confidenceLevel, "medium");
    assert.deepEqual(body.attributionAudit.coveredDimensions, ["核心判断"]);
    assert.deepEqual(body.attributionAudit.missingDimensions, ["推理过程"]);
    assert.equal(body.attributionAudit.paragraphAttributions[0].attributionType, "faithful_rewrite");
    assert.equal(body.factAudit.overallStatus, "pending");
    assert.equal(body.factAudit.systemVerified, false);
    assert.deepEqual(body.factAudit.pendingItems, ["案例中的增长数字仍需核验"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("NONE生成结果由服务端固定为探索稿和低置信度", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return deepSeekResponse(JSON.stringify(CONTENT), "content");
    if (calls === 2) return deepSeekResponse(JSON.stringify({ issues: [] }), "argument-review");
    return deepSeekResponse(JSON.stringify({
      paragraphs: [{
        paragraphId: "S1-P1",
        attributionType: "ai_reasoning",
        sourceReferences: [],
        reason: "当前没有老师原始观点依据。",
      }],
    }), "attribution-audit");
  };

  try {
    const response = await POST(requestFor("NONE", []));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.attributionAudit.outputStatus, "exploratory");
    assert.equal(body.attributionAudit.confidenceLevel, "low");
    assert.equal(body.attributionAudit.paragraphAttributions[0].attributionType, "ai_reasoning");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("独立归属审计失败时保守降级为待审核和低置信度", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return deepSeekResponse(JSON.stringify(CONTENT), "content");
    if (calls === 2) return deepSeekResponse(JSON.stringify({ issues: [] }), "argument-review");
    return deepSeekResponse("不是合法审计结果", "attribution-audit");
  };

  try {
    const response = await POST(requestFor("FULL", [
      {
        sourceId: "source-1", sourceTitle: "老师直播原文", itemId: "claim-1", kind: "claim",
        content: "结果变化之前，判断方式已经变化。", originalExcerpt: "不要只看结果。", extractionStatus: "人工确认",
      },
      {
        sourceId: "source-1", sourceTitle: "老师直播原文", itemId: "reasoning-1", kind: "reasoning",
        content: "判断方式决定选择。", originalExcerpt: "判断方式会改变人的选择。", extractionStatus: "人工确认",
      },
    ]));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.attributionAudit.auditStatus, "unavailable");
    assert.equal(body.attributionAudit.outputStatus, "review");
    assert.equal(body.attributionAudit.confidenceLevel, "low");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
