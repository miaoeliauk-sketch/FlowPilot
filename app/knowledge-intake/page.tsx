"use client";
import { useState } from "react";
import { useIP } from "@/lib/ip-context";
import { addKnowledgeEntry } from "@/lib/ip-store";
import type { KnowledgeCategory } from "@/lib/types";
import { apiFetch } from "@/lib/api-fetch";
import { parseXlsxFile } from "@/lib/xlsx-parser";
import { IP_CATEGORIES, isIPKnowledgeCategory } from "@/lib/knowledge-categories";
import { getIPDisplayLabel } from "@/lib/ip-display";

const ALL_CATS = ["定位方法库","选题方法库","标题方法库","开头方法库","文案框架方法库","IP人设资料","IP表达语料","IP历史内容","IP高表现内容","IP受众反馈","IP禁用规则"];
const INTAKE_FILE_ACCEPT = ".txt,.md,.xlsx,.xls,text/plain,text/markdown,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface IntakeItem {
  id: string;
  title: string;
  summary: string;
  category: string;
  ipId: string | null;
  ipMatchStatus: "matched" | "uncertain" | "not_applicable";
  ipMatchReason: string;
  coreMethod?: string;
  applicableScenarios?: string[];
  triggerKeywords?: string[];
  similarPhrases?: string[];
  aiUsage?: string;
  examples?: { input?: string; output?: string }[];
  unsuitableCases?: string[];
  tags: string[];
  reusableValue: string;
  confidence: string;
  confidenceReason: string;
  ingestRecommend: string;
  ingestReason: string;
  understanding?: string;
  keyPoints?: string[];
  relationToIP?: string;
  keywords?: string[];
  selected: boolean;
  categoryOverride?: string;
}

const CONF_STYLE: Record<string,{bg:string;color:string}> = {
  "高": { bg:"#EAF3DE", color:"#3B6D11" },
  "中": { bg:"#FEF3C7", color:"#92400E" },
  "低": { bg:"#FCEBEB", color:"#A32D2D" },
};
const REC_STYLE: Record<string,{bg:string;color:string}> = {
  "建议入库":   { bg:"#EAF3DE", color:"#3B6D11" },
  "待确认":     { bg:"#FEF3C7", color:"#92400E" },
  "不建议入库": { bg:"#FCEBEB", color:"#A32D2D" },
};

function listText(items?: string[]) {
  return (items ?? []).map(t => t.trim()).filter(Boolean).join("、");
}

function buildMethodCardContent(item: IntakeItem) {
  const examples = (item.examples ?? [])
    .map(ex => `原题：${ex.input ?? ""}\n优化：${ex.output ?? ""}`.trim())
    .filter(Boolean)
    .join("\n");
  return [
    `【一句话总结】\n${item.summary}`,
    item.coreMethod ? `【核心方法】\n${item.coreMethod}` : "",
    listText(item.applicableScenarios) ? `【适用场景】\n${listText(item.applicableScenarios)}` : "",
    listText(item.triggerKeywords) ? `【触发关键词】\n${listText(item.triggerKeywords)}` : "",
    listText(item.similarPhrases) ? `【相似说法】\n${listText(item.similarPhrases)}` : "",
    item.aiUsage ? `【AI调用方式】\n${item.aiUsage}` : "",
    examples ? `【示例】\n${examples}` : "",
    listText(item.unsuitableCases) ? `【不适用情况】\n${listText(item.unsuitableCases)}` : "",
    item.reusableValue ? `【可复用场景】\n${item.reusableValue}` : "",
  ].filter(Boolean).join("\n\n");
}

function buildIPUnderstandingContent(item: IntakeItem, originalContent: string) {
  return [
    `【内容概要】\n${item.summary}`,
    item.understanding ? `【AI对内容的理解】\n${item.understanding}` : "",
    listText(item.keyPoints) ? `【原文关键信息】\n${listText(item.keyPoints)}` : "",
    item.relationToIP ? `【与当前IP的关系】\n${item.relationToIP}` : "",
    `【原始内容】\n${originalContent.trim()}`,
  ].filter(Boolean).join("\n\n");
}

interface KnowledgeIntakePageProps {
  searchParams?: {
    scope?: string;
    category?: string;
  };
}

