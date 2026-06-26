"use client";
import { apiFetch } from "@/lib/api-fetch";
import { useState, useEffect, useRef } from "react";
import { useIP } from "@/lib/ip-context";
import { addScriptAsset, getStyleProfile, getKnowledgeEntries, recordKnowledgeUsage } from "@/lib/ip-store";
import { IPProfile, IPStyleProfile, KnowledgeEntry } from "@/lib/types";
import { buildIPContextBlock } from "@/lib/ip-prompt";
import { Select, SelectOption } from "@/components/ui/select";
import { CitationSummary } from "@/components/ui/citation-summary";

// ── Types ──
interface CoreElements { viewpoint: string; cases: string[]; logic: string; conclusion: string; }
interface ExpressionAnalysis { openingHook: string; narrativeRhythm: string; emotionalTone: string; rhetoricDevices: string[]; closingStyle: string; }
interface ApiMeta { apiCalled: boolean; calledAt: string; model: string | null; ipUsed: string | null; mockHit: boolean; error?: string; }
interface BreakdownResult { coreElements: CoreElements; expressionAnalysis: ExpressionAnalysis; boundaryNote: string; apiMeta: ApiMeta; }

interface Segment { original: string; rewritten: string; reason: string; changeType: string[]; }
interface Constraints { keepStructure: boolean; keepCases: boolean; keepTitle: boolean; keepViewpoint: boolean; keepQuotes: boolean; keepData: boolean; }
interface LockedItemCheck { item: string; label: string; preserved: boolean; howPreserved: string; }
interface GoalImpact { direction: "更有利" | "中性" | "有风险"; reasoning: string; }

type OptimizationGoal = "涨粉" | "完播率" | "互动率" | "转化导流" | "品牌可信度";
type OptimizationMode = "strict" | "balanced" | "creative";

interface RewriteResult {
  ipId: string; ipName: string; mode: OptimizationMode; modeLabel: string; goal: OptimizationGoal; constraints: Constraints;
  coreElements: CoreElements; lockedItemsCheck: LockedItemCheck[]; segments: Segment[]; rewrittenFullText: string;
  deviationScore: number; deviationWarning: boolean; deviationThreshold: number; deviationReason: string;
  styleMatchScore: number; referencedSamples: string[];
  ipStyleExplanation: string; goalImpact: GoalImpact; apiMeta: ApiMeta;
}

type InputMethod = "paste" | "file" | "link" | "media";
type MaterialType = "口播文案" | "视频逐字稿" | "字幕文件" | "视频链接" | "音频文件" | "视频文件";
type Step = 1 | 2 | 3 | 4;

const MODE_OPTIONS: { id: OptimizationMode; label: string; desc: string }[] = [
  { id: "strict", label: "严格模式", desc: "尽量保留原文措辞和结构，只调IP语气，宁可改少也不改变味" },
  { id: "balanced", label: "平衡模式", desc: "在目标和原文之间找平衡，允许调整结构和节奏" },
  { id: "creative", label: "创意模式", desc: "大胆重构开头/结尾/钩子，但锁定的核心观点绝对不能变" },
];

const GOAL_OPTIONS: { id: OptimizationGoal; desc: string }[] = [
  { id: "涨粉", desc: "强化专业身份和独特视角，让陌生观众想关注" },
  { id: "完播率", desc: "强化开头钩子和中段节奏，减少中途划走" },
  { id: "互动率", desc: "设计能引发评论的提问/争议点/关键词引导" },
  { id: "转化导流", desc: "强化结尾行动号召，转化路径更清晰" },
  { id: "品牌可信度", desc: "强化专业感和可信来源，语言更克制" },
];

const CONSTRAINT_OPTIONS: { key: keyof Constraints; label: string }[] = [
  { key: "keepStructure", label: "保留原结构" },
  { key: "keepCases", label: "保留原案例" },
  { key: "keepTitle", label: "保留原标题" },
  { key: "keepViewpoint", label: "保留原观点（措辞）" },
  { key: "keepQuotes", label: "保留原金句" },
  { key: "keepData", label: "保留原数据" },
];

const PLATFORM_OPTIONS = ["抖音", "小红书", "B站", "视频号", "其他"];
const MATERIAL_TYPE_OPTIONS: MaterialType[] = ["口播文案", "视频逐字稿", "字幕文件", "视频链接", "音频文件", "视频文件"];

const INPUT_METHODS: { id: InputMethod; label: string }[] = [
  { id: "paste", label: "粘贴口播文案" },
  { id: "file", label: "上传文件" },
  { id: "link", label: "粘贴视频链接" },
  { id: "media", label: "上传音视频" },
];

function parseSRT(raw: string): string {
  return raw
    .split(/\r?\n\r?\n+/)
    .map((block) => {
      const lines = block.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const textLines = lines.filter((l) => !/^\d+$/.test(l.trim()) && !l.includes("-->"));
      return textLines.join(" ").trim();
    })
    .filter(Boolean)
    .join("\n");
}

async function parseFileToText(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "txt" || ext === "md") return await file.text();
  if (ext === "srt") return parseSRT(await file.text());
  if (ext === "docx") {
    const arrayBuffer = await file.arrayBuffer();
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }
  throw new Error(`不支持的文件格式：.${ext}，请改用 .txt / .md / .docx / .srt`);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[14px] border border-[#E5E4DE] bg-white p-5 ${className}`}>{children}</div>;
}

