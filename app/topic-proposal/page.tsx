"use client";

import { apiFetch } from "@/lib/api-fetch";
import { useState } from "react";
import { getKnowledgeEntries, getVideoReviews } from "@/lib/ip-store";
import { IPProfile, KnowledgeEntry, VideoReview } from "@/lib/types";
import { useIP } from "@/lib/ip-context";

// ── AI 编导提案前端页（/topic-proposal）：每周选题会第0步，为董事会供给候选选题 ──

interface Proposal {
  topic: string;
  timing: string;
  fit: string;
  hook: string;
  type: string;
  source: string; // 蹭势 | 顺势 | 造势
}

const SOURCE_STYLES: Record<string, string> = {
  "蹭势": "bg-[#DCEBFB] text-[#2F6AA8]",
  "顺势": "bg-[#EAF3DE] text-[#3B6D11]",
  "造势": "bg-[#F3E8FB] text-[#7A3FA8]",
};

const SOURCE_DESC: Record<string, string> = {
  "蹭势": "借热点，做增量",
  "顺势": "观众已用行为投票",
  "造势": "特立独行，保留特色",
};

// 从知识库自动汇集三路情报（沿用董事会的按 IP 过滤规则）
function collectIntel(activeIP: IPProfile | null) {
  const byIP = (e: KnowledgeEntry) => !activeIP?.id || !e.ipId || e.ipId === activeIP.id;

  const viralCases = getKnowledgeEntries("爆款案例")
    .filter(byIP)
    .slice(0, 5)
    .map(e => `《${e.title}》｜表现：${e.viralEvaluation?.grade ?? "历史案例"}｜${e.rawContent.slice(0, 80)}`)
    .join("\n");

  const reviewNotes = getVideoReviews(activeIP?.id)
    .slice(0, 3)
    .map((r: VideoReview) => `《${r.title}》｜播放${r.metrics.views ?? "-"}｜赞${r.metrics.likes ?? "-"}｜评论${r.metrics.comments ?? "-"}`)
    .join("\n");

  const commentNeeds = getKnowledgeEntries("评论需求")
    .filter(byIP)
    .slice(0, 5)
    .map(e => `${e.title}：${e.rawContent.slice(0, 60)}`)
    .join("\n");

  return { viralCases, reviewNotes, commentNeeds };
}

