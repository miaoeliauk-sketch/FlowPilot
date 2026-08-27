import type { CognitionNodeV2 } from "./types";

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
