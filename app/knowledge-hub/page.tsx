"use client";
import { apiFetch } from "@/lib/api-fetch";
import { useState, useEffect, useRef } from "react";
import { useIP } from "@/lib/ip-context";
import { getIPDisplayLabel } from "@/lib/ip-display";
import { KnowledgeEntry, KnowledgeCategory, VoiceSample, HookEntry, KnowledgeItem, KnowledgeItemType, KnowledgeItemScene, KNOWLEDGE_ITEM_TYPE_LABEL, KNOWLEDGE_ITEM_SCENE_LABEL, ScriptAsset, VideoReview } from "@/lib/types";
import {
  getKnowledgeEntries, addKnowledgeEntry, deleteKnowledgeEntryFromLibrary, updateKnowledgeEntry,
  getAllVoiceSamples, addVoiceSample, deleteVoiceSample,
  getHookEntries, getUnanalyzedHookEntries, addHookEntry, addHookEntriesBatch, deleteHookEntry, applyHookAnalysisResults,
  getCoverRefs, getGlobalCoverRefs, addCoverRef, deleteCoverRef,
  getScriptAssets, getVideoReviewsReadOnly,
  saveIPSourceLegacyProof,
  type CoverRef,
} from "@/lib/ip-store";
import { Icon } from "@/components/ui/icon";
import { Select, SelectOption } from "@/components/ui/select";
import { XlsxUploadPanel } from "@/components/ui/xlsx-upload-panel";
import { getAllKnowledgeItems, filterKnowledgeItems, countByType, countByScene, deleteKnowledgeItem } from "@/lib/knowledge-adapter";
import type { ImportedData } from "@/components/ui/xlsx-upload-panel";
import { searchKnowledgeEntries } from "@/lib/knowledge-search-utils";
import { ALL_NEW_CATS, GLOBAL_CATEGORIES, IP_CATEGORIES, getNormalizedCategory, type GlobalCategoryId, type IPCategoryId } from "@/lib/knowledge-categories";
import {
  getKnowledgeHubCorrectionCategories,
  getKnowledgeHubAddAction,
  getKnowledgeHubIntakeHref,
  isKnowledgeHubCorrectionAllowed,
  KNOWLEDGE_HUB_LEGACY_SECTIONS,
  matchesKnowledgeHubSection,
  type KnowledgeHubSection,
} from "@/lib/knowledge-hub-view";
import { buildKnowledgeEffectReference, createKnowledgeEffectReferenceIndex } from "@/lib/knowledge-effect-reference";
import { assessVideoReviewTraceability } from "@/lib/review-traceability";
import { KnowledgeLibraryBrowser } from "@/components/knowledge/KnowledgeLibraryBrowser";
import { getLegacyIPSourceAnalysisItems } from "@/lib/ip-source-analysis-v2";

const SOURCE_ANALYSIS_KIND_LABEL: Record<string, string> = {
  question: "老师在回答什么",
  claim: "明确观点",
  reasoning: "推理过程",
  evidence: "案例／事实／数据",
  concept: "概念区分",
  topic: "可延展选题",
  expression: "表达特征",
};

type TabId = "爆款案例" | "方法论" | "评论需求" | "选题案例" | "IP语料库" | "复盘经验库" | "IP口播" | "Hook";
// MVP：5个核心分类，其余数据保留但入口隐藏
const TABS: { id: TabId; label: string; desc: string }[] = [
  { id: "爆款案例", label: "案例",     desc: "真实爆款内容的逐字稿/文案，供AI选题和脚本参考" },
  { id: "方法论",   label: "方法论",   desc: "选题方法论、内容架构、增长经验等通用知识" },
  { id: "Hook",     label: "钩子",     desc: "前3秒钩子参考" },
  { id: "评论需求", label: "评论洞察", desc: "从评论区收集的真实用户需求和反馈" },
  { id: "IP语料库", label: "IP语料",   desc: "口播样本，供脚本工厂学习IP风格" },
];


function cleanRawContent(raw: string): string {
  return raw.split("\n").filter(line => {
    const t = line.trim();
    if (!t) return false;
    if (t.startsWith("分类JSON:")) return false;
    if (t.startsWith("{") && t.includes('"category"')) return false;
    return true;
  }).join("\n").trim();
}

function formatHistoricalMetric(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString()
    : "—";
}

function parseMethodMeta(note: string): {
  methodCard?: boolean;
  coreMethod?: string;
  applicableScenarios?: string[];
  triggerKeywords?: string[];
  aiUsage?: string;
  unsuitableCases?: string[];
} | null {
  try {
    const parsed = JSON.parse(note || "{}");
    return parsed?.methodCard ? parsed : null;
  } catch {
    return null;
  }
}

// ── 封面参考 ──
const COVER_IMAGE_DB = "flowpilot-cover-images";
const COVER_IMAGE_STORE = "images";

function openCoverImageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(COVER_IMAGE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(COVER_IMAGE_STORE)) db.createObjectStore(COVER_IMAGE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function putCoverImage(key: string, dataUrl: string): Promise<void> {
  const db = await openCoverImageDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(COVER_IMAGE_STORE, "readwrite");
      tx.objectStore(COVER_IMAGE_STORE).put(dataUrl, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
async function getCoverImage(key: string): Promise<string> {
  const db = await openCoverImageDb();
  try {
    return await new Promise<string>((resolve, reject) => {
      const tx = db.transaction(COVER_IMAGE_STORE, "readonly");
      const req = tx.objectStore(COVER_IMAGE_STORE).get(key);
      req.onsuccess = () => {
        if (typeof req.result !== "string" || !req.result) {
          reject(new Error("封面图片数据缺失"));
          return;
        }
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
async function deleteCoverImage(key: string): Promise<void> {
  const db = await openCoverImageDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(COVER_IMAGE_STORE, "readwrite");
      tx.objectStore(COVER_IMAGE_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
async function hydrateCoverImages(refs: CoverRef[]): Promise<CoverRef[]> {
  const hydrated = await Promise.all(refs.map(async ref => {
    if (ref.imageKey && !ref.imageDataUrl) {
      return { ...ref, imageDataUrl: await getCoverImage(ref.imageKey) };
    }
    return ref;
  }));
  return hydrated.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function loadCoverRefs(activeIPId: string | null): Promise<CoverRef[]> {
  const refs = activeIPId ? getCoverRefs(activeIPId) : getGlobalCoverRefs();
  return hydrateCoverImages(refs);
}
async function addCoverRefWithImage(
  activeIPId: string,
  input: Omit<CoverRef, "id" | "imageKey" | "scope" | "ipId" | "createdAt" | "updatedAt">,
): Promise<CoverRef> {
  const imageKey = `cover-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await putCoverImage(imageKey, input.imageDataUrl);
  try {
    const entry = addCoverRef(activeIPId, { ...input, imageKey, imageDataUrl: "" });
    return { ...entry, imageDataUrl: input.imageDataUrl };
  } catch (error) {
    try { await deleteCoverImage(imageKey); } catch { /* 清理失败不覆盖原始保存错误 */ }
    throw error;
  }
}
async function deleteCoverRefWithImage(id: string, activeIPId: string): Promise<void> {
  const target = deleteCoverRef(id, activeIPId);
  if (target.imageKey) {
    try { await deleteCoverImage(target.imageKey); } catch { /* 元数据已安全删除，残留图片稍后清理 */ }
  }
}

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
                  <Select value={sourcePlatform} onChange={setSourcePlatform} options={["抖音", "小红书", "B站", "视频号", "线下课程", "书籍", "其他"].map(v => ({ value: v, label: v }))} />
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
                              options={[{ value: "", label: "不归属任何IP（通用）" }, ...ips.map((ip): SelectOption => ({ value: ip.id, label: getIPDisplayLabel(ip, ips), avatarText: ip.avatar, avatarColor: ip.color }))]}
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
                <Select value={state.sourcePlatform} onChange={(v) => patch({ sourcePlatform: v })} options={["抖音","小红书","B站","视频号","其他"].map(v=>({value:v,label:v}))} />
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
                    options={[{ value: "", label: "不归属任何IP（通用参考）" }, ...ips.map((ip): SelectOption => ({ value: ip.id, label: getIPDisplayLabel(ip, ips), avatarText: ip.avatar, avatarColor: ip.color }))]}
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
            <Select value={ipId} onChange={setIpId} options={ips.map((ip): SelectOption => ({ value: ip.id, label: getIPDisplayLabel(ip, ips), avatarText: ip.avatar, avatarColor: ip.color }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="样本标题" className="rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[12.5px]" />
            <Select value={type} onChange={(v) => setType(v as VoiceSample["type"])} options={["口播逐字稿","文案","视频字幕","其他"].map(v=>({value:v,label:v}))} />
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

function getCoverTitleClass(charCount: number) {
  if (charCount <= 0) {
    return { charCount, coverType: "待填写字数", textStyle: "", layout: "", tags: [] as string[], referenceReason: "" };
  }
  if (charCount <= 6) {
    return {
      charCount,
      coverType: "短标题封面",
      textStyle: `${charCount}字标题`,
      layout: "中心大标题",
      tags: ["字少", "强识别", "适合大字"],
      referenceReason: "适合作为少字大标题封面参考，重点学习标题怎么一眼说清主题。",
    };
  }
  if (charCount <= 12) {
    return {
      charCount,
      coverType: "标准标题封面",
      textStyle: `${charCount}字标题`,
      layout: "主标题突出",
      tags: ["标准字数", "信息清晰", "适合口播"],
      referenceReason: "适合作为常规知识类封面参考，标题信息完整，后续可按这个标题方向生成封面。",
    };
  }
  return {
    charCount,
    coverType: "长标题封面",
    textStyle: `${charCount}字标题`,
    layout: "标题分行",
    tags: ["字多", "信息型", "需要分行"],
    referenceReason: "适合作为信息量较高的封面参考，后续生成封面时应控制分行，避免画面拥挤。",
  };
}

function AddCoverModal({ activeIPId, onClose, onSaved }: {
  activeIPId: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const coverImageAccept = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
  const coverImageMaxMb = 10;
  const [form, setForm] = useState({ mainTitleCount: "", platform: "抖音", sourceUrl: "" });
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [error, setError] = useState("");
  const mainTitleCount = Number(form.mainTitleCount);
  const titleClass = getCoverTitleClass(Number.isFinite(mainTitleCount) ? mainTitleCount : 0);

  async function readCoverImage(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = ev => resolve(ev.target?.result as string);
      reader.onerror = () => reject(new Error("read-failed"));
      reader.readAsDataURL(file);
    });
  }

  async function compressCoverImage(dataUrl: string) {
    return new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 1200;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(dataUrl); return; }
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    const name = file.name.toLowerCase();
    const supported = /\.(jpe?g|png|webp)$/i.test(name) || ["image/jpeg", "image/png", "image/webp"].includes(file.type);
    if (!supported) {
      setError("暂时只支持jpg、png、webp格式");
      e.target.value = "";
      return;
    }
    if (file.size > coverImageMaxMb*1024*1024) {
      setError(`图片不能超过 ${coverImageMaxMb}MB`);
      e.target.value = "";
      return;
    }
    readCoverImage(file).then(async dataUrl => {
      const optimizedDataUrl = await compressCoverImage(dataUrl);
      setImageDataUrl(optimizedDataUrl);
    }).catch(() => {
      setError("图片读取失败，请换一张jpg、png或webp图片");
    });
  }
  async function handleSave() {
    if (!imageDataUrl) { setError("请上传封面图片"); return; }
    const saveTitleCount = Number(String(form.mainTitleCount).replace(/[^\d]/g, ""));
    if (!Number.isFinite(saveTitleCount) || saveTitleCount <= 0) { setError("请填写大标题字数"); return; }
    const nextClass = getCoverTitleClass(saveTitleCount);
    try {
      await addCoverRefWithImage(activeIPId, {
        title: `${saveTitleCount}字大标题封面`,
        imageDataUrl,
        platform: form.platform,
        contentType: "封面标题参考",
        coverType: nextClass.coverType,
        visualTags: nextClass.tags,
        textStyle: nextClass.textStyle,
        layout: nextClass.layout,
        colorStyle: "",
        referenceReason: nextClass.referenceReason,
        avoidReason: "",
        sourceUrl: form.sourceUrl,
      });
      await onSaved();
    } catch {
      setError("保存失败，请刷新页面后再试。如果还失败，把旧的大图封面删除几张。");
    }
  }
  const set = (k: string, v: string) => {
    if (error) setError("");
    setForm(prev => ({ ...prev, [k]: v }));
  };
  const handleTitleCountChange = (value: string) => {
    const nextValue = value.replace(/[^\d]/g, "");
    set("mainTitleCount", nextValue);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-[520px] flex-col overflow-hidden rounded-[18px] bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#F0EFE9] px-6 py-4">
          <span className="text-[15px] font-bold text-[#1C1C1B]">添加封面参考</span>
          <button onClick={onClose} className="text-[12px] text-[#999]">取消</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">
          <div>
	            <label className="mb-1.5 block text-[11.5px] font-semibold text-[#666]">封面图片 *</label>
	            {imageDataUrl ? (
	              <div className="relative">
	                <img src={imageDataUrl} alt="预览" className="w-full max-h-[180px] object-contain rounded-[10px] bg-[#F7F6F2]" />
	                <button
                  onClick={() => setImageDataUrl("")}
	                  className="absolute top-2 right-2 rounded-full bg-white px-2 py-0.5 text-[11px] text-[#A32D2D] shadow"
	                >
	                  移除
	                </button>
	              </div>
	            ) : (
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-[10px] border-2 border-dashed border-[#E5E4DE] py-8 hover:border-[#639922]">
                <span className="text-[24px]">🖼</span>
                <span className="text-[12.5px] text-[#888]">点击上传封面图片（jpg/png/webp，≤{coverImageMaxMb}MB）</span>
                <input type="file" accept={coverImageAccept} onChange={handleImage} className="hidden" />
              </label>
	            )}
	          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-[11.5px] font-semibold text-[#666]">平台</label><select value={form.platform} onChange={e => set("platform", e.target.value)} className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13px]">{["抖音","小红书","视频号","B站"].map(p => <option key={p}>{p}</option>)}</select></div>
            <div>
	              <label className="mb-1 block text-[11.5px] font-semibold text-[#666]">大标题字数 *</label>
	              <input
                value={form.mainTitleCount}
                onChange={e => handleTitleCountChange(e.target.value)}
                inputMode="numeric"
                placeholder="例如 4"
                className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13px] outline-none focus:border-[#639922]"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-[#666]">自动分类</label>
            <div className="rounded-[10px] border border-[#E5E4DE] bg-[#F7F6F2] px-3 py-2 text-[13px] text-[#555]">
              {titleClass.charCount > 0 ? `${titleClass.coverType} · ${titleClass.charCount}字` : "填写大标题字数后自动判断"}
            </div>
          </div>
          {titleClass.charCount > 0 && (
            <div className="rounded-[10px] bg-[#F7FCF0] px-3 py-2.5 text-[12.5px] leading-5 text-[#3B6D11]">
              {titleClass.referenceReason}
            </div>
          )}
          <div><label className="mb-1 block text-[11.5px] font-semibold text-[#666]">来源链接（可选）</label><input value={form.sourceUrl} onChange={e => set("sourceUrl", e.target.value)} placeholder="https://…" className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13px] outline-none focus:border-[#639922]" /></div>
          {error && <div className="rounded-[8px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#F0EFE9] px-6 py-4">
          <button onClick={onClose} className="rounded-[10px] bg-[#F2F1ED] px-5 py-2 text-[13px] font-semibold text-[#666]">取消</button>
          <button onClick={handleSave} className="rounded-[10px] bg-[#1C1C1B] px-5 py-2 text-[13px] font-bold text-white">保存封面参考</button>
        </div>
      </div>
    </div>
  );
}

export default function KnowledgeHubPage() {
  const { ips, loading: ipLoading, activeIP } = useIP();
  // 默认只读浏览；原有录入、导入和专项库能力收在次级管理入口。
  const [viewMode, setViewMode] = useState<"browse" | "legacy" | "unified">("browse");
  const [scopeFilter, setScopeFilter] = useState<KnowledgeHubSection>("global");
  const [globalCatFilter, setGlobalCatFilter] = useState<GlobalCategoryId>("定位方法库");
  const [ipCatFilter, setIpCatFilter] = useState<IPCategoryId>("IP人设资料");
  const [coverRefs, setCoverRefs] = useState<CoverRef[]>([]);
  const [coverSearch, setCoverSearch] = useState("");
  const [coverPlatformFilter, setCoverPlatformFilter] = useState("全部");
  const [coverLoadError, setCoverLoadError] = useState<string | null>(null);
  const coverRequestIdRef = useRef(0);
  const activeCoverIPIdRef = useRef<string | null>(activeIP?.id ?? null);
  activeCoverIPIdRef.current = activeIP?.id ?? null;
  const [showAddCover, setShowAddCover] = useState(false);
  const [coverDetail, setCoverDetail] = useState<CoverRef | null>(null);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [knowledgeEffectScripts, setKnowledgeEffectScripts] = useState<ScriptAsset[]>([]);
  const [traceableVideoReviews, setTraceableVideoReviews] = useState<VideoReview[]>([]);
  const [retainedReviewIdByRemovedId, setRetainedReviewIdByRemovedId] = useState<ReadonlyMap<string, string>>(new Map());
  const [voiceSamples, setVoiceSamples] = useState<VoiceSample[]>([]);
  const [hookEntries, setHookEntries] = useState<HookEntry[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showXlsx, setShowXlsx] = useState(false);
  const [xlsxImportResult, setXlsxImportResult] = useState<{ count: number; skipped: number; catDist?: Record<string, number> } | null>(null);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<KnowledgeEntry | null>(null);
  const [registeringLegacyId, setRegisteringLegacyId] = useState<string | null>(null);
  const [legacyRegistrationError, setLegacyRegistrationError] = useState<string | null>(null);

  useEffect(() => {
    const scope = new URLSearchParams(window.location.search).get("scope");
    if (["global", "ip", "viral", "hook", "voice", "material"].includes(scope ?? "")) {
      setScopeFilter(scope as KnowledgeHubSection);
      setViewMode("legacy");
    }
  }, []);

  // 统一视图状态
  const [uniItems, setUniItems] = useState<KnowledgeItem[]>([]);
  const [uniTypeFilter, setUniTypeFilter] = useState<KnowledgeItemType[]>([]);
  const [uniSceneFilter, setUniSceneFilter] = useState<KnowledgeItemScene[]>([]);
  const [uniSearch, setUniSearch] = useState("");
  const [uniTypeCounts, setUniTypeCounts] = useState<Record<KnowledgeItemType, number>>({ source: 0, case: 0, method: 0, hook: 0, insight: 0, script: 0, persona: 0 });

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
    if (scopeFilter === "ip" && ipCatFilter === "IP原始内容") {
      setXlsxImportResult(null);
      setAnalyzeError("IP原始内容必须保存完整原文和可追溯解析，不能从Excel普通条目导入。");
      setShowXlsx(false);
      return;
    }
    let count = 0; let skipped = 0;
    const catDist: Record<string, number> = {};
    const targetIPId = importScope === "ip" ? (activeIP?.id?.trim() ?? "") : null;
    const allowedCategories = getKnowledgeHubCorrectionCategories(targetIPId);
    if (allowedCategories.length === 0) {
      setXlsxImportResult({ count: 0, skipped: data.knowledgeRows.length, catDist });
      setShowXlsx(false);
      return;
    }
    // 旧分类到新分类的映射表（用于兼容）
    const LEGACY_MAP: Record<string, string> = {
      "案例": "选题方法库", "方法论": "文案框架方法库", "钩子": "开头方法库",
      "评论洞察": "选题方法库", "IP语料": "IP表达语料", "Hook": "开头方法库",
    };
    // 标题关键词规则
    const TITLE_RULES: [string[], string][] = [
      [["定位拆解","账号定位","人设定位","受众定位","差异化定位"], "定位方法库"],
      [["选题拆解","选题","爆款选题","内容角度"], "选题方法库"],
      [["标题拆解","标题公式","爆款标题"], "标题方法库"],
      [["开头拆解","开头","3秒钩子","钩子","开场","hook"], "开头方法库"],
      [["文案框架","脚本框架","口播框架","故事框架","起承转合"], "文案框架方法库"],
    ];

    for (const row of data.knowledgeRows) {
      if (!row.title && !row.content) { skipped++; continue; }
      const title_r = (row.title || "").toLowerCase();
      const content_r = (row.content || "").toLowerCase();
      const rawTagsStr = row.tags || "";
      const tags_r = rawTagsStr.split(/[,，、；;]/).map((t: string) => t.trim()).filter(Boolean);

      let autoCategory: KnowledgeCategory = "方法论";
      let confidence: "高" | "中" | "低" = "低";
      let reason = "";
      let matchedRules: string[] = [];
      let originalCategory = "";
      let needsReview = true;

      // 1. 直接命中新分类（最高优先级）
      const directMatch = ALL_NEW_CATS.find(cat => rawTagsStr.includes(cat));
      if (directMatch) {
        autoCategory = directMatch as KnowledgeCategory;
        confidence = "高";
        reason = `标签字段直接包含新分类名「${directMatch}」`;
        matchedRules = [directMatch];
        needsReview = false;
      } else {
        // 2. 标题关键词匹配
        let titleHit = false;
        for (const [keywords, cat] of TITLE_RULES) {
          const hit = keywords.filter(k => title_r.includes(k));
          if (hit.length > 0) {
            autoCategory = cat as KnowledgeCategory;
            confidence = "高";
            reason = `标题命中关键词：${hit.join("、")}`;
            matchedRules = hit;
            needsReview = false;
            titleHit = true;
            break;
          }
        }
        if (!titleHit) {
          // 3. 内容关键词匹配
          let contentHit = false;
          for (const [keywords, cat] of TITLE_RULES) {
            const hit = keywords.filter(k => content_r.includes(k));
            if (hit.length >= 2) {
              autoCategory = cat as KnowledgeCategory;
              confidence = "中";
              reason = `正文多次出现关键词：${hit.join("、")}`;
              matchedRules = hit;
              needsReview = false;
              contentHit = true;
              break;
            }
          }
          if (!contentHit) {
            // 4. 旧分类兼容映射（最低优先级）
            const legacyCat = tags_r.find(t => LEGACY_MAP[t]);
            if (legacyCat) {
              originalCategory = legacyCat;
              autoCategory = LEGACY_MAP[legacyCat] as KnowledgeCategory;
              confidence = "低";
              reason = `旧分类「${legacyCat}」映射为「${LEGACY_MAP[legacyCat]}」，建议人工确认`;
              matchedRules = [legacyCat];
              needsReview = true;
            } else {
              // 5. 完全无法识别 → 待确认
              autoCategory = "方法论"; // 存储用旧分类兜底
              confidence = "低";
              reason = "无法识别分类，建议人工确认";
              needsReview = true;
            }
          }
        }
      }

      if (!isKnowledgeHubCorrectionAllowed(targetIPId, autoCategory)) {
        const rejectedCategory = autoCategory;
        autoCategory = allowedCategories[0] as KnowledgeCategory;
        confidence = "低";
        reason = `识别结果「${rejectedCategory}」不属于当前知识范围，已改为「${autoCategory}」并等待人工确认`;
        matchedRules = [];
        needsReview = true;
      }

      // 构建分类证据链存入note
      const categoryEvidence = JSON.stringify({
        originalCategory: originalCategory || autoCategory,
        normalizedCategory: autoCategory,
        confidence,
        reason,
        matchedRules,
        needsReview,
      });

      addKnowledgeEntry({
        category: autoCategory,
        title: row.title || row.content.slice(0, 30),
        rawContent: row.content || row.title,
        tags: tags_r,
        keywords: matchedRules,
        ipId: targetIPId,
        sourceTier: confidence === "高" ? "高" : confidence === "中" ? "中" : "低",
        sourceTierReason: reason,
        contentDirection: [],
        sourcePlatform: "Excel导入",
        sourceUrl: "",
        note: categoryEvidence,
        extractedAt: new Date().toISOString(),
        metrics: null, viralEvaluation: null, usageRecords: [], status: "未使用", dna: null,
      });

      // 导入报告用归一化分类统计
      const displayCat = getNormalizedCategory({ category: autoCategory, tags: tags_r, ipId: targetIPId, title: row.title || "" });
      catDist[displayCat] = (catDist[displayCat] ?? 0) + 1;
      count++;
    }
    setXlsxImportResult({ count, skipped, catDist });
    setShowXlsx(false);
    refresh();
  }

  // Hook知识库批量分析状态
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ current: number; total: number } | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  function refresh() {
    setEntries(getKnowledgeEntries());
    setVoiceSamples(getAllVoiceSamples());
    setHookEntries(getHookEntries());
  }

  async function registerLegacySource(entry: KnowledgeEntry) {
    if (registeringLegacyId || !activeIP || entry.ipId !== activeIP.id
      || entry.sourceAnalysis?.parserVersion !== 1) return;
    setRegisteringLegacyId(entry.id);
    setLegacyRegistrationError(null);
    try {
      const response = await apiFetch("/api/ip-source-analysis/legacy/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeIPId: activeIP.id,
          sourceIPId: entry.ipId,
          sourceId: entry.id,
          rawContent: entry.rawContent,
          analysis: entry.sourceAnalysis,
        }),
      });
      const result = await response.json() as { legacyProof?: string; error?: string };
      if (!response.ok || !result.legacyProof?.trim()) {
        throw new Error(result.error ?? "V1认知登记失败");
      }
      const updated = saveIPSourceLegacyProof(entry.id, result.legacyProof);
      setDetail(updated);
      refresh();
    } catch (error) {
      setLegacyRegistrationError(error instanceof Error ? error.message : "V1认知登记失败");
    } finally {
      setRegisteringLegacyId(null);
    }
  }
  useEffect(() => {
    if (viewMode !== "legacy") {
      setEntries([]);
      setVoiceSamples([]);
      setHookEntries([]);
      return;
    }
    refresh();
  }, [viewMode]);
  useEffect(() => {
    if (viewMode !== "legacy") {
      setKnowledgeEffectScripts([]);
      setTraceableVideoReviews([]);
      setRetainedReviewIdByRemovedId(new Map());
      return;
    }
    setKnowledgeEffectScripts(ips.flatMap(ip => getScriptAssets(ip.id)));
    const reviewSnapshot = getVideoReviewsReadOnly();
    setTraceableVideoReviews(
      reviewSnapshot.reviews.filter(
        review => assessVideoReviewTraceability(review) === "traceable",
      ),
    );
    setRetainedReviewIdByRemovedId(reviewSnapshot.retainedReviewIdByRemovedId);
  }, [ips, viewMode]);
  async function refreshCovers() {
    const requestId = ++coverRequestIdRef.current;
    const requestedIPId = activeIP?.id ?? null;
    try {
      const refs = await loadCoverRefs(requestedIPId);
      if (
        requestId !== coverRequestIdRef.current
        || requestedIPId !== activeCoverIPIdRef.current
      ) return;
      setCoverRefs(refs);
      setCoverLoadError(null);
    } catch (error) {
      if (
        requestId !== coverRequestIdRef.current
        || requestedIPId !== activeCoverIPIdRef.current
      ) return;
      setCoverRefs([]);
      setCoverLoadError(error instanceof Error ? error.message : "封面参考读取失败");
    }
  }
  useEffect(() => {
    setDetail(null);
    setCoverDetail(null);
    setShowAddCover(false);
    if (viewMode !== "legacy") {
      setCoverRefs([]);
      setCoverLoadError(null);
      coverRequestIdRef.current += 1;
      return;
    }
    void refreshCovers();
    return () => { coverRequestIdRef.current += 1; };
    // 当前IP改变时必须重新按归属读取封面。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIP?.id, viewMode]);

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
  const selectedCategory = scopeFilter === "global"
    ? globalCatFilter
    : scopeFilter === "ip"
      ? ipCatFilter
      : null;
  const legacyEntries = viewMode === "legacy" ? entries : [];
  const legacyVoiceSamples = viewMode === "legacy" ? voiceSamples : [];
  const legacyHookEntries = viewMode === "legacy" ? hookEntries : [];
  const scopeEntries = legacyEntries.filter(e => matchesKnowledgeHubSection({
    category: e.category,
    normalizedCategory: getNormalizedCategory(e),
    ipId: e.ipId,
  }, {
    section: scopeFilter,
    selectedCategory: null,
    activeIPId: activeIP?.id ?? null,
  }));
  const scopedEntries = legacyEntries.filter(e => matchesKnowledgeHubSection({
    category: e.category,
    normalizedCategory: getNormalizedCategory(e),
    ipId: e.ipId,
  }, {
    section: scopeFilter,
    selectedCategory,
    activeIPId: activeIP?.id ?? null,
  }));
  const searchSourceEntries = q ? scopeEntries : scopedEntries;
  const filteredEntries = q
    ? searchKnowledgeEntries(q, searchSourceEntries.map(e => ({
      ...e,
      normalizedCategory: getNormalizedCategory(e),
      content: e.rawContent,
      summary: e.note,
      referenceReason: e.sourceTierReason,
      note: e.note,
      metadata: { sourcePlatform: e.sourcePlatform, contentDirection: e.contentDirection, viralEvaluation: e.viralEvaluation },
    })), { limit: searchSourceEntries.length || 1, minScore: 2 }).results
      .map(match => searchSourceEntries.find(e => e.id === match.id))
      .filter((e): e is KnowledgeEntry => Boolean(e))
    : scopedEntries;
  const knowledgeEffectIndex = createKnowledgeEffectReferenceIndex(
    knowledgeEffectScripts,
    traceableVideoReviews,
    retainedReviewIdByRemovedId,
  );
  const knowledgeEffectByEntryId = new Map(legacyEntries.map(entry => [
    entry.id,
    buildKnowledgeEffectReference(entry, knowledgeEffectIndex),
  ]));
  const filteredSamples = legacyVoiceSamples.filter(s => !q || s.title.toLowerCase().includes(q));
  const filteredHooks = legacyHookEntries.filter(h => !q || h.hookText.toLowerCase().includes(q) || h.title.toLowerCase().includes(q));
  const unanalyzedCount = legacyHookEntries.filter(h => !h.analyzed).length;
  const addAction = getKnowledgeHubAddAction(scopeFilter);
  const standardIntakeHref = scopeFilter === "ip"
    ? `/knowledge-intake?scope=ip&category=${encodeURIComponent(ipCatFilter)}`
    : `/knowledge-intake?scope=global&category=${encodeURIComponent(globalCatFilter)}`;
  const smartIntakeHref = getKnowledgeHubIntakeHref(
    scopeFilter,
    scopeFilter === "ip" ? ipCatFilter : scopeFilter === "global" ? globalCatFilter : null,
  ) === "/knowledge-intake/original"
    ? "/knowledge-intake/original"
    : standardIntakeHref;

  function openSectionAddFlow() {
    if (addAction === "cover-form") {
      if (!activeIP || coverLoadError) return;
      setShowAddCover(true);
    }
    else if (addAction !== "smart-intake") setShowAdd(true);
  }

  return (
    <div className="min-h-screen p-6 md:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[13px] text-[#8A8A86]">
            <a href="/" className="font-semibold text-[#639922]">工作台</a> / 知识库中心
          </div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1B]">知识库中心</h1>
          <p className="mt-1.5 max-w-[640px] text-[13.5px] leading-6 text-[#8A8A86]">
            Nicole的底层数据中心。AI模块不应凭空生成结论，应优先检索这里积累的真实案例、口播样本、方法论和评论作为依据。
          </p>
        </div>
        <div className="flex rounded-[10px] bg-[#F2F1ED] p-1">
          <button
            type="button"
            onClick={() => setViewMode("browse")}
            className="rounded-[8px] px-4 py-2 text-[12.5px] font-semibold"
            style={viewMode === "browse" ? { background: "#1C1C1B", color: "#fff" } : { color: "#666" }}
          >
            知识浏览
          </button>
          <button
            type="button"
            onClick={() => setViewMode("legacy")}
            className="rounded-[8px] px-4 py-2 text-[12.5px] font-semibold"
            style={viewMode === "legacy" ? { background: "#1C1C1B", color: "#fff" } : { color: "#666" }}
          >
            管理知识库
          </button>
        </div>
      </header>

      {viewMode === "browse" && (
        <KnowledgeLibraryBrowser
          key={activeIP?.id ?? "__global__"}
          activeIPId={activeIP?.id ?? null}
          activeIPName={activeIP ? getIPDisplayLabel(activeIP, ips) : null}
        />
      )}

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
                      {(() => {
                        const effect = knowledgeEffectByEntryId.get(item.legacyId);
                        return effect ? (
                          <div className="flex flex-wrap justify-end gap-1.5 text-[10.5px] text-[#555]">
                            <span>已用于脚本：{effect.adoptedScriptCount}次</span>
                            <span>已有发布复盘：{effect.reviewedScriptCount}次</span>
                            <span>尚未发布或未复盘：{effect.awaitingReviewCount}次</span>
                            {effect.legacyUnverifiedCount > 0 && (
                              <span className="text-[#999]">历史未验证：{effect.legacyUnverifiedCount}次（不计入上述统计）</span>
                            )}
                          </div>
                        ) : null;
                      })()}
                      <button
                        type="button"
                        aria-label={`删除知识「${item.title}」`}
                        onClick={async () => {
                          const confirmed = window.confirm(
                            `确认删除知识「${item.title}」？\n删除后知识不再参与检索，已有脚本和复盘不会被删除。`,
                          );
                          if (!confirmed) return;
                          try {
                            await deleteKnowledgeItem(item.id, activeIP?.id ?? null, item.ipId);
                            refreshUnified();
                          } catch (error) {
                            window.alert(error instanceof Error ? error.message : "知识删除失败，请稍后重试");
                          }
                        }}
                        className="text-[#BBB] hover:text-[#A32D2D]"
                      >
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

      <div className="mb-5 rounded-[16px] border border-[#E5E4DE] bg-white p-4">
        <div className="mb-3 flex rounded-[10px] bg-[#F2F1ED] p-1">
          <button onClick={() => { setScopeFilter("global"); setGlobalCatFilter("定位方法库" as GlobalCategoryId); }}
            className="flex-1 rounded-[8px] py-2 text-[13px] font-semibold transition-all"
            style={scopeFilter === "global" ? { background: "#1C1C1B", color: "#fff" } : { background: "transparent", color: "#888" }}>
            通用知识库
          </button>
          <button onClick={() => { setScopeFilter("ip"); setIpCatFilter("IP人设资料"); }}
            className="flex-1 rounded-[8px] py-2 text-[13px] font-semibold transition-all"
            style={scopeFilter === "ip" ? { background: "#1C1C1B", color: "#fff" } : { background: "transparent", color: "#888" }}>
            当前IP知识库
          </button>
          <button onClick={() => setScopeFilter("material")}
            className="flex-1 rounded-[8px] py-2 text-[13px] font-semibold transition-all"
            style={scopeFilter === "material" ? { background: "#1C1C1B", color: "#fff" } : { background: "transparent", color: "#888" }}>
            封面参考库
          </button>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[11.5px] text-[#999]">历史专项库：</span>
          {KNOWLEDGE_HUB_LEGACY_SECTIONS.map(({ section, label }) => (
            <button
              key={section}
              onClick={() => setScopeFilter(section)}
              className="rounded-full border px-3 py-1 text-[11.5px] font-semibold transition-all"
              style={scopeFilter === section
                ? { background: "#1C1C1B", color: "#fff", borderColor: "#1C1C1B" }
                : { background: "white", color: "#666", borderColor: "#E5E4DE" }}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mb-3 text-[12px] text-[#888]">
          {scopeFilter === "global" ? "沉淀所有IP都可调用的内容生产方法和共同遵守的内容底线。"
          : scopeFilter === "ip" ? "沉淀当前账号的人设、语气、历史表达和受众反馈，用于让 AI 生成内容更符合当前 IP。"
          : scopeFilter === "viral" ? "保留真实爆款案例、表现数据、钩子评分和结构拆解。"
          : scopeFilter === "hook" ? "保留可复用的前3秒Hook素材及其分析结果。"
          : scopeFilter === "voice" ? "保留按IP绑定的历史口播样本和表达素材。"
          : "沉淀短视频封面参考，包括封面标题、构图、视觉风格和可借鉴案例。"}
        </p>
        <div className="flex flex-wrap gap-2">
          {scopeFilter === "global" && GLOBAL_CATEGORIES.map(c => {
            const cnt = entries.filter(e => !e.ipId && getNormalizedCategory(e) === c.id).length;
            return (<button key={c.id} onClick={() => setGlobalCatFilter(c.id as GlobalCategoryId)}
              className="rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition-all"
              style={globalCatFilter === c.id ? { background: "#EAF3DE", color: "#3B6D11", borderColor: "#A8D87A" } : { background: "white", color: "#666", borderColor: "#E5E4DE" }}>
              {c.id} <span className="ml-1 text-[10.5px] opacity-60">{cnt}</span>
            </button>);
          })}
          {scopeFilter === "ip" && IP_CATEGORIES.map(c => {
            const cnt = entries.filter(e => e.ipId === activeIP?.id && getNormalizedCategory(e) === c.id).length;
            return (<button key={c.id} onClick={() => setIpCatFilter(c.id as IPCategoryId)}
              className="rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition-all"
              style={ipCatFilter === c.id ? { background: "#DBEAFE", color: "#1D4ED8", borderColor: "#93C5FD" } : { background: "white", color: "#666", borderColor: "#E5E4DE" }}>
              {c.id} <span className="ml-1 text-[10.5px] opacity-60">{cnt}</span>
            </button>);
          })}
          {scopeFilter === "material" && (
            <span className="rounded-full border px-3.5 py-1.5 text-[12px] font-semibold"
              style={{ background: "#FFF7ED", color: "#C2410C", borderColor: "#FED7AA" }}>
              封面参考库 <span className="ml-1 text-[10.5px] opacity-60">{coverRefs.length}</span>
            </span>
          )}
        </div>
        {scopeFilter === "global" && (() => { const cat = GLOBAL_CATEGORIES.find(c => c.id === globalCatFilter); return cat ? (<div className="mt-3 flex items-start gap-2 rounded-[10px] bg-[#F7FCF0] px-3 py-2.5"><span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#639922]" /><div><span className="text-[12px] font-bold text-[#3B6D11]">{cat.id}</span><p className="mt-0.5 text-[11.5px] leading-4 text-[#555]">{cat.desc}</p></div></div>) : null; })()}
        {scopeFilter === "ip" && (() => { const cat = IP_CATEGORIES.find(c => c.id === ipCatFilter); return cat ? (<div className="mt-3 flex items-start gap-2 rounded-[10px] bg-[#EFF6FF] px-3 py-2.5"><span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#1D4ED8]" /><div><span className="text-[12px] font-bold text-[#1D4ED8]">{cat.id}</span><p className="mt-0.5 text-[11.5px] leading-4 text-[#555]">{cat.desc}</p></div></div>) : null; })()}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="按标题/标签/关键词搜索…"
          className="h-[40px] w-full max-w-[320px] rounded-[10px] border border-[#E5E4DE] bg-white px-3 text-[13px] outline-none focus:border-[#639922]"
        />
        <div className="flex items-center gap-2">
          {scopeFilter === "hook" && (
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
          {addAction === "smart-intake" ? (
            <a
              href={smartIntakeHref}
              className="flex h-[40px] items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-[#1C1C1B] px-4 text-[12.5px] font-semibold text-white"
            >
              <Icon name="plus" size="sm" /> {scopeFilter === "ip" && ipCatFilter === "IP原始内容" ? "新增原始内容" : "新增知识"}
            </a>
          ) : (
            <button
              onClick={openSectionAddFlow}
              disabled={ipLoading || (addAction === "cover-form" && (!activeIP || Boolean(coverLoadError)))}
              className="flex h-[40px] items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-[#1C1C1B] px-4 text-[12.5px] font-semibold text-white disabled:opacity-50"
            >
              <Icon name="plus" size="sm" /> {addAction === "cover-form" ? "添加封面参考" : addAction === "voice-form" ? "添加口播样本" : addAction === "hook-form" ? "添加钩子" : "添加爆款案例"}
            </button>
          )}
          {(scopeFilter === "global" || (scopeFilter === "ip" && ipCatFilter !== "IP原始内容")) && (
            <button onClick={() => { setShowXlsx(v => !v); setXlsxImportResult(null); }}
              className="flex h-[40px] items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-[#EAF3DE] px-4 text-[12.5px] font-semibold text-[#3B6D11]">
              📊 从 Excel 批量导入
            </button>
          )}
        </div>
      </div>
      {analyzeError && <div className="mb-4 rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{analyzeError}</div>}
      {xlsxImportResult && (
        <div className="mb-4 rounded-[12px] bg-[#EAF3DE] px-4 py-3">
          <div className="mb-1 text-[12.5px] font-bold text-[#3B6D11]">✓ 成功导入 {xlsxImportResult.count} 条{xlsxImportResult.skipped > 0 ? `，跳过 ${xlsxImportResult.skipped} 条空行` : ""}</div>
          {xlsxImportResult.catDist && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {Object.entries(xlsxImportResult.catDist).map(([cat, cnt]) => (
                <span key={cat} className="text-[11.5px] text-[#3B6D11]">{cat}：{cnt as number} 条</span>
              ))}
            </div>
          )}
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

      {/* 封面参考库 */}
      {scopeFilter === "material" ? (
        <>
          {coverLoadError && (
            <div
              role="alert"
              aria-label="封面参考库加载失败"
              className="mb-4 rounded-[12px] border border-[#F2B8B5] bg-[#FCEBEB] px-4 py-3 text-[12.5px] text-[#A32D2D]"
            >
              封面参考库读取失败，已停止新增和删除，原数据不会被覆盖。{coverLoadError}
            </div>
          )}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input value={coverSearch} onChange={e => setCoverSearch(e.target.value)}
              placeholder="搜索标题、标签…"
              className="h-[36px] w-full max-w-[240px] rounded-[10px] border border-[#E5E4DE] bg-white px-3 text-[12.5px] outline-none focus:border-[#639922]" />
            {["全部","抖音","小红书","视频号","B站"].map(p => (
              <button key={p} onClick={() => setCoverPlatformFilter(p)}
                className="rounded-full px-3 py-1 text-[11.5px] font-semibold transition-all"
                style={coverPlatformFilter === p ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}>
                {p}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(() => {
              const filtered = coverRefs.filter(c => {
                if (coverPlatformFilter !== "全部" && c.platform !== coverPlatformFilter) return false;
                if (coverSearch.trim()) { const q = coverSearch.toLowerCase(); return c.title.toLowerCase().includes(q) || c.visualTags.some(t => t.includes(q)); }
                return true;
              });
              if (!coverLoadError && filtered.length === 0) return (
                <div className="col-span-full flex flex-col items-center gap-3 rounded-[14px] border border-dashed border-[#E5E4DE] py-12 text-center">
                  <p className="text-[13px] font-semibold text-[#555]">封面参考库暂无内容</p>
                  <p className="text-[12.5px] text-[#999]">点击右上角「添加封面参考」上传第一张封面。</p>
                  <button
                    onClick={() => setShowAddCover(true)}
                    disabled={!activeIP}
                    className="rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50"
                  >
                    + 添加封面参考
                  </button>
                </div>
              );
              return filtered.map(c => (
                <div key={c.id} className="flex cursor-pointer flex-col overflow-hidden rounded-[14px] border border-[#E5E4DE] bg-white hover:border-[#639922] transition-all" onClick={() => setCoverDetail(c)}>
                  {c.imageDataUrl && (
                    <div className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden bg-[#F7F6F2]">
                      <img src={c.imageDataUrl} alt={c.title} className="h-full w-full object-contain" />
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13px] font-semibold text-[#1C1C1B] line-clamp-1">{c.title}</span>
                      {c.scope === "ip" && c.ipId === activeIP?.id && (
                        <button
                          aria-label={`删除封面「${c.title}」`}
                          onClick={async e => {
                            e.stopPropagation();
                            if (!activeIP || !confirm("确认删除？")) return;
                            try {
                              await deleteCoverRefWithImage(c.id, activeIP.id);
                              await refreshCovers();
                            } catch (error) {
                              setCoverLoadError(error instanceof Error ? error.message : "封面删除失败");
                            }
                          }}
                          className="flex-shrink-0 text-[#CCC] hover:text-[#A32D2D]"
                        >
                          <Icon name="trash" size="sm" />
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10.5px] text-[#666]">{c.platform}</span>
                      {c.coverType && <span className="rounded-full bg-[#FFF7ED] px-2 py-0.5 text-[10.5px] text-[#C2410C]">{c.coverType}</span>}
                    </div>
                    {c.visualTags.length > 0 && <div className="flex flex-wrap gap-1">{c.visualTags.slice(0,3).map(t => <span key={t} className="rounded-full bg-[#F2F1ED] px-1.5 py-0.5 text-[10px] text-[#888]">#{t}</span>)}</div>}
                    {c.referenceReason && <p className="text-[11px] text-[#BBB] line-clamp-1">{c.referenceReason}</p>}
                  </div>
                </div>
              ));
            })()}
          </div>
        </>
      ) : scopeFilter === "voice" ? (
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
                      {getIPDisplayLabel(ip, ips)}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`删除口播样本「${s.title}」`}
                    onClick={async () => {
                      const confirmed = window.confirm(
                        `确认删除口播样本「${s.title}」？\n删除后不会删除已有脚本和复盘。`,
                      );
                      if (!confirmed) return;
                      try {
                        await deleteVoiceSample({
                          id: s.id,
                          activeIPId: activeIP?.id ?? null,
                          expectedIPId: s.ipId,
                        });
                        refresh();
                      } catch (error) {
                        window.alert(error instanceof Error ? error.message : "口播样本删除失败，请稍后重试");
                      }
                    }}
                    className="text-[#999] hover:text-[#A32D2D]"
                  ><Icon name="trash" size="sm" /></button>
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
      ) : scopeFilter === "hook" ? (
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
          {filteredEntries.length === 0 && (() => {
              const curCat = scopeFilter === "global"
                ? globalCatFilter
                : scopeFilter === "ip"
                  ? ipCatFilter
                  : "爆款案例";
              const hintMap: Record<string, string> = {
                "定位方法库": "你可以添加账号定位、人设定位、受众定位、差异化定位相关方法。",
                "选题方法库": "你可以添加选题判断、爆款选题、用户痛点、内容角度相关资料。",
                "标题方法库": "你可以添加标题公式、爆款标题案例、关键词组合相关资料。",
                "开头方法库": "你可以添加3秒钩子、冲突开头、问题开头、反常识开头相关资料。",
                "文案框架方法库": "你可以添加口播结构、故事框架、论证框架、脚本结构相关资料。",
                "通用禁用规则": "你可以添加所有IP都必须遵守的内容底线、价值观红线和禁止使用的表达动机。",
                "IP原始内容": "你可以添加当前IP亲自表达过的直播、课程、文章或语音资料。完整原文只保存一份。",
                "IP人设资料": "你可以添加当前 IP 的身份设定、定位和专业背景。",
                "IP表达语料": "你可以添加当前 IP 的常用语气、句式和口头禅。",
                "IP历史内容": "你可以添加当前 IP 过去发布过的文案和逐字稿。",
                "IP高表现内容": "你可以添加当前 IP 数据表现较好的内容。",
                "IP受众反馈": "你可以添加评论区高赞反馈和用户真实需求。",
                "IP禁用规则": "你可以添加当前 IP 不应使用的表达和内容边界。",
              };
              return (
                <div className="col-span-full flex flex-col items-center gap-3 rounded-[14px] border border-dashed border-[#E5E4DE] py-12 text-center">
                  <p className="text-[13px] font-semibold text-[#555]">{curCat}暂无内容</p>
                  <p className="max-w-[400px] text-[12.5px] leading-5 text-[#999]">{hintMap[curCat] ?? "你可以手动添加或从 Excel 导入相关资料。"}</p>
                  {scopeFilter === "viral" ? (
                    <button onClick={openSectionAddFlow} className="rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[12.5px] font-semibold text-white">+ 添加爆款案例</button>
                  ) : (
                    <div className="flex gap-2">
                      <a href={smartIntakeHref} className="rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[12.5px] font-semibold text-white">+ {curCat === "IP原始内容" ? "新增原始内容" : "智能入库"}</a>
                      {curCat !== "IP原始内容" && <button onClick={() => setShowXlsx(true)} className="rounded-[10px] bg-[#F2F1ED] px-4 py-2 text-[12.5px] font-semibold text-[#555]">从Excel导入</button>}
                    </div>
                  )}
                </div>
              );
            })()}
          {filteredEntries.map(e => {
            const ip = e.ipId ? ipMap.get(e.ipId) : null;
            const methodMeta = parseMethodMeta(e.note);
            const effect = knowledgeEffectByEntryId.get(e.id)!;
            return (
              <Card key={e.id} className="relative flex cursor-pointer flex-col overflow-hidden hover:border-[#639922]">
                <div className="min-w-0 flex-1" onClick={() => { setDetail(e); setDetailExpanded(false); }}>
                  {/* 标题 + 徽章：flex 布局，左侧标题 flex-1 min-w-0，右侧徽章 flex-shrink-0 */}
                  <div className="mb-2 flex items-start gap-2">
                    <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold leading-5 text-[#1C1C1B]">{e.title}</span>
                    {e.viralEvaluation
                      ? <GradeBadge grade={e.viralEvaluation.grade} />
                      : <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${e.ipId ? "bg-[#DBEAFE] text-[#1D4ED8]" : "bg-[#EAF3DE] text-[#3B6D11]"}`}>{getNormalizedCategory(e)}</span>}
                  </div>
                  {/* 状态 + 标签：每个 tag 有 max-w 和 truncate 防止 URL 撑破 */}
                  <div className="mb-2 flex flex-wrap items-center gap-1">
                    <StatusBadge status={e.status} />
                    <span className="text-[10.5px] text-[#555]">已用于脚本：{effect.adoptedScriptCount}次</span>
                    <span className="text-[10.5px] text-[#555]">已有发布复盘：{effect.reviewedScriptCount}次</span>
                    <span className="text-[10.5px] text-[#555]">尚未发布或未复盘：{effect.awaitingReviewCount}次</span>
                    {effect.legacyUnverifiedCount > 0 && (
                      <span className="text-[10.5px] text-[#999]">历史未验证：{effect.legacyUnverifiedCount}次（不计入上述统计）</span>
                    )}
                    {e.tags.slice(0, 4).map((t, i) => (
                      <span key={i} className="max-w-[160px] truncate rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10.5px] text-[#666]">#{t}</span>
                    ))}
                  </div>
                  {/* 摘要：最多3行 */}
                  <p className="line-clamp-3 text-[11.5px] leading-5 text-[#999]">{e.rawContent.slice(0, 150)}</p>
                  {methodMeta && (
                    <div className="mt-2 rounded-[10px] bg-[#F7FCF0] px-2.5 py-2 text-[11.5px] leading-5 text-[#3B6D11]">
                      {methodMeta.applicableScenarios?.length ? <p>适用场景：{methodMeta.applicableScenarios.slice(0, 3).join("、")}</p> : null}
                      {methodMeta.aiUsage ? <p className="line-clamp-2">AI调用：{methodMeta.aiUsage}</p> : null}
                    </div>
                  )}
                </div>
                {/* 底部：来源左侧截断，删除按钮右侧固定 */}
                <div className="mt-2 flex min-w-0 items-center justify-between gap-2 border-t border-[#F0EFE9] pt-2">
                  <span className="min-w-0 truncate text-[10.5px] text-[#BBB]">{e.sourcePlatform} · {new Date(e.createdAt).toLocaleDateString()}{ip ? ` · ${getIPDisplayLabel(ip, ips)}` : ""}</span>
                  <button
                    type="button"
                    aria-label={`删除知识「${e.title}」`}
                    onClick={async ev => {
                      ev.stopPropagation();
                      const scopeLabel = e.ipId ? "当前IP知识" : "通用知识（会影响所有IP）";
                      const confirmed = window.confirm(
                        `确认删除知识「${e.title}」？\n归属：${scopeLabel}\n已用于脚本${effect.adoptedScriptCount}次，已有发布复盘${effect.reviewedScriptCount}次。\n删除后知识不再参与检索，已有脚本和复盘不会被删除。`,
                      );
                      if (!confirmed) return;
                      try {
                        await deleteKnowledgeEntryFromLibrary({
                          id: e.id,
                          activeIPId: activeIP?.id ?? null,
                          expectedIPId: e.ipId,
                        });
                        refresh();
                      } catch (error) {
                        window.alert(error instanceof Error ? error.message : "知识删除失败，请稍后重试");
                      }
                    }}
                    className="flex-shrink-0 text-[#BBB] hover:text-[#A32D2D]"
                  >
                    <Icon name="trash" size="sm" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {showAdd && scopeFilter === "voice" && (
        <AddVoiceSampleModal ips={ips} onClose={() => setShowAdd(false)} onSaved={refresh} />
      )}
      {showAdd && scopeFilter === "hook" && (
        <AddHookModal onClose={() => setShowAdd(false)} onSaved={refresh} />
      )}
      {showAdd && scopeFilter === "viral" && (
        <AddViralCaseModal ips={ips} onClose={() => setShowAdd(false)} onSaved={refresh} />
      )}
      {showAddCover && activeIP && !coverLoadError && (
        <AddCoverModal
          activeIPId={activeIP.id}
          onClose={() => setShowAddCover(false)}
          onSaved={async () => { await refreshCovers(); setShowAddCover(false); }}
        />
      )}

      {coverDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCoverDetail(null)}>
          <div className="card max-h-[90vh] w-full max-w-[680px] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-2">
              <span className="text-[16px] font-bold text-[#1C1C1B]">{coverDetail.title}</span>
              <button onClick={() => setCoverDetail(null)} className="text-[12px] text-[#999]">关闭</button>
            </div>
            {coverDetail.imageDataUrl && (
              <div className="mb-4 flex max-h-[520px] items-center justify-center overflow-hidden rounded-[12px] bg-[#F7F6F2]">
                <img src={coverDetail.imageDataUrl} alt={coverDetail.title} className="max-h-[520px] w-full object-contain" />
              </div>
            )}
            <div className="mb-4 grid grid-cols-2 gap-3 text-[12.5px]">
              {([["平台", coverDetail.platform],["封面类型", coverDetail.coverType],["文字风格", coverDetail.textStyle],["构图方式", coverDetail.layout],["颜色风格", coverDetail.colorStyle]] as [string,string][]).filter(([,v]) => v).map(([label, val]) => (
                <div key={label}><span className="text-[#999]">{label}：</span><span className="text-[#333]">{val}</span></div>
              ))}
            </div>
            {coverDetail.visualTags.length > 0 && <div className="mb-3 flex flex-wrap gap-1.5">{coverDetail.visualTags.map(t => <span key={t} className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[11px] text-[#555]">#{t}</span>)}</div>}
            {coverDetail.referenceReason && <div className="mb-2 rounded-[10px] bg-[#F7FCF0] px-3 py-2.5 text-[12.5px]"><span className="font-semibold text-[#3B6D11]">参考点：</span>{coverDetail.referenceReason}</div>}
            {coverDetail.avoidReason && <div className="mb-2 rounded-[10px] bg-[#FEF3C7] px-3 py-2.5 text-[12.5px]"><span className="font-semibold text-[#92400E]">不建议模仿：</span>{coverDetail.avoidReason}</div>}
            <div className="mt-3 flex items-center justify-between text-[11px] text-[#BBB]">
              <span>录入时间：{new Date(coverDetail.createdAt).toLocaleDateString()}</span>
              {coverDetail.sourceUrl && <a href={coverDetail.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[#639922] underline">来源链接</a>}
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={() => setDetail(null)}>
          <div className="card max-h-[85vh] w-full max-w-[640px] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            {/* 标题 + 知识范围徽章 */}
            <div className="mb-3 flex items-start justify-between gap-2">
              <span className="text-[16px] font-bold text-[#1C1C1B]">{detail.title}</span>
              {detail.viralEvaluation
                ? <GradeBadge grade={detail.viralEvaluation.grade} />
                : <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${detail.ipId ? "bg-[#DBEAFE] text-[#1D4ED8]" : "bg-[#EAF3DE] text-[#3B6D11]"}`}>
                    {detail.ipId ? "IP语料" : "通用知识"}
                  </span>}
            </div>

            {/* 分类 + 来源 + 时间 */}
            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[#888]">
              <span>分类：{detail.category}</span>
              {detail.sourcePlatform && <span>来源：{detail.sourcePlatform}</span>}
              <span>录入时间：{new Date(detail.createdAt).toLocaleDateString()}</span>
              {detail.sourceUrl && (
                <a href={detail.sourceUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[#639922] underline underline-offset-2">来源链接</a>
              )}
            </div>

            {/* 标签 */}
            {detail.tags.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {detail.tags.map((t, i) => <span key={i} className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[11px] text-[#555]">#{t}</span>)}
              </div>
            )}

            {detail.viralEvaluation && (
              <div className="mb-3 flex flex-col gap-2 rounded-[12px] border border-[#E4F0C0] bg-[#FBFEF2] p-3.5">
                <div className="text-[11px] font-bold text-[#639922]">钩子评分 {detail.viralEvaluation.hookScore.total}/50 · {detail.viralEvaluation.hookType}</div>
                <p className="text-[12px] leading-5 text-[#444]">{detail.viralEvaluation.whyViral}</p>
                <p className="text-[11.5px] leading-5 text-[#666]">{detail.viralEvaluation.structureBreakdown}</p>
                {detail.metrics && (
                  <div className="text-[11px] text-[#888]">真实数据：点赞{detail.metrics.likes} · 评论{detail.metrics.comments} · 转发{detail.metrics.shares} · 收藏{detail.metrics.favorites}</div>
                )}
              </div>
            )}

            {/* 分类证据区 */}
            {(() => {
              try {
                const ev = detail.note ? JSON.parse(detail.note) : null;
                if (!ev || !ev.confidence) return null;
                const confColor = ev.confidence === "高" ? "#3B6D11" : ev.confidence === "中" ? "#92400E" : "#A32D2D";
                const confBg = ev.confidence === "高" ? "#EAF3DE" : ev.confidence === "中" ? "#FEF3C7" : "#FCEBEB";
                return (
                  <div className="mb-3 rounded-[10px] border border-[#E5E4DE] p-3">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-[11.5px] font-bold text-[#555]">分类判断</span>
                      <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: confBg, color: confColor }}>
                        {ev.confidence}置信度
                      </span>
                      {ev.needsReview && <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[10.5px] text-[#92400E]">建议人工确认</span>}
                    </div>
                    <p className="mb-1 text-[12px] text-[#555]"><span className="text-[#888]">分类依据：</span>{ev.reason}</p>
                    {ev.matchedRules?.length > 0 && <p className="text-[11.5px] text-[#888]">命中关键词：{ev.matchedRules.join("、")}</p>}
                    {ev.originalCategory && ev.originalCategory !== ev.normalizedCategory && (
                      <p className="mt-1 text-[11px] text-[#BBB]">原始分类：{ev.originalCategory} → {ev.normalizedCategory}</p>
                    )}
                    {ev.needsReview && (
                      <div className="mt-2 border-t border-[#F0EFE9] pt-2">
                        <p className="mb-1.5 text-[11.5px] text-[#888]">手动选择正确分类：</p>
                        <div className="flex flex-wrap gap-1.5">
                          {getKnowledgeHubCorrectionCategories(detail.ipId).map(cat => (
                            <button key={cat}
                              onClick={() => {
                                if (!isKnowledgeHubCorrectionAllowed(detail.ipId, cat)) return;
                                const newNote = JSON.stringify({ ...ev, normalizedCategory: cat, confidence: "高", needsReview: false, reason: `人工确认分类为「${cat}」` });
                                updateKnowledgeEntry(detail.id, { category: cat as KnowledgeCategory, note: newNote, sourceTier: "高", sourceTierReason: `人工确认分类为「${cat}」` });
                                setDetail(prev => prev ? { ...prev, category: cat as KnowledgeCategory, note: newNote } : null);
                                refresh();
                              }}
                              className="rounded-full border px-3 py-1 text-[11.5px] font-semibold transition-all hover:border-[#639922] hover:bg-[#EAF3DE] hover:text-[#3B6D11]"
                              style={{ background: "white", color: "#666", borderColor: "#E5E4DE" }}>
                              {cat}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              } catch { return null; }
            })()}

            {/* 内容原文 */}
            <div className="mb-4">
              {detail.category === "IP原始内容" && detail.sourceAnalysis && (
                <div className="mb-3 rounded-[12px] border border-[#D8E9C0] bg-[#FBFEF7] p-4">
                  <div className="mb-3">
                    <div className="text-[12.5px] font-bold text-[#3B6D11]">可追溯解析</div>
                    <p className="mt-0.5 text-[11px] text-[#777]">这些内容可以回到原文，但不等于其中的外部事实已经核实。</p>
                    {detail.sourceAnalysis.parserVersion === 1 && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-1 text-[10.5px] font-semibold ${detail.sourceLegacyProof ? "bg-[#EAF3DE] text-[#3B6D11]" : "bg-[#FEF3C7] text-[#92400E]"}`}>
                          {detail.sourceLegacyProof ? "已合规登记" : "待合规登记"}
                        </span>
                        {!detail.sourceLegacyProof && (
                          <button
                            type="button"
                            disabled={registeringLegacyId === detail.id}
                            onClick={() => void registerLegacySource(detail)}
                            className="rounded-[8px] bg-[#1C1C1B] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                          >{registeringLegacyId === detail.id ? "登记中…" : "登记V1认知"}</button>
                        )}
                        {legacyRegistrationError && <span className="text-[11px] text-[#A32D2D]">{legacyRegistrationError}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto pr-1">
                    {getLegacyIPSourceAnalysisItems(detail.sourceAnalysis).map(item => (
                      <div key={item.id} className="rounded-[9px] bg-white px-3 py-2.5">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="text-[10.5px] font-bold text-[#1D4ED8]">{SOURCE_ANALYSIS_KIND_LABEL[item.kind] ?? item.kind}</span>
                          <span className="text-[10px] text-[#AAA]">原文第{item.startPosition + 1}—{item.endPosition}字</span>
                          <span className="text-[10px] text-[#92400E]">{item.extractionStatus}</span>
                        </div>
                        <p className="text-[12px] font-semibold leading-5 text-[#333]">{item.content}</p>
                        <p className="mt-1 text-[11px] leading-5 text-[#777]">原文：“{item.originalExcerpt}”</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="whitespace-pre-wrap rounded-[12px] bg-[#F7F6F2] p-4 text-[13px] leading-6 text-[#333]">
                {(() => {
                  const c = cleanRawContent(detail.rawContent);
                  return detailExpanded || c.length <= 300 ? c : c.slice(0, 300) + "…";
                })()}
              </div>
              {(() => {
                const methodMeta = parseMethodMeta(detail.note);
                if (!methodMeta) return null;
                return (
                  <div className="mt-3 rounded-[12px] bg-[#F7FCF0] px-4 py-3 text-[12.5px] leading-6 text-[#3B6D11]">
                    {methodMeta.coreMethod && <p><span className="font-bold">核心方法：</span>{methodMeta.coreMethod}</p>}
                    {methodMeta.applicableScenarios?.length ? <p><span className="font-bold">适用场景：</span>{methodMeta.applicableScenarios.join("、")}</p> : null}
                    {methodMeta.triggerKeywords?.length ? <p><span className="font-bold">触发关键词：</span>{methodMeta.triggerKeywords.join("、")}</p> : null}
                    {methodMeta.aiUsage && <p><span className="font-bold">AI调用方式：</span>{methodMeta.aiUsage}</p>}
                    {methodMeta.unsuitableCases?.length ? <p><span className="font-bold">不适用：</span>{methodMeta.unsuitableCases.join("、")}</p> : null}
                  </div>
                );
              })()}
              {cleanRawContent(detail.rawContent).length > 300 && (
                <button onClick={() => setDetailExpanded(v => !v)} className="mt-1.5 text-[12px] text-[#639922] hover:underline">
                  {detailExpanded ? "▲ 收起" : "▼ 展开全文"}
                </button>
              )}
            </div>

            <div className="mt-4 border-t border-[#F0EFE9] pt-3.5">
              {(() => {
                const effect = knowledgeEffectByEntryId.get(detail.id)!;
                return (
                  <>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-[12px] font-bold text-[#666]">知识效果参考</span>
                      <StatusBadge status={detail.status} />
                    </div>
                    <p className="mb-2 text-[11.5px] leading-5 text-[#888]">
                      这里只陈列真实采用记录和发布表现，不对知识是否有效作判断。
                    </p>
                    <div className="mb-3 flex flex-wrap gap-2 text-[11px] text-[#555]">
                      <span>已用于脚本：{effect.adoptedScriptCount}次</span>
                      <span>已有发布复盘：{effect.reviewedScriptCount}次</span>
                      <span>尚未发布或未复盘：{effect.awaitingReviewCount}次</span>
                    </div>
                    {effect.scripts.length === 0 ? (
                      <p className="text-[12px] text-[#999]">还没有真实确认采用这条知识的脚本。</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {effect.scripts.map(({ script, usage, review }) => (
                          <div key={script.id} className="rounded-[10px] bg-[#F7F6F2] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[12px] font-semibold text-[#1C1C1B]">{script.title}</span>
                              <span className="text-[10.5px] text-[#999]">采用于{new Date(usage.usedAt).toLocaleString()}</span>
                            </div>
                            {review ? (
                              <div className="mt-2 rounded-[8px] bg-white px-3 py-2 text-[11px] leading-5 text-[#555]">
                                <p className="font-semibold text-[#333]">{review.title} · {review.platform} · {review.publishedAt}</p>
                                <p>
                                  播放{formatHistoricalMetric(review.metrics?.views)} · 点赞{formatHistoricalMetric(review.metrics?.likes)} · 评论{formatHistoricalMetric(review.metrics?.comments)} · 收藏{formatHistoricalMetric(review.metrics?.favorites)} · 分享{formatHistoricalMetric(review.metrics?.shares)}
                                </p>
                                <p>
                                  涨粉{formatHistoricalMetric(review.metrics?.newFollowers)} · 私信{formatHistoricalMetric(review.metrics?.dms)} · 线索{formatHistoricalMetric(review.metrics?.leads)} · 转化{formatHistoricalMetric(review.metrics?.conversions)}
                                </p>
                              </div>
                            ) : (
                              <p className="mt-2 text-[11px] text-[#999]">尚未发布或未复盘</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {effect.legacyUnverifiedCount > 0 && (
                      <div className="mt-3 rounded-[10px] bg-[#FBF3D6] px-3 py-2 text-[11px] text-[#7A5C00]">
                        历史未验证记录{effect.legacyUnverifiedCount}次（不计入新口径）
                      </div>
                    )}
                  </>
                );
              })()}
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
