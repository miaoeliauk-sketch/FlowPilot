"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import {
  removeDraftsByBatch,
  saveDraftCognitionBatch,
} from "@/lib/cognition-draft-session-store";
import { createDraftCognitionBatchId } from "@/lib/cognition-graph-bridge";
import { useIP } from "@/lib/ip-context";
import {
  addIPOriginalSource,
  addVerifiedIPOriginalSource,
  createIPOriginalSourceId,
  deriveIPOriginalSourceTitle,
} from "@/lib/ip-original-source";
import { getKnowledgeEntriesForFullLibraryComparison } from "@/lib/ip-store";
import { getLegacyIPSourceAnalysisItems, parseStoredIPSourceAnalysis } from "@/lib/ip-source-analysis-v2";
import type { CognitionReviewAction } from "@/lib/ip-source-analysis-review";
import { CognitionNodeCard } from "@/components/ip-brain/CognitionNodeCard";
import { SourceViewer } from "@/components/ip-brain/SourceViewer";
import {
  runIPOriginalSourcePrecheck,
  type IPOriginalSourcePrecheckResult,
  type SimilarExistingKnowledgeEvidence,
} from "@/lib/knowledge-intake-precheck";
import type {
  IPOriginalSourceKind,
  IPSourceAnalysisKind,
  IPSourceAnalysisSnapshot,
  IPSourceAnchor,
} from "@/lib/types";

const SOURCE_KINDS: IPOriginalSourceKind[] = ["直播逐字稿", "课程内容", "文章", "语音整理", "其他"];
const ACCEPT = ".txt,.md,.srt,text/plain,text/markdown,application/x-subrip";

const KIND_LABEL: Record<IPSourceAnalysisKind, string> = {
  question: "老师在回答什么",
  claim: "明确观点",
  reasoning: "推理过程",
  evidence: "案例／事实／数据",
  concept: "概念区分",
  topic: "可延展选题",
  expression: "表达特征",
};

const SIMILARITY_LABEL: Record<SimilarExistingKnowledgeEvidence["tier"], string> = {
  exact: "完全相同",
  high: "高度相似",
  partial: "部分相似",
};

