"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Icon, IconName } from "@/components/ui/icon";
import {
  getKnowledgeEntries, getTopicAssets, getScriptAssets,
  getVideoReviewsReadOnly, getCoverRefs, getGlobalCoverRefs,
  CoverRefStoreError,
} from "@/lib/ip-store";
import { useIP } from "@/lib/ip-context";
import type { ScriptAsset } from "@/lib/types";
import { getTopicCalibrationSamples } from "@/lib/topic-calibration-store";
import {
  getNormalizedCategory,
  isGlobalMethodCategory,
  isIPKnowledgeCategory,
} from "@/lib/knowledge-categories";
import { filterKnowledgeVisibleToIP } from "@/lib/knowledge-scope";
import { assessVideoReviewTraceability } from "@/lib/review-traceability";

type DashboardModule = {
  href: string;
  badge: string;
  title: string;
  desc: string;
  icon: IconName;
};

const CORE_WORKFLOW: DashboardModule[] = [
  { href: "/copy-integration", badge: "01", title: "文案整合", desc: "把直播逐字稿整理成结构清楚、证据完整、可继续拆选题的母稿。", icon: "edit" },
  { href: "/topic-board", badge: "02", title: "AI选题董事会", desc: "结合当前IP与知识库，多角色评审选题价值、风险和优化方向。", icon: "chat" },
  { href: "/script-factory", badge: "03", title: "AI IP脚本工厂", desc: "读取已确认选题和IP表达风格，生成标题、口播稿、分镜与拍摄建议。", icon: "film" },
  { href: "/shoot-room", badge: "04", title: "AI拍摄作战室", desc: "检查脚本可拍性，整理执行计划、风险提示和现场拍摄清单。", icon: "camera" },
  { href: "/review", badge: "05", title: "发布复盘", desc: "记录发布数据，分析表现原因，并把有效经验沉淀回知识资产。", icon: "calendar" },
];

const OPERATIONS_TOOLS: DashboardModule[] = [
  { href: "/live-clips", badge: "直播", title: "直播切片", desc: "从直播逐字稿提炼可用片段，判断内容目的并生成有依据的切片计划。", icon: "film" },
  { href: "/knowledge-intake", badge: "知识", title: "智能知识入库", desc: "理解资料内容，区分通用方法与IP专属知识，并给出分类依据。", icon: "sparkle" },
  { href: "/comment-radar", badge: "洞察", title: "评论区需求雷达", desc: "整理评论区真实问题、需求信号和可继续生产的内容机会。", icon: "radar" },
  { href: "/hot-analysis", badge: "研究", title: "爆款分析", desc: "拆解高表现内容的选题、开头、结构与传播原因，形成参考样本。", icon: "fire" },
  { href: "/copy-optimization", badge: "优化", title: "文案优化", desc: "按当前IP的真实语气改写文案，并保留原文对照和修改说明。", icon: "edit" },
  { href: "/decision-memory", badge: "沉淀", title: "内容判断库", desc: "记录你对内容的判断、依据和边界，让后续AI更懂你的取舍。", icon: "flask" },
];

const ASSET_SEGMENTS = [
  { key: "globalMethods", label: "通用方法库", color: "#C8F04A", href: "/knowledge-hub?scope=global" },
  { key: "ipKnowledge", label: "当前IP知识库", color: "#8FB6FF", href: "/knowledge-hub?scope=ip" },
  { key: "coverRefs", label: "封面参考库", color: "#F0C86B", href: "/knowledge-hub?scope=material" },
  { key: "calibrationSamples", label: "历史校准样本", color: "#C9A8F0", href: "/topic-board" },
] as const;

function PendingPill({ label, count, onClick, href, expanded }: {
  label: string;
  count: number;
  onClick?: () => void;
  href?: string;
  expanded?: boolean;
}) {
  const inner = (
    <>
      <span>{label}</span>
      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#C8F04A] px-1.5 text-[11px] font-bold text-[#1C1C1B]">{count}</span>
    </>
  );
  const className = "flex items-center gap-2 rounded-full border border-[#1C1C1B] bg-white px-3.5 py-1.5 text-[12px] font-semibold text-[#1C1C1B] transition hover:bg-[#1C1C1B] hover:text-white";
  if (href) return <Link href={href} className={className}>{inner}</Link>;
  return <button type="button" onClick={onClick} aria-expanded={expanded} className={className}>{inner}</button>;
}

