"use client";
import { apiFetch } from "@/lib/api-fetch";
import { useState, useEffect, useRef } from "react";
import { useIP } from "@/lib/ip-context";
import { addScriptAsset, getActiveIPId, getKnowledgeEntries, getScriptAssets, recordKnowledgeUsage, getStyleProfile } from "@/lib/ip-store";
import { IPProfile, KnowledgeEntry, ScriptAsset, TopicAsset } from "@/lib/types";
import { buildIPContextBlock } from "@/lib/ip-prompt";
import { Select, SelectOption } from "@/components/ui/select";
import { CitationSummary } from "@/components/ui/citation-summary";
import { getNormalizedCategory, isGlobalMethodCategory, isIPKnowledgeCategory } from "@/lib/knowledge-categories";
import {
  clearPartialScriptDraft,
  getPartialScriptDraft,
  PartialScriptDraft,
  savePartialScriptDraft,
} from "@/lib/script-factory-draft";
import type {
  ScriptGenerationStatus,
  ScriptPartialFailure,
  ScriptQualityCheck,
} from "@/lib/script-factory-contract";
import { addScriptAssetForTopic, resolveTopicForScript, TopicScriptLinkError } from "@/lib/topic-script-link";
import {
  resolveGenerationPermission,
  type CaseDecision,
  type CoverageAssessment,
  type CoverageSourceReference,
} from "@/lib/script-factory-coverage";
import { shouldUseShuimuranDirector } from "@/lib/script-director-profile";

const TOPIC_PLACEHOLDER = "例如：一个正在发生的变化，普通人应该如何判断？";
type GenerationMode = "standard" | "ip";

// ── Types ──
interface TitleOption { title: string; formula: string; platform: string; whyFitsIP: string; role?: "主推" | "流量" | "安全"; recommended?: boolean; }
interface KeywordReply { keyword: string; reply: string; }
interface CommentGuidance { interactionPrompt: string; keywordReplies: KeywordReply[]; dmGuidance: string; materialPackGuidance: string; }
interface OutlineSection { label: string; timeRange: string; content: string; subPoints?: string[]; }
interface StoryboardRow { time: string; scene: string; voiceover: string; subtitle: string; shot: string; material: string; editingTip: string; }
interface ShotPrompt { scene: string; prompt: string; }
interface EditingRhythm { subtitleHighlights: string[]; soundEffects: string[]; screenRecordingCuts: string[]; caseInserts: string[]; pauses: string[]; }
interface OutputLabels { cover: string; outline: string; shooting: string; comment: string; }
interface ApiMeta { apiCalled: boolean; calledAt: string; model: string | null; ipUsed: string | null; mockHit: boolean; error?: string; }
interface EvidenceAudit {
  coverage: string;
  reason: string;
  sourceReferences: CoverageSourceReference[];
  caseNeed: string;
  caseEvidence: { title: string; sourceType: string; verificationStatus: string; sourceUrl?: string; occurredAt?: string } | null;
}
interface ScriptResult {
  generationMode?: GenerationMode;
  outputMode?: "default" | "shuimuran-confirmed";
  generationStatus: ScriptGenerationStatus; partialFailure: ScriptPartialFailure | null;
  ipId: string; ipName: string; topic: string; platform: string;
  formatCategory: string; formatLabel: string; durationSeconds: number; durationLabel: string; goal: string; videoType: string;
  outputLabels: OutputLabels;
  titles: TitleOption[]; coverCopy: string[]; outline: OutlineSection[]; commentGuidance: CommentGuidance;
  ipStyleExplanation: string;
  pendingVerification?: string[];
  qualityCheck?: ScriptQualityCheck;
  storyboard: StoryboardRow[]; shootingSuggestions: string[]; shotPrompts: ShotPrompt[]; editingRhythm: EditingRhythm;
  apiMeta: ApiMeta;
  evidenceAudit?: EvidenceAudit;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasStoredScriptResultShape(value: Record<string, unknown>): boolean {
  const outputLabels = value.outputLabels;
  const commentGuidance = value.commentGuidance;
  const editingRhythm = value.editingRhythm;
  const apiMeta = value.apiMeta;
  if (
    !isRecord(outputLabels) ||
    !isRecord(commentGuidance) ||
    !Array.isArray(commentGuidance.keywordReplies) ||
    !isRecord(editingRhythm) ||
    !isRecord(apiMeta)
  ) {
    return false;
  }
  const rhythmFields = [
    editingRhythm.subtitleHighlights,
    editingRhythm.soundEffects,
    editingRhythm.screenRecordingCuts,
    editingRhythm.caseInserts,
    editingRhythm.pauses,
  ];
  return (
    typeof value.ipId === "string" &&
    typeof value.ipName === "string" &&
    typeof value.topic === "string" &&
    typeof value.platform === "string" &&
    typeof value.formatCategory === "string" &&
    typeof value.formatLabel === "string" &&
    typeof value.durationSeconds === "number" &&
    typeof value.durationLabel === "string" &&
    typeof value.goal === "string" &&
    typeof value.videoType === "string" &&
    Array.isArray(value.titles) &&
    Array.isArray(value.coverCopy) &&
    Array.isArray(value.outline) &&
    value.outline.every(section =>
      isRecord(section) &&
      (section.subPoints === undefined || Array.isArray(section.subPoints))
    ) &&
    Array.isArray(value.storyboard) &&
    Array.isArray(value.shootingSuggestions) &&
    Array.isArray(value.shotPrompts) &&
    rhythmFields.every(Array.isArray)
  );
}

function isStoredScriptResult(value: unknown): value is ScriptResult {
  if (!isRecord(value) || value.generationStatus !== "partial") return false;
  const partialFailure = value.partialFailure;
  return (
    isRecord(partialFailure) &&
    (partialFailure.stage === "storyboard" || partialFailure.stage === "execution") &&
    typeof partialFailure.errorCode === "string" &&
    typeof partialFailure.message === "string" &&
    hasStoredScriptResultShape(value)
  );
}

function normalizeStoredCompleteScriptResult(value: unknown): ScriptResult | null {
  if (!isRecord(value) || !hasStoredScriptResultShape(value)) return null;
  const isCurrentComplete = value.generationStatus === "complete" && value.partialFailure === null;
  const isLegacyComplete = value.generationStatus === undefined && value.partialFailure === undefined;
  if (!isCurrentComplete && !isLegacyComplete) return null;
  return {
    ...(value as unknown as Omit<ScriptResult, "generationStatus" | "partialFailure">),
    generationStatus: "complete",
    partialFailure: null,
  };
}

// ── 内容形式 → 时长选项（架构在后端按formatCategory切换，这里只管UI选项） ──
const FORMAT_CATEGORIES = [
  { id: "short", label: "短视频", durations: [{ label: "30秒", value: 30 }, { label: "60秒", value: 60 }, { label: "90秒", value: 90 }, { label: "3分钟", value: 180 }] },
  { id: "medium", label: "中视频", durations: [{ label: "3分钟", value: 180 }, { label: "5分钟", value: 300 }, { label: "8分钟", value: 480 }, { label: "10分钟", value: 600 }] },
  { id: "long", label: "长视频", durations: [{ label: "15分钟", value: 900 }, { label: "20分钟", value: 1200 }, { label: "30分钟", value: 1800 }, { label: "45分钟", value: 2700 }, { label: "60分钟", value: 3600 }] },
  { id: "course", label: "课程", durations: [{ label: "10分钟", value: 600 }, { label: "20分钟", value: 1200 }, { label: "30分钟", value: 1800 }, { label: "45分钟", value: 2700 }, { label: "60分钟", value: 3600 }, { label: "90分钟", value: 5400 }, { label: "120分钟", value: 7200 }] },
  { id: "live", label: "直播", durations: [{ label: "30分钟", value: 1800 }, { label: "60分钟", value: 3600 }, { label: "90分钟", value: 5400 }, { label: "120分钟", value: 7200 }, { label: "180分钟", value: 10800 }] },
  { id: "talk", label: "分享会", durations: [{ label: "30分钟", value: 1800 }, { label: "45分钟", value: 2700 }, { label: "60分钟", value: 3600 }, { label: "90分钟", value: 5400 }, { label: "120分钟", value: 7200 }] },
];

const PLATFORM_OPTIONS = ["抖音", "小红书", "B站", "视频号"];
const GOAL_OPTIONS = ["涨粉", "引流", "转化", "建立信任", "教学"];
const VIDEO_TYPE_OPTIONS = ["口播", "教程", "案例拆解", "观点输出", "工具演示", "剧情"];
const toSelectOptions = (items: string[]): SelectOption[] => items.map(item => ({ value: item, label: item }));

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[14px] border border-[#E5E4DE] bg-white p-5 ${className}`}>{children}</div>;
}

function SectionHead({ num, children }: { num: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1C1C1B] text-[11px] font-bold text-white">{num}</span>
      <h3 className="text-[14.5px] font-bold text-[#1C1C1B]">{children}</h3>
    </div>
  );
}