export default function TopicProposalPage() {
  const { activeIP } = useIP();
  const [hotspots, setHotspots] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [intelCount, setIntelCount] = useState<{ viral: number; review: number; comment: number } | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const handleGenerate = async () => {
    if (!activeIP) { setError("请先在 IP 身份中心选择当前操盘 IP"); return; }
    setLoading(true);
    setError("");
    setProposals([]);

    const intel = collectIntel(activeIP);
    setIntelCount({
      viral: intel.viralCases ? intel.viralCases.split("\n").length : 0,
      review: intel.reviewNotes ? intel.reviewNotes.split("\n").length : 0,
      comment: intel.commentNeeds ? intel.commentNeeds.split("\n").length : 0,
    });

    try {
      const res = await apiFetch("/api/topic-proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ipProfile: activeIP,
          hotspots: hotspots.trim(),
          viralCases: intel.viralCases,
          reviewNotes: intel.reviewNotes,
          commentNeeds: intel.commentNeeds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "提案生成失败，请重试");
      setProposals(data.proposals ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "提案生成失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  const handleSendToBoard = async (topic: string, idx: number) => {
    try { await navigator.clipboard.writeText(topic); } catch { /* 剪贴板不可用时也继续跳转 */ }
    setCopiedIdx(idx);
    setTimeout(() => { window.location.href = "/topic-board"; }, 400);
  };

  const handleCopy = async (topic: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(topic);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch { setError("复制失败，请手动选中复制"); }
  };

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-8">
      {/* 页头 */}
      <div className="mb-1 text-[12px] text-[#8A8A86]">工作台 / AI 编导提案 <span className="ml-1 rounded bg-[#EAF3DE] px-1.5 py-0.5 text-[10px] font-bold text-[#3B6D11]">V0.1</span></div>
      <h1 className="text-[22px] font-bold text-[#1C1C1B]">AI 编导提案</h1>
      <p className="mt-1 text-[13px] leading-6 text-[#6B6B67]">
        每周选题会第 0 步。汇集热点情报、爆款案例、上期复盘三路信息，为「{activeIP?.name ?? "当前IP"}」提出 10 个可拍选题（6 蹭势 + 2 顺势 + 2 造势），供选题董事会评审。
      </p>

      {/* 输入区 */}
      <div className="mt-6 rounded-[20px] border border-[#E5E4DE] bg-white p-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-bold text-[#1C1C1B]">上周热点情报（手动粘贴，可为空）</span>
          <span className="text-[11px] text-[#8A8A86]">爆款案例 / 发布复盘 / 评论需求将自动从知识库读取</span>
        </div>
        <textarea
          value={hotspots}
          onChange={e => setHotspots(e.target.value)}
          rows={4}
          placeholder={"把你本周刷到的热点、榜单、同行爆款贴在这里，一行一条。例如：\n同城博主实测水电改造报价差3倍，播放80万\n平台近期推居住类长内容"}
          className="w-full resize-y rounded-[12px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3 text-[13px] leading-6 text-[#1C1C1B] outline-none focus:border-[#639922]"
        />
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="mt-4 w-full rounded-[12px] bg-[#1C1C1B] py-3 text-[14px] font-bold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "编导正在汇集情报、构思提案…（约需20秒）" : "📋 生成本周选题提案"}
        </button>
        {intelCount && !loading && (
          <p className="mt-2 text-center text-[11px] text-[#8A8A86]">
            本次提案参考了：爆款案例 {intelCount.viral} 条 · 发布复盘 {intelCount.review} 条 · 评论需求 {intelCount.comment} 条
          </p>
        )}
        {error && <p className="mt-3 rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{error}</p>}
      </div>

      {/* 提案列表 */}
      {proposals.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[15px] font-bold text-[#1C1C1B]">本周提案 · {proposals.length} 条</span>
            <span className="text-[11px] text-[#8A8A86]">点「送去董事会」会复制选题并跳转，粘贴后即可召开董事会</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {proposals.map((p, idx) => (
              <div key={idx} className="flex flex-col rounded-[16px] border border-[#E5E4DE] bg-white p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${SOURCE_STYLES[p.source] ?? "bg-[#F0F0EC] text-[#6B6B67]"}`}>
                    {p.source}
                  </span>
                  <span className="text-[10.5px] text-[#8A8A86]">{SOURCE_DESC[p.source] ?? ""}</span>
                  <span className="ml-auto rounded bg-[#F7F6F2] px-2 py-0.5 text-[10.5px] text-[#6B6B67]">{p.type}</span>
                </div>
                <p className="text-[14px] font-bold leading-6 text-[#1C1C1B]">{p.topic}</p>
                <div className="mt-2 space-y-1.5 text-[12px] leading-5 text-[#4A4A46]">
                  <p><span className="font-bold text-[#8A8A86]">现在拍：</span>{p.timing}</p>
                  <p><span className="font-bold text-[#8A8A86]">这个IP拍：</span>{p.fit}</p>
                  <p><span className="font-bold text-[#8A8A86]">钩子方向：</span>{p.hook}</p>
                </div>
                <div className="mt-3 flex gap-2 border-t border-[#F0F0EC] pt-3">
                  <button
                    onClick={() => handleCopy(p.topic, idx)}
                    className="rounded-[10px] border border-[#E5E4DE] px-3 py-1.5 text-[12px] font-bold text-[#4A4A46] transition hover:bg-[#F7F6F2]"
                  >
                    {copiedIdx === idx ? "✓ 已复制" : "复制"}
                  </button>
                  <button
                    onClick={() => handleSendToBoard(p.topic, idx)}
                    className="flex-1 rounded-[10px] bg-[#EAF3DE] px-3 py-1.5 text-[12px] font-bold text-[#3B6D11] transition hover:bg-[#DCEDCB]"
                  >
                    送去董事会评审 →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 空状态 */}
      {!loading && proposals.length === 0 && (
        <div className="mt-6 rounded-[20px] border border-dashed border-[#E5E4DE] py-14 text-center text-[13px] leading-7 text-[#8A8A86]">
          编导已就位<br />
          （可选）贴入本周热点 → 点击「生成本周选题提案」<br />
          10 条提案将按 6 蹭势 · 2 顺势 · 2 造势 的配比产出
        </div>
      )}
    </div>
  );
}
