"use client";
import { apiFetch } from "@/lib/api-fetch";
import { useState, useEffect, useRef } from "react";
import { useIP } from "@/lib/ip-context";
import { getIPDisplayLabel } from "@/lib/ip-display";
import { addScriptAsset, getKnowledgeEntries, recordKnowledgeUsage, getStyleProfile } from "@/lib/ip-store";
import { IPProfile, KnowledgeEntry } from "@/lib/types";
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
} from "@/lib/script-factory-contract";

const DEMO_TOPIC = "为什么很多人装修花了很多钱，最后还是没有高级感？";
const DEMO_SCRIPT_REQUIREMENT = "请基于当前IP「设计师石空」，生成一条60秒短视频口播脚本。开头要有反常识冲突，正文从比例关系、材质关系、灯光关系三个角度拆解，语气专业、克制、有设计师判断。";

// ── Types ──
interface TitleOption { title: string; formula: string; platform: string; whyFitsIP: string; }
interface KeywordReply { keyword: string; reply: string; }
interface CommentGuidance { interactionPrompt: string; keywordReplies: KeywordReply[]; dmGuidance: string; materialPackGuidance: string; }
interface OutlineSection { label: string; timeRange: string; content: string; subPoints?: string[]; }
interface StoryboardRow { time: string; scene: string; voiceover: string; subtitle: string; shot: string; material: string; editingTip: string; }
interface ShotPrompt { scene: string; prompt: string; }
interface EditingRhythm { subtitleHighlights: string[]; soundEffects: string[]; screenRecordingCuts: string[]; caseInserts: string[]; pauses: string[]; }
interface OutputLabels { cover: string; outline: string; shooting: string; comment: string; }
interface ApiMeta { apiCalled: boolean; calledAt: string; model: string | null; ipUsed: string | null; mockHit: boolean; error?: string; }
interface ScriptResult {
  generationStatus: ScriptGenerationStatus; partialFailure: ScriptPartialFailure | null;
  ipId: string; ipName: string; topic: string; platform: string;
  formatCategory: string; formatLabel: string; durationSeconds: number; durationLabel: string; goal: string; videoType: string;
  outputLabels: OutputLabels;
  titles: TitleOption[]; coverCopy: string[]; outline: OutlineSection[]; commentGuidance: CommentGuidance;
  ipStyleExplanation: string;
  storyboard: StoryboardRow[]; shootingSuggestions: string[]; shotPrompts: ShotPrompt[]; editingRhythm: EditingRhythm;
  apiMeta: ApiMeta;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStoredScriptResult(value: unknown): value is ScriptResult {
  if (!isRecord(value) || value.generationStatus !== "partial") return false;
  const partialFailure = value.partialFailure;
  const outputLabels = value.outputLabels;
  const commentGuidance = value.commentGuidance;
  const editingRhythm = value.editingRhythm;
  const apiMeta = value.apiMeta;
  if (
    !isRecord(partialFailure) ||
    (partialFailure.stage !== "storyboard" && partialFailure.stage !== "execution") ||
    typeof partialFailure.errorCode !== "string" ||
    typeof partialFailure.message !== "string" ||
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
  return (
    <div className="flex flex-col gap-5">
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
              <div className="text-[13.5px] font-semibold text-[#1C1C1B]">{t.title}</div>
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
  const { activeIP, ips, loading: ipLoading } = useIP();
  const [topic, setTopic] = useState(DEMO_TOPIC);
  // 模式切换：engine=先走SKILL.md完整工作流；classic=现有脚本生成
  const [mode, setMode] = useState<"engine" | "classic">("classic");

  // Content Engine 状态
  const [ceGoal, setCeGoal] = useState<"traffic" | "conversion" | "persona">("traffic");
  const [ceAudience, setCeAudience] = useState("准备装修的业主、别墅大宅业主、大平层业主");
  const [ceIndustry, setCeIndustry] = useState("室内设计与全案装修");
  const [ceLoading, setCeLoading] = useState(false);
  const [ceError, setCeError] = useState<string | null>(null);
  const [ceResult, setCeResult] = useState<Record<string, any> | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [ceSelectedHook, setCeSelectedHook] = useState<number | null>(null);

  async function handleEngineGenerate() {
    if (!topic.trim()) { setCeError("请输入选题或关键词"); return; }
    setCeLoading(true); setCeError(null); setCeResult(null);
    try {
      const res = await apiFetch("/api/skill/content-engine", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic, targetAudience: ceAudience, contentGoal: ceGoal,
          industry: ceIndustry,
          ipProfile: activeIP ?? undefined,
          styleProfile: activeIP ? getStyleProfile(activeIP.id) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCeError(data.error ?? "生成失败"); return; }
      setCeResult(data);
    } catch (err) { setCeError(err instanceof Error ? err.message : "网络错误"); }
    finally { setCeLoading(false); }
  }

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

  const currentFormat = FORMAT_CATEGORIES.find(f => f.id === formatCategory) ?? FORMAT_CATEGORIES[0];

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

  function restorePartialDraft(draft: PartialScriptDraft<ScriptResult>) {
    const settings = draft.generationSettings;
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
  }

  useEffect(() => {
    if (!activeIP) {
      setResult(null);
      setApiMeta(null);
      setPartialDraftSavedAt(null);
      return;
    }
    const draft = getPartialScriptDraft(activeIP.id);
    if (draft && isStoredScriptResult(draft.result)) {
      restorePartialDraft(draft as PartialScriptDraft<ScriptResult>);
      setDraftStorageError(null);
    }
    else {
      setResult(null);
      setApiMeta(null);
      setPartialDraftSavedAt(null);
      setDraftStorageError(draft ? "本地临时草稿数据不完整，已停止自动恢复。" : null);
    }
    setError(null);
    // 仅在切换IP时恢复该IP自己的临时草稿。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIP?.id]);

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

  // ── 验收测试：同一选题，两个IP对比（使用当前表单选中的形式/时长/目标，保持条件一致） ──
  const [compareTopic, setCompareTopic] = useState(DEMO_TOPIC);
  const [compareAId, setCompareAId] = useState("");
  const [compareBId, setCompareBId] = useState("");
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareResults, setCompareResults] = useState<{ ip: IPProfile; data: ScriptResult }[] | null>(null);

  useEffect(() => {
    if (ips.length >= 2 && !compareAId && !compareBId) {
      setCompareAId(ips[0].id);
      setCompareBId(ips[1].id);
    }
  }, [ips, compareAId, compareBId]);

  async function generateFor(ip: IPProfile, t: string) {
    let res: Response;
    try {
      res = await apiFetch("/api/script-factory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ipProfile: ip, topic: t,
          styleProfile: getStyleProfile(ip.id) ?? null,
          platform: ip.platforms.includes(platform) ? platform : (ip.platforms[0] || "抖音"),
          formatCategory, durationSeconds: duration, goal, videoType,
          needsStoryboard, needsShootingTips,
          generationRequirement: DEMO_SCRIPT_REQUIREMENT,
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
    setError(null); setDraftStorageError(null); setResult(null); setPartialDraftSavedAt(null); setLoading(true);
    try {
      const data = await generateFor(activeIP, topic);
      setResult(data);
      if (data.generationStatus === "partial") {
        if (!data.partialFailure) {
          throw new Error("部分成功响应缺少失败阶段信息，无法安全保存临时草稿");
        }
        const savedAt = new Date().toISOString();
        const saved = savePartialScriptDraft<ScriptResult>({
          version: 1,
          ipId: activeIP.id,
          topic,
          savedAt,
          failedStage: data.partialFailure.stage,
          warning: data.partialFailure.message,
          generationSettings: {
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
        addScriptAsset({
          ipId: activeIP.id,
          title: data.titles?.[0]?.title || topic,
          cover: data.coverCopy?.[0] || "",
          content: data.outline.map(o => `【${o.label}】${o.content}`).join("\n\n"),
          status: "草稿",
          scriptResult: data,
        });
        if (!clearPartialScriptDraft(activeIP.id)) {
          setDraftStorageError("完整脚本已保存，但浏览器未能清除旧的本地临时草稿。");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "脚本生成失败，请重试");
      const draft = getPartialScriptDraft(activeIP.id);
      if (draft && isStoredScriptResult(draft.result)) {
        restorePartialDraft(draft as PartialScriptDraft<ScriptResult>);
      }
    } finally {
      setLoading(false);
    }
  }

  async function runCompare() {
    const ipA = ips.find(i => i.id === compareAId);
    const ipB = ips.find(i => i.id === compareBId);
    if (!compareTopic.trim()) { setCompareError("请输入测试选题"); return; }
    if (!ipA || !ipB) { setCompareError("请选择两个IP"); return; }
    if (ipA.id === ipB.id) { setCompareError("请选择两个不同的IP才能对比"); return; }
    setCompareError(null); setCompareLoading(true); setCompareResults(null);
    try {
      const [a, b] = await Promise.all([ipA, ipB].map(async (ip) => ({ ip, data: await generateFor(ip, compareTopic) })));
      setCompareResults([a, b]);
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : "对比测试失败，请重试");
    } finally {
      setCompareLoading(false);
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
            当前IP是谁，生成出来的脚本就应该像谁。不同内容形式用的是完全不同的内容架构——短视频是钩子+痛点+方法，课程是模块化教学结构，直播是环节化流程，不只是字数多少的区别。
          </p>
        </div>
        <span className="whitespace-nowrap rounded-full bg-[#EAF3DE] px-3.5 py-1.5 text-[12px] font-semibold text-[#3B6D11]">02 · 脚本生成</span>
      </header>

      {/* 模式选择器 */}
      <div className="mb-5 flex gap-2">
        <button onClick={() => setMode("classic")}
          className="rounded-[10px] px-4 py-2.5 text-[13px] font-semibold"
          style={mode === "classic" ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}>
          经典脚本生成
        </button>
        <button onClick={() => setMode("engine")}
          className="rounded-[10px] px-4 py-2.5 text-[13px] font-semibold"
          style={mode === "engine" ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}>
          ⚡ 内容引擎（完整内容包）
        </button>
        {mode === "engine" && (
          <span className="flex items-center text-[12px] text-[#8A8A86]">
            IP定位 → 10条钩子 → 结构选择 → 完整脚本 → 20标题+10封面
          </span>
        )}
      </div>

      {/* ════════════ 内容引擎模式 ════════════ */}
      {mode === "engine" && (
        <div className="flex flex-col gap-5">
          {!ipLoading && (
            <div className="flex flex-wrap items-center gap-2 rounded-[12px] bg-[#FBF3D6] px-4 py-2.5 text-[13px] text-[#7A5C00]">
              当前IP：<b>{activeIP?.name ?? "未选择IP"}</b> · 内容引擎会结合IP定位和受众生成全套内容
            </div>
          )}

          {/* 输入区 */}
          <div className="rounded-[14px] border border-[#E5E4DE] bg-white p-5">
            <div className="mb-4 text-[13px] font-bold text-[#1C1C1B]">输入内容参数</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11.5px] text-[#888]">选题 / 关键词 *</label>
                <input value={topic} onChange={e => setTopic(e.target.value)}
                  placeholder={`例如：${DEMO_TOPIC}`} className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13.5px]" />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] text-[#888]">目标受众（可选，留空由AI推断）</label>
                <input value={ceAudience} onChange={e => setCeAudience(e.target.value)}
                  placeholder="例如：准备装修的别墅大宅和大平层业主" className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13px]" />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] text-[#888]">行业/赛道（可选）</label>
                <input value={ceIndustry} onChange={e => setCeIndustry(e.target.value)}
                  placeholder="例如：室内设计与全案装修" className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13px]" />
              </div>
              <div>
                <label className="mb-1 block text-[11.5px] text-[#888]">内容目标 *</label>
                <div className="flex gap-2">
                  {([["traffic", "流量/转粉"], ["conversion", "变现/转化"], ["persona", "人设/信任"]] as const).map(([v, label]) => (
                    <button key={v} onClick={() => setCeGoal(v)} className="flex-1 rounded-[8px] py-2 text-[12px] font-semibold"
                      style={ceGoal === v ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {ceError && <div className="mt-3 rounded-[8px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{ceError}</div>}
            <div className="mt-4 flex justify-end">
              <button onClick={handleEngineGenerate} disabled={ceLoading || !topic.trim()}
                className="rounded-[12px] bg-[#1C1C1B] px-8 py-3 text-[13.5px] font-bold text-white disabled:opacity-40">
                {ceLoading ? "生成中（约30秒）…" : "⚡ 一键生成完整内容包"}
              </button>
            </div>
          </div>

          {/* 结果展示 */}
          {ceResult && (
            <div className="flex flex-col gap-4">
              {/* Step 1: IP定位 */}
              {ceResult.step1_positioning && (() => {
                const p = ceResult.step1_positioning as Record<string, string>;
                return (
                  <div className="rounded-[14px] border border-[#E5E4DE] bg-white p-5">
                    <div className="mb-3 text-[13px] font-bold text-[#1C1C1B]">① IP定位确认</div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {([["受众画像", p.audienceDefinition], ["痛苦/欲望/压力", p.audiencePainOrDesire], ["建议人设", p.recommendedPersona], ["信任角度", p.trustAngle]] as [string, string][]).map(([label, val]) => (
                        <div key={label} className="rounded-[8px] bg-[#F7F6F2] p-2.5">
                          <div className="mb-0.5 text-[10.5px] font-bold text-[#888]">{label}</div>
                          <p className="text-[12.5px] text-[#333]">{String(val)}</p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-[12px] text-[#639922]">💡 {p.positioningNote}</p>
                  </div>
                );
              })()}

              {/* Step 2: 10条钩子 */}
              {Array.isArray(ceResult.step2_hooks) && (
                <div className="rounded-[14px] border border-[#E5E4DE] bg-white p-5">
                  <div className="mb-1 text-[13px] font-bold text-[#1C1C1B]">② 10条开头钩子</div>
                  <p className="mb-3 text-[11.5px] text-[#888]">点选你最喜欢的一条，可以直接用于脚本开头</p>
                  <div className="flex flex-col gap-2">
                    {(ceResult.step2_hooks as { type: string; hook: string; tension: string; bestFor: string }[]).map((h, i) => (
                      <div key={i} onClick={() => setCeSelectedHook(i)} className="cursor-pointer rounded-[10px] border p-3 transition"
                        style={{ borderColor: ceSelectedHook === i ? "#1C1C1B" : "#E5E4DE", background: ceSelectedHook === i ? "#F7F6F2" : "#fff" }}>
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10.5px] font-bold text-[#555]">{h.type}</span>
                          <span className="rounded-full bg-[#EAF3DE] px-2 py-0.5 text-[10.5px] text-[#3B6D11]">适合{h.bestFor}</span>
                          {ceSelectedHook === i && <span className="rounded-full bg-[#1C1C1B] px-2 py-0.5 text-[10.5px] font-bold text-white">✓ 已选</span>}
                        </div>
                        <p className="text-[13px] font-semibold text-[#1C1C1B]">{h.hook}</p>
                        <p className="mt-0.5 text-[11.5px] text-[#888]">张力：{h.tension}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3: 文案结构 */}
              {ceResult.step3_structure && (() => {
                const s = ceResult.step3_structure as { chosen: string; reason: string; outline: { block: string; content: string }[] };
                const STRUCT_LABEL: Record<string, string> = { problem_solving: "解决问题型", conflict: "认知颠覆型", recommendation: "推荐型", phenomenon: "现象分析型" };
                return (
                  <div className="rounded-[14px] border border-[#E5E4DE] bg-white p-5">
                    <div className="mb-2 text-[13px] font-bold text-[#1C1C1B]">③ 文案结构</div>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded-full bg-[#1C1C1B] px-2.5 py-1 text-[11.5px] font-bold text-white">{STRUCT_LABEL[s.chosen] ?? s.chosen}</span>
                      <span className="text-[12px] text-[#639922]">{s.reason}</span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {s.outline?.map((block, i) => (
                        <div key={i} className="flex gap-2.5 rounded-[8px] bg-[#F7F6F2] p-2.5">
                          <span className="flex-shrink-0 text-[11px] font-bold text-[#888] w-16">{block.block}</span>
                          <p className="text-[12.5px] text-[#333]">{block.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Step 4: 完整脚本 */}
              {ceResult.step4_script && (() => {
                const sc = ceResult.step4_script as Record<string, string>;
                return (
                  <div className="rounded-[14px] border border-[#E5E4DE] bg-white p-5">
                    <div className="mb-3 text-[13px] font-bold text-[#1C1C1B]">④ 完整脚本</div>
                    <div className="mb-3 flex flex-col gap-2">
                      {([["开头钩子", sc.opening], ["场景铺垫", sc.scene], ["核心观点", sc.corePoint], ["方法/步骤", sc.method], ["案例/数据", sc.case], ["结尾CTA", sc.cta]] as [string, string][]).map(([label, val]) => (
                        <div key={label} className="rounded-[8px] border-l-2 border-[#639922] pl-3 py-1">
                          <div className="text-[10.5px] font-bold text-[#639922]">{label}</div>
                          <p className="text-[12.5px] leading-6 text-[#333]">{String(val)}</p>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-[10px] bg-[#F7F6F2] p-3">
                      <div className="mb-1.5 text-[11px] font-bold text-[#888]">完整口播逐字稿</div>
                      <p className="whitespace-pre-line text-[13px] leading-7 text-[#1C1C1B]">{sc.fullScript}</p>
                    </div>
                  </div>
                );
              })()}

              {/* Step 5: 标题 + 封面 */}
              {ceResult.step5_titles_and_covers && (() => {
                const tc = ceResult.step5_titles_and_covers as { titles: { title: string; angle: string; platform: string }[]; coverCopy: { copy: string; style: string }[] };
                const ANGLE_LABEL: Record<string, string> = { pain: "痛点", result: "结果", warning: "警示", contrast: "对比", checklist: "清单", mistake: "错误", case: "案例", direct_benefit: "直接利益" };
                return (
                  <div className="rounded-[14px] border border-[#E5E4DE] bg-white p-5">
                    <div className="mb-3 text-[13px] font-bold text-[#1C1C1B]">⑤ 标题 + 封面文案</div>
                    <div className="mb-1.5 text-[12px] font-bold text-[#555]">20条标题</div>
                    <div className="mb-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {tc.titles?.map((t, i) => (
                        <div key={i} className="flex items-start gap-2 rounded-[8px] bg-[#F7F6F2] px-3 py-2">
                          <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[#1C1C1B] text-[9px] font-bold text-white">{i+1}</span>
                          <div>
                            <p className="text-[12.5px] text-[#1C1C1B]">{t.title}</p>
                            <p className="text-[10.5px] text-[#888]">{ANGLE_LABEL[t.angle] ?? t.angle} · {t.platform}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mb-1.5 text-[12px] font-bold text-[#555]">10条封面文案</div>
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                      {tc.coverCopy?.map((c, i) => (
                        <div key={i} className="rounded-[8px] bg-[#EAF3DE] p-2.5 text-center">
                          <p className="text-[13px] font-bold text-[#1C1C1B]">{c.copy}</p>
                          <p className="mt-0.5 text-[10.5px] text-[#3B6D11]">{c.style}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Meta */}
              {ceResult._meta && (() => {
                const m = ceResult._meta as Record<string, string | number>;
                return (
                  <div className="rounded-[10px] bg-[#F7F6F2] px-4 py-2.5 text-[11.5px] text-[#888]">
                    生成了 {m.hookCount} 条钩子 · {m.titleCount} 条标题 · {m.coverCount} 条封面文案 · 受众：{m.audience} · 目标：{m.goal}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ════════════ 经典脚本生成模式 ════════════ */}
      {mode === "classic" && (<>

      {!ipLoading && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[14px] bg-[#FBF3D6] px-4 py-2.5 text-[13px] text-[#7A5C00]">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: activeIP?.color ?? "#999" }}>
              {activeIP?.avatar ?? "?"}
            </span>
            当前以 <b>{activeIP?.name ?? "未选择IP"}</b> 的人设、受众、表达风格与拍摄习惯生成内容。
          </div>
          <button onClick={() => setShowContext(true)} disabled={!activeIP} className="whitespace-nowrap rounded-[10px] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#7A5C00] disabled:opacity-50">
            查看当前IP上下文
          </button>
        </div>
      )}
      {showContext && activeIP && <IPContextModal ip={activeIP} onClose={() => setShowContext(false)} />}

      <ApiStatusPanel meta={apiMeta} />

      {/* IP差异化验收测试 */}
      <div className="mb-6 rounded-[20px] border-2 border-dashed border-[#C8F04A] bg-[#FBFEF2] p-5">
        <div className="mb-3">
          <div className="text-[14px] font-bold text-[#1C1C1B]">IP差异化验收测试</div>
          <p className="mt-0.5 text-[12px] text-[#888]">用同一个选题、同一种内容形式与时长（取下方主表单当前的选择），分别套用两个不同IP的身份各生成一套内容，对比是否明显不同。</p>
        </div>
        {ips.length < 2 ? (
          <div className="rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">需要至少2个IP身份才能运行对比测试，请先在「IP身份中心」创建。</div>
        ) : (
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">测试选题</label>
              <input value={compareTopic} onChange={e => setCompareTopic(e.target.value)} className="h-[56px] w-full rounded-[16px] border border-[#E5E4DE] bg-white px-5 text-[13.5px] outline-none focus:border-[#639922]" />
            </div>
            <div className="w-[180px] flex-shrink-0">
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">IP A</label>
              <Select
                value={compareAId} onChange={setCompareAId}
                options={ips.map((ip): SelectOption => ({ value: ip.id, label: getIPDisplayLabel(ip, ips), avatarText: ip.avatar, avatarColor: ip.color }))}
              />
            </div>
            <div className="w-[180px] flex-shrink-0">
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">IP B</label>
              <Select
                value={compareBId} onChange={setCompareBId}
                options={ips.map((ip): SelectOption => ({ value: ip.id, label: getIPDisplayLabel(ip, ips), avatarText: ip.avatar, avatarColor: ip.color }))}
              />
            </div>
            <button onClick={runCompare} disabled={compareLoading} className="h-[56px] flex-shrink-0 rounded-[16px] px-6 text-[13.5px] font-bold disabled:opacity-50" style={{ background: "#C8F04A", color: "#1A1A1A" }}>
              {compareLoading ? "对比中…" : "运行对比测试"}
            </button>
          </div>
        )}
        {compareError && <div className="mt-3 rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{compareError}</div>}
        {compareLoading && <div className="mt-4 text-[12.5px] text-[#888]">正在分别用两个IP的身份各生成一套「{currentFormat.label}」内容，大约需要1-2分钟…</div>}
        {compareResults && (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {compareResults.map(({ ip, data }) => (
              <div key={ip.id} className="rounded-[14px] border border-[#E5E4DE] bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: ip.color }}>{ip.avatar}</span>
                  <span className="text-[13.5px] font-bold text-[#1C1C1B]">{getIPDisplayLabel(ip, ips)}</span>
                </div>
                <ResultView data={data} compact />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 主生成表单 */}
      <Card className="mb-6">
        <SectionHead num="①">输入视频选题与生成条件</SectionHead>
        <div className="flex flex-col gap-3">
          <textarea
            value={topic} onChange={e => setTopic(e.target.value)}
            placeholder={`例如：${DEMO_TOPIC}`}
            className="min-h-[52px] resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[14px] text-[#1C1C1B] outline-none focus:border-[#639922] focus:ring-2 focus:ring-[#EAF3DE]"
          />

          <div className="rounded-[10px] bg-[#F7FCF0] px-3 py-2.5 text-[12px] leading-5 text-[#4F6F32]">
            <span className="font-semibold">本次演示生成要求：</span>{DEMO_SCRIPT_REQUIREMENT}
          </div>

          <KnowledgePanel loading={knowledgeLoading} refs={knowledgeRefs} searched={knowledgeSearched} />

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
              onClick={handleGenerate} disabled={loading}
              className="ml-auto flex h-[42px] items-center gap-2 whitespace-nowrap rounded-[12px] bg-[#1C1C1B] px-7 text-[13.5px] font-semibold text-white disabled:opacity-60"
            >
              {loading ? "生成中…" : "生成完整内容"}
            </button>
          </div>
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
          <h3 className="mb-2 text-[17px] font-semibold text-[#1C1C1B]">还没有生成结果</h3>
          <p className="text-[13.5px]">输入选题、选好内容形式和时长后点击「生成完整内容」，系统会按这种形式专属的内容架构生成。</p>
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
      </> )} {/* mode === classic */}
    </div>
  );
}