function ApiStatusPanel({ meta }: { meta: ApiMeta | null }) {
  if (!meta) return null;
  return (
    <div className="mb-6 rounded-[14px] border border-[#E5E4DE] bg-[#FAFAF8] p-4 font-mono text-[12px]">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#888]">API调用状态（调试）</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div><span className="text-[#999]">apiCalled: </span><span className={meta.apiCalled ? "font-bold text-[#3B6D11]" : "font-bold text-[#A32D2D]"}>{String(meta.apiCalled)}</span></div>
        <div><span className="text-[#999]">mockHit: </span><span className="font-bold text-[#3B6D11]">{String(meta.mockHit)}</span></div>
        <div><span className="text-[#999]">model: </span><span className="text-[#333]">{meta.model ?? "-"}</span></div>
        <div><span className="text-[#999]">ipUsed: </span><span className="text-[#333]">{meta.ipUsed ?? "-"}</span></div>
        <div className="col-span-2 sm:col-span-1"><span className="text-[#999]">calledAt: </span><span className="text-[#333]">{meta.calledAt}</span></div>
      </div>
      {meta.error && <div className="mt-2 rounded-[8px] bg-[#FCEBEB] px-2.5 py-1.5 text-[#A32D2D]">error: {meta.error}</div>}
    </div>
  );
}

function IPContextModal({ ip, onClose }: { ip: IPProfile; onClose: () => void }) {
  const block = buildIPContextBlock(ip);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-[620px] overflow-y-auto rounded-[18px] bg-white p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-[#1C1C1B]">
          <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: ip.color }}>{ip.avatar}</span>
          「{ip.name}」当前模块实际使用的IP上下文
        </div>
        <p className="mb-4 text-[12px] text-[#999]">
          下面这段文字会被原样拼接进发给DeepSeek的每一次调用里，和「IP身份中心」测试按钮里看到的完全一致。
        </p>
        <pre className="whitespace-pre-wrap rounded-[12px] bg-[#F7F6F2] p-4 text-[12px] leading-6 text-[#333]">{block}</pre>
        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[13px] font-semibold text-white">关闭</button>
        </div>
      </div>
    </div>
  );
}

