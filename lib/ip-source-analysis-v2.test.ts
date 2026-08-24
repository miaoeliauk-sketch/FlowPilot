import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIPSourceAnalysisV2,
  parseStoredIPSourceAnalysis,
} from "./ip-source-analysis-v2";

const SOURCE_ID = "source-live-001";
const SOURCE = "热榜上的东西是共识结论。共识会稀释情绪价值。真正的爆款逻辑应该是制造冲突感。";
const ANALYZED_AT = "2026-08-24T10:00:00.000Z";

function createCandidate() {
  return {
    nodes: [{
      nodeRef: "N1",
      question: {
        content: "什么样的选题更可能成为爆款？",
        derivation: "inferred",
        anchors: [{ quote: "真正的爆款逻辑应该是制造冲突感。" }],
      },
      claim: {
        content: "爆款选题需要制造冲突感。",
        anchors: [{ quote: "真正的爆款逻辑应该是制造冲突感。" }],
      },
      reasoning: {
        status: "partial",
        steps: [{
          order: 1,
          content: "共识会稀释情绪价值。",
          anchors: [{ quote: "共识会稀释情绪价值。" }],
        }],
      },
      evidence: [],
      concepts: [{
        term: "共识结论",
        definition: "已经被普遍接受、情绪价值被稀释的结论。",
        anchors: [{ quote: "热榜上的东西是共识结论。共识会稀释情绪价值。" }],
      }],
      reviewStatus: "human_confirmed",
    }],
    aiSuggestions: {
      potentialPrinciples: [{
        content: "优先选择存在合理反对空间的选题。",
        basedOnNodeRefs: ["N1"],
      }],
      topicPotential: [{
        content: "为什么追逐热榜会制造冗余内容？",
        basedOnNodeRefs: ["N1"],
      }],
    },
  };
}

test("V2构建器由服务端生成UUID、原文位置和SHA-256，并强制设为AI提取", () => {
  const ids = ["00000000-0000-4000-8000-000000000001"];
  const analysis = buildIPSourceAnalysisV2({
    candidate: createCandidate(),
    sourceId: SOURCE_ID,
    sourceContent: SOURCE,
    analyzedAt: ANALYZED_AT,
    createId: () => ids.shift() ?? "unexpected-id",
  });

  assert.equal(analysis.parserVersion, 2);
  assert.equal(analysis.sourceId, SOURCE_ID);
  assert.equal(analysis.sourceHash, "ef4e5d7f559c448608b13c1e61c466464005c8aa3d652c7bdae64cdbdd2e8adf");
  assert.equal(analysis.nodes[0]?.id, "00000000-0000-4000-8000-000000000001");
  assert.equal(analysis.nodes[0]?.reviewStatus, "ai_extracted");
  assert.deepEqual(analysis.nodes[0]?.claim.anchors[0], {
    quote: "真正的爆款逻辑应该是制造冲突感。",
    startPosition: 22,
    endPosition: 38,
  });
  assert.deepEqual(analysis.aiSuggestions.potentialPrinciples[0]?.basedOnNodeIds, [
    "00000000-0000-4000-8000-000000000001",
  ]);
});

test("Claim没有逐字原文锚点时拒绝整个V2结果", () => {
  const candidate = createCandidate();
  candidate.nodes[0]!.claim.anchors = [{ quote: "原文中不存在的观点" }];

  assert.throws(() => buildIPSourceAnalysisV2({
    candidate,
    sourceId: SOURCE_ID,
    sourceContent: SOURCE,
    analyzedAt: ANALYZED_AT,
  }), /第1个认知节点的观点锚点无法回溯到原文/);
});

