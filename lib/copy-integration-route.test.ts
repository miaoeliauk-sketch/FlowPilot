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

/**
 * 新构造的代表性测试用例，非原始试用素材。
 * 同时覆盖观点冲突、依据不足但保留，以及无依据的具体时间预测未采用。
 */
const REPRESENTATIVE_SOURCES = [
  {
    id: "source-1",
    name: "素材1",
    content: "灵魂总量始终恒定，人口增长只是灵魂重新分配。动物经过修行可能转世为人，这种说法缺乏可核实的权威来源。有人断言2026年10月所有神灵都会归位。",
  },
  {
    id: "source-2",
    name: "素材2",
    content: "人口增长说明灵魂总量会变化，新增灵魂可能来自动物转世。动物转世的具体机制目前没有可靠来源支持，但这个观点仍有整理价值。另有说法称2026年10月会完成神灵归位。",
  },
] satisfies Array<{ id: string; name: string; content: string }>;

function representativeRequest() {
  return new NextRequest("http://localhost/api/copy-integration", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "test-key",
    },
    body: JSON.stringify({ sources: REPRESENTATIVE_SOURCES }),
  });
}

test("代表性素材生成固定四部分，并区分依据不足与未采用内容", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  console.error = () => undefined;
  globalThis.fetch = async () => deepSeekResponse(JSON.stringify({
    draft: {
      sections: [
        {
          heading: "人口增长与灵魂来源",
          paragraphs: [
            "两份素材都尝试从灵魂来源解释人口增长，但对灵魂总量是否恒定存在不同判断。",
            "在这一分歧之外，两份素材都提到动物可能转世为人，不过该说法缺乏权威来源支撑，使用前仍需核实。",
          ],
          sourceIds: ["source-1", "source-2"],
        },
      ],
    },
    conflicts: [{
      topic: "灵魂总量",
      conflictPoint: "灵魂总量是否会随人口增长而变化",
      alternatives: [
        {
          brief: "灵魂总量恒定",
          text: "素材1认为灵魂总量始终恒定，人口增长只是重新分配。",
          sourceIds: ["source-1"],
        },
        {
          brief: "灵魂总量会变化",
          text: "素材2认为人口增长说明灵魂总量会变化。",
          sourceIds: ["source-2"],
        },
      ],
    }],
    contentReview: {
      exclusions: [{
        summary: "2026年10月神灵归位的具体时间预测",
        reason: "属于缺乏依据的具体时间断言",
        sourceIds: ["source-1", "source-2"],
      }],
      evidenceGaps: [{
        summary: "动物可能转世为人的说法",
        reason: "缺乏可核实的权威来源，但仍有整理价值",
        draftExcerpt: "动物可能转世为人，不过该说法缺乏权威来源支撑，使用前仍需核实",
        sourceIds: ["source-1", "source-2"],
      }],
    },
  }));

  try {
    const response = await POST(representativeRequest());
    const body = await response.json() as {
      draft: { sections: Array<{ paragraphs: string[] }> };
      decisionSummary: { items: string[] };
      conflicts: unknown[];
      contentReview: {
        exclusions: Array<{ summary: string; reason: string; sourceIds: string[] }>;
        evidenceGaps: Array<{ summary: string; reason: string; sourceIds: string[] }>;
      };
      integrationNotes?: unknown;
    };

    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(body), ["draft", "decisionSummary", "conflicts", "contentReview"]);
    assert.deepEqual(body.decisionSummary, {
      items: [
        "关于灵魂总量，素材1和素材2存在冲突：灵魂总量恒定 vs 灵魂总量会变化。正式使用前需确定统一立场。",
        "另有1处内容标记为依据不足，详见下文“未采用及依据不足内容”部分。",
      ],
    });
    const draftText = body.draft.sections.flatMap((section) => section.paragraphs).join("\n");
    assert.match(draftText, /动物可能转世为人/);
    assert.doesNotMatch(draftText, /2026年10月|神灵.*归位/);
    assert.deepEqual(body.contentReview.exclusions, [{
      summary: "2026年10月神灵归位的具体时间预测",
      reason: "属于缺乏依据的具体时间断言",
      sourceIds: ["source-1", "source-2"],
    }]);
    assert.deepEqual(body.contentReview.evidenceGaps, [{
      summary: "动物可能转世为人的说法",
      reason: "缺乏可核实的权威来源，但仍有整理价值",
      sourceIds: ["source-1", "source-2"],
    }]);
    assert.doesNotMatch(body.decisionSummary.items.join("\n"), /2026年10月|神灵.*归位/);
    assert.equal("integrationNotes" in body, false);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("依据不足条目必须提供确实保留在母稿中的对应片段", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const retainedParagraph = calls === 1
      ? "两份素材都建议先确定当天最重要的任务。"
      : "两份素材都建议先确定当天最重要的任务。晨间独处可能增强直觉，但该说法缺乏权威来源支撑，建议使用前核实。";
    return deepSeekResponse(JSON.stringify({
      draft: {
        sections: [{
          heading: calls === 1
            ? "晨间独处可能增强直觉，但该说法缺乏权威来源支撑，建议使用前核实"
            : "晨间安排",
          paragraphs: [retainedParagraph],
          sourceIds: ["source-1", "source-2"],
        }],
      },
      conflicts: [],
      contentReview: {
        exclusions: [],
        evidenceGaps: [{
          summary: "晨间独处可能增强直觉",
          reason: "缺乏权威来源，建议使用前核实",
          draftExcerpt: "晨间独处可能增强直觉，但该说法缺乏权威来源支撑，建议使用前核实",
          sourceIds: ["source-1", "source-2"],
        }],
      },
    }));
  };

  try {
    const response = await POST(representativeRequest());
    const body = await response.json() as {
      draft: { fullText: string };
      contentReview: { evidenceGaps: Array<Record<string, unknown>> };
    };

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.match(body.draft.fullText, /晨间独处可能增强直觉/);
    assert.equal("draftExcerpt" in body.contentReview.evidenceGaps[0], false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("依据不足的母稿片段必须包含清晰的核实提示", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const draftExcerpt = calls === 1
      ? "晨间独处可能增强直觉"
      : "晨间独处可能增强直觉，但该说法缺乏权威来源支撑，建议使用前核实";
    return deepSeekResponse(JSON.stringify({
      draft: {
        sections: [{
          heading: "晨间安排",
          paragraphs: [`两份素材都建议先确定当天最重要的任务。${draftExcerpt}。`],
          sourceIds: ["source-1", "source-2"],
        }],
      },
      conflicts: [],
      contentReview: {
        exclusions: [],
        evidenceGaps: [{
          summary: "晨间独处可能增强直觉",
          reason: "缺乏权威来源，建议使用前核实",
          draftExcerpt,
          sourceIds: ["source-1", "source-2"],
        }],
      },
    }));
  };

  try {
    const response = await POST(representativeRequest());
    const body = await response.json() as { draft: { fullText: string } };

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.match(body.draft.fullText, /缺乏权威来源支撑，建议使用前核实/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("返回固定四部分结果，但不向用户端暴露内部诊断", async () => {
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
    conflicts: [],
    contentReview: {
      exclusions: [],
      evidenceGaps: [],
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
      decisionSummary: {
        items: ["当前没有需要老师决策或核实的事项。"],
      },
      conflicts: [],
      contentReview: {
        exclusions: [],
        evidenceGaps: [],
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
      conflicts: [],
      contentReview: {
        exclusions: [],
        evidenceGaps: [],
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
    conflicts: [],
    contentReview: {
      exclusions: [],
      evidenceGaps: [],
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

test("冲突必须恰好包含两个说法，且每个说法分别绑定真实来源", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const alternatives = calls === 1
      ? [{ brief: "需要7天", text: "需要7天", sourceIds: ["source-1"] }]
      : [
          { brief: "需要7天", text: "需要7天", sourceIds: ["source-1"] },
          { brief: "需要30天", text: "需要30天", sourceIds: ["source-2"] },
        ];
    return deepSeekResponse(JSON.stringify({
      draft: {
        sections: [{
          heading: "信任",
          paragraphs: ["建立信任所需时间需要确认。"],
          sourceIds: ["source-1", "source-2"],
        }],
      },
      conflicts: [{
        topic: "建立信任所需时间",
        conflictPoint: "建立信任需要7天还是30天",
        alternatives,
      }],
      contentReview: {
        exclusions: [],
        evidenceGaps: [],
      },
    }));
  };

  try {
    const response = await POST(integrationRequest());
    const body = await response.json() as {
      conflicts: Array<{
        alternatives: Array<{ brief: string; text: string; sourceIds: string[] }>;
      }>;
    };

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.deepEqual(body.conflicts[0].alternatives, [
      { brief: "需要7天", text: "需要7天", sourceIds: ["source-1"] },
      { brief: "需要30天", text: "需要30天", sourceIds: ["source-2"] },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
