"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import {
  InterviewExtractionAudit,
  type ExistingClaim,
} from "@/components/ip-boundary/InterviewExtractionAudit";
import type {
  InterviewCandidateNode,
  InterviewPanelState,
  InterviewQuestion,
} from "@/lib/ip-boundary-interview";

interface InterviewPanelProps {
  activeIPId: string;
  topicId: string;
  interviewId: string;
  questions: InterviewQuestion[];
  existingClaims?: ExistingClaim[];
  state?: InterviewPanelState;
  errorMessage?: string | null;
}

function draftKey(activeIPId: string, topicId: string, interviewId: string) {
  return `FP_INTERVIEW_DRAFT_V1:${encodeURIComponent(activeIPId)}:${encodeURIComponent(topicId)}:${encodeURIComponent(interviewId)}`;
}

function lastInterviewKey(activeIPId: string, topicId: string) {
  return `FP_LAST_INTERVIEW_V1:${encodeURIComponent(activeIPId)}:${encodeURIComponent(topicId)}`;
}

function readDraft(key: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function candidatesForSession(
  value: unknown,
  activeIPId: string,
  topicId: string,
  interviewId: string,
): InterviewCandidateNode[] | null {
  if (!isRecord(value) || !isRecord(value.source) || !Array.isArray(value.candidates)) return null;
  if (value.source.ipId !== activeIPId || value.source.topicId !== topicId
    || value.source.interviewId !== interviewId || typeof value.source.id !== "string"
    || !value.source.id.trim() || value.candidates.length === 0) return null;
  const candidates: InterviewCandidateNode[] = [];
  for (const candidate of value.candidates) {
    if (!isRecord(candidate) || candidate.sourceId !== value.source.id || !isRecord(candidate.node)
      || typeof candidate.node.id !== "string" || !candidate.node.id.trim()
      || !isRecord(candidate.node.question) || typeof candidate.node.question.content !== "string"
      || !Array.isArray(candidate.node.question.anchors)
      || !(candidate.node.question.derivation === "explicit" || candidate.node.question.derivation === "inferred")
      || !isRecord(candidate.node.claim) || typeof candidate.node.claim.content !== "string"
      || !candidate.node.claim.content.trim() || !Array.isArray(candidate.node.claim.anchors)
      || !isRecord(candidate.node.reasoning) || !Array.isArray(candidate.node.reasoning.steps)
      || !Array.isArray(candidate.node.evidence) || !Array.isArray(candidate.node.concepts)
      || !(candidate.node.reviewStatus === "ai_extracted"
        || candidate.node.reviewStatus === "human_confirmed"
        || candidate.node.reviewStatus === "rejected")) return null;
    candidates.push({
      sourceId: candidate.sourceId,
      node: candidate.node as unknown as InterviewCandidateNode["node"],
    });
  }
  return candidates;
}

export function InterviewPanel({
  activeIPId,
  topicId,
  interviewId,
  questions,
  existingClaims = [],
  state = "answering",
  errorMessage = null,
}: InterviewPanelProps) {
  const storageKey = useMemo(
    () => draftKey(activeIPId, topicId, interviewId),
    [activeIPId, topicId, interviewId],
  );
  const [answers, setAnswers] = useState<Record<string, string>>(() => readDraft(storageKey));
  const [currentState, setCurrentState] = useState<InterviewPanelState>(state);
  const [extracting, setExtracting] = useState(false);
  const [candidates, setCandidates] = useState<InterviewCandidateNode[]>([]);
  const [auditConfirmed, setAuditConfirmed] = useState(false);
  const [extractionMessage, setExtractionMessage] = useState<string | null>(null);
  const extractionRequestSeqRef = useRef(0);
  const extractionControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    extractionRequestSeqRef.current += 1;
    extractionControllerRef.current?.abort();
    extractionControllerRef.current = null;
    setAnswers(readDraft(storageKey));
    setCurrentState(state);
    setExtracting(false);
    setCandidates([]);
    setAuditConfirmed(false);
    setExtractionMessage(null);
    return () => {
      extractionRequestSeqRef.current += 1;
      extractionControllerRef.current?.abort();
      extractionControllerRef.current = null;
    };
  }, [state, storageKey]);

  if (currentState === "closed") return null;
  if (currentState === "generating_questions") {
    return <aside aria-label="认知访谈" className="rounded-[16px] border border-[#D9D2F3] bg-[#F8F6FF] p-5">正在生成中立访谈问题…</aside>;
  }
  if (currentState === "question_error" || currentState === "session_invalid") {
    return (
      <aside aria-label="认知访谈" role="alert" className="rounded-[16px] border border-[#F0C2C2] bg-[#FFF4F4] p-5 text-[#9D2B2B]">
        {errorMessage || (currentState === "session_invalid" ? "访谈归属已失效，请重新开启。" : "访谈问题生成失败，请重试。")}
      </aside>
    );
  }

  function updateAnswer(questionId: string, answer: string) {
    extractionRequestSeqRef.current += 1;
    extractionControllerRef.current?.abort();
    extractionControllerRef.current = null;
    const next = { ...answers, [questionId]: answer };
    setAnswers(next);
    setCurrentState(answer.trim() ? "draft_saved" : "answering");
    setExtracting(false);
    setCandidates([]);
    setAuditConfirmed(false);
    setExtractionMessage(null);
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    window.localStorage.setItem(lastInterviewKey(activeIPId, topicId), interviewId);
  }

  async function submitAnswers() {
    const rawInteraction = questions.map(question => ({
      questionId: question.id,
      question: question.content,
      answer: answers[question.id] ?? "",
    }));
    if (rawInteraction.some(item => item.answer.trim().length <= 10)) {
      setExtractionMessage("每个回答至少需要11个字符，请补充真实观点或理由。");
      return;
    }

    const requestSeq = extractionRequestSeqRef.current + 1;
    extractionRequestSeqRef.current = requestSeq;
    const controller = new AbortController();
    extractionControllerRef.current?.abort();
    extractionControllerRef.current = controller;
    setExtracting(true);
    setCandidates([]);
    setAuditConfirmed(false);
    setExtractionMessage(null);
    try {
      const response = await apiFetch("/api/ip-boundary/interview/extract", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeIPId, topicId, interviewId, rawInteraction }),
      });
      const raw: unknown = await response.json();
      if (extractionRequestSeqRef.current !== requestSeq) return;
      if (!response.ok) {
        const message = isRecord(raw) && typeof raw.error === "string"
          ? raw.error
          : "访谈认知提取失败，请补充后重试。";
        throw new Error(message);
      }
      const extractedCandidates = candidatesForSession(raw, activeIPId, topicId, interviewId);
      if (extractedCandidates === null) throw new Error("访谈提取结果归属不一致，请重新提交。");
      setCandidates(extractedCandidates);
      setAuditConfirmed(false);
      setCurrentState("ready_for_next_step");
    } catch (error) {
      if (extractionRequestSeqRef.current !== requestSeq
        || (error instanceof DOMException && error.name === "AbortError")) return;
      setExtractionMessage(error instanceof Error ? error.message : "访谈认知提取失败，请重试。");
    } finally {
      if (extractionRequestSeqRef.current === requestSeq) {
        setExtracting(false);
        extractionControllerRef.current = null;
      }
    }
  }

  const canSubmit = questions.length > 0
    && questions.every(question => (answers[question.id] ?? "").trim().length > 10);

  return (
    <aside aria-label="认知访谈" className="rounded-[16px] border border-[#D9D2F3] bg-[#F8F6FF] p-5">
      <div className="text-[14px] font-bold text-[#30245C]">认知访谈</div>
      <p className="mt-1 text-[12px] leading-5 text-[#675C87]">回答只保存在当前IP与当前选题的访谈草稿中，尚未进入长期认知库。</p>
      <div className="mt-4 space-y-4">
        {questions.map((question, index) => (
          <label key={question.id} className="block">
            <span className="block text-[13px] font-semibold leading-6 text-[#30245C]">{question.content}</span>
            <textarea
              aria-label={index === 0 ? "访谈回答" : `访谈回答${index + 1}`}
              value={answers[question.id] ?? ""}
              onChange={event => updateAnswer(question.id, event.target.value)}
              disabled={extracting}
              className="mt-2 min-h-[96px] w-full resize-y rounded-[12px] border border-[#D9D2F3] bg-white px-3 py-2 text-[13px] leading-6 text-[#1C1C1B] outline-none focus:border-[#8E78D6]"
              placeholder="请按您的真实观点回答；不确定也可以直接说明。"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 text-[11px] text-[#7B7197]">
        {candidates.length > 0
          ? `已提取${candidates.length}个候选认知节点，等待人工预审。`
          : currentState === "draft_saved"
            ? "草稿已保存在当前访谈"
            : "回答尚未提交"}
      </div>
      {extractionMessage && <p role="alert" className="mt-2 text-[12px] text-[#9D2B2B]">{extractionMessage}</p>}
      {candidates.length > 0 && (
        <InterviewExtractionAudit
          candidates={candidates}
          existingClaims={existingClaims}
          onChange={next => {
            setCandidates(next);
            setAuditConfirmed(false);
          }}
          onConfirm={next => {
            setCandidates(next);
            setAuditConfirmed(true);
          }}
        />
      )}
      {auditConfirmed && (
        <p className="mt-2 text-[12px] text-[#4F6F32]">候选内容已确认；本步骤尚未写入长期认知库。</p>
      )}
      <button
        type="button"
        onClick={() => void submitAnswers()}
        disabled={!canSubmit || extracting}
        className="mt-4 rounded-full bg-[#5D45A7] px-4 py-2 text-[12px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {extracting ? "正在提取认知…" : "提交回答并提取认知"}
      </button>
    </aside>
  );
}
