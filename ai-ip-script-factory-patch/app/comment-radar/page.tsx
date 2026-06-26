"use client";

import { useState, useEffect } from "react";
import CommentRadarResult from "@/components/comment-radar/CommentRadarResult";
import type { CommentRadarResult as ResultType } from "@/components/comment-radar/types";
import { useIP } from "@/lib/ip-context";
import { addCommentAsset, getCommentAssets } from "@/lib/ip-store";
import type { CommentAsset } from "@/lib/types";

const PLATFORMS = ["抖音", "视频号", "小红书", "B站", "直播间"];

const SAMPLE = `有没有适合新手的方法？
AI小白怎么开始学？
不会写提示词怎么办？
需要学编程吗？
AI副业真的能赚钱吗？
怎么加你的付费社群？
有没有课程可以报名？
AI都是割韭菜的吧
全是骗人的不要相信
多少钱？能带做吗？
我试过了感觉没用
国内能用ChatGPT吗？
每天要花多少时间？
有没有真实收入截图？
怎么快速学会？
有没有系统的路径？
能不能出系列视频？
求教程！
这个方法我没看懂
有没有免费的资料？`;

export default function CommentRadarPage() {
  const { activeIP, loading: ipLoading } = useIP();
  const [platform, setPlatform] = useState("抖音");
  const [comments, setComments] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultType | null>(null);
  const [history, setHistory] = useState<CommentAsset[]>([]);

  // 切换IP时，历史记录列表同步切换为该IP的归档
  useEffect(() => {
    if (activeIP) setHistory(getCommentAssets(activeIP.id));
    else setHistory([]);
  }, [activeIP]);

  async function handleAnalyze() {
    setError(null);
    const text = comments.trim();
    if (!text || text.length < 10) {
      setError("请粘贴至少几条评论内容再开始分析");
      return;
    }
    if (!activeIP) {
      setError("请先在「IP身份中心」选择一个当前操盘IP");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/comment-radar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, comments: text, ipId: activeIP.id }),
      });
      let data: ResultType | { error: string } | null = null;
      try { data = await res.json(); } catch { throw new Error(`接口返回非 JSON（${res.status}）`); }
      if (!res.ok) throw new Error(data && "error" in data ? data.error : `请求失败（${res.status}）`);
      setResult(data as ResultType);
      addCommentAsset({ ipId: activeIP.id, rawText: text, platform, radarResult: data });
      setHistory(getCommentAssets(activeIP.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen p-6 md:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[13px] text-[#8A8A86]">
            <a href="/" className="font-semibold text-[#639922]">工作台</a> / AI 评论区需求雷达
          </div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1B]">AI 评论区需求雷达</h1>
          <p className="mt-1.5 max-w-[640px] text-[13.5px] leading-6 text-[#8A8A86]">
            粘贴评论区内容，AI 像资深内容操盘手一样挖掘真实需求、情绪、购买意向，并给出下一条视频、产品和直播方向。
          </p>
        </div>
        <span className="whitespace-nowrap rounded-full bg-[#EAF3DE] px-3.5 py-1.5 text-[12px] font-semibold text-[#3B6D11]">
          04 · 需求挖掘
        </span>
      </header>

      {!ipLoading && (
        <div className="mb-6 flex items-center gap-2 rounded-[14px] bg-[#FBF3D6] px-4 py-2.5 text-[13px] text-[#7A5C00]">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
            style={{ background: activeIP?.color ?? "#999" }}
          >
            {activeIP?.avatar ?? "?"}
          </span>
          本次分析归档到 <b>{activeIP?.name ?? "未选择IP"}</b> 的评论资产库 —— 切换IP后下方历史记录会自动切换。
        </div>
      )}

      {history.length > 0 && (
        <div className="mb-6 rounded-[16px] border border-[#E5E4DE] bg-white p-4">
          <div className="mb-2 text-[12.5px] font-semibold text-[#8A8A86]">
            {activeIP?.name} 的历史评论分析（{history.length}条）
          </div>
          <div className="flex flex-wrap gap-2">
            {history.slice(0, 6).map(h => (
              <span key={h.id} className="rounded-full bg-[#F4F4F2] px-3 py-1 text-[12px] text-[#555]">
                {h.platform} · {new Date(h.importedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="mb-6 rounded-[20px] border border-[#E5E4DE] bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-[#8A8A86]">评论来源平台</span>
          {PLATFORMS.map(p => (
            <button
              key={p} type="button"
              onClick={() => setPlatform(p)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${
                platform === p
                  ? "bg-[#1C1C1B] text-white"
                  : "bg-[#F4F4F2] text-[#8A8A86] hover:text-[#1C1C1B]"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <textarea
          value={comments}
          onChange={e => setComments(e.target.value)}
          placeholder="把评论区内容粘贴到这里，一条一行…"
          className="min-h-[160px] w-full resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[14px] text-[#1C1C1B] outline-none focus:border-[#639922] focus:ring-2 focus:ring-[#EAF3DE]"
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setComments(SAMPLE)}
            className="text-[12.5px] text-[#639922] underline underline-offset-2"
          >
            使用示例评论
          </button>
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={loading}
            className="flex h-[48px] items-center gap-2 rounded-[12px] bg-[#1C1C1B] px-8 text-[14px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12H19M19 12L13 6M19 12L13 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {loading ? "AI 分析中..." : "开始深度分析"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-[14px] bg-[#FCEBEB] px-5 py-4 text-[14px] font-semibold text-[#A32D2D]">{error}</div>
      )}

      {loading && (
        <div className="py-20 text-center text-[#8A8A86]">
          <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-4 border-[#EAF3DE] border-t-[#639922]" />
          <div className="text-[14px]">AI 正在分析 12 个维度，请稍候…</div>
          <div className="mt-1 text-[12.5px]">需求热度 · 情绪分布 · 购买意向 · 爆款选题 · 回复策略</div>
        </div>
      )}

      {!loading && !result && !error && (
        <div className="py-20 text-center text-[#8A8A86]">
          <h3 className="mb-2 text-[17px] font-semibold text-[#1C1C1B]">还没有分析结果</h3>
          <p className="mx-auto max-w-[480px] text-[13.5px] leading-6">
            粘贴评论区内容后点击「开始深度分析」，系统将从 12 个维度挖掘评论区商业价值，包括用户需求、情绪分析、购买意向识别、爆款选题生成和评论回复策略。
          </p>
        </div>
      )}

      {!loading && result && <CommentRadarResult result={result} />}
    </div>
  );
}
