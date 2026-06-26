"use client";
import { apiFetch } from "@/lib/api-fetch";
import { useState, useEffect } from "react";
import { useIP } from "@/lib/ip-context";
import { KnowledgeEntry, KnowledgeCategory, VoiceSample, HookEntry, KnowledgeItem, KnowledgeItemType, KnowledgeItemScene, KNOWLEDGE_ITEM_TYPE_LABEL, KNOWLEDGE_ITEM_SCENE_LABEL } from "@/lib/types";
import {
  getKnowledgeEntries, addKnowledgeEntry, deleteKnowledgeEntry, updateKnowledgeEntry,
  getAllVoiceSamples, addVoiceSample, deleteVoiceSample,
  getHookEntries, getUnanalyzedHookEntries, addHookEntry, addHookEntriesBatch, deleteHookEntry, applyHookAnalysisResults,
} from "@/lib/ip-store";
import { Icon } from "@/components/ui/icon";
import { Select, SelectOption } from "@/components/ui/select";
import { XlsxUploadPanel } from "@/components/ui/xlsx-upload-panel";
import { getAllKnowledgeItems, filterKnowledgeItems, countByType, countByScene, deleteKnowledgeItem } from "@/lib/knowledge-adapter";
import type { ImportedData } from "@/components/ui/xlsx-upload-panel";

type TabId = "爆款案例" | "方法论" | "评论需求" | "选题案例" | "IP语料库" | "复盘经验库" | "IP口播" | "Hook";
// MVP：5个核心分类，其余数据保留但入口隐藏
const TABS: { id: TabId; label: string; desc: string }[] = [
  { id: "爆款案例", label: "案例",     desc: "真实爆款内容的逐字稿/文案，供AI选题和脚本参考" },
  { id: "方法论",   label: "方法论",   desc: "选题方法论、内容架构、增长经验等通用知识" },
  { id: "Hook",     label: "钩子",     desc: "前3秒钩子素材库" },
  { id: "评论需求", label: "评论洞察", desc: "从评论区收集的真实用户需求和反馈" },
  { id: "IP语料库", label: "IP语料",   desc: "口播样本，供脚本工厂学习IP风格" },
];

type InputMethod = "paste" | "file" | "link" | "batch";
interface PendingItem {
  localId: string;
  rawContent: string;
  sourcePlatform: string;
  sourceUrl: string;
  fileName?: string;
  // 提取状态
  extracting: boolean;
  extractError: string | null;
  extracted: {
    title: string; tags: string[]; keywords: string[]; ipId: string | null;
    sourceTier: "高" | "中" | "低"; sourceTierReason: string; contentDirection: string[];
  } | null;
}

function genLocalId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

async function parseFileToText(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "txt" || ext === "md") return await file.text();
  if (ext === "srt") {
    const raw = await file.text();
    return raw.split(/\r?\n\r?\n+/).map(b => b.split(/\r?\n/).filter(l => l.trim() && !/^\d+$/.test(l.trim()) && !l.includes("-->")).join(" ")).filter(Boolean).join("\n");
  }
  if (ext === "docx") {
    const arrayBuffer = await file.arrayBuffer();
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }
  throw new Error(`不支持的文件格式：.${ext}，请改用 .txt / .md / .docx / .srt`);
}

const TIER_COLOR: Record<string, { bg: string; text: string }> = {
  "高": { bg: "#EAF3DE", text: "#3B6D11" },
  "中": { bg: "#FBF3D6", text: "#7A5C00" },
  "低": { bg: "#F2F1ED", text: "#888" },
};

function TierBadge({ tier }: { tier: "高" | "中" | "低" }) {
  // 高=已确认（人工确认/高置信），中=待确认（系统自动），低=需检查（字段缺失/异常）
  const label = tier === "高" ? "已确认" : tier === "低" ? "需检查" : "待确认";
  const c = TIER_COLOR[tier];
  return <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: c.bg, color: c.text }}>{label}</span>;
}

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  "未使用": { bg: "#F2F1ED", text: "#999" },
  "已用于选题": { bg: "#EAF3DE", text: "#3B6D11" },
  "已用于脚本": { bg: "#DCEFFA", text: "#1A5276" },
  "已用于分析": { bg: "#E9E6F7", text: "#5B3FA0" },
};
function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLOR[status] ?? STATUS_COLOR["未使用"];
  return <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: c.bg, color: c.text }}>{status}</span>;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[14px] border border-[#E5E4DE] bg-white p-5 ${className}`}>{children}</div>;
}

