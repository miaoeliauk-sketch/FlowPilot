import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST } from "../app/api/script-director-rule/parse/route";

const VALID_ANALYSIS = {
  targetAudience: ["希望用AI提高内容效率的创作者"],
  language: {
    catchphrases: [],
    forbiddenExpressions: [{
      id: "forbidden-1",
      text: "不能使用空泛开头",
      level: "quality_warning",
      enforcement: "deterministic",
      scope: "opening",
    }],
    toneGuidelines: [],
  },
  opening: { requirements: [], forbiddenPatterns: [] },
  body: {
    reasoningSequence: [],
    casePolicy: {
      maximumCasesPerClaim: 2,
      level: "quality_warning",
      enforcement: "deterministic",
      scope: "body",
      requirements: [],
    },
    materialPolicies: [],
  },
  ending: { requirements: [], forbiddenPatterns: [] },
  examples: [],
  compression: {
    enabled: true,
    targetReduction: {
      minimumPercent: 20,
      maximumPercent: 30,
      level: "quality_warning",
      enforcement: "deterministic",
      scope: "compression",
    },
    mustKeep: [],
    preferRemove: [],
    otherRequirements: [],
  },
  specialRules: [],
  validationRequirements: [],
};

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/script-director-rule/parse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "fake-key-for-tests",
    },
    body: JSON.stringify(body),
  });
}

function deepSeekResponse(content: string): Response {
  return new Response(JSON.stringify({
    id: "director-parse-request",
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 200, completion_tokens: 500, total_tokens: 700 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("规则解析接口通过统一结构化调用返回当前IP的预览草稿", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return deepSeekResponse(JSON.stringify(VALID_ANALYSIS));
  };

  try {
    const response = await POST(request({
      ipProfile: {
        id: "ip-pengpeng",
        name: "彭彭说AI",
        audience: "AI内容创作者",
      },
      rawMarkdown: "# 彭彭说AI专属编导规则\n\n禁止空泛开头。",
      fileName: "彭彭说AI规则.md",
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.rule.ipId, "ip-pengpeng");
    assert.equal(body.rule.status, "draft");
    assert.equal(body.rule.source.rawMarkdown.includes("禁止空泛开头"), true);
    assert.equal(body.rule.profileContext.usePlatformPositioningFromProfile, true);
    assert.equal(body.rule.compression.targetReduction.level, "quality_warning");
    assert.equal(body.apiMeta.apiCalled, true);
    assert.equal(requestBodies.length, 1);
    assert.deepEqual(requestBodies[0]?.thinking, { type: "disabled" });
    assert.deepEqual(requestBodies[0]?.response_format, { type: "json_object" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("目标受众超长时在调用AI前拒绝请求", async () => {
  const originalFetch = globalThis.fetch;
  let apiCalled = false;
  globalThis.fetch = async () => {
    apiCalled = true;
    return deepSeekResponse(JSON.stringify(VALID_ANALYSIS));
  };

  try {
    const response = await POST(request({
      ipProfile: {
        id: "ip-pengpeng",
        name: "彭彭说AI",
        audience: "受众".repeat(501),
      },
      rawMarkdown: "# 彭彭说AI专属编导规则\n\n禁止空泛开头。",
      fileName: null,
    }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.errorField, "ipProfile.audience");
    assert.equal(body.apiMeta.apiCalled, false);
    assert.equal(apiCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
