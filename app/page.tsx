"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Icon, IconName } from "@/components/ui/icon";
import {
  getKnowledgeEntries, getTopicAssets, getScriptAssets,
  getVideoReviews, getOrInitActiveIP, getCoverRefs,
} from "@/lib/ip-store";
import { getTopicCalibrationSamples } from "@/lib/topic-calibration-store";
import {
  getNormalizedCategory,
  isGlobalMethodCategory,
  isIPKnowledgeCategory,
} from "@/lib/knowledge-categories";

// ── 模块配置（下半部分工具入口） ──
const MODULES = [
  { href: "/topic-board", step: "01", title: "AI 选题董事会", desc: "8 位虚拟专家独立打分，给出综合评分、爆款等级与优化建议。", icon: "chat" },
  { href: "/script-factory", step: "02", title: "AI IP脚本工厂", desc: "基于当前IP的人设、受众与表达风格，一次性生成标题、封面、口播逐字稿、分镜与拍摄建议。", icon: "film" },
  { href: "/shoot-room", step: "03", title: "AI 拍摄作战室", desc: "管理一次完整拍摄战役：完成度评分、风险扫描、执行计划与拍摄清单。", icon: "camera" },
  { href: "/transcribe", step: "04", title: "录音转逐字稿", desc: "录音或上传音频 → 粘贴逐字稿 → AI清洗+分段+摘要 → 保存到知识库或IP口播样本。", icon: "mic" },
  { href: "/hot-analysis", step: "05", title: "爆款研究院", desc: "素材雷达、基因库、对标分析、预测中心，完整情报工作流。", icon: "fire" },
  { href: "/copy-optimization", step: "06", title: "AI文案优化", desc: "把一段逐字稿/文案改写成目标IP的风格，支持L1-L3改写强度和原文对照。", icon: "edit" },
  { href: "/review", step: "07", title: "发布复盘", desc: "数据复盘 → 原因分析 → 结构拆解 → 经验沉淀 → 下一条建议，完整六层分析。", icon: "calendar" },
];

