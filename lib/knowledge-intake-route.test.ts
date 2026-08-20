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

const IP_UNDERSTANDING_ITEM = {
  title: "离职风险的概率化判断",
  summary: "这份资料记录了基于行为变化识别离职风险的判断方式。",
  category: "IP表达语料",
  understanding: "社交频率和产出质量的变化共同构成风险信号，沟通边界用于防止模型被误用。",
  keyPoints: ["严禁在未沟通前直接锁定名单"],
  relationToIP: "用于保留当前IP分析管理问题时的概率化表达。",
  keywords: ["行为熵", "概率思维"],
  confidence: "高",
  confidenceReason: "原文明确给出了判断信号和使用边界。",
  ingestRecommend: "建议入库",
  ingestReason: "避免把离职风险简化为主观直觉。",
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

test("普通智能入库不能绕过专属流程创建IP原始内容", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse(JSON.stringify({
      items: [{
        ...BASE_ITEM,
        title: "伪原始内容",
        category: "IP原始内容",
      }],
    }));
  };

  try {
    const response = await POST(intakeRequest({
      rawContent: "这段内容没有经过Source可追溯解析。",
      sourceType: "text",
      activeIPId: "ip-pengpeng",
      availableIPs: [{ id: "ip-pengpeng", name: "彭彭说AI" }],
    }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(calls, 2);
    assert.equal(body.apiMeta.failureCode, "INVALID_CATEGORY");
    assert.equal(body.items, undefined);
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
    assert.equal(body.apiMeta.failureCode, "OUTPUT_TRUNCATED");
    assert.match(body.apiMeta.diagnosticId, /^[0-9a-f-]{36}$/);
    assert.equal(warningArgs.length, 1);
    assert.match(serializedWarnings, /knowledge-intake/);
    assert.equal(warningPayload.failureCode, "OUTPUT_TRUNCATED");
    assert.equal(warningPayload.inputChars, privateContent.length);
    assert.equal(warningPayload.attempts.length, 2);
    assert.deepEqual(
      warningPayload.attempts.map((attempt) => ({
        finishReason: attempt.finishReason,
        failureCode: attempt.failureCode,
      })),
      [
        { finishReason: "length", failureCode: "OUTPUT_TRUNCATED" },
        { finishReason: "length", failureCode: "OUTPUT_TRUNCATED" },
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

test("普通智能入库拒绝超过4000字的内容且不调用AI", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse(JSON.stringify({ items: [BASE_ITEM] }));
  };

  try {
    const response = await POST(intakeRequest({
      rawContent: "长".repeat(10_372),
      sourceType: "text",
      scope: "global",
      availableIPs: [],
    }));
    const body = await response.json();

    assert.equal(response.status, 413);
    assert.equal(calls, 0);
    assert.equal(
      body.error,
      "当前内容10372字，单次智能提炼建议不超过4000字，请按章节分成约3段导入",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("普通智能入库每次最多提取4张方法卡并提供4000个输出Token", async () => {
  const originalFetch = globalThis.fetch;
  let outboundBody = "";
  globalThis.fetch = async (_input, init) => {
    outboundBody = String(init?.body ?? "");
    return deepSeekResponse(JSON.stringify({ items: [BASE_ITEM] }));
  };

  try {
    const response = await POST(intakeRequest({
      rawContent: "一份需要拆解成少量高质量方法卡的资料。",
      sourceType: "text",
      scope: "global",
      availableIPs: [],
    }));
    const outboundRequest = JSON.parse(outboundBody) as {
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    const userPrompt = outboundRequest.messages.find(message => message.role === "user")?.content ?? "";

    assert.equal(response.status, 200);
    assert.equal(outboundRequest.max_tokens, 4000);
    assert.match(userPrompt, /提取 1-4 条「短视频方法卡」/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("普通智能入库会拒绝AI返回的第5张方法卡", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse(JSON.stringify({
      items: Array.from({ length: 5 }, (_, index) => ({
        ...BASE_ITEM,
        title: `方法卡${index + 1}`,
        category: "选题方法库",
        ipId: null,
      })),
    }));
  };

  try {
    const response = await POST(intakeRequest({
      rawContent: "一份需要限制提取数量的知识资料。",
      sourceType: "text",
      scope: "global",
      availableIPs: [],
    }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(calls, 2);
    assert.equal(body.apiMeta.failureCode, "ITEM_COUNT_EXCEEDED");
    assert.equal(body.items, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("IP内容理解会拒绝结构化关键词并用通用指令重试一次", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const outboundBodies: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    outboundBodies.push(String(init?.body ?? ""));
    return deepSeekResponse(JSON.stringify({
      item: {
        ...IP_UNDERSTANDING_ITEM,
        keywords: calls === 1
          ? ["表达路径", "真实性要求"]
          : ["行为熵", "概率思维", "灰度预警"],
      },
    }));
  };

  try {
    const response = await POST(intakeRequest({
      rawContent: "识别离职风险要观察行为变化，严禁在未沟通前锁定名单。",
      sourceType: "text",
      scope: "ip",
      activeIPId: "ip-liurun",
      availableIPs: [{ id: "ip-liurun", name: "刘润" }],
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.equal(body.mode, "ip");
    assert.deepEqual(body.item.keywords, ["行为熵", "概率思维", "灰度预警"]);
    assert.equal(body.apiMeta.attempts, 2);
    assert.match(outboundBodies[1], /关键词包含目录标题或结构标签/);
    assert.doesNotMatch(outboundBodies[1], /人性、算法、即兴感/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
