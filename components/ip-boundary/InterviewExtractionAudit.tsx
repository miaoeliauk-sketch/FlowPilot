"use client";

import { useEffect, useState } from "react";
import type { InterviewCandidateNode } from "@/lib/ip-boundary-interview";

export interface ExistingClaim {
  nodeId: string;
  content: string;
}

interface InterviewExtractionAuditProps {
  candidates: InterviewCandidateNode[];
  existingClaims: ExistingClaim[];
  onChange: (candidates: InterviewCandidateNode[]) => void;
  onLongTermConfirm: (candidates: InterviewCandidateNode[]) => void;
  onTemporaryConfirm?: (candidates: InterviewCandidateNode[]) => void;
  confirmingMode?: "long_term" | "temporary" | null;
}

function normalizedText(value: string) {
  return value.toLocaleLowerCase("zh-CN").replace(/[\p{P}\p{S}\s]/gu, "");
}

function bigrams(value: string) {
  const result: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    result.push(value.slice(index, index + 2));
  }
  return result;
}

function isHighlySimilar(left: string, right: string) {
  const normalizedLeft = normalizedText(left);
  const normalizedRight = normalizedText(right);
  if (normalizedLeft.length < 6 || normalizedRight.length < 6) return false;
  if (normalizedLeft === normalizedRight) return true;
  const leftPairs = bigrams(normalizedLeft);
  const rightPairs = [...bigrams(normalizedRight)];
  let overlap = 0;
  for (const pair of leftPairs) {
    const matchIndex = rightPairs.indexOf(pair);
    if (matchIndex < 0) continue;
    overlap += 1;
    rightPairs.splice(matchIndex, 1);
  }
  return (2 * overlap) / (leftPairs.length + bigrams(normalizedRight).length) >= 0.8;
}

export function InterviewExtractionAudit({
  candidates,
  existingClaims,
  onChange,
  onLongTermConfirm,
  onTemporaryConfirm,
  confirmingMode = null,
}: InterviewExtractionAuditProps) {
  const [drafts, setDrafts] = useState(candidates);

  useEffect(() => {
    setDrafts(candidates);
  }, [candidates]);

  function updateClaim(index: number, claim: string) {
    setDrafts(current => {
      const next = current.map((candidate, candidateIndex) => candidateIndex === index
        ? {
            ...candidate,
            node: {
              ...candidate.node,
              humanRevision: {
                ...candidate.node.humanRevision,
                claim,
                updatedAt: new Date().toISOString(),
              },
            },
          }
        : candidate);
      onChange(next);
      return next;
    });
  }

  function removeCandidate(index: number) {
    setDrafts(current => {
      const next = current.filter((_, candidateIndex) => candidateIndex !== index);
      onChange(next);
      return next;
    });
  }

  return (
    <section aria-label="候选认知预审" className="mt-4 space-y-3">
      {drafts.map((candidate, index) => (
        <article key={candidate.node.id} className="rounded-[12px] border border-[#D9D2F3] bg-white p-4">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => removeCandidate(index)}
              className="rounded-full px-3 py-1 text-[11px] font-semibold text-[#9D2B2B] hover:bg-[#FFF1F1]"
            >
              删除候选
            </button>
          </div>
          <label className="block text-[12px] font-semibold text-[#30245C]">
            候选观点
            <textarea
              aria-label="候选观点"
              value={candidate.node.humanRevision?.claim ?? candidate.node.claim.content}
              onChange={event => updateClaim(index, event.target.value)}
              className="mt-2 min-h-[88px] w-full resize-y rounded-[10px] border border-[#D9D2F3] px-3 py-2 text-[13px] leading-6 text-[#1C1C1B] outline-none focus:border-[#8E78D6]"
            />
          </label>
          {existingClaims.some(existing => isHighlySimilar(
            candidate.node.humanRevision?.claim ?? candidate.node.claim.content,
            existing.content,
          )) && (
            <p
              data-warning="similar"
              className="mt-2 rounded-[8px] bg-[#FFF7D6] px-3 py-2 text-[11px] leading-5 text-[#7A5A00]"
            >
              与已有认知高度相似，请核对是否重复。
            </p>
          )}
        </article>
      ))}
      <button
        type="button"
        disabled={drafts.length === 0 || confirmingMode !== null}
        onClick={() => onLongTermConfirm(drafts)}
        className="rounded-full bg-[#5D45A7] px-4 py-2 text-[12px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {confirmingMode === "long_term" ? "正在长期入库…" : "长期入库并重新审计"}
      </button>
      {onTemporaryConfirm && (
        <button
          type="button"
          disabled={drafts.length === 0 || confirmingMode !== null}
          onClick={() => onTemporaryConfirm(drafts)}
          className="ml-2 rounded-full border border-[#5D45A7] bg-white px-4 py-2 text-[12px] font-bold text-[#5D45A7] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {confirmingMode === "temporary" ? "正在建立临时凭证…" : "仅本次使用并重新审计"}
        </button>
      )}
    </section>
  );
}
