import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/copy-integration/route";

function deepSeekResponse(content: string) {
  return new Response(JSON.stringify({
    id: "copy-integration-test",
    choices: [{
      finish_reason: "stop",
      message: { content },
    }],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 240,
      total_tokens: 360,
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function integrationRequest() {
  return new NextRequest("http://localhost/api/copy-integration", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "test-key",
    },
    body: JSON.stringify({
      sources: [
        { id: "source-1", name: "逐字稿", content: "客户不买，往往是因为缺乏信任。" },
        { id: "source-2", name: "笔记", content: "成交困难的根本原因，是客户还不信任你。" },
      ],
    }),
  });
}

test("返回连贯母稿和整合说明，但不向用户端暴露内部诊断", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => deepSeekResponse(JSON.stringify({
    draft: {
      sections: [
        {
          heading: "信任是成交的前提",
          paragraphs: ["客户是否愿意购买，往往取决于信任是否已经建立。"],
          sourceIds: ["source-1", "source-2"],
        },
      ],
      fullText: "## 信任是成交的前提\n\n客户是否愿意购买，往往取决于信任是否已经建立。",
    },
    integrationNotes: {
      mergedDuplicates: [
        {
          summary: "两份素材都认为缺乏信任会阻碍成交。",
          sourceIds: ["source-1", "source-2"],
        },
      ],
      conflicts: [],
      exclusions: [],
    },
  }));

  try {
    const response = await POST(integrationRequest());
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      draft: {
        sections: [
          {
            heading: "信任是成交的前提",
            paragraphs: ["客户是否愿意购买，往往取决于信任是否已经建立。"],
            sourceIds: ["source-1", "source-2"],
          },
        ],
        fullText: "## 信任是成交的前提\n\n客户是否愿意购买，往往取决于信任是否已经建立。",
      },
      integrationNotes: {
        mergedDuplicates: [
          {
            summary: "两份素材都认为缺乏信任会阻碍成交。",
            sourceIds: ["source-1", "source-2"],
          },
        ],
        conflicts: [],
        exclusions: [],
      },
    });
    assert.equal("attempts" in body, false);
    assert.equal("attemptDiagnostics" in body, false);
    assert.doesNotMatch(JSON.stringify(body), /promptTokens|completionTokens|failureCode/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("少于两份有效素材时在调用模型前拒绝请求", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse("{}");
  };

  try {
    const response = await POST(new NextRequest("http://localhost/api/copy-integration", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({
        sources: [
          { id: "source-1", name: "唯一素材", content: "只有一份有效内容。" },
          { id: "source-2", name: "空素材", content: "   " },
        ],
      }),
    }));
    const body = await response.json() as { error?: string };

    assert.equal(response.status, 400);
    assert.match(body.error ?? "", /至少提供2份/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("结构化调用失败时诊断只写服务器日志，对外返回稳定错误结构", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logs: string[] = [];
  let calls = 0;
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse("SENSITIVE_AI_OUTPUT");
  };

  try {
    const response = await POST(integrationRequest());
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 502);
    assert.deepEqual(body, {
      error: "本次文案整合失败，请稍后重试",
      errorCode: "copy_integration_failed",
    });
    assert.equal(calls, 2);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^\[copy-integration\]\s+/);
    assert.match(logs[0], /"stage":"parse"/);
    assert.match(logs[0], /"attempts":2/);
    assert.doesNotMatch(JSON.stringify(body), /attempt|diagnostic|token|stage/i);
    assert.doesNotMatch(logs[0], /SENSITIVE_AI_OUTPUT|客户不买|成交困难/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("拒绝AI编造的素材来源编号", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  let calls = 0;
  console.error = () => undefined;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse(JSON.stringify({
      draft: {
        sections: [{
          heading: "信任",
          paragraphs: ["信任影响成交。"],
          sourceIds: ["source-not-exist"],
        }],
        fullText: "信任影响成交。",
      },
      integrationNotes: {
        mergedDuplicates: [],
        conflicts: [],
        exclusions: [],
      },
    }));
  };

  try {
    const response = await POST(integrationRequest());
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 502);
    assert.deepEqual(body, {
      error: "本次文案整合失败，请稍后重试",
      errorCode: "copy_integration_failed",
    });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("素材编号重复时在调用模型前拒绝请求", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse("{}");
  };

  try {
    const response = await POST(new NextRequest("http://localhost/api/copy-integration", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({
        sources: [
          { id: "same-id", name: "逐字稿", content: "第一份内容。" },
          { id: "same-id", name: "笔记", content: "第二份内容。" },
        ],
      }),
    }));
    const body = await response.json() as { error?: string };

    assert.equal(response.status, 400);
    assert.match(body.error ?? "", /素材编号不能重复/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("请求体不是合法JSON时返回400", async () => {
  const response = await POST(new NextRequest("http://localhost/api/copy-integration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  }));
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 400);
  assert.equal(body.error, "请求格式错误");
});

test("超过10份素材时在调用模型前拒绝请求", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse("{}");
  };

  try {
    const response = await POST(new NextRequest("http://localhost/api/copy-integration", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({
        sources: Array.from({ length: 11 }, (_, index) => ({
          id: `source-${index + 1}`,
          name: `素材${index + 1}`,
          content: `第${index + 1}份内容。`,
        })),
      }),
    }));
    const body = await response.json() as { error?: string };

    assert.equal(response.status, 400);
    assert.match(body.error ?? "", /最多支持10份/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("请求根节点或补充要求类型错误时返回400且不调用模型", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return deepSeekResponse("{}");
  };

  try {
    const nullResponse = await POST(new NextRequest("http://localhost/api/copy-integration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    }));
    assert.equal(nullResponse.status, 400);

    const instructionResponse = await POST(new NextRequest("http://localhost/api/copy-integration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sources: [
          { id: "source-1", name: "素材1", content: "第一份内容。" },
          { id: "source-2", name: "素材2", content: "第二份内容。" },
        ],
        instruction: 123,
      }),
    }));
    const body = await instructionResponse.json() as { error?: string };
    assert.equal(instructionResponse.status, 400);
    assert.match(body.error ?? "", /补充要求格式错误/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("可复制全文由已校验段落生成，不采用模型另写的fullText", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => deepSeekResponse(JSON.stringify({
    draft: {
      sections: [{
        heading: "信任与成交",
        paragraphs: ["信任是影响成交的重要因素。"],
        sourceIds: ["source-1", "source-2"],
      }],
      fullText: "关注我并发送关键词领取资料。",
    },
    integrationNotes: {
      mergedDuplicates: [],
      conflicts: [],
      exclusions: [],
    },
  }));

  try {
    const response = await POST(integrationRequest());
    const body = await response.json() as { draft: { fullText: string } };

    assert.equal(response.status, 200);
    assert.equal(body.draft.fullText, "## 信任与成交\n\n信任是影响成交的重要因素。");
    assert.doesNotMatch(body.draft.fullText, /关注我|关键词|领取资料/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("冲突至少包含两个说法，且每个说法分别绑定真实来源", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const alternatives = calls === 1
      ? [{ text: "需要7天", sourceIds: ["source-1"] }]
      : [
          { text: "需要7天", sourceIds: ["source-1"] },
          { text: "需要30天", sourceIds: ["source-2"] },
        ];
    return deepSeekResponse(JSON.stringify({
      draft: {
        sections: [{
          heading: "信任",
          paragraphs: ["建立信任所需时间需要确认。"],
          sourceIds: ["source-1", "source-2"],
        }],
      },
      integrationNotes: {
        mergedDuplicates: [],
        conflicts: [{
          summary: "建立信任所需时间不一致",
          alternatives,
        }],
        exclusions: [],
      },
    }));
  };

  try {
    const response = await POST(integrationRequest());
    const body = await response.json() as {
      integrationNotes: {
        conflicts: Array<{
          alternatives: Array<{ text: string; sourceIds: string[] }>;
        }>;
      };
    };

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.deepEqual(body.integrationNotes.conflicts[0].alternatives, [
      { text: "需要7天", sourceIds: ["source-1"] },
      { text: "需要30天", sourceIds: ["source-2"] },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
