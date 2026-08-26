"use client";

import { useEffect, useMemo, useState } from "react";
import type { InterviewPanelState, InterviewQuestion } from "@/lib/ip-boundary-interview";

interface InterviewPanelProps {
  activeIPId: string;
  topicId: string;
  interviewId: string;
  questions: InterviewQuestion[];
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

export function InterviewPanel({
  activeIPId,
  topicId,
  interviewId,
  questions,
  state = "answering",
  errorMessage = null,
}: InterviewPanelProps) {
  const storageKey = useMemo(
    () => draftKey(activeIPId, topicId, interviewId),
    [activeIPId, topicId, interviewId],
  );
  const [answers, setAnswers] = useState<Record<string, string>>(() => readDraft(storageKey));
  const [currentState, setCurrentState] = useState<InterviewPanelState>(state);

  useEffect(() => {
    setAnswers(readDraft(storageKey));
    setCurrentState(state);
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
    const next = { ...answers, [questionId]: answer };
    setAnswers(next);
    setCurrentState(answer.trim() ? "draft_saved" : "answering");
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    window.localStorage.setItem(lastInterviewKey(activeIPId, topicId), interviewId);
  }

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
              className="mt-2 min-h-[96px] w-full resize-y rounded-[12px] border border-[#D9D2F3] bg-white px-3 py-2 text-[13px] leading-6 text-[#1C1C1B] outline-none focus:border-[#8E78D6]"
              placeholder="请按您的真实观点回答；不确定也可以直接说明。"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 text-[11px] text-[#7B7197]">
        {currentState === "draft_saved" ? "草稿已保存在当前访谈" : currentState === "ready_for_next_step" ? "回答已准备进入下一步" : "回答尚未提交"}
      </div>
    </aside>
  );
}
