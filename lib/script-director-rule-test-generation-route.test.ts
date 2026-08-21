import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST } from "../app/api/script-director-rule/test-generate/route";
import {
  calculateScriptDirectorRuleContentHash,
  createScriptDirectorRule,
  type CreateScriptDirectorRuleInput,
} from "./script-director-rule";
import type { IPProfile } from "./types";

const IP: IPProfile = {
  id: "ip-pengpeng", name: "彭彭说AI", avatar: "彭", positioning: "AI内容创作",
  platforms: ["抖音"], audience: "AI内容创作者", contentDirection: ["AI工具"],
  personaKeywords: ["实用"], professionalIdentity: "AI内容创作者", personalityTags: ["直接"],
  credibilitySource: "持续实测AI工具", representativeViewpoints: ["AI要解决真实问题"], tone: "直接自然",
  commonOpenings: [], commonClosings: [], catchphrases: [], forbiddenExpressions: [], pacing: "短句",
  commonScenes: [], commonShotTypes: [], showsFace: true, usesScreenRecording: true, needsBroll: false,
  needsCaseScreenshots: true, needsSubtitleHighlight: true, sampleViralTitles: [], styleNotes: "先结论后案例",
  bio: "分享AI工具实测", color: "#7656D6", createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
};

function ruleInput(): CreateScriptDirectorRuleInput {
  const item = (id: string, text: string, scope: "opening" | "body" | "ending") => ({
    id, text, level: "quality_warning" as const, enforcement: "prompt_only" as const, scope,
  });
  return {
    ipId: IP.id, name: "彭彭说AI专属编导规则", version: "1.0.0",
    rawMarkdown: "# 专属规则\n\n开头直接给判断，不能使用空泛铺垫。",
    fileName: "rule.md", importedAt: "2026-08-21T10:00:00.000Z",
    profileContext: { ipNameSnapshot: IP.name, source: "ip_profile", usePlatformPositioningFromProfile: true },
    targetAudience: [IP.audience],
    language: { catchphrases: [], forbiddenExpressions: [], toneGuidelines: [item("tone", "表达直接自然", "body")] },
    opening: { requirements: [item("opening", "开头直接给判断", "opening")], forbiddenPatterns: [] },
    body: { reasoningSequence: [], casePolicy: { maximumCasesPerClaim: 1, level: "quality_warning", enforcement: "deterministic", scope: "body", requirements: [] }, materialPolicies: [] },
    ending: { requirements: [item("ending", "结尾回扣开头", "ending")], forbiddenPatterns: [] },
    examples: [],
    compression: { enabled: false, targetReduction: null, mustKeep: [], preferRemove: [], otherRequirements: [] },
    specialRules: [], validationRequirements: [],
  };
}

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/script-director-rule/test-generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
    body: JSON.stringify(body),
  });
}

