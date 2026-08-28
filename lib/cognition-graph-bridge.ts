import type {
  CognitionNodeV2,
  IPSourceAnalysisV2,
  IPSourceAnchor,
} from "./types";
import { calculateSHA256 } from "./sha256";

export interface DraftCognitionBatchIdentityInput {
  ipId: string;
  sourceId: string;
  sourceHash: string;
  analyzedAt: string;
}

export function createDraftCognitionBatchId(
  input: DraftCognitionBatchIdentityInput,
): string {
  const canonicalFields = JSON.stringify([
    input.ipId,
    input.sourceId,
    input.sourceHash,
    input.analyzedAt,
  ]);
  return `draft-${calculateSHA256(canonicalFields)}`;
}

export type CognitionGraphNodeKind = "CLAIM" | "REASONING" | "CASE";
export type CognitionGraphNodeType = "claimNode" | "reasoningNode" | "caseNode";
export type CognitionGraphVisualRole = "claim-primary" | "reasoning-path" | "case-evidence";

export interface CognitionGraphNode {
  id: string;
  sourceCognitionNodeId: string;
  kind: CognitionGraphNodeKind;
  type: CognitionGraphNodeType;
  visualRole: CognitionGraphVisualRole;
  order: number;
  position: {
    x: number;
    y: number;
  };
  data: {
    label: string;
    content: string;
  };
}

export interface CognitionGraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface CognitionGraph {
  nodes: CognitionGraphNode[];
  edges: CognitionGraphEdge[];
}

export interface DraftCognitionBatch {
  batchId: string;
  ipId: string;
  analysis: IPSourceAnalysisV2;
}

export interface DraftCognitionGraphNode extends Omit<CognitionGraphNode, "data"> {
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

export interface DraftCognitionGraph extends Omit<CognitionGraph, "nodes"> {
  nodes: DraftCognitionGraphNode[];
}

function labelOf(content: string): string {
  return Array.from(content).slice(0, 15).join("");
}

function edge(source: string, target: string): CognitionGraphEdge {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
  };
}

function calculateLayout(nodes: Array<Omit<CognitionGraphNode, "position">>): CognitionGraphNode[] {
  const layerCounters: Record<CognitionGraphNodeKind, number> = {
    CLAIM: 0,
    REASONING: 0,
    CASE: 0,
  };
  const layerY: Record<CognitionGraphNodeKind, number> = {
    CLAIM: 0,
    REASONING: 120,
    CASE: 240,
  };

  return nodes.map((node) => {
    const position = {
      x: layerCounters[node.kind] * 200,
      y: layerY[node.kind],
    };
    layerCounters[node.kind] += 1;
    return { ...node, position };
  });
}

export function bridgeCognitionGraph(cognitionNodes: CognitionNodeV2[]): CognitionGraph {
  const nodes: Array<Omit<CognitionGraphNode, "position">> = [];
  const edges: CognitionGraphEdge[] = [];

  cognitionNodes.forEach((cognitionNode) => {
    const claimId = `${cognitionNode.id}:claim`;
    nodes.push({
      id: claimId,
      sourceCognitionNodeId: cognitionNode.id,
      kind: "CLAIM",
      type: "claimNode",
      visualRole: "claim-primary",
      order: 0,
      data: {
        label: labelOf(cognitionNode.claim.content),
        content: cognitionNode.claim.content,
      },
    });

    let previousReasoningId = claimId;
    [...cognitionNode.reasoning.steps]
      .sort((left, right) => left.order - right.order)
      .forEach((step) => {
        const reasoningId = `${cognitionNode.id}:reasoning:${step.order}`;
        nodes.push({
          id: reasoningId,
          sourceCognitionNodeId: cognitionNode.id,
          kind: "REASONING",
          type: "reasoningNode",
          visualRole: "reasoning-path",
          order: step.order,
          data: {
            label: labelOf(step.content),
            content: step.content,
          },
        });
        edges.push(edge(previousReasoningId, reasoningId));
        previousReasoningId = reasoningId;
      });

    cognitionNode.evidence
      .filter(item => item.type === "case")
      .forEach((item, index) => {
        const caseId = `${cognitionNode.id}:case:${index + 1}`;
        nodes.push({
          id: caseId,
          sourceCognitionNodeId: cognitionNode.id,
          kind: "CASE",
          type: "caseNode",
          visualRole: "case-evidence",
          order: index + 1,
          data: {
            label: labelOf(item.content),
            content: item.content,
          },
        });
        edges.push(edge(claimId, caseId));
      });
  });

  return { nodes: calculateLayout(nodes), edges };
}

function draftAnchorsForNode(
  graphNode: CognitionGraphNode,
  cognitionNode: CognitionNodeV2,
): IPSourceAnchor[] {
  if (graphNode.kind === "CLAIM") return cognitionNode.claim.anchors;
  if (graphNode.kind === "REASONING") {
    return cognitionNode.reasoning.steps
      .find(step => step.order === graphNode.order)?.anchors ?? [];
  }
  return cognitionNode.evidence
    .filter(item => item.type === "case")[graphNode.order - 1]?.anchors ?? [];
}

export function bridgeDraftCognitionGraph(
  batch: DraftCognitionBatch,
): DraftCognitionGraph {
  const graph = bridgeCognitionGraph(batch.analysis.nodes);
  const cognitionById = new Map(batch.analysis.nodes.map(node => [node.id, node]));

  const nodes = graph.nodes.map((node): DraftCognitionGraphNode => {
    const cognitionNode = cognitionById.get(node.sourceCognitionNodeId);
    if (!cognitionNode) throw new Error("草稿图节点缺少原始认知节点");
    const draftSourceCognitionNodeId = `${batch.batchId}:${node.sourceCognitionNodeId}`;
    return {
      ...node,
      id: `${batch.batchId}:${node.id}`,
      sourceCognitionNodeId: draftSourceCognitionNodeId,
      data: {
        ...node.data,
        isDraft: true,
        draftProvenance: {
          batchId: batch.batchId,
          ipId: batch.ipId,
          sourceId: batch.analysis.sourceId,
          sourceHash: batch.analysis.sourceHash,
          analyzedAt: batch.analysis.analyzedAt,
          originalCognitionNodeId: cognitionNode.id,
          anchors: draftAnchorsForNode(node, cognitionNode)
            .map(anchor => ({ ...anchor })),
        },
      },
    };
  });
  const edges = graph.edges.map((item) => edge(
    `${batch.batchId}:${item.source}`,
    `${batch.batchId}:${item.target}`,
  ));

  return { nodes, edges };
}
