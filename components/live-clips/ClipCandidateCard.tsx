"use client";

import {
  CLIP_STRUCTURE_ROLE_LABELS,
  type ClipCandidate,
  type ClipRating,
} from "@/lib/live-clips-types";
import { formatLiveClipPosition } from "@/lib/live-clips-display";

function ratingStyle(rating: ClipRating) {
  if (rating === "强") return "bg-[#EAF3DE] text-[#3B6D11]";
  if (rating === "中") return "bg-[#FBF3D6] text-[#7A5C00]";
  return "bg-[#F2F1ED] text-[#888]";
}
function recommendationStyle(value: ClipCandidate["recommendation"]) {
  if (value === "强烈建议切") return "bg-[#1C1C1B] text-[#C8F04A]";
  if (value === "可以考虑") return "bg-[#FBF3D6] text-[#7A5C00]";
  return "bg-[#F2F1ED] text-[#888]";
}

function formatDuration(candidate: ClipCandidate) {
  const seconds = candidate.estimatedDurationSeconds;
  if (!seconds) return candidate.durationBasis === "actual" ? "真实时间不足" : "文字量估算：短";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  const value = minutes > 0 ? `${minutes}分${remainder > 0 ? `${remainder}秒` : ""}` : `${remainder}秒`;
  return candidate.durationBasis === "actual" ? `约${value}` : `文字量估算约${value}`;
}

const DIMENSION_LABELS: Array<[keyof ClipCandidate["dimensions"], string]> = [
  ["completeness", "独立完整性"],
  ["hookStrength", "开头吸引力"],
  ["pointClarity", "观点明确度"],
  ["informationDensity", "信息密度"],
  ["tension", "表达张力"],
  ["ipFit", "IP匹配度"],
];

export function formatClipCardForCopy(candidate: ClipCandidate) {
  const purpose = candidate.primaryPurpose
    ? `${candidate.primaryPurpose}${candidate.secondaryPurpose ? `（辅助：${candidate.secondaryPurpose}）` : ""}`
    : "旧数据未判断";
  const purposeEvidence = candidate.primaryPurposeEvidence
    ? `第${candidate.primaryPurposeEvidence.paragraphNumber}段「${candidate.primaryPurposeEvidence.quote}」`
    : "无";
  const secondaryPurposeEvidence = candidate.secondaryPurpose && candidate.secondaryPurposeEvidence
    ? `\n辅助目的${candidate.secondaryPurpose}：第${candidate.secondaryPurposeEvidence.paragraphNumber}段「${candidate.secondaryPurposeEvidence.quote}」`
    : "";
  return [
    `【切片主题】\n${candidate.topic}`,
    `【结构角色】\n${candidate.structureRole ? CLIP_STRUCTURE_ROLE_LABELS[candidate.structureRole] : "历史未分类"}`,
    `【内容目的】\n${purpose}`,
    `【目的证据】\n${purposeEvidence}${secondaryPurposeEvidence}`,
    `【推荐程度】\n${candidate.recommendation}`,
    `【原始位置】\n${formatLiveClipPosition(candidate)}`,
    `【预计成片长度】\n${formatDuration(candidate)}`,
    `【核心观点】\n${candidate.corePoint}`,
    `【建议从这里开始】\n${candidate.startQuote}`,
    `【建议在这里结束】\n${candidate.endQuote}`,
    `【为什么值得剪】\n${candidate.recommendReason}`,
    `【建议删除】\n${candidate.removeSuggestions.length > 0 ? candidate.removeSuggestions.map(item => `第${item.paragraphNumber}段「${item.quote}」：${item.reason}`).join("\n") : "无"}`,
    `【原始切片逐字稿】\n${candidate.rawClipText}`,
    `【清洗后切片稿】\n${candidate.cleanedClipText}`,
    `【标题建议】\n${candidate.titleSuggestions.map((title, index) => `${index + 1}. ${title}`).join("\n")}`,
    `【封面文案】\n${candidate.coverSuggestions.map((title, index) => `${index + 1}. ${title}`).join("\n")}`,
  ].join("\n\n");
}

