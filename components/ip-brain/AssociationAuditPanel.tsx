"use client";

import type {
  AssociationAuditNodeResult,
  AssociationAuditResponse,
} from "../../lib/cognition-association-audit";

export interface AssociationAuditPanelProps {
  report: AssociationAuditResponse;
  onReaudit: (nodeIds: string[]) => void;
}

const STATUS_PRESENTATION: Record<AssociationAuditNodeResult["relation"], {
  label: string;
  cardClassName: string;
  badgeClassName: string;
}> = {
  RELATED: {
    label: "相关",
    cardClassName: "border-[#CBE2B5] bg-[#F4F9EF]",
    badgeClassName: "bg-[#EAF3DE] text-[#3B6D11]",
  },
  CONFLICTING: {
    label: "冲突",
    cardClassName: "border-[#F3C6C6] bg-[#FFF5F5]",
    badgeClassName: "bg-[#FCEBEB] text-[#A32D2D]",
  },
  UNRELATED: {
    label: "无关",
    cardClassName: "border-[#D8D7D1] bg-white",
    badgeClassName: "bg-[#F2F1ED] text-[#666]",
  },
  UNASSESSED: {
    label: "本次未检查",
    cardClassName: "border-[#D8D7D1] bg-[#F7F7F5]",
    badgeClassName: "bg-[#E8E7E2] text-[#666]",
  },
};

function AuditResultCard({ result }: { result: AssociationAuditNodeResult }) {
  const presentation = STATUS_PRESENTATION[result.relation];
  const hasSemanticEvidence = result.relation === "RELATED" || result.relation === "CONFLICTING";

  return (
    <article
      data-association-status={result.relation}
      className={`break-words rounded-[14px] border p-4 [overflow-wrap:anywhere] [word-break:break-word] ${presentation.cardClassName}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${presentation.badgeClassName}`}>
          {presentation.label}
        </span>
        <span className="text-[11px] text-[#8A8A86]">
          字面重叠{Math.round(result.lexicalScore * 100)}%
        </span>
      </div>

      <div className="mt-3 text-[12px] font-semibold text-[#555]">节点编号：{result.nodeId}</div>

      {hasSemanticEvidence && (
        <div className="mt-3 space-y-2 text-[12.5px] leading-5 text-[#444]">
          <p><span className="font-bold">判断理由：</span>{result.reason}</p>
          <blockquote className="rounded-[10px] border-l-4 border-[#D8D7D1] bg-white/80 px-3 py-2 text-[#555]">
            <span className="font-bold">引用片段：</span>{result.quote}
          </blockquote>
        </div>
      )}

      {result.relation === "UNASSESSED" && (
        <p className="mt-3 text-[12.5px] leading-5 text-[#666]">未被本次审计覆盖</p>
      )}
    </article>
  );
}

export function AssociationAuditPanel({ report, onReaudit }: AssociationAuditPanelProps) {
  const unassessedNodeIds = report.results
    .filter(result => result.relation === "UNASSESSED")
    .map(result => result.nodeId);

  return (
    <section
      aria-label="关联审计结果"
      className="association-audit rounded-[18px] border border-[#E5E4DE] bg-white p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-[#1C1C1B]">认知关联审计</h2>
          <p className="mt-1 text-[12.5px] text-[#777]">字面召回只负责排序，最终关系以语义审计结果为准。</p>
        </div>
        {report.auditScope === "full" && (
          <span className="rounded-full bg-[#EAF3DE] px-3 py-1 text-[11px] font-bold text-[#3B6D11]">
            全量审计（从全部候选节点发起）
          </span>
        )}
        {report.auditScope === "subset" && (
          <span className="rounded-full bg-[#E8E7E2] px-3 py-1 text-[11px] font-bold text-[#555]">
            本次为子集审计（针对此前未检查节点）
          </span>
        )}
      </div>

      {report.truncated && (
        <div
          role="status"
          className="mt-4 rounded-[12px] border border-[#EBD89A] bg-[#FBF3D6] px-4 py-3 text-[12.5px] leading-5 text-[#6B5A1A]"
        >
          候选节点较多，本次仅审计了{report.assessedCandidateCount} / {report.candidateCountBeforeTruncation}个节点，其余标记为未检查。
        </div>
      )}

      <div className="mt-4 space-y-3">
        {report.results.map(result => <AuditResultCard key={result.nodeId} result={result} />)}
      </div>

      {report.truncated && unassessedNodeIds.length > 0 && (
        <button
          type="button"
          onClick={() => onReaudit(unassessedNodeIds)}
          className="mt-4 rounded-full border border-[#1C1C1B] bg-white px-4 py-2 text-[12px] font-bold text-[#1C1C1B] transition hover:bg-[#1C1C1B] hover:text-white"
        >
          重新审计未检查节点
        </button>
      )}
    </section>
  );
}
