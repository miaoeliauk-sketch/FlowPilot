import assert from "node:assert/strict";
import test from "node:test";

import { bridgeCognitionGraph } from "./cognition-graph-bridge";
import type { CognitionNodeV2, IPSourceAnchor } from "./types";

function anchor(quote: string, startPosition: number): IPSourceAnchor {
  return {
    quote,
    startPosition,
    endPosition: startPosition + quote.length,
  };
}

test("一个观点、两步推理和一个案例被桥接为四个可区分的图节点", () => {
  const cognition: CognitionNodeV2 = {
    id: "cognition-node-1",
    question: {
      content: "为什么停止学习反而能改善行动力？",
      derivation: "explicit",
      anchors: [anchor("为什么停止学习反而能改善行动力？", 0)],
    },
    claim: {
      content: "停止学习是为了开始消化知识。",
      anchors: [anchor("停止学习是为了开始消化知识。", 17)],
    },
    reasoning: {
      status: "complete",
      steps: [
        {
          order: 1,
          content: "知识淤积会导致行动瘫痪。",
          anchors: [anchor("知识淤积会导致行动瘫痪。", 33)],
        },
        {
          order: 2,
          content: "停止继续输入后才能消化已有知识。",
          anchors: [anchor("停止继续输入后才能消化已有知识。", 48)],
        },
      ],
    },
    evidence: [
      {
        type: "case",
        content: "闭关一个月后，老师的行动效率提高了。",
        verificationStatus: "unverified",
        anchors: [anchor("闭关一个月后，老师的行动效率提高了。", 67)],
      },
    ],
    concepts: [],
    reviewStatus: "human_confirmed",
  };

  const graph = bridgeCognitionGraph([cognition]);

  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.edges.length, 3);

  const claimNode = graph.nodes.find(node => node.kind === "CLAIM");
  const reasoningNodes = graph.nodes
    .filter(node => node.kind === "REASONING")
    .sort((left, right) => left.order - right.order);
  const caseNode = graph.nodes.find(node => node.kind === "CASE");

  assert.ok(claimNode);
  assert.equal(reasoningNodes.length, 2);
  assert.ok(caseNode);
  assert.deepEqual(
    [claimNode.type, reasoningNodes[0]!.type, caseNode.type],
    ["claimNode", "reasoningNode", "caseNode"],
  );
  assert.deepEqual(
    [claimNode.visualRole, reasoningNodes[0]!.visualRole, caseNode.visualRole],
    ["claim-primary", "reasoning-path", "case-evidence"],
  );
  graph.nodes.forEach((node) => {
    assert.equal(node.sourceCognitionNodeId, cognition.id);
  });

  assert.deepEqual(
    graph.edges.map(edge => [edge.id, edge.source, edge.target]),
    [
      [`e-${claimNode.id}-${reasoningNodes[0]!.id}`, claimNode.id, reasoningNodes[0]!.id],
      [
        `e-${reasoningNodes[0]!.id}-${reasoningNodes[1]!.id}`,
        reasoningNodes[0]!.id,
        reasoningNodes[1]!.id,
      ],
      [`e-${claimNode.id}-${caseNode.id}`, claimNode.id, caseNode.id],
    ],
  );
});

test("观点与推理分层排列，同层推理节点不会重合", () => {
  const cognition: CognitionNodeV2 = {
    id: "cognition-layout-1",
    question: {
      content: "知识输入与行动之间是什么关系？",
      derivation: "explicit",
      anchors: [anchor("知识输入与行动之间是什么关系？", 0)],
    },
    claim: {
      content: "停止继续输入，才能开始消化。",
      anchors: [anchor("停止继续输入，才能开始消化。", 16)],
    },
    reasoning: {
      status: "complete",
      steps: [
        {
          order: 1,
          content: "知识淤积会增加行动阻力。",
          anchors: [anchor("知识淤积会增加行动阻力。", 32)],
        },
        {
          order: 2,
          content: "留出空白期才能整理已有知识。",
          anchors: [anchor("留出空白期才能整理已有知识。", 47)],
        },
      ],
    },
    evidence: [],
    concepts: [],
    reviewStatus: "human_confirmed",
  };

  const graph = bridgeCognitionGraph([cognition]);
  const claimNode = graph.nodes.find(node => node.kind === "CLAIM");
  const reasoningNodes = graph.nodes
    .filter(node => node.kind === "REASONING")
    .sort((left, right) => left.order - right.order);
  const secondGraph = bridgeCognitionGraph([cognition]);

  assert.ok(claimNode);
  assert.equal(reasoningNodes.length, 2);
  graph.nodes.forEach((node) => {
    assert.equal(Number.isFinite(node.position.x), true);
    assert.equal(Number.isFinite(node.position.y), true);
  });
  assert.deepEqual(claimNode.position, { x: 0, y: 0 });
  assert.deepEqual(reasoningNodes[0]!.position, { x: 0, y: 120 });
  assert.deepEqual(reasoningNodes[1]!.position, { x: 200, y: 120 });
  assert.deepEqual(secondGraph, graph);
});

test("空输入返回空图", () => {
  assert.deepEqual(bridgeCognitionGraph([]), { nodes: [], edges: [] });
});

test("节点标签按 Unicode 字符截取前十五个字符", () => {
  const cognition: CognitionNodeV2 = {
    id: "cognition-label-1",
    question: {
      content: "如何展示较长观点？",
      derivation: "explicit",
      anchors: [anchor("如何展示较长观点？", 0)],
    },
    claim: {
      content: "一二三四五六七八九十甲乙丙丁戊己庚",
      anchors: [anchor("一二三四五六七八九十甲乙丙丁戊己庚", 10)],
    },
    reasoning: { status: "not_provided", steps: [] },
    evidence: [],
    concepts: [],
    reviewStatus: "human_confirmed",
  };

  const graph = bridgeCognitionGraph([cognition]);

  assert.equal(graph.nodes[0]!.data.label, "一二三四五六七八九十甲乙丙丁戊");
});