function ProdStat({ label, value, href, onClick, expanded }: {
  label: string;
  value: number | string;
  href?: string;
  onClick?: () => void;
  expanded?: boolean;
}) {
  const inner = (
    <div className="group flex flex-col gap-1 rounded-[18px] border border-[#E5E4DE] bg-white p-5 text-left transition hover:border-[#1C1C1B]">
      <span className="text-[32px] font-bold leading-none tracking-tight text-[#1C1C1B] tabular-nums">{value}</span>
      <span className="mt-1.5 text-[12px] text-[#8A8A86]">{label} <span className="inline-block transition group-hover:translate-x-0.5">→</span></span>
    </div>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return <button type="button" onClick={onClick} aria-expanded={expanded} className="w-full">{inner}</button>;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "";
  const d = Math.floor(diff / 86400000);
  if (d <= 0) return "今天";
  if (d === 1) return "昨天";
  if (d < 7) return `${d}天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export default function Home() {
  const { activeIP, loading: ipLoading } = useIP();
  const [mounted, setMounted] = useState(false);
  const [showPendingScripts, setShowPendingScripts] = useState(false);
  const [showScriptHistory, setShowScriptHistory] = useState(false);
  const [stats, setStats] = useState({
    globalMethods: 0, ipKnowledge: 0, coverRefs: 0, calibrationSamples: 0,
    topics: 0, scripts: 0, reviews: 0,
    pendingTopics: 0, pendingScripts: 0, pendingReviews: 0,
  });
  const [recentKnowledge, setRecentKnowledge] = useState<{ title: string; category: string; createdAt: string }[]>([]);
  const [showAllRecentKnowledge, setShowAllRecentKnowledge] = useState(false);
  const [pendingScriptItems, setPendingScriptItems] = useState<ScriptAsset[]>([]);
  const [scriptHistoryItems, setScriptHistoryItems] = useState<ScriptAsset[]>([]);
  const [activeIPName, setActiveIPName] = useState("未选择");
  const [coverRefsError, setCoverRefsError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    if (ipLoading) return;
    setActiveIPName(activeIP?.name ?? "未选择");
    const ipId = activeIP?.id ?? null;

    const allKnowledge = getKnowledgeEntries();
    const filteredKnowledgeByScope = filterKnowledgeVisibleToIP(allKnowledge, ipId);
    const globalMethods = filteredKnowledgeByScope.filter((entry) => (
      entry.ipId === null && isGlobalMethodCategory(getNormalizedCategory(entry))
    ));
    const ipKnowledge = ipId === null ? [] : filteredKnowledgeByScope.filter((entry) => (
      entry.ipId === ipId && isIPKnowledgeCategory(getNormalizedCategory(entry))
    ));
    let coverRefs = [];
    try {
      coverRefs = ipId === null ? getGlobalCoverRefs() : getCoverRefs(ipId);
      setCoverRefsError(null);
    } catch (error) {
      if (
        error instanceof CoverRefStoreError
        && (error.code === "COVER_REF_STORAGE_READ_FAILED" || error.code === "COVER_REF_DATA_CORRUPTED")
      ) {
        setCoverRefsError("暂无法加载封面数据");
      } else {
        throw error;
      }
    }
    const calibrationSamples = getTopicCalibrationSamples(activeIP);
    const topics = getTopicAssets(ipId ?? "").filter(() => true);
    const scripts = getScriptAssets(ipId ?? "");
    const reviews = ipId === null
      ? []
      : getVideoReviewsReadOnly(ipId).reviews;
    const pendingReviews = reviews.filter(review =>
      review.manualReviewStatus === "pending" &&
      assessVideoReviewTraceability(review) === "traceable"
    );

    setStats({
      globalMethods: globalMethods.length,
      ipKnowledge: ipKnowledge.length,
      coverRefs: coverRefs.length,
      calibrationSamples: calibrationSamples.length,
      topics: topics.length,
      scripts: scripts.length,
      reviews: reviews.length,
      pendingTopics: topics.filter(t => t.status === "草稿").length,
      pendingScripts: scripts.filter(s => s.status === "草稿").length,
      pendingReviews: pendingReviews.length,
    });
    setPendingScriptItems(scripts.filter(script => script.status === "草稿"));
    setScriptHistoryItems(scripts);

    // 最近7天新增的知识资产（所有分类混合）
    const visibleKnowledge = [
      ...globalMethods, ...ipKnowledge,
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
    setRecentKnowledge(visibleKnowledge.map(e => ({ title: e.title, category: e.category, createdAt: e.createdAt })));
  }, [activeIP, ipLoading]);

  const totalKnowledge = stats.globalMethods + stats.ipKnowledge + stats.coverRefs + stats.calibrationSamples;
  const visibleRecentKnowledge = showAllRecentKnowledge ? recentKnowledge : recentKnowledge.slice(0, 3);
  const hasPending = stats.pendingTopics > 0 || stats.pendingScripts > 0 || stats.pendingReviews > 0;

  return (
    <div className="min-h-screen p-6 md:p-8">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-[#C8F04A] text-[20px] font-black leading-none text-[#1C1C1B]">✳</span>
            <h1 className="text-[32px] font-bold leading-none tracking-tight text-[#1C1C1B]">工作台</h1>
          </div>
          <p className="mt-2.5 flex items-center gap-2 text-[13px] text-[#8A8A86]">
            当前操盘IP
            <span className="flex items-center gap-1.5 rounded-full bg-[#1C1C1B] px-3 py-1 text-[12px] font-semibold text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-[#C8F04A]" />
              {activeIPName}
            </span>
          </p>
        </div>

        {mounted && hasPending && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[11px] font-bold uppercase tracking-widest text-[#A6A39D]">待处理</span>
            {stats.pendingTopics > 0 && <PendingPill label="待评估选题" count={stats.pendingTopics} href="/topic-board" />}
            {stats.pendingScripts > 0 && (
              <PendingPill
                label="待完成脚本"
                count={stats.pendingScripts}
                expanded={showPendingScripts}
                onClick={() => setShowPendingScripts(visible => !visible)}
              />
            )}
            {stats.pendingReviews > 0 && <PendingPill label="待复盘记录" count={stats.pendingReviews} href="/review?tab=pending" />}
          </div>
        )}
      </header>

      {mounted && showPendingScripts && pendingScriptItems.length > 0 && (
        <div className="mb-6 rounded-[18px] border border-[#E5E4DE] bg-white p-3">
          <div className="mb-2 flex items-center justify-between px-2 text-[11.5px] text-[#8A8A86]">
            <span className="font-bold uppercase tracking-widest">待完成脚本清单</span>
            <Link href="/script-factory" className="font-semibold text-[#639922]">去脚本工厂 →</Link>
          </div>
          <div className="flex flex-col gap-1.5">
            {pendingScriptItems.map(script => (
              <div key={script.id} className="flex items-center justify-between gap-3 rounded-[12px] bg-[#F7F6F2] px-3.5 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-semibold text-[#1C1C1B]">{script.title || "未命名脚本"}</div>
                  <div className="mt-0.5 text-[11px] text-[#9A9A93]">创建时间：{relTime(script.createdAt)} · 状态：{script.status}</div>
                </div>
                <Link
                  href={`/script-factory?scriptId=${encodeURIComponent(script.id)}`}
                  className="shrink-0 rounded-full bg-[#1C1C1B] px-3 py-1 text-[11.5px] font-semibold text-[#C8F04A] hover:opacity-85"
                >
                  查看
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,1.1fr)_2fr]">
        <div className="flex flex-col justify-between rounded-[22px] bg-[#1C1C1B] p-6">
          <div className="flex items-start justify-between">
            <span className="text-[12px] font-bold uppercase tracking-widest text-[#8A8A86]">知识资产合计</span>
            <Link href="/knowledge-hub" className="flex h-8 w-8 items-center justify-center rounded-full bg-[#C8F04A] text-[14px] font-bold text-[#1C1C1B] transition hover:scale-105" aria-label="查看全部知识资产">↗</Link>
          </div>
          <div className="mt-4 text-[64px] font-bold leading-none tracking-tight text-[#C8F04A] tabular-nums">
            {mounted ? totalKnowledge : "—"}
          </div>
          <p className="mt-1 text-[12px] text-[#8A8A86]">条方法、知识、素材与校准样本</p>
          <div className="mt-5">
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[#333330]">
              {mounted && totalKnowledge > 0 && ASSET_SEGMENTS.map(segment => {
                const value = stats[segment.key];
                if (value <= 0) return null;
                return <div key={segment.key} style={{ width: `${(value / totalKnowledge) * 100}%`, background: segment.color }} title={`${segment.label} ${value}`} />;
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {ASSET_SEGMENTS.map(segment => (
                <span key={segment.key} className="flex items-center gap-1.5 text-[11px] text-[#B5B3AD]">
                  <span className="h-2 w-2 rounded-full" style={{ background: segment.color }} />
                  {segment.label} <b className="text-white tabular-nums">{mounted ? stats[segment.key] : "—"}</b>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ASSET_SEGMENTS.map(segment => (
              <Link key={segment.key} href={segment.href}>
                <div className="group flex h-full flex-col justify-between gap-2 rounded-[18px] border border-[#E5E4DE] bg-white p-4 transition hover:border-[#1C1C1B]">
                  <span className="flex items-center gap-1.5 text-[11.5px] text-[#8A8A86]">
                    <span className="h-2 w-2 rounded-full" style={{ background: segment.color }} />
                    {segment.label}
                  </span>
                  <span className="text-[26px] font-bold leading-none tracking-tight text-[#1C1C1B] tabular-nums">{mounted ? stats[segment.key] : "—"}</span>
                </div>
              </Link>
            ))}
          </div>

          <div className="flex-1 rounded-[18px] border border-[#E5E4DE] bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-widest text-[#A6A39D]">最近新增</span>
              {mounted && recentKnowledge.length > 3 && (
                <button type="button" onClick={() => setShowAllRecentKnowledge(visible => !visible)} className="rounded-full bg-[#F2F1ED] px-2.5 py-1 text-[11px] font-semibold text-[#666] hover:bg-[#E8E6DF]">
                  {showAllRecentKnowledge ? "收起" : `展开 ${recentKnowledge.length} 条`}
                </button>
              )}
            </div>
            {mounted && recentKnowledge.length === 0 ? (
              <div className="py-6 text-center text-[12.5px] text-[#BBB]">
                还没有知识资产，<Link href="/knowledge-hub" className="font-semibold text-[#639922]">去知识库中心添加第一条 →</Link>
              </div>
            ) : (
              <div className="flex flex-col">
                {(mounted ? visibleRecentKnowledge : []).map(knowledge => (
                  <div key={`${knowledge.createdAt}-${knowledge.title}`} className="flex items-center gap-3 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-[#F7F6F2]">
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#C8F04A]" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[#2B2B29]">{knowledge.title}</span>
                    <span className="flex-shrink-0 rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10px] text-[#8A8A86]">{knowledge.category}</span>
                    <span className="flex-shrink-0 text-[10.5px] text-[#A6A39D]">{relTime(knowledge.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {mounted && coverRefsError && (
            <div role="alert" className="rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12px] text-[#A32D2D]">{coverRefsError}</div>
          )}
        </div>
      </div>

      <div className="mb-10">
        <div className="mb-3 text-[11px] font-bold uppercase tracking-widest text-[#A6A39D]">生产资产统计</div>
        <div className="grid grid-cols-3 gap-3">
          <ProdStat label="选题记录" value={mounted ? stats.topics : "—"} href="/topic-board" />
          <ProdStat label="脚本记录" value={mounted ? stats.scripts : "—"} onClick={() => setShowScriptHistory(visible => !visible)} expanded={showScriptHistory} />
          <ProdStat label="复盘记录" value={mounted ? stats.reviews : "—"} href="/review" />
        </div>
          {mounted && showScriptHistory && (
            <div className="mt-3 rounded-[12px] border border-[#E5E4DE] bg-white p-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[12px] font-bold text-[#1C1C1B]">脚本历史</span>
                <Link href="/script-factory" className="text-[11.5px] font-semibold text-[#639922]">新建脚本 →</Link>
              </div>
              {scriptHistoryItems.length === 0 ? (
                <div className="rounded-[10px] bg-[#F7F6F2] px-3 py-5 text-center text-[12px] text-[#999]">当前IP还没有脚本记录</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {scriptHistoryItems.map(script => (
                    <div key={script.id} className="flex items-center justify-between gap-3 rounded-[10px] bg-[#F7F6F2] px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-semibold text-[#333]">{script.title || "未命名脚本"}</div>
                        <div className="mt-0.5 text-[11px] text-[#999]">创建时间：{relTime(script.createdAt)} · 状态：{script.status}</div>
                      </div>
                      <Link
                        href={`/script-factory?scriptId=${encodeURIComponent(script.id)}`}
                        aria-label={`查看脚本“${script.title || "未命名脚本"}”`}
                        className="shrink-0 rounded-full bg-[#1C1C1B] px-3 py-1 text-[11.5px] font-semibold text-[#C8F04A] hover:opacity-85"
                      >
                        查看
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {mounted && totalKnowledge === 0 && (
            <div className="mt-3 rounded-[14px] bg-white p-3.5 text-[12px] text-[#888]">
              💡 开始使用 FlowPilot 后，这里会展示你的内容生产数据和知识积累趋势。
            </div>
          )}
      </div>

      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[18px] font-bold tracking-tight text-[#1C1C1B]">核心生产流程</h2>
          <p className="mt-1 text-[12px] text-[#8A8A86]">从直播母稿到选题、脚本、拍摄和复盘</p>
        </div>
        <span className="text-[12px] text-[#8A8A86]">按01→05顺序推进</span>
      </div>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {CORE_WORKFLOW.map((module) => (
          <Link key={module.href} href={module.href}>
            <div className="group flex h-full flex-col gap-3 rounded-[20px] border border-[#E5E4DE] bg-white p-5 transition hover:-translate-y-0.5 hover:border-[#1C1C1B] hover:shadow-[0_8px_24px_rgba(28,28,27,0.08)]">
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[#C8F04A] text-[#1C1C1B]">
                  <Icon name={module.icon} size="md" />
                </div>
                <span className="text-[12px] font-bold text-[#C6C4BE] tabular-nums">{module.badge}</span>
              </div>
              <h3 className="text-[14.5px] font-bold text-[#1C1C1B]">{module.title}</h3>
              <p className="flex-1 text-[12.5px] leading-5 text-[#8A8A86]">{module.desc}</p>
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-[#639922]">进入工具</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1C1C1B] text-[13px] font-bold text-white transition group-hover:bg-[#C8F04A] group-hover:text-[#1C1C1B]">↗</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="mb-4 mt-10">
        <h2 className="text-[18px] font-bold tracking-tight text-[#1C1C1B]">内容再生产与运营</h2>
        <p className="mt-1 text-[12px] text-[#8A8A86]">处理存量内容、补充知识、提炼洞察和沉淀判断</p>
      </div>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {OPERATIONS_TOOLS.map((module) => (
          <Link key={module.href} href={module.href}>
            <div className="group flex h-full flex-col gap-3 rounded-[20px] border border-[#E5E4DE] bg-white p-5 transition hover:-translate-y-0.5 hover:border-[#1C1C1B] hover:shadow-[0_8px_24px_rgba(28,28,27,0.08)]">
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[#F1EFE8] text-[#1C1C1B] transition group-hover:bg-[#C8F04A]">
                  <Icon name={module.icon} size="md" />
                </div>
                <span className="rounded-full bg-[#F1EFE8] px-2.5 py-1 text-[10.5px] font-bold text-[#7C7A74]">{module.badge}</span>
              </div>
              <h3 className="text-[14.5px] font-bold text-[#1C1C1B]">{module.title}</h3>
              <p className="flex-1 text-[12.5px] leading-5 text-[#8A8A86]">{module.desc}</p>
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-[#639922]">进入工具</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1C1C1B] text-[13px] font-bold text-white transition group-hover:bg-[#C8F04A] group-hover:text-[#1C1C1B]">↗</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
