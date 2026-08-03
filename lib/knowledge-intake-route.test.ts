import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/knowledge-intake/route";

const BASE_ITEM = {
  title: "账号身份边界",
  summary: "明确账号身份和内容边界",
  category: "IP人设资料",
  ipId: "ip-pengpeng",
  ipMatchStatus: "matched",
  ipMatchReason: "原文明确描述彭彭说AI的身份",
  coreMethod: "先定义专业身份，再明确不能覆盖的内容范围。",
  applicableScenarios: ["账号定位"],
  triggerKeywords: ["身份定位"],
  similarPhrases: ["人设边界"],
  aiUsage: "生成内容前用于校验身份一致性",
  examples: [{ input: "做财经内容", output: "超出当前AI工具分享定位" }],
  unsuitableCases: ["通用方法知识"],
  tags: ["身份", "边界"],
  reusableValue: "用于账号定位和内容审核",
  confidence: "高",
  confidenceReason: "原文有明确身份描述",
  ingestRecommend: "建议入库",
  ingestReason: "属于可复用的IP身份约束",
};

function deepSeekResponse(content: string) {
  return new Response(JSON.stringify({
    id: "knowledge-intake-request",
    choices: [{
      finish_reason: "stop",
      message: { content },
    }],
    usage: {
      prompt_tokens: 80,
      completion_tokens: 120,
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function intakeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/knowledge-intake", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "test-key",
    },
    body: JSON.stringify(body),
  });
}

test("IP专属知识只绑定availableIPs中的合法ID", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => deepSeekResponse(JSON.stringify({
    items: [BASE_ITEM],
  }));

  try {
    const response = await POST(intakeRequest({
      rawContent: "彭彭说AI专注分享AI工具实测，不做财经荐股内容。",
      sourceType: "text",
      activeIPId: "ip-pengpeng",
      availableIPs: [{
        id: "ip-pengpeng",
        name: "彭彭说AI",
        positioning: "AI工具实测",
        contentDirection: ["AI工具"],
      }],
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].category, "IP人设资料");
    assert.equal(body.items[0].ipId, "ip-pengpeng");
    assert.equal(body.items[0].ipMatchStatus, "matched");
    assert.equal(body.apiMeta.attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("通用方法分类强制清空AI返回的ipId", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => deepSeekResponse(JSON.stringify({
    items: [{
      ...BASE_ITEM,
      title: "三秒开头法",
      category: "开头方法库",
      ipId: "ip-pengpeng",
      ipMatchStatus: "matched",
    }],
  }));

  try {
    const response = await POST(intakeRequest({
      rawContent: "开头先抛出用户最关心的问题，再给出明确收益。",
      sourceType: "text",
      activeIPId: "ip-pengpeng",
      availableIPs: [{ id: "ip-pengpeng", name: "彭彭说AI" }],
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.items[0].category, "开头方法库");
    assert.equal(body.items[0].ipId, null);
    assert.equal(body.items[0].ipMatchStatus, "not_applicable");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("IP专属知识返回未知ID时降级为待确认", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => deepSeekResponse(JSON.stringify({
    items: [{
      ...BASE_ITEM,
      ipId: "invented-ip",
      ipMatchStatus: "matched",
      ingestRecommend: "建议入库",
    }],
  }));

  try {
    const response = await POST(intakeRequest({
      rawContent: "这是一份无法确认所属账号的IP身份说明。",
      sourceType: "text",
      activeIPId: "ip-pengpeng",
      availableIPs: [{ id: "ip-pengpeng", name: "彭彭说AI" }],
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.items[0].ipId, null);
    assert.equal(body.items[0].ipMatchStatus, "uncertain");
    assert.equal(body.items[0].ingestRecommend, "待确认");
    assert.match(body.items[0].ipMatchReason, /无法确认|不在可选IP/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI缺少tags和可选数组时安全降级为空数组", async () => {
  const originalFetch = globalThis.fetch;
  const {
    tags: _tags,
    applicableScenarios: _applicableScenarios,
    triggerKeywords: _triggerKeywords,
    similarPhrases: _similarPhrases,
    examples: _examples,
    unsuitableCases: _unsuitableCases,
    ...itemWithoutOptionalArrays
  } = BASE_ITEM;
  globalThis.fetch = async () => deepSeekResponse(JSON.stringify({
    items: [{
      ...itemWithoutOptionalArrays,
      category: "选题方法库",
      ipId: null,
      ipMatchStatus: "not_applicable",
    }],
  }));

  try {
    const response = await POST(intakeRequest({
      rawContent: "从用户明确表达的问题中提炼选题。",
      sourceType: "text",
      availableIPs: [],
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.items[0].tags, []);
    assert.deepEqual(body.items[0].applicableScenarios, []);
    assert.deepEqual(body.items[0].triggerKeywords, []);
    assert.deepEqual(body.items[0].similarPhrases, []);
    assert.deepEqual(body.items[0].examples, []);
    assert.deepEqual(body.items[0].unsuitableCases, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("缺少必填标题会触发重试并接受第二次合法响应", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      const { title: _title, ...missingTitle } = BASE_ITEM;
      return deepSeekResponse(JSON.stringify({ items: [missingTitle] }));
    }
    return deepSeekResponse(JSON.stringify({ items: [BASE_ITEM] }));
  };

  try {
    const response = await POST(intakeRequest({
      rawContent: "彭彭说AI的账号定位资料。",
      sourceType: "text",
      activeIPId: "ip-pengpeng",
      availableIPs: [{ id: "ip-pengpeng", name: "彭彭说AI" }],
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.equal(body.items[0].title, "账号身份边界");
    assert.equal(body.apiMeta.attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("非法置信度会触发重试并接受第二次合法响应", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse(JSON.stringify({
      items: [{
        ...BASE_ITEM,
        confidence: calls === 1 ? "非常确定" : "高",
      }],
    }));
  };

  try {
    const response = await POST(intakeRequest({
      rawContent: "彭彭说AI的账号定位资料。",
      sourceType: "text",
      activeIPId: "ip-pengpeng",
      availableIPs: [{ id: "ip-pengpeng", name: "彭彭说AI" }],
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.equal(body.items[0].confidence, "高");
    assert.equal(body.apiMeta.attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("连续两次非法结构后返回可读错误且不保存半成品", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse(JSON.stringify({
      items: [{ ...BASE_ITEM, ingestRecommend: "立即保存" }],
    }));
  };

  try {
    const response = await POST(intakeRequest({
      rawContent: "一份需要严格校验的知识资料。",
      sourceType: "text",
      availableIPs: [],
    }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(calls, 2);
    assert.equal(body.error, "AI返回格式不完整，已自动重试，请稍后再试");
    assert.equal(body.apiMeta.attempts, 2);
    assert.equal(body.items, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("格式失败只记录安全诊断元信息，不记录正文和IP内容", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warningArgs: unknown[][] = [];
  const privateContent = "这是一段不能进入日志的私密文章正文";
  const privateIPName = "不能进入日志的IP名称";
  const privateIPId = "private-ip-id";
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: "knowledge-intake-truncated",
    choices: [{
      finish_reason: "length",
      message: { content: '{"items":[' },
    }],
    usage: {
      prompt_tokens: 80,
      completion_tokens: 2000,
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  console.warn = (...args: unknown[]) => {
    warningArgs.push(args);
  };

  try {
    const response = await POST(intakeRequest({
      rawContent: privateContent,
      sourceType: "text",
      activeIPId: privateIPId,
      availableIPs: [{ id: privateIPId, name: privateIPName }],
    }));
    const body = await response.json();
    const warningPayload = JSON.parse(String(warningArgs[0]?.[1])) as {
      inputChars: number;
      failureCode: string;
      attempts: Array<{
        finishReason: string | null;
        failureCode?: string;
      }>;
    };
    const serializedWarnings = JSON.stringify(warningArgs);

    assert.equal(response.status, 500);
    assert.equal(body.apiMeta.attempts, 2);
    assert.equal(body.apiMeta.failureCode, "INVALID_JSON");
    assert.match(body.apiMeta.diagnosticId, /^[0-9a-f-]{36}$/);
    assert.equal(warningArgs.length, 1);
    assert.match(serializedWarnings, /knowledge-intake/);
    assert.equal(warningPayload.failureCode, "INVALID_JSON");
    assert.equal(warningPayload.inputChars, privateContent.length);
    assert.equal(warningPayload.attempts.length, 2);
    assert.deepEqual(
      warningPayload.attempts.map((attempt) => ({
        finishReason: attempt.finishReason,
        failureCode: attempt.failureCode,
      })),
      [
        { finishReason: "length", failureCode: "INVALID_JSON" },
        { finishReason: "length", failureCode: "INVALID_JSON" },
      ],
    );
    assert.doesNotMatch(serializedWarnings, new RegExp(privateContent));
    assert.doesNotMatch(serializedWarnings, new RegExp(privateIPName));
    assert.doesNotMatch(serializedWarnings, new RegExp(privateIPId));
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test("顶层不是对象时返回INVALID_ROOT且不记录条目位置", async () => {
  const invalidRoots = ["null", "[]", '"plain text"'];

  for (const invalidRoot of invalidRoots) {
    const originalFetch = globalThis.fetch;
    const originalWarn = console.warn;
    const warningArgs: unknown[][] = [];
    globalThis.fetch = async () => deepSeekResponse(invalidRoot);
    console.warn = (...args: unknown[]) => {
      warningArgs.push(args);
    };

    try {
      const response = await POST(intakeRequest({
        rawContent: "用于验证顶层结构的短文字",
        sourceType: "text",
        availableIPs: [],
      }));
      const body = await response.json();
      const warningPayload = JSON.parse(String(warningArgs[0]?.[1])) as {
        failureCode: string;
        attempts: Array<Record<string, unknown>>;
      };

      assert.equal(response.status, 500);
      assert.equal(body.apiMeta.failureCode, "INVALID_ROOT");
      assert.equal(warningPayload.failureCode, "INVALID_ROOT");
      assert.equal(warningPayload.attempts.length, 2);
      for (const attempt of warningPayload.attempts) {
        assert.equal(attempt.failureCode, "INVALID_ROOT");
        assert.equal("itemCount" in attempt, false);
        assert.equal("itemIndex" in attempt, false);
        assert.equal("fieldCount" in attempt, false);
      }
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = originalWarn;
    }
  }
});

test("Excel序列化内容通过真实路由进入AI提示词", async () => {
  const originalFetch = globalThis.fetch;
  let outboundBody = "";
  globalThis.fetch = async (_input, init) => {
    outboundBody = String(init?.body ?? "");
    return deepSeekResponse(JSON.stringify({
      items: [{
        ...BASE_ITEM,
        title: "痛点选题筛选",
        category: "选题方法库",
        ipId: null,
        ipMatchStatus: "not_applicable",
      }],
    }));
  };

  try {
    const response = await POST(intakeRequest({
      rawContent: "标题 | 方法 | 场景\n预算焦虑 | 先明确损失 | 装修决策",
      sourceType: "excel",
      sourceName: "选题方法.xlsx",
      availableIPs: [],
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.items[0].category, "选题方法库");
    assert.match(outboundBody, /Excel/);
    assert.match(outboundBody, /预算焦虑/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
