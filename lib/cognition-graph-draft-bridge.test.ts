import assert from "node:assert/strict";
import test from "node:test";

import * as graphBridge from "./cognition-graph-bridge";
import type { CognitionGraph, CognitionGraphNode } from "./cognition-graph-bridge";
import type { IPSourceAnalysisV2, IPSourceAnchor } from "./types";

interface DraftBatchIdentityInput {
  ipId: string;
  sourceId: string;
  sourceHash: string;
  analyzedAt: string;
}

type CreateDraftCognitionBatchId = (input: DraftBatchIdentityInput) => string;

interface DraftCognitionBatch {
  batchId: string;
  ipId: string;
  analysis: IPSourceAnalysisV2;
}

interface DraftGraphNode extends CognitionGraphNode {
  data: CognitionGraphNode["data"] & {
    isDraft: true;
    draftProvenance: {
      batchId: string;
      ipId: string;
      sourceId: string;
      sourceHash: string;
      analyzedAt: string;
      originalCognitionNodeId: string;
      anchors: IPSourceAnchor[];
    };
  };
}

type BridgeDraftCognitionGraph = (batch: DraftCognitionBatch) => Omit<CognitionGraph, "nodes"> & {
  nodes: DraftGraphNode[];
};

function anchor(quote: string, startPosition: number): IPSourceAnchor {
  return {
    quote,
    startPosition,
    endPosition: startPosition + quote.length,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(item => deepFreeze(item));
    Object.freeze(value);
  }
  return value;
}

function forbidBrowserStorageAccess(): () => void {
  const names = ["localStorage", "sessionStorage"] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const name of names) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        throw new Error(`草稿桥接层不得读取或写入${name}`);
      },
    });
  }
  return () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
}

test("草稿批次编号可重复生成且不会混淆字段边界", () => {
  const createDraftCognitionBatchId = (
    graphBridge as typeof graphBridge & {
      createDraftCognitionBatchId?: CreateDraftCognitionBatchId;
    }
  ).createDraftCognitionBatchId;

  assert.equal(
    typeof createDraftCognitionBatchId,
    "function",
    "桥接层尚未提供稳定的草稿批次编号生成入口",
  );
  if (!createDraftCognitionBatchId) return;

  const common = {
    sourceHash: "a".repeat(64),
    analyzedAt: "2026-08-27T10:00:00.000Z",
  };
  const firstInput = {
    ipId: "12",
    sourceId: "3",
    ...common,
  };
  const sameConcatenationWithDifferentBoundaries = {
    ipId: "1",
    sourceId: "23",
    ...common,
  };

  const firstId = createDraftCognitionBatchId(firstInput);
  const repeatedId = createDraftCognitionBatchId({ ...firstInput });
  const differentBoundaryId = createDraftCognitionBatchId(
    sameConcatenationWithDifferentBoundaries,
  );

  assert.match(firstId, /^draft-[a-f0-9]{64}$/u);
  assert.equal(repeatedId, firstId);
  assert.notEqual(differentBoundaryId, firstId);
});

test("草稿认知桥接保留独立ID、节点状态和逐条来源且无副作用", () => {
  const bridgeDraftCognitionGraph = (
    graphBridge as typeof graphBridge & {
      bridgeDraftCognitionGraph?: BridgeDraftCognitionGraph;
    }
  ).bridgeDraftCognitionGraph;

  assert.equal(
    typeof bridgeDraftCognitionGraph,
    "function",
    "桥接层尚未提供草稿认知图谱转换入口",
  );
  if (!bridgeDraftCognitionGraph) return;

  const originalCognitionNodeId = "11111111-1111-4111-8111-111111111111";
  const analysis: IPSourceAnalysisV2 = {
    analyzedAt: "2026-08-27T10:00:00.000Z",
    parserVersion: 2,
    nonce: 1,
    sourceId: "source-draft-1",
    sourceHash: "b".repeat(64),
    nodes: [{
      id: originalCognitionNodeId,
      question: {
        content: "持续输出依靠什么？",
        derivation: "explicit",
        anchors: [anchor("持续输出依靠什么？", 0)],
      },
      claim: {
        content: "持续输出来自真实问题。",
        anchors: [anchor("持续输出来自真实问题。", 10)],
      },
      reasoning: {
        status: "complete",
        steps: [{
          order: 1,
          content: "真实问题会推动持续思考。",
          anchors: [anchor("真实问题会推动持续思考。", 23)],
        }],
      },
      evidence: [{
        type: "case",
        content: "不日更也能稳定产出。",
        verificationStatus: "unverified",
        anchors: [anchor("不日更也能稳定产出。", 38)],
      }],
      concepts: [],
      reviewStatus: "ai_extracted",
    }],
    aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
  };
  const batchId = graphBridge.createDraftCognitionBatchId({
    ipId: "ip-pengpeng-ai",
    sourceId: analysis.sourceId,
    sourceHash: analysis.sourceHash,
    analyzedAt: analysis.analyzedAt,
  });
  const batch = deepFreeze({
    batchId,
    ipId: "ip-pengpeng-ai",
    analysis,
  });
  const before = structuredClone(batch);
  const restoreStorage = forbidBrowserStorageAccess();

  try {
    const graph = bridgeDraftCognitionGraph(batch);

    assert.equal(graph.nodes.length, 3);
    assert.deepEqual(
      graph.nodes.map(node => node.id),
      [
        `${batchId}:${originalCognitionNodeId}:claim`,
        `${batchId}:${originalCognitionNodeId}:reasoning:1`,
        `${batchId}:${originalCognitionNodeId}:case:1`,
      ],
    );
    assert.deepEqual(
      graph.nodes.map(node => node.visualRole),
      ["claim-primary", "reasoning-path", "case-evidence"],
    );
    graph.nodes.forEach((node) => {
      assert.equal(node.sourceCognitionNodeId, `${batchId}:${originalCognitionNodeId}`);
      assert.equal(node.data.isDraft, true);
      assert.deepEqual(
        {
          batchId: node.data.draftProvenance.batchId,
          ipId: node.data.draftProvenance.ipId,
          sourceId: node.data.draftProvenance.sourceId,
          sourceHash: node.data.draftProvenance.sourceHash,
          analyzedAt: node.data.draftProvenance.analyzedAt,
          originalCognitionNodeId: node.data.draftProvenance.originalCognitionNodeId,
        },
        {
          batchId,
          ipId: batch.ipId,
          sourceId: analysis.sourceId,
          sourceHash: analysis.sourceHash,
          analyzedAt: analysis.analyzedAt,
          originalCognitionNodeId,
        },
      );
      assert.equal(node.data.draftProvenance.anchors.length, 1);
      assert.ok(node.data.draftProvenance.anchors[0]!.quote.length > 0);
    });
    assert.deepEqual(batch, before);
  } finally {
    restoreStorage();
  }
});
