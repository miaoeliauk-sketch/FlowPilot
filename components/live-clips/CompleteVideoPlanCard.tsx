"use client";

import {
  COMPLETE_VIDEO_SECTION_ROLE_LABELS,
  type CompleteVideoPlan,
  type CompleteVideoPlanSection,
} from "@/lib/live-clips-types";

function sectionPosition(section: CompleteVideoPlanSection) {
  if (section.startTime && section.endTime) return `${section.startTime} → ${section.endTime}`;
  if (section.startTime) return `${section.startTime}起 · 结束位置见第${section.endParagraph}段`;
  return `第${section.startParagraph}—${section.endParagraph}段`;
}

export function formatCompleteVideoPlanForCopy(plan: CompleteVideoPlan) {
  const sections = plan.sections.map(section => {
    const label = COMPLETE_VIDEO_SECTION_ROLE_LABELS[section.role];
    if (section.sourceType === "supplemental") {
      return `【${label}｜补录建议】\n${section.supplementalSuggestion}\n衔接：${section.transitionNote}`;
    }
    return `【${label}｜原片｜${sectionPosition(section)}】\n${section.cleanedText}\n衔接：${section.transitionNote}`;
  }).join("\n\n");
  return [
    `【完整成片方案】\n${plan.title}`,
    `【组织理由】\n${plan.recommendReason}`,
    sections,
    `【剪辑建议】\n${plan.editingNotes.map((note, index) => `${index + 1}. ${note}`).join("\n")}`,
  ].join("\n\n");
}

export default function CompleteVideoPlanCard({
  plan,
  onCopy,
}: {
  plan: CompleteVideoPlan;
  onCopy: (text: string, label: string) => void;
}) {
  const duration = plan.sourceDurationSeconds > 0
    ? `${plan.durationBasis === "actual" ? "原片约" : "原片文字量估算约"}${plan.sourceDurationSeconds}秒${plan.sections.some(section => section.sourceType === "supplemental") ? "，不含补录" : ""}`
    : "仅提供结构建议";
  return (
    <article className="rounded-[14px] border border-[#DAD9D4] bg-[#FAFAF7] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold text-[#1C1C1B]">{plan.title}</h3>
          <p className="mt-1 text-[11.5px] text-[#888]">{duration}</p>
        </div>
        <button type="button" aria-label="复制完整成片方案" onClick={() => onCopy(formatCompleteVideoPlanForCopy(plan), "完整成片方案")} className="rounded-[9px] bg-[#1C1C1B] px-3 py-1.5 text-[11.5px] font-semibold text-white">复制完整方案</button>
      </div>
      <p className="mt-3 rounded-[10px] bg-white px-3 py-2.5 text-[12.5px] leading-5 text-[#555]">{plan.recommendReason}</p>
      <div className="mt-3 flex flex-col gap-2">
        {plan.sections.map((section, index) => (
          <section key={`${section.role}-${index}`} className="rounded-[11px] border border-[#E8E7E1] bg-white p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#EAF3DE] px-2.5 py-1 text-[10.5px] font-bold text-[#3B6D11]">{COMPLETE_VIDEO_SECTION_ROLE_LABELS[section.role]}</span>
              {section.sourceType === "supplemental" ? (
                <span className="rounded-full bg-[#FBF3D6] px-2.5 py-1 text-[10.5px] font-bold text-[#7A5C00]">补录建议</span>
              ) : (
                <span className="text-[10.5px] text-[#888]">原片 · {sectionPosition(section)}</span>
              )}
            </div>
            <p className={`mt-2 whitespace-pre-wrap text-[12.5px] leading-6 ${section.sourceType === "supplemental" ? "text-[#7A5C00]" : "text-[#333]"}`}>
              {section.sourceType === "supplemental" ? section.supplementalSuggestion : section.cleanedText}
            </p>
            <p className="mt-2 text-[11px] text-[#999]">衔接建议：{section.transitionNote}</p>
          </section>
        ))}
      </div>
      {plan.editingNotes.length > 0 && (
        <div className="mt-3 rounded-[10px] bg-white px-3 py-2.5">
          <div className="text-[10.5px] font-bold text-[#888]">剪辑执行建议</div>
          {plan.editingNotes.map((note, index) => <p key={`${note}-${index}`} className="mt-1 text-[11.5px] text-[#666]">{index + 1}. {note}</p>)}
        </div>
      )}
    </article>
  );
}