function SimilarityResults({
  title,
  emptyText,
  matches,
}: {
  title: string;
  emptyText: string;
  matches: SimilarExistingKnowledgeEvidence[];
}) {
  return (
    <div className="rounded-[10px] border border-[#E5E4DE] bg-[#FCFCFA] p-3">
      <h3 className="text-[12.5px] font-bold text-[#333]">{title}</h3>
      {matches.length === 0 ? (
        <p className="mt-2 text-[11.5px] text-[#888]">{emptyText}</p>
      ) : (
        <div className="mt-2 space-y-2">
          {matches.map(match => (
            <div key={match.knowledgeId} className="rounded-[8px] bg-white px-3 py-2 text-[11.5px] text-[#666]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#F2EEDF] px-2 py-0.5 font-bold text-[#735F21]">
                  {SIMILARITY_LABEL[match.tier]}
                </span>
                <span>{match.title || "未命名内容"}｜{match.category || "分类未标注"}</span>
              </div>
              <p className="mt-1">相似原因：{match.reasons.join("；")}</p>
              <p className="mt-1 text-[#888]">{match.ownershipLabel}｜{match.sourceDescription}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function IPOriginalContentIntakePage() {
  const { activeIP, ips, loading: ipLoading, switchIP } = useIP();
  const [title, setTitle] = useState("");
  const [sourceKind, setSourceKind] = useState<IPOriginalSourceKind>("直播逐字稿");
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [analysis, setAnalysis] = useState<IPSourceAnalysisSnapshot | null>(null);
  const [analysisToken, setAnalysisToken] = useState("");
  const [analysisIPId, setAnalysisIPId] = useState<string | null>(null);
  const [activeAnchor, setActiveAnchor] = useState<IPSourceAnchor | null>(null);
  const [precheck, setPrecheck] = useState<IPOriginalSourcePrecheckResult | null>(null);
  const [saveDecision, setSaveDecision] = useState<"continue" | "skip" | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState("");
  const [error, setError] = useState("");
  const activeRequestSeq = useRef(0);
  const activeIPIdRef = useRef<string | null>(activeIP?.id ?? null);
  const analysisInFlight = useRef(false);
  const reviewInFlight = useRef(false);
  const saveInFlight = useRef(false);
  const [sourceId, setSourceId] = useState(() => createIPOriginalSourceId());
  const confirmedCount = analysis?.parserVersion === 1
    ? analysis.items.filter(item => item.extractionStatus === "人工确认").length
    : analysis?.nodes.filter(node => node.reviewStatus === "human_confirmed").length ?? 0;
  const analysisCount = analysis?.parserVersion === 1
    ? analysis.items.length
    : analysis?.nodes.length ?? 0;
  const reviewedCount = analysis?.parserVersion === 1
    ? confirmedCount
    : analysis?.nodes.filter(node => node.reviewStatus !== "ai_extracted").length ?? 0;
  const isGlobalLocked = loading || reviewing || saving;

  useEffect(() => {
    activeIPIdRef.current = activeIP?.id ?? null;
    activeRequestSeq.current += 1;
    analysisInFlight.current = false;
    reviewInFlight.current = false;
    saveInFlight.current = false;
    setLoading(false);
    setReviewing(false);
    setAnalysis(null);
    setAnalysisToken("");
    setAnalysisIPId(null);
    setActiveAnchor(null);
    setPrecheck(null);
    setSaveDecision(null);
    setError("");
  }, [activeIP?.id]);

  useEffect(() => {
    if (ipLoading || typeof window === "undefined") return;
    const requestedIPId = new URLSearchParams(window.location.search).get("ipId")?.trim();
    if (!requestedIPId || requestedIPId === activeIP?.id) return;
    if (!ips.some(ip => ip.id === requestedIPId)) {
      setError("链接中的IP不存在，已保持当前IP不变。");
      return;
    }
    switchIP(requestedIPId);
  }, [activeIP?.id, ipLoading, ips, switchIP]);

  function buildPrecheck(
    nextAnalysis: IPSourceAnalysisSnapshot,
    nextTitle: string,
    candidateSourceId = sourceId,
  ) {
    const compatibleItems = getLegacyIPSourceAnalysisItems(nextAnalysis);
    return runIPOriginalSourcePrecheck({
      candidateId: candidateSourceId,
      title: nextTitle,
      originalContent: rawContent,
      keywords: compatibleItems
        .filter(item => item.kind === "claim" || item.kind === "concept" || item.kind === "topic")
        .map(item => item.content.slice(0, 60)),
      viewpointSummaries: compatibleItems
        .filter(item => item.kind === "claim" || item.kind === "reasoning" || item.kind === "concept" || item.kind === "topic")
        .map(item => item.content),
      existingEntries: getKnowledgeEntriesForFullLibraryComparison(),
      ipNamesById: Object.fromEntries(ips.map(ip => [ip.id, ip.name])),
    });
  }

  function saveV2Draft(
    nextAnalysis: Extract<IPSourceAnalysisSnapshot, { parserVersion: 2 }>,
    nextToken: string,
    nextIPId: string,
    nextTitle: string,
  ): boolean {
    if (typeof window === "undefined") return false;
    try {
      return saveDraftCognitionBatch(window.sessionStorage, {
        schemaVersion: 1,
        batchId: createDraftCognitionBatchId({
          ipId: nextIPId,
          sourceId: nextAnalysis.sourceId,
          sourceHash: nextAnalysis.sourceHash,
          analyzedAt: nextAnalysis.analyzedAt,
        }),
        ipId: nextIPId,
        rawContent,
        sourceMetadata: {
          title: nextTitle,
          sourceKind,
          sourceName,
          sourceUrl,
        },
        analysis: nextAnalysis,
        analysisToken: nextToken,
      }).ok;
    } catch {
      return false;
    }
  }

  async function handleFile(file: File) {
    if (analysisInFlight.current || reviewInFlight.current || saveInFlight.current) return;
    setError("");
    if (!file.name.match(/\.(txt|md|srt)$/i) && !["text/plain", "text/markdown", "application/x-subrip"].includes(file.type)) {
      setError("第一版支持txt、md、srt格式");
      return;
    }
    const text = await file.text();
    setSourceName(file.name);
    setRawContent(text);
    if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
    setAnalysis(null);
    setAnalysisToken("");
    setAnalysisIPId(null);
    setActiveAnchor(null);
    setPrecheck(null);
    setSaveDecision(null);
  }

  async function handleAnalyze() {
    if (analysisInFlight.current || reviewInFlight.current || saveInFlight.current) return;
    if (!activeIP) {
      setError("请先在身份中心选择当前IP");
      return;
    }
    if (!rawContent.trim()) {
      setError("请先粘贴或上传老师的原始内容");
      return;
    }
    const requestedIPId = activeIP.id;
    const requestedSourceId = createIPOriginalSourceId();
    setSourceId(requestedSourceId);
    const requestSeq = activeRequestSeq.current + 1;
    activeRequestSeq.current = requestSeq;
    analysisInFlight.current = true;
    setLoading(true);
    setError("");
    setAnalysis(null);
    setAnalysisToken("");
    setAnalysisIPId(null);
    try {
      const response = await apiFetch("/api/ip-source-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: requestedSourceId,
          activeIPId: requestedIPId,
          rawContent,
          parserVersion: 2,
          requestSeq,
        }),
      });
      const data = await response.json();
      if (requestSeq !== activeRequestSeq.current
        || activeIPIdRef.current !== requestedIPId) return;
      if (!response.ok) {
        setError(data.error ?? "原始内容解析失败");
        return;
      }
      const parsed = parseStoredIPSourceAnalysis(data.analysis, rawContent, requestedSourceId);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      const nextAnalysis = parsed.analysis;
      if (nextAnalysis.parserVersion === 2
        && (typeof data.analysisToken !== "string" || !data.analysisToken.trim())) {
        setError("解析结果缺少服务端凭证，请重新分析");
        return;
      }
      if (nextAnalysis.parserVersion === 2
        && (data.requestSeq !== requestSeq || data.activeIPId !== requestedIPId)) {
        setError("解析响应与当前IP不一致，请重新分析");
        return;
      }
      const nextTitle = title.trim()
        ? title.trim()
        : deriveIPOriginalSourceTitle(rawContent, nextAnalysis);
      const nextPrecheck = buildPrecheck(nextAnalysis, nextTitle, requestedSourceId);
      const draftSaved = nextAnalysis.parserVersion !== 2
        || saveV2Draft(nextAnalysis, data.analysisToken, requestedIPId, nextTitle);
      setAnalysis(nextAnalysis);
      setAnalysisToken(nextAnalysis.parserVersion === 2 ? data.analysisToken : "");
      setAnalysisIPId(requestedIPId);
      setActiveAnchor(nextAnalysis.parserVersion === 2
        ? nextAnalysis.nodes[0]?.claim.anchors[0] ?? null
        : null);
      setTitle(nextTitle);
      setPrecheck(nextPrecheck);
      setSaveDecision(null);
      if (!draftSaved) {
        setError("内容解析成功，但认知草稿暂存失败；请勿关闭页面，并检查浏览器存储空间。");
      }
    } catch (cause) {
      if (requestSeq === activeRequestSeq.current
        && activeIPIdRef.current === requestedIPId) {
        setError(cause instanceof Error ? cause.message : "网络错误");
      }
    } finally {
      if (requestSeq === activeRequestSeq.current) {
        analysisInFlight.current = false;
        setLoading(false);
      }
    }
  }

  async function handleSave() {
    if (saveInFlight.current || analysisInFlight.current || reviewInFlight.current) return;
    if (!activeIP || !analysis) return;
    if (analysisIPId !== activeIP.id) {
      setError("当前IP已切换，请重新理解内容后再保存");
      return;
    }
    if (!title.trim()) {
      setError("请填写原始内容标题");
      return;
    }
    if (!precheck || saveDecision !== "continue") {
      setError("请先查看入库前检查结果，并确认是否继续保存");
      return;
    }
    if (analysis.parserVersion === 2 && analysis.nodes.some(node => node.reviewStatus === "ai_extracted")) {
      setError("请先逐条确认、拒绝或修订所有认知节点");
      return;
    }
    const requestedIPId = activeIP.id;
    const requestSeq = activeRequestSeq.current + 1;
    activeRequestSeq.current = requestSeq;
    saveInFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const sourceInput = {
        sourceId,
        ipId: requestedIPId,
        title,
        sourceKind,
        originalContent: rawContent,
        sourceName,
        sourceUrl,
        analysis,
      };
      const saved = analysis.parserVersion === 2
        ? await (async () => {
            if (!analysisToken) throw new Error("解析凭证已失效，请重新分析");
            const response = await apiFetch("/api/ip-source-analysis/finalize", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                activeIPId: requestedIPId,
                sourceId,
                rawContent,
                analysis,
                analysisToken,
                requestSeq,
              }),
            });
            const result = await response.json() as {
              finalProof?: string;
              activeIPId?: string;
              sourceId?: string;
              nonce?: number;
              requestSeq?: number | null;
              error?: string;
            };
            if (requestSeq !== activeRequestSeq.current
              || activeIPIdRef.current !== requestedIPId) {
              throw new Error("当前IP或保存流程已变化，本次保存已取消");
            }
            if (!response.ok || typeof result.finalProof !== "string" || !result.finalProof.trim()) {
              throw new Error(result.error ?? "最终入库校验失败");
            }
            if (result.activeIPId !== requestedIPId
              || result.sourceId !== sourceId
              || result.nonce !== analysis.nonce
              || result.requestSeq !== requestSeq) {
              throw new Error("最终入库响应与当前内容不一致");
            }
            return addVerifiedIPOriginalSource({
              ...sourceInput,
              analysis,
              finalProof: result.finalProof,
              isStillCurrent: () => requestSeq === activeRequestSeq.current
                && activeIPIdRef.current === requestedIPId,
            });
          })()
        : addIPOriginalSource({ ...sourceInput, analysis });
      if (requestSeq !== activeRequestSeq.current
        || activeIPIdRef.current !== requestedIPId) return;
      if (analysis.parserVersion === 2 && typeof window !== "undefined") {
        removeDraftsByBatch(
          window.sessionStorage,
          requestedIPId,
          createDraftCognitionBatchId({
            ipId: requestedIPId,
            sourceId: analysis.sourceId,
            sourceHash: analysis.sourceHash,
            analyzedAt: analysis.analyzedAt,
          }),
        );
      }
      setSavedId(saved.id);
    } catch (cause) {
      if (requestSeq === activeRequestSeq.current
        && activeIPIdRef.current === requestedIPId) {
        setError(cause instanceof Error ? cause.message : "保存失败");
      }
    } finally {
      if (requestSeq === activeRequestSeq.current) {
        saveInFlight.current = false;
        setSaving(false);
      }
    }
  }

  function toggleConfirmed(itemId: string) {
    setAnalysis(current => current?.parserVersion === 1 ? {
      ...current,
      items: current.items.map(item => item.id === itemId ? {
        ...item,
        extractionStatus: item.extractionStatus === "人工确认" ? "AI提取" : "人工确认",
      } : item),
    } : current);
  }

  function confirmAll() {
    setAnalysis(current => current?.parserVersion === 1 ? {
      ...current,
      items: current.items.map(item => ({ ...item, extractionStatus: "人工确认" })),
    } : current);
  }

  async function reviewNode(action: CognitionReviewAction) {
    if (!activeIP || analysis?.parserVersion !== 2) return;
    if (reviewInFlight.current || analysisInFlight.current || saveInFlight.current) return;
    if (!analysisToken) {
      setError("解析凭证已失效，请重新分析");
      return;
    }
    if (analysisIPId !== activeIP.id) {
      setError("当前IP已切换，请重新理解内容后再审核");
      return;
    }
    const requestedIPId = activeIP.id;
    const requestSeq = activeRequestSeq.current + 1;
    activeRequestSeq.current = requestSeq;
    reviewInFlight.current = true;
    setReviewing(true);
    setError("");
    try {
      const response = await apiFetch("/api/ip-source-analysis/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeIPId: activeIP.id,
          sourceId,
          rawContent,
          analysis,
          analysisToken,
          requestSeq,
          action,
        }),
      });
      const data = await response.json();
      if (requestSeq !== activeRequestSeq.current
        || activeIPIdRef.current !== requestedIPId) return;
      if (!response.ok) {
        setError(data.error ?? "认知审核失败");
        return;
      }
      if (data.requestSeq !== requestSeq || data.activeIPId !== requestedIPId) {
        setError("审核响应与当前IP不一致，请重新操作");
        return;
      }
      if (typeof data.analysisToken !== "string" || !data.analysisToken.trim()) {
        setError("审核响应缺少服务端凭证，请重新分析");
        return;
      }
      const parsed = parseStoredIPSourceAnalysis(data.analysis, rawContent, sourceId);
      if (!parsed.ok || parsed.version !== 2) {
        setError(parsed.ok ? "认知审核返回了错误版本" : parsed.error);
        return;
      }
      const draftSaved = saveV2Draft(
        parsed.analysis,
        data.analysisToken,
        requestedIPId,
        title.trim() || deriveIPOriginalSourceTitle(rawContent, parsed.analysis),
      );
      setAnalysis(parsed.analysis);
      setAnalysisToken(data.analysisToken);
      setPrecheck(buildPrecheck(parsed.analysis, title.trim()));
      setSaveDecision(null);
      if (!draftSaved) {
        setError("审核已完成，但认知草稿暂存失败；请勿关闭页面，并检查浏览器存储空间。");
      }
    } catch (cause) {
      if (requestSeq === activeRequestSeq.current
        && activeIPIdRef.current === requestedIPId) {
        setError(cause instanceof Error ? cause.message : "认知审核失败");
      }
    } finally {
      if (requestSeq === activeRequestSeq.current) {
        reviewInFlight.current = false;
        setReviewing(false);
      }
    }
  }

  if (savedId) {
    return (
      <div className="min-h-screen p-6 md:p-8">
        <div className="mx-auto flex max-w-[760px] flex-col items-center gap-4 rounded-[16px] border border-[#D8E9C0] bg-white px-6 py-16 text-center">
          <div className="text-[40px]">✓</div>
          <h1 className="text-[20px] font-bold text-[#1C1C1B]">IP原始内容已保存</h1>
          <p className="text-[13px] leading-6 text-[#777]">完整原文只保存了一份，解析结果均可回到对应原文位置。</p>
          <div className="flex gap-2">
            <a href="/knowledge-hub?scope=ip" className="rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white">去知识库查看</a>
            <button onClick={() => window.location.reload()} className="rounded-[10px] bg-[#F2F1ED] px-5 py-2.5 text-[13px] font-semibold text-[#555]">继续添加</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 md:p-8">
      <header className="mx-auto mb-6 max-w-[980px]">
        <div className="mb-1.5 text-[13px] text-[#8A8A86]">
          <a href="/" className="font-semibold text-[#639922]">工作台</a> ／ <a href="/knowledge-hub?scope=ip" className="text-[#639922]">当前IP知识库</a> ／ 新增IP原始内容
        </div>
        <h1 className="text-[24px] font-semibold text-[#1C1C1B]">新增IP原始内容</h1>
        <p className="mt-1 max-w-[760px] text-[13px] leading-6 text-[#777]">保存老师亲自表达过的完整内容。AI只负责识别观点、推理、案例和表达特征，不会用解析结果替换原文。</p>
      </header>

      <main className="mx-auto flex max-w-[980px] flex-col gap-4">
        {isGlobalLocked && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/55 backdrop-blur-[1px]" role="status" aria-live="polite">
            <div className="rounded-[12px] border border-[#D8E9C0] bg-white px-5 py-3 text-[13px] font-semibold text-[#3B6D11] shadow-lg">
              处理中，请勿修改原始内容
            </div>
          </div>
        )}
        <section className="rounded-[16px] border border-[#E5E4DE] bg-white p-5">
          <div className="mb-4 rounded-[10px] bg-[#EFF6FF] px-3 py-2.5 text-[12.5px] text-[#1D4ED8]">
            当前IP：<b>{activeIP?.name ?? "尚未选择"}</b>。这份内容只会归入当前IP，不会作为通用方法使用。
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[12.5px] font-semibold text-[#555]">标题（保存必填）
              <input value={title} disabled={isGlobalLocked} onChange={event => { setTitle(event.target.value); setPrecheck(null); setSaveDecision(null); }} placeholder="例如：持续输出的真正含义" className="mt-1.5 w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 text-[13px] font-normal outline-none focus:border-[#639922]" />
            </label>
            <label className="text-[12.5px] font-semibold text-[#555]">资料类型
              <select value={sourceKind} disabled={isGlobalLocked} onChange={event => setSourceKind(event.target.value as IPOriginalSourceKind)} className="mt-1.5 w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 text-[13px] font-normal outline-none">
                {SOURCE_KINDS.map(kind => <option key={kind}>{kind}</option>)}
              </select>
            </label>
          </div>
          <label className="mt-3 block text-[12.5px] font-semibold text-[#555]">来源链接（可选）
            <input value={sourceUrl} disabled={isGlobalLocked} onChange={event => setSourceUrl(event.target.value)} placeholder="用于记录资料出处，不代表系统已核实外部事实" className="mt-1.5 w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 text-[13px] font-normal outline-none focus:border-[#639922]" />
          </label>
          <label className="mt-4 flex cursor-pointer items-center justify-center rounded-[10px] border border-dashed border-[#CFCFC7] bg-[#FAFAF8] px-4 py-4 text-[12.5px] text-[#666]">
            {sourceName ? `已读取：${sourceName}` : "上传txt、md或srt，或者直接在下方粘贴"}
            <input type="file" accept={ACCEPT} disabled={isGlobalLocked} className="hidden" onChange={event => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
              event.target.value = "";
            }} />
          </label>
          <textarea value={rawContent} disabled={isGlobalLocked} onChange={event => { setRawContent(event.target.value); setAnalysis(null); setAnalysisToken(""); setAnalysisIPId(null); setActiveAnchor(null); setPrecheck(null); setSaveDecision(null); }} rows={14} placeholder="粘贴老师的课程、直播逐字稿、文章或语音整理全文……" className="mt-3 w-full resize-y rounded-[12px] border border-[#E5E4DE] bg-[#FAFAF8] px-4 py-3 text-[13px] leading-6 text-[#333] outline-none focus:border-[#639922]" />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-[#AAA]">{rawContent.length}字。原文将在确认保存时完整写入，不会被AI改写。</span>
            <button onClick={handleAnalyze} disabled={isGlobalLocked || !rawContent.trim() || !activeIP} className="rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">{loading ? "正在理解原始内容……" : "开始理解内容"}</button>
          </div>
        </section>

        {error && <div role="alert" className="rounded-[10px] bg-[#FCEBEB] px-3 py-2.5 text-[12.5px] text-[#A32D2D]">{error}</div>}

        {analysis && (
          <section className="rounded-[16px] border border-[#D8E9C0] bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-bold text-[#1C1C1B]">内容理解结果</h2>
                <p className="mt-1 text-[12px] text-[#888]">
                  {analysis.parserVersion === 1
                    ? "当前全部标记为“AI提取”。它表示可以回到原文，不表示外部事实已经核实。"
                    : "逐条核对观点、推理和原文证据。人工修订不会覆盖AI原始提取和原文锚点。"}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${analysisCount > 0 && reviewedCount === analysisCount ? "bg-[#EAF3DE] text-[#3B6D11]" : "bg-[#FEF3C7] text-[#92400E]"}`}>
                {analysis.parserVersion === 1 ? "已确认" : "已审核"}{reviewedCount}／{analysisCount}条
              </span>
              {analysis.parserVersion === 1 && (
                <button onClick={confirmAll} className="rounded-[9px] bg-[#EAF3DE] px-3 py-2 text-[11.5px] font-semibold text-[#3B6D11]">全部确认原意</button>
              )}
            </div>
            {precheck ? (
              <div className="mb-4 space-y-3 rounded-[12px] border border-[#D8E9C0] bg-[#F9FCF5] p-4">
                <div>
                  <h2 className="text-[14px] font-bold text-[#1C1C1B]">入库前检查</h2>
                  <p className="mt-1 text-[11.5px] text-[#777]">系统只提供判断依据，不会自动合并、删除或替你决定。</p>
                </div>
                {precheck.quality.issues.length > 0 && (
                  <div className="rounded-[8px] bg-[#FFF8E8] px-3 py-2 text-[11.5px] text-[#8A6418]">
                    {precheck.quality.issues.map(issue => <p key={issue.code}>{issue.message}</p>)}
                  </div>
                )}
                <SimilarityResults
                  title="原文重复检查"
                  emptyText="全库已有原始内容中暂未发现相似原文"
                  matches={precheck.originalContentMatches}
                />
                <SimilarityResults
                  title="知识内容检查"
                  emptyText="全库其他知识中暂未发现相似的标题、关键词或观点摘要"
                  matches={precheck.extractedKnowledgeMatches}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={saveDecision === "continue"}
                    onClick={() => { setSaveDecision("continue"); setError(""); }}
                    className="rounded-[8px] border px-3 py-2 text-[12px] font-bold"
                    style={saveDecision === "continue"
                      ? { borderColor: "#639922", background: "#639922", color: "white" }
                      : { borderColor: "#BFD59F", background: "white", color: "#4E6C25" }}
                  >
                    继续保存这份原始内容
                  </button>
                  <button
                    type="button"
                    aria-pressed={saveDecision === "skip"}
                    onClick={() => { setSaveDecision("skip"); setError(""); }}
                    className="rounded-[8px] border px-3 py-2 text-[12px] font-semibold"
                    style={saveDecision === "skip"
                      ? { borderColor: "#C8C5BB", background: "#F2F1ED", color: "#555" }
                      : { borderColor: "#D8D5C9", background: "white", color: "#777" }}
                  >
                    暂不保存
                  </button>
                </div>
              </div>
            ) : (
              <div className="mb-4 rounded-[10px] bg-[#FFF8E8] px-3 py-2 text-[11.5px] text-[#8A6418]">
                标题或内容已变化，请重新点击“开始理解内容”后再保存。
              </div>
            )}
            {analysis.parserVersion === 1 ? (
              <div className="flex flex-col gap-3">
                {analysis.items.map(item => (
                  <article key={item.id} className="rounded-[12px] border border-[#E5E4DE] p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded-full bg-[#EFF6FF] px-2.5 py-0.5 text-[11px] font-semibold text-[#1D4ED8]">{KIND_LABEL[item.kind]}</span>
                      <span className="text-[10.5px] text-[#AAA]">原文第{item.startPosition + 1}—{item.endPosition}字</span>
                      <button onClick={() => toggleConfirmed(item.id)} className={`ml-auto rounded-full px-2.5 py-1 text-[10.5px] font-semibold ${item.extractionStatus === "人工确认" ? "bg-[#EAF3DE] text-[#3B6D11]" : "bg-[#FEF3C7] text-[#92400E]"}`}>
                        {item.extractionStatus === "人工确认" ? "已确认原意" : "确认原意"}
                      </button>
                    </div>
                    <p className="text-[13px] font-semibold leading-6 text-[#333]">{item.content}</p>
                    <blockquote className="mt-2 rounded-[8px] bg-[#F7F6F2] px-3 py-2 text-[12px] leading-5 text-[#666]">原文：“{item.originalExcerpt}”</blockquote>
                  </article>
                ))}
              </div>
            ) : (
              <>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
                  <div className="rounded-[12px] border border-[#E5E4DE] bg-[#FCFCFA] p-4">
                    <h3 className="mb-3 text-[13px] font-bold text-[#333]">原始内容证据</h3>
                    <SourceViewer sourceContent={rawContent} activeAnchor={activeAnchor} />
                  </div>
                  <div className="flex flex-col gap-3">
                    {analysis.nodes.map(node => (
                      <CognitionNodeCard
                        key={node.id}
                        node={node}
                        onActivateAnchor={setActiveAnchor}
                        onReview={action => { void reviewNode(action); }}
                        reviewDisabled={reviewing}
                      />
                    ))}
                  </div>
                </div>
                {(analysis.aiSuggestions.potentialPrinciples.length > 0 || analysis.aiSuggestions.topicPotential.length > 0) && (
                  <aside className="mt-4 rounded-[12px] border border-[#DED8EF] bg-[#F7F4FC] p-4">
                    <h3 className="text-[13px] font-bold text-[#5B4B7A]">AI建议（只读）</h3>
                    <p className="mt-1 text-[11.5px] text-[#746987]">以下内容为AI建议，不是老师原意</p>
                    {analysis.aiSuggestions.potentialPrinciples.length > 0 && (
                      <div className="mt-3">
                        <p className="text-[11.5px] font-bold text-[#65597A]">潜在判断原则</p>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-[12px] leading-5 text-[#65597A]">
                          {analysis.aiSuggestions.potentialPrinciples.map((item, index) => <li key={`${item.content}:${index}`}>{item.content}</li>)}
                        </ul>
                      </div>
                    )}
                    {analysis.aiSuggestions.topicPotential.length > 0 && (
                      <div className="mt-3">
                        <p className="text-[11.5px] font-bold text-[#65597A]">可延展选题</p>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-[12px] leading-5 text-[#65597A]">
                          {analysis.aiSuggestions.topicPotential.map((item, index) => <li key={`${item.content}:${index}`}>{item.content}</li>)}
                        </ul>
                      </div>
                    )}
                  </aside>
                )}
              </>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button disabled={reviewing} onClick={() => { setAnalysis(null); setAnalysisToken(""); setActiveAnchor(null); }} className="rounded-[10px] bg-[#F2F1ED] px-4 py-2.5 text-[13px] font-semibold text-[#555] disabled:opacity-40">返回修改原文</button>
              {!title.trim() && <span className="self-center text-[11.5px] text-[#A32D2D]">请先填写标题</span>}
              <button onClick={() => { void handleSave(); }} disabled={saving || reviewing || !precheck || saveDecision === "skip" || (analysis.parserVersion === 2 && analysis.nodes.some(node => node.reviewStatus === "ai_extracted"))} className="rounded-[10px] bg-[#C8F04A] px-5 py-2.5 text-[13px] font-bold text-[#1A1A1A] disabled:opacity-40">{saving ? "保存中……" : "确认保存为IP原始内容"}</button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