// ── 结果展示：outline按通用结构渲染，标签随内容形式动态变化 ──
function ResultView({
  data,
  compact = false,
  draftSavedAt = null,
  onClearDraft,
}: {
  data: ScriptResult;
  compact?: boolean;
  draftSavedAt?: string | null;
  onClearDraft?: () => void;
}) {
  if (data.outputMode === "shuimuran-confirmed") {
    const fullScript = data.outline.map(section => section.content).join("\n\n");
    const pendingVerification = data.pendingVerification ?? [];
    return (
      <div className="flex flex-col gap-5">
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">标题：</div>
          <div className="rounded-[10px] bg-[#F7F6F2] p-3 text-[13.5px] font-semibold text-[#1C1C1B]">
            {data.titles[0]?.title ?? ""}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">完整口播文案：</div>
          <div className="whitespace-pre-wrap rounded-[10px] border border-[#F0EFE9] p-4 text-[13px] leading-7 text-[#333]">
            {fullScript}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">待核验内容：</div>
          {pendingVerification.length > 0 ? (
            <ul className="list-disc rounded-[10px] bg-[#FFF8DC] px-8 py-3 text-[12.5px] leading-6 text-[#755700]">
              {pendingVerification.map((item, index) => <li key={index}>{item}</li>)}
            </ul>
          ) : (
            <div className="rounded-[10px] bg-[#F7F6F2] p-3 text-[12.5px] text-[#666]">无</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {data.evidenceAudit && (
        <div className="rounded-[12px] border border-[#C8F04A] bg-[#FBFEF2] p-4">
          <div className="text-[12.5px] font-bold text-[#3B6D11]">本次脚本观点来源</div>
          <p className="mt-1 text-[12px] leading-5 text-[#555]">{data.evidenceAudit.reason}</p>
          <div className="mt-2 flex flex-col gap-2">
            {data.evidenceAudit.sourceReferences.map(reference => (
              <div key={`${reference.sourceId}-${reference.itemId}`} className="rounded-[9px] bg-white px-3 py-2 text-[12px] leading-5 text-[#444]">
                <span className="font-semibold">【老师明确表达】《{reference.sourceTitle}》：</span>{reference.originalExcerpt}
              </div>
            ))}
            {data.evidenceAudit.caseEvidence && (
              <div className="rounded-[9px] bg-white px-3 py-2 text-[12px] leading-5 text-[#444]">
                <span className="font-semibold">【案例／事实补充】{data.evidenceAudit.caseEvidence.title}</span>
                <span className="ml-2 text-[#A36C16]">{data.evidenceAudit.caseEvidence.sourceType}·{data.evidenceAudit.caseEvidence.verificationStatus}</span>
              </div>
            )}
          </div>
        </div>
      )}
      {data.generationStatus === "partial" && data.partialFailure && (
        <div className="rounded-[12px] border border-[#E8C96A] bg-[#FFF8DC] p-4 text-[#755700]">
          <div className="text-[13px] font-bold">核心脚本已保留，补充内容未完成</div>
          <p className="mt-1 text-[12.5px] leading-5">{data.partialFailure.message}</p>
          {draftSavedAt && (
            <p className="mt-1 text-[11.5px] text-[#8A6B13]">
              已自动保存为本地临时草稿，刷新或离开后仍可恢复。
            </p>
          )}
          {onClearDraft && (
            <button
              type="button"
              onClick={onClearDraft}
              className="mt-2 rounded-[8px] border border-[#D8B94F] bg-white px-3 py-1.5 text-[11.5px] font-semibold text-[#755700]"
            >
              清除临时草稿
            </button>
          )}
        </div>
      )}

      {data.qualityCheck && data.qualityCheck.status !== "passed" && (
        <div className="rounded-[12px] border border-[#E8C96A] bg-[#FFF8DC] p-4 text-[#755700]">
          <div className="text-[13px] font-bold">
            {data.qualityCheck.status === "unavailable" ? "自动论证复核未完成" : "脚本质量提示"}
          </div>
          {data.qualityCheck.message && (
            <p className="mt-1 text-[12.5px] leading-5">{data.qualityCheck.message}</p>
          )}
          {data.qualityCheck.warnings.map((warning, index) => (
            <div key={`${warning.code}-${warning.sectionLabel}-${index}`} className="mt-2 rounded-[9px] bg-white/70 p-3">
              <div className="text-[12.5px] font-bold">{warning.title} · {warning.sectionLabel}</div>
              <p className="mt-1 text-[12px] leading-5 text-[#6B5512]">原文：{warning.excerpt}</p>
              <p className="mt-1 text-[12px] leading-5 text-[#6B5512]">{warning.message}</p>
            </div>
          ))}
          <p className="mt-2 text-[11.5px] text-[#8A6B13]">
            脚本仍可继续查看和使用，建议正式发布前完成核对。
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#999]">
        <span className="rounded-full bg-[#F2F1ED] px-2 py-1 font-semibold text-[#555]">{data.formatLabel}</span>
        <span className="rounded-full bg-[#F2F1ED] px-2 py-1">{data.durationLabel}</span>
        <span className="rounded-full bg-[#F2F1ED] px-2 py-1">{data.platform}</span>
      </div>

      {data.ipStyleExplanation && (
        <div className="rounded-[10px] border border-[#C8F04A] bg-[#FBFEF2] p-3">
          <div className="mb-1 text-[11px] font-bold text-[#639922]">这次生成如何体现「{data.ipName}」的特征</div>
          <p className="text-[12.5px] leading-5 text-[#444]">{data.ipStyleExplanation}</p>
        </div>
      )}

      <div>
        <div className="mb-2 text-[12px] font-bold text-[#888]">视频标题（{data.titles.length}个）</div>
        <div className="flex flex-col gap-2">
          {data.titles.slice(0, compact ? 3 : undefined).map((t, i) => (
            <div key={i} className="rounded-[10px] bg-[#F7F6F2] p-3">
              <div className="flex flex-wrap items-center gap-2">
                {t.role && <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${t.recommended ? "bg-[#1C1C1B] text-white" : "bg-white text-[#777]"}`}>{t.role}{t.recommended ? "·推荐" : ""}</span>}
                <div className="text-[13.5px] font-semibold text-[#1C1C1B]">{t.title}</div>
              </div>
              {!compact && (
                <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-[#888]">
                  <span className="rounded-full bg-[#EAF3DE] px-2 py-0.5 text-[#3B6D11]">{t.formula}</span>
                  <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5">{t.platform}</span>
                  <span>{t.whyFitsIP}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {!compact && (
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">{data.outputLabels.cover}</div>
          <div className="flex flex-wrap gap-2">
            {data.coverCopy.map((c, i) => <span key={i} className="rounded-[10px] bg-[#FBF3D6] px-3 py-2 text-[13px] font-semibold text-[#7A5C00]">{c}</span>)}
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 text-[12px] font-bold text-[#888]">{data.outputLabels.outline}（{data.outline.length}个阶段）</div>
        <div className="flex flex-col gap-2">
          {(compact ? data.outline.slice(0, 3) : data.outline).map((seg, i) => (
            <div key={i} className="rounded-[10px] border border-[#F0EFE9] p-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[11px] font-bold text-[#639922]">{seg.label}</span>
                <span className="text-[10.5px] text-[#AAA]">{seg.timeRange}</span>
              </div>
              <p className="text-[13px] leading-6 text-[#333]">{seg.content}</p>
              {!compact && seg.subPoints && seg.subPoints.length > 0 && (
                <ul className="mt-2 list-disc pl-4 text-[12px] leading-5 text-[#666]">
                  {seg.subPoints.map((sp, j) => <li key={j}>{sp}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>

      {!compact && data.storyboard.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">分镜脚本</div>
          <div className="overflow-x-auto rounded-[10px] border border-[#F0EFE9]">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-[#F7F6F2] text-left text-[#888]">
                  {["时间", "画面", "口播", "字幕", "镜头", "素材", "剪辑建议"].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.storyboard.map((row, i) => (
                  <tr key={i} className="border-t border-[#F0EFE9] align-top">
                    <td className="px-3 py-2 font-semibold text-[#1C1C1B]">{row.time}</td>
                    <td className="px-3 py-2">{row.scene}</td>
                    <td className="px-3 py-2 text-[#666]">{row.voiceover}</td>
                    <td className="px-3 py-2 text-[#666]">{row.subtitle}</td>
                    <td className="px-3 py-2">{row.shot}</td>
                    <td className="px-3 py-2 text-[#666]">{row.material}</td>
                    <td className="px-3 py-2 text-[#666]">{row.editingTip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.shootingSuggestions.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">{data.outputLabels.shooting}</div>
          <ul className="list-disc pl-5 text-[13px] leading-6 text-[#444]">
            {(compact ? data.shootingSuggestions.slice(0, 3) : data.shootingSuggestions).map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}

      {!compact && data.shotPrompts.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">镜头提示词</div>
          <div className="flex flex-col gap-2">
            {data.shotPrompts.map((s, i) => (
              <div key={i} className="rounded-[10px] bg-[#F7F6F2] p-3 text-[12.5px]">
                <span className="font-semibold text-[#1C1C1B]">{s.scene}：</span>
                <span className="text-[#666]">{s.prompt}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!compact && (
        data.editingRhythm.subtitleHighlights.length + data.editingRhythm.soundEffects.length +
        data.editingRhythm.screenRecordingCuts.length + data.editingRhythm.caseInserts.length + data.editingRhythm.pauses.length > 0
      ) && (
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">剪辑节奏建议</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              { label: "字幕放大", items: data.editingRhythm.subtitleHighlights },
              { label: "音效", items: data.editingRhythm.soundEffects },
              { label: "切录屏", items: data.editingRhythm.screenRecordingCuts },
              { label: "插入案例", items: data.editingRhythm.caseInserts },
              { label: "停顿", items: data.editingRhythm.pauses },
            ].filter(g => g.items.length > 0).map((g, i) => (
              <div key={i} className="rounded-[10px] bg-[#F7F6F2] p-3">
                <div className="mb-1 text-[11px] font-bold text-[#888]">{g.label}</div>
                <ul className="list-disc pl-4 text-[12.5px] leading-5 text-[#444]">
                  {g.items.map((it, j) => <li key={j}>{it}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 text-[12px] font-bold text-[#888]">{data.outputLabels.comment}</div>
        <div className="flex flex-col gap-2 text-[13px] leading-6 text-[#444]">
          <div><span className="font-semibold text-[#1C1C1B]">互动引导：</span>{data.commentGuidance.interactionPrompt}</div>
          {!compact && data.commentGuidance.keywordReplies.map((kr, i) => (
            <div key={i}><span className="font-semibold text-[#1C1C1B]">「{kr.keyword}」→</span>{kr.reply}</div>
          ))}
          {!compact && <div><span className="font-semibold text-[#1C1C1B]">私信引导：</span>{data.commentGuidance.dmGuidance}</div>}
          <div><span className="font-semibold text-[#1C1C1B]">下一步引导：</span>{data.commentGuidance.materialPackGuidance}</div>
        </div>
      </div>
    </div>
  );
}

// ── 参考知识面板：topic停止变化后自动检索知识库 ──
interface KnowledgeRef { id: string; reason: string; relevanceTier: string; relevanceReason: string; entry: KnowledgeEntry }
const REL_COLOR: Record<string, { bg: string; text: string }> = {
  "高度相关": { bg: "#EAF3DE", text: "#3B6D11" }, "中度相关": { bg: "#FBF3D6", text: "#7A5C00" }, "低度相关": { bg: "#F2F1ED", text: "#888" },
};
function KnowledgePanel({ loading, refs, searched }: { loading: boolean; refs: KnowledgeRef[]; searched: boolean }) {
  if (!loading && !searched) return null;
  return (
    <div className="mb-6 rounded-[16px] border border-[#E5E4DE] bg-white p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-[13px] font-bold text-[#1C1C1B]">【参考知识】</span>
        <span className="text-[11px] text-[#999]">系统自动检索知识库，定性相关度档位，不编造精确相似度数字</span>
      </div>
      {loading && <div className="text-[12.5px] text-[#888]">检索中…</div>}
      {!loading && refs.length === 0 && <div className="text-[12.5px] text-[#999]">知识库里没有找到强相关的参考，将仅依靠模型自身判断。</div>}
      {!loading && refs.length > 0 && (
        <div className="flex flex-col gap-2">
          {refs.map(r => (
            <div key={r.id} className="rounded-[10px] bg-[#F7F6F2] p-2.5">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-[12px] font-semibold text-[#1C1C1B]">[{r.entry.category}] {r.entry.title}</span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: (REL_COLOR[r.relevanceTier] ?? REL_COLOR["低度相关"]).bg, color: (REL_COLOR[r.relevanceTier] ?? REL_COLOR["低度相关"]).text }}>{r.relevanceTier}</span>
              </div>
              <p className="text-[11.5px] leading-5 text-[#555]">引用原因：{r.reason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ScriptFactoryPage() {
  const { activeIP, loading: ipLoading } = useIP();
  const [generationMode, setGenerationMode] = useState<GenerationMode>("standard");
  const [topic, setTopic] = useState("");
  const [angle, setAngle] = useState("");
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverage, setCoverage] = useState<CoverageAssessment | null>(null);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [caseDecision, setCaseDecision] = useState<CaseDecision | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [manualCaseTitle, setManualCaseTitle] = useState("");
  const [manualCaseContent, setManualCaseContent] = useState("");
  const [manualCaseSource, setManualCaseSource] = useState("");
  const [manualCaseVerified, setManualCaseVerified] = useState(false);
  const [evidenceConfirmed, setEvidenceConfirmed] = useState(false);
  const [showInterviewOutline, setShowInterviewOutline] = useState(false);
  const [knowledgeRefs, setKnowledgeRefs] = useState<KnowledgeRef[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeSearched, setKnowledgeSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (topic.trim().length < 5) { setKnowledgeSearched(false); setKnowledgeRefs([]); return; }
    debounceRef.current = setTimeout(() => { searchKnowledge(topic); }, 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, activeIP?.id]);

  async function searchKnowledge(query: string) {
    const allEntries = getKnowledgeEntries().filter(e => {
      if (e.ipId && e.ipId !== activeIP?.id) return false;
      const category = getNormalizedCategory(e);
      // 原始内容只通过“观点覆盖度→引用确认”进入生成，不能混入通用方法检索。
      if (category === "IP原始内容") return false;
      return isGlobalMethodCategory(category) || isIPKnowledgeCategory(category);
    });
    if (allEntries.length === 0) { setKnowledgeSearched(true); setKnowledgeRefs([]); return; }
    setKnowledgeLoading(true); setKnowledgeSearched(true);
    try {
      const res = await apiFetch("/api/knowledge-search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          entries: allEntries.map(e => ({
            id: e.id,
            category: getNormalizedCategory(e),
            normalizedCategory: getNormalizedCategory(e),
            title: e.title,
            tags: e.tags,
            keywords: e.keywords,
            rawContent: e.rawContent,
            summary: e.note,
            referenceReason: e.sourceTierReason,
            metadata: { contentDirection: e.contentDirection, sourcePlatform: e.sourcePlatform },
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setKnowledgeRefs([]); return; }
      const entryMap = new Map(allEntries.map(e => [e.id, e]));
      const refs: KnowledgeRef[] = (data.results ?? [])
        .map((r: { id: string; reason: string; relevanceTier: string; relevanceReason: string }) => { const entry = entryMap.get(r.id); return entry ? { ...r, entry } : null; })
        .filter((r: KnowledgeRef | null): r is KnowledgeRef => r !== null);
      setKnowledgeRefs(refs);
      refs.forEach(r => {
        recordKnowledgeUsage(r.id, {
          module: "脚本工厂", usedAt: new Date().toISOString(),
          reason: r.reason, relevanceTier: r.relevanceTier as "高度相关" | "中度相关" | "低度相关",
          relevanceReason: r.relevanceReason, context: query,
        }, "已用于脚本");
      });
    } catch { setKnowledgeRefs([]); } finally { setKnowledgeLoading(false); }
  }
  const [platform, setPlatform] = useState("抖音");
  const [formatCategory, setFormatCategory] = useState("short");
  const [duration, setDuration] = useState(60);
  const [goal, setGoal] = useState("建立信任");
  const [videoType, setVideoType] = useState("口播");
  const [needsStoryboard, setNeedsStoryboard] = useState(true);
  const [needsShootingTips, setNeedsShootingTips] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [apiMeta, setApiMeta] = useState<ApiMeta | null>(null);
  const [partialDraftSavedAt, setPartialDraftSavedAt] = useState<string | null>(null);
  const [draftStorageError, setDraftStorageError] = useState<string | null>(null);
  const [linkedTopic, setLinkedTopic] = useState<TopicAsset | null>(null);

  const currentFormat = FORMAT_CATEGORIES.find(f => f.id === formatCategory) ?? FORMAT_CATEGORIES[0];
  const caseCandidates = getKnowledgeEntries().filter(entry => {
    if (entry.ipId && entry.ipId !== activeIP?.id) return false;
    const category = getNormalizedCategory(entry);
    return category === "爆款案例" || category === "选题案例" || category === "IP历史内容" || category === "IP高表现内容";
  });
  const selectedKnowledgeCase = caseCandidates.find(entry => entry.id === selectedCaseId) ?? null;
  const isShuimuranDedicatedMode = shouldUseShuimuranDirector({
    generationMode,
    ipName: activeIP?.name,
    profileId: activeIP?.scriptDirectorProfileId,
  });
  const permission = resolveGenerationPermission(coverage, caseDecision, evidenceConfirmed);
  const canGenerate = generationMode === "standard" || permission.allowed;

  function switchGenerationMode(nextMode: GenerationMode) {
    setGenerationMode(nextMode);
    setError(null);
    setResult(null);
    setApiMeta(null);
    setPartialDraftSavedAt(null);
  }

  function getCoverageSources(): CoverageSourceReference[] {
    if (!activeIP) return [];
    return getKnowledgeEntries("IP原始内容")
      .filter(entry => entry.ipId === activeIP.id)
      .flatMap(entry => (entry.sourceAnalysis?.items ?? []).map(item => ({
        sourceId: entry.id,
        sourceTitle: entry.title,
        itemId: item.id,
        kind: item.kind,
        content: item.content,
        originalExcerpt: item.originalExcerpt,
        extractionStatus: item.extractionStatus,
      })));
  }

  useEffect(() => {
    setCoverage(null);
    setCoverageError(null);
    setCaseDecision(null);
    setSelectedCaseId("");
    setManualCaseTitle("");
    setManualCaseContent("");
    setManualCaseSource("");
    setManualCaseVerified(false);
    setEvidenceConfirmed(false);
    setShowInterviewOutline(false);
  }, [topic, angle, activeIP?.id, generationMode]);

  async function handleCoverageCheck() {
    if (!topic.trim()) { setCoverageError("请先填写选题"); return; }
    if (!activeIP) { setCoverageError("请先在「IP身份中心」选择当前操盘IP"); return; }
    setCoverageLoading(true);
    setCoverageError(null);
    setCoverage(null);
    setCaseDecision(null);
    setEvidenceConfirmed(false);
    try {
      const response = await apiFetch("/api/script-factory/coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          angle: angle.trim(),
          sources: getCoverageSources(),
        }),
      });
      const data = await response.json() as { assessment?: CoverageAssessment; error?: string };
      if (!response.ok || !data.assessment) throw new Error(data.error ?? "观点覆盖度分析失败");
      setCoverage(data.assessment);
      if (data.assessment.caseNeed === "NOT_NEEDED") setCaseDecision("skip");
    } catch (coverageFailure) {
      setCoverageError(coverageFailure instanceof Error ? coverageFailure.message : "观点覆盖度分析失败");
    } finally {
      setCoverageLoading(false);
    }
  }

  function confirmEvidence() {
    if (!coverage || coverage.coverage !== "FULL") return;
    if (coverage.caseNeed === "REQUIRED" && !caseDecision) {
      setCoverageError("这个立意需要案例，请先从知识库选择或人工补充。 ");
      return;
    }
    if (caseDecision === "knowledge" && !selectedKnowledgeCase) {
      setCoverageError("请先选择一条案例。 ");
      return;
    }
    if (caseDecision === "manual" && !manualCaseContent.trim()) {
      setCoverageError("请填写案例内容。 ");
      return;
    }
    if (
      isShuimuranDedicatedMode &&
      caseDecision === "knowledge" &&
      selectedKnowledgeCase?.sourceTier !== "高"
    ) {
      setCoverageError("这条案例还没有可靠来源，不能进入水木然正式口播稿。请更换案例。 ");
      return;
    }
    if (
      isShuimuranDedicatedMode &&
      caseDecision === "manual" &&
      (!manualCaseSource.trim() || !manualCaseVerified)
    ) {
      setCoverageError("请补充案例来源，并确认你已经核对原始来源与事实。 ");
      return;
    }
    setCoverageError(null);
    setEvidenceConfirmed(true);
  }

  function handleFormatChange(id: string) {
    setFormatCategory(id);
    const fc = FORMAT_CATEGORIES.find(f => f.id === id);
    if (fc) setDuration(fc.durations[0].value);
  }

  useEffect(() => {
    if (activeIP && activeIP.platforms.length > 0 && !activeIP.platforms.includes(platform)) {
      setPlatform(activeIP.platforms[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIP?.id]);

  function restorePartialDraft(
    draft: PartialScriptDraft<ScriptResult>,
    expectedIPId: string,
  ): string | null {
    if (draft.ipId !== expectedIPId || draft.result.ipId !== expectedIPId) {
      return "本地临时草稿数据不完整，已停止自动恢复。";
    }
    const settings = draft.generationSettings;
    setGenerationMode(settings.generationMode ?? draft.result.generationMode ?? "standard");
    setTopic(draft.topic);
    setPlatform(settings.platform);
    setFormatCategory(settings.formatCategory);
    setDuration(settings.durationSeconds);
    setGoal(settings.goal);
    setVideoType(settings.videoType);
    setNeedsStoryboard(settings.needsStoryboard);
    setNeedsShootingTips(settings.needsShootingTips);
    setResult(draft.result);
    setApiMeta(draft.result.apiMeta);
    setPartialDraftSavedAt(draft.savedAt);
    setLinkedTopic(null);
    if (draft.topicId) {
      try {
        setLinkedTopic(resolveTopicForScript(draft.topicId, draft.ipId));
      } catch {
        return "临时草稿已恢复，但原关联选题已失效，本次不会继续建立选题关联。";
      }
    }
    return null;
  }

  function restoreSavedScript(script: ScriptAsset, expectedIPId: string): string | null {
    if (script.ipId !== expectedIPId) {
      return "保存的脚本所属IP与当前操盘IP不一致，已停止恢复。";
    }
    const savedResult = normalizeStoredCompleteScriptResult(script.scriptResult);
    if (!savedResult) {
      return "保存的脚本数据不完整，无法恢复到脚本工厂。";
    }
    if (savedResult.ipId !== expectedIPId) {
      return "保存的脚本所属IP与当前操盘IP不一致，已停止恢复。";
    }
    setGenerationMode(savedResult.generationMode ?? "standard");
    setTopic(savedResult.topic || script.title);
    setPlatform(savedResult.platform);
    setFormatCategory(savedResult.formatCategory);
    setDuration(savedResult.durationSeconds);
    setGoal(savedResult.goal);
    setVideoType(savedResult.videoType);
    setNeedsStoryboard(savedResult.storyboard.length > 0);
    setNeedsShootingTips(savedResult.shootingSuggestions.length > 0 || savedResult.shotPrompts.length > 0);
    setResult(savedResult);
    setApiMeta(savedResult.apiMeta);
    setPartialDraftSavedAt(null);
    setLinkedTopic(null);
    if (script.topicId) {
      try {
        setLinkedTopic(resolveTopicForScript(script.topicId, expectedIPId));
      } catch {
        // 已保存脚本仍可查看；原选题失效不应阻断脚本恢复。
      }
    }
    return null;
  }

  useEffect(() => {
    setLinkedTopic(null);
    setResult(null);
    setApiMeta(null);
    setPartialDraftSavedAt(null);
    if (!activeIP) {
      return;
    }
    const draft = getPartialScriptDraft(activeIP.id);
    if (draft && isStoredScriptResult(draft.result)) {
      setDraftStorageError(restorePartialDraft(draft as PartialScriptDraft<ScriptResult>, activeIP.id));
    }
    else {
      setDraftStorageError(draft ? "本地临时草稿数据不完整，已停止自动恢复。" : null);
    }
    setError(null);
    // 仅在切换IP时恢复该IP自己的临时草稿。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIP?.id]);

  useEffect(() => {
    if (ipLoading || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const scriptId = params.get("scriptId");
    const topicId = params.get("topicId");
    if (!scriptId && !topicId) return;
    if (!activeIP) {
      setLinkedTopic(null);
      setResult(null);
      setError("需要先选择对应的当前操盘IP，才能恢复这条内容。");
      return;
    }

    if (scriptId) {
      setLinkedTopic(null);
      setTopic("");
      setResult(null);
      setApiMeta(null);
      setPartialDraftSavedAt(null);
      const script = getScriptAssets(activeIP.id).find(asset => asset.id === scriptId);
      if (!script) {
        setError("没有找到这条脚本，或脚本不属于当前操盘IP。");
        return;
      }
      const restoreError = restoreSavedScript(script, activeIP.id);
      setDraftStorageError(restoreError);
      setError(restoreError);
      return;
    }

    try {
      const asset = resolveTopicForScript(topicId!, activeIP.id);
      const currentDraft = getPartialScriptDraft(activeIP.id);
      if (currentDraft?.topicId?.trim() !== asset.id) {
        setResult(null);
        setApiMeta(null);
        setPartialDraftSavedAt(null);
      }
      setTopic(asset.title);
      setLinkedTopic(asset);
      setError(null);
    } catch (linkError) {
      setLinkedTopic(null);
      setError(
        linkError instanceof TopicScriptLinkError
          ? linkError.message
          : "读取关联选题失败，请返回选题库重试。",
      );
    }
  }, [activeIP?.id, ipLoading]);

  function handleClearPartialDraft() {
    if (!activeIP) return;
    if (!clearPartialScriptDraft(activeIP.id)) {
      setDraftStorageError("浏览器未允许清除本地临时草稿，请检查站点存储权限。");
      return;
    }
    setResult(current => current?.generationStatus === "partial" ? null : current);
    setPartialDraftSavedAt(null);
    setDraftStorageError(null);
  }

  async function generateFor(ip: IPProfile, t: string) {
    let res: Response;
    try {
      res = await apiFetch("/api/script-factory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationMode,
          ipProfile: ip, topic: t,
          styleProfile: getStyleProfile(ip.id) ?? null,
          platform: ip.platforms.includes(platform) ? platform : (ip.platforms[0] || "抖音"),
          formatCategory, durationSeconds: duration, goal, videoType,
          needsStoryboard, needsShootingTips,
          evidenceGate: generationMode === "ip" && coverage ? {
            coverage: coverage.coverage,
            reason: coverage.reason,
            sourceReferences: coverage.sourceReferences,
            caseNeed: coverage.caseNeed,
            caseDecision,
            evidenceConfirmed,
            caseEvidence: caseDecision === "knowledge" && selectedKnowledgeCase ? {
              title: selectedKnowledgeCase.title,
              content: selectedKnowledgeCase.rawContent,
              sourceType: "知识库",
              verificationStatus: selectedKnowledgeCase.sourceTier === "高" ? "有明确来源" : "未核实",
              sourceUrl: selectedKnowledgeCase.sourceUrl,
            } : caseDecision === "manual" ? {
              title: manualCaseTitle.trim() || "人工补充案例",
              content: manualCaseContent.trim(),
              sourceType: "用户提供",
              verificationStatus: manualCaseVerified ? "人工已核实" : "未经系统核验",
              sourceUrl: manualCaseSource.trim(),
            } : null,
          } : null,
          voiceSamples: getKnowledgeEntries("IP表达语料")
            .filter(entry => entry.ipId === ip.id)
            .slice(0, 5)
            .map(entry => ({
              id: entry.id,
              title: entry.title,
              rawText: entry.rawContent,
              type: "IP表达语料",
            })),
          knowledgeRefs: knowledgeRefs.map(ref => ({
            id: ref.id,
            title: ref.entry.title,
            category: getNormalizedCategory(ref.entry),
            rawContent: ref.entry.rawContent,
            reason: ref.reason,
          })),
        }),
      });
    } catch (networkErr) {
      const msg = `网络错误：无法连接到 /api/script-factory，请确认开发服务器（npm run dev）正在运行（${networkErr instanceof Error ? networkErr.message : String(networkErr)}）`;
      setApiMeta({ apiCalled: false, calledAt: new Date().toISOString(), model: null, ipUsed: ip.name, mockHit: false, error: msg });
      throw new Error(msg);
    }

    let data: (ScriptResult & { error?: string }) | { error: string; apiMeta?: ApiMeta };
    try {
      data = await res.json();
    } catch (parseErr) {
      const msg = `JSON解析错误：服务器返回的不是合法JSON（HTTP ${res.status}），可能是服务端报错页面而不是API响应（${parseErr instanceof Error ? parseErr.message : String(parseErr)}）`;
      setApiMeta({ apiCalled: true, calledAt: new Date().toISOString(), model: null, ipUsed: ip.name, mockHit: false, error: msg });
      throw new Error(msg);
    }

    if ("apiMeta" in data && data.apiMeta) setApiMeta(data.apiMeta);

    if (!res.ok) {
      const errMsg = "error" in data && data.error ? data.error : `HTTP ${res.status}`;
      throw new Error(`${ip.name}：API返回错误（HTTP ${res.status}）：${errMsg}`);
    }
    return data as ScriptResult;
  }

  async function handleGenerate() {
    if (!topic.trim()) { setError("请输入视频选题"); return; }
    if (!activeIP) { setError("请先在「IP身份中心」选择一个当前操盘IP"); return; }
    if (generationMode === "ip" && !permission.allowed) { setError(permission.reason); return; }
    const requestIP = activeIP;
    const requestedTopic = topic.trim();
    let linkedTopicAtRequest: TopicAsset | null = null;
    try {
      if (getActiveIPId() !== requestIP.id) {
        throw new Error("当前操盘IP刚刚发生变化，请确认后重新生成。");
      }
      if (linkedTopic) {
        linkedTopicAtRequest = resolveTopicForScript(linkedTopic.id, requestIP.id);
      }
    } catch (ownershipError) {
      setError(ownershipError instanceof Error ? ownershipError.message : "选题与当前IP校验失败，请重试。");
      return;
    }
    setError(null); setDraftStorageError(null); setResult(null); setPartialDraftSavedAt(null); setLoading(true);
    try {
      const data = await generateFor(requestIP, requestedTopic);
      if (data.ipId !== requestIP.id) {
        throw new Error("接口返回的脚本IP与发起请求时的IP不一致，已停止保存。");
      }
      if (getActiveIPId() !== requestIP.id) {
        throw new Error("生成期间当前操盘IP已切换，结果未保存；请切回原IP后重新生成。");
      }
      if (linkedTopicAtRequest) {
        linkedTopicAtRequest = resolveTopicForScript(linkedTopicAtRequest.id, requestIP.id);
      }
      setResult(data);
      if (data.generationStatus === "partial") {
        if (!data.partialFailure) {
          throw new Error("部分成功响应缺少失败阶段信息，无法安全保存临时草稿");
        }
        const savedAt = new Date().toISOString();
        const saved = savePartialScriptDraft<ScriptResult>({
          version: 1,
          ipId: requestIP.id,
          topicId: linkedTopicAtRequest?.id,
          topic: requestedTopic,
          savedAt,
          failedStage: data.partialFailure.stage,
          warning: data.partialFailure.message,
          generationSettings: {
            generationMode,
            platform,
            formatCategory,
            durationSeconds: duration,
            goal,
            videoType,
            needsStoryboard,
            needsShootingTips,
          },
          result: data,
        });
        if (saved) setPartialDraftSavedAt(savedAt);
        else {
          setDraftStorageError("核心脚本可以继续查看，但浏览器未能自动保存临时草稿。刷新或离开前请先复制内容。");
        }
      } else {
        const scriptInput = {
          ipId: requestIP.id,
          title: data.titles?.find(item => item.recommended)?.title || data.titles?.[0]?.title || topic,
          cover: data.coverCopy?.[0] || "",
          content: data.outline.map(o => `【${o.label}】${o.content}`).join("\n\n"),
          status: "草稿" as const,
          scriptResult: data,
        };
        if (getActiveIPId() !== requestIP.id) {
          throw new Error("保存前检测到当前操盘IP已切换，结果未保存。");
        }
        if (linkedTopicAtRequest) {
          addScriptAssetForTopic({ ...scriptInput, topicId: linkedTopicAtRequest.id });
        } else {
          addScriptAsset(scriptInput);
        }
        if (!clearPartialScriptDraft(requestIP.id)) {
          setDraftStorageError("完整脚本已保存，但浏览器未能清除旧的本地临时草稿。");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "脚本生成失败，请重试");
      if (getActiveIPId() === requestIP.id) {
        const draft = getPartialScriptDraft(requestIP.id);
        if (draft && isStoredScriptResult(draft.result)) {
          setDraftStorageError(restorePartialDraft(draft as PartialScriptDraft<ScriptResult>, requestIP.id));
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen p-6 md:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[13px] text-[#8A8A86]">
            <a href="/" className="font-semibold text-[#639922]">工作台</a> / AI IP脚本工厂
          </div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1B]">AI IP脚本工厂</h1>
          <p className="mt-1.5 max-w-[640px] text-[13.5px] leading-6 text-[#8A8A86]">
            {generationMode === "standard"
              ? "固定脚本生成保留原来的直接产出流程；需要严格依据老师原始观点时，再切换到IP专属生成。"
              : "先证明这个观点属于当前IP，再调用老师的原始内容、表达语料和必要案例组织成稿。"}
          </p>
        </div>
        <span className="whitespace-nowrap rounded-full bg-[#EAF3DE] px-3.5 py-1.5 text-[12px] font-semibold text-[#3B6D11]">02 · 脚本生成</span>
      </header>

      <>

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-[16px] border border-[#E5E4DE] bg-white p-3 sm:grid-cols-2">
        <button
          type="button"
          aria-label="固定脚本生成"
          aria-pressed={generationMode === "standard"}
          onClick={() => switchGenerationMode("standard")}
          className={`rounded-[12px] px-4 py-3 text-left transition-all ${generationMode === "standard" ? "bg-[#1C1C1B] text-white" : "bg-[#F7F6F2] text-[#555]"}`}
        >
          <div className="text-[13.5px] font-bold">固定脚本生成</div>
          <div className={`mt-1 text-[11.5px] ${generationMode === "standard" ? "text-white/70" : "text-[#888]"}`}>输入选题后直接生成固定内容包，不检查观点覆盖度。</div>
        </button>
        <button
          type="button"
          aria-label="IP专属生成"
          aria-pressed={generationMode === "ip"}
          onClick={() => switchGenerationMode("ip")}
          className={`rounded-[12px] px-4 py-3 text-left transition-all ${generationMode === "ip" ? "bg-[#1C1C1B] text-white" : "bg-[#F7F6F2] text-[#555]"}`}
        >
          <div className="text-[13.5px] font-bold">IP专属生成</div>
          <div className={`mt-1 text-[11.5px] ${generationMode === "ip" ? "text-white/70" : "text-[#888]"}`}>调用当前IP的原始内容、表达语料和专属规则。</div>
        </button>
      </div>

      {!ipLoading && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[14px] bg-[#FBF3D6] px-4 py-2.5 text-[13px] text-[#7A5C00]">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: activeIP?.color ?? "#999" }}>
              {activeIP?.avatar ?? "?"}
            </span>
            当前以 <b>{activeIP?.name ?? "未选择IP"}</b> 的人设、受众、表达风格与拍摄习惯生成内容。
            {isShuimuranDedicatedMode && (
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#639922]">水木然专属编导规则已启用</span>
            )}
          </div>
          <button onClick={() => setShowContext(true)} disabled={!activeIP} className="whitespace-nowrap rounded-[10px] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#7A5C00] disabled:opacity-50">
            查看当前IP上下文
          </button>
        </div>
      )}
      {showContext && activeIP && <IPContextModal ip={activeIP} onClose={() => setShowContext(false)} />}

      {linkedTopic && (
        <div className="mb-3 rounded-[14px] border border-[#B8D98D] bg-[#F7FCF0] px-4 py-3 text-[12.5px] text-[#3B6D11]">
          <div className="font-semibold">当前关联选题</div>
          <div className="mt-1 text-[#1C1C1B]">{linkedTopic.title}</div>
        </div>
      )}

      <ApiStatusPanel meta={apiMeta} />

      {/* 主工作流 */}
      <Card className="mb-6">
        <SectionHead num="①">{generationMode === "standard" ? "输入选题并设置产出" : "输入选题并检查观点覆盖度"}</SectionHead>
        <div className="flex flex-col gap-3">
          <textarea
            value={topic} onChange={e => setTopic(e.target.value)}
            placeholder={TOPIC_PLACEHOLDER}
            className="min-h-[52px] resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[14px] text-[#1C1C1B] outline-none focus:border-[#639922] focus:ring-2 focus:ring-[#EAF3DE]"
          />
          {generationMode === "ip" && <input
            aria-label="本次切入角度"
            value={angle}
            onChange={event => setAngle(event.target.value)}
            placeholder="本次切入角度，例如：从创作者只追求更新频率切入"
            className="rounded-[12px] border border-[#E5E4DE] bg-white px-4 py-3 text-[13.5px] text-[#1C1C1B] outline-none focus:border-[#639922]"
          />}

          {generationMode === "ip" && <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] leading-5 text-[#888]">系统只检查当前IP知识库中的“IP原始内容”，IP人设和表达风格不能代替老师的真实观点。</p>
            <button
              type="button"
              onClick={handleCoverageCheck}
              disabled={coverageLoading || !topic.trim() || !activeIP}
              className="rounded-[11px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              {coverageLoading ? "检查中…" : "检查观点覆盖度"}
            </button>
          </div>}

          {generationMode === "ip" && coverageError && <div className="rounded-[10px] bg-[#FCEBEB] px-4 py-3 text-[12.5px] text-[#A32D2D]">{coverageError}</div>}

          {generationMode === "ip" && coverage && (
            <div className="rounded-[14px] border border-[#D9E8C7] bg-[#FBFEF7] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[13px] font-bold text-[#1C1C1B]">观点覆盖度</div>
                <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${coverage.coverage === "FULL" ? "bg-[#EAF3DE] text-[#3B6D11]" : coverage.coverage === "PARTIAL" ? "bg-[#FFF0C2] text-[#7A5C00]" : "bg-[#FCEBEB] text-[#A32D2D]"}`}>
                  {coverage.coverage === "FULL" ? "充分覆盖" : coverage.coverage === "PARTIAL" ? "部分覆盖" : "没有覆盖"}
                </span>
              </div>
              <p className="mt-2 text-[13px] leading-6 text-[#444]">{coverage.reason}</p>
              {coverage.missingDimensions.length > 0 && (
                <p className="mt-2 text-[12px] text-[#8A6515]">当前缺口：{coverage.missingDimensions.join("、")}</p>
              )}
              {coverage.sourceReferences.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="text-[11.5px] font-bold text-[#639922]">找到的老师原始表达</div>
                  {coverage.sourceReferences.map(reference => (
                    <div key={`${reference.sourceId}-${reference.itemId}`} className="rounded-[10px] bg-white p-3">
                      <div className="text-[11px] font-semibold text-[#888]">《{reference.sourceTitle}》· {reference.extractionStatus}</div>
                      <p className="mt-1 text-[12.5px] leading-5 text-[#333]">{reference.originalExcerpt}</p>
                    </div>
                  ))}
                </div>
              )}

              {coverage.coverage !== "FULL" && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <a href="/knowledge-intake/original" className="rounded-[9px] bg-[#1C1C1B] px-3.5 py-2 text-[12px] font-semibold text-white">补充IP原始内容</a>
                  <button type="button" onClick={() => { setTopic(""); setAngle(""); }} className="rounded-[9px] border border-[#D9D8D2] bg-white px-3.5 py-2 text-[12px] font-semibold text-[#555]">修改选题角度</button>
                  <button type="button" onClick={() => setShowInterviewOutline(true)} className="rounded-[9px] border border-[#D9D8D2] bg-white px-3.5 py-2 text-[12px] font-semibold text-[#555]">生成采访提纲</button>
                </div>
              )}
              {showInterviewOutline && coverage.coverage !== "FULL" && (
                <div className="mt-3 rounded-[10px] bg-[#F7F6F2] p-3 text-[12.5px] leading-6 text-[#444]">
                  <div className="font-bold text-[#1C1C1B]">建议追问老师</div>
                  <div>1. 对“{topic}”，您最核心的判断是什么？</div>
                  <div>2. 您为什么这样判断？中间最关键的一层原因是什么？</div>
                  <div>3. 哪个真实经历、案例或反例最能说明这个判断？</div>
                </div>
              )}
            </div>
          )}

          {generationMode === "ip" && coverage?.coverage === "FULL" && (
            <div className="rounded-[14px] border border-[#E5E4DE] bg-white p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[13px] font-bold text-[#1C1C1B]">② 判断是否需要案例</div>
                <span className="rounded-full bg-[#F2F1ED] px-2.5 py-1 text-[11px] font-semibold text-[#555]">
                  {coverage.caseNeed === "NOT_NEEDED" ? "不需要案例" : coverage.caseNeed === "ENHANCEMENT" ? "案例可增强" : "案例为论证必需"}
                </span>
              </div>
              <p className="text-[12.5px] leading-5 text-[#555]">{coverage.caseReason}</p>
              {coverage.caseNeed !== "NOT_NEEDED" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {coverage.caseNeed === "ENHANCEMENT" && (
                    <button type="button" onClick={() => { setCaseDecision("skip"); setEvidenceConfirmed(false); }} className={`rounded-[9px] px-3 py-2 text-[12px] font-semibold ${caseDecision === "skip" ? "bg-[#1C1C1B] text-white" : "bg-[#F2F1ED] text-[#555]"}`}>本次不使用案例</button>
                  )}
                  <button type="button" onClick={() => { setCaseDecision("knowledge"); setEvidenceConfirmed(false); }} className={`rounded-[9px] px-3 py-2 text-[12px] font-semibold ${caseDecision === "knowledge" ? "bg-[#1C1C1B] text-white" : "bg-[#F2F1ED] text-[#555]"}`}>从知识库选择</button>
                  <button type="button" onClick={() => { setCaseDecision("manual"); setEvidenceConfirmed(false); }} className={`rounded-[9px] px-3 py-2 text-[12px] font-semibold ${caseDecision === "manual" ? "bg-[#1C1C1B] text-white" : "bg-[#F2F1ED] text-[#555]"}`}>人工补充案例</button>
                </div>
              )}
              {caseDecision === "knowledge" && (
                <div className="mt-3">
                  {caseCandidates.length > 0 ? (
                    <select aria-label="知识库案例" value={selectedCaseId} onChange={event => { setSelectedCaseId(event.target.value); setEvidenceConfirmed(false); }} className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 text-[12.5px]">
                      <option value="">请选择案例</option>
                      {caseCandidates.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
                    </select>
                  ) : <p className="text-[12px] text-[#888]">当前知识库暂无案例，可改用人工补充。</p>}
                </div>
              )}
              {caseDecision === "manual" && (
                <div className="mt-3 grid gap-2">
                  <input aria-label="案例名称" value={manualCaseTitle} onChange={event => { setManualCaseTitle(event.target.value); setEvidenceConfirmed(false); }} placeholder="案例人物或事件" className="rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 text-[12.5px]" />
                  <textarea aria-label="案例内容" value={manualCaseContent} onChange={event => { setManualCaseContent(event.target.value); setEvidenceConfirmed(false); }} placeholder="只填写你能确认的事实。人工提供不代表已经核实。" className="min-h-[90px] rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 text-[12.5px]" />
                  <input aria-label="案例来源" value={manualCaseSource} onChange={event => { setManualCaseSource(event.target.value); setManualCaseVerified(false); setEvidenceConfirmed(false); }} placeholder={isShuimuranDedicatedMode ? "来源链接或明确出处（必填）" : "来源链接或出处（可选）"} className="rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 text-[12.5px]" />
                  {isShuimuranDedicatedMode && (
                    <label className="flex items-start gap-2 rounded-[9px] bg-[#F7F6F2] px-3 py-2 text-[11.5px] leading-5 text-[#555]">
                      <input type="checkbox" checked={manualCaseVerified} onChange={event => { setManualCaseVerified(event.target.checked); setEvidenceConfirmed(false); }} className="mt-1" />
                      <span>我已核对案例原始来源与事实。此确认只代表人工核对，不代表系统联网核验。</span>
                    </label>
                  )}
                  <p className="text-[11.5px] text-[#A36C16]">来源状态：用户提供·{manualCaseVerified ? "人工已核实" : "未经系统核验"}。案例不能替老师生成从未表达过的核心观点。</p>
                </div>
              )}
              <div className="mt-4 flex justify-end">
                <button type="button" onClick={confirmEvidence} className="rounded-[10px] bg-[#639922] px-4 py-2.5 text-[12.5px] font-semibold text-white">确认观点依据与案例边界</button>
              </div>
              {evidenceConfirmed && <div className="mt-3 rounded-[9px] bg-[#EAF3DE] px-3 py-2 text-[12px] font-semibold text-[#3B6D11]">依据已确认，可以设置内容形式并生成。</div>}
            </div>
          )}

          {(generationMode === "standard" || evidenceConfirmed) && <KnowledgePanel loading={knowledgeLoading} refs={knowledgeRefs} searched={knowledgeSearched} />}

          {(generationMode === "standard" || evidenceConfirmed) && (<>
          <div>
            <label className="mb-1.5 block text-[11.5px] font-semibold text-[#888]">内容形式</label>
            <div className="flex flex-wrap gap-2">
              {FORMAT_CATEGORIES.map(f => (
                <button
                  key={f.id} type="button" onClick={() => handleFormatChange(f.id)}
                  className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-all"
                  style={formatCategory === f.id ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#888" }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">时长</label>
              <Select
                value={String(duration)} onChange={(v) => setDuration(Number(v))}
                options={currentFormat.durations.map((d): SelectOption => ({ value: String(d.value), label: d.label }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">发布平台</label>
              <Select
                value={platform} onChange={setPlatform}
                options={toSelectOptions(activeIP?.platforms.length ? activeIP.platforms : PLATFORM_OPTIONS)}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">内容目标</label>
              <Select value={goal} onChange={setGoal} options={toSelectOptions(GOAL_OPTIONS)} />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">内容类型</label>
              <Select value={videoType} onChange={setVideoType} options={toSelectOptions(VIDEO_TYPE_OPTIONS)} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {(formatCategory === "short" || formatCategory === "medium") && (
              <label className="flex items-center gap-2 text-[12.5px] text-[#555]">
                <input type="checkbox" checked={needsStoryboard} onChange={e => setNeedsStoryboard(e.target.checked)} />需要分镜脚本
              </label>
            )}
            <label className="flex items-center gap-2 text-[12.5px] text-[#555]">
              <input type="checkbox" checked={needsShootingTips} onChange={e => setNeedsShootingTips(e.target.checked)} />
              需要{formatCategory === "live" ? "直播间布置建议" : "拍摄/呈现建议"}
            </label>
            <button
              onClick={handleGenerate} disabled={loading || !canGenerate}
              className="ml-auto flex h-[42px] items-center gap-2 whitespace-nowrap rounded-[12px] bg-[#1C1C1B] px-7 text-[13.5px] font-semibold text-white disabled:opacity-60"
            >
              {loading ? "生成中…" : generationMode === "standard" ? "生成完整内容" : "依据确认后生成脚本"}
            </button>
          </div>
          </>)}
        </div>
      </Card>

      {error && <div className="mb-6 rounded-[14px] bg-[#FCEBEB] px-5 py-4 text-[14px] font-semibold text-[#A32D2D]">{error}</div>}
      {draftStorageError && (
        <div className="mb-6 rounded-[14px] border border-[#E8C96A] bg-[#FFF8DC] px-5 py-4 text-[13px] font-semibold text-[#755700]">
          {draftStorageError}
        </div>
      )}
      {loading && (
        <div className="py-16 text-center text-[#8A8A86]">
          <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-4 border-[#EAF3DE] border-t-[#639922]" />
          <div className="text-[14px]">正在代入「{activeIP?.name}」的人设生成「{currentFormat.label}」内容…</div>
        </div>
      )}

      {!loading && !result && !error && (
        <div className="py-16 text-center text-[#8A8A86]">
          <h3 className="mb-2 text-[17px] font-semibold text-[#1C1C1B]">{generationMode === "standard" ? "还没有生成结果" : "先确认老师是否表达过这个观点"}</h3>
          <p className="text-[13.5px]">{generationMode === "standard" ? "输入选题、设置内容形式和时长后，即可生成完整内容包。" : "填写选题和切入角度，系统会先从当前IP的原始内容中寻找观点依据。"}</p>
        </div>
      )}

      {!loading && result && (
        <>
          <CitationSummary
            refs={knowledgeRefs}
            loading={knowledgeLoading}
            searched={knowledgeSearched}
            label="本次脚本生成参考了"
          />
          <Card>
            <SectionHead num="②">生成结果</SectionHead>
            <ResultView
              data={result}
              draftSavedAt={partialDraftSavedAt}
              onClearDraft={partialDraftSavedAt ? handleClearPartialDraft : undefined}
            />
          </Card>
        </>
      )} {/* !loading && result */}
      </>
    </div>
  );
}