test("原文未提供推理时只接受not_provided和空steps", () => {
  const candidate = createCandidate();
  candidate.nodes[0]!.reasoning = {
    status: "not_provided",
    steps: candidate.nodes[0]!.reasoning.steps,
  };

  assert.throws(() => buildIPSourceAnalysisV2({
    candidate,
    sourceId: SOURCE_ID,
    sourceContent: SOURCE,
    analyzedAt: ANALYZED_AT,
  }), /not_provided时不能包含推理步骤/);

  candidate.nodes[0]!.reasoning.steps = [];
  const analysis = buildIPSourceAnalysisV2({
    candidate,
    sourceId: SOURCE_ID,
    sourceContent: SOURCE,
    analyzedAt: ANALYZED_AT,
    createId: () => "00000000-0000-4000-8000-000000000002",
  });
  assert.deepEqual(analysis.nodes[0]?.reasoning, {
    status: "not_provided",
    steps: [],
  });
});

test("AI建议引用不存在的临时节点时拒绝结果", () => {
  const candidate = createCandidate();
  candidate.aiSuggestions.topicPotential[0]!.basedOnNodeRefs = ["N404"];

  assert.throws(() => buildIPSourceAnalysisV2({
    candidate,
    sourceId: SOURCE_ID,
    sourceContent: SOURCE,
    analyzedAt: ANALYZED_AT,
  }), /AI建议引用了不存在的认知节点/);
});

test("兼容读取V1，并在读取V2时重新核对原文位置和哈希", () => {
  const v1 = {
    analyzedAt: ANALYZED_AT,
    parserVersion: 1 as const,
    items: [],
  };
  assert.deepEqual(parseStoredIPSourceAnalysis(v1, SOURCE, SOURCE_ID), {
    ok: true,
    version: 1,
    analysis: v1,
  });

  const v2 = buildIPSourceAnalysisV2({
    candidate: createCandidate(),
    sourceId: SOURCE_ID,
    sourceContent: SOURCE,
    analyzedAt: ANALYZED_AT,
    createId: () => "00000000-0000-4000-8000-000000000003",
  });
  assert.equal(parseStoredIPSourceAnalysis(v2, SOURCE, SOURCE_ID).ok, true);
  assert.deepEqual(parseStoredIPSourceAnalysis(v2, `${SOURCE}被篡改`, SOURCE_ID), {
    ok: false,
    error: "V2认知解析的原文哈希不一致",
  });

  const wrongPosition = structuredClone(v2);
  wrongPosition.nodes[0]!.claim.anchors[0]!.startPosition = 0;
  assert.deepEqual(parseStoredIPSourceAnalysis(wrongPosition, SOURCE, SOURCE_ID), {
    ok: false,
    error: "V2认知解析包含无法回溯的原文锚点",
  });
});

test("should fail when sourceId mismatch with knowledge context", () => {
  const v2 = buildIPSourceAnalysisV2({
    candidate: createCandidate(),
    sourceId: SOURCE_ID,
    sourceContent: SOURCE,
    analyzedAt: ANALYZED_AT,
    createId: () => "00000000-0000-4000-8000-000000000005",
  });

  assert.deepEqual(parseStoredIPSourceAnalysis(v2, SOURCE, "another-knowledge-id"), {
    ok: false,
    error: "V2认知解析的Source编号与知识记录不一致",
  });
});

test("V1兼容读取同样核对每条解析项的Source归属", () => {
  const excerpt = "共识会稀释情绪价值。";
  const startPosition = SOURCE.indexOf(excerpt);
  const v1 = {
    analyzedAt: ANALYZED_AT,
    parserVersion: 1 as const,
    items: [{
      id: "legacy-item-1",
      kind: "claim" as const,
      content: "共识会稀释情绪价值。",
      sourceId: SOURCE_ID,
      startPosition,
      endPosition: startPosition + excerpt.length,
      originalExcerpt: excerpt,
      extractionStatus: "AI提取" as const,
    }],
  };

  assert.equal(parseStoredIPSourceAnalysis(v1, SOURCE, SOURCE_ID).ok, true);
  assert.deepEqual(parseStoredIPSourceAnalysis(v1, SOURCE, "another-knowledge-id"), {
    ok: false,
    error: "V1解析项的Source编号与知识记录不一致",
  });
});