export default function ClipCandidateCard({
  candidate,
  selected,
  onToggle,
  onCopy,
  onGenerateCompletePlan,
  generatingCompletePlan,
  completePlanGenerationDisabled,
}: {
  candidate: ClipCandidate;
  selected: boolean;
  onToggle: () => void;
  onCopy: (text: string, label: string) => void;
  onGenerateCompletePlan: () => void;
  generatingCompletePlan: boolean;
  completePlanGenerationDisabled: boolean;
}) {
  return (
    <article className={`rounded-[18px] border bg-white p-5 shadow-sm transition ${selected ? "border-[#639922] ring-2 ring-[#EAF3DE]" : "border-[#E5E4DE]"}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`选择切片：${candidate.topic}`}
          className="mt-1 h-4 w-4 accent-[#639922]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#EAF3DE] px-2.5 py-1 text-[11px] font-bold text-[#3B6D11]">{candidate.structureRole ? CLIP_STRUCTURE_ROLE_LABELS[candidate.structureRole] : "历史未分类"}</span>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${recommendationStyle(candidate.recommendation)}`}>{candidate.recommendation}</span>
            {candidate.primaryPurpose && <span className="rounded-full bg-[#E9F0FF] px-2.5 py-1 text-[10.5px] font-bold text-[#315E9C]">目的：{candidate.primaryPurpose}</span>}
            {candidate.secondaryPurpose && <span className="rounded-full bg-[#F2F1ED] px-2.5 py-1 text-[10.5px] text-[#777]">辅助：{candidate.secondaryPurpose}</span>}
          </div>
          <h2 className="mt-3 text-[18px] font-bold leading-7 text-[#1C1C1B]">{candidate.topic}</h2>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[#888]">
            <span>原始位置：<b className="text-[#555]">{formatLiveClipPosition(candidate)}</b></span>
            <span>预计长度：<b className="text-[#555]">{formatDuration(candidate)}</b></span>
          </div>
          {!candidate.startTime && (
            <p className="mt-2 text-[11.5px] text-[#A66A00]">原始逐字稿未包含时间信息，无法提供准确剪辑时间。</p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {DIMENSION_LABELS.map(([key, label]) => (
          <div key={key} className="rounded-[10px] bg-[#F7F6F2] px-2.5 py-2 text-center">
            <div className="text-[10.5px] text-[#999]">{label}</div>
            <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${ratingStyle(candidate.dimensions[key])}`}>{candidate.dimensions[key]}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <section className="rounded-[12px] bg-[#F7F6F2] p-3.5">
          <div className="text-[11px] font-bold text-[#888]">核心观点</div>
          <p className="mt-1.5 text-[13px] leading-6 text-[#333]">{candidate.corePoint}</p>
        </section>
        <section className="rounded-[12px] bg-[#EAF3DE] p-3.5">
          <div className="text-[11px] font-bold text-[#3B6D11]">为什么值得剪</div>
          <p className="mt-1.5 text-[13px] leading-6 text-[#315C10]">{candidate.recommendReason}</p>
        </section>
      </div>

      <section className="mt-3 rounded-[12px] border border-[#DCE7F8] bg-[#F6F9FF] p-3.5">
        <div className="text-[11px] font-bold text-[#56739A]">内容目的依据</div>
        {candidate.primaryPurposeEvidence ? (
          <p className="mt-1.5 text-[12.5px] leading-6 text-[#315E9C]">
            {candidate.primaryPurpose}：第{candidate.primaryPurposeEvidence.paragraphNumber}段「{candidate.primaryPurposeEvidence.quote}」
          </p>
        ) : (
          <p className="mt-1.5 text-[12.5px] text-[#888]">旧数据未进行内容目的判断。</p>
        )}
        {candidate.secondaryPurpose && candidate.secondaryPurposeEvidence && (
          <p className="mt-1 text-[12.5px] leading-6 text-[#666]">
            辅助目的{candidate.secondaryPurpose}：第{candidate.secondaryPurposeEvidence.paragraphNumber}段「{candidate.secondaryPurposeEvidence.quote}」
          </p>
        )}
      </section>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <section className="rounded-[12px] border border-[#E5E4DE] p-3.5">
          <div className="text-[11px] font-bold text-[#888]">建议从这里开始</div>
          <p className="mt-1.5 text-[13px] leading-6 text-[#1C1C1B]">「{candidate.startQuote}」</p>
        </section>
        <section className="rounded-[12px] border border-[#E5E4DE] p-3.5">
          <div className="text-[11px] font-bold text-[#888]">建议在这里结束</div>
          <p className="mt-1.5 text-[13px] leading-6 text-[#1C1C1B]">「{candidate.endQuote}」</p>
        </section>
      </div>

      <details className="mt-3 rounded-[12px] border border-[#E5E4DE] bg-white">
        <summary className="cursor-pointer px-4 py-3 text-[12.5px] font-bold text-[#555]">查看删除建议、完整原稿和清洗稿</summary>
        <div className="border-t border-[#F0EFE9] p-4">
          <div className="mb-4">
            <div className="text-[11px] font-bold text-[#888]">建议删除</div>
            {candidate.removeSuggestions.length === 0 ? (
              <p className="mt-1 text-[12.5px] text-[#999]">没有明确需要删除的片段。</p>
            ) : candidate.removeSuggestions.map((item, index) => (
              <div key={`${item.paragraphNumber}-${index}`} className="mt-2 rounded-[9px] bg-[#FCEBEB] px-3 py-2 text-[12px] text-[#7D2B2B]">
                {item.startTime ? `${item.startTime} · ` : `第${item.paragraphNumber}段 · `}「{item.quote}」——{item.reason}
              </div>
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold text-[#888]">
                原始切片逐字稿
                <button type="button" onClick={() => onCopy(candidate.rawClipText, "原始切片稿")} className="text-[#639922]">复制</button>
              </div>
              <p className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-[10px] bg-[#F7F6F2] p-3 text-[12.5px] leading-6 text-[#555]">{candidate.rawClipText}</p>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold text-[#888]">
                清洗后切片稿
                <button type="button" onClick={() => onCopy(candidate.cleanedClipText, "清洗后切片稿")} className="text-[#639922]">复制</button>
              </div>
              <p className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-[10px] bg-[#F7F6F2] p-3 text-[12.5px] leading-6 text-[#333]">{candidate.cleanedClipText}</p>
            </div>
          </div>
        </div>
      </details>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <section className="rounded-[12px] bg-[#F7F6F2] p-3.5">
          <div className="text-[11px] font-bold text-[#888]">标题建议</div>
          {candidate.titleSuggestions.map((title, index) => <p key={title} className="mt-1.5 text-[12.5px] text-[#333]">{index + 1}. {title}</p>)}
        </section>
        <section className="rounded-[12px] bg-[#F7F6F2] p-3.5">
          <div className="text-[11px] font-bold text-[#888]">封面文案</div>
          {candidate.coverSuggestions.map((title, index) => <p key={title} className="mt-1.5 text-[12.5px] text-[#333]">{index + 1}. {title}</p>)}
        </section>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          aria-label={`生成完整成片方案：${candidate.topic}`}
          onClick={onGenerateCompletePlan}
          disabled={completePlanGenerationDisabled}
          className="rounded-[10px] bg-[#EAF3DE] px-4 py-2 text-[12px] font-semibold text-[#3B6D11] disabled:opacity-50"
        >
          {generatingCompletePlan ? "正在生成完整方案…" : "生成完整成片方案"}
        </button>
        <button type="button" onClick={() => onCopy(formatClipCardForCopy(candidate), "完整切片卡")} className="rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[12px] font-semibold text-white">复制完整切片卡</button>
      </div>
    </article>
  );
}
