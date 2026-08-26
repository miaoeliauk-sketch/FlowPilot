"use client";

import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { memo, useMemo } from "react";

import type {
  CognitionGraphEdge,
  CognitionGraphNode,
} from "../../lib/cognition-graph-bridge";

interface CognitionGraphCanvasProps {
  nodes: CognitionGraphNode[];
  edges: CognitionGraphEdge[];
  height?: number;
}

type CanvasNodeData = {
  label: string;
  content: string;
};

type CanvasNode = Node<CanvasNodeData, CognitionGraphNode["type"]>;

function NodeHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </>
  );
}

function ClaimNode({ data }: NodeProps<CanvasNode>) {
  return (
    <div
      data-node-type="claim"
      className="relative min-w-[180px] rounded-md border-2 border-[#B96514] bg-[#F3A04C] px-4 py-3 font-semibold text-[#2B1605] shadow-sm"
    >
      <NodeHandles />
      {data.label}
    </div>
  );
}

function ReasoningNode({ data }: NodeProps<CanvasNode>) {
  return (
    <div
      data-node-type="reasoning"
      className="relative min-w-[180px] rounded-full border border-[#7DD3FC] bg-[#E0F2FE] px-5 py-3 text-[#0C4A6E]"
    >
      <NodeHandles />
      {data.label}
    </div>
  );
}

function CaseNode({ data }: NodeProps<CanvasNode>) {
  return (
    <div
      data-node-type="case"
      className="relative flex min-h-[112px] min-w-[112px] max-w-[160px] items-center justify-center rounded-full border-2 border-dashed border-[#86EFAC] bg-[#DCFCE7] px-4 py-3 text-center text-[#166534]"
    >
      <NodeHandles />
      {data.label}
    </div>
  );
}

const nodeTypes = {
  claimNode: ClaimNode,
  reasoningNode: ReasoningNode,
  caseNode: CaseNode,
} satisfies NodeTypes;

export const CognitionGraphCanvas = memo(function CognitionGraphCanvas({
  nodes,
  edges,
  height = 500,
}: CognitionGraphCanvasProps) {
  const flowNodes = useMemo<CanvasNode[]>(
    () => nodes.map(node => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: node.data,
    })),
    [nodes],
  );

  return (
    <div className="cognition-graph w-full" style={{ height }}>
      <ReactFlow
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={false}
        elementsSelectable={false}
        panOnDrag
      >
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
      </ReactFlow>
    </div>
  );
});
