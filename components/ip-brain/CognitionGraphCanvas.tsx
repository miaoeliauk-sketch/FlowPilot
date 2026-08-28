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

import type { AssociationAuditNodeResult } from "../../lib/cognition-association-audit";
import type {
  CognitionGraphEdge,
  CognitionGraphNode,
} from "../../lib/cognition-graph-bridge";

type CognitionGraphAuditStatus = AssociationAuditNodeResult["relation"];

export type CognitionGraphCanvasNode = Omit<CognitionGraphNode, "data"> & {
  data: CognitionGraphNode["data"] & {
    auditStatus?: CognitionGraphAuditStatus;
    isDraft?: boolean;
  };
};

interface CognitionGraphCanvasProps {
  nodes: CognitionGraphCanvasNode[];
  edges: CognitionGraphEdge[];
  height?: number;
}

type CanvasNodeData = {
  label: string;
  content: string;
  auditStatus?: CognitionGraphAuditStatus;
  isDraft?: boolean;
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

function auditVisualClasses(
  auditStatus: CognitionGraphAuditStatus | undefined,
  defaultClasses: string,
): string {
  if (auditStatus === "CONFLICTING") {
    return "motion-safe:animate-[pulse_900ms_ease-out_1] border-[#DC2626] bg-[#FEF2F2] text-[#991B1B]";
  }
  if (auditStatus === "RELATED") {
    return "border-[#16A34A] bg-[#F0FDF4] text-[#166534] ring-2 ring-[#86EFAC]";
  }
  return `${defaultClasses}${auditStatus === "UNASSESSED" ? " opacity-50" : ""}`;
}

function visibleAuditStatus(data: CanvasNodeData): CognitionGraphAuditStatus | undefined {
  return data.isDraft ? undefined : data.auditStatus;
}

function NodeContent({ data }: { data: CanvasNodeData }) {
  const auditStatus = visibleAuditStatus(data);
  return (
    <>
      <NodeHandles />
      {auditStatus === "CONFLICTING" && (
        <span aria-label="认知冲突" className="mr-1">!</span>
      )}
      {data.label}
    </>
  );
}

function ClaimNode({ data }: NodeProps<CanvasNode>) {
  const auditStatus = visibleAuditStatus(data);
  return (
    <div
      data-node-type="claim"
      data-audit-status={auditStatus}
      data-is-draft={data.isDraft}
      className={`relative min-w-[180px] rounded-md border-2 px-4 py-3 font-semibold shadow-sm ${auditVisualClasses(
        auditStatus,
        "border-[#B96514] bg-[#F3A04C] text-[#2B1605]",
      )}${data.isDraft ? " border-dashed opacity-30" : ""}`}
    >
      <NodeContent data={data} />
    </div>
  );
}

function ReasoningNode({ data }: NodeProps<CanvasNode>) {
  const auditStatus = visibleAuditStatus(data);
  return (
    <div
      data-node-type="reasoning"
      data-audit-status={auditStatus}
      data-is-draft={data.isDraft}
      className={`relative min-w-[180px] rounded-full border px-5 py-3 ${auditVisualClasses(
        auditStatus,
        "border-[#7DD3FC] bg-[#E0F2FE] text-[#0C4A6E]",
      )}${data.isDraft ? " border-dashed opacity-30" : ""}`}
    >
      <NodeContent data={data} />
    </div>
  );
}

function CaseNode({ data }: NodeProps<CanvasNode>) {
  const auditStatus = visibleAuditStatus(data);
  return (
    <div
      data-node-type="case"
      data-audit-status={auditStatus}
      data-is-draft={data.isDraft}
      className={`relative flex min-h-[112px] min-w-[112px] max-w-[160px] items-center justify-center rounded-full border-2 border-dashed px-4 py-3 text-center ${auditVisualClasses(
        auditStatus,
        "border-[#86EFAC] bg-[#DCFCE7] text-[#166534]",
      )}${data.isDraft ? " opacity-30" : ""}`}
    >
      <NodeContent data={data} />
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
