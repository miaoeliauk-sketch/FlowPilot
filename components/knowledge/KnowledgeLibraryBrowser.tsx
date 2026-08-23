"use client";

import { useEffect, useMemo, useState } from "react";
import {
  loadKnowledgeLibrarySnapshot,
  queryKnowledgeLibrary,
  type KnowledgeLibraryItem,
  type KnowledgeLibrarySnapshot,
  type KnowledgeLibrarySourceKind,
  type KnowledgeLibraryTrustStatus,
} from "@/lib/knowledge-library-view";
import { KnowledgeDetailPanel } from "@/components/knowledge/KnowledgeDetailPanel";

const TRUST_LABELS: Record<KnowledgeLibraryTrustStatus, string> = {
  ai_derived_unverified: "AI拆解，尚未验证",
  adopted_awaiting_effect: "已被采用，等待效果",
  effect_evidence_awaiting_judgment: "已有真实效果证据，待人工判断",
  human_confirmed_effective: "人工确认有效",
  not_in_trust_system: "未纳入可信度体系",
};

const SOURCE_LABELS: Record<KnowledgeLibrarySourceKind, string> = {
  ip_original: "IP原始内容",
  hot_analysis_case: "爆款分析完整案例",
  hot_analysis_method: "爆款分析方法卡",
  reviewed_method: "人工审核方法卡",
  exact_template: "原文保真执行模板",
  review_experience: "人工复盘经验",
  external_case: "外部爆款案例",
  other: "其他已记录来源",
  unknown: "未记录来源",
};

const EMPTY_SNAPSHOT: KnowledgeLibrarySnapshot = { items: [] };