function aiResponse(content: string): Response {
  return new Response(JSON.stringify({
    id: "test-generation-request",
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 300, completion_tokens: 500, total_tokens: 800 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("测试生成使用当前IP和完整规则原文并只返回临时稿", async () => {
  const rule = await createScriptDirectorRule(ruleInput());
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return aiResponse(JSON.stringify({ title: "普通人用AI最容易踩的坑", fullScript: "AI真正的问题，不是工具太少，而是没有明确任务。" }));
  };

  try {
    const response = await POST(request({
      ipProfile: IP,
      rule,
      testType: "familiar",
      topic: "普通人如何用AI提高效率",
      knowledgeContext: [{
        id: "knowledge-a",
        ipId: IP.id,
        category: "IP原始内容",
        title: "AI工具课程原文",
        rawContent: "老师明确说过：工具必须服务于真实任务。",
      }],
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.result, {
      testType: "familiar",
      topic: "普通人如何用AI提高效率",
      title: "普通人用AI最容易踩的坑",
      fullScript: "AI真正的问题，不是工具太少，而是没有明确任务。",
    });
    assert.equal(body.temporary, true);
    assert.equal(body.apiMeta.apiCalled, true);
    assert.equal(requests.length, 1);
    const messages = requests[0]?.messages;
    assert.equal(Array.isArray(messages), true);
    const promptText = Array.isArray(messages)
      ? messages.map(message => typeof message === "object" && message !== null && "content" in message
        ? String(message.content)
        : "").join("\n")
      : "";
    assert.equal(promptText.includes(rule.source.rawMarkdown), true);
    assert.equal(promptText.includes("AI工具课程原文"), true);
    assert.equal(promptText.includes("工具必须服务于真实任务"), true);
    assert.equal(promptText.includes("测试稿不得进入正式脚本库或学习数据"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("测试生成在调用AI前拒绝混入其他IP的知识条目", async () => {
  const rule = await createScriptDirectorRule(ruleInput());
  const originalFetch = globalThis.fetch;
  let apiCalled = false;
  globalThis.fetch = async () => {
    apiCalled = true;
    return aiResponse("{}");
  };

  try {
    const response = await POST(request({
      ipProfile: IP,
      rule,
      testType: "familiar",
      topic: "普通人如何用AI提高效率",
      knowledgeContext: [{
        id: "knowledge-other",
        ipId: "ip-other",
        category: "IP原始内容",
        title: "其他IP的课程",
        rawContent: "不应进入当前IP测试。",
      }],
    }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.errorField, "knowledgeContext[0].ipId");
    assert.equal(body.apiMeta.apiCalled, false);
    assert.equal(apiCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("测试生成在调用AI前拒绝超长规则原文和IP档案", async () => {
  const oversizedRule = await createScriptDirectorRule(ruleInput());
  oversizedRule.source.rawMarkdown = "规".repeat(50_001);
  oversizedRule.source.contentHash = calculateScriptDirectorRuleContentHash(oversizedRule.source.rawMarkdown);
  const originalFetch = globalThis.fetch;
  let apiCalled = false;
  globalThis.fetch = async () => {
    apiCalled = true;
    return aiResponse("{}");
  };

  try {
    const ruleResponse = await POST(request({
      ipProfile: IP,
      rule: oversizedRule,
      testType: "familiar",
      topic: "测试超长规则",
      knowledgeContext: [],
    }));
    const ruleBody = await ruleResponse.json();
    assert.equal(ruleResponse.status, 400);
    assert.equal(ruleBody.errorField, "rule.source.rawMarkdown");
    assert.equal(ruleBody.apiMeta.apiCalled, false);

    const normalRule = await createScriptDirectorRule(ruleInput());
    const profileResponse = await POST(request({
      ipProfile: { ...IP, styleNotes: "风格".repeat(8_000) },
      rule: normalRule,
      testType: "familiar",
      topic: "测试超长档案",
      knowledgeContext: [],
    }));
    const profileBody = await profileResponse.json();
    assert.equal(profileResponse.status, 400);
    assert.equal(profileBody.errorField, "ipProfile");
    assert.equal(profileBody.apiMeta.apiCalled, false);
    assert.equal(apiCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("测试生成在各字段未单独超限时仍会拦截过大的总提示词", async () => {
  const rule = await createScriptDirectorRule(ruleInput());
  rule.source.rawMarkdown = "规".repeat(49_900);
  rule.source.contentHash = calculateScriptDirectorRuleContentHash(rule.source.rawMarkdown);
  const knowledgeContext = Array.from({ length: 5 }, (_, index) => ({
    id: `knowledge-${index}`,
    ipId: IP.id,
    category: "IP原始内容",
    title: `课程原文${index + 1}`,
    rawContent: "知".repeat(3_500),
  }));
  const originalFetch = globalThis.fetch;
  let apiCalled = false;
  globalThis.fetch = async () => {
    apiCalled = true;
    return aiResponse("{}");
  };

  try {
    const response = await POST(request({
      ipProfile: { ...IP, styleNotes: "风".repeat(13_000) },
      rule,
      testType: "stress",
      topic: "测试总提示词边界",
      knowledgeContext,
    }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.errorField, "request");
    assert.equal(body.apiMeta.apiCalled, false);
    assert.equal(apiCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("测试生成在调用AI前拒绝其他IP的规则", async () => {
  const rule = await createScriptDirectorRule(ruleInput());
  const originalFetch = globalThis.fetch;
  let apiCalled = false;
  globalThis.fetch = async () => {
    apiCalled = true;
    return aiResponse("{}");
  };

  try {
    const response = await POST(request({
      ipProfile: { ...IP, id: "ip-other", name: "其他IP" },
      rule,
      testType: "stress",
      topic: "完全陌生的新行业争议",
    }));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error, "专属规则不属于当前IP，已拒绝测试");
    assert.equal(body.apiMeta.apiCalled, false);
    assert.equal(apiCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