// ── 录入弹窗：覆盖 粘贴/上传/链接/批量 四种方式，统一走"提取→核对→保存"
// 注：只服务"方法论"和"评论"，"爆款案例"走下面专门的 AddViralCaseModal（字段和评估逻辑完全不同）──
function AddEntryModal({
  category, ips, onClose, onSaved,
}: {
  category: "方法论" | "评论需求" | "选题案例" | "IP语料库" | "复盘经验库";
  ips: { id: string; name: string; avatar: string; color: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [inputMethod, setInputMethod] = useState<InputMethod>("paste");
  const [pasteText, setPasteText] = useState("");
  const [sourcePlatform, setSourcePlatform] = useState("抖音");
  const [sourceUrl, setSourceUrl] = useState("");
  const [linkTranscript, setLinkTranscript] = useState("");
  const [fileParsing, setFileParsing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [items, setItems] = useState<PendingItem[]>([]);
  const [phase, setPhase] = useState<"input" | "review">("input");
  const [saving, setSaving] = useState(false);

  function buildItem(rawContent: string, fileName?: string): PendingItem {
    return { localId: genLocalId(), rawContent, sourcePlatform, sourceUrl, fileName, extracting: false, extractError: null, extracted: null };
  }

  async function handleSingleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError(null); setFileParsing(true);
    try {
      const text = await parseFileToText(file);
      setItems([buildItem(text, file.name)]);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "文件解析失败");
    } finally {
      setFileParsing(false);
    }
  }

  async function handleBatchFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setFileError(null); setFileParsing(true);
    const next: PendingItem[] = [];
    for (const file of files) {
      try {
        const text = await parseFileToText(file);
        next.push(buildItem(text, file.name));
      } catch (err) {
        setFileError(prev => `${prev ? prev + "；" : ""}${file.name}: ${err instanceof Error ? err.message : "解析失败"}`);
      }
    }
    setItems(prev => [...prev, ...next]);
    setFileParsing(false);
  }

  function proceedToExtract() {
    let pending = items;
    if (inputMethod === "paste" && pasteText.trim()) pending = [buildItem(pasteText.trim())];
    if (inputMethod === "link" && linkTranscript.trim()) pending = [buildItem(linkTranscript.trim())];
    if (pending.length === 0) return;
    setItems(pending);
    setPhase("review");
    pending.forEach(it => runExtract(it.localId, pending));
  }

  async function runExtract(localId: string, snapshot?: PendingItem[]) {
    setItems(prev => prev.map(it => it.localId === localId ? { ...it, extracting: true, extractError: null } : it));
    const target = (snapshot ?? items).find(it => it.localId === localId);
    if (!target) return;
    try {
      const res = await apiFetch("/api/knowledge-extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category, rawContent: target.rawContent, sourcePlatform: target.sourcePlatform, sourceUrl: target.sourceUrl,
          availableIPs: ips.map(ip => ({ id: ip.id, name: ip.name })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setItems(prev => prev.map(it => it.localId === localId ? { ...it, extracting: false, extractError: data.error ?? `HTTP ${res.status}` } : it));
        return;
      }
      setItems(prev => prev.map(it => it.localId === localId ? {
        ...it, extracting: false,
        extracted: { title: data.title, tags: data.tags, keywords: data.keywords, ipId: data.ipId, sourceTier: data.sourceTier, sourceTierReason: data.sourceTierReason, contentDirection: data.contentDirection },
      } : it));
    } catch (err) {
      setItems(prev => prev.map(it => it.localId === localId ? { ...it, extracting: false, extractError: err instanceof Error ? err.message : "提取失败" } : it));
    }
  }

  function updateExtracted(localId: string, patch: Partial<NonNullable<PendingItem["extracted"]>>) {
    setItems(prev => prev.map(it => it.localId === localId && it.extracted ? { ...it, extracted: { ...it.extracted, ...patch } } : it));
  }

  function removeItem(localId: string) {
    setItems(prev => prev.filter(it => it.localId !== localId));
  }

  function handleSaveAll() {
    setSaving(true);
    items.forEach(it => {
      if (!it.extracted) return;
      addKnowledgeEntry({
        category,
        title: it.extracted.title,
        rawContent: it.rawContent,
        tags: it.extracted.tags,
        keywords: it.extracted.keywords,
        ipId: it.extracted.ipId,
        sourceTier: it.extracted.sourceTier,
        sourceTierReason: it.extracted.sourceTierReason,
        contentDirection: it.extracted.contentDirection,
        sourcePlatform: it.sourcePlatform,
        sourceUrl: it.sourceUrl,
        note: "",
        extractedAt: new Date().toISOString(),
        metrics: null,
        viralEvaluation: null,
        usageRecords: [],
        status: "未使用",
        dna: null,
      });
    });
    setSaving(false);
    onSaved();
    onClose();
  }

  const readyCount = items.filter(it => it.extracted).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-[760px] overflow-hidden p-0" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#F0EFE9] px-5 py-4">
          <div className="text-[15px] font-bold text-[#1A1A1A]">添加到「{category}库」</div>
          <button onClick={onClose} className="text-[13px] text-[#999]">关闭</button>
        </div>

        <div className="max-h-[calc(90vh-72px)] overflow-y-auto p-5">
          {phase === "input" && (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                {([
                  { id: "paste", label: "粘贴文本" },
                  { id: "file", label: "上传文件" },
                  { id: "link", label: "视频链接" },
                  { id: "batch", label: "批量导入" },
                ] as { id: InputMethod; label: string }[]).map(m => (
                  <button
                    key={m.id} onClick={() => { setInputMethod(m.id); setItems([]); setFileError(null); }}
                    className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-all"
                    style={inputMethod === m.id ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#888" }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {inputMethod === "paste" && (
                <textarea
                  value={pasteText} onChange={e => setPasteText(e.target.value)}
                  placeholder="粘贴内容原文…"
                  rows={8}
                  className="w-full resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[13.5px] leading-6 outline-none focus:border-[#639922]"
                />
              )}

              {inputMethod === "file" && (
                <div className="flex flex-col gap-3">
                  <label className="w-fit cursor-pointer rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[12.5px] font-semibold text-white">
                    选择文件
                    <input type="file" accept=".txt,.md,.docx,.srt" className="hidden" onChange={handleSingleFile} />
                  </label>
                  <span className="text-[12px] text-[#888]">支持 .txt / .md / .docx / .srt</span>
                  {fileParsing && <div className="text-[12.5px] text-[#888]">解析中…</div>}
                  {items[0] && <div className="text-[12.5px] text-[#555]">已解析：<b>{items[0].fileName}</b>（{items[0].rawContent.length}字）</div>}
                </div>
              )}

              {inputMethod === "link" && (
                <div className="flex flex-col gap-3">
                  <div className="rounded-[10px] bg-[#FBF3D6] px-3 py-2.5 text-[12.5px] text-[#7A5C00]">
                    暂不支持自动抓取视频内容，请手动粘贴这个视频的逐字稿，链接会作为来源记录保存。
                  </div>
                  <textarea
                    value={linkTranscript} onChange={e => setLinkTranscript(e.target.value)}
                    placeholder="粘贴这个视频的逐字稿…"
                    rows={6}
                    className="w-full resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[13.5px] leading-6 outline-none focus:border-[#639922]"
                  />
                </div>
              )}

              {inputMethod === "batch" && (
                <div className="flex flex-col gap-3">
                  <label className="w-fit cursor-pointer rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[12.5px] font-semibold text-white">
                    选择多个文件
                    <input type="file" accept=".txt,.md,.docx,.srt" multiple className="hidden" onChange={handleBatchFiles} />
                  </label>
                  <span className="text-[12px] text-[#888]">可一次选择多个文件，每个文件会成为一条独立的知识库条目</span>
                  {fileParsing && <div className="text-[12.5px] text-[#888]">解析中…</div>}
                  {items.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      {items.map(it => (
                        <div key={it.localId} className="flex items-center justify-between rounded-[8px] bg-[#F7F6F2] px-3 py-2 text-[12.5px]">
                          <span className="text-[#333]">{it.fileName}（{it.rawContent.length}字）</span>
                          <button onClick={() => removeItem(it.localId)} className="text-[#A32D2D]">移除</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {fileError && <div className="mt-3 rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{fileError}</div>}

              <div className="mt-5 grid grid-cols-1 gap-3 border-t border-[#F0EFE9] pt-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[11.5px] font-semibold text-[#888]">来源平台</label>
                  <Select value={sourcePlatform} onChange={setSourcePlatform} options={["抖音", "小红书", "B站", "视频号", "线下课程", "书籍", "其他"]} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[11.5px] font-semibold text-[#888]">来源链接（可选）</label>
                  <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="有真实链接的话填上，会提升来源等级判断的准确性" className="w-full rounded-[10px] border border-[#E5E4DE] bg-white px-3 py-2 text-[13px]" />
                </div>
              </div>

              <div className="mt-5 flex justify-end">
                <button
                  onClick={proceedToExtract}
                  disabled={
                    (inputMethod === "paste" && !pasteText.trim()) ||
                    (inputMethod === "link" && !linkTranscript.trim()) ||
                    ((inputMethod === "file" || inputMethod === "batch") && items.length === 0)
                  }
                  className="flex h-[42px] items-center gap-2 rounded-[12px] bg-[#1C1C1B] px-7 text-[13.5px] font-semibold text-white disabled:opacity-40"
                >
                  开始提取 →
                </button>
              </div>
            </>
          )}

          {phase === "review" && (
            <>
              <div className="mb-3 text-[12.5px] text-[#888]">核对每一条的提取结果，尤其是"来源等级"——AI给的是建议，最终由你确认。</div>
              <div className="flex flex-col gap-4">
                {items.map(it => (
                  <div key={it.localId} className="rounded-[12px] border border-[#E5E4DE] p-3.5">
                    {it.extracting && <div className="text-[12.5px] text-[#888]">提取中…</div>}
                    {it.extractError && (
                      <div className="flex items-center justify-between">
                        <span className="text-[12.5px] text-[#A32D2D]">{it.extractError}</span>
                        <button onClick={() => runExtract(it.localId)} className="rounded-[8px] bg-[#F2F1ED] px-2.5 py-1 text-[11.5px] font-semibold text-[#555]">重试</button>
                      </div>
                    )}
                    {it.extracted && (
                      <div className="flex flex-col gap-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <input
                            value={it.extracted.title}
                            onChange={e => updateExtracted(it.localId, { title: e.target.value })}
                            className="flex-1 rounded-[8px] border border-[#E5E4DE] px-2.5 py-1.5 text-[13px] font-semibold"
                          />
                          <button onClick={() => removeItem(it.localId)} className="flex-shrink-0 text-[12px] text-[#A32D2D]">不保存这条</button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] text-[#888]">来源等级：</span>
                          {(["高", "中", "低"] as const).map(t => (
                            <button key={t} onClick={() => updateExtracted(it.localId, { sourceTier: t })}>
                              <span style={it.extracted!.sourceTier !== t ? { opacity: 0.35 } : undefined}><TierBadge tier={t} /></span>
                            </button>
                          ))}
                        </div>
                        <p className="text-[11.5px] text-[#999]">{it.extracted.sourceTierReason}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {it.extracted.tags.map((t, i) => <span key={i} className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[11px] text-[#555]">#{t}</span>)}
                        </div>
                        {ips.length > 0 && (
                          <div className="w-[200px]">
                            <Select
                              value={it.extracted.ipId ?? ""}
                              onChange={(v) => updateExtracted(it.localId, { ipId: v || null })}
                              placeholder="不归属任何IP（通用）"
                              options={[{ value: "", label: "不归属任何IP（通用）" }, ...ips.map((ip): SelectOption => ({ value: ip.id, label: ip.name, avatarText: ip.avatar, avatarColor: ip.color }))]}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-5 flex justify-between border-t border-[#F0EFE9] pt-4">
                <button onClick={() => setPhase("input")} className="rounded-[12px] px-5 py-2.5 text-[13.5px] font-semibold text-[#888]">上一步</button>
                <button
                  onClick={handleSaveAll} disabled={saving || readyCount === 0}
                  className="flex h-[42px] items-center gap-2 rounded-[12px] bg-[#1C1C1B] px-7 text-[13.5px] font-semibold text-white disabled:opacity-40"
                >
                  保存 {readyCount} 条到知识库
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 爆款案例库专用录入：真实指标输入 + 严格三层准入评估，字段和流程跟通用录入完全不同 ──
const GRADE_COLOR: Record<string, { bg: string; text: string }> = {
  "S": { bg: "#FCEBEB", text: "#A32D2D" },
  "A": { bg: "#FBF3D6", text: "#7A5C00" },
  "B": { bg: "#EAF3DE", text: "#3B6D11" },
  "不收录": { bg: "#F2F1ED", text: "#888" },
};
function GradeBadge({ grade }: { grade: string }) {
  const c = GRADE_COLOR[grade] ?? GRADE_COLOR["不收录"];
  return <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: c.bg, color: c.text }}>{grade === "不收录" ? "不收录" : `${grade}级素材`}</span>;
}

interface ViralEvalState {
  account: string; track: string; rawContent: string;
  likes: string; comments: string; shares: string; favorites: string; aboveAccountAverage: boolean;
  sourcePlatform: string; sourceUrl: string;
  ipId: string;
  evaluating: boolean; evalError: string | null;
  result: {
    hook: string; hookType: string | null;
    hookScore: { painPoint: number; curiosity: number; conflict: number; benefit: number; emotion: number; total: number };
    grade: string; whyViral: string; structureBreakdown: string;
    metricsLayerPassed: boolean; metricsLayerReason: string;
    contentLayerPassed: boolean; contentLayerMatched: string[];
    structureLayerPassed: boolean; structureLayerMissing: string[];
    exclusionMatched: string | null;
    selfCheckPassed: boolean; selfCheckReasoning: string;
    admitted: boolean;
  } | null;
}

function AddViralCaseModal({
  ips, onClose, onSaved,
}: { ips: { id: string; name: string; avatar: string; color: string }[]; onClose: () => void; onSaved: () => void }) {
  const [state, setState] = useState<ViralEvalState>({
    account: "", track: "", rawContent: "",
    likes: "", comments: "", shares: "", favorites: "", aboveAccountAverage: false,
    sourcePlatform: "抖音", sourceUrl: "", ipId: "",
    evaluating: false, evalError: null, result: null,
  });
  const [fileParsing, setFileParsing] = useState(false);
  const [overrideForce, setOverrideForce] = useState(false);

  function patch(p: Partial<ViralEvalState>) { setState(s => ({ ...s, ...p })); }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileParsing(true);
    try {
      const text = await parseFileToText(file);
      patch({ rawContent: text });
    } catch (err) {
      patch({ evalError: err instanceof Error ? err.message : "文件解析失败" });
    } finally {
      setFileParsing(false);
    }
  }

  async function handleEvaluate() {
    if (!state.rawContent.trim()) { patch({ evalError: "请提供口播内容原文" }); return; }
    patch({ evaluating: true, evalError: null, result: null });
    try {
      const res = await apiFetch("/api/knowledge-extract/viral-evaluate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawContent: state.rawContent, account: state.account, track: state.track,
          metrics: {
            likes: Number(state.likes) || 0, comments: Number(state.comments) || 0,
            shares: Number(state.shares) || 0, favorites: Number(state.favorites) || 0,
            aboveAccountAverage: state.aboveAccountAverage,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) { patch({ evaluating: false, evalError: data.error ?? `HTTP ${res.status}` }); return; }
      patch({ evaluating: false, result: data });
    } catch (err) {
      patch({ evaluating: false, evalError: err instanceof Error ? err.message : "评估失败" });
    }
  }

  function handleSave() {
    if (!state.result) return;
    const r = state.result;
    addKnowledgeEntry({
      category: "爆款案例",
      title: `${state.account || "未知账号"} · ${r.hook.slice(0, 20)}`,
      rawContent: state.rawContent,
      tags: r.hookType ? [r.hookType] : [],
      keywords: [],
      ipId: state.ipId || null,
      sourceTier: r.metricsLayerPassed ? "高" : "中",
      sourceTierReason: r.metricsLayerReason,
      contentDirection: state.track ? [state.track] : [],
      sourcePlatform: state.sourcePlatform,
      sourceUrl: state.sourceUrl,
      note: "",
      extractedAt: new Date().toISOString(),
      metrics: {
        likes: Number(state.likes) || 0, comments: Number(state.comments) || 0,
        shares: Number(state.shares) || 0, favorites: Number(state.favorites) || 0,
        aboveAccountAverage: state.aboveAccountAverage,
      },
      viralEvaluation: r as never,
      usageRecords: [],
      status: "未使用",
      dna: null,
    });
    onSaved();
    onClose();
  }

  const r = state.result;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-[760px] overflow-hidden p-0" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#F0EFE9] px-5 py-4">
          <div className="text-[15px] font-bold text-[#1A1A1A]">添加到「爆款案例库」——严格收录评估</div>
          <button onClick={onClose} className="text-[13px] text-[#999]">关闭</button>
        </div>

        <div className="max-h-[calc(90vh-72px)] overflow-y-auto p-5">
          {!r && (
            <>
              <textarea
                value={state.rawContent} onChange={e => patch({ rawContent: e.target.value })}
                placeholder="粘贴这条爆款内容的口播逐字稿…"
                rows={7}
                className="w-full resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[13.5px] leading-6 outline-none focus:border-[#639922]"
              />
              <div className="mt-2 flex items-center gap-3">
                <label className="w-fit cursor-pointer rounded-[10px] bg-[#F2F1ED] px-3 py-1.5 text-[12px] font-semibold text-[#555]">
                  或上传文件
                  <input type="file" accept=".txt,.md,.docx,.srt" className="hidden" onChange={handleFile} />
                </label>
                {fileParsing && <span className="text-[12px] text-[#888]">解析中…</span>}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 border-t border-[#F0EFE9] pt-4 sm:grid-cols-2">
                <input value={state.account} onChange={e => patch({ account: e.target.value })} placeholder="账号" className="rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13px]" />
                <input value={state.track} onChange={e => patch({ track: e.target.value })} placeholder="赛道，例如AI工具/职场" className="rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13px]" />
              </div>

              <div className="mt-3 rounded-[12px] bg-[#FBF3D6] p-3.5">
                <div className="mb-2 text-[11.5px] font-bold text-[#7A5C00]">指标层——填真实数据，AI不会替你判断这部分，满足任意一项才算通过</div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <input value={state.likes} onChange={e => patch({ likes: e.target.value.replace(/\D/g, "") })} placeholder="点赞数" className="rounded-[8px] border border-[#E5E4DE] bg-white px-2.5 py-1.5 text-[12.5px]" />
                  <input value={state.comments} onChange={e => patch({ comments: e.target.value.replace(/\D/g, "") })} placeholder="评论数" className="rounded-[8px] border border-[#E5E4DE] bg-white px-2.5 py-1.5 text-[12.5px]" />
                  <input value={state.shares} onChange={e => patch({ shares: e.target.value.replace(/\D/g, "") })} placeholder="转发数" className="rounded-[8px] border border-[#E5E4DE] bg-white px-2.5 py-1.5 text-[12.5px]" />
                  <input value={state.favorites} onChange={e => patch({ favorites: e.target.value.replace(/\D/g, "") })} placeholder="收藏数" className="rounded-[8px] border border-[#E5E4DE] bg-white px-2.5 py-1.5 text-[12.5px]" />
                </div>
                <label className="mt-2 flex items-center gap-2 text-[12px] text-[#7A5C00]">
                  <input type="checkbox" checked={state.aboveAccountAverage} onChange={e => patch({ aboveAccountAverage: e.target.checked })} />
                  播放量明显高于账号平均水平
                </label>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select value={state.sourcePlatform} onChange={(v) => patch({ sourcePlatform: v })} options={["抖音", "小红书", "B站", "视频号", "其他"]} />
                <input value={state.sourceUrl} onChange={e => patch({ sourceUrl: e.target.value })} placeholder="来源链接（可选）" className="rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13px]" />
              </div>

              {state.evalError && <div className="mt-3 rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{state.evalError}</div>}

              <div className="mt-5 flex justify-end">
                <button
                  onClick={handleEvaluate} disabled={state.evaluating || !state.rawContent.trim()}
                  className="flex h-[42px] items-center gap-2 rounded-[12px] bg-[#1C1C1B] px-7 text-[13.5px] font-semibold text-white disabled:opacity-40"
                >
                  {state.evaluating ? "评估中…" : "开始严格评估 →"}
                </button>
              </div>
            </>
          )}

          {r && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <GradeBadge grade={r.grade} />
                <span className="text-[12px] text-[#888]">钩子评分 {r.hookScore.total}/50</span>
              </div>

              <div className={`rounded-[12px] p-3.5 ${r.admitted ? "bg-[#EAF3DE]" : "bg-[#FCEBEB]"}`}>
                <div className="text-[13px] font-bold" style={{ color: r.admitted ? "#3B6D11" : "#A32D2D" }}>
                  {r.admitted ? "✓ AI建议收录" : "✗ AI建议不收录"}
                </div>
                {r.exclusionMatched && <div className="mt-1 text-[12px] text-[#A32D2D]">命中排除标准：{r.exclusionMatched}</div>}
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="rounded-[10px] bg-[#F7F6F2] p-3">
                  <div className="mb-1 text-[11px] font-bold text-[#666]">指标层（真实数据）</div>
                  <div className="text-[11.5px]" style={{ color: r.metricsLayerPassed ? "#3B6D11" : "#A32D2D" }}>{r.metricsLayerPassed ? "✓ 通过" : "✗ 未通过"}</div>
                  <p className="mt-0.5 text-[11px] text-[#888]">{r.metricsLayerReason}</p>
                </div>
                <div className="rounded-[10px] bg-[#F7F6F2] p-3">
                  <div className="mb-1 text-[11px] font-bold text-[#666]">内容层（≥2项）</div>
                  <div className="text-[11.5px]" style={{ color: r.contentLayerPassed ? "#3B6D11" : "#A32D2D" }}>{r.contentLayerPassed ? "✓ 通过" : "✗ 未通过"}</div>
                  <p className="mt-0.5 text-[11px] text-[#888]">{r.contentLayerMatched.join("、") || "无命中项"}</p>
                </div>
                <div className="rounded-[10px] bg-[#F7F6F2] p-3 sm:col-span-2">
                  <div className="mb-1 text-[11px] font-bold text-[#666]">结构层（4项全有）</div>
                  <div className="text-[11.5px]" style={{ color: r.structureLayerPassed ? "#3B6D11" : "#A32D2D" }}>{r.structureLayerPassed ? "✓ 通过" : `✗ 缺失：${r.structureLayerMissing.join("、")}`}</div>
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-bold text-[#666]">钩子评分明细</div>
                <div className="grid grid-cols-5 gap-1.5">
                  {([["痛点", r.hookScore.painPoint], ["好奇", r.hookScore.curiosity], ["冲突", r.hookScore.conflict], ["收益", r.hookScore.benefit], ["情绪", r.hookScore.emotion]] as [string, number][]).map(([label, v]) => (
                    <div key={label} className="rounded-[8px] bg-[#F7F6F2] p-2 text-center">
                      <div className="text-[10px] text-[#999]">{label}</div>
                      <div className="text-[14px] font-bold text-[#1C1C1B]">{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[10px] bg-[#F7F6F2] p-3">
                <div className="mb-1 text-[11px] font-bold text-[#666]">为什么爆 · 钩子类型：{r.hookType}</div>
                <p className="text-[12px] leading-5 text-[#333]">{r.whyViral}</p>
              </div>
              <div className="rounded-[10px] bg-[#F7F6F2] p-3">
                <div className="mb-1 text-[11px] font-bold text-[#666]">结构拆解</div>
                <p className="text-[12px] leading-5 text-[#333]">{r.structureBreakdown}</p>
              </div>
              <div className="rounded-[10px] bg-[#F7F6F2] p-3">
                <div className="mb-1 text-[11px] font-bold text-[#666]">自我检查：如果我是百万粉操盘手，我会收录吗？</div>
                <div className="text-[11.5px]" style={{ color: r.selfCheckPassed ? "#3B6D11" : "#A32D2D" }}>{r.selfCheckPassed ? "会" : "不会"}</div>
                <p className="mt-0.5 text-[12px] leading-5 text-[#333]">{r.selfCheckReasoning}</p>
              </div>

              {ips.length > 0 && (
                <div className="w-[200px]">
                  <Select
                    value={state.ipId} onChange={(v) => patch({ ipId: v })}
                    placeholder="不归属任何IP（通用参考）"
                    options={[{ value: "", label: "不归属任何IP（通用参考）" }, ...ips.map((ip): SelectOption => ({ value: ip.id, label: ip.name, avatarText: ip.avatar, avatarColor: ip.color }))]}
                  />
                </div>
              )}

              <div className="flex justify-between border-t border-[#F0EFE9] pt-4">
                <button onClick={() => patch({ result: null })} className="rounded-[12px] px-5 py-2.5 text-[13.5px] font-semibold text-[#888]">重新评估</button>
                {r.admitted ? (
                  <button onClick={handleSave} className="flex h-[42px] items-center gap-2 rounded-[12px] bg-[#1C1C1B] px-7 text-[13.5px] font-semibold text-white">保存到知识库</button>
                ) : overrideForce ? (
                  <button onClick={handleSave} className="flex h-[42px] items-center gap-2 rounded-[12px] bg-[#A32D2D] px-7 text-[13.5px] font-semibold text-white">确认强制保存（不推荐）</button>
                ) : (
                  <button onClick={() => setOverrideForce(true)} className="flex h-[42px] items-center gap-2 rounded-[12px] bg-[#F2F1ED] px-7 text-[13.5px] font-semibold text-[#888]">AI不建议收录，仍要保存？</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── IP口播库的添加表单（复用VoiceSample，独立简单流程） ──
function AddVoiceSampleModal({
  ips, onClose, onSaved,
}: { ips: { id: string; name: string; avatar: string; color: string }[]; onClose: () => void; onSaved: () => void }) {
  const [ipId, setIpId] = useState(ips[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<VoiceSample["type"]>("口播逐字稿");
  const [rawText, setRawText] = useState("");

  function handleSave() {
    if (!ipId || !rawText.trim()) return;
    addVoiceSample({ ipId, title: title.trim() || "未命名样本", type, rawText: rawText.trim(), note: "" });
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={onClose}>
      <div className="card w-full max-w-[560px] p-5" onClick={e => e.stopPropagation()}>
        <div className="mb-4 text-[15px] font-bold text-[#1A1A1A]">添加口播样本</div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1.5 block text-[11.5px] font-semibold text-[#888]">所属IP</label>
            <Select value={ipId} onChange={setIpId} options={ips.map((ip): SelectOption => ({ value: ip.id, label: ip.name, avatarText: ip.avatar, avatarColor: ip.color }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="样本标题" className="rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[12.5px]" />
            <Select value={type} onChange={(v) => setType(v as VoiceSample["type"])} options={["口播逐字稿", "文案", "视频字幕", "其他"]} />
          </div>
          <textarea value={rawText} onChange={e => setRawText(e.target.value)} placeholder="粘贴逐字稿原文…" rows={8} className="w-full resize-y rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 text-[12.5px] leading-5" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-[10px] px-4 py-2 text-[13px] text-[#888]">取消</button>
          <button onClick={handleSave} disabled={!ipId || !rawText.trim()} className="rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">保存</button>
        </div>
      </div>
    </div>
  );
}

// ── Hook知识库的添加表单：单条手填 + JSON批量粘贴（对接Codex这类外部采集工具的输出）──
function AddHookModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState<"single" | "batch">("single");
  // 单条
  const [hookText, setHookText] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [likes, setLikes] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [track, setTrack] = useState("");
  // 批量
  const [batchText, setBatchText] = useState("");
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchPreviewCount, setBatchPreviewCount] = useState<number | null>(null);

  function handleSaveSingle() {
    if (!hookText.trim()) return;
    addHookEntry({
      hookText: hookText.trim(), title: title.trim(), author: author.trim(), publishedAt,
      likesHistory: likes ? [{ value: Number(likes) || 0, capturedAt: new Date().toISOString() }] : [],
      sourceUrl, track, trackConfirmed: null, hookType: null,
    });
    onSaved();
    onClose();
  }

  function validateBatch(): { hookText: string; title: string; author: string; publishedAt: string; likesHistory: { value: number; capturedAt: string }[]; sourceUrl: string; track: string; trackConfirmed: null; hookType: null }[] | null {
    try {
      const parsed = JSON.parse(batchText);
      if (!Array.isArray(parsed)) { setBatchError("粘贴的内容必须是一个JSON数组"); return null; }
      const now = new Date().toISOString();
      const mapped = parsed.map((it: Record<string, unknown>, i: number) => {
        const ht = typeof it.hookText === "string" ? it.hookText : null;
        if (!ht) throw new Error(`第${i + 1}条缺少hookText字段`);
        const likesVal = typeof it.likes === "number" ? it.likes : (typeof it.likes === "string" ? Number(it.likes) : null);
        return {
          hookText: ht,
          title: typeof it.title === "string" ? it.title : "",
          author: typeof it.author === "string" ? it.author : "",
          publishedAt: typeof it.publishedAt === "string" ? it.publishedAt : "",
          likesHistory: likesVal != null && !isNaN(likesVal) ? [{ value: likesVal, capturedAt: now }] : [],
          sourceUrl: typeof it.sourceUrl === "string" ? it.sourceUrl : "",
          track: typeof it.track === "string" ? it.track : "",
          trackConfirmed: null, hookType: null,
        };
      });
      setBatchError(null);
      return mapped;
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "JSON格式不对，请检查");
      return null;
    }
  }

  function handlePreviewBatch() {
    const mapped = validateBatch();
    setBatchPreviewCount(mapped ? mapped.length : null);
  }

  function handleSaveBatch() {
    const mapped = validateBatch();
    if (!mapped) return;
    addHookEntriesBatch(mapped);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-[680px] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[15px] font-bold text-[#1A1A1A]">添加到Hook知识库</div>
          <button onClick={onClose} className="text-[13px] text-[#999]">关闭</button>
        </div>

        <div className="mb-4 flex gap-2">
          {([["single", "单条添加"], ["batch", "JSON批量粘贴"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setMode(id)} className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold"
              style={mode === id ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#888" }}>
              {label}
            </button>
          ))}
        </div>

        {mode === "single" && (
          <div className="flex flex-col gap-3">
            <textarea value={hookText} onChange={e => setHookText(e.target.value)} placeholder="钩子原文（前3秒内容）…" rows={3} className="w-full resize-y rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 text-[13px] leading-5" />
            <div className="grid grid-cols-2 gap-2.5">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="标题" className="rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[12.5px]" />
              <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="作者/账号" className="rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[12.5px]" />
              <input value={publishedAt} onChange={e => setPublishedAt(e.target.value)} placeholder="发布时间，例如2026-06-01" className="rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[12.5px]" />
              <input value={likes} onChange={e => setLikes(e.target.value.replace(/\D/g, ""))} placeholder="点赞数" className="rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[12.5px]" />
              <input value={track} onChange={e => setTrack(e.target.value)} placeholder="赛道" className="rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[12.5px]" />
              <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="链接（可选）" className="rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[12.5px]" />
            </div>
            <div className="mt-2 flex justify-end">
              <button onClick={handleSaveSingle} disabled={!hookText.trim()} className="rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">保存</button>
            </div>
          </div>
        )}

        {mode === "batch" && (
          <div className="flex flex-col gap-3">
            <div className="rounded-[10px] bg-[#F7F6F2] p-3 text-[11.5px] leading-5 text-[#666]">
              粘贴一个JSON数组，每条至少要有 <code>hookText</code>，其余字段可选：<code>title/author/publishedAt/likes/sourceUrl/track</code>。这一层不做实时深度分析，纯粹入库，钩子类型和赛道复核留给"批量分析"按钮统一处理。
            </div>
            <textarea
              value={batchText} onChange={e => { setBatchText(e.target.value); setBatchPreviewCount(null); setBatchError(null); }}
              placeholder={'[\n  {"hookText": "90%的人学AI的方法都错了", "title": "...", "author": "...", "likes": 18400, "track": "AI工具"}\n]'}
              rows={10}
              className="w-full resize-y rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 font-mono text-[12px] leading-5"
            />
            {batchError && <div className="rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{batchError}</div>}
            {batchPreviewCount != null && !batchError && <div className="text-[12.5px] text-[#3B6D11]">格式正确，共{batchPreviewCount}条，可以保存。</div>}
            <div className="flex justify-end gap-2">
              <button onClick={handlePreviewBatch} className="rounded-[10px] bg-[#F2F1ED] px-4 py-2.5 text-[13px] font-semibold text-[#555]">校验格式</button>
              <button onClick={handleSaveBatch} disabled={!batchText.trim()} className="rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">批量保存</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function KnowledgeHubPage() {
  const { ips, loading: ipLoading } = useIP();
  // 视图模式：legacy=旧Tab视图（完整保留），unified=新统一视图（筛选器）
  const [viewMode, setViewMode] = useState<"legacy" | "unified">("legacy");
  const [tab, setTab] = useState<TabId>("爆款案例");
  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "ip">("all");
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [voiceSamples, setVoiceSamples] = useState<VoiceSample[]>([]);
  const [hookEntries, setHookEntries] = useState<HookEntry[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showXlsx, setShowXlsx] = useState(false);
  const [xlsxImportResult, setXlsxImportResult] = useState<{ count: number; skipped: number } | null>(null);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<KnowledgeEntry | null>(null);

  // 统一视图状态
  const [uniItems, setUniItems] = useState<KnowledgeItem[]>([]);
  const [uniTypeFilter, setUniTypeFilter] = useState<KnowledgeItemType[]>([]);
  const [uniSceneFilter, setUniSceneFilter] = useState<KnowledgeItemScene[]>([]);
  const [uniSearch, setUniSearch] = useState("");
  const [uniTypeCounts, setUniTypeCounts] = useState<Record<KnowledgeItemType, number>>({ case: 0, method: 0, hook: 0, insight: 0, script: 0, persona: 0 });

  // 重建管道状态
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<{ total: number; succeeded: number; skipped: number; failed: number; typeDistribution: Record<string, number> } | null>(null);

  async function handleRebuild(dryRun: boolean) {
    setRebuildLoading(true); setRebuildResult(null);
    try {
      const res = await apiFetch("/api/knowledge/rebuild", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun, batchSize: 20, confidenceThreshold: 0.55 }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error ?? "重建失败"); return; }
      setRebuildResult({
        total: data.total, succeeded: data.succeeded,
        skipped: data.skipped, failed: data.failed,
        typeDistribution: data.summary?.typeDistribution ?? {},
      });
      if (!dryRun) refreshUnified();
    } catch (err) {
      alert(err instanceof Error ? err.message : "网络错误");
    } finally { setRebuildLoading(false); }
  }

  function refreshUnified() {
    const items = filterKnowledgeItems({
      types: uniTypeFilter.length > 0 ? uniTypeFilter : undefined,
      scenes: uniSceneFilter.length > 0 ? uniSceneFilter : undefined,
      keyword: uniSearch.trim() || undefined,
    });
    setUniItems(items);
    setUniTypeCounts(countByType());
  }

  useEffect(() => {
    if (viewMode === "unified") refreshUnified();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, uniTypeFilter, uniSceneFilter, uniSearch]);

  // 监听旧Tab写入后的刷新（旧Tab通过ip-store写localStorage，统一视图自动同步）
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key?.startsWith("ipwr:knowledge") && viewMode === "unified") {
        refreshUnified();
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, uniTypeFilter, uniSceneFilter, uniSearch]);

  const [importScope, setImportScope] = useState<"global" | "ip">("global");

  function handleXlsxImport(data: ImportedData) {
    if (data.mode !== "knowledge" || !data.knowledgeRows) return;
    let count = 0; let skipped = 0;
    for (const row of data.knowledgeRows) {
      if (!row.title && !row.content) { skipped++; continue; }
      addKnowledgeEntry({
        category: tab as KnowledgeCategory,
        title: row.title || row.content.slice(0, 30),
        rawContent: row.content || row.title,
        tags: row.tags ? row.tags.split(/[,，、]/).map(t => t.trim()).filter(Boolean) : [],
        keywords: [],
        ipId: importScope === "ip" ? (activeIP?.id ?? null) : null,
        sourceTier: "低",
        sourceTierReason: "从Excel批量导入，字段自动识别，分类待人工确认",
        contentDirection: [],
        sourcePlatform: "Excel导入",
        sourceUrl: "",
        note: "",
        extractedAt: new Date().toISOString(),
        metrics: null, viralEvaluation: null, usageRecords: [], status: "未使用", dna: null,
      });
      count++;
    }
    setXlsxImportResult({ count, skipped });
    setShowXlsx(false);
    refresh();
  }

  // Hook知识库批量分析状态
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ current: number; total: number } | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  function refresh() {
    if (tab === "IP口播") setVoiceSamples(getAllVoiceSamples());
    else if (tab === "Hook") setHookEntries(getHookEntries());
    else setEntries(getKnowledgeEntries(tab as KnowledgeCategory));
  }
  useEffect(refresh, [tab]);

  async function handleBatchAnalyze() {
    const pending = getUnanalyzedHookEntries();
    if (pending.length === 0) return;
    setAnalyzing(true); setAnalyzeError(null);
    const CHUNK = 150;
    const chunks: HookEntry[][] = [];
    for (let i = 0; i < pending.length; i += CHUNK) chunks.push(pending.slice(i, i + CHUNK));

    for (let i = 0; i < chunks.length; i++) {
      setAnalyzeProgress({ current: i + 1, total: chunks.length });
      const chunk = chunks[i];
      try {
        const res = await apiFetch("/api/knowledge-extract/hook-batch-analyze", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: chunk.map(h => ({ id: h.id, hookText: h.hookText, track: h.track })) }),
        });
        const data = await res.json();
        if (!res.ok) { setAnalyzeError(data.error ?? `第${i + 1}批失败`); continue; }
        applyHookAnalysisResults(data.results);

        // 只重试这一批里漏掉的，不重试整批
        const returnedIds = new Set(data.results.map((r: { id: string }) => r.id));
        const missed = chunk.filter(h => !returnedIds.has(h.id));
        if (missed.length > 0) {
          const retryRes = await apiFetch("/api/knowledge-extract/hook-batch-analyze", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: missed.map(h => ({ id: h.id, hookText: h.hookText, track: h.track })) }),
          });
          const retryData = await retryRes.json();
          if (retryRes.ok) applyHookAnalysisResults(retryData.results);
        }
      } catch (err) {
        setAnalyzeError(err instanceof Error ? err.message : `第${i + 1}批网络错误`);
      }
    }
    setAnalyzing(false); setAnalyzeProgress(null);
    refresh();
  }

  const ipMap = new Map(ips.map(ip => [ip.id, ip]));
  const q = search.trim().toLowerCase();
  const filteredEntries = entries.filter(e => {
    // scope 过滤：global=ipId为空, ip=ipId有值
    if (scopeFilter === "global" && e.ipId) return false;
    if (scopeFilter === "ip" && !e.ipId) return false;
    return true;
  }).filter(e =>
    !q || e.title.toLowerCase().includes(q) || e.tags.some(t => t.toLowerCase().includes(q)) || e.keywords.some(k => k.toLowerCase().includes(q))
  );
  const filteredSamples = voiceSamples.filter(s => !q || s.title.toLowerCase().includes(q));
  const filteredHooks = hookEntries.filter(h => !q || h.hookText.toLowerCase().includes(q) || h.title.toLowerCase().includes(q));
  const unanalyzedCount = hookEntries.filter(h => !h.analyzed).length;

  return (
    <div className="min-h-screen p-6 md:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[13px] text-[#8A8A86]">
            <a href="/" className="font-semibold text-[#639922]">工作台</a> / 知识库中心
          </div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1B]">知识库中心</h1>
          <p className="mt-1.5 max-w-[640px] text-[13.5px] leading-6 text-[#8A8A86]">
            FlowPilot的底层数据中心。AI模块不应凭空生成结论，应优先检索这里积累的真实案例、口播样本、方法论和评论作为依据。
          </p>
        </div>
        {/* 统一视图入口暂隐藏（MVP阶段）*/}
      </header>

      {/* ════════ 统一视图（V2）════════ */}
      {viewMode === "unified" && (
        <div className="flex flex-col gap-4">
          {/* 类型统计 */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {(Object.entries(uniTypeCounts) as [KnowledgeItemType, number][]).map(([type, count]) => (
              <button key={type} onClick={() => setUniTypeFilter(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])}
                className="flex flex-col items-center rounded-[12px] border py-3 transition"
                style={{ borderColor: uniTypeFilter.includes(type) ? "#1C1C1B" : "#E5E4DE", background: uniTypeFilter.includes(type) ? "#1C1C1B" : "#fff" }}>
                <span className="text-[20px] font-bold" style={{ color: uniTypeFilter.includes(type) ? "#C8F04A" : "#1C1C1B" }}>{count}</span>
                <span className="text-[11px]" style={{ color: uniTypeFilter.includes(type) ? "#aaa" : "#8A8A86" }}>{KNOWLEDGE_ITEM_TYPE_LABEL[type]}</span>
              </button>
            ))}
          </div>

          {/* 场景筛选 + 搜索 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-[#888]">场景：</span>
            {(["idea", "script", "analysis", "comment", "review"] as KnowledgeItemScene[]).map(scene => (
              <button key={scene} onClick={() => setUniSceneFilter(prev => prev.includes(scene) ? prev.filter(s => s !== scene) : [...prev, scene])}
                className="rounded-full px-3 py-1 text-[11.5px] font-semibold"
                style={uniSceneFilter.includes(scene) ? { background: "#639922", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}>
                {KNOWLEDGE_ITEM_SCENE_LABEL[scene]}
              </button>
            ))}
            <input value={uniSearch} onChange={e => setUniSearch(e.target.value)}
              placeholder="搜索全库…" className="ml-auto h-[36px] w-[200px] rounded-[10px] border border-[#E5E4DE] px-3 text-[13px] outline-none focus:border-[#639922]" />
            {(uniTypeFilter.length > 0 || uniSceneFilter.length > 0 || uniSearch) && (
              <button onClick={() => { setUniTypeFilter([]); setUniSceneFilter([]); setUniSearch(""); }} className="text-[12px] text-[#A32D2D]">清除筛选</button>
            )}
          </div>

          {/* 条目列表 */}
          <div className="text-[12px] text-[#8A8A86]">共 {uniItems.length} 条知识资产</div>

          {/* 重建管道入口 */}
          <div className="rounded-[12px] border border-[#E5E4DE] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-bold text-[#1C1C1B]">知识库重建管道</div>
                <p className="mt-0.5 text-[11.5px] text-[#8A8A86]">
                  对现有条目重新语义分类：语义解析 → 多标签候选 → 唯一类型裁决 → confidence过滤 → 写入新KnowledgeItem
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleRebuild(true)} disabled={rebuildLoading}
                  className="rounded-[10px] bg-[#F2F1ED] px-4 py-2 text-[12.5px] font-semibold text-[#555] disabled:opacity-40">
                  {rebuildLoading ? "处理中…" : "演练（不写入）"}
                </button>
                <button onClick={() => handleRebuild(false)} disabled={rebuildLoading}
                  className="rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40">
                  {rebuildLoading ? "重建中…" : "执行重建"}
                </button>
              </div>
            </div>
            {rebuildResult && (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-[8px] bg-[#EAF3DE] p-2 text-center">
                  <div className="text-[18px] font-bold text-[#3B6D11]">{rebuildResult.succeeded}</div>
                  <div className="text-[11px] text-[#3B6D11]">成功重建</div>
                </div>
                <div className="rounded-[8px] bg-[#FBF3D6] p-2 text-center">
                  <div className="text-[18px] font-bold text-[#7A5C00]">{rebuildResult.skipped}</div>
                  <div className="text-[11px] text-[#7A5C00]">跳过（置信度低）</div>
                </div>
                <div className="rounded-[8px] bg-[#FCEBEB] p-2 text-center">
                  <div className="text-[18px] font-bold text-[#A32D2D]">{rebuildResult.failed}</div>
                  <div className="text-[11px] text-[#A32D2D]">失败</div>
                </div>
                <div className="rounded-[8px] bg-[#F7F6F2] p-2 text-center">
                  <div className="text-[18px] font-bold text-[#1C1C1B]">{rebuildResult.total}</div>
                  <div className="text-[11px] text-[#888]">处理总量</div>
                </div>
                {Object.entries(rebuildResult.typeDistribution).length > 0 && (
                  <div className="col-span-2 sm:col-span-4 rounded-[8px] bg-[#F7F6F2] px-3 py-2">
                    <span className="text-[11px] text-[#888]">类型分布：</span>
                    {Object.entries(rebuildResult.typeDistribution).map(([type, count]) => (
                      <span key={type} className="ml-2 text-[11.5px] font-semibold text-[#1C1C1B]">
                        {KNOWLEDGE_ITEM_TYPE_LABEL[type as KnowledgeItemType] ?? type} {count}条
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {uniItems.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[#E5E4DE] py-12 text-center text-[13px] text-[#BBB]">
              没有符合条件的知识资产，去「分类视图」添加第一条
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {uniItems.map(item => (
                <div key={item.id} className="rounded-[12px] border border-[#E5E4DE] bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10.5px] font-bold text-[#555]">
                        {KNOWLEDGE_ITEM_TYPE_LABEL[item.type]}
                      </span>
                      {item.scene.map(s => (
                        <span key={s} className="rounded-full bg-[#EAF3DE] px-2 py-0.5 text-[10px] text-[#3B6D11]">
                          {KNOWLEDGE_ITEM_SCENE_LABEL[s]}
                        </span>
                      ))}
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{ background: item.sourceTier === "高" ? "#EAF3DE" : item.sourceTier === "中" ? "#FBF3D6" : "#F2F1ED", color: item.sourceTier === "高" ? "#3B6D11" : item.sourceTier === "中" ? "#7A5C00" : "#888" }}>
                        {item.sourceTier === "高" ? "已确认" : item.sourceTier === "低" ? "需检查" : "待确认"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.usageCount > 0 && (
                        <span className="text-[11px] text-[#639922]">被引用 {item.usageCount} 次</span>
                      )}
                      <button onClick={() => { deleteKnowledgeItem(item.id); refreshUnified(); }} className="text-[#BBB] hover:text-[#A32D2D]">
                        <Icon name="trash" size="sm" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-1.5 text-[13px] font-semibold text-[#1C1C1B]">{item.title}</p>
                  <p className="mt-1 text-[12px] leading-5 text-[#555] line-clamp-2">{item.content}</p>
                  {item.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {item.tags.map((t, i) => <span key={i} className="rounded-full bg-[#F7F6F2] px-2 py-0.5 text-[10.5px] text-[#666]">#{t}</span>)}
                    </div>
                  )}
                  {item.usedByModules.length > 0 && (
                    <p className="mt-1 text-[11px] text-[#BBB]">引用模块：{item.usedByModules.join("、")}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════════ 旧分类视图（完整保留）════════ */}
      {viewMode === "legacy" && (<>

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map(t => (
          <button
            key={t.id} onClick={() => setTab(t.id)}
            className="rounded-[12px] px-4 py-2.5 text-left text-[13px] font-semibold transition-all"
            style={tab === t.id ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mb-3 text-[12.5px] text-[#999]">{TABS.find(t => t.id === tab)?.desc}</p>
      {/* 范围筛选 */}
      <div className="mb-4 flex items-center gap-1.5">
        <span className="text-[11.5px] text-[#888]">范围：</span>
        {([["all","全部"],["global","通用知识库"],["ip","当前IP语料"]] as const).map(([v,l]) => (
          <button key={v} onClick={() => setScopeFilter(v)}
            className="rounded-full px-3 py-1 text-[11.5px] font-semibold transition-all"
            style={scopeFilter === v ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}>
            {l}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="按标题/标签/关键词搜索…"
          className="h-[40px] w-full max-w-[320px] rounded-[10px] border border-[#E5E4DE] bg-white px-3 text-[13px] outline-none focus:border-[#639922]"
        />
        <div className="flex items-center gap-2">
          {tab === "Hook" && (
            <>
              <span className="text-[12px] text-[#888]">{unanalyzedCount}条待分析</span>
              <button
                onClick={handleBatchAnalyze}
                disabled={analyzing || unanalyzedCount === 0}
                className="flex h-[40px] items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-[#EAF3DE] px-4 text-[12.5px] font-semibold text-[#3B6D11] disabled:opacity-40"
              >
                {analyzing ? `分析中 第${analyzeProgress?.current ?? 0}/${analyzeProgress?.total ?? 0}批` : "开始批量分析"}
              </button>
            </>
          )}
          <button
            onClick={() => setShowAdd(true)}
            disabled={ipLoading}
            className="flex h-[40px] items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-[#1C1C1B] px-4 text-[12.5px] font-semibold text-white disabled:opacity-50"
          >
            <Icon name="plus" size="sm" /> 添加{tab === "IP口播" ? "口播样本" : tab === "Hook" ? "钩子" : "条目"}
          </button>
          {tab !== "IP口播" && tab !== "Hook" && (
            <button onClick={() => { setShowXlsx(v => !v); setXlsxImportResult(null); }}
              className="flex h-[40px] items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-[#EAF3DE] px-4 text-[12.5px] font-semibold text-[#3B6D11]">
              📊 从 Excel 批量导入
            </button>
          )}
        </div>
      </div>
      {analyzeError && <div className="mb-4 rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{analyzeError}</div>}
      {xlsxImportResult && (
        <div className="mb-4 rounded-[10px] bg-[#EAF3DE] px-3 py-2 text-[12.5px] text-[#3B6D11]">
          ✓ 成功导入 {xlsxImportResult.count} 条{xlsxImportResult.skipped > 0 ? `，跳过 ${xlsxImportResult.skipped} 条空行` : ""}
        </div>
      )}
        {showXlsx && (
          <div className="mb-2 flex items-center gap-2 rounded-[10px] bg-[#F7F6F2] px-3 py-2">
            <span className="text-[12px] font-semibold text-[#555]">导入到：</span>
            {([["global","通用知识库"],["ip","当前IP语料"]] as const).map(([v,l]) => (
              <button key={v} onClick={() => setImportScope(v)}
                className="rounded-full px-3 py-1 text-[11.5px] font-semibold"
                style={importScope === v ? { background: "#1C1C1B", color: "#fff" } : { background: "#E5E4DE", color: "#666" }}>
                {l}
              </button>
            ))}
            <span className="ml-2 text-[11px] text-[#AAA]">
              {importScope === "ip" ? "将绑定到当前IP" : "不绑定IP，所有IP可调用"}
            </span>
          </div>
        )}
      {showXlsx && (
        <div className="mb-4">
          <XlsxUploadPanel mode="knowledge" onImport={handleXlsxImport} onClose={() => setShowXlsx(false)} />
        </div>
      )}

      {tab === "IP口播" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
          {filteredSamples.length === 0 && (
            <div className="col-span-full rounded-[14px] border border-dashed border-[#E5E4DE] py-12 text-center text-[13px] text-[#999]">还没有口播样本，点击右上角添加。</div>
          )}
          {filteredSamples.map(s => {
            const ip = ipMap.get(s.ipId);
            return (
              <Card key={s.id}>
                <div className="mb-2 flex items-center justify-between">
                  {ip && (
                    <span className="flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: ip.color }}>
                      <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: ip.color }}>{ip.avatar}</span>
                      {ip.name}
                    </span>
                  )}
                  <button onClick={() => { deleteVoiceSample(s.id); refresh(); }} className="text-[#999] hover:text-[#A32D2D]"><Icon name="trash" size="sm" /></button>
                </div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-[#1C1C1B]">{s.title}</span>
                  <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10px] text-[#888]">{s.type}</span>
                </div>
                <p className="line-clamp-2 text-[11.5px] leading-5 text-[#999]">{s.rawText.slice(0, 80)}…</p>
                <div className="mt-2 text-[10.5px] text-[#BBB]">{s.rawText.trim().length}字 · {new Date(s.createdAt).toLocaleDateString()}</div>
              </Card>
            );
          })}
        </div>
      ) : tab === "Hook" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
          {filteredHooks.length === 0 && (
            <div className="col-span-full rounded-[14px] border border-dashed border-[#E5E4DE] py-12 text-center text-[13px] text-[#999]">还没有钩子，点击右上角添加。</div>
          )}
          {filteredHooks.map(h => {
            const latestLikes = h.likesHistory.length > 0 ? h.likesHistory[h.likesHistory.length - 1].value : null;
            return (
              <Card key={h.id}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <span className="text-[13px] font-semibold leading-5 text-[#1C1C1B]">{h.hookText}</span>
                  <button onClick={() => { deleteHookEntry(h.id); refresh(); }} className="flex-shrink-0 text-[#999] hover:text-[#A32D2D]"><Icon name="trash" size="sm" /></button>
                </div>
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  {h.analyzed ? (
                    <span className="rounded-full bg-[#EAF3DE] px-2 py-0.5 text-[10px] font-semibold text-[#3B6D11]">{h.hookType}</span>
                  ) : (
                    <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10px] text-[#999]">未分析</span>
                  )}
                  <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10px] text-[#666]">{h.trackConfirmed || h.track || "未分类"}</span>
                </div>
                <div className="text-[11px] text-[#999]">{h.title}{h.author ? ` · ${h.author}` : ""}</div>
                <div className="mt-2 flex items-center justify-between text-[10.5px] text-[#BBB]">
                  <span>{latestLikes != null ? `${latestLikes}赞` : "无点赞数据"} · {h.publishedAt || "未知日期"}</span>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
          {filteredEntries.length === 0 && (
            <div className="col-span-full rounded-[14px] border border-dashed border-[#E5E4DE] py-12 text-center text-[13px] text-[#999]">还没有条目，点击右上角添加。</div>
          )}
          {filteredEntries.map(e => {
            const ip = e.ipId ? ipMap.get(e.ipId) : null;
            return (
              <Card key={e.id} className="relative flex cursor-pointer flex-col overflow-hidden hover:border-[#639922]">
                <div className="min-w-0 flex-1" onClick={() => setDetail(e)}>
                  {/* 标题 + 徽章：flex 布局，左侧标题 flex-1 min-w-0，右侧徽章 flex-shrink-0 */}
                  <div className="mb-2 flex items-start gap-2">
                    <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold leading-5 text-[#1C1C1B]">{e.title}</span>
                    <span className="flex-shrink-0">
                      {e.viralEvaluation
                        ? <GradeBadge grade={e.viralEvaluation.grade} />
                        : <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${e.ipId ? "bg-[#DBEAFE] text-[#1D4ED8]" : "bg-[#EAF3DE] text-[#3B6D11]"}`}>
                            {e.ipId ? "IP语料" : "通用知识"}
                          </span>
                      }
                    </span>
                  </div>
                  {/* 状态 + 标签：每个 tag 有 max-w 和 truncate 防止 URL 撑破 */}
                  <div className="mb-2 flex flex-wrap items-center gap-1">
                    <StatusBadge status={e.status} />
                    {e.usageRecords.length > 0 && <span className="text-[10.5px] text-[#999]">被引用{e.usageRecords.length}次</span>}
                    {e.tags.slice(0, 4).map((t, i) => (
                      <span key={i} className="max-w-[160px] truncate rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10.5px] text-[#666]">#{t}</span>
                    ))}
                  </div>
                  {/* 摘要：最多3行 */}
                  <p className="line-clamp-3 text-[11.5px] leading-5 text-[#999]">{e.rawContent.slice(0, 150)}</p>
                </div>
                {/* 底部：来源左侧截断，删除按钮右侧固定 */}
                <div className="mt-2 flex min-w-0 items-center justify-between gap-2 border-t border-[#F0EFE9] pt-2">
                  <span className="min-w-0 truncate text-[10.5px] text-[#BBB]">{e.sourcePlatform} · {new Date(e.createdAt).toLocaleDateString()}{ip ? ` · ${ip.name}` : ""}</span>
                  <button onClick={ev => { ev.stopPropagation(); deleteKnowledgeEntry(e.id); refresh(); }} className="flex-shrink-0 text-[#BBB] hover:text-[#A32D2D]"><Icon name="trash" size="sm" /></button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {showAdd && tab === "IP口播" && (
        <AddVoiceSampleModal ips={ips} onClose={() => setShowAdd(false)} onSaved={refresh} />
      )}
      {showAdd && tab === "Hook" && (
        <AddHookModal onClose={() => setShowAdd(false)} onSaved={refresh} />
      )}
      {showAdd && tab === "爆款案例" && (
        <AddViralCaseModal ips={ips} onClose={() => setShowAdd(false)} onSaved={refresh} />
      )}
      {showAdd && (tab === "方法论" || tab === "评论需求" || tab === "选题案例" || tab === "IP语料库" || tab === "复盘经验库") && (
        <AddEntryModal category={tab as "方法论" | "评论需求" | "选题案例" | "IP语料库" | "复盘经验库"} ips={ips} onClose={() => setShowAdd(false)} onSaved={refresh} />
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={() => setDetail(null)}>
          <div className="card max-h-[85vh] w-full max-w-[640px] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="mb-1 flex items-start justify-between gap-2">
              <span className="text-[16px] font-bold text-[#1C1C1B]">{detail.title}</span>
              {detail.viralEvaluation ? <GradeBadge grade={detail.viralEvaluation.grade} /> : <TierBadge tier={detail.sourceTier} />}
            </div>
            <p className="mb-3 text-[11.5px] text-[#999]">{detail.sourceTierReason}</p>

            {detail.viralEvaluation && (
              <div className="mb-3 flex flex-col gap-2 rounded-[12px] bg-[#FBFEF2] border border-[#E4F0C0] p-3.5">
                <div className="text-[11px] font-bold text-[#639922]">钩子评分 {detail.viralEvaluation.hookScore.total}/50 · {detail.viralEvaluation.hookType}</div>
                <p className="text-[12px] leading-5 text-[#444]">{detail.viralEvaluation.whyViral}</p>
                <p className="text-[11.5px] leading-5 text-[#666]">{detail.viralEvaluation.structureBreakdown}</p>
                {detail.metrics && (
                  <div className="text-[11px] text-[#888]">真实数据：点赞{detail.metrics.likes} · 评论{detail.metrics.comments} · 转发{detail.metrics.shares} · 收藏{detail.metrics.favorites}</div>
                )}
              </div>
            )}

            <div className="mb-3 flex flex-wrap gap-1.5">
              {detail.tags.map((t, i) => <span key={i} className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[11px] text-[#555]">#{t}</span>)}
            </div>
            <div className="mb-3 whitespace-pre-wrap rounded-[12px] bg-[#F7F6F2] p-4 text-[13px] leading-6 text-[#333]">{detail.rawContent}</div>
            <div className="text-[11.5px] text-[#888]">关键词：{detail.keywords.join("、") || "无"}</div>
            <div className="text-[11.5px] text-[#888]">内容方向：{detail.contentDirection.join("、") || "无"}</div>
            {detail.sourceUrl && <div className="text-[11.5px] text-[#888]">来源链接：{detail.sourceUrl}</div>}

            <div className="mt-4 border-t border-[#F0EFE9] pt-3.5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[12px] font-bold text-[#666]">知识流转</span>
                <StatusBadge status={detail.status} />
              </div>
              {detail.usageRecords.length === 0 ? (
                <p className="text-[12px] text-[#999]">还没有被任何模块引用过。</p>
              ) : (
                <>
                  <p className="mb-2 text-[12px] text-[#666]">
                    共被引用 {detail.usageRecords.length} 次，涉及模块：{Array.from(new Set(detail.usageRecords.map(r => r.module))).join("、")}
                  </p>
                  <div className="flex flex-col gap-2">
                    {detail.usageRecords.slice().reverse().map((r) => (
                      <div key={r.id} className="rounded-[10px] bg-[#F7F6F2] p-2.5">
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                          <span className="text-[11.5px] font-semibold text-[#1C1C1B]">{r.module}</span>
                          <span className="text-[10.5px] text-[#999]">{new Date(r.usedAt).toLocaleString()}</span>
                        </div>
                        <div className="mb-1 flex items-center gap-1.5">
                          <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: r.relevanceTier === "高度相关" ? "#EAF3DE" : r.relevanceTier === "中度相关" ? "#FBF3D6" : "#F2F1ED", color: r.relevanceTier === "高度相关" ? "#3B6D11" : r.relevanceTier === "中度相关" ? "#7A5C00" : "#888" }}>
                            {r.relevanceTier}
                          </span>
                        </div>
                        <p className="text-[11.5px] leading-5 text-[#444]">引用原因：{r.reason}</p>
                        <p className="text-[11px] leading-5 text-[#999]">{r.relevanceReason}</p>
                        {r.context && <p className="mt-1 text-[10.5px] text-[#BBB]">检索输入：{r.context.slice(0, 60)}{r.context.length > 60 ? "…" : ""}</p>}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button onClick={() => setDetail(null)} className="rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[13px] font-semibold text-white">关闭</button>
            </div>
          </div>
        </div>
      )}
      </> /* viewMode === legacy */ )
      }
    </div>
  );
}