export function KnowledgeLibraryBrowser({
  activeIPId,
  activeIPName,
}: {
  activeIPId: string | null;
  activeIPName: string | null;
}) {
  const [snapshot, setSnapshot] = useState<KnowledgeLibrarySnapshot>(EMPTY_SNAPSHOT);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [trustStatus, setTrustStatus] = useState<KnowledgeLibraryTrustStatus | "">("");
  const [sourceKind, setSourceKind] = useState<KnowledgeLibrarySourceKind | "">("");
  const [selectedItem, setSelectedItem] = useState<KnowledgeLibraryItem | null>(null);

  useEffect(() => {
    setSearch("");
    setCategory("");
    setTrustStatus("");
    setSourceKind("");
    setSelectedItem(null);
    try {
      setSnapshot(loadKnowledgeLibrarySnapshot(activeIPId));
      setLoadError(null);
    } catch (error) {
      setSnapshot(EMPTY_SNAPSHOT);
      setLoadError(error instanceof Error ? error.message : "知识读取失败");
    }
  }, [activeIPId]);

  const categories = useMemo(
    () => [...new Set(snapshot.items.map(item => item.normalizedCategory))].sort(),
    [snapshot],
  );
  const sourceKinds = useMemo(
    () => [...new Set(snapshot.items.map(item => item.source.kind))].sort(),
    [snapshot],
  );
  const items = queryKnowledgeLibrary(snapshot, {
    query: search,
    categories: category ? [category] : undefined,
    trustStatuses: trustStatus ? [trustStatus] : undefined,
    sourceKinds: sourceKind ? [sourceKind] : undefined,
  });
  const hasFilters = Boolean(search || category || trustStatus || sourceKind);

  return (
    <section aria-labelledby="knowledge-browser-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="knowledge-browser-title" className="text-[18px] font-semibold text-[#1C1C1B]">知识浏览</h2>
          <p className="mt-1 text-[12.5px] text-[#8A8A86]">
            {activeIPId ? "显示通用知识和当前IP知识。" : "尚未选择IP，仅显示通用知识。"}
            这里只陈列来源、可信度和真实效果证据，不替你判断知识是否有效。
          </p>
        </div>
        <span className="text-[12px] text-[#8A8A86]">共{items.length}条</span>
      </div>

      <div className="grid gap-2 rounded-[14px] border border-[#E5E4DE] bg-white p-3 md:grid-cols-4">
        <input
          type="search"
          aria-label="搜索知识"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="搜索标题、正文、标签或来源"
          className="h-[40px] rounded-[10px] border border-[#E5E4DE] px-3 text-[13px] outline-none focus:border-[#639922]"
        />
        <select
          aria-label="按分类筛选"
          value={category}
          onChange={event => setCategory(event.target.value)}
          className="h-[40px] rounded-[10px] border border-[#E5E4DE] bg-white px-3 text-[13px] text-[#555]"
        >
          <option value="">全部分类</option>
          {categories.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <select
          aria-label="按可信度筛选"
          value={trustStatus}
          onChange={event => setTrustStatus(event.target.value as KnowledgeLibraryTrustStatus | "")}
          className="h-[40px] rounded-[10px] border border-[#E5E4DE] bg-white px-3 text-[13px] text-[#555]"
        >
          <option value="">全部可信度</option>
          {(Object.entries(TRUST_LABELS) as [KnowledgeLibraryTrustStatus, string][]).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          aria-label="按来源筛选"
          value={sourceKind}
          onChange={event => setSourceKind(event.target.value as KnowledgeLibrarySourceKind | "")}
          className="h-[40px] rounded-[10px] border border-[#E5E4DE] bg-white px-3 text-[13px] text-[#555]"
        >
          <option value="">全部来源</option>
          {sourceKinds.map(value => <option key={value} value={value}>{SOURCE_LABELS[value]}</option>)}
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={() => { setSearch(""); setCategory(""); setTrustStatus(""); setSourceKind(""); }}
            className="justify-self-start text-[12px] text-[#A32D2D] md:col-span-4"
          >
            清除筛选
          </button>
        )}
      </div>

      {loadError ? (
        <div role="alert" className="rounded-[12px] border border-[#F2B8B5] bg-[#FCEBEB] px-4 py-3 text-[12.5px] text-[#A32D2D]">
          知识读取失败，已停止展示，原数据不会被修改。{loadError}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[#E5E4DE] py-12 text-center text-[13px] text-[#999]">
          {hasFilters ? "没有符合当前筛选条件的知识。" : "知识库暂时没有可浏览的内容。"}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map(item => (
            <article key={item.id} data-testid="knowledge-browser-card" className="rounded-[14px] border border-[#E5E4DE] bg-white p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="min-w-0 text-[14px] font-semibold leading-5 text-[#1C1C1B]">{item.title}</h3>
                <span className="flex-shrink-0 rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10.5px] text-[#555]">
                  {item.normalizedCategory}
                </span>
              </div>
              <p className="line-clamp-3 min-h-[60px] text-[12px] leading-5 text-[#666]">
                {item.content || "暂无正文摘要"}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[10.5px]">
                <span className="rounded-full bg-[#EAF3DE] px-2 py-0.5 text-[#3B6D11]">{TRUST_LABELS[item.trustStatus]}</span>
                <span className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[#1D4ED8]">
                  {item.ipId ? `当前IP：${activeIPName ?? "未命名IP"}` : "通用知识"}
                </span>
              </div>
              <div className="mt-3 border-t border-[#F0EFE9] pt-2 text-[11px] leading-5 text-[#888]">
                <p>来源：{item.source.label}</p>
                {(item.source.name || item.source.platform) && (
                  <p>{[item.source.name, item.source.platform].filter(Boolean).join(" · ")}</p>
                )}
                <p>
                  已用于脚本{item.effect.adoptedScriptCount}次 · 已有发布复盘{item.effect.reviewedScriptCount}次
                </p>
                {item.relatedKnowledge.length > 0 && <p>关联案例／方法卡{item.relatedKnowledge.length}条</p>}
              </div>
              <button
                type="button"
                aria-label={`查看${item.title}详情`}
                onClick={() => setSelectedItem(item)}
                className="mt-3 w-full rounded-[9px] border border-[#DAD9D2] py-2 text-[12px] font-semibold text-[#555] hover:border-[#639922] hover:text-[#3B6D11]"
              >
                查看详情与证据
              </button>
            </article>
          ))}
        </div>
      )}
      {selectedItem && (
        <KnowledgeDetailPanel item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </section>
  );
}
