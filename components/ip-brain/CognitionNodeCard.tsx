"use client";

import { useEffect, useMemo, useState } from "react";
import type { CognitionNodeV2, IPSourceAnchor } from "@/lib/types";
import type { CognitionReviewAction } from "@/lib/ip-source-analysis-review";

export interface CognitionNodeCardProps {
  node: CognitionNodeV2;
  onActivateAnchor: (anchor: IPSourceAnchor) => void;
  onReview: (action: CognitionReviewAction) => void | Promise<void>;
  reviewDisabled?: boolean;
}

const REVIEW_LABEL = {
  ai_extracted: "AI提取·待确认",
  human_confirmed: "人工已确认",
  rejected: "已拒绝",
} as const;

export function CognitionNodeCard({
  node,
  onActivateAnchor,
  onReview,
  reviewDisabled = false,
}: CognitionNodeCardProps) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [editing, setEditing] = useState(false);
  const revisedSteps = useMemo(
    () => new Map(node.humanRevision?.reasoningSteps?.map(step => [step.order, step.content]) ?? []),
    [node.humanRevision],
  );
  const effectiveClaim = node.humanRevision?.claim ?? node.claim.content;
  const effectiveSteps = node.reasoning.steps.map(step => ({
    order: step.order,
    content: revisedSteps.get(step.order) ?? step.content,
  }));
  const [draftClaim, setDraftClaim] = useState(effectiveClaim);
  const [draftSteps, setDraftSteps] = useState(effectiveSteps);

  useEffect(() => {
    setShowOriginal(false);
    setEditing(false);
    setDraftClaim(effectiveClaim);
    setDraftSteps(effectiveSteps);
  }, [effectiveClaim, node.id, node.humanRevision?.updatedAt]);

  const displayedClaim = showOriginal ? node.claim.content : effectiveClaim;
  const displayedSteps = node.reasoning.steps.map(step => ({
    ...step,
    content: showOriginal ? step.content : revisedSteps.get(step.order) ?? step.content,
  }));

  return (
    <article className="rounded-[14px] border border-[#E5E4DE] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10.5px] text-[#AAA]">认知节点 {node.id.slice(0, 8)}</div>
          <button
            type="button"
            onClick={() => node.question.anchors[0] && onActivateAnchor(node.question.anchors[0])}
            className="mt-1 text-left text-[12px] font-semibold leading-5 text-[#666] hover:text-[#3B6D11]"
          >
            {node.question.content}
          </button>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-semibold ${
          node.reviewStatus === "human_confirmed"
            ? "bg-[#EAF3DE] text-[#3B6D11]"
            : node.reviewStatus === "rejected"
              ? "bg-[#FCEBEB] text-[#A32D2D]"
              : "bg-[#FEF3C7] text-[#92400E]"
        }`}>
          {REVIEW_LABEL[node.reviewStatus]}
        </span>
      </div>

      {node.humanRevision && (
        <button
          type="button"
          onClick={() => setShowOriginal(current => !current)}
          className="mt-3 rounded-[8px] bg-[#F2F1ED] px-3 py-1.5 text-[11px] font-semibold text-[#666]"
        >
          {showOriginal ? "查看人工修订" : "查看AI原始提取"}
        </button>
      )}

      <div className="mt-3 rounded-[10px] bg-[#F7FCF0] p-3">
        <div className="text-[10.5px] font-bold text-[#639922]">核心观点</div>
        <button
          type="button"
          onClick={() => node.claim.anchors[0] && onActivateAnchor(node.claim.anchors[0])}
          className="mt-1 w-full text-left text-[15px] font-bold leading-7 text-[#222] hover:text-[#3B6D11]"
        >
          {displayedClaim}
        </button>
      </div>

      <div className="mt-3">
        <div className="flex items-center gap-2 text-[11px] font-bold text-[#555]">
          推理路径
          {node.reasoning.status === "partial" && (
            <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[#92400E]">原文推理不完整</span>
          )}
          {node.reasoning.status === "not_provided" && (
            <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[#777]">原文未提供推理</span>
          )}
        </div>
        {displayedSteps.length > 0 && (
          <ol className="mt-2 space-y-2">
            {displayedSteps.map(step => (
              <li key={step.order}>
                <button
                  type="button"
                  onClick={() => step.anchors[0] && onActivateAnchor(step.anchors[0])}
                  className="w-full rounded-[8px] bg-[#FAFAF8] px-3 py-2 text-left text-[12px] leading-5 text-[#555] hover:bg-[#F1F7E8]"
                >
                  {step.order}. {step.content}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      {(node.evidence.length > 0 || node.concepts.length > 0) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {node.evidence.map((evidence, index) => (
            <button
              key={`evidence-${index}`}
              type="button"
              onClick={() => evidence.anchors[0] && onActivateAnchor(evidence.anchors[0])}
              className="rounded-[8px] border border-[#E5E4DE] px-3 py-2 text-left text-[11.5px] leading-5 text-[#666]"
            >
              证据：{evidence.content}
            </button>
          ))}
          {node.concepts.map((concept, index) => (
            <button
              key={`concept-${index}`}
              type="button"
              onClick={() => concept.anchors[0] && onActivateAnchor(concept.anchors[0])}
              className="rounded-[8px] border border-[#E5E4DE] px-3 py-2 text-left text-[11.5px] leading-5 text-[#666]"
            >
              概念：{concept.term}＝{concept.definition}
            </button>
          ))}
        </div>
      )}

      {editing && (
        <div className="mt-4 rounded-[10px] border border-[#D9CFF4] bg-[#FAF8FF] p-3">
          <p className="mb-3 text-[11.5px] leading-5 text-[#7159A6]">
            人工修订会作为下游使用的权威版本；AI原始提取和原文锚点仍会永久保留。
          </p>
          <label className="block text-[11.5px] font-semibold text-[#555]">
            人工修订观点
            <textarea
              value={draftClaim}
              onChange={event => setDraftClaim(event.target.value)}
              className="mt-1 w-full rounded-[8px] border border-[#D9CFF4] bg-white px-3 py-2 text-[12px] leading-5"
            />
          </label>
          {draftSteps.map((step, index) => (
            <label key={step.order} className="mt-2 block text-[11.5px] font-semibold text-[#555]">
              人工修订推理第{step.order}步
              <textarea
                value={step.content}
                onChange={event => setDraftSteps(current => current.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, content: event.target.value } : item
                ))}
                className="mt-1 w-full rounded-[8px] border border-[#D9CFF4] bg-white px-3 py-2 text-[12px] leading-5"
              />
            </label>
          ))}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={reviewDisabled}
              onClick={() => void onReview({
                type: "revise",
                nodeId: node.id,
                humanRevision: {
                  claim: draftClaim,
                  ...(draftSteps.length ? { reasoningSteps: draftSteps } : {}),
                },
              })}
              className="rounded-[8px] bg-[#7159A6] px-3 py-2 text-[11.5px] font-semibold text-white disabled:opacity-40"
            >
              保存人工修订
            </button>
            <button type="button" disabled={reviewDisabled} onClick={() => setEditing(false)} className="rounded-[8px] bg-white px-3 py-2 text-[11.5px] text-[#666] disabled:opacity-40">
              取消
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-[#F0EFE9] pt-3">
        <button type="button" disabled={reviewDisabled} onClick={() => void onReview({ type: "confirm", nodeId: node.id })} className="rounded-[8px] bg-[#EAF3DE] px-3 py-2 text-[11.5px] font-semibold text-[#3B6D11] disabled:opacity-40">确认</button>
        <button type="button" disabled={reviewDisabled} onClick={() => void onReview({ type: "reject", nodeId: node.id })} className="rounded-[8px] bg-[#FCEBEB] px-3 py-2 text-[11.5px] font-semibold text-[#A32D2D] disabled:opacity-40">拒绝</button>
        <button type="button" disabled={reviewDisabled} onClick={() => setEditing(true)} className="rounded-[8px] bg-[#F2F1ED] px-3 py-2 text-[11.5px] font-semibold text-[#555] disabled:opacity-40">修改</button>
      </div>
    </article>
  );
}