function StepIndicator({ step }: { step: Step }) {
  const labels = ["提供原始素材", "拆解结果", "优化设置", "优化结果"];
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      {labels.map((label, i) => {
        const n = (i + 1) as Step;
        const active = step === n;
        const done = step > n;
        return (
          <div key={label} className="flex items-center gap-2">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold"
              style={active ? { background: "#1C1C1B", color: "#fff" } : done ? { background: "#C8F04A", color: "#1A1A1A" } : { background: "#F2F1ED", color: "#999" }}
            >
              {done ? "✓" : n}
            </span>
            <span className="text-[13px] font-semibold" style={{ color: active ? "#1C1C1B" : "#999" }}>{label}</span>
            {n < 4 && <span className="mx-1 h-px w-8 bg-[#E5E4DE]" />}
          </div>
        );
      })}
    </div>
  );
}

function IPContextModal({ ip, styleProfile, onClose }: { ip: IPProfile; styleProfile: IPStyleProfile | null; onClose: () => void }) {
  const block = buildIPContextBlock(ip, styleProfile);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-[620px] overflow-y-auto rounded-[18px] bg-white p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-[#1C1C1B]">
          <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: ip.color }}>{ip.avatar}</span>
          「{ip.name}」当前模块实际使用的IP上下文
        </div>
        <p className="mb-4 text-[12px] text-[#999]">下面这段文字会被原样拼接进发给DeepSeek的Prompt里。</p>
        <pre className="whitespace-pre-wrap rounded-[12px] bg-[#F7F6F2] p-4 text-[12px] leading-6 text-[#333]">{block}</pre>
        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[13px] font-semibold text-white">关闭</button>
        </div>
      </div>
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

const CHANGE_TYPE_COLORS: Record<string, string> = {};
function changeTypeColor(t: string) {
  if (!CHANGE_TYPE_COLORS[t]) {
    const palette = ["#EAF3DE", "#FBF3D6", "#FCEBEB", "#E9E6F7", "#DCEFFA"];
    const idx = Object.keys(CHANGE_TYPE_COLORS).length % palette.length;
    CHANGE_TYPE_COLORS[t] = palette[idx];
  }
  return CHANGE_TYPE_COLORS[t];
}