export default function KnowledgeIntakePage({ searchParams }: KnowledgeIntakePageProps) {
  const { ips, activeIP } = useIP();
  const isIPMode = searchParams?.scope === "ip";
  const requestedCategory = searchParams?.category ?? "";
  const availableCategories = isIPMode
    ? IP_CATEGORIES.map(category => category.id)
    : ALL_CATS;
  const [rawContent, setRawContent] = useState("");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [sourceType, setSourceType] = useState<"text" | "excel">("text");
  const [fileProcessing, setFileProcessing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<IntakeItem[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saveCount, setSaveCount] = useState(0);

  async function handleInputFile(file: File) {
    setError("");
    setFileName(file.name);
    if (file.name.match(/\.xlsx?$/i)) {
      setFileProcessing(true);
      setSourceType("excel");
      try {
        const result = await parseXlsxFile(file);
        const sheet = result.sheets[0];
        if (!sheet) { setError("Excel 文件为空"); return; }
        const rows = sheet.rows.map(row => Object.values(row).filter(Boolean).join(" | ")).filter(Boolean);
        setRawContent(sheet.headers.join(" | ") + "\n" + rows.join("\n"));
      } catch {
        setRawContent("");
        setError("Excel 解析失败");
      } finally {
        setFileProcessing(false);
      }
      return;
    }

    if (!file.name.match(/\.(txt|md)$/i) && !["text/plain", "text/markdown"].includes(file.type)) {
      setError("暂时支持 txt、md、xlsx、xls 格式");
      return;
    }

    setSourceType("text");
    const reader = new FileReader();
    reader.onload = ev => setRawContent((ev.target && ev.target.result as string) || "");
    reader.onerror = () => setError("文件读取失败");
    reader.readAsText(file, "utf-8");
  }

  async function handleAnalyze() {
    if (!rawContent.trim()) { setError("请先粘贴原始资料"); return; }
    if (isIPMode && !activeIP) { setError("请先选择当前IP"); return; }
    setLoading(true); setError(""); setItems([]); setSaved(false);
    try {
      const res = await apiFetch("/api/knowledge-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawContent,
          sourceType,
          sourceName: fileName,
          scope: isIPMode ? "ip" : "global",
          requestedCategory: isIPMode ? requestedCategory : undefined,
          activeIPId: activeIP?.id ?? null,
          availableIPs: ips.map(ip => ({
            id: ip.id,
            name: ip.name,
            positioning: ip.positioning,
            contentDirection: ip.contentDirection,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "分析失败"); return; }
      const responseItems = data.mode === "ip"
        ? data.item ? [data.item] : []
        : Array.isArray(data.items) ? data.items : [];
      const parsed: IntakeItem[] = responseItems.map((it: IntakeItem, i: number) => ({
        ...it,
        tags: isIPMode ? it.keywords ?? [] : it.tags ?? [],
        id: "item-" + i + "-" + Date.now(),
        selected: it.ingestRecommend === "建议入库" &&
          (!isIPKnowledgeCategory(it.category) || Boolean(it.ipId)),
      }));
      setItems(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误");
    } finally {
      setLoading(false);
    }
  }

  function handleSave() {
    const toSave = items.filter(it => it.selected);
    const unboundItem = toSave.find(it => {
      const category = it.categoryOverride || it.category;
      return isIPKnowledgeCategory(category) && !it.ipId;
    });
    if (unboundItem) {
      setError(`请先为“${unboundItem.title}”选择所属IP`);
      return;
    }
    let count = 0;
    for (const it of toSave) {
      const cat = (it.categoryOverride || it.category) as KnowledgeCategory;
      if (isIPMode) {
        const keywords = (it.keywords ?? []).map(keyword => keyword.trim()).filter(Boolean);
        const evidence = JSON.stringify({
          intakeMode: "ip_understanding",
          originalCategory: it.category,
          normalizedCategory: cat,
          methodCard: false,
          understanding: it.understanding ?? "",
          keyPoints: it.keyPoints ?? [],
          relationToIP: it.relationToIP ?? "",
          confidence: it.confidence,
          reason: it.confidenceReason,
          needsReview: it.ingestRecommend === "待确认",
        });
        addKnowledgeEntry({
          category: cat,
          title: it.title,
          rawContent: buildIPUnderstandingContent(it, rawContent),
          tags: keywords,
          keywords,
          ipId: it.ipId ?? activeIP?.id ?? null,
          sourceTier: (["高","中","低"].includes(it.confidence) ? it.confidence as "高"|"中"|"低" : "低"),
          sourceTierReason: it.confidenceReason,
          contentDirection: [],
          sourcePlatform: "IP内容理解入库",
          sourceUrl: "",
          note: evidence,
          extractedAt: new Date().toISOString(),
          metrics: null,
          viralEvaluation: null,
          usageRecords: [],
          status: "未使用",
          dna: null,
        });
        count++;
        continue;
      }
      const triggerKeywords = [...(it.triggerKeywords ?? []), ...(it.similarPhrases ?? [])].map(t => t.trim()).filter(Boolean);
      const ev = JSON.stringify({
        originalCategory: it.category,
        normalizedCategory: cat,
        methodCard: true,
        coreMethod: it.coreMethod ?? "",
        applicableScenarios: it.applicableScenarios ?? [],
        triggerKeywords: it.triggerKeywords ?? [],
        similarPhrases: it.similarPhrases ?? [],
        aiUsage: it.aiUsage ?? "",
        examples: it.examples ?? [],
        unsuitableCases: it.unsuitableCases ?? [],
        confidence: it.confidence,
        reason: it.confidenceReason,
        matchedRules: [...(it.tags ?? []), ...triggerKeywords],
        needsReview: it.ingestRecommend === "待确认",
      });
      addKnowledgeEntry({ category: cat, title: it.title, rawContent: buildMethodCardContent(it), tags: it.tags ?? [], keywords: triggerKeywords, ipId: isIPKnowledgeCategory(cat) ? it.ipId : null, sourceTier: (["高","中","低"].includes(it.confidence) ? it.confidence as "高"|"中"|"低" : "低"), sourceTierReason: it.aiUsage || it.confidenceReason, contentDirection: it.applicableScenarios ?? [], sourcePlatform: "智能入库助手", sourceUrl: "", note: ev, extractedAt: new Date().toISOString(), metrics: null, viralEvaluation: null, usageRecords: [], status: "未使用", dna: null });
      count++;
    }
    setSaveCount(count);
    setSaved(true);
  }

  const selectedCount = items.filter(it => it.selected).length;

  return (
    <div className="min-h-screen p-6 md:p-8">
      <header className="mb-6">
        <div className="mb-1.5 text-[13px] text-[#8A8A86]">
          <a href="/" className="font-semibold text-[#639922]">工作台</a> / <a href="/knowledge-hub" className="text-[#639922]">知识库中心</a> / {isIPMode ? "IP内容理解入库" : "智能入库助手"}
        </div>
        <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1B]">{isIPMode ? "IP内容理解入库" : "智能入库助手"}</h1>
        <p className="mt-1 text-[13px] text-[#888]">
          {isIPMode
            ? `忠实理解你输入的完整内容，保留原文和思维脉络，确认后写入「${activeIP?.name ?? "当前IP"}」知识库。`
            : "粘贴原始资料，AI自动提炼成可复用的短视频方法知识，确认后写入通用知识库。"}
        </p>
      </header>

      {items.length === 0 && !loading && (
        <div className="rounded-[16px] border border-[#E5E4DE] bg-white p-5">
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); setError(""); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault(); setDragging(false);
              const file = e.dataTransfer.files[0];
              if (!file) return;
              handleInputFile(file);
            }}
            className="mb-4 flex cursor-pointer flex-col items-center gap-2 rounded-[12px] border-2 border-dashed py-6 text-center transition-all"
            style={{ borderColor: dragging ? "#639922" : "#E5E4DE", background: dragging ? "#F7FCF0" : "#FAFAF8" }}
            onClick={() => { setError(""); const el = document.getElementById("kb-file-input"); if (el) el.click(); }}
          >
            <span className="text-[24px]">📄</span>
            <p className="text-[12.5px] font-semibold text-[#555]">{fileName || "拖拽文字或Excel资料到这里，或点击上传"}</p>
            <p className="text-[11.5px] text-[#AAA]">支持txt、md、xlsx、xls，也可以在下方直接粘贴文字</p>
            <input id="kb-file-input" type="file" accept={INTAKE_FILE_ACCEPT} className="hidden"
              onChange={e => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                handleInputFile(file);
                e.target.value = "";
              }} />
          </div>
          <label className="mb-2 block text-[13px] font-semibold text-[#555]">或粘贴原始资料</label>
          <textarea value={rawContent} onChange={e => { setRawContent(e.target.value); setFileName(""); setSourceType("text"); setError(""); }}
            placeholder={isIPMode
              ? "粘贴当前IP的逐字稿、文章、观点、经历或受众反馈…AI会理解完整内容，不会拆成方法卡。"
              : "粘贴逐字稿、文案、方法论笔记、评论洞察…AI会提炼成可复用的短视频方法知识。"}
            rows={8}
            className="w-full resize-none rounded-[12px] border border-[#E5E4DE] bg-[#FAFAF8] px-4 py-3 text-[13px] leading-6 text-[#333] outline-none focus:border-[#639922]" />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[12px] text-[#BBB]">{rawContent.length} 字{fileName ? " · " + fileName : ""}</span>
            <button
              onClick={handleAnalyze}
              disabled={!rawContent.trim() || fileProcessing || loading || (isIPMode && !activeIP)}
              className="rounded-[12px] px-6 py-2.5 text-[13px] font-bold disabled:opacity-40"
              style={{ background: "#C8F04A", color: "#1A1A1A" }}>
              {fileProcessing ? "正在读取Excel…" : isIPMode ? "AI理解内容" : "AI提炼方法"}
            </button>
          </div>
          {error && <div className="mt-3 flex items-center justify-between rounded-[8px] bg-[#FCEBEB] px-3 py-2"><p className="text-[12.5px] text-[#A32D2D]">{error}</p><button onClick={() => setError("")} className="ml-2 text-[12px] text-[#A32D2D] font-bold">✕</button></div>}
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center gap-3 py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#E5E4DE] border-t-[#639922]" />
          <p className="text-[13px] text-[#888]">{isIPMode ? "AI正在理解完整内容" : "AI正在提炼资料"}，生成中请稍候，请勿重复提交，最坏约2分钟。</p>
        </div>
      )}

      {items.length > 0 && !saved && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <span className="text-[15px] font-bold text-[#1C1C1B]">{isIPMode ? "理解结果" : "提炼结果"}</span>
              <span className="ml-2 text-[13px] text-[#888]">共 {items.length} 条，已选 {selectedCount} 条</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setItems([]); setRawContent(""); setFileName(""); setSourceType("text"); setError(""); }}
                className="rounded-[10px] bg-[#F2F1ED] px-4 py-2 text-[12.5px] font-semibold text-[#666]">重新输入</button>
              <button onClick={handleSave} disabled={selectedCount === 0}
                className="rounded-[10px] px-4 py-2 text-[12.5px] font-bold disabled:opacity-40"
                style={{ background: "#1C1C1B", color: "#fff" }}>
                {isIPMode ? "写入当前IP知识库" : "写入通用知识库"}（{selectedCount} 条）
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {items.map((item, i) => {
              const effectiveCategory = item.categoryOverride || item.category;
              return (
              <div key={item.id} className="rounded-[14px] border-2 bg-white p-4 transition-all"
                style={{ borderColor: item.selected ? "#639922" : "#E5E4DE" }}>
                <div className="mb-3 flex items-start gap-3">
                  <button onClick={() => setItems(prev => prev.map((it,j) => j===i ? {...it,selected:!it.selected} : it))}
                    className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-all"
                    style={{ borderColor: item.selected ? "#639922" : "#CCC", background: item.selected ? "#639922" : "white" }}>
                    {item.selected && <span className="text-[10px] font-bold text-white">✓</span>}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-bold text-[#1C1C1B]">{item.title}</span>
                      <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={CONF_STYLE[item.confidence] ?? CONF_STYLE["低"]}>{item.confidence}置信度</span>
                      <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={REC_STYLE[item.ingestRecommend] ?? REC_STYLE["待确认"]}>{item.ingestRecommend}</span>
                    </div>
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11.5px] text-[#888]">分类：</span>
                      <select value={effectiveCategory}
                        onChange={e => setItems(prev => prev.map((it,j) => j===i ? {
                          ...it,
                          categoryOverride: e.target.value,
                          ipId: isIPKnowledgeCategory(e.target.value) && ips.some(ip => ip.id === it.ipId)
                            ? it.ipId
                            : null,
                          selected: isIPKnowledgeCategory(e.target.value) ? false : it.selected,
                        } : it))}
                        className="rounded-[6px] border border-[#E5E4DE] px-2 py-0.5 text-[11.5px] outline-none">
                        {availableCategories.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    {isIPKnowledgeCategory(effectiveCategory) && (
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11.5px] text-[#888]">所属IP：</span>
                        <select
                          value={item.ipId ?? ""}
                          onChange={e => setItems(prev => prev.map((it,j) => j===i ? {
                            ...it,
                            ipId: e.target.value || null,
                            ipMatchStatus: e.target.value ? "matched" : "uncertain",
                            selected: e.target.value ? it.selected : false,
                          } : it))}
                          className="rounded-[6px] border border-[#E5E4DE] px-2 py-0.5 text-[11.5px] outline-none"
                        >
                          <option value="">请选择所属IP</option>
                          {ips.map(ip => <option key={ip.id} value={ip.id}>{getIPDisplayLabel(ip, ips)}</option>)}
                        </select>
                        {item.ipMatchReason && <span className="text-[11px] text-[#AAA]">{item.ipMatchReason}</span>}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {(item.tags ?? []).map(t => <span key={t} className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10.5px] text-[#666]">#{t}</span>)}
                    </div>
                  </div>
                </div>
                <div className="mb-2 rounded-[10px] bg-[#FAFAF8] px-3 py-2.5 text-[12.5px] leading-5 text-[#444]">
                  <p>{item.summary}</p>
                  {isIPMode && item.understanding && <p className="mt-1.5"><span className="font-semibold text-[#555]">内容理解：</span>{item.understanding}</p>}
                  {!isIPMode && item.coreMethod && <p className="mt-1.5"><span className="font-semibold text-[#555]">核心方法：</span>{item.coreMethod}</p>}
                </div>
                {isIPMode && listText(item.keyPoints) && <p className="mb-1 text-[12px] text-[#888]"><span className="font-semibold text-[#555]">原文关键信息：</span>{listText(item.keyPoints)}</p>}
                {isIPMode && item.relationToIP && <p className="mb-1.5 text-[12px] text-[#888]"><span className="font-semibold text-[#555]">与当前IP的关系：</span>{item.relationToIP}</p>}
                {!isIPMode && listText(item.applicableScenarios) && <p className="mb-1 text-[12px] text-[#888]"><span className="font-semibold text-[#555]">适用场景：</span>{listText(item.applicableScenarios)}</p>}
                {!isIPMode && listText(item.triggerKeywords) && <p className="mb-1 text-[12px] text-[#888]"><span className="font-semibold text-[#555]">触发关键词：</span>{listText(item.triggerKeywords)}</p>}
                {!isIPMode && item.aiUsage && <p className="mb-1.5 text-[12px] text-[#888]"><span className="font-semibold text-[#555]">AI调用方式：</span>{item.aiUsage}</p>}
                <p className="text-[11.5px] text-[#AAA]"><span className="font-semibold text-[#888]">入库依据：</span>{item.ingestReason} · {item.confidenceReason}</p>
              </div>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => { setItems([]); setRawContent(""); setFileName(""); setSourceType("text"); setError(""); }}
              className="rounded-[10px] bg-[#F2F1ED] px-5 py-2.5 text-[13px] font-semibold text-[#666]">重新输入</button>
            <button onClick={handleSave} disabled={selectedCount === 0}
              className="rounded-[10px] px-5 py-2.5 text-[13px] font-bold disabled:opacity-40"
              style={{ background: "#1C1C1B", color: "#fff" }}>
              {isIPMode ? "写入当前IP知识库" : "写入通用知识库"}（{selectedCount} 条）
            </button>
          </div>
          {error && <div className="mt-3 rounded-[8px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{error}</div>}
        </>
      )}

      {saved && (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <div className="text-[48px]">✅</div>
          <p className="text-[16px] font-bold text-[#1C1C1B]">成功写入 {saveCount} 条知识</p>
          <p className="text-[13px] text-[#888]">已保存到知识库，可在知识库中心查看和管理。</p>
          <div className="flex gap-3">
            <button onClick={() => { setItems([]); setRawContent(""); setFileName(""); setSourceType("text"); setSaved(false); setError(""); }}
              className="rounded-[10px] bg-[#F2F1ED] px-5 py-2.5 text-[13px] font-semibold text-[#666]">继续入库</button>
            <a href="/knowledge-hub" className="rounded-[10px] px-5 py-2.5 text-[13px] font-bold text-white" style={{ background: "#1C1C1B" }}>去知识库查看</a>
          </div>
        </div>
      )}
    </div>
  );
}
