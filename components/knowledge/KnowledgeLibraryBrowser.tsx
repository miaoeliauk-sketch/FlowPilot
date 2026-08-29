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
import { GlobalConstraintConfirmationPanel } from "@/components/knowledge/GlobalConstraintConfirmationPanel";
import {
  deleteKnowledgeEntryFromLibrary,
  getKnowledgeDeletionPreview,
} from "@/lib/ip-store";
import {
  KNOWLEDGE_SOURCE_LABELS,
  KNOWLEDGE_TRUST_LABELS,
} from "@/components/knowledge/knowledge-library-labels";

const EMPTY_SNAPSHOT: KnowledgeLibrarySnapshot = { items: [] };
const PAGE_SIZE = 12;

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
  const [showGlobalConstraintConfirmation, setShowGlobalConstraintConfirmation] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [jumpPage, setJumpPage] = useState("1");

  useEffect(() => {
    setSearch("");
    setCategory("");
    setTrustStatus("");
    setSourceKind("");
    setSelectedItem(null);
    setShowGlobalConstraintConfirmation(false);
    setCurrentPage(1);
    setJumpPage("1");
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
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pageItems = items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasFilters = Boolean(search || category || trustStatus || sourceKind);

  useEffect(() => {
    const validPage = Math.min(currentPage, totalPages);
    if (validPage !== currentPage) setCurrentPage(validPage);
    setJumpPage(String(validPage));
  }, [currentPage, totalPages]);

  function resetToFirstPage() {
    setCurrentPage(1);
    setJumpPage("1");
  }

  function goToPage(page: number) {
    const validPage = Math.min(totalPages, Math.max(1, Math.trunc(page)));
    setCurrentPage(validPage);
    setJumpPage(String(validPage));
  }

  async function handleDelete(item: KnowledgeLibraryItem) {
    await deleteKnowledgeEntryFromLibrary({
      id: item.id,
      activeIPId,
      expectedIPId: item.ipId,
    });
    setSelectedItem(null);
    try {
      setSnapshot(loadKnowledgeLibrarySnapshot(activeIPId));
      setLoadError(null);
    } catch {
      setSnapshot(EMPTY_SNAPSHOT);
      setLoadError("知识已删除，但列表刷新失败，请手动刷新页面确认最新结果。");
    }
  }

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
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowGlobalConstraintConfirmation(true)}
            className="rounded-[9px] border border-[#D9B56D] bg-[#FFF9ED] px-3 py-2 text-[12px] font-semibold text-[#6B5122]"
          >
            查看待确认V2强制底线
          </button>
          <span className="text-[12px] text-[#8A8A86]">共{items.length}条</span>
        </div>
      </div>

      <div className="grid gap-2 rounded-[14px] border border-[#E5E4DE] bg-white p-3 md:grid-cols-4">
        <input
          type="search"
          aria-label="搜索知识"
          value={search}
          onChange={event => { setSearch(event.target.value); resetToFirstPage(); }}
          placeholder="搜索标题、正文、标签或来源"
          className="h-[40px] rounded-[10px] border border-[#E5E4DE] px-3 text-[13px] outline-none focus:border-[#639922]"
        />
        <select
          aria-label="按分类筛选"
          value={category}
          onChange={event => { setCategory(event.target.value); resetToFirstPage(); }}
          className="h-[40px] rounded-[10px] border border-[#E5E4DE] bg-white px-3 text-[13px] text-[#555]"
        >
          <option value="">全部分类</option>
          {categories.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <select
          aria-label="按可信度筛选"
          value={trustStatus}
          onChange={event => {
            setTrustStatus(event.target.value as KnowledgeLibraryTrustStatus | "");
            resetToFirstPage();
          }}
          className="h-[40px] rounded-[10px] border border-[#E5E4DE] bg-white px-3 text-[13px] text-[#555]"
        >
          <option value="">全部可信度</option>
          {(Object.entries(KNOWLEDGE_TRUST_LABELS) as [KnowledgeLibraryTrustStatus, string][]).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          aria-label="按来源筛选"
          value={sourceKind}
          onChange={event => {
            setSourceKind(event.target.value as KnowledgeLibrarySourceKind | "");
            resetToFirstPage();
          }}
          className="h-[40px] rounded-[10px] border border-[#E5E4DE] bg-white px-3 text-[13px] text-[#555]"
        >
          <option value="">全部来源</option>
          {sourceKinds.map(value => <option key={value} value={value}>{KNOWLEDGE_SOURCE_LABELS[value]}</option>)}
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setCategory("");
              setTrustStatus("");
              setSourceKind("");
              resetToFirstPage();
            }}
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
          {pageItems.map(item => (
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
                <span className="rounded-full bg-[#EAF3DE] px-2 py-0.5 text-[#3B6D11]">{KNOWLEDGE_TRUST_LABELS[item.trustStatus]}</span>
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
      {!loadError && items.length > 0 && (
        <nav aria-label="知识分页" className="flex flex-wrap items-center justify-center gap-2 rounded-[12px] border border-[#E5E4DE] bg-white px-3 py-3">
          <button
            type="button"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="rounded-[8px] border border-[#DAD9D2] px-3 py-1.5 text-[12px] text-[#555] disabled:cursor-not-allowed disabled:opacity-40"
          >
            上一页
          </button>
          {Array.from({ length: totalPages }, (_, index) => index + 1).map(page => (
            <button
              key={page}
              type="button"
              aria-label={`第${page}页`}
              aria-current={page === currentPage ? "page" : undefined}
              onClick={() => goToPage(page)}
              className="h-8 min-w-8 rounded-[8px] px-2 text-[12px] font-semibold"
              style={page === currentPage
                ? { background: "#1C1C1B", color: "#fff" }
                : { border: "1px solid #DAD9D2", color: "#555" }}
            >
              {page}
            </button>
          ))}
          <button
            type="button"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="rounded-[8px] border border-[#DAD9D2] px-3 py-1.5 text-[12px] text-[#555] disabled:cursor-not-allowed disabled:opacity-40"
          >
            下一页
          </button>
          <span className="ml-1 text-[12px] text-[#8A8A86]">第{currentPage}/{totalPages}页</span>
          <label className="ml-1 flex items-center gap-1.5 text-[12px] text-[#666]">
            跳到
            <input
              type="number"
              min={1}
              max={totalPages}
              aria-label="跳转页码"
              value={jumpPage}
              onChange={event => setJumpPage(event.target.value)}
              className="h-8 w-16 rounded-[8px] border border-[#DAD9D2] px-2 text-center outline-none focus:border-[#639922]"
            />
            页
          </label>
          <button
            type="button"
            onClick={() => {
              const requestedPage = Number(jumpPage);
              if (Number.isFinite(requestedPage)) goToPage(requestedPage);
            }}
            className="rounded-[8px] border border-[#DAD9D2] px-3 py-1.5 text-[12px] font-semibold text-[#555]"
          >
            跳转
          </button>
        </nav>
      )}
      {selectedItem && (
        <KnowledgeDetailPanel
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onPrepareDelete={() => getKnowledgeDeletionPreview({
            id: selectedItem.id,
            activeIPId,
            expectedIPId: selectedItem.ipId,
          })}
          onDelete={() => handleDelete(selectedItem)}
        />
      )}
      {showGlobalConstraintConfirmation && (
        <GlobalConstraintConfirmationPanel onClose={() => setShowGlobalConstraintConfirmation(false)} />
      )}
    </section>
  );
}