// ── Step2: 拆解结果展示 ──
function BreakdownView({ data }: { data: BreakdownResult }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[10px] border border-[#E5E4DE] bg-[#FAFAF8] p-3 text-[12px] leading-5 text-[#666]">
        {data.boundaryNote}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-[#888]">
          🔒 核心要素（拆解后将被锁定，优化阶段不可更改）
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-[10px] bg-[#FBFEF2] border border-[#E4F0C0] p-3"><div className="mb-1 text-[11px] font-bold text-[#639922]">核心观点</div><p className="text-[12.5px] leading-5 text-[#333]">{data.coreElements.viewpoint}</p></div>
          <div className="rounded-[10px] bg-[#FBFEF2] border border-[#E4F0C0] p-3"><div className="mb-1 text-[11px] font-bold text-[#639922]">核心结论</div><p className="text-[12.5px] leading-5 text-[#333]">{data.coreElements.conclusion}</p></div>
          <div className="rounded-[10px] bg-[#FBFEF2] border border-[#E4F0C0] p-3"><div className="mb-1 text-[11px] font-bold text-[#639922]">核心逻辑</div><p className="text-[12.5px] leading-5 text-[#333]">{data.coreElements.logic}</p></div>
          <div className="rounded-[10px] bg-[#FBFEF2] border border-[#E4F0C0] p-3">
            <div className="mb-1 text-[11px] font-bold text-[#639922]">核心案例</div>
            {data.coreElements.cases.length > 0
              ? <ul className="list-disc pl-4 text-[12.5px] leading-5 text-[#333]">{data.coreElements.cases.map((c, i) => <li key={i}>{c}</li>)}</ul>
              : <p className="text-[12.5px] text-[#999]">无</p>}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 text-[12px] font-bold text-[#888]">表达层分析（只描述怎么说，不评价说得对不对）</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-[10px] bg-[#F7F6F2] p-3"><div className="mb-1 text-[11px] font-bold text-[#666]">开头钩子</div><p className="text-[12.5px] leading-5 text-[#333]">{data.expressionAnalysis.openingHook}</p></div>
          <div className="rounded-[10px] bg-[#F7F6F2] p-3"><div className="mb-1 text-[11px] font-bold text-[#666]">叙事节奏</div><p className="text-[12.5px] leading-5 text-[#333]">{data.expressionAnalysis.narrativeRhythm}</p></div>
          <div className="rounded-[10px] bg-[#F7F6F2] p-3"><div className="mb-1 text-[11px] font-bold text-[#666]">情绪基调</div><p className="text-[12.5px] leading-5 text-[#333]">{data.expressionAnalysis.emotionalTone}</p></div>
          <div className="rounded-[10px] bg-[#F7F6F2] p-3"><div className="mb-1 text-[11px] font-bold text-[#666]">结尾方式</div><p className="text-[12.5px] leading-5 text-[#333]">{data.expressionAnalysis.closingStyle}</p></div>
          <div className="rounded-[10px] bg-[#F7F6F2] p-3 sm:col-span-2">
            <div className="mb-1 text-[11px] font-bold text-[#666]">修辞手法</div>
            {data.expressionAnalysis.rhetoricDevices.length > 0
              ? <div className="flex flex-wrap gap-1.5">{data.expressionAnalysis.rhetoricDevices.map((r, i) => <span key={i} className="rounded-full bg-white px-2 py-0.5 text-[11.5px] text-[#555]">{r}</span>)}</div>
              : <p className="text-[12.5px] text-[#999]">未发现明显修辞手法</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step4: 优化结果展示 ──
const GOAL_DIRECTION_STYLE: Record<GoalImpact["direction"], { bg: string; text: string; icon: string }> = {
  "更有利": { bg: "#EAF3DE", text: "#3B6D11", icon: "↑" },
  "中性": { bg: "#F2F1ED", text: "#666", icon: "→" },
  "有风险": { bg: "#FCEBEB", text: "#A32D2D", icon: "⚠" },
};

function ResultView({ data }: { data: RewriteResult }) {
  const allPreserved = data.lockedItemsCheck.length > 0 && data.lockedItemsCheck.every(c => c.preserved);
  const dirStyle = GOAL_DIRECTION_STYLE[data.goalImpact.direction] ?? GOAL_DIRECTION_STYLE["中性"];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#999]">
        <span className="rounded-full bg-[#F2F1ED] px-2 py-1 font-semibold text-[#555]">{data.modeLabel}</span>
        <span className="rounded-full bg-[#F2F1ED] px-2 py-1 font-semibold text-[#555]">目标：{data.goal}</span>
        <span className="rounded-full bg-[#F2F1ED] px-2 py-1">{data.segments.length}个对照片段</span>
      </div>

      {/* 锁定项核对清单 */}
      <div className={`rounded-[12px] border p-3.5 ${allPreserved ? "border-[#C8F04A] bg-[#FBFEF2]" : "border-[#E0608E] bg-[#FCEBEB]"}`}>
        <div className="mb-2 text-[12.5px] font-bold" style={{ color: allPreserved ? "#3B6D11" : "#A32D2D" }}>
          {allPreserved ? "🔒 锁定项核对：全部保留" : "⚠ 锁定项核对：有项目可能被动摇，请核对"}
        </div>
        <div className="flex flex-col gap-1.5">
          {data.lockedItemsCheck.map((c, i) => (
            <div key={i} className="flex items-start gap-2 rounded-[8px] bg-white p-2.5">
              <span className="mt-0.5 text-[12px]" style={{ color: c.preserved ? "#3B6D11" : "#A32D2D" }}>{c.preserved ? "✓" : "✗"}</span>
              <div className="flex-1">
                <span className="text-[12px] font-semibold text-[#1C1C1B]">{c.label}：</span>
                <span className="text-[12px] text-[#555]">{c.howPreserved}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {data.deviationWarning && (
        <div className="rounded-[10px] border border-[#E0608E] bg-[#FCEBEB] p-3">
          <div className="mb-1 text-[13px] font-bold text-[#A32D2D]">⚠ 改写偏离锁定要素较大，请确认。</div>
          <div className="text-[12px] text-[#7A3030]">偏离评分 {data.deviationScore}/100（阈值 {data.deviationThreshold}）：{data.deviationReason}</div>
        </div>
      )}
      {!data.deviationWarning && (
        <div className="rounded-[10px] border border-[#E5E4DE] bg-[#FAFAF8] p-3 text-[12px] text-[#666]">
          偏离评分 {data.deviationScore}/100（阈值 {data.deviationThreshold}，未超过）：{data.deviationReason}
        </div>
      )}

      {/* 预计影响说明 */}
      <div className="rounded-[12px] p-3.5" style={{ background: dirStyle.bg }}>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[13px] font-bold" style={{ color: dirStyle.text }}>{dirStyle.icon}</span>
          <span className="text-[12.5px] font-bold" style={{ color: dirStyle.text }}>对「{data.goal}」的预计影响：{data.goalImpact.direction}</span>
        </div>
        <p className="text-[12.5px] leading-5" style={{ color: dirStyle.text }}>{data.goalImpact.reasoning}</p>
        <p className="mt-2 text-[11px] opacity-70" style={{ color: dirStyle.text }}>这是AI基于内容特征做的方向性判断，不是基于真实投放数据的精确预测，仅供参考。</p>
      </div>

      {data.ipStyleExplanation && (
        <div className="rounded-[10px] border border-[#C8F04A] bg-[#FBFEF2] p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-bold text-[#639922]">这次改写如何体现「{data.ipName}」的特征</div>
            <div className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#3B6D11]">
              风格匹配度 {data.styleMatchScore}%
            </div>
          </div>
          <p className="text-[12.5px] leading-5 text-[#444]">{data.ipStyleExplanation}</p>
          {data.referencedSamples.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[#E4F0C0] pt-2.5 text-[11.5px] text-[#639922]">
              <span className="font-semibold">本次参考了：</span>
              {data.referencedSamples.map((title, i) => (
                <span key={i} className="rounded-full bg-white px-2 py-0.5">《{title}》</span>
              ))}
            </div>
          )}
          {data.referencedSamples.length === 0 && (
            <div className="mt-2.5 border-t border-[#E4F0C0] pt-2.5 text-[11.5px] text-[#999]">
              这次改写没有使用「{data.ipName}」的风格画像（尚未学习或样本不足），仅基于IP编辑页手动填写的"表达风格"字段。去IP身份中心添加3-5篇口播逐字稿可以让改写更贴近真实语感。
            </div>
          )}
        </div>
      )}

      <div>
        <div className="mb-2 text-[12px] font-bold text-[#888]">对照模式：原文 → 改写后 → 修改原因</div>
        <div className="flex flex-col gap-3">
          {data.segments.map((seg, i) => (
            <div key={i} className="rounded-[12px] border border-[#F0EFE9] p-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div className="rounded-[8px] bg-[#F7F6F2] p-2.5">
                  <div className="mb-1 text-[10.5px] font-bold text-[#999]">原文</div>
                  <p className="text-[12.5px] leading-5 text-[#555]">{seg.original}</p>
                </div>
                <div className="rounded-[8px] bg-[#FBFEF2] p-2.5">
                  <div className="mb-1 text-[10.5px] font-bold text-[#639922]">改写后</div>
                  <p className="text-[12.5px] leading-5 text-[#1C1C1B]">{seg.rewritten}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-start gap-1.5">
                {seg.changeType.map((t, j) => <span key={j} className="rounded-full px-2 py-0.5 text-[10.5px] font-medium text-[#555]" style={{ background: changeTypeColor(t) }}>{t}</span>)}
                <span className="text-[11.5px] text-[#888]">{seg.reason}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[12px] font-bold text-[#888]">完整改写全文</div>
          <button
            onClick={() => navigator.clipboard?.writeText(data.rewrittenFullText)}
            className="rounded-[8px] bg-[#F2F1ED] px-2.5 py-1 text-[11px] font-semibold text-[#555]"
          >
            复制全文
          </button>
        </div>
        <div className="whitespace-pre-wrap rounded-[12px] border border-[#F0EFE9] bg-white p-4 text-[13px] leading-6 text-[#333]">
          {data.rewrittenFullText}
        </div>
      </div>
    </div>
  );
}

// ── 参考知识面板：sourceText停止变化后自动检索知识库 ──
interface KnowledgeRef { id: string; reason: string; relevanceTier: string; relevanceReason: string; entry: KnowledgeEntry }
const REL_COLOR: Record<string, { bg: string; text: string }> = {
  "高度相关": { bg: "#EAF3DE", text: "#3B6D11" }, "中度相关": { bg: "#FBF3D6", text: "#7A5C00" }, "低度相关": { bg: "#F2F1ED", text: "#888" },
};
function KnowledgePanel({ loading, refs, searched }: { loading: boolean; refs: KnowledgeRef[]; searched: boolean }) {
  if (!loading && !searched) return null;
  return (
    <div className="mb-4 rounded-[16px] border border-[#E5E4DE] bg-white p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-[13px] font-bold text-[#1C1C1B]">【参考知识】</span>
        <span className="text-[11px] text-[#999]">系统自动检索知识库，定性相关度档位，不编造精确相似度数字</span>
      </div>
      {loading && <div className="text-[12.5px] text-[#888]">检索中…</div>}
      {!loading && refs.length === 0 && <div className="text-[12.5px] text-[#999]">知识库里没有找到强相关的参考。</div>}
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

export default function CopyOptimizationPage() {
  const { activeIP, ips, loading: ipLoading } = useIP();
  const [step, setStep] = useState<Step>(1);

  // ── Step1: 原始素材 ──
  const [inputMethod, setInputMethod] = useState<InputMethod>("paste");
  const [materialTitle, setMaterialTitle] = useState("");
  const [sourcePlatform, setSourcePlatform] = useState("抖音");
  const [materialType, setMaterialType] = useState<MaterialType>("口播文案");
  const [note, setNote] = useState("");
  const [isViralReference, setIsViralReference] = useState(false);
  const [sourceText, setSourceText] = useState("");

  const [knowledgeRefs, setKnowledgeRefs] = useState<KnowledgeRef[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeSearched, setKnowledgeSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (sourceText.trim().length < 10) { setKnowledgeSearched(false); setKnowledgeRefs([]); return; }
    debounceRef.current = setTimeout(() => { searchKnowledge(sourceText); }, 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceText]);

  async function searchKnowledge(query: string) {
    const allEntries = [
      ...getKnowledgeEntries("爆款案例"), ...getKnowledgeEntries("方法论"),
      ...getKnowledgeEntries("评论需求"), ...getKnowledgeEntries("选题案例"),
    ];
    if (allEntries.length === 0) { setKnowledgeSearched(true); setKnowledgeRefs([]); return; }
    setKnowledgeLoading(true); setKnowledgeSearched(true);
    try {
      const res = await apiFetch("/api/knowledge-search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.slice(0, 2000), entries: allEntries.map(e => ({ id: e.id, category: e.category, title: e.title, tags: e.tags, keywords: e.keywords })) }),
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
          module: "文案优化", usedAt: new Date().toISOString(),
          reason: r.reason, relevanceTier: r.relevanceTier as "高度相关" | "中度相关" | "低度相关",
          relevanceReason: r.relevanceReason, context: query.slice(0, 200),
        }, "已用于分析");
      });
    } catch { setKnowledgeRefs([]); } finally { setKnowledgeLoading(false); }
  }
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [fileParseError, setFileParseError] = useState<string | null>(null);
  const [fileParsing, setFileParsing] = useState(false);
  const [videoLink, setVideoLink] = useState("");
  const [mediaFileName, setMediaFileName] = useState<string | null>(null);
  const [mediaFileInfo, setMediaFileInfo] = useState<string | null>(null);

  // ── Step2: 拆解 ──
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<BreakdownResult | null>(null);

  // ── Step3: 目标IP/优化目标/模式/约束 ──
  const [targetIpId, setTargetIpId] = useState("");
  const [mode, setMode] = useState<OptimizationMode>("balanced");
  const [goal, setGoal] = useState<OptimizationGoal>("完播率");
  const [constraints, setConstraints] = useState<Constraints>({
    keepStructure: false, keepCases: false, keepTitle: false, keepViewpoint: false, keepQuotes: false, keepData: false,
  });
  const [styleProfile, setStyleProfile] = useState<IPStyleProfile | null>(null);

  // ── Step4: 结果 ──
  const [loading, setLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [result, setResult] = useState<RewriteResult | null>(null);
  const [apiMeta, setApiMeta] = useState<ApiMeta | null>(null);
  const [showContext, setShowContext] = useState(false);

  const targetIP = ips.find(i => i.id === targetIpId) ?? activeIP ?? null;

  useEffect(() => {
    if (!targetIP) { setStyleProfile(null); return; }
    setStyleProfile(getStyleProfile(targetIP.id));
  }, [targetIP?.id]);

  function handleInputMethodChange(m: InputMethod) {
    setInputMethod(m);
    setFileParseError(null);
    if (m === "link") setMaterialType("视频链接");
    if (m === "paste" && materialType !== "口播文案" && materialType !== "视频逐字稿") setMaterialType("口播文案");
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileParseError(null);
    setUploadedFileName(file.name);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    setMaterialType(ext === "srt" ? "字幕文件" : "视频逐字稿");
    setFileParsing(true);
    try {
      const text = await parseFileToText(file);
      setSourceText(text);
    } catch (err) {
      setFileParseError(err instanceof Error ? err.message : "文件解析失败，请尝试更换格式或直接粘贴文字内容");
    } finally {
      setFileParsing(false);
    }
  }

  function handleMediaChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isAudio = ["mp3", "m4a", "wav"].includes(ext);
    setMaterialType(isAudio ? "音频文件" : "视频文件");
    setMediaFileName(file.name);
    setMediaFileInfo(`${formatFileSize(file.size)} · ${file.type || ext}`);
  }

  function toggleConstraint(key: keyof Constraints) {
    setConstraints(c => ({ ...c, [key]: !c[key] }));
  }

  function validateBeforeBreakdown(): string | null {
    const text = sourceText.trim();
    if (!text) {
      if (inputMethod === "link") return "当前暂不支持自动解析视频，请粘贴逐字稿或上传字幕文件。";
      if (inputMethod === "media") return "音视频已上传，但暂未接入自动转写，请先粘贴口播文案。";
      return "请输入要拆解的逐字稿/文案/爆款内容";
    }
    return null;
  }

  async function handleBreakdown() {
    const err = validateBeforeBreakdown();
    if (err) { setGenError(err); return; }
    const text = sourceText.trim();

    setGenError(null); setBreakdownError(null); setBreakdownLoading(true); setBreakdown(null); setStep(2);
    try {
      const res = await apiFetch("/api/copy-optimization/breakdown", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBreakdownError(data.error ?? `HTTP ${res.status}`);
      } else {
        setBreakdown(data as BreakdownResult);
      }
    } catch (networkErr) {
      setBreakdownError(`网络错误：无法连接到 /api/copy-optimization/breakdown（${networkErr instanceof Error ? networkErr.message : String(networkErr)}）`);
    } finally {
      setBreakdownLoading(false);
    }
  }

  async function handleOptimize() {
    if (!targetIP) { setGenError("请选择目标IP"); return; }
    if (!breakdown) { setGenError("请先完成拆解"); return; }
    const text = sourceText.trim();
    const ip = targetIP as IPProfile;

    setGenError(null); setLoading(true); setResult(null); setStep(4);
    let res: Response;
    try {
      res = await apiFetch("/api/copy-optimization", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ipProfile: ip, sourceText: text, mode, goal, constraints, styleProfile,
          breakdown: { coreElements: breakdown.coreElements },
        }),
      });
    } catch (networkErr) {
      const msg = `网络错误：无法连接到 /api/copy-optimization，请确认开发服务器正在运行（${networkErr instanceof Error ? networkErr.message : String(networkErr)}）`;
      setApiMeta({ apiCalled: false, calledAt: new Date().toISOString(), model: null, ipUsed: ip.name, mockHit: false, error: msg });
      setGenError(msg); setLoading(false); return;
    }

    let data: (RewriteResult & { error?: string }) | { error: string; apiMeta?: ApiMeta };
    try {
      data = await res.json();
    } catch (parseErr) {
      const msg = `JSON解析错误：服务器返回的不是合法JSON（HTTP ${res.status}）（${parseErr instanceof Error ? parseErr.message : String(parseErr)}）`;
      setApiMeta({ apiCalled: true, calledAt: new Date().toISOString(), model: null, ipUsed: ip.name, mockHit: false, error: msg });
      setGenError(msg); setLoading(false); return;
    }

    if ("apiMeta" in data && data.apiMeta) setApiMeta(data.apiMeta);

    if (!res.ok) {
      const errMsg = "error" in data && data.error ? data.error : `HTTP ${res.status}`;
      setGenError(`API返回错误（HTTP ${res.status}）：${errMsg}`);
      setLoading(false);
      return;
    }

    const rr = data as RewriteResult;
    setResult(rr);
    addScriptAsset({
      ipId: ip.id,
      title: materialTitle || rr.coreElements.viewpoint.slice(0, 30) || "改写内容",
      cover: "",
      content: rr.rewrittenFullText,
      status: "草稿",
      scriptResult: rr,
    });
    setLoading(false);
  }

  const trimmedLen = sourceText.trim().length;
  const showShortWarning = trimmedLen > 0 && trimmedLen < 100;

  return (
    <div className="min-h-screen p-6 md:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[13px] text-[#8A8A86]">
            <a href="/" className="font-semibold text-[#639922]">工作台</a> / AI文案改写工作台
          </div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1B]">AI文案改写工作台</h1>
          <p className="mt-1.5 max-w-[640px] text-[13.5px] leading-6 text-[#8A8A86]">
            先拆解原文锁定核心要素，再选IP、优化目标和模式生成改写——拆解只分析表达方式不评价观点对错，优化过程中锁定要素全程不可更改，每处改动都附原因和预计影响。
          </p>
        </div>
        <span className="whitespace-nowrap rounded-full bg-[#EAF3DE] px-3.5 py-1.5 text-[12px] font-semibold text-[#3B6D11]">06 · 文案改写</span>
      </header>

      <StepIndicator step={step} />

      {/* ───────── Step 1：原始素材 ───────── */}
      {step === 1 && (
        <Card className="mb-6">
          <div className="mb-4 text-[14.5px] font-bold text-[#1C1C1B]">提供原始素材</div>

          <div className="mb-4 flex flex-wrap gap-2">
            {INPUT_METHODS.map(m => (
              <button
                key={m.id} type="button" onClick={() => handleInputMethodChange(m.id)}
                className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-all"
                style={inputMethod === m.id ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#888" }}
              >
                {m.label}
              </button>
            ))}
          </div>

          <KnowledgePanel loading={knowledgeLoading} refs={knowledgeRefs} searched={knowledgeSearched} />

          {inputMethod === "paste" && (
            <textarea
              value={sourceText} onChange={e => setSourceText(e.target.value)}
              placeholder="粘贴视频口播稿 / 逐字稿 / 爆款文案 / 课程片段 / 直播话术…"
              rows={9}
              className="w-full resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[13.5px] leading-6 text-[#1C1C1B] outline-none focus:border-[#639922] focus:ring-2 focus:ring-[#EAF3DE]"
            />
          )}

          {inputMethod === "file" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <label className="cursor-pointer rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[12.5px] font-semibold text-white">
                  选择文件
                  <input type="file" accept=".txt,.md,.docx,.srt" className="hidden" onChange={handleFileChange} />
                </label>
                <span className="text-[12.5px] text-[#888]">支持 .txt / .md / .docx / .srt 字幕文件</span>
              </div>
              {uploadedFileName && (
                <div className="text-[12.5px] text-[#555]">
                  已选择：<b>{uploadedFileName}</b>{fileParsing && "（解析中…）"}
                </div>
              )}
              {fileParseError && <div className="rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{fileParseError}</div>}
              <textarea
                value={sourceText} onChange={e => setSourceText(e.target.value)}
                placeholder="文件解析后的文字会出现在这里，你也可以直接在这里手动修改…"
                rows={8}
                className="w-full resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[13.5px] leading-6 text-[#1C1C1B] outline-none focus:border-[#639922] focus:ring-2 focus:ring-[#EAF3DE]"
              />
            </div>
          )}

          {inputMethod === "link" && (
            <div className="flex flex-col gap-3">
              <input
                value={videoLink} onChange={e => setVideoLink(e.target.value)}
                placeholder="粘贴抖音 / 小红书 / B站 / 视频号链接…"
                className="w-full rounded-[14px] border border-[#E5E4DE] bg-white px-4 py-3 text-[13.5px] outline-none focus:border-[#639922]"
              />
              <div className="rounded-[10px] bg-[#FBF3D6] px-3 py-2.5 text-[12.5px] text-[#7A5C00]">
                暂不支持自动抓取视频内容，请手动粘贴逐字稿，或切换到"上传文件"上传字幕文件。
              </div>
              <textarea
                value={sourceText} onChange={e => setSourceText(e.target.value)}
                placeholder="请手动粘贴这个视频的逐字稿…"
                rows={7}
                className="w-full resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[13.5px] leading-6 text-[#1C1C1B] outline-none focus:border-[#639922]"
              />
            </div>
          )}

          {inputMethod === "media" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <label className="cursor-pointer rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[12.5px] font-semibold text-white">
                  选择音视频文件
                  <input type="file" accept="audio/*,video/*" className="hidden" onChange={handleMediaChange} />
                </label>
              </div>
              {mediaFileName && <div className="text-[12.5px] text-[#555]">已选择：<b>{mediaFileName}</b>（{mediaFileInfo}）</div>}
              <div className="rounded-[10px] bg-[#FBF3D6] px-3 py-2.5 text-[12.5px] text-[#7A5C00]">
                暂未接入自动转写，请在下方手动粘贴口播文案。
              </div>
              <textarea
                value={sourceText} onChange={e => setSourceText(e.target.value)}
                placeholder="请手动粘贴这段音视频的口播文案…"
                rows={7}
                className="w-full resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[13.5px] leading-6 text-[#1C1C1B] outline-none focus:border-[#639922]"
              />
            </div>
          )}

          {showShortWarning && (
            <div className="mt-3 rounded-[10px] bg-[#FBF3D6] px-3 py-2 text-[12.5px] text-[#7A5C00]">
              素材内容过短，拆解和改写效果可能不稳定。
            </div>
          )}
          <div className="mt-1 text-right text-[11px] text-[#AAA]">{trimmedLen} 字</div>

          <div className="mt-5 grid grid-cols-1 gap-3 border-t border-[#F0EFE9] pt-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11.5px] font-semibold text-[#888]">素材标题</label>
              <input value={materialTitle} onChange={e => setMaterialTitle(e.target.value)} placeholder="给这份素材起个名字，方便归档查找" className="w-full rounded-[10px] border border-[#E5E4DE] bg-white px-3 py-2 text-[13px]" />
            </div>
            <div>
              <label className="mb-1.5 block text-[11.5px] font-semibold text-[#888]">素材来源平台</label>
              <Select value={sourcePlatform} onChange={setSourcePlatform} options={PLATFORM_OPTIONS} />
            </div>
            <div>
              <label className="mb-1.5 block text-[11.5px] font-semibold text-[#888]">素材类型</label>
              <Select value={materialType} onChange={(v) => setMaterialType(v as MaterialType)} options={MATERIAL_TYPE_OPTIONS} />
            </div>
            <div>
              <label className="mb-1.5 block text-[11.5px] font-semibold text-[#888]">是否作为爆款参考</label>
              <label className="flex h-[38px] items-center gap-2 rounded-[10px] border border-[#E5E4DE] bg-white px-3 text-[13px] text-[#555]">
                <input type="checkbox" checked={isViralReference} onChange={e => setIsViralReference(e.target.checked)} />
                标记为爆款参考素材
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-[11.5px] font-semibold text-[#888]">备注</label>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="可选，比如这份素材的来源说明、特别要注意的地方" className="w-full rounded-[10px] border border-[#E5E4DE] bg-white px-3 py-2 text-[13px]" />
            </div>
          </div>

          {genError && <div className="mt-4 rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{genError}</div>}

          <div className="mt-5 flex justify-end">
            <button onClick={handleBreakdown} className="flex h-[42px] items-center gap-2 whitespace-nowrap rounded-[12px] bg-[#1C1C1B] px-7 text-[13.5px] font-semibold text-white">
              拆解原文 →
            </button>
          </div>
        </Card>
      )}

      {/* ───────── Step 2：拆解结果 ───────── */}
      {step === 2 && (
        <>
          {breakdownLoading && (
            <Card className="py-16 text-center text-[#8A8A86]">
              <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-4 border-[#EAF3DE] border-t-[#639922]" />
              <div className="text-[14px]">正在拆解原文的核心要素和表达方式…</div>
            </Card>
          )}
          {!breakdownLoading && breakdownError && (
            <Card>
              <div className="rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{breakdownError}</div>
              <div className="mt-4 flex justify-between">
                <button onClick={() => setStep(1)} className="rounded-[12px] px-5 py-2.5 text-[13.5px] font-semibold text-[#888]">上一步</button>
                <button onClick={handleBreakdown} className="rounded-[12px] bg-[#1C1C1B] px-5 py-2.5 text-[13.5px] font-semibold text-white">重试</button>
              </div>
            </Card>
          )}
          {!breakdownLoading && breakdown && (
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <div className="text-[14.5px] font-bold text-[#1C1C1B]">拆解结果</div>
                <button onClick={handleBreakdown} className="rounded-[10px] bg-[#F2F1ED] px-3 py-1.5 text-[12px] font-semibold text-[#555]">重新拆解</button>
              </div>
              <BreakdownView data={breakdown} />
              <div className="mt-5 flex justify-between border-t border-[#F0EFE9] pt-4">
                <button onClick={() => setStep(1)} className="rounded-[12px] px-5 py-2.5 text-[13.5px] font-semibold text-[#888]">上一步</button>
                <button onClick={() => setStep(3)} className="flex h-[42px] items-center gap-2 whitespace-nowrap rounded-[12px] bg-[#1C1C1B] px-7 text-[13.5px] font-semibold text-white">
                  确认拆解结果，进入优化设置 →
                </button>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ───────── Step 3：优化设置 ───────── */}
      {step === 3 && (
        <Card className="mb-6">
          <div className="mb-4 text-[14.5px] font-bold text-[#1C1C1B]">选择目标IP、优化目标与模式</div>

          {!ipLoading && targetIP && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[14px] bg-[#FBF3D6] px-4 py-2.5 text-[13px] text-[#7A5C00]">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: targetIP.color }}>
                  {targetIP.avatar}
                </span>
                将按 <b>{targetIP.name}</b> 的人设、表达风格与禁用表达进行优化。
              </div>
              <button onClick={() => setShowContext(true)} className="whitespace-nowrap rounded-[10px] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#7A5C00]">
                查看当前IP上下文
              </button>
            </div>
          )}
          {!ipLoading && targetIP && (
            styleProfile ? (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[14px] border border-[#C8F04A] bg-[#FBFEF2] px-4 py-2.5 text-[12.5px] text-[#3B6D11]">
                <span className="rounded-full bg-[#C8F04A] px-2 py-0.5 text-[10.5px] font-bold text-[#1A1A1A]">已学习风格</span>
                已从 {styleProfile.sourceSampleTitles.length} 篇口播样本中学习「{targetIP.name}」的语感，本次优化会优先贴合这份风格画像。
              </div>
            ) : (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-[#E5E4DE] bg-[#FAFAF8] px-4 py-2.5 text-[12.5px] text-[#888]">
                <span>「{targetIP.name}」还没有学习过风格画像，本次优化仅基于IP编辑页手动填写的"表达风格"字段。</span>
                <a href="/ip" className="whitespace-nowrap rounded-[10px] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#639922]">去添加口播样本 →</a>
              </div>
            )
          )}
          {showContext && targetIP && <IPContextModal ip={targetIP} styleProfile={styleProfile} onClose={() => setShowContext(false)} />}

          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-[11.5px] font-semibold text-[#888]">目标IP</label>
              <Select
                value={targetIpId || targetIP?.id || ""} onChange={setTargetIpId}
                className="w-[180px]"
                options={ips.map((ip): SelectOption => ({ value: ip.id, label: ip.name, avatarText: ip.avatar, avatarColor: ip.color }))}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[11.5px] font-semibold text-[#888]">优化目标（必选，决定改写的侧重点）</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {GOAL_OPTIONS.map(opt => (
                  <button
                    key={opt.id} type="button" onClick={() => setGoal(opt.id)}
                    className="rounded-[10px] px-3.5 py-2.5 text-left text-[12px] transition-all"
                    style={goal === opt.id ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}
                  >
                    <div className="font-semibold">{opt.id}</div>
                    <div className="mt-0.5 text-[10.5px] opacity-80">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11.5px] font-semibold text-[#888]">优化模式（替代原来的改写强度）</label>
              <div className="flex flex-wrap gap-2">
                {MODE_OPTIONS.map(opt => (
                  <button
                    key={opt.id} type="button" onClick={() => setMode(opt.id)}
                    className="rounded-[10px] px-3.5 py-2 text-left text-[12px] transition-all"
                    style={mode === opt.id ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}
                  >
                    <div className="font-semibold">{opt.label}</div>
                    <div className="mt-0.5 text-[10.5px] opacity-80">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11.5px] font-semibold text-[#888]">修改约束（在锁定要素始终保留的基础上，额外勾选更严格的保留项）</label>
              <div className="flex flex-wrap gap-3">
                {CONSTRAINT_OPTIONS.map(opt => (
                  <label key={opt.key} className="flex items-center gap-1.5 text-[12.5px] text-[#555]">
                    <input type="checkbox" checked={constraints[opt.key]} onChange={() => toggleConstraint(opt.key)} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {genError && <div className="mt-4 rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{genError}</div>}

          <div className="mt-5 flex justify-between">
            <button onClick={() => setStep(2)} className="rounded-[12px] px-5 py-2.5 text-[13.5px] font-semibold text-[#888]">上一步</button>
            <button onClick={handleOptimize} disabled={loading} className="flex h-[42px] items-center gap-2 whitespace-nowrap rounded-[12px] bg-[#1C1C1B] px-7 text-[13.5px] font-semibold text-white disabled:opacity-60">
              {loading ? "优化中…" : "开始优化"}
            </button>
          </div>
        </Card>
      )}

      {/* ───────── Step 4：结果 ───────── */}
      {step === 4 && (
        <>
          <ApiStatusPanel meta={apiMeta} />
          {genError && <div className="mb-6 rounded-[14px] bg-[#FCEBEB] px-5 py-4 text-[14px] font-semibold text-[#A32D2D]">{genError}</div>}
          {loading && (
            <div className="py-16 text-center text-[#8A8A86]">
              <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-4 border-[#EAF3DE] border-t-[#639922]" />
              <div className="text-[14px]">正在按「{targetIP?.name}」的风格、围绕「{goal}」目标优化，并核对锁定要素…</div>
            </div>
          )}
          {!loading && result && (
            <div className="flex flex-col gap-3">
              {/* 知识引用统计 + 可信度分层说明 */}
              <CitationSummary
                refs={knowledgeRefs}
                loading={knowledgeLoading}
                searched={knowledgeSearched}
                label="本次优化参考了"
              />
              {knowledgeSearched && (
                <div className="flex flex-wrap gap-2 rounded-[12px] bg-[#F7F6F2] px-4 py-3">
                  <span className="text-[12px] font-semibold text-[#555]">参考依据：</span>
                  <span className="flex items-center gap-1 text-[12px]">
                    <span className="rounded-full bg-[#EAF3DE] px-2 py-0.5 text-[11px] font-bold text-[#3B6D11]">高可信度</span>
                    <span className="text-[#666]">来自IP语料库口播样本</span>
                  </span>
                  <span className="text-[#E5E4DE]">·</span>
                  <span className="flex items-center gap-1 text-[12px]">
                    <span className="rounded-full bg-[#FBF3D6] px-2 py-0.5 text-[11px] font-bold text-[#7A5C00]">中可信度</span>
                    <span className="text-[#666]">来自知识库案例参考</span>
                  </span>
                  <span className="text-[#E5E4DE]">·</span>
                  <span className="flex items-center gap-1 text-[12px]">
                    <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[11px] font-bold text-[#888]">低可信度</span>
                    <span className="text-[#666]">AI自身推断</span>
                  </span>
                </div>
              )}
              <Card>
                <div className="mb-4 flex items-center justify-between">
                  <div className="text-[14.5px] font-bold text-[#1C1C1B]">优化结果</div>
                  <button onClick={() => setStep(3)} className="rounded-[10px] bg-[#F2F1ED] px-3 py-1.5 text-[12px] font-semibold text-[#555]">返回修改</button>
                </div>
                <ResultView data={result} />
              </Card>
            </div>
          )}
          {!loading && !result && !genError && (
            <div className="py-16 text-center text-[#8A8A86]">
              <p className="text-[13.5px]">还没有生成结果，返回上一步重新提交。</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
