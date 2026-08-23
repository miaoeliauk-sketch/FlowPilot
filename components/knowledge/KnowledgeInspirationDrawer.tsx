"use client";

import { useEffect, useMemo, useState } from "react";
import { KnowledgeDetailPanel } from "@/components/knowledge/KnowledgeDetailPanel";
import {
  KNOWLEDGE_SOURCE_LABELS,
  KNOWLEDGE_TRUST_LABELS,
} from "@/components/knowledge/knowledge-library-labels";
import {
  loadKnowledgeLibrarySnapshot,
  queryKnowledgeLibrary,
  type KnowledgeLibraryItem,
  type KnowledgeLibrarySnapshot,
  type KnowledgeLibrarySourceKind,
  type KnowledgeLibraryTrustStatus,
} from "@/lib/knowledge-library-view";

const EMPTY_SNAPSHOT: KnowledgeLibrarySnapshot = { items: [] };

export function KnowledgeInspirationDrawer({
  activeIPId,
  activeIPName,
  onClose,
}: {
  activeIPId: string | null;
  activeIPName: string | null;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<KnowledgeLibrarySnapshot>(EMPTY_SNAPSHOT);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [trustStatus, setTrustStatus] = useState<KnowledgeLibraryTrustStatus | "">("");
  const [sourceKind, setSourceKind] = useState<KnowledgeLibrarySourceKind | "">("");
  const [selectedItem, setSelectedItem] = useState<KnowledgeLibraryItem | null>(null);

  useEffect(() => {
    setSnapshot(EMPTY_SNAPSHOT);
    setLoadError(null);
    setSearch("");
    setCategory("");
    setTrustStatus("");
    setSourceKind("");
    setSelectedItem(null);
    try {
      setSnapshot(loadKnowledgeLibrarySnapshot(activeIPId));
    } catch (error) {
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

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="灵感知识库"
        className="h-full w-full max-w-[520px] overflow-y-auto bg-[#FAFAF7] p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[19px] font-semibold text-[#1C1C1B]">灵感／知识库</h2>
            <p className="mt-1 text-[11.5px] leading-5 text-[#777]">
              {activeIPId ? `显示通用知识和${activeIPName ?? "当前IP"}知识。` : "尚未选择IP，仅显示通用知识。"}
              本阶段只读浏览，不会插入正文或记录采用。
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭灵感知识库" className="rounded-lg border border-[#E5E4DE] bg-white px-3 py-1.5 text-[12px] text-[#555]">关闭</button>
        </div>

        <div className="grid gap-2 rounded-[12px] border border-[#E5E4DE] bg-white p-3 sm:grid-cols-2">
          <input type="search" aria-label="搜索灵感知识" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索标题、正文、标签或来源" className="h-10 rounded-[9px] border border-[#E5E4DE] px-3 text-[12.5px] outline-none focus:border-[#639922] sm:col-span-2" />
          <select aria-label="灵感分类筛选" value={category} onChange={event => setCategory(event.target.value)} className="h-10 rounded-[9px] border border-[#E5E4DE] bg-white px-2 text-[12px] text-[#555]">
            <option value="">全部分类</option>
            {categories.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <select aria-label="灵感可信度筛选" value={trustStatus} onChange={event => setTrustStatus(event.target.value as KnowledgeLibraryTrustStatus | "")} className="h-10 rounded-[9px] border border-[#E5E4DE] bg-white px-2 text-[12px] text-[#555]">
            <option value="">全部可信度</option>
            {(Object.entries(KNOWLEDGE_TRUST_LABELS) as [KnowledgeLibraryTrustStatus, string][]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select aria-label="灵感来源筛选" value={sourceKind} onChange={event => setSourceKind(event.target.value as KnowledgeLibrarySourceKind | "")} className="h-10 rounded-[9px] border border-[#E5E4DE] bg-white px-2 text-[12px] text-[#555] sm:col-span-2">
            <option value="">全部来源</option>
            {sourceKinds.map(value => <option key={value} value={value}>{KNOWLEDGE_SOURCE_LABELS[value]}</option>)}
          </select>
        </div>

        {loadError ? (
          <div role="alert" className="mt-4 rounded-[10px] bg-[#FCEBEB] p-3 text-[12px] text-[#A32D2D]">知识读取失败，抽屉已停止展示。{loadError}</div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-[12px] text-[#888]">没有符合当前条件的知识。</p>
        ) : (
          <div className="mt-4 space-y-2">
            {items.map(item => (
              <article key={item.id} className="rounded-[12px] border border-[#E5E4DE] bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[13px] font-semibold leading-5 text-[#1C1C1B]">{item.title}</h3>
                  <span className="flex-shrink-0 rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10px] text-[#666]">{item.normalizedCategory}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-[#666]">{item.content || "暂无正文摘要"}</p>
                <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                  <span className="rounded-full bg-[#EAF3DE] px-2 py-0.5 text-[#3B6D11]">{KNOWLEDGE_TRUST_LABELS[item.trustStatus]}</span>
                  <span className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[#1D4ED8]">{item.source.label}</span>
                </div>
                <button type="button" aria-label={`查看${item.title}详情`} onClick={() => setSelectedItem(item)} className="mt-2 text-[11.5px] font-semibold text-[#3B6D11]">查看详情与证据</button>
              </article>
            ))}
          </div>
        )}
      </aside>
      {selectedItem && <KnowledgeDetailPanel item={selectedItem} onClose={() => setSelectedItem(null)} />}
    </div>
  );
}
