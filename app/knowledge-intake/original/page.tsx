"use client";

import { useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { useIP } from "@/lib/ip-context";
import { addIPOriginalSource } from "@/lib/ip-original-source";
import type {
  IPOriginalSourceKind,
  IPSourceAnalysis,
  IPSourceAnalysisKind,
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

function draftSourceId() {
  return `source-draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function IPOriginalContentIntakePage() {
  const { activeIP } = useIP();
  const [title, setTitle] = useState("");
  const [sourceKind, setSourceKind] = useState<IPOriginalSourceKind>("直播逐字稿");
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [analysis, setAnalysis] = useState<IPSourceAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState("");
  const [error, setError] = useState("");
  const draftId = useMemo(() => draftSourceId(), []);
  const confirmedCount = analysis?.items.filter(item => item.extractionStatus === "人工确认").length ?? 0;

  async function handleFile(file: File) {
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
  }

  async function handleAnalyze() {
    if (!activeIP) {
      setError("请先在身份中心选择当前IP");
      return;
    }
    if (!rawContent.trim()) {
      setError("请先粘贴或上传老师的原始内容");
      return;
    }
    setLoading(true);
    setError("");
    setAnalysis(null);
    try {
      const response = await apiFetch("/api/ip-source-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: draftId,
          activeIPId: activeIP.id,
          rawContent,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "原始内容解析失败");
        return;
      }
      setAnalysis(data.analysis);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "网络错误");
    } finally {
      setLoading(false);
    }
  }

  function handleSave() {
    if (!activeIP || !analysis) return;
    if (!title.trim()) {
      setError("请填写原始内容标题");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = addIPOriginalSource({
        ipId: activeIP.id,
        title,
        sourceKind,
        originalContent: rawContent,
        sourceName,
        sourceUrl,
        analysis,
      });
      setSavedId(saved.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function toggleConfirmed(itemId: string) {
    setAnalysis(current => current ? {
      ...current,
      items: current.items.map(item => item.id === itemId ? {
        ...item,
        extractionStatus: item.extractionStatus === "人工确认" ? "AI提取" : "人工确认",
      } : item),
    } : null);
  }

  function confirmAll() {
    setAnalysis(current => current ? {
      ...current,
      items: current.items.map(item => ({ ...item, extractionStatus: "人工确认" })),
    } : null);
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
        <section className="rounded-[16px] border border-[#E5E4DE] bg-white p-5">
          <div className="mb-4 rounded-[10px] bg-[#EFF6FF] px-3 py-2.5 text-[12.5px] text-[#1D4ED8]">
            当前IP：<b>{activeIP?.name ?? "尚未选择"}</b>。这份内容只会归入当前IP，不会作为通用方法使用。
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[12.5px] font-semibold text-[#555]">标题
              <input value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：持续输出的真正含义" className="mt-1.5 w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 text-[13px] font-normal outline-none focus:border-[#639922]" />
            </label>
            <label className="text-[12.5px] font-semibold text-[#555]">资料类型
              <select value={sourceKind} onChange={event => setSourceKind(event.target.value as IPOriginalSourceKind)} className="mt-1.5 w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 text-[13px] font-normal outline-none">
                {SOURCE_KINDS.map(kind => <option key={kind}>{kind}</option>)}
              </select>
            </label>
          </div>
          <label className="mt-3 block text-[12.5px] font-semibold text-[#555]">来源链接（可选）
            <input value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="用于记录资料出处，不代表系统已核实外部事实" className="mt-1.5 w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 text-[13px] font-normal outline-none focus:border-[#639922]" />
          </label>
          <label className="mt-4 flex cursor-pointer items-center justify-center rounded-[10px] border border-dashed border-[#CFCFC7] bg-[#FAFAF8] px-4 py-4 text-[12.5px] text-[#666]">
            {sourceName ? `已读取：${sourceName}` : "上传txt、md或srt，或者直接在下方粘贴"}
            <input type="file" accept={ACCEPT} className="hidden" onChange={event => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
              event.target.value = "";
            }} />
          </label>
          <textarea value={rawContent} onChange={event => { setRawContent(event.target.value); setAnalysis(null); }} rows={14} placeholder="粘贴老师的课程、直播逐字稿、文章或语音整理全文……" className="mt-3 w-full resize-y rounded-[12px] border border-[#E5E4DE] bg-[#FAFAF8] px-4 py-3 text-[13px] leading-6 text-[#333] outline-none focus:border-[#639922]" />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-[#AAA]">{rawContent.length}字。原文将在确认保存时完整写入，不会被AI改写。</span>
            <button onClick={handleAnalyze} disabled={loading || !rawContent.trim() || !activeIP} className="rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">{loading ? "正在理解原始内容……" : "开始理解内容"}</button>
          </div>
        </section>

        {error && <div role="alert" className="rounded-[10px] bg-[#FCEBEB] px-3 py-2.5 text-[12.5px] text-[#A32D2D]">{error}</div>}

        {analysis && (
          <section className="rounded-[16px] border border-[#D8E9C0] bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-bold text-[#1C1C1B]">内容理解结果</h2>
                <p className="mt-1 text-[12px] text-[#888]">当前全部标记为“AI提取”。它表示可以回到原文，不表示外部事实已经核实。</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${analysis.items.length > 0 && confirmedCount === analysis.items.length ? "bg-[#EAF3DE] text-[#3B6D11]" : "bg-[#FEF3C7] text-[#92400E]"}`}>
                已确认{confirmedCount}／{analysis.items.length}条
              </span>
              <button onClick={confirmAll} className="rounded-[9px] bg-[#EAF3DE] px-3 py-2 text-[11.5px] font-semibold text-[#3B6D11]">全部确认原意</button>
            </div>
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
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setAnalysis(null)} className="rounded-[10px] bg-[#F2F1ED] px-4 py-2.5 text-[13px] font-semibold text-[#555]">返回修改原文</button>
              <button onClick={handleSave} disabled={saving || !title.trim()} className="rounded-[10px] bg-[#C8F04A] px-5 py-2.5 text-[13px] font-bold text-[#1A1A1A] disabled:opacity-40">{saving ? "保存中……" : "确认保存为IP原始内容"}</button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
