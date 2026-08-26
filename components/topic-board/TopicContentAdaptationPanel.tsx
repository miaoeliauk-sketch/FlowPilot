"use client";

import { useEffect, useState } from "react";
import {
  CONTENT_TRACKS,
  type ContentAdaptationRecord,
  type ContentAdaptationReviewAction,
  type EditableContentAdaptationProfile,
} from "@/lib/content-adaptation";
import { CONTENT_PURPOSES } from "@/lib/content-purpose";

export type TopicContentAdaptationStatus = "idle" | "loading" | "available" | "unavailable";

function cloneProfile(profile: EditableContentAdaptationProfile): EditableContentAdaptationProfile {
  return {
    ...profile,
    fineTags: [...profile.fineTags],
    audienceTags: [...profile.audienceTags],
    reasons: { ...profile.reasons },
  };
}

function splitTags(value: string): string[] {
  return value.split(/[、,，]/).map(item => item.trim()).filter(Boolean);
}

export function TopicContentAdaptationPanel({
  record,
  status,
  ipName,
  onReview,
}: {
  record: ContentAdaptationRecord | null;
  status: TopicContentAdaptationStatus;
  ipName: string | null;
  onReview: (action: ContentAdaptationReviewAction) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditableContentAdaptationProfile | null>(
    record?.current ? cloneProfile(record.current.contentProfile) : null,
  );
  const [fineTags, setFineTags] = useState(record?.current?.contentProfile.fineTags.join("、") ?? "");
  const [audienceTags, setAudienceTags] = useState(record?.current?.contentProfile.audienceTags.join("、") ?? "");

  useEffect(() => {
    setEditing(false);
    setDraft(record?.current ? cloneProfile(record.current.contentProfile) : null);
    setFineTags(record?.current?.contentProfile.fineTags.join("、") ?? "");
    setAudienceTags(record?.current?.contentProfile.audienceTags.join("、") ?? "");
  }, [record?.updatedAt]);

  if (status === "idle") return null;
  if (status === "loading") {
    return <section aria-label="内容适配与IP匹配" className="rounded-[14px] border border-[#DDE8C5] bg-[#FAFCF5] p-5 text-[13px] font-semibold text-[#4E6C25]">内容适配正在异步生成，不影响选题评估</section>;
  }
  if (status === "unavailable" || !record) {
    return <section aria-label="内容适配与IP匹配" className="rounded-[14px] border border-[#E7D8A2] bg-[#FFFDF6] p-5 text-[13px] font-semibold text-[#7A5C00]">内容适配暂不可用，不影响选题评估</section>;
  }
  if (!record.current) {
    return (
      <section aria-label="内容适配与IP匹配" className="rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] p-5">
        <h2 className="text-[14px] font-semibold">内容适配（已人工删除）</h2>
        <p className="mt-1 text-[12px] text-[#666]">AI原始判断和删除记录仍保留，系统不会据此自动学习。</p>
        <details className="mt-3 text-[12px] text-[#555]"><summary>查看AI原始判断</summary><p className="mt-2">赛道：{record.aiOriginal.contentProfile.primaryTrack}</p><p>人群：{record.aiOriginal.contentProfile.targetAudience}</p><p>目的：{record.aiOriginal.contentProfile.primaryPurpose}</p></details>
      </section>
    );
  }

  const profile = record.current.contentProfile;
  return (
    <section aria-label="内容适配与IP匹配" className="space-y-3">
      <div className="rounded-[14px] border border-[#DDE8C5] bg-[#FAFCF5] p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div><h2 className="text-[14px] font-semibold text-[#1C1C1B]">内容本身</h2><p className="mt-1 text-[11.5px] text-[#666]">{record.reviewStatus === "ai_prefill" ? "AI预填，可人工修改或删除" : "已保留人工处理记录"}</p></div>
          {!editing && <button type="button" onClick={() => setEditing(true)} className="text-[12px] font-semibold text-[#639922]">编辑内容适配</button>}
        </div>
        {editing && draft ? (
          <div className="grid gap-3 text-[12px] md:grid-cols-2">
            <label>主要赛道<select aria-label="主要赛道" value={draft.primaryTrack ?? ""} onChange={event => setDraft(current => {
              if (!current) return current;
              const primaryTrack = event.target.value ? event.target.value as typeof current.primaryTrack : null;
              return { ...current, primaryTrack, secondaryTrack: primaryTrack && current.secondaryTrack !== primaryTrack ? current.secondaryTrack : null, reasons: { ...current.reasons, track: primaryTrack ? current.reasons.track : null } };
            })} className="mt-1 w-full rounded border p-2"><option value="">删除赛道判断</option>{CONTENT_TRACKS.map(track => <option key={track}>{track}</option>)}</select></label>
            <label>辅助赛道<select aria-label="辅助赛道" value={draft.secondaryTrack ?? ""} onChange={event => setDraft(current => current ? { ...current, secondaryTrack: event.target.value ? event.target.value as typeof current.secondaryTrack : null } : current)} className="mt-1 w-full rounded border p-2"><option value="">无</option>{CONTENT_TRACKS.filter(track => track !== draft.primaryTrack).map(track => <option key={track}>{track}</option>)}</select></label>
            <label>细分标签<input aria-label="细分标签" value={fineTags} onChange={event => { setFineTags(event.target.value); setDraft(current => current ? { ...current, fineTags: splitTags(event.target.value) } : current); }} className="mt-1 w-full rounded border p-2" /></label>
            <label>目标人群<input aria-label="目标人群" value={draft.targetAudience ?? ""} onChange={event => setDraft(current => current ? { ...current, targetAudience: event.target.value || null, reasons: { ...current.reasons, audience: event.target.value ? current.reasons.audience : null } } : current)} className="mt-1 w-full rounded border p-2" /></label>
            <label>人群标签<input aria-label="人群标签" value={audienceTags} onChange={event => { setAudienceTags(event.target.value); setDraft(current => current ? { ...current, audienceTags: splitTags(event.target.value) } : current); }} className="mt-1 w-full rounded border p-2" /></label>
            <label>主要目的<select aria-label="主要目的" value={draft.primaryPurpose ?? ""} onChange={event => setDraft(current => {
              if (!current) return current;
              const primaryPurpose = event.target.value ? event.target.value as typeof current.primaryPurpose : null;
              return { ...current, primaryPurpose, secondaryPurpose: primaryPurpose && current.secondaryPurpose !== primaryPurpose ? current.secondaryPurpose : null, reasons: { ...current.reasons, purpose: primaryPurpose ? current.reasons.purpose : null } };
            })} className="mt-1 w-full rounded border p-2"><option value="">删除目的判断</option>{CONTENT_PURPOSES.map(purpose => <option key={purpose}>{purpose}</option>)}</select></label>
            <label>辅助目的<select aria-label="辅助目的" value={draft.secondaryPurpose ?? ""} onChange={event => setDraft(current => current ? { ...current, secondaryPurpose: event.target.value ? event.target.value as typeof current.secondaryPurpose : null } : current)} className="mt-1 w-full rounded border p-2"><option value="">无</option>{CONTENT_PURPOSES.filter(purpose => purpose !== draft.primaryPurpose).map(purpose => <option key={purpose}>{purpose}</option>)}</select></label>
            <label className="md:col-span-2">赛道判断依据<input aria-label="赛道判断依据" value={draft.reasons.track ?? ""} onChange={event => setDraft(current => current ? { ...current, reasons: { ...current.reasons, track: event.target.value || null } } : current)} className="mt-1 w-full rounded border p-2" /></label>
            <label className="md:col-span-2">目标人群判断依据<input aria-label="目标人群判断依据" value={draft.reasons.audience ?? ""} onChange={event => setDraft(current => current ? { ...current, reasons: { ...current.reasons, audience: event.target.value || null } } : current)} className="mt-1 w-full rounded border p-2" /></label>
            <label className="md:col-span-2">内容目的判断依据<input aria-label="内容目的判断依据" value={draft.reasons.purpose ?? ""} onChange={event => setDraft(current => current ? { ...current, reasons: { ...current.reasons, purpose: event.target.value || null } } : current)} className="mt-1 w-full rounded border p-2" /></label>
            <div className="flex gap-2 md:col-span-2"><button type="button" onClick={() => onReview({ type: "modify", contentProfile: draft })} className="rounded bg-[#1C1C1B] px-3 py-2 font-semibold text-white">保存人工修改</button><button type="button" onClick={() => setEditing(false)} className="rounded border px-3 py-2">取消</button></div>
          </div>
        ) : (
          <>
            <div className="space-y-1 text-[12.5px] leading-5 text-[#444]"><p>主要赛道：{profile.primaryTrack ?? "已删除"}</p>{profile.secondaryTrack && <p>辅助赛道：{profile.secondaryTrack}</p>}<p>细分标签：{profile.fineTags.join("、") || "已删除"}</p><p>目标人群：{profile.targetAudience ?? "已删除"}</p><p>人群标签：{profile.audienceTags.join("、") || "已删除"}</p><p>主要目的：{profile.primaryPurpose ?? "已删除"}</p>{profile.secondaryPurpose && <p>辅助目的：{profile.secondaryPurpose}</p>}</div>
            <details className="mt-3 text-[11.5px] text-[#666]"><summary>AI原始判断（不可覆盖）</summary><p className="mt-1">赛道：{record.aiOriginal.contentProfile.primaryTrack}</p><p>人群：{record.aiOriginal.contentProfile.targetAudience}</p><p>目的：{record.aiOriginal.contentProfile.primaryPurpose}</p></details>
            <div className="mt-3 flex gap-2">{record.reviewStatus === "ai_prefill" && <button type="button" onClick={() => onReview({ type: "confirm" })} className="rounded border border-[#BFD59F] px-3 py-1.5 text-[#4E6C25]">确认AI预填</button>}<button type="button" onClick={() => onReview({ type: "remove" })} className="rounded border border-[#D8B1B1] px-3 py-1.5 text-[#A32D2D]">删除当前内容适配</button></div>
          </>
        )}
      </div>
      {record.ipFitStatus === "needs_refresh" ? (
        <div className="rounded-[14px] border border-[#E7D8A2] bg-[#FFFDF6] p-5 text-[12.5px] font-semibold text-[#7A5C00]">与当前IP的匹配度需要重新判断</div>
      ) : record.current.ipFit && (
        <div className="rounded-[14px] border border-[#E5E4DE] bg-white p-5"><h2 className="text-[14px] font-semibold">与当前IP「{ipName ?? "未选择"}」的匹配度</h2><p className="mt-2 text-[13px] font-semibold text-[#3B6D11]">{record.current.ipFit.tier}</p><p className="mt-1 text-[12.5px] leading-5 text-[#555]">{record.current.ipFit.reason}</p></div>
      )}
    </section>
  );
}