function StatCard({ label, value, href, color = "#639922" }: { label: string; value: number | string; href?: string; color?: string }) {
  const inner = (
    <div className="flex flex-col gap-1 rounded-[12px] border border-[#E5E4DE] bg-white p-4 transition hover:border-[#639922]">
      <span className="text-[22px] font-bold" style={{ color }}>{value}</span>
      <span className="text-[12px] text-[#8A8A86]">{label}</span>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : <div>{inner}</div>;
}

function RecentItem({ label, time, badge }: { label: string; time: string; badge?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] bg-[#F7F6F2] px-3 py-2">
      <span className="flex-1 truncate text-[12.5px] text-[#333]">{label}</span>
      <div className="flex flex-shrink-0 items-center gap-1.5">
        {badge && <span className="rounded-full bg-[#EAF3DE] px-2 py-0.5 text-[10.5px] font-bold text-[#3B6D11]">{badge}</span>}
        <span className="text-[11px] text-[#BBB]">{time}</span>
      </div>
    </div>
  );
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "今天";
  if (d === 1) return "昨天";
  if (d < 7) return `${d}天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState({
    globalMethods: 0, ipKnowledge: 0, coverRefs: 0, calibrationSamples: 0,
    topics: 0, scripts: 0, reviews: 0,
    pendingTopics: 0, pendingScripts: 0, pendingReviews: 0,
  });
  const [recentKnowledge, setRecentKnowledge] = useState<{ title: string; category: string; createdAt: string }[]>([]);
  const [activeIPName, setActiveIPName] = useState("未选择");

  useEffect(() => {
    setMounted(true);
    const activeIP = getOrInitActiveIP();
    setActiveIPName(activeIP?.name ?? "未选择");
    const ipId = activeIP?.id ?? null;

    const allKnowledge = getKnowledgeEntries();
    const globalMethods = allKnowledge.filter((entry) => (
      entry.ipId === null && isGlobalMethodCategory(getNormalizedCategory(entry))
    ));
    const ipKnowledge = ipId === null ? [] : allKnowledge.filter((entry) => (
      entry.ipId === ipId && isIPKnowledgeCategory(getNormalizedCategory(entry))
    ));
    const coverRefs = getCoverRefs(ipId);
    const calibrationSamples = getTopicCalibrationSamples(activeIP);
    const topics = getTopicAssets(ipId ?? "").filter(() => true);
    const scripts = getScriptAssets(ipId ?? "");
    const reviews = getVideoReviews(ipId ?? undefined);

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
      pendingReviews: reviews.filter(r => !r.analysis).length,
    });

    // 最近7天新增的知识资产（所有分类混合）
    const visibleKnowledge = [
      ...globalMethods, ...ipKnowledge,
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
    setRecentKnowledge(visibleKnowledge.map(e => ({ title: e.title, category: e.category, createdAt: e.createdAt })));
  }, []);

  const totalKnowledge = stats.globalMethods + stats.ipKnowledge + stats.coverRefs + stats.calibrationSamples;

  return (
    <div className="min-h-screen p-6 md:p-8">
      {/* ══════════════ 上半部分：状态看板 ══════════════ */}
      <header className="mb-6">
        <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1B]">工作台</h1>
        <p className="mt-1 text-[13.5px] text-[#8A8A86]">
          当前操盘IP：<span className="font-semibold text-[#1C1C1B]">{activeIPName}</span>
        </p>
      </header>

      {/* 待处理事项 */}
      {mounted && (stats.pendingTopics > 0 || stats.pendingScripts > 0 || stats.pendingReviews > 0) && (
        <div className="mb-5 rounded-[14px] border border-[#FBF3D6] bg-[#FFFBF0] p-4">
          <div className="mb-2.5 text-[12px] font-bold text-[#7A5C00]">待处理</div>
          <div className="flex flex-wrap gap-2">
            {stats.pendingTopics > 0 && (
              <Link href="/topic-board" className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-[#7A5C00] shadow-sm hover:shadow">
                <span>📋</span> 待评估选题 {stats.pendingTopics} 条
              </Link>
            )}
            {stats.pendingScripts > 0 && (
              <Link href="/script-factory" className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-[#7A5C00] shadow-sm hover:shadow">
                <span>📝</span> 待完成脚本 {stats.pendingScripts} 条
              </Link>
            )}
            {stats.pendingReviews > 0 && (
              <Link href="/review" className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-[#7A5C00] shadow-sm hover:shadow">
                <span>📊</span> 待复盘记录 {stats.pendingReviews} 条
              </Link>
            )}
          </div>
        </div>
      )}

      {/* 知识资产积累 */}
      <div className="mb-5">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[13px] font-bold text-[#1C1C1B]">知识资产积累</span>
          <Link href="/knowledge-hub" className="text-[12px] text-[#639922]">查看全部 →</Link>
        </div>
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
          <StatCard label="通用方法库" value={mounted ? stats.globalMethods : "—"} href="/knowledge-hub?scope=global" />
          <StatCard label="当前IP知识库" value={mounted ? stats.ipKnowledge : "—"} href="/knowledge-hub?scope=ip" color="#7A5C00" />
          <StatCard label="封面参考库" value={mounted ? stats.coverRefs : "—"} href="/knowledge-hub?scope=material" color="#1A5276" />
          <StatCard label="历史校准样本" value={mounted ? stats.calibrationSamples : "—"} href="/topic-board" color="#5B3FA0" />
          <StatCard label="合计" value={mounted ? totalKnowledge : "—"} color="#1C1C1B" />
        </div>
      </div>

      {/* 最近新增知识资产 + 生产资产统计 */}
      <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2.5 text-[13px] font-bold text-[#1C1C1B]">最近新增知识资产</div>
          {mounted && recentKnowledge.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-[#E5E4DE] py-8 text-center text-[12.5px] text-[#BBB]">
              还没有知识资产，去知识库中心添加第一条
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {(mounted ? recentKnowledge : []).map((k, i) => (
                <RecentItem key={i} label={k.title} time={relTime(k.createdAt)} badge={k.category} />
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="mb-2.5 text-[13px] font-bold text-[#1C1C1B]">生产资产统计</div>
          <div className="grid grid-cols-3 gap-2.5">
            <StatCard label="选题记录" value={mounted ? stats.topics : "—"} href="/topic-board" />
            <StatCard label="脚本记录" value={mounted ? stats.scripts : "—"} href="/script-factory" />
            <StatCard label="复盘记录" value={mounted ? stats.reviews : "—"} href="/review" />
          </div>
          {mounted && totalKnowledge === 0 && (
            <div className="mt-3 rounded-[10px] bg-[#F7F6F2] p-3 text-[12px] text-[#888]">
              💡 开始使用 FlowPilot 后，这里会展示你的内容生产数据和知识积累趋势。
            </div>
          )}
        </div>
      </div>

      {/* ══════════════ 下半部分：工具入口 ══════════════ */}
      <div className="mb-3 flex items-center justify-between border-t border-[#E5E4DE] pt-6">
        <span className="text-[13px] font-bold text-[#1C1C1B]">内容生产工具</span>
        <span className="text-[12px] text-[#8A8A86]">按流程顺序逐步使用效果最佳</span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {MODULES.map((m) => (
          <Link key={m.href} href={m.href}>
            <div className="flex h-full flex-col gap-3 rounded-[14px] border border-[#E5E4DE] bg-white p-5 transition hover:border-[#639922]">
              <div className="flex items-center justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#EAF3DE] text-[#3B6D11]">
                  <Icon name={m.icon as IconName} size="md" />
                </div>
                <span className="rounded-full bg-[#F1EFE8] px-2 py-0.5 text-[11px] font-semibold text-[#5F5E5A]">{m.step}</span>
              </div>
              <h3 className="text-[14px] font-semibold text-[#1C1C1B]">{m.title}</h3>
              <p className="flex-1 text-[12.5px] leading-5 text-[#8A8A86]">{m.desc}</p>
              <span className="text-[12px] font-semibold text-[#639922]">进入工具 →</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
