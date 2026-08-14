import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/copy-integration/route";

const SOURCES = [
  { id: "source-1", name: "素材1", content: "客户不买，往往是因为缺乏信任。" },
  { id: "source-2", name: "素材2", content: "客户不买，往往是因为缺乏信任。" },
];

const EXTRACTION = {
  facts: [
    { id: "F01", statement: SOURCES[0].content, originalQuote: SOURCES[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
    { id: "F02", statement: SOURCES[1].content, originalQuote: SOURCES[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
  ],
  relations: [{ id: "R01", type: "overlap", factIds: ["F01", "F02"], summary: "两份素材都认为信任影响成交" }],
};

const SYNTHESIS = {
  draft: {
    sections: [{
      paragraphPlans: [{ factIds: ["F01", "F02"] }],
    }],
  },
};

const REVIEW = {
  decisions: EXTRACTION.facts.map(fact => ({
    factId: fact.id,
    decision: "passed",
    classification: "usable",
    atomicity: "atomic",
    reason: "原文支持",
  })),
  relationDecisions: EXTRACTION.relations.map(relation => ({
    relationId: relation.id,
    decision: "passed",
    reason: "关系成立",
  })),
  suggestedRelations: [],
};

function deepSeekResponse(content: string) {
  return new Response(JSON.stringify({
    id: "copy-integration-route-test",
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function request(sources = SOURCES, instruction?: unknown) {
  return new NextRequest("http://localhost/api/copy-integration", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
    body: JSON.stringify({ sources, ...(instruction === undefined ? {} : { instruction }) }),
  });
}

function installModelSequence(values: unknown[], prompts: string[] = []) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    prompts.push(payload.messages.find(message => message.role === "user")?.content ?? "");
    const value = values[Math.min(calls, values.length - 1)];
    calls += 1;
    return deepSeekResponse(typeof value === "string" ? value : JSON.stringify(value));
  };
  return { restore: () => { globalThis.fetch = originalFetch; }, calls: () => calls };
}

test("普通素材通过提取、独立复核和生成三次调用返回段落级来源", async () => {
  const model = installModelSequence([EXTRACTION, REVIEW, SYNTHESIS]);
  try {
    const response = await POST(request());
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200);
    assert.equal(model.calls(), 3);
    assert.deepEqual(Object.keys(body), ["draft", "decisionSummary", "conflicts", "exclusionCandidates", "contentReview"]);
    assert.deepEqual(body.draft.sections[0].paragraphs[0], {
      text: "多份素材表达了相近观点。客户不买，往往是因为缺乏信任。",
      sourceIds: ["source-1", "source-2"],
    });
  } finally { model.restore(); }
});

test("公开响应由新对象构造且不包含内部证据或调用诊断", async () => {
  const model = installModelSequence([EXTRACTION, REVIEW, SYNTHESIS]);
  try {
    const body = await (await POST(request())).json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /evidenceTable|originalQuote|quoteStart|sourceHash|paragraphRefs|validationReport|callCount|apiMeta|diagnostic/i);
  } finally { model.restore(); }
});

test("可复制全文只由已校验段落生成", async () => {
  const model = installModelSequence([EXTRACTION, REVIEW, SYNTHESIS]);
  try {
    const body = await (await POST(request())).json() as { draft: { fullText: string } };
    assert.equal(body.draft.fullText, "## 客户不买，往往是因为缺乏信任\n\n多份素材表达了相近观点。客户不买，往往是因为缺乏信任。");
  } finally { model.restore(); }
});

test("引文只存在换行和空格差异时仍能定位原文", async () => {
  const extraction = structuredClone(EXTRACTION);
  extraction.facts[0].originalQuote = "客户不买， 往往是因为\n缺乏信任。";
  const model = installModelSequence([extraction, REVIEW, SYNTHESIS]);
  try {
    assert.equal((await POST(request())).status, 200);
    assert.equal(model.calls(), 3);
  } finally { model.restore(); }
});

test("引文发生实质改写时定向重试一次后失败关闭", async () => {
  const invalid = structuredClone(EXTRACTION);
  invalid.facts[0].originalQuote = "客户不买，肯定是因为完全不信任你。";
  const prompts: string[] = [];
  const model = installModelSequence([invalid, invalid], prompts);
  try {
    const response = await POST(request());
    assert.equal(response.status, 502);
    assert.equal(model.calls(), 2);
    assert.match(prompts[1], /逐字复制原文/);
  } finally { model.restore(); }
});

test("冲突内容先独立复核再生成母稿", async () => {
  const conflictExtraction = {
    facts: [
      { id: "F01", statement: "建立信任需要7天", originalQuote: "建立信任需要7天。", sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: "建立信任需要30天", originalQuote: "建立信任需要30天。", sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [{ id: "R01", type: "conflict", factIds: ["F01", "F02"], summary: "建立信任需要7天还是30天" }],
  };
  const riskSources = [
    { id: "source-1", name: "素材1", content: "建立信任需要7天。" },
    { id: "source-2", name: "素材2", content: "建立信任需要30天。" },
  ];
  const review = { decisions: [
    { factId: "F01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
    { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
  ], relationDecisions: [
    { relationId: "R01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "两者确实冲突" },
  ] };
  const synthesis = { draft: { sections: [{
    paragraphPlans: [{ factIds: ["F01", "F02"] }],
  }] } };
  const prompts: string[] = [];
  const model = installModelSequence([conflictExtraction, review, synthesis], prompts);
  try {
    const body = await (await POST(request(riskSources))).json() as Record<string, any>;
    assert.equal(model.calls(), 3);
    assert.match(prompts[1], /复核以下证据/);
    assert.match(prompts[2], /已校验证据/);
    assert.equal(body.conflicts.length, 1);
    assert.equal(body.conflicts[0].alternatives.length, 2);
  } finally { model.restore(); }
});

test("整条流水线只共享一次纠错额度且总调用不超过4次", async () => {
  const invalid = { facts: [], relations: [] };
  const riskExtraction = structuredClone(EXTRACTION);
  riskExtraction.facts[0].confidence = "low";
  const invalidReview = { decisions: "wrong" };
  const model = installModelSequence([invalid, riskExtraction, invalidReview]);
  try {
    const response = await POST(request());
    assert.equal(response.status, 502);
    assert.equal(model.calls(), 3);
  } finally { model.restore(); }
});

test("模型连续返回非法JSON时只记录安全错误码", async () => {
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  const model = installModelSequence(["SENSITIVE_AI_OUTPUT", "SENSITIVE_AI_OUTPUT"]);
  try {
    const response = await POST(request());
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(body, { error: "文案整合失败，请重试" });
    assert.match(logs[0], /"stage":"extract"/);
    assert.match(logs[0], /"failureCode":"INVALID_JSON"/);
    assert.doesNotMatch(logs[0], /SENSITIVE_AI_OUTPUT|客户不买|test-key/);
  } finally { model.restore(); console.error = originalError; }
});

test("证据引用未知素材编号时拒绝且不向客户端泄露错误码", async () => {
  const invalid = structuredClone(EXTRACTION);
  invalid.facts[0].sourceId = "source-not-exist";
  const model = installModelSequence([invalid, invalid]);
  try {
    const response = await POST(request());
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 502);
    assert.deepEqual(body, { error: "文案整合失败，请重试" });
    assert.doesNotMatch(JSON.stringify(body), /UNKNOWN_SOURCE_ID|failureCode/);
  } finally { model.restore(); }
});

test("少于两份有效素材时在调用模型前拒绝请求", async () => {
  const model = installModelSequence([EXTRACTION]);
  try {
    assert.equal((await POST(request(SOURCES.slice(0, 1)))).status, 400);
    assert.equal(model.calls(), 0);
  } finally { model.restore(); }
});

test("素材编号重复时在调用模型前拒绝请求", async () => {
  const model = installModelSequence([EXTRACTION]);
  try {
    const duplicate = [SOURCES[0], { ...SOURCES[1], id: "source-1" }];
    assert.equal((await POST(request(duplicate))).status, 400);
    assert.equal(model.calls(), 0);
  } finally { model.restore(); }
});

test("请求体不是合法JSON时返回400", async () => {
  const response = await POST(new NextRequest("http://localhost/api/copy-integration", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{" ,
  }));
  assert.equal(response.status, 400);
});

test("超过10份素材时在调用模型前拒绝请求", async () => {
  const model = installModelSequence([EXTRACTION]);
  try {
    const many = Array.from({ length: 11 }, (_, index) => ({ id: `source-${index}`, name: "素材", content: "有效正文" }));
    assert.equal((await POST(request(many))).status, 400);
    assert.equal(model.calls(), 0);
  } finally { model.restore(); }
});

test("补充要求类型错误时返回400且不调用模型", async () => {
  const model = installModelSequence([EXTRACTION]);
  try {
    assert.equal((await POST(request(SOURCES, false))).status, 400);
    assert.equal(model.calls(), 0);
  } finally { model.restore(); }
});

test("内容占比必须大于0且不超过100并且不会调用模型", async () => {
  const model = installModelSequence([EXTRACTION]);
  try {
    const invalidSources = [
      { ...SOURCES[0], contentPercentage: 0 },
      { ...SOURCES[1], contentPercentage: 100 },
    ];
    const response = await POST(request(invalidSources));
    assert.equal(response.status, 400);
    assert.equal(model.calls(), 0);
    assert.deepEqual(await response.json(), { error: "文案内容占比必须大于0且不超过100" });
  } finally { model.restore(); }
});

test("内容占比合计不是100%时返回400且不调用模型", async () => {
  const model = installModelSequence([EXTRACTION]);
  try {
    const invalidTotalSources = [
      { ...SOURCES[0], contentPercentage: 40 },
      { ...SOURCES[1], contentPercentage: 40 },
    ];
    const response = await POST(request(invalidTotalSources));
    assert.equal(response.status, 400);
    assert.equal(model.calls(), 0);
    assert.deepEqual(await response.json(), { error: "文案内容占比合计必须为100%" });
  } finally { model.restore(); }
});

test("空白文案不参与接口内容占比校验", async () => {
  const model = installModelSequence([EXTRACTION, REVIEW, SYNTHESIS]);
  try {
    const sourcesWithBlank = [
      { ...SOURCES[0], contentPercentage: 50 },
      { ...SOURCES[1], contentPercentage: 50 },
      { id: "source-3", name: "素材3", content: "", contentPercentage: 0 },
    ];
    const response = await POST(request(sourcesWithBlank));
    assert.equal(response.status, 200);
    assert.equal(model.calls(), 3);
  } finally { model.restore(); }
});

test("旧版3比7内容份额请求继续兼容", async () => {
  const model = installModelSequence([EXTRACTION, REVIEW, SYNTHESIS]);
  try {
    const legacyWeightedSources = [
      { ...SOURCES[0], contentWeight: 3 },
      { ...SOURCES[1], contentWeight: 7 },
    ];
    const response = await POST(request(legacyWeightedSources));
    assert.equal(response.status, 200);
    assert.equal(model.calls(), 3);
  } finally { model.restore(); }
});

test("30%与70%内容占比会压缩第一篇细节并保留第二篇完整内容", async () => {
  const weightedSources = [
    {
      id: "source-1",
      name: "文案1",
      content: "第一篇的核心观点值得保留，这里还有用于解释背景的补充细节。",
      contentPercentage: 30,
    },
    {
      id: "source-2",
      name: "文案2",
      content: "第二篇的核心方法需要展开说明，因为它包含完整的执行步骤与判断依据。",
      contentPercentage: 70,
    },
  ];
  const extraction = {
    facts: [
      {
        id: "F01",
        statement: "第一篇的核心观点值得保留",
        originalQuote: weightedSources[0].content,
        sourceId: "source-1",
        classification: "usable",
        confidence: "high",
      },
      {
        id: "F02",
        statement: "第二篇的核心方法需要展开说明",
        originalQuote: weightedSources[1].content,
        sourceId: "source-2",
        classification: "usable",
        confidence: "high",
      },
    ],
    relations: [],
  };
  const review = {
    decisions: extraction.facts.map(fact => ({
      factId: fact.id,
      decision: "passed",
      classification: "usable",
      atomicity: "atomic",
      statementCompleteness: "complete",
      reason: "原文支持",
    })),
    relationDecisions: [],
    suggestedRelations: [],
  };
  const synthesis = { draft: { sections: [
    { paragraphPlans: [{ factIds: ["F01"] }] },
    { paragraphPlans: [{ factIds: ["F02"] }] },
  ] } };
  const prompts: string[] = [];
  const model = installModelSequence([extraction, review, synthesis], prompts);
  try {
    const response = await POST(request(weightedSources));
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200);
    assert.equal(body.draft.sections[0].paragraphs[0].text, "第一篇的核心观点值得保留。");
    assert.equal(body.draft.sections[1].paragraphs[0].text, weightedSources[1].content);
    assert.match(prompts[0], /文案1[\s\S]*30%/);
    assert.match(prompts[0], /文案2[\s\S]*70%/);
    assert.match(prompts[2], /目标内容占比/);
  } finally { model.restore(); }
});

test("份额相等或近似相等时核心短句都必须逐字来自原文", async () => {
  const baseSources = [
    { id: "source-1", name: "文案1", content: "第一篇的核心观点值得保留，这里还有补充细节。" },
    { id: "source-2", name: "文案2", content: "第二篇的核心方法需要完整展开。" },
  ];
  const invalidExtraction = {
    facts: [
      { id: "F01", statement: "第一篇强调了一个重要观点", originalQuote: baseSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: baseSources[1].content, originalQuote: baseSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const prompts: string[] = [];
  const model = installModelSequence([invalidExtraction, invalidExtraction, invalidExtraction, invalidExtraction], prompts);
  try {
    const equalResponse = await POST(request(baseSources.map(source => ({ ...source, contentWeight: 1 }))));
    const nearResponse = await POST(request(baseSources.map((source, index) => ({ ...source, contentWeight: index === 0 ? 1 : 1.0001 }))));
    assert.equal(equalResponse.status, 502);
    assert.equal(nearResponse.status, 502);
    assert.equal(model.calls(), 4);
    assert.deepEqual(await equalResponse.json(), { error: "文案整合失败，请重试" });
    assert.deepEqual(await nearResponse.json(), { error: "文案整合失败，请重试" });
    assert.match(prompts[1], /完整表达核心意思/);
  } finally { model.restore(); }
});

test("独立复核认为摘要不完整时保留全文而不是只剩单个词", async () => {
  const weightedSources = [
    { id: "source-1", name: "文案1", content: "客户愿意购买的关键是信任，这是成交的核心观点。", contentWeight: 3 },
    { id: "source-2", name: "文案2", content: "持续兑现承诺能够逐步建立客户信任。", contentWeight: 7 },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "信任", originalQuote: weightedSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: weightedSources[1].content, originalQuote: weightedSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const review = {
    decisions: extraction.facts.map(fact => ({
      factId: fact.id,
      decision: "passed",
      classification: "usable",
      atomicity: "atomic",
      statementCompleteness: fact.id === "F01" ? "incomplete" : "complete",
      reason: fact.id === "F01" ? "摘要只是单个词" : "摘要完整",
    })),
    relationDecisions: [],
    suggestedRelations: [],
  };
  const model = installModelSequence([
    extraction,
    review,
    { draft: { sections: [
      { paragraphPlans: [{ factIds: ["F01"] }] },
      { paragraphPlans: [{ factIds: ["F02"] }] },
    ] } },
  ]);
  try {
    const response = await POST(request(weightedSources));
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.match(body.draft.fullText, new RegExp(weightedSources[0].content));
    assert.doesNotMatch(body.draft.fullText, /\n信任。(?:\n|$)/);
  } finally { model.restore(); }
});

test("相等与接近相等的份额使用同一套软比例算法", async () => {
  const baseSources = [
    { id: "source-1", name: "文案1", content: "第一篇的核心观点值得保留，这里还有很长的背景说明用于解释前因后果与适用边界。" },
    { id: "source-2", name: "文案2", content: "第二篇的核心方法需要展开说明。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "第一篇的核心观点值得保留", originalQuote: baseSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: baseSources[1].content, originalQuote: baseSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const review = {
    decisions: extraction.facts.map(fact => ({ factId: fact.id, decision: "passed", classification: "usable", atomicity: "atomic", statementCompleteness: "complete", reason: "原文支持" })),
    relationDecisions: [],
    suggestedRelations: [],
  };
  const synthesis = { draft: { sections: [
    { paragraphPlans: [{ factIds: ["F01"] }] },
    { paragraphPlans: [{ factIds: ["F02"] }] },
  ] } };
  const model = installModelSequence([extraction, review, synthesis, extraction, review, synthesis]);
  try {
    const equal = await (await POST(request(baseSources.map(source => ({ ...source, contentWeight: 1 }))))).json() as Record<string, any>;
    const nearlyEqual = await (await POST(request(baseSources.map((source, index) => ({ ...source, contentWeight: index === 0 ? 1 : 1.0001 }))))).json() as Record<string, any>;
    assert.equal(equal.draft.fullText, nearlyEqual.draft.fullText);
  } finally { model.restore(); }
});

test("两处需要一起压缩时仍能找到更接近目标份额的组合", async () => {
  const weightedSources = [
    { id: "source-1", name: "文案1", content: "甲".repeat(50), contentWeight: 4 },
    { id: "source-2", name: "文案2", content: "乙".repeat(50), contentWeight: 6 },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "甲".repeat(20), originalQuote: weightedSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: "乙".repeat(40), originalQuote: weightedSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const review = {
    decisions: extraction.facts.map(fact => ({ factId: fact.id, decision: "passed", classification: "usable", atomicity: "atomic", statementCompleteness: "complete", reason: "完整核心内容" })),
    relationDecisions: [],
    suggestedRelations: [],
  };
  const model = installModelSequence([
    extraction,
    review,
    { draft: { sections: [
      { paragraphPlans: [{ factIds: ["F01"] }] },
      { paragraphPlans: [{ factIds: ["F02"] }] },
    ] } },
  ]);
  try {
    const body = await (await POST(request(weightedSources))).json() as Record<string, any>;
    assert.equal(body.draft.sections[0].paragraphs[0].text, `${"甲".repeat(20)}。`);
    assert.equal(body.draft.sections[1].paragraphs[0].text, `${"乙".repeat(40)}。`);
  } finally { model.restore(); }
});

test("条件片段不能用于压缩，完整原句可以安全缩短说明细节", async () => {
  const weightedSources = [
    { id: "source-1", name: "文案1", content: "如果客户信任品牌，就更容易成交。这里还有背景说明。", contentWeight: 1 },
    { id: "source-2", name: "文案2", content: "持续复盘能够发现问题。这里还有执行层面的补充说明。", contentWeight: 9 },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "如果客户信任品牌", originalQuote: weightedSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: "持续复盘能够发现问题。", originalQuote: weightedSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const review = {
    decisions: [
      { factId: "F01", decision: "passed", classification: "usable", atomicity: "atomic", statementCompleteness: "incomplete", reason: "条件片段不能独立表达结论" },
      { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", statementCompleteness: "complete", reason: "完整原句" },
    ],
    relationDecisions: [],
    suggestedRelations: [],
  };
  const model = installModelSequence([
    extraction,
    review,
    { draft: { sections: [
      { paragraphPlans: [{ factIds: ["F01"] }] },
      { paragraphPlans: [{ factIds: ["F02"] }] },
    ] } },
  ]);
  try {
    const body = await (await POST(request(weightedSources))).json() as Record<string, any>;
    assert.match(body.draft.fullText, new RegExp(weightedSources[0].content));
    assert.doesNotMatch(body.draft.fullText, /\n如果客户信任品牌。(?:\n|$)/);
  } finally { model.restore(); }
});

test("相等内容占比下重叠观点仍保留新增证据", async () => {
  const equalSources = [
    { id: "source-1", name: "文案1", content: "信任影响成交。", contentWeight: 1 },
    { id: "source-2", name: "文案2", content: "信任影响成交，尤其在高客单价服务中更明显。", contentWeight: 1 },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: equalSources[0].content, originalQuote: equalSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: equalSources[1].content, originalQuote: equalSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [{ id: "R01", type: "overlap", factIds: ["F01", "F02"], summary: "信任影响成交" }],
  };
  const review = {
    decisions: extraction.facts.map(fact => ({ factId: fact.id, decision: "passed", classification: "usable", atomicity: "atomic", statementCompleteness: "complete", reason: "原文支持" })),
    relationDecisions: [{ relationId: "R01", decision: "passed", reason: "观点重叠但有新增证据" }],
    suggestedRelations: [],
  };
  const model = installModelSequence([
    extraction,
    review,
    { draft: { sections: [{ paragraphPlans: [{ factIds: ["F01", "F02"] }] }] } },
  ]);
  try {
    const body = await (await POST(request(equalSources))).json() as Record<string, any>;
    assert.equal((body.draft.sections[0].paragraphs[0].text.match(/信任影响成交/gu) ?? []).length, 1);
    assert.match(body.draft.fullText, /尤其在高客单价服务中更明显/);
  } finally { model.restore(); }
});

test("加权后的重叠观点只保留一次并优先保留新增证据", async () => {
  const weightedSources = [
    { id: "source-1", name: "文案1", content: "信任影响成交。", contentWeight: 3 },
    { id: "source-2", name: "文案2", content: "信任影响成交，尤其在高客单价服务中更明显。", contentWeight: 7 },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "信任影响成交", originalQuote: weightedSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: "信任影响成交，尤其在高客单价服务中更明显", originalQuote: weightedSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [{ id: "R01", type: "overlap", factIds: ["F01", "F02"], summary: "信任影响成交" }],
  };
  const review = {
    decisions: extraction.facts.map(fact => ({ factId: fact.id, decision: "passed", classification: "usable", atomicity: "atomic", statementCompleteness: "complete", reason: "完整原句" })),
    relationDecisions: [{ relationId: "R01", decision: "passed", reason: "观点重叠且第二篇有新增证据" }],
    suggestedRelations: [],
  };
  const model = installModelSequence([
    extraction,
    review,
    { draft: { sections: [{ paragraphPlans: [{ factIds: ["F01", "F02"] }] }] } },
  ]);
  try {
    const body = await (await POST(request(weightedSources))).json() as Record<string, any>;
    assert.equal((body.draft.sections[0].paragraphs[0].text.match(/信任影响成交/gu) ?? []).length, 1);
    assert.match(body.draft.fullText, /尤其在高客单价服务中更明显/);
  } finally { model.restore(); }
});

test("重叠与补充混合关系中仍优先保留能覆盖短句的完整证据", async () => {
  const sources = [
    { id: "source-1", name: "文案1", content: "信任影响成交。", contentWeight: 9 },
    { id: "source-2", name: "文案2", content: "信任影响成交，尤其在高客单价服务中更明显。", contentWeight: 3 },
    { id: "source-3", name: "文案3", content: "持续兑现承诺可以逐步建立客户信任。", contentWeight: 1 },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: sources[0].content, originalQuote: sources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: sources[1].content, originalQuote: sources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
      { id: "F03", statement: sources[2].content, originalQuote: sources[2].content, sourceId: "source-3", classification: "usable", confidence: "high" },
    ],
    relations: [
      { id: "R01", type: "overlap", factIds: ["F01", "F02"], summary: "成交观点重叠" },
      { id: "R02", type: "complement", factIds: ["F02", "F03"], summary: "补充建立信任的方法" },
    ],
  };
  const review = {
    decisions: extraction.facts.map(fact => ({ factId: fact.id, decision: "passed", classification: "usable", atomicity: "atomic", statementCompleteness: "complete", reason: "完整原句" })),
    relationDecisions: extraction.relations.map(relation => ({ relationId: relation.id, decision: "passed", reason: "关系成立" })),
    suggestedRelations: [],
  };
  const model = installModelSequence([
    extraction,
    review,
    { draft: { sections: [{ paragraphPlans: [{ factIds: ["F01", "F02", "F03"] }] }] } },
  ]);
  try {
    const body = await (await POST(request(sources))).json() as Record<string, any>;
    const paragraph = body.draft.sections[0].paragraphs[0].text as string;
    assert.equal((paragraph.match(/信任影响成交/gu) ?? []).length, 1);
    assert.match(paragraph, /高客单价服务中更明显/);
    assert.match(paragraph, /持续兑现承诺可以逐步建立客户信任/);
  } finally { model.restore(); }
});

test("内容占比不能压缩待确认冲突的任一方原文", async () => {
  const weightedSources = [
    { id: "source-1", name: "文案1", content: "第一篇认为执行需要三个月，并给出了完整的项目背景。", contentWeight: 3 },
    { id: "source-2", name: "文案2", content: "第二篇认为执行只需要一个月，并给出了不同的时间判断。", contentWeight: 7 },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "第一篇认为执行需要三个月", originalQuote: weightedSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: "第二篇认为执行只需要一个月", originalQuote: weightedSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [{ id: "R01", type: "conflict", factIds: ["F01", "F02"], summary: "执行周期冲突" }],
  };
  const review = {
    decisions: extraction.facts.map(fact => ({ factId: fact.id, decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" })),
    relationDecisions: [{ relationId: "R01", decision: "passed", reason: "冲突成立" }],
    suggestedRelations: [],
  };
  const synthesis = { draft: { sections: [{ paragraphPlans: [{ factIds: ["F01", "F02"] }] }] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const body = await (await POST(request(weightedSources))).json() as Record<string, any>;
    assert.match(body.draft.fullText, new RegExp(weightedSources[0].content));
    assert.match(body.draft.fullText, new RegExp(weightedSources[1].content));
    assert.equal(body.conflicts.length, 1);
  } finally { model.restore(); }
});

test("关联观点未在同一段落融合时定向重试后失败", async () => {
  const separated = { draft: { sections: [{
    paragraphPlans: [{ factIds: ["F01"] }, { factIds: ["F02"] }],
  }] } };
  const prompts: string[] = [];
  const model = installModelSequence([EXTRACTION, REVIEW, separated, separated], prompts);
  try {
    assert.equal((await POST(request())).status, 502);
    assert.equal(model.calls(), 4);
    assert.match(prompts[3], /同一逻辑段落/);
  } finally { model.restore(); }
});

test("依据不足观点由服务器固定追加核实提示", async () => {
  const evidenceSources = [
    { id: "source-1", name: "素材1", content: "晨间独处可能增强直觉。" },
    { id: "source-2", name: "素材2", content: "每天先确定最重要的任务。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "晨间独处可能增强直觉", originalQuote: evidenceSources[0].content, sourceId: "source-1", classification: "evidence_gap", confidence: "low" },
      { id: "F02", statement: "每天先确定最重要的任务", originalQuote: evidenceSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const review = { decisions: [
    { factId: "F01", decision: "needs_review", classification: "evidence_gap", atomicity: "atomic", reason: "缺乏权威依据" },
    { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
  ], relationDecisions: [] };
  const synthesis = { draft: { sections: [{
    paragraphPlans: [{ factIds: ["F01"] }, { factIds: ["F02"] }],
  }] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const response = await POST(request(evidenceSources));
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200);
    assert.match(body.draft.fullText, /缺乏权威来源支撑，建议使用前核实/);
    assert.equal(model.calls(), 3);
  } finally { model.restore(); }
});

test("依据不足观点不能只出现在说明区而从母稿中消失", async () => {
  const evidenceSources = [
    { id: "source-1", name: "素材1", content: "晨间独处可能增强直觉。" },
    { id: "source-2", name: "素材2", content: "每天先确定最重要的任务。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "晨间独处可能增强直觉", originalQuote: evidenceSources[0].content, sourceId: "source-1", classification: "evidence_gap", confidence: "low" },
      { id: "F02", statement: "每天先确定最重要的任务", originalQuote: evidenceSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const review = { decisions: [
    { factId: "F01", decision: "needs_review", classification: "evidence_gap", atomicity: "atomic", reason: "缺乏权威依据" },
    { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
  ], relationDecisions: [] };
  const omitted = { draft: { sections: [{
    paragraphPlans: [{ factIds: ["F02"] }],
  }] } };
  const model = installModelSequence([extraction, review, omitted, omitted]);
  try {
    assert.equal((await POST(request(evidenceSources))).status, 502);
    assert.equal(model.calls(), 4);
  } finally { model.restore(); }
});

test("普通文字型无证据结论也会被拒绝", async () => {
  const hallucinated = { draft: { sections: [{
    paragraphPlans: [{ factIds: ["F01", "F02"], text: "客户是否信任你会影响成交。诚信决定企业寿命。" }],
  }] } };
  const model = installModelSequence([EXTRACTION, hallucinated, hallucinated]);
  try {
    assert.equal((await POST(request())).status, 502);
    assert.equal(model.calls(), 3);
  } finally { model.restore(); }
});

test("所有可用观点都必须真正进入母稿", async () => {
  const independentSources = [
    SOURCES[0],
    { id: "source-2", name: "素材2", content: "每天复盘可以帮助团队发现问题。" },
  ];
  const independentExtraction = {
    facts: [
      { id: "F01", statement: independentSources[0].content, originalQuote: independentSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: independentSources[1].content, originalQuote: independentSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const omitted = { draft: { sections: [{
    paragraphPlans: [{ factIds: ["F01"] }],
  }] } };
  const review = { decisions: [
    { factId: "F01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
    { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
  ], relationDecisions: [], suggestedRelations: [] };
  const model = installModelSequence([independentExtraction, review, omitted, omitted]);
  try {
    assert.equal((await POST(request(independentSources))).status, 502);
    assert.equal(model.calls(), 4);
  } finally { model.restore(); }
});

test("冲突观点必须并列呈现且不能自动选边", async () => {
  const riskSources = [
    { id: "source-1", name: "素材1", content: "建立信任需要7天。" },
    { id: "source-2", name: "素材2", content: "建立信任需要30天。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "建立信任需要7天", originalQuote: riskSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: "建立信任需要30天", originalQuote: riskSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [{ id: "R01", type: "conflict", factIds: ["F01", "F02"], summary: "建立信任所需时间不同" }],
  };
  const review = {
    decisions: [
      { factId: "F01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
      { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
    ],
    relationDecisions: [{ relationId: "R01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "冲突成立" }],
  };
  const selectedOneSide = { draft: { sections: [{
    paragraphPlans: [{ factIds: ["F01", "F02"], text: "双方存在分歧，但7天更可信。" }],
  }] } };
  const model = installModelSequence([extraction, review, selectedOneSide, selectedOneSide]);
  try {
    assert.equal((await POST(request(riskSources))).status, 502);
    assert.equal(model.calls(), 4);
  } finally { model.restore(); }
});

test("把两份重复原文并排不算完成观点融合", async () => {
  const pastedTogether = { draft: { sections: [{
    paragraphPlans: [{ factIds: ["F01", "F02"], text: `${SOURCES[0].content}${SOURCES[1].content}` }],
  }] } };
  const model = installModelSequence([EXTRACTION, pastedTogether, pastedTogether]);
  try {
    assert.equal((await POST(request())).status, 502);
    assert.equal(model.calls(), 3);
  } finally { model.restore(); }
});

test("同一事实不能重复冒充双方关系", async () => {
  const invalid = structuredClone(EXTRACTION);
  invalid.relations[0].factIds = ["F01", "F01"];
  const model = installModelSequence([invalid, invalid]);
  try {
    assert.equal((await POST(request())).status, 502);
    assert.equal(model.calls(), 2);
  } finally { model.restore(); }
});

test("每份素材都必须至少提取一条原子观点", async () => {
  const missingSource = structuredClone(EXTRACTION);
  missingSource.facts = [missingSource.facts[0]];
  missingSource.relations = [];
  const model = installModelSequence([missingSource, missingSource]);
  try {
    assert.equal((await POST(request())).status, 502);
    assert.equal(model.calls(), 2);
  } finally { model.restore(); }
});

test("提取模型误标的确定性年份预测仍归入未采用", async () => {
  const timeSources = [
    { id: "source-1", name: "素材1", content: "2026年10月一定完成转变。" },
    { id: "source-2", name: "素材2", content: "面对变化时需要保持观察。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "2026年10月一定完成转变", originalQuote: timeSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: "面对变化时需要保持观察", originalQuote: timeSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const review = {
    decisions: [
      { factId: "F01", decision: "passed", classification: "exclude_time_prediction", atomicity: "atomic", reason: "属于无依据时间预测" },
      { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
    ],
    relationDecisions: [],
  };
  const synthesis = { draft: { sections: [{
    paragraphPlans: [{ factIds: ["F02"] }],
  }] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const body = await (await POST(request(timeSources))).json() as Record<string, any>;
    assert.equal(body.contentReview.exclusions.length, 1);
    assert.equal(body.contentReview.exclusions[0].sourceIds[0], "source-1");
    assert.doesNotMatch(body.draft.fullText, /2026年10月/);
  } finally { model.restore(); }
});

test("复核拒绝的事实不会出现在冲突或决策摘要中", async () => {
  const riskSources = [
    { id: "source-1", name: "素材1", content: "建立信任需要7天。" },
    { id: "source-2", name: "素材2", content: "建立信任需要30天。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "建立信任需要7天", originalQuote: riskSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: "建立信任需要30天", originalQuote: riskSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [{ id: "R01", type: "conflict", factIds: ["F01", "F02"], summary: "建立信任所需时间不同" }],
  };
  const review = {
    decisions: [
      { factId: "F01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
      { factId: "F02", decision: "rejected", classification: "usable", atomicity: "atomic", reason: "观点超出证据" },
    ],
    relationDecisions: [{ relationId: "R01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原始说法存在分歧" }],
  };
  const synthesis = { draft: { sections: [{
    paragraphPlans: [{ factIds: ["F01"] }],
  }] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const body = await (await POST(request(riskSources))).json() as Record<string, any>;
    assert.equal(body.conflicts.length, 0);
    assert.doesNotMatch(JSON.stringify(body), /30天/);
  } finally { model.restore(); }
});

test("使用相同关键词编造更严重后果也不能进入母稿", async () => {
  const fabricatedConsequence = { draft: { sections: [{
    paragraphPlans: [{ factIds: ["F01", "F02"], text: "客户不信任就会让公司倒闭。" }],
  }] } };
  const model = installModelSequence([EXTRACTION, fabricatedConsequence, fabricatedConsequence]);
  try {
    assert.equal((await POST(request())).status, 502);
  } finally { model.restore(); }
});

test("原文中的可能不能被提取和母稿强化为一定", async () => {
  const modalSources = [
    { id: "source-1", name: "素材1", content: "过度关注外界可能消耗注意力。" },
    { id: "source-2", name: "素材2", content: "情绪起伏可能扰乱生活节奏。" },
  ];
  const escalated = {
    facts: [
      { id: "F01", statement: "过度关注外界一定消耗注意力", originalQuote: modalSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: "情绪起伏一定扰乱生活节奏", originalQuote: modalSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const review = { decisions: [
    { factId: "F01", decision: "rejected", classification: "usable", atomicity: "atomic", reason: "把可能强化为一定" },
    { factId: "F02", decision: "rejected", classification: "usable", atomicity: "atomic", reason: "把可能强化为一定" },
  ], relationDecisions: [] };
  const model = installModelSequence([escalated, review]);
  try {
    const response = await POST(request(modalSources));
    assert.equal(response.status, 502);
    assert.equal(model.calls(), 2);
  } finally { model.restore(); }
});

test("互不相关的观点被误标为补充关系时必须进入独立复核", async () => {
  const unrelatedSources = [
    { id: "source-1", name: "素材1", content: "苹果是红色的。" },
    { id: "source-2", name: "素材2", content: "天空中有云。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: unrelatedSources[0].content, originalQuote: unrelatedSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: unrelatedSources[1].content, originalQuote: unrelatedSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [{ id: "R01", type: "complement", factIds: ["F01", "F02"], summary: "两者互相补充" }],
  };
  const review = {
    decisions: [
      { factId: "F01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
      { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
    ],
    relationDecisions: [{ relationId: "R01", decision: "rejected", classification: "usable", atomicity: "atomic", reason: "两者无逻辑关系" }],
  };
  const synthesis = { draft: { sections: [
    { paragraphPlans: [{ factIds: ["F01"] }] },
    { paragraphPlans: [{ factIds: ["F02"] }] },
  ] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    assert.equal((await POST(request(unrelatedSources))).status, 200);
    assert.equal(model.calls(), 3);
  } finally { model.restore(); }
});

test("带年份的历史事实不会被误判为未来预测", async () => {
  const historicalSources = [
    { id: "source-1", name: "素材1", content: "2026年公司完成了办公室搬迁。" },
    { id: "source-2", name: "素材2", content: "团队随后恢复了正常办公。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: historicalSources[0].content, originalQuote: historicalSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: historicalSources[1].content, originalQuote: historicalSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const review = { decisions: [
    { factId: "F01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "历史事实" },
    { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
  ], relationDecisions: [] };
  const synthesis = { draft: { sections: [
    { paragraphPlans: [{ factIds: ["F01"] }] },
    { paragraphPlans: [{ factIds: ["F02"] }] },
  ] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const body = await (await POST(request(historicalSources))).json() as Record<string, any>;
    assert.equal(body.contentReview.exclusions.length, 0);
    assert.match(body.draft.fullText, /2026年公司完成了办公室搬迁/);
  } finally { model.restore(); }
});

test("带具体年份的未来断言即使没有一定也归入未采用", async () => {
  const futureSources = [
    { id: "source-1", name: "素材1", content: "2026年将开启新的阶段。" },
    { id: "source-2", name: "素材2", content: "面对变化时需要保持观察。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: futureSources[0].content, originalQuote: futureSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: futureSources[1].content, originalQuote: futureSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const review = { decisions: [
    { factId: "F01", decision: "needs_review", classification: "exclude_time_prediction", atomicity: "atomic", reason: "属于无依据时间预测" },
    { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
  ], relationDecisions: [] };
  const synthesis = { draft: { sections: [{ paragraphPlans: [{ factIds: ["F02"] }] }] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const body = await (await POST(request(futureSources))).json() as Record<string, any>;
    assert.equal(body.contentReview.exclusions.length, 1);
    assert.doesNotMatch(body.draft.fullText, /2026年将开启/);
  } finally { model.restore(); }
});

test("同一份素材中的第二个独立观点不能被提取阶段遗漏", async () => {
  const multiPointSources = [
    { id: "source-1", name: "素材1", content: "信任影响成交。现金流决定企业能否持续经营。" },
    { id: "source-2", name: "素材2", content: "复盘可以帮助团队发现问题。" },
  ];
  const incomplete = {
    facts: [
      { id: "F01", statement: "信任影响成交。", originalQuote: "信任影响成交。", sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: multiPointSources[1].content, originalQuote: multiPointSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const model = installModelSequence([incomplete, incomplete]);
  try {
    assert.equal((await POST(request(multiPointSources))).status, 502);
    assert.equal(model.calls(), 2);
  } finally { model.restore(); }
});

test("疑似口播支架经复核后作为待确认候选保留在母稿", async () => {
  const spokenSources = [
    {
      id: "source-1",
      name: "素材1",
      content: "客户不买，往往是因为缺乏信任。我知道说真话可能会被骂，但我还是要讲出来。",
    },
    {
      id: "source-2",
      name: "素材2",
      content: "那怎么办？第一，先通过持续兑现承诺建立信任。",
    },
  ];
  const extraction = {
    facts: [
      {
        id: "F01",
        statement: "客户不买，往往是因为缺乏信任。",
        originalQuote: "客户不买，往往是因为缺乏信任。",
        sourceId: "source-1",
        classification: "usable",
        confidence: "high",
      },
      {
        id: "F02",
        statement: "先通过持续兑现承诺建立信任。",
        originalQuote: "先通过持续兑现承诺建立信任。",
        sourceId: "source-2",
        classification: "usable",
        confidence: "high",
      },
      {
        id: "F03",
        statement: "口播自我表态",
        originalQuote: "我知道说真话可能会被骂，但我还是要讲出来。",
        sourceId: "source-1",
        classification: "context_only",
        confidence: "high",
      },
      {
        id: "F04",
        statement: "提问和序号过渡",
        originalQuote: "那怎么办？第一，",
        sourceId: "source-2",
        classification: "context_only",
        confidence: "high",
      },
    ],
    relations: [{
      id: "R01",
      type: "complement",
      factIds: ["F01", "F02"],
      summary: "原因与方法互补",
    }],
  };
  const review = {
    decisions: extraction.facts.map(fact => ({
      factId: fact.id,
      decision: "passed",
      classification: fact.classification,
      atomicity: "atomic",
      reason: "原文支持",
    })),
    relationDecisions: [{ relationId: "R01", decision: "passed", reason: "关系成立" }],
    suggestedRelations: [],
  };
  const synthesis = { draft: { sections: [
    { paragraphPlans: [{ factIds: ["F01", "F02"] }] },
    { paragraphPlans: [{ factIds: ["F03"] }] },
    { paragraphPlans: [{ factIds: ["F04"] }] },
  ] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const response = await POST(request(spokenSources));
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200);
    assert.equal(model.calls(), 3);
    assert.match(body.draft.fullText, /说真话可能会被骂/);
    assert.match(body.draft.fullText, /那怎么办/);
    assert.deepEqual(body.exclusionCandidates.map((item: { id: string }) => item.id), ["candidate-1", "candidate-2"]);
    assert.deepEqual(body.draft.sections[1].paragraphs[0].exclusionCandidateIds, ["candidate-1"]);
    assert.doesNotMatch(JSON.stringify(body), /context_only|pending_user_review|"F03"|"F04"/);
  } finally { model.restore(); }
});

test("复核建议拒绝口播支架时仍须等待用户确认", async () => {
  const sources = [
    { id: "source-1", name: "素材1", content: "你听懂了吗？" },
    { id: "source-2", name: "素材2", content: "复盘可以帮助团队发现问题。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "互动问句", originalQuote: sources[0].content, sourceId: "source-1", classification: "context_only", confidence: "high" },
      { id: "F02", statement: sources[1].content, originalQuote: sources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const review = {
    decisions: [
      { factId: "F01", decision: "rejected", classification: "context_only", atomicity: "atomic", reason: "建议排除" },
      { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
    ],
    relationDecisions: [],
    suggestedRelations: [],
  };
  const synthesis = { draft: { sections: [
    { paragraphPlans: [{ factIds: ["F02"] }] },
    { paragraphPlans: [{ factIds: ["F01"] }] },
  ] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const response = await POST(request(sources));
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200);
    assert.match(body.draft.fullText, /你听懂了吗/);
    assert.equal(body.exclusionCandidates.length, 1);
    assert.equal(body.contentReview.exclusions.length, 0);
  } finally { model.restore(); }
});

test("复核不确定是否为口播支架时转为依据不足并继续保留", async () => {
  const sources = [
    { id: "source-1", name: "素材1", content: "那怎么办？" },
    { id: "source-2", name: "素材2", content: "复盘可以帮助团队发现问题。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "提问过渡", originalQuote: sources[0].content, sourceId: "source-1", classification: "context_only", confidence: "high" },
      { id: "F02", statement: sources[1].content, originalQuote: sources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const invalidReview = {
    decisions: [
      { factId: "F01", decision: "needs_review", classification: "context_only", atomicity: "atomic", reason: "不确定" },
      { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
    ],
    relationDecisions: [],
    suggestedRelations: [],
  };
  const synthesis = { draft: { sections: [
    { paragraphPlans: [{ factIds: ["F01"] }] },
    { paragraphPlans: [{ factIds: ["F02"] }] },
  ] } };
  const model = installModelSequence([extraction, invalidReview, synthesis]);
  try {
    const response = await POST(request(sources));
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200);
    assert.equal(model.calls(), 3);
    assert.equal(body.exclusionCandidates.length, 0);
    assert.equal(body.contentReview.evidenceGaps.length, 1);
    assert.match(body.draft.fullText, /那怎么办/);
  } finally { model.restore(); }
});

test("待确认排除候选不参与关系图并独立保留成节", async () => {
  const sources = [
    { id: "source-1", name: "素材1", content: "你听懂了吗？" },
    { id: "source-2", name: "素材2", content: "复盘可以帮助团队发现问题。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "互动问句", originalQuote: sources[0].content, sourceId: "source-1", classification: "context_only", confidence: "high" },
      { id: "F02", statement: sources[1].content, originalQuote: sources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [{ id: "R01", type: "complement", factIds: ["F01", "F02"], summary: "错误关系" }],
  };
  const review = {
    decisions: extraction.facts.map(fact => ({ factId: fact.id, decision: "passed", classification: fact.classification, atomicity: "atomic", reason: "已复核" })),
    relationDecisions: [{ relationId: "R01", decision: "passed", reason: "模型误保留" }],
    suggestedRelations: [],
  };
  const synthesis = { draft: { sections: [
    { paragraphPlans: [{ factIds: ["F02"] }] },
    { paragraphPlans: [{ factIds: ["F01"] }] },
  ] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const response = await POST(request(sources));
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200);
    assert.equal(body.conflicts.length, 0);
    assert.deepEqual(body.exclusionCandidates.map((item: { id: string }) => item.id), ["candidate-1"]);
  } finally { model.restore(); }
});

test("待确认排除候选与正常观点放在同一节时拒绝生成", async () => {
  const sources = [
    { id: "source-1", name: "素材1", content: "你听懂了吗？" },
    { id: "source-2", name: "素材2", content: "复盘可以帮助团队发现问题。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "互动问句", originalQuote: sources[0].content, sourceId: "source-1", classification: "context_only", confidence: "high" },
      { id: "F02", statement: sources[1].content, originalQuote: sources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const review = {
    decisions: extraction.facts.map(fact => ({ factId: fact.id, decision: "passed", classification: fact.classification, atomicity: "atomic", reason: "已复核" })),
    relationDecisions: [],
    suggestedRelations: [],
  };
  const invalidSynthesis = { draft: { sections: [{
    paragraphPlans: [{ factIds: ["F02"] }, { factIds: ["F01"] }],
  }] } };
  const model = installModelSequence([extraction, review, invalidSynthesis, invalidSynthesis]);
  try {
    const response = await POST(request(sources));
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 502);
    assert.equal(model.calls(), 4);
    assert.deepEqual(body, { error: "文案整合失败，请重试" });
  } finally { model.restore(); }
});

test("同一句逗号后的独立观点也不能被提取阶段遗漏", async () => {
  const clauseSources = [
    { id: "source-1", name: "素材1", content: "客户是否购买主要取决于信任，但现金流决定企业能否持续经营。" },
    { id: "source-2", name: "素材2", content: "复盘可以帮助团队发现问题。" },
  ];
  const incomplete = {
    facts: [
      { id: "F01", statement: "信任影响购买", originalQuote: "客户是否购买主要取决于信任，", sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: clauseSources[1].content, originalQuote: clauseSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const model = installModelSequence([incomplete, incomplete]);
  try {
    assert.equal((await POST(request(clauseSources))).status, 502);
    assert.equal(model.calls(), 2);
  } finally { model.restore(); }
});

test("没有写具体年份的确定性时间预测也归入未采用", async () => {
  const relativeTimeSources = [
    { id: "source-1", name: "素材1", content: "明年一定会发生巨大转变。" },
    { id: "source-2", name: "素材2", content: "面对变化时需要保持观察。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: relativeTimeSources[0].content, originalQuote: relativeTimeSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: relativeTimeSources[1].content, originalQuote: relativeTimeSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const review = { decisions: [
    { factId: "F01", decision: "passed", classification: "exclude_time_prediction", atomicity: "atomic", reason: "属于无依据时间预测" },
    { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
  ], relationDecisions: [], suggestedRelations: [] };
  const synthesis = { draft: { sections: [{ paragraphPlans: [{ factIds: ["F02"] }] }] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const body = await (await POST(request(relativeTimeSources))).json() as Record<string, any>;
    assert.equal(body.contentReview.exclusions.length, 1);
    assert.doesNotMatch(body.draft.fullText, /明年一定/);
  } finally { model.restore(); }
});

test("相同素材中的普通会字时间断言仍会被系统排除", async () => {
  const predictionSources = [
    { id: "source-1", name: "素材1", content: "明年公司会倒闭。面对变化时需要保持观察。" },
    { id: "source-2", name: "素材2", content: "明年公司会倒闭。面对变化时需要保持观察。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "明年公司会倒闭。", originalQuote: "明年公司会倒闭。", sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: "面对变化时需要保持观察。", originalQuote: "面对变化时需要保持观察。", sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F03", statement: "明年公司会倒闭。", originalQuote: "明年公司会倒闭。", sourceId: "source-2", classification: "usable", confidence: "high" },
      { id: "F04", statement: "面对变化时需要保持观察。", originalQuote: "面对变化时需要保持观察。", sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [
      { id: "R01", type: "overlap", factIds: ["F01", "F03"], summary: "相同预测" },
      { id: "R02", type: "overlap", factIds: ["F02", "F04"], summary: "相同建议" },
    ],
  };
  const review = {
    decisions: [
      { factId: "F01", decision: "passed", classification: "exclude_time_prediction", atomicity: "atomic", reason: "无依据时间预测" },
      { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
      { factId: "F03", decision: "passed", classification: "exclude_time_prediction", atomicity: "atomic", reason: "无依据时间预测" },
      { factId: "F04", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
    ],
    relationDecisions: [
      { relationId: "R01", decision: "passed", reason: "相同预测" },
      { relationId: "R02", decision: "passed", reason: "相同建议" },
    ],
    suggestedRelations: [],
  };
  const synthesis = { draft: { sections: [{ paragraphPlans: [{ factIds: ["F02", "F04"] }] }] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const body = await (await POST(request(predictionSources))).json() as Record<string, any>;
    assert.equal(body.contentReview.exclusions.length, 2);
    assert.doesNotMatch(body.draft.fullText, /明年公司会倒闭/);
    assert.equal(model.calls(), 3);
  } finally { model.restore(); }
});

test("相同素材中的明确计划不会被时间预测规则误删", async () => {
  const scheduleSources = [
    { id: "source-1", name: "素材1", content: "明年公司一定会按计划搬迁。" },
    { id: "source-2", name: "素材2", content: "明年公司一定会按计划搬迁。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: scheduleSources[0].content, originalQuote: scheduleSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: scheduleSources[1].content, originalQuote: scheduleSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [{ id: "R01", type: "overlap", factIds: ["F01", "F02"], summary: "相同计划" }],
  };
  const review = { decisions: [
    { factId: "F01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "明确计划" },
    { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "明确计划" },
  ], relationDecisions: [
    { relationId: "R01", decision: "passed", reason: "相同计划" },
  ], suggestedRelations: [] };
  const model = installModelSequence([extraction, review, SYNTHESIS]);
  try {
    const body = await (await POST(request(scheduleSources))).json() as Record<string, any>;
    assert.match(body.draft.fullText, /按计划搬迁/);
    assert.equal(body.contentReview.exclusions.length, 0);
    assert.equal(model.calls(), 3);
  } finally { model.restore(); }
});

test("带官方字样的无依据预言仍归入未采用", async () => {
  const prophecySources = [
    { id: "source-1", name: "素材1", content: "官方预言，明年灵魂将归位。保持观察。" },
    { id: "source-2", name: "素材2", content: "官方预言，明年灵魂将归位。保持观察。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "官方预言明年灵魂将归位", originalQuote: "官方预言，明年灵魂将归位。", sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: "保持观察", originalQuote: "保持观察。", sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F03", statement: "官方预言明年灵魂将归位", originalQuote: "官方预言，明年灵魂将归位。", sourceId: "source-2", classification: "usable", confidence: "high" },
      { id: "F04", statement: "保持观察", originalQuote: "保持观察。", sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [
      { id: "R01", type: "overlap", factIds: ["F01", "F03"], summary: "相同预言" },
      { id: "R02", type: "overlap", factIds: ["F02", "F04"], summary: "相同建议" },
    ],
  };
  const review = {
    decisions: [
      { factId: "F01", decision: "passed", classification: "exclude_time_prediction", atomicity: "atomic", reason: "无依据预言" },
      { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
      { factId: "F03", decision: "passed", classification: "exclude_time_prediction", atomicity: "atomic", reason: "无依据预言" },
      { factId: "F04", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
    ],
    relationDecisions: [
      { relationId: "R01", decision: "passed", reason: "相同预言" },
      { relationId: "R02", decision: "passed", reason: "相同建议" },
    ],
    suggestedRelations: [],
  };
  const synthesis = { draft: { sections: [{ paragraphPlans: [{ factIds: ["F02", "F04"] }] }] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const body = await (await POST(request(prophecySources))).json() as Record<string, any>;
    assert.equal(body.contentReview.exclusions.length, 2);
    assert.doesNotMatch(body.draft.fullText, /灵魂将归位/);
  } finally { model.restore(); }
});

test("同段出现计划字样也必须复核真正的未来断言", async () => {
  const mixedSources = [
    { id: "source-1", name: "素材1", content: "公司已发布年度计划，但明年公司会倒闭。保持观察。" },
    { id: "source-2", name: "素材2", content: "公司已发布年度计划，但明年公司会倒闭。保持观察。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: "明年公司会倒闭", originalQuote: "公司已发布年度计划，但明年公司会倒闭。", sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: "保持观察", originalQuote: "保持观察。", sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F03", statement: "明年公司会倒闭", originalQuote: "公司已发布年度计划，但明年公司会倒闭。", sourceId: "source-2", classification: "usable", confidence: "high" },
      { id: "F04", statement: "保持观察", originalQuote: "保持观察。", sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [
      { id: "R01", type: "overlap", factIds: ["F01", "F03"], summary: "相同预测" },
      { id: "R02", type: "overlap", factIds: ["F02", "F04"], summary: "相同建议" },
    ],
  };
  const review = {
    decisions: [
      { factId: "F01", decision: "passed", classification: "exclude_time_prediction", atomicity: "atomic", reason: "计划不能支持倒闭预测" },
      { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
      { factId: "F03", decision: "passed", classification: "exclude_time_prediction", atomicity: "atomic", reason: "计划不能支持倒闭预测" },
      { factId: "F04", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
    ],
    relationDecisions: [
      { relationId: "R01", decision: "passed", reason: "相同预测" },
      { relationId: "R02", decision: "passed", reason: "相同建议" },
    ],
    suggestedRelations: [],
  };
  const synthesis = { draft: { sections: [{ paragraphPlans: [{ factIds: ["F02", "F04"] }] }] } };
  const prompts: string[] = [];
  const model = installModelSequence([extraction, review, synthesis], prompts);
  try {
    const body = await (await POST(request(mixedSources))).json() as Record<string, any>;
    assert.equal(body.contentReview.exclusions.length, 2);
    assert.equal(model.calls(), 3);
    assert.match(prompts[1], /明年公司会倒闭/);
  } finally { model.restore(); }
});

test("已确认的未来安排即使命中宽泛词面也可由复核恢复", async () => {
  const confirmedSources = [
    { id: "source-1", name: "素材1", content: "公司负责人已确认，2026年将搬入新办公室。" },
    { id: "source-2", name: "素材2", content: "官方公告，明年将启动时代广场重启工程。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: confirmedSources[0].content, originalQuote: confirmedSources[0].content, sourceId: "source-1", classification: "exclude_time_prediction", confidence: "medium" },
      { id: "F02", statement: confirmedSources[1].content, originalQuote: confirmedSources[1].content, sourceId: "source-2", classification: "exclude_time_prediction", confidence: "medium" },
    ],
    relations: [],
  };
  const review = { decisions: [
    { factId: "F01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "负责人已确认" },
    { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "官方公告中的工程安排" },
  ], relationDecisions: [], suggestedRelations: [] };
  const synthesis = { draft: { sections: [
    { paragraphPlans: [{ factIds: ["F01"] }] },
    { paragraphPlans: [{ factIds: ["F02"] }] },
  ] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const body = await (await POST(request(confirmedSources))).json() as Record<string, any>;
    assert.equal(body.contentReview.exclusions.length, 0);
    assert.match(body.draft.fullText, /2026年将搬入新办公室/);
    assert.match(body.draft.fullText, /时代广场重启工程/);
  } finally { model.restore(); }
});

test("今年年底和下季度等时间表达都会进入独立复核", async () => {
  const formatSources = [
    { id: "source-1", name: "素材1", content: "今年年底公司会倒闭。" },
    { id: "source-2", name: "素材2", content: "下季度市场迎来巨变。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: formatSources[0].content, originalQuote: formatSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: formatSources[1].content, originalQuote: formatSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const review = { decisions: [
    { factId: "F01", decision: "passed", classification: "exclude_time_prediction", atomicity: "atomic", reason: "无依据时间断言" },
    { factId: "F02", decision: "passed", classification: "exclude_time_prediction", atomicity: "atomic", reason: "无依据时间断言" },
  ], relationDecisions: [], suggestedRelations: [] };
  const model = installModelSequence([extraction, review]);
  try {
    assert.equal((await POST(request(formatSources))).status, 502);
    assert.equal(model.calls(), 2);
  } finally { model.restore(); }
});

test("明晚和下星期等常见时间表达也会进入独立复核", async () => {
  const formatSources = [
    { id: "source-1", name: "素材1", content: "明晚公司会倒闭。" },
    { id: "source-2", name: "素材2", content: "下星期市场会迎来巨变。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: formatSources[0].content, originalQuote: formatSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: formatSources[1].content, originalQuote: formatSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const review = { decisions: [
    { factId: "F01", decision: "passed", classification: "exclude_time_prediction", atomicity: "atomic", reason: "无依据时间断言" },
    { factId: "F02", decision: "passed", classification: "exclude_time_prediction", atomicity: "atomic", reason: "无依据时间断言" },
  ], relationDecisions: [], suggestedRelations: [] };
  const model = installModelSequence([extraction, review]);
  try {
    assert.equal((await POST(request(formatSources))).status, 502);
    assert.equal(model.calls(), 2);
  } finally { model.restore(); }
});

test("没有标点的转折短尾观点也不能被提取遗漏", async () => {
  const tailSources = [
    { id: "source-1", name: "素材1", content: "客户信任会持续影响成交表现与长期合作关系并决定沟通效率但现金流断裂。" },
    { id: "source-2", name: "素材2", content: "复盘可以帮助团队发现问题。" },
  ];
  const incomplete = {
    facts: [
      { id: "F01", statement: "信任影响成交和合作", originalQuote: "客户信任会持续影响成交表现与长期合作关系并决定沟通效率", sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: tailSources[1].content, originalQuote: tailSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const model = installModelSequence([incomplete, incomplete]);
  try {
    assert.equal((await POST(request(tailSources))).status, 502);
    assert.equal(model.calls(), 2);
  } finally { model.restore(); }
});

test("只有两个字的独立结论也不能被提取遗漏", async () => {
  const shortSources = [
    { id: "source-1", name: "素材1", content: "信任影响成交。亏损。" },
    { id: "source-2", name: "素材2", content: "复盘可以帮助团队发现问题。" },
  ];
  const incomplete = {
    facts: [
      { id: "F01", statement: "信任影响成交", originalQuote: "信任影响成交。", sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: shortSources[1].content, originalQuote: shortSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const model = installModelSequence([incomplete, incomplete]);
  try {
    assert.equal((await POST(request(shortSources))).status, 502);
    assert.equal(model.calls(), 2);
  } finally { model.restore(); }
});

test("一个字的独立结论也不能被提取遗漏", async () => {
  const shortSources = [
    { id: "source-1", name: "素材1", content: "信任影响成交。涨。" },
    { id: "source-2", name: "素材2", content: "复盘可以帮助团队发现问题。" },
  ];
  const incomplete = {
    facts: [
      { id: "F01", statement: "信任影响成交", originalQuote: "信任影响成交。", sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: shortSources[1].content, originalQuote: shortSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const model = installModelSequence([incomplete, incomplete]);
  try {
    assert.equal((await POST(request(shortSources))).status, 502);
    assert.equal(model.calls(), 2);
  } finally { model.restore(); }
});

test("复核能用新关系纠正提取阶段标错的关系类型", async () => {
  const relationSources = [
    { id: "source-1", name: "素材1", content: "建立信任需要7天。" },
    { id: "source-2", name: "素材2", content: "建立信任至少需要30天。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: relationSources[0].content, originalQuote: relationSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: relationSources[1].content, originalQuote: relationSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [{ id: "R01", type: "overlap", factIds: ["F01", "F02"], summary: "错误标成重复" }],
  };
  const review = {
    decisions: [
      { factId: "F01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
      { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
    ],
    relationDecisions: [{ relationId: "R01", decision: "rejected", classification: "usable", atomicity: "atomic", reason: "实际是冲突" }],
    suggestedRelations: [{ id: "RR01", type: "conflict", factIds: ["F01", "F02"], summary: "所需时间冲突" }],
  };
  const synthesis = { draft: { sections: [{ paragraphPlans: [{ factIds: ["F01", "F02"] }] }] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const body = await (await POST(request(relationSources))).json() as Record<string, any>;
    assert.equal(body.conflicts.length, 1);
    assert.match(body.draft.fullText, /存在分歧/);
    assert.equal(model.calls(), 3);
  } finally { model.restore(); }
});

test("同一对事实不能同时保留重叠和冲突两种关系", async () => {
  const relationSources = [
    { id: "source-1", name: "素材1", content: "建立信任需要7天。" },
    { id: "source-2", name: "素材2", content: "建立信任至少需要30天。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: relationSources[0].content, originalQuote: relationSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: relationSources[1].content, originalQuote: relationSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [{ id: "R01", type: "overlap", factIds: ["F01", "F02"], summary: "错误标成重复" }],
  };
  const invalidReview = {
    decisions: [
      { factId: "F01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
      { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
    ],
    relationDecisions: [{ relationId: "R01", decision: "passed", reason: "错误保留旧关系" }],
    suggestedRelations: [{ id: "RR01", type: "conflict", factIds: ["F01", "F02"], summary: "所需时间冲突" }],
  };
  const model = installModelSequence([extraction, invalidReview, invalidReview]);
  try {
    assert.equal((await POST(request(relationSources))).status, 502);
    assert.equal(model.calls(), 3);
  } finally { model.restore(); }
});

test("同一事实或关系出现互相矛盾的重复复核决定时整份拒绝", async () => {
  const riskSources = [
    { id: "source-1", name: "素材1", content: "建立信任需要7天。" },
    { id: "source-2", name: "素材2", content: "建立信任需要30天。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: riskSources[0].content, originalQuote: riskSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: riskSources[1].content, originalQuote: riskSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [{ id: "R01", type: "conflict", factIds: ["F01", "F02"], summary: "时间冲突" }],
  };
  const duplicateReview = {
    decisions: [
      { factId: "F01", decision: "rejected", classification: "usable", atomicity: "atomic", reason: "先拒绝" },
      { factId: "F01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "后覆盖" },
      { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
    ],
    relationDecisions: [
      { relationId: "R01", decision: "rejected", reason: "先拒绝" },
      { relationId: "R01", decision: "passed", reason: "后覆盖" },
    ],
    suggestedRelations: [],
  };
  const model = installModelSequence([extraction, duplicateReview, duplicateReview]);
  try {
    assert.equal((await POST(request(riskSources))).status, 502);
    assert.equal(model.calls(), 3);
  } finally { model.restore(); }
});

test("把整份多观点素材冒充一个原子事实时拒绝生成母稿", async () => {
  const groupedSources = [
    { id: "source-1", name: "素材1", content: "有些人长期模仿偶像的表情。过度关注还会影响自己的生活节奏。" },
    { id: "source-2", name: "素材2", content: "注意力长期放在外界可能消耗心神。静坐观察呼吸可以帮助收回注意力。" },
  ];
  const groupedExtraction = {
    facts: [
      { id: "F01", statement: "模仿偶像会影响生活", originalQuote: groupedSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: "关注外界会消耗心神并可用静坐调整", originalQuote: groupedSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [{ id: "R01", type: "complement", factIds: ["F01", "F02"], summary: "现象、原因和方法" }],
  };
  const overGroupedReview = {
    decisions: [
      { factId: "F01", decision: "rejected", classification: "usable", atomicity: "over_grouped", reason: "混合了现象和影响" },
      { factId: "F02", decision: "rejected", classification: "usable", atomicity: "over_grouped", reason: "混合了原因和方法" },
    ],
    relationDecisions: [{ relationId: "R01", decision: "rejected", reason: "需先拆分事实" }],
    suggestedRelations: [],
  };
  const model = installModelSequence([groupedExtraction, overGroupedReview]);
  try {
    assert.equal((await POST(request(groupedSources, "按现象、原因、方法组织"))).status, 502);
    assert.equal(model.calls(), 2);
  } finally { model.restore(); }
});

test("单句用并且连接多个观点时也必须经过原子性复核", async () => {
  const groupedSources = [
    { id: "source-1", name: "素材1", content: "过度关注外界会消耗心神，并且静坐可以帮助收回注意力。" },
    { id: "source-2", name: "素材2", content: "过度关注外界会消耗心神，并且静坐可以帮助收回注意力。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: groupedSources[0].content, originalQuote: groupedSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: groupedSources[1].content, originalQuote: groupedSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [{ id: "R01", type: "overlap", factIds: ["F01", "F02"], summary: "相同内容" }],
  };
  const review = { decisions: [
    { factId: "F01", decision: "rejected", classification: "usable", atomicity: "over_grouped", reason: "混合了原因和方法" },
    { factId: "F02", decision: "rejected", classification: "usable", atomicity: "over_grouped", reason: "混合了原因和方法" },
  ], relationDecisions: [{ relationId: "R01", decision: "rejected", reason: "需先拆分" }], suggestedRelations: [] };
  const model = installModelSequence([extraction, review]);
  try {
    assert.equal((await POST(request(groupedSources))).status, 502);
    assert.equal(model.calls(), 2);
  } finally { model.restore(); }
});

test("同一素材的相同原文不能换Fact_ID重复登记", async () => {
  const duplicateFact = {
    facts: [
      ...EXTRACTION.facts,
      { ...EXTRACTION.facts[0], id: "F03" },
    ],
    relations: EXTRACTION.relations,
  };
  const model = installModelSequence([duplicateFact, duplicateFact]);
  try {
    assert.equal((await POST(request())).status, 502);
    assert.equal(model.calls(), 2);
  } finally { model.restore(); }
});

test("相同原文不能只改句末标点后换Fact_ID重复登记", async () => {
  const punctuatedSources = [
    { id: "source-1", name: "素材1", content: "信任影响成交。" },
    { id: "source-2", name: "素材2", content: "复盘帮助发现问题。" },
  ];
  const duplicateFact = {
    facts: [
      { id: "F01", statement: "信任影响成交", originalQuote: "信任影响成交", sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: "信任影响成交", originalQuote: "信任影响成交。", sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F03", statement: punctuatedSources[1].content, originalQuote: punctuatedSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const model = installModelSequence([duplicateFact, duplicateFact]);
  try {
    assert.equal((await POST(request(punctuatedSources))).status, 502);
    assert.equal(model.calls(), 2);
  } finally { model.restore(); }
});

test("相同Fact组合不能换Relation_ID重复登记同一种关系", async () => {
  const duplicateRelation = {
    ...EXTRACTION,
    relations: [
      EXTRACTION.relations[0],
      { ...EXTRACTION.relations[0], id: "R02" },
    ],
  };
  const model = installModelSequence([duplicateRelation, duplicateRelation]);
  try {
    assert.equal((await POST(request())).status, 502);
    assert.equal(model.calls(), 2);
  } finally { model.restore(); }
});

test("复核不能在保留旧关系时再新增一条同内容关系", async () => {
  const conflictSources = [
    { id: "source-1", name: "素材1", content: "建立信任需要7天。" },
    { id: "source-2", name: "素材2", content: "建立信任需要30天。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: conflictSources[0].content, originalQuote: conflictSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: conflictSources[1].content, originalQuote: conflictSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [{ id: "R01", type: "conflict", factIds: ["F01", "F02"], summary: "所需时间不同" }],
  };
  const duplicateReview = { decisions: [
    { factId: "F01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
    { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
  ], relationDecisions: [{ relationId: "R01", decision: "passed", reason: "冲突成立" }], suggestedRelations: [
    { id: "RR01", type: "conflict", factIds: ["F01", "F02"], summary: "重复冲突" },
  ] };
  const model = installModelSequence([extraction, duplicateReview, duplicateReview]);
  try {
    assert.equal((await POST(request(conflictSources))).status, 502);
    assert.equal(model.calls(), 3);
  } finally { model.restore(); }
});

test("明显重复的跨素材观点缺少关系时拒绝进入母稿规划", async () => {
  const duplicateSources = [
    { id: "source-1", name: "素材1", content: "客户信任会影响成交。" },
    { id: "source-2", name: "素材2", content: "客户信任会影响成交。" },
  ];
  const missingRelation = {
    facts: [
      { id: "F01", statement: duplicateSources[0].content, originalQuote: duplicateSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: duplicateSources[1].content, originalQuote: duplicateSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const model = installModelSequence([missingRelation, missingRelation]);
  try {
    assert.equal((await POST(request(duplicateSources))).status, 502);
    assert.equal(model.calls(), 2);
  } finally { model.restore(); }
});

test("模型请求失败不消耗面向校验失败的纠错额度", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "temporary" }), { status: 500 });
  };
  try {
    assert.equal((await POST(request())).status, 502);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("复核可以补回提取阶段漏掉的跨素材关系", async () => {
  const relatedSources = [
    { id: "source-1", name: "素材1", content: "客户迟迟不下单，是因为还没有建立信任。" },
    { id: "source-2", name: "素材2", content: "持续兑现承诺，可以逐步建立信赖。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: relatedSources[0].content, originalQuote: relatedSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: relatedSources[1].content, originalQuote: relatedSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [],
  };
  const review = {
    decisions: [
      { factId: "F01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
      { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
    ],
    relationDecisions: [],
    suggestedRelations: [{ id: "RR01", type: "complement", factIds: ["F01", "F02"], summary: "信任问题与建立信任的方法互相补充" }],
  };
  const synthesis = { draft: { sections: [{ paragraphPlans: [{ factIds: ["F01", "F02"] }] }] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const response = await POST(request(relatedSources));
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200);
    assert.equal(model.calls(), 3);
    assert.match(body.draft.fullText, /在此基础上，另一份素材补充/);
    assert.match(body.draft.fullText, /持续兑现承诺/);
  } finally { model.restore(); }
});

test("同一事实可以同时参与重叠和补充关系且新增证据不丢失", async () => {
  const graphSources = [
    { id: "source-1", name: "素材1", content: "信任会影响成交。" },
    { id: "source-2", name: "素材2", content: "客户信任品牌后更愿意购买。" },
    { id: "source-3", name: "素材3", content: "持续兑现承诺可以逐步建立客户信任。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: graphSources[0].content, originalQuote: graphSources[0].content, sourceId: "source-1", classification: "usable", confidence: "high" },
      { id: "F02", statement: graphSources[1].content, originalQuote: graphSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
      { id: "F03", statement: graphSources[2].content, originalQuote: graphSources[2].content, sourceId: "source-3", classification: "usable", confidence: "high" },
    ],
    relations: [
      { id: "R01", type: "overlap", factIds: ["F01", "F02"], summary: "信任影响购买" },
      { id: "R02", type: "complement", factIds: ["F02", "F03"], summary: "补充建立信任的方法" },
    ],
  };
  const review = {
    decisions: graphSources.map((_, index) => ({ factId: `F0${index + 1}`, decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" })),
    relationDecisions: [
      { relationId: "R01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "重叠关系成立" },
      { relationId: "R02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "补充关系成立" },
    ],
    suggestedRelations: [],
  };
  const synthesis = { draft: { sections: [{ paragraphPlans: [{ factIds: ["F01", "F02", "F03"] }] }] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const body = await (await POST(request(graphSources))).json() as Record<string, any>;
    assert.match(body.draft.fullText, /信任会影响成交/);
    assert.match(body.draft.fullText, /客户信任品牌后更愿意购买/);
    assert.match(body.draft.fullText, /持续兑现承诺可以逐步建立客户信任/);
  } finally { model.restore(); }
});

test("公开四部分不使用提取模型自由编写的关系摘要", async () => {
  const safeSources = [
    { id: "source-1", name: "素材1", content: "过度关注外界可能消耗注意力。" },
    { id: "source-2", name: "素材2", content: "静坐可以帮助收回注意力。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: safeSources[0].content, originalQuote: safeSources[0].content, sourceId: "source-1", classification: "usable", confidence: "low" },
      { id: "F02", statement: safeSources[1].content, originalQuote: safeSources[1].content, sourceId: "source-2", classification: "usable", confidence: "low" },
    ],
    relations: [{ id: "R01", type: "complement", factIds: ["F01", "F02"], summary: "静坐三天就能彻底改变命运" }],
  };
  const review = {
    decisions: [
      { factId: "F01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "模拟复核放行" },
      { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "模拟复核放行" },
    ],
    relationDecisions: [{ relationId: "R01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "模拟复核放行" }],
    suggestedRelations: [],
  };
  const synthesis = { draft: { sections: [{ paragraphPlans: [{ factIds: ["F01", "F02"] }] }] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const serialized = JSON.stringify(await (await POST(request(safeSources))).json());
    assert.doesNotMatch(serialized, /三天|改变命运/);
    assert.match(serialized, /过度关注外界可能消耗注意力/);
    assert.match(serialized, /静坐可以帮助收回注意力/);
  } finally { model.restore(); }
});

test("官方日程中的未来年份可由复核纠正为可用事实", async () => {
  const scheduleSources = [
    { id: "source-1", name: "素材1", content: "公司已经发布公告，2026年将搬入新办公室。" },
    { id: "source-2", name: "素材2", content: "搬迁期间团队将采用远程办公。" },
  ];
  const extraction = {
    facts: [
      { id: "F01", statement: scheduleSources[0].content, originalQuote: scheduleSources[0].content, sourceId: "source-1", classification: "exclude_time_prediction", confidence: "medium" },
      { id: "F02", statement: scheduleSources[1].content, originalQuote: scheduleSources[1].content, sourceId: "source-2", classification: "usable", confidence: "high" },
    ],
    relations: [{ id: "R01", type: "complement", factIds: ["F01", "F02"], summary: "搬迁安排与过渡方式" }],
  };
  const review = {
    decisions: [
      { factId: "F01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "这是已发布公告，不是无依据预测" },
      { factId: "F02", decision: "passed", classification: "usable", atomicity: "atomic", reason: "原文支持" },
    ],
    relationDecisions: [{ relationId: "R01", decision: "passed", classification: "usable", atomicity: "atomic", reason: "补充关系成立" }],
    suggestedRelations: [],
  };
  const synthesis = { draft: { sections: [{ paragraphPlans: [{ factIds: ["F01", "F02"] }] }] } };
  const model = installModelSequence([extraction, review, synthesis]);
  try {
    const body = await (await POST(request(scheduleSources))).json() as Record<string, any>;
    assert.equal(body.contentReview.exclusions.length, 0);
    assert.match(body.draft.fullText, /2026年将搬入新办公室/);
  } finally { model.restore(); }
});

test("用户补充的组织顺序要求会传入母稿规划阶段", async () => {
  const prompts: string[] = [];
  const model = installModelSequence([EXTRACTION, REVIEW, SYNTHESIS], prompts);
  try {
    assert.equal((await POST(request(SOURCES, "按问题、原因、方法排序"))).status, 200);
    assert.match(prompts[2], /按问题、原因、方法排序/);
  } finally { model.restore(); }
});
