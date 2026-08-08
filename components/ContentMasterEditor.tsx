"use client";

import { useRef, useState } from "react";
import {
  createContentMaster,
  getContentMaster,
  mergeAdjacentContentMasterSegments,
  renameContentMasterSegment,
  splitContentMasterSegment,
} from "@/lib/content-master-store";
import type { ContentMaster } from "@/lib/content-master-types";
import type { CopyIntegrationResult } from "@/lib/copy-integration-types";

interface ContentMasterEditorProps {
  sections: CopyIntegrationResult["draft"]["sections"];
  sources: Array<{ id: string; name: string }>;
  onDraftChange?: (draft: ContentMaster) => void;
}

export function ContentMasterEditor({
  sections,
  sources,
  onDraftChange,
}: ContentMasterEditorProps) {
  const [title, setTitle] = useState(sections[0]?.heading ?? "内容母稿");
  const [savedDraft, setSavedDraft] = useState<ContentMaster | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const [headingEdits, setHeadingEdits] = useState<Record<string, string>>({});
  const [splitPositions, setSplitPositions] = useState<Record<string, number>>({});

  async function saveDraft() {
    if (savingRef.current) return;
    if (!title.trim()) {
      setError("请先填写母稿标题");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const draft = await createContentMaster({ title, sections, sources });
      setSavedDraft(draft);
      onDraftChange?.(draft);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "母稿保存失败");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function refreshDraft() {
    if (!savedDraft) return;
    const current = getContentMaster(savedDraft.id);
    if (current) {
      setSavedDraft(current);
      onDraftChange?.(current);
    }
  }

  async function saveSegmentHeading(segmentId: string, currentHeading: string) {
    if (!savedDraft) return;
    try {
      await renameContentMasterSegment(
        savedDraft.id,
        segmentId,
        headingEdits[segmentId] ?? currentHeading,
      );
      refreshDraft();
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "片段标题保存失败");
    }
  }

  async function mergeWithNext(firstId: string, secondId: string, heading: string) {
    if (!savedDraft) return;
    try {
      await mergeAdjacentContentMasterSegments(savedDraft.id, firstId, secondId, heading);
      refreshDraft();
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "片段合并失败");
    }
  }

  async function splitAtCursor(segmentId: string, heading: string) {
    if (!savedDraft) return;
    try {
      await splitContentMasterSegment(
        savedDraft.id,
        segmentId,
        splitPositions[segmentId] ?? 0,
        [`${heading}（上）`, `${heading}（下）`],
      );
      refreshDraft();
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "片段拆分失败");
    }
  }

  const activeSegments = savedDraft
    ? savedDraft.segments
      .filter(segment => segment.status === "正常")
      .sort((first, second) => first.order - second.order)
    : [];

  return (
    <div className="mb-5 rounded-[12px] border border-[#D9D8D2] bg-[#FAFAF8] p-3.5">
      <label className="block">
        <span className="text-[11px] font-bold text-[#777]">母稿标题</span>
        <input
          aria-label="母稿标题"
          value={title}
          onChange={event => setTitle(event.target.value)}
          disabled={Boolean(savedDraft)}
          className="mt-1.5 w-full rounded-[8px] border border-[#DDDCD6] bg-white px-3 py-2 text-[13px] font-semibold text-[#333] outline-none focus:border-[#639922] disabled:bg-[#F2F1ED]"
        />
      </label>
      {savedDraft ? (
        <div className="mt-3">
          <p className="text-[12px] font-bold text-[#4F7219]">母稿编号：{savedDraft.id}</p>
          <p className="mt-1 text-[11px] leading-5 text-[#888]">把光标放在正文中需要断开的位置，再点击“在光标处拆分”。</p>
          <div className="mt-3 flex flex-col gap-3">
            {activeSegments.map((segment, index) => {
              const next = activeSegments[index + 1];
              return (
                <article key={segment.id} className="rounded-[10px] border border-[#E3E2DC] bg-white p-3">
                  <p className="text-[10px] font-semibold text-[#79954A]">{segment.id}</p>
                  <div className="mt-2 flex gap-2">
                    <input
                      aria-label={`片段小标题 ${segment.id}`}
                      value={headingEdits[segment.id] ?? segment.heading}
                      onChange={event => setHeadingEdits(current => ({
                        ...current,
                        [segment.id]: event.target.value,
                      }))}
                      className="min-w-0 flex-1 rounded-[7px] border border-[#DDDCD6] px-2.5 py-1.5 text-[12px] font-semibold outline-none focus:border-[#639922]"
                    />
                    <button
                      type="button"
                      aria-label={`保存片段标题 ${segment.id}`}
                      onClick={() => saveSegmentHeading(segment.id, segment.heading)}
                      className="rounded-[7px] bg-[#F2F1ED] px-2.5 text-[11px] font-semibold text-[#555]"
                    >
                      保存标题
                    </button>
                  </div>
                  <textarea
                    readOnly
                    aria-label={`片段正文 ${segment.id}`}
                    value={segment.content}
                    onSelect={event => {
                      const splitAt = event.currentTarget.selectionStart;
                      setSplitPositions(current => ({
                        ...current,
                        [segment.id]: splitAt,
                      }));
                    }}
                    rows={Math.min(8, Math.max(3, segment.content.split("\n").length + 1))}
                    className="mt-2 w-full resize-y rounded-[7px] border border-[#EEEDE8] bg-[#FAFAF8] p-2.5 text-[12px] leading-5 text-[#555] outline-none"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-label={`在光标处拆分 ${segment.id}`}
                      onClick={() => splitAtCursor(segment.id, segment.heading)}
                      className="rounded-full border border-[#D8D7D0] px-2.5 py-1 text-[11px] text-[#666]"
                    >
                      在光标处拆分
                    </button>
                    {next && (
                      <button
                        type="button"
                        aria-label={`合并片段 ${segment.id} 与 ${next.id}`}
                        onClick={() => mergeWithNext(
                          segment.id,
                          next.id,
                          `${headingEdits[segment.id] ?? segment.heading}与${headingEdits[next.id] ?? next.heading}`,
                        )}
                        className="rounded-full border border-[#D8D7D0] px-2.5 py-1 text-[11px] text-[#666]"
                      >
                        与下一片段合并
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={saveDraft}
          disabled={saving}
          className="mt-3 rounded-full bg-[#1C1C1B] px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存母稿"}
        </button>
      )}
      {error && <p role="alert" className="mt-2 text-[12px] text-[#A32D2D]">{error}</p>}
    </div>
  );
}
