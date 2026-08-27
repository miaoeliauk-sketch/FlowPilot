import assert from "node:assert/strict";
import test from "node:test";
import type { CognitionNodeV2 } from "./types";

const pipelineModulePath = "./cognition-association-audit";

function node(id: string, claim: string): CognitionNodeV2 {
  return {
    id,
    question: { content: "老师如何看待这个问题？", anchors: [], derivation: "explicit" },
    claim: { content: claim, anchors: [] },
    reasoning: { status: "not_provided", steps: [] },
    evidence: [],
    concepts: [],
    reviewStatus: "human_confirmed",
  };
}

function deepSeekResponse(content: string) {
  return new Response(JSON.stringify({
    id: "association-audit-test",
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

test("小候选集全部完成语义审计且报告没有UNASSESSED", async () => {
  const candidates = [
    node("node-related", "结构化账本记录IP认知"),
    node("node-conflicting", "认知无需保留证据"),
    node("node-unrelated", "今天会下雨"),
  ];
  await withMockedDeepSeek(JSON.stringify({ results: [
    {
      nodeId: "node-related",
      relation: "RELATED",
      reason: "讨论同一认知留存方式。",
      quote: "结构化账本记录IP认知",
    },
    {
      nodeId: "node-conflicting",
      relation: "CONFLICTING",
      reason: "证据留存立场相反。",
      quote: "认知无需保留证据",
    },
    {
      nodeId: "node-unrelated",
      relation: "UNRELATED",
      reason: "与天气认知无关。",
      quote: "今天会下雨",
    },
  ] }), async () => {
    const { runAssociationAudit } = await import(pipelineModulePath);
    const report = await runAssociationAudit("结构化账本要保留认知证据", candidates, "test-key");

    assert.equal(report.truncated, false);
    assert.equal(report.candidateCountBeforeTruncation, 3);
    assert.equal(report.assessedCandidateCount, 3);
    assert.ok(report.results.every((result: { relation: string }) => result.relation !== "UNASSESSED"));
    assert.ok(report.results.every((result: { lexicalScore: number }) => (
      result.lexicalScore >= 0 && result.lexicalScore <= 1
    )));
    assert.ok(report.results[0].lexicalScore >= report.results[1].lexicalScore);
  });
});

test("超出12KB时报告准确标记截断和UNASSESSED节点", async () => {
  const candidates = [
    node("node-priority", "结构化账本帮助IP大脑记录认知"),
    ...Array.from({ length: 20 }, (_, index) => node(
      `node-large-${index}`,
      `无关长材料${index}${"甲乙丙丁戊己庚辛壬癸".repeat(70)}`,
    )),
  ];

  await withMockedDeepSeek((body) => {
    const prompt = ((body.messages as Array<{ content: string }>)[1]?.content) ?? "";
    const included = candidates.filter(candidate => prompt.includes(`\"id\":\"${candidate.id}\"`));
    return JSON.stringify({ results: included.map(candidate => ({
      nodeId: candidate.id,
      relation: candidate.id === "node-priority" ? "RELATED" : "UNRELATED",
      reason: candidate.id === "node-priority" ? "观点相关。" : "检查后无关。",
      quote: candidate.claim.content,
    })) });
  }, async () => {
    const { runAssociationAudit } = await import(pipelineModulePath);
    const report = await runAssociationAudit("结构化账本记录IP认知", candidates, "test-key");
    const unassessed = report.results.filter((result: { relation: string }) => (
      result.relation === "UNASSESSED"
    ));

    assert.equal(report.truncated, true);
    assert.equal(report.candidateCountBeforeTruncation, candidates.length);
    assert.equal(report.assessedCandidateCount + unassessed.length, candidates.length);
    assert.ok(unassessed.length > 0);
    assert.ok(unassessed.every((result: { reason: null; quote: null }) => (
      result.reason === null && result.quote === null
    )));
  });
});

test("语义层返回虚构节点编号时流水线整体失败", async () => {
  await withMockedDeepSeek(JSON.stringify({ results: [{
    nodeId: "invented-node",
    relation: "RELATED",
    reason: "虚构引用。",
    quote: "不存在的内容",
  }] }), async () => {
    const { runAssociationAudit } = await import(pipelineModulePath);

    await assert.rejects(
      () => runAssociationAudit(
        "结构化账本记录认知",
        [node("real-node", "结构化账本记录IP认知")],
        "test-key",
      ),
      /不存在|节点编号/,
    );
  });
});

test("字面高度重合不会覆盖语义层的CONFLICTING结论", async () => {
  const candidate = node("node-happy", "我今天很开心");
  await withMockedDeepSeek(JSON.stringify({ results: [{
    nodeId: candidate.id,
    relation: "CONFLICTING",
    reason: "输入明确否定节点中的开心状态。",
    quote: candidate.claim.content,
  }] }), async () => {
    const { runAssociationAudit } = await import(pipelineModulePath);
    const report = await runAssociationAudit("我今天很不开心", [candidate], "test-key");

    assert.ok(report.results[0].lexicalScore > 0.5);
    assert.equal(report.results[0].relation, "CONFLICTING");
    assert.equal(report.results[0].reason, "输入明确否定节点中的开心状态。");
    assert.equal(report.results[0].quote, "我今天很开心");
  });
});
