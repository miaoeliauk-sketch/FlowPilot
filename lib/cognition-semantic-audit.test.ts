import assert from "node:assert/strict";
import test from "node:test";
import type { SemanticAuditReport, SemanticAuditResult } from "./cognition-semantic-audit";
import type { CognitionNodeV2 } from "./types";

const semanticModulePath = "./cognition-semantic-audit";

function node(
  id: string,
  claim: string,
  options: { question?: string; concepts?: string[] } = {},
): CognitionNodeV2 {
  return {
    id,
    question: {
      content: options.question ?? "老师如何看待这个问题？",
      anchors: [],
      derivation: "explicit",
    },
    claim: { content: claim, anchors: [] },
    reasoning: { status: "not_provided", steps: [] },
    evidence: [],
    concepts: (options.concepts ?? []).map(term => ({ term, definition: term, anchors: [] })),
    reviewStatus: "human_confirmed",
  };
}

function deepSeekResponse(content: string) {
  return new Response(JSON.stringify({
    id: "semantic-audit-test",
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 30, completion_tokens: 20 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function withMockedDeepSeek(
  response: string | ((body: Record<string, unknown>) => string),
  run: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return deepSeekResponse(typeof response === "function" ? response(body) : response);
  };
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("措辞不同但含义相同时判定为RELATED", async () => {
  await withMockedDeepSeek(JSON.stringify({ results: [{
    nodeId: "node-ledger",
    relation: "RELATED",
    reason: "两者都主张用结构化方式沉淀IP认知。",
    quote: "用结构化账本沉淀核心认知",
  }] }), async () => {
    const { auditSemanticRelation } = await import(semanticModulePath);
    const report: SemanticAuditReport = await auditSemanticRelation(
      "把老师的思考整理成可追溯的认知资产",
      [node("node-ledger", "用结构化账本沉淀核心认知")],
      "test-key",
    );

    assert.equal(report.results[0]?.relation, "RELATED");
  });
});

test("关键词高度重合但立场相反时判定为CONFLICTING", async () => {
  await withMockedDeepSeek(JSON.stringify({ results: [{
    nodeId: "node-happy",
    relation: "CONFLICTING",
    reason: "输入否定了节点明确表达的开心状态。",
    quote: "我今天很开心",
  }] }), async () => {
    const { auditSemanticRelation } = await import(semanticModulePath);
    const report: SemanticAuditReport = await auditSemanticRelation(
      "我今天很不开心",
      [node("node-happy", "我今天很开心")],
      "test-key",
    );

    assert.equal(report.results[0]?.relation, "CONFLICTING");
  });
});

test("检查后确认完全无关时判定为UNRELATED", async () => {
  await withMockedDeepSeek(JSON.stringify({ results: [{
    nodeId: "node-weather",
    relation: "UNRELATED",
    reason: "输入与天气认知没有共同议题。",
    quote: "今天会下雨",
  }] }), async () => {
    const { auditSemanticRelation } = await import(semanticModulePath);
    const report: SemanticAuditReport = await auditSemanticRelation(
      "如何建立IP结构化账本",
      [node("node-weather", "今天会下雨")],
      "test-key",
    );

    assert.equal(report.results[0]?.relation, "UNRELATED");
  });
});

test("模型引用输入集合之外的节点编号时拒绝整次结果", async () => {
  await withMockedDeepSeek(JSON.stringify({ results: [{
    nodeId: "invented-node",
    relation: "RELATED",
    reason: "虚构引用。",
    quote: "不存在的内容",
  }] }), async () => {
    const { auditSemanticRelation } = await import(semanticModulePath);

    await assert.rejects(
      () => auditSemanticRelation(
        "如何建立IP结构化账本",
        [node("real-node", "用结构化账本沉淀核心认知")],
        "test-key",
      ),
      /不存在|虚构|节点编号/,
    );
  });
});

test("超过12KB时优先保留字面与问题概念命中的节点，其余标记UNASSESSED", async () => {
  const relevant = node("node-priority", "认知资产需要持续沉淀", {
    question: "如何建立IP大脑的结构化账本？",
    concepts: ["结构化账本", "IP大脑"],
  });
  const filler = Array.from({ length: 18 }, (_, index) => node(
    `node-filler-${index}`,
    `与目标无关的材料${index}${"甲乙丙丁戊己庚辛壬癸".repeat(70)}`,
    { question: `无关问题${index}`, concepts: [`无关概念${index}`] },
  ));

  await withMockedDeepSeek((body) => {
    const messages = body.messages as Array<{ role: string; content: string }>;
    const prompt = messages.find(message => message.role === "user")?.content ?? "";
    const includedIds = [relevant, ...filler]
      .map(candidate => candidate.id)
      .filter(id => prompt.includes(`\"id\":\"${id}\"`));
    return JSON.stringify({
      results: includedIds.map(id => ({
        nodeId: id,
        relation: id === relevant.id ? "RELATED" : "UNRELATED",
        reason: id === relevant.id ? "问题和概念命中。" : "检查后无关。",
        quote: id === relevant.id
          ? relevant.claim.content
          : filler.find(candidate => candidate.id === id)?.claim.content,
      })),
    });
  }, async () => {
    const { auditSemanticRelation } = await import(semanticModulePath);
    const report: SemanticAuditReport = await auditSemanticRelation(
      "结构化账本如何帮助IP大脑",
      [relevant, ...filler],
      "test-key",
    );

    assert.equal(report.results.find((result: SemanticAuditResult) => result.nodeId === relevant.id)?.relation, "RELATED");
    const unassessed = report.results.filter((result: SemanticAuditResult) => result.relation === "UNASSESSED");
    assert.ok(unassessed.length > 0, "超限候选必须存在未送审节点");
    assert.ok(unassessed.every(result => result.reason.includes("未进入")));
    assert.ok(unassessed.every(result => result.quote.length > 0));
  });
});

test("容量竞争时精准概念命中不会被泛化的观点重合挤出", async () => {
  const conceptMatch = node("node-concept-match", "另一类长期认知", {
    question: `另一类问题${"甲乙丙丁戊己庚辛壬癸".repeat(25)}`,
    concepts: ["结构化账本", ...Array.from({ length: 8 }, (_, index) => `旁支概念${index}${"子丑寅卯辰巳午未".repeat(5)}`)],
  });
  const competitors = Array.from({ length: 24 }, (_, index) => node(
    `node-overlap-${index}`,
    `结构化账本帮助IP大脑${"甲乙丙丁戊己庚辛壬癸".repeat(18)}${index}`,
  ));

  await withMockedDeepSeek((body) => {
    assert.ok(new TextEncoder().encode(JSON.stringify(body)).byteLength <= 12_000);
    const prompt = ((body.messages as Array<{ content: string }>)[1]?.content) ?? "";
    const included = [conceptMatch, ...competitors].filter(candidate => (
      prompt.includes(`\"id\":\"${candidate.id}\"`)
    ));
    return JSON.stringify({ results: included.map(candidate => ({
      nodeId: candidate.id,
      relation: candidate.id === conceptMatch.id ? "RELATED" : "UNRELATED",
      reason: candidate.id === conceptMatch.id ? "概念精确命中。" : "检查后无关。",
      quote: candidate.id === conceptMatch.id ? "结构化账本" : candidate.claim.content,
    })) });
  }, async () => {
    const { auditSemanticRelation } = await import(semanticModulePath);
    const report: SemanticAuditReport = await auditSemanticRelation(
      "结构化账本",
      [conceptMatch, ...competitors],
      "test-key",
    );

    assert.ok(report.assessedNodeIds.includes(conceptMatch.id));
    assert.equal(report.results.find(result => result.nodeId === conceptMatch.id)?.relation, "RELATED");
  });
});

test("语义审计只发送人工修订后的推理链", async () => {
  const revised = node("node-revised", "停止学习是为了消化知识");
  revised.reasoning = {
    status: "complete",
    steps: [{ order: 1, content: "旧推理链不应进入审计", anchors: [] }],
  };
  revised.humanRevision = {
    reasoningSteps: [{ order: 1, content: "知识淤积会导致行动瘫痪" }],
    updatedAt: "2026-08-27T00:00:00.000Z",
  };

  await withMockedDeepSeek((body) => {
    const prompt = ((body.messages as Array<{ content: string }>)[1]?.content) ?? "";
    assert.match(prompt, /知识淤积会导致行动瘫痪/);
    assert.doesNotMatch(prompt, /旧推理链不应进入审计/);
    return JSON.stringify({ results: [{
      nodeId: revised.id,
      relation: "RELATED",
      reason: "输入与修订后的推理一致。",
      quote: "知识淤积会导致行动瘫痪",
    }] });
  }, async () => {
    const { auditSemanticRelation } = await import(semanticModulePath);
    const report: SemanticAuditReport = await auditSemanticRelation(
      "为什么学得越多越难行动",
      [revised],
      "test-key",
    );
    assert.equal(report.results[0]?.relation, "RELATED");
  });
});

test("全部节点能放入12KB时不产生UNASSESSED", async () => {
  const candidates = [
    node("node-one", "结构化账本记录认知"),
    node("node-two", "访谈回答需要保留原文"),
  ];
  await withMockedDeepSeek(JSON.stringify({ results: candidates.map(candidate => ({
    nodeId: candidate.id,
    relation: "RELATED",
    reason: "已完成检查。",
    quote: candidate.claim.content,
  })) }), async () => {
    const { auditSemanticRelation } = await import(semanticModulePath);
    const report: SemanticAuditReport = await auditSemanticRelation("认知如何留存", candidates, "test-key");

    assert.deepEqual(report.assessedNodeIds.sort(), candidates.map(candidate => candidate.id).sort());
    assert.deepEqual(report.unassessedNodeIds, []);
  });
});
