"use client";
import { apiFetch } from "@/lib/api-fetch";
import { useState, useEffect } from "react";
import { useIP } from "@/lib/ip-context";
import { KnowledgeEntry, HotMaterialAnalysis } from "@/lib/types";
import {
  getKnowledgeEntries, addKnowledgeEntry,
  getHotAnalyses, addHotAnalysis, deleteHotAnalysis, markHotAnalysisAdded,
} from "@/lib/ip-store";
import { Icon } from "@/components/ui/icon";
import { Select } from "@/components/ui/select";

type TabId = "radar" | "genome" | "benchmark" | "predict";
const TABS: { id: TabId; label: string }[] = [
  { id: "radar", label: "素材雷达" },
  { id: "genome", label: "基因库" },
  { id: "benchmark", label: "对标分析" },
  { id: "predict", label: "预测中心" },
];

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[14px] border border-[#E5E4DE] bg-white p-5 ${className}`}>{children}</div>;
}

const GRADE_COLOR: Record<string, { bg: string; text: string }> = {
  "S": { bg: "#FCEBEB", text: "#A32D2D" }, "A": { bg: "#FBF3D6", text: "#7A5C00" },
  "B": { bg: "#EAF3DE", text: "#3B6D11" }, "不收录": { bg: "#F2F1ED", text: "#888" },
};
function GradeBadge({ grade }: { grade: string }) {
  const c = GRADE_COLOR[grade] ?? GRADE_COLOR["不收录"];
  return <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: c.bg, color: c.text }}>{grade === "不收录" ? "C级·不建议学习" : `${grade}级素材`}</span>;
}

const TIER_COLOR: Record<string, { bg: string; text: string }> = {
  "高度匹配": { bg: "#EAF3DE", text: "#3B6D11" }, "中度匹配": { bg: "#FBF3D6", text: "#7A5C00" }, "低度匹配": { bg: "#F2F1ED", text: "#888" },
  "值得学习": { bg: "#EAF3DE", text: "#3B6D11" }, "部分学习": { bg: "#FBF3D6", text: "#7A5C00" }, "不建议学习": { bg: "#FCEBEB", text: "#A32D2D" },
};
function TierTag({ label }: { label: string }) {
  const c = TIER_COLOR[label] ?? { bg: "#F2F1ED", text: "#888" };
  return <span className="rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: c.bg, color: c.text }}>{label}</span>;
}

// ════════════════════ Tab1 素材雷达 ════════════════════
interface AnalyzeResult {
  title: string; author: string; platform: string; publishedAt: string; contentDirection: string[];
  evaluation: HotMaterialAnalysis["evaluation"]; hasRealMetrics: boolean;
  worthLearning: string; worthLearningReason: string;
  ipFitTier: string | null; ipFitReason: string;
  dna: HotMaterialAnalysis["dna"];
}

function RadarTab() {
  const { activeIP, ips } = useIP();
  const [inputType, setInputType] = useState<"transcript" | "copy" | "title">("transcript");
  const [inputRaw, setInputRaw] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [hasMetrics, setHasMetrics] = useState(false);
  const [likes, setLikes] = useState(""); const [comments, setComments] = useState("");
  const [shares, setShares] = useState(""); const [favorites, setFavorites] = useState("");
  const [aboveAvg, setAboveAvg] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [added, setAdded] = useState(false);
  const [history, setHistory] = useState<HotMaterialAnalysis[]>([]);
  const [lastAnalysisId, setLastAnalysisId] = useState<string | null>(null);

  useEffect(() => { setHistory(getHotAnalyses()); }, []);

  async function handleAnalyze() {
    if (!inputRaw.trim()) { setError("请提供要分析的内容"); return; }
    setLoading(true); setError(null); setResult(null); setAdded(false);
    try {
      const res = await apiFetch("/api/hot-analysis/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputType, inputRaw, sourceUrl,
          ipContext: activeIP ? { name: activeIP.name, positioning: activeIP.positioning, audience: activeIP.audience, contentDirection: activeIP.contentDirection, platforms: activeIP.platforms } : null,
          metrics: hasMetrics ? { likes: Number(likes) || 0, comments: Number(comments) || 0, shares: Number(shares) || 0, favorites: Number(favorites) || 0, aboveAccountAverage: aboveAvg } : null,
        }),
      });
      let data: Record<string, any>;
      try {
        data = await res.json();
      } catch {
        setError(res.ok ? "AI返回格式异常" : "AI请求失败");
        return;
      }
      if (!res.ok) {
        if (process.env.NODE_ENV !== "production") {
          console.error("[hot-analysis]", {
            requestId: data.requestId ?? data.apiMeta?.requestId ?? null,
            errorStage: data.errorCode ?? data.apiMeta?.errorStage ?? "request_failed",
          });
        }
        setError(typeof data.error === "string" && data.error ? data.error : "AI请求失败");
        return;
      }
      setResult(data);
      const saved = addHotAnalysis({
        inputType, inputRaw, sourceUrl,
        title: data.title, author: data.author, platform: data.platform, publishedAt: data.publishedAt, contentDirection: data.contentDirection,
        evaluation: data.evaluation, hasRealMetrics: data.hasRealMetrics,
        worthLearning: data.worthLearning, worthLearningReason: data.worthLearningReason,
        ipId: activeIP?.id ?? null, ipFitTier: data.ipFitTier, ipFitReason: data.ipFitReason,
        dna: data.dna,
      });
      setLastAnalysisId(saved.id);
      setHistory(getHotAnalyses());
    } catch {
      setError("AI请求失败");
    } finally { setLoading(false); }
  }

  function handleAddToKB() {
    if (!result || !lastAnalysisId) return;
    const entry = addKnowledgeEntry({
      category: "爆款案例", title: result.title || inputRaw.slice(0, 20), rawContent: inputRaw,
      tags: result.evaluation.hookType ? [result.evaluation.hookType] : [], keywords: [],
      ipId: activeIP?.id ?? null,
      sourceTier: result.hasRealMetrics ? "高" : "中",
      sourceTierReason: result.hasRealMetrics ? "提供了真实互动数据" : "未提供真实互动数据，基于内容质量判断",
      contentDirection: result.contentDirection, sourcePlatform: result.platform || "未知", sourceUrl,
      note: "", extractedAt: new Date().toISOString(),
      metrics: hasMetrics ? { likes: Number(likes) || 0, comments: Number(comments) || 0, shares: Number(shares) || 0, favorites: Number(favorites) || 0, aboveAccountAverage: aboveAvg } : null,
      viralEvaluation: result.evaluation, usageRecords: [], status: "未使用", dna: result.dna,
    });
    markHotAnalysisAdded(lastAnalysisId, entry.id);
    setAdded(true);
    setHistory(getHotAnalyses());
  }

  return (
    <div className="flex flex-col gap-5">
      {ips.length === 0 && <div className="rounded-[10px] bg-[#FBF3D6] px-3 py-2 text-[12.5px] text-[#7A5C00]">还没有创建IP，IP匹配度分析会跳过，建议先去IP身份中心创建一个。</div>}
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          {([["transcript", "口播逐字稿"], ["copy", "文案"], ["title", "标题"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setInputType(id)} className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold"
              style={inputType === id ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#888" }}>{label}</button>
          ))}
        </div>
        <textarea value={inputRaw} onChange={e => setInputRaw(e.target.value)} placeholder="粘贴内容…（链接没法自动抓取，麻烦把逐字稿/文案/标题粘进来，链接可以填在下面当来源记录）" rows={6}
          className="w-full resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[13.5px] leading-6 outline-none focus:border-[#639922]" />
        <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="来源链接（可选，仅作引用记录）" className="mt-2.5 w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13px]" />

        <div className="mt-3 rounded-[12px] bg-[#F7F6F2] p-3">
          <label className="flex items-center gap-2 text-[12.5px] font-semibold text-[#555]">
            <input type="checkbox" checked={hasMetrics} onChange={e => setHasMetrics(e.target.checked)} />
            我知道这条内容的真实互动数据（不填的话，评级只看内容质量，不代表已验证的真实传播表现）
          </label>
          {hasMetrics && (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <input value={likes} onChange={e => setLikes(e.target.value.replace(/\D/g, ""))} placeholder="点赞" className="rounded-[8px] border border-[#E5E4DE] bg-white px-2.5 py-1.5 text-[12.5px]" />
              <input value={comments} onChange={e => setComments(e.target.value.replace(/\D/g, ""))} placeholder="评论" className="rounded-[8px] border border-[#E5E4DE] bg-white px-2.5 py-1.5 text-[12.5px]" />
              <input value={shares} onChange={e => setShares(e.target.value.replace(/\D/g, ""))} placeholder="转发" className="rounded-[8px] border border-[#E5E4DE] bg-white px-2.5 py-1.5 text-[12.5px]" />
              <input value={favorites} onChange={e => setFavorites(e.target.value.replace(/\D/g, ""))} placeholder="收藏" className="rounded-[8px] border border-[#E5E4DE] bg-white px-2.5 py-1.5 text-[12.5px]" />
            </div>
          )}
        </div>

        {error && <div className="mt-3 rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{error}</div>}
        <div className="mt-4 flex justify-end">
          <button onClick={handleAnalyze} disabled={loading || !inputRaw.trim()} className="flex h-[44px] items-center gap-2 rounded-[12px] bg-[#1C1C1B] px-7 text-[13.5px] font-semibold text-white disabled:opacity-40">
            {loading ? "分析中…" : "开始分析"}
          </button>
        </div>
      </Card>

      {result && (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <GradeBadge grade={result.evaluation.grade} />
            <span className="text-[12px] text-[#888]">钩子评分 {result.evaluation.hookScore.total}/50</span>
            <TierTag label={result.worthLearning} />
            {result.ipFitTier && <TierTag label={result.ipFitTier} />}
            {!result.hasRealMetrics && <span className="text-[11px] text-[#BBB]">（未验证真实传播表现）</span>}
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="rounded-[10px] bg-[#F7F6F2] p-3">
              <div className="mb-1 text-[11px] font-bold text-[#666]">基础信息</div>
              <p className="text-[12px] text-[#444]">标题：{result.title || "（未识别）"} · 作者：{result.author || "（未识别）"} · 平台：{result.platform || "（未识别）"}</p>
            </div>
            <div className="rounded-[10px] bg-[#F7F6F2] p-3">
              <div className="mb-1 text-[11px] font-bold text-[#666]">是否值得学习</div>
              <p className="text-[12px] leading-5 text-[#444]">{result.worthLearningReason}</p>
            </div>
            {result.ipFitTier && (
              <div className="rounded-[10px] bg-[#F7F6F2] p-3 sm:col-span-2">
                <div className="mb-1 text-[11px] font-bold text-[#666]">与当前IP「{activeIP?.name}」的匹配度</div>
                <p className="text-[12px] leading-5 text-[#444]">{result.ipFitReason}</p>
              </div>
            )}
          </div>

          <div className="rounded-[10px] bg-[#F7F6F2] p-3">
            <div className="mb-1 text-[11px] font-bold text-[#666]">为什么爆 · 钩子类型：{result.evaluation.hookType}</div>
            <p className="text-[12px] leading-5 text-[#333]">{result.evaluation.whyViral}</p>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-bold text-[#666]">爆款DNA：标题结构「{result.dna.titleStructure}」· 开头钩子「{result.dna.openingHookType}」· 用户需求层「{result.dna.userNeedLayer}」</div>
            <div className="mb-2 flex flex-col gap-1.5">
              {result.dna.structureBreakdown.filter(s => s.percentage > 0).map(s => (
                <div key={s.stage} className="flex items-center gap-2">
                  <span className="w-[70px] flex-shrink-0 text-[11px] text-[#888]">{s.stage}</span>
                  <div className="h-[8px] flex-1 overflow-hidden rounded-full bg-[#F2F1ED]"><div className="h-full rounded-full bg-[#639922]" style={{ width: `${s.percentage}%` }} /></div>
                  <span className="w-[36px] text-right text-[11px] text-[#888]">{s.percentage}%</span>
                </div>
              ))}
            </div>
            {result.dna.emotionValue.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {result.dna.emotionValue.map(e => <span key={e.emotion} className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10.5px] text-[#666]">{e.emotion} {e.percentage}%</span>)}
              </div>
            )}
            <p className="mt-1.5 text-[10.5px] text-[#BBB]">占比按句子标签统计字数得出，不是AI凭感觉报的数字</p>
          </div>

          <div className="flex justify-end border-t border-[#F0EFE9] pt-3">
            <button onClick={handleAddToKB} disabled={added} className="rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">
              {added ? "已加入知识库" : "加入知识库"}
            </button>
          </div>
        </Card>
      )}

      {history.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">历史分析记录（{history.length}）</div>
          <div className="flex flex-col gap-1.5">
            {history.slice(0, 10).map(h => (
              <div key={h.id} className="flex items-center justify-between rounded-[10px] bg-[#F7F6F2] px-3 py-2 text-[12px]">
                <span className="text-[#444]">{h.title || h.inputRaw.slice(0, 24)} · <GradeBadge grade={h.evaluation.grade} /></span>
                <div className="flex items-center gap-2">
                  {h.addedToKnowledgeBase && <span className="text-[10.5px] text-[#3B6D11]">已入库</span>}
                  <button onClick={() => { deleteHotAnalysis(h.id); setHistory(getHotAnalyses()); }} className="text-[#999] hover:text-[#A32D2D]"><Icon name="trash" size="sm" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════ Tab2 基因库：纯客户端统计，不调用AI ════════════════════
function GenomeTab() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  useEffect(() => { setEntries(getKnowledgeEntries("爆款案例").filter(e => e.dna)); }, []);

  function tally(getKey: (e: KnowledgeEntry) => string | undefined): { key: string; count: number; pct: number }[] {
    const counts = new Map<string, number>();
    entries.forEach(e => { const k = getKey(e); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); });
    const total = entries.length || 1;
    return Array.from(counts.entries()).map(([key, count]) => ({ key, count, pct: Math.round((count / total) * 100) })).sort((a, b) => b.count - a.count);
  }

  const titleStructures = tally(e => e.dna?.titleStructure);
  const hookTypes = tally(e => e.dna?.openingHookType);
  const needLayers = tally(e => e.dna?.userNeedLayer);

  function Bars({ title, data }: { title: string; data: { key: string; count: number; pct: number }[] }) {
    return (
      <Card>
        <div className="mb-3 text-[13px] font-bold text-[#1C1C1B]">{title}</div>
        {data.length === 0 ? <p className="text-[12px] text-[#999]">暂无数据</p> : (
          <div className="flex flex-col gap-2">
            {data.map(d => (
              <div key={d.key} className="flex items-center gap-2">
                <span className="w-[90px] flex-shrink-0 text-[12px] text-[#555]">{d.key}</span>
                <div className="h-[10px] flex-1 overflow-hidden rounded-full bg-[#F2F1ED]"><div className="h-full rounded-full bg-[#639922]" style={{ width: `${d.pct}%` }} /></div>
                <span className="w-[60px] text-right text-[11.5px] text-[#888]">{d.pct}%（{d.count}条）</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[10px] bg-[#F7F6F2] px-3.5 py-2.5 text-[12.5px] text-[#666]">
        基于你知识库中已收录的 <b>{entries.length}</b> 条爆款案例统计——这是你自己积累的素材规律，不是全网/行业统计，数据越多统计越有意义。
      </div>
      <Bars title="标题结构分布" data={titleStructures} />
      <Bars title="开头钩子类型分布" data={hookTypes} />
      <Bars title="用户需求层分布" data={needLayers} />
    </div>
  );
}

// ════════════════════ Tab3 对标分析 ════════════════════
function BenchmarkTab() {
  const [myContent, setMyContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ titleGap: string; hookGap: string; caseGap: string; conversionGap: string; trustGap: string; rhythmGap: { myHookPercentage: number; avgComparableHookPercentage: number | null; note: string }; comparedCount: number } | null>(null);

  async function handleCompare() {
    if (!myContent.trim()) { setError("请提供你的文案或逐字稿"); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const allCases = getKnowledgeEntries("爆款案例");
      if (allCases.length === 0) { setError("知识库里还没有爆款案例，请先去素材雷达或知识库中心积累一些"); return; }
      const searchRes = await apiFetch("/api/knowledge-search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: myContent, entries: allCases.map(e => ({ id: e.id, category: e.category, title: e.title, tags: e.tags, keywords: e.keywords })) }),
      });
      const searchData = await searchRes.json();
      const matchedIds = new Set((searchData.results ?? []).map((r: { id: string }) => r.id));
      const comparables = allCases.filter(e => matchedIds.has(e.id));
      const finalComparables = comparables.length > 0 ? comparables : allCases.slice(0, 5);

      const res = await apiFetch("/api/hot-analysis/benchmark", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          myContent,
          comparables: finalComparables.map(e => ({ id: e.id, title: e.title, rawContent: e.rawContent, hookPercentage: e.dna?.structureBreakdown.find(s => s.stage === "Hook")?.percentage ?? null, hookType: e.viralEvaluation?.hookType ?? null })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? `请求失败（${res.status}）`); return; }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "对标分析失败");
    } finally { setLoading(false); }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <textarea value={myContent} onChange={e => setMyContent(e.target.value)} placeholder="粘贴你的文案或逐字稿…" rows={7}
          className="w-full resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[13.5px] leading-6 outline-none focus:border-[#639922]" />
        {error && <div className="mt-3 rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{error}</div>}
        <div className="mt-4 flex justify-end">
          <button onClick={handleCompare} disabled={loading || !myContent.trim()} className="flex h-[44px] items-center gap-2 rounded-[12px] bg-[#1C1C1B] px-7 text-[13.5px] font-semibold text-white disabled:opacity-40">
            {loading ? "对标中…" : "开始对标"}
          </button>
        </div>
      </Card>

      {result && (
        <Card className="flex flex-col gap-3">
          <div className="text-[11px] text-[#999]">对标了知识库中 {result.comparedCount} 条相关爆款案例</div>
          <div className="rounded-[10px] bg-[#F7F6F2] p-3">
            <div className="mb-1 text-[11px] font-bold text-[#666]">节奏差距</div>
            <p className="text-[12px] leading-5 text-[#444]">
              你的开头铺垫占比 {result.rhythmGap.myHookPercentage}%
              {result.rhythmGap.avgComparableHookPercentage != null && ` · 对标案例平均 ${result.rhythmGap.avgComparableHookPercentage}%`}
            </p>
            <p className="mt-1 text-[11.5px] text-[#888]">{result.rhythmGap.note}</p>
          </div>
          {([["标题差距", result.titleGap], ["钩子差距", result.hookGap], ["案例差距", result.caseGap], ["转化差距", result.conversionGap], ["信任感差距", result.trustGap]] as [string, string][]).map(([label, text]) => (
            <div key={label} className="rounded-[10px] bg-[#F7F6F2] p-3">
              <div className="mb-1 text-[11px] font-bold text-[#666]">{label}</div>
              <p className="text-[12px] leading-5 text-[#444]">{text}</p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ════════════════════ Tab4 预测中心 ════════════════════
function PredictTab() {
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ scores: { dimension: string; score: number; matchReasoning: string }[]; comparedCount: number; withRealDataCount: number; avgMetrics: Record<string, number | null>; confidenceNote: string } | null>(null);

  async function handlePredict() {
    if (!title.trim() && !script.trim()) { setError("请至少填写标题或口播稿其中一项"); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const allCases = getKnowledgeEntries("爆款案例");
      if (allCases.length === 0) { setError("知识库暂无可比案例，无法给出有依据的预测。请先积累一些爆款案例。"); return; }
      const query = `${title}\n${script}`;
      const searchRes = await apiFetch("/api/knowledge-search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, entries: allCases.map(e => ({ id: e.id, category: e.category, title: e.title, tags: e.tags, keywords: e.keywords })) }),
      });
      const searchData = await searchRes.json();
      const matchedIds = new Set((searchData.results ?? []).map((r: { id: string }) => r.id));
      const comparables = allCases.filter(e => matchedIds.has(e.id));
      const finalComparables = comparables.length > 0 ? comparables : allCases.slice(0, 5);

      const res = await apiFetch("/api/hot-analysis/predict", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, script,
          comparables: finalComparables.map(e => ({ id: e.id, title: e.title, rawContent: e.rawContent, metrics: e.metrics, hookType: e.viralEvaluation?.hookType ?? null })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? `请求失败（${res.status}）`); return; }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "预测失败");
    } finally { setLoading(false); }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="标题" className="mb-2.5 w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 text-[13.5px]" />
        <textarea value={script} onChange={e => setScript(e.target.value)} placeholder="口播稿…" rows={6}
          className="w-full resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[13.5px] leading-6 outline-none focus:border-[#639922]" />
        {error && <div className="mt-3 rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{error}</div>}
        <div className="mt-4 flex justify-end">
          <button onClick={handlePredict} disabled={loading || (!title.trim() && !script.trim())} className="flex h-[44px] items-center gap-2 rounded-[12px] bg-[#1C1C1B] px-7 text-[13.5px] font-semibold text-white disabled:opacity-40">
            {loading ? "预测中…" : "开始预测"}
          </button>
        </div>
      </Card>

      {result && (
        <Card className="flex flex-col gap-3">
          <div className="rounded-[10px] bg-[#FBF3D6] px-3 py-2 text-[11.5px] text-[#7A5C00]">{result.confidenceNote}</div>
          <div className="text-[11px] text-[#999]">
            对标 {result.comparedCount} 条相关案例，其中 {result.withRealDataCount} 条带真实互动数据
            {result.avgMetrics.likes != null && ` · 平均点赞${result.avgMetrics.likes} 平均收藏${result.avgMetrics.favorites}`}
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {result.scores.map(s => (
              <div key={s.dimension} className="rounded-[10px] bg-[#F7F6F2] p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[12px] font-bold text-[#1C1C1B]">{s.dimension}</span>
                  <span className="text-[16px] font-bold text-[#639922]">{s.score}</span>
                </div>
                <p className="text-[11.5px] leading-5 text-[#666]">{s.matchReasoning}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ════════════════════ Main ════════════════════
export default function HotAnalysisPage() {
  const [tab, setTab] = useState<TabId>("radar");

  return (
    <div className="min-h-screen p-6 md:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[13px] text-[#8A8A86]">
            <a href="/" className="font-semibold text-[#639922]">工作台</a> / 爆款分析中心
          </div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1B]">爆款分析中心</h1>
          <p className="mt-1.5 max-w-[600px] text-[13.5px] leading-6 text-[#8A8A86]">
            爆款发现 → 沉淀 → 拆解 → 知识库 → 对标 → 预测，整个内容生产系统的情报中心
          </p>
        </div>
        <span className="whitespace-nowrap rounded-full bg-[#EAF3DE] px-3.5 py-1.5 text-[12px] font-semibold text-[#3B6D11]">05 · 情报分析</span>
      </header>

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className="rounded-[12px] px-4 py-2.5 text-[13px] font-semibold transition-all"
            style={tab === t.id ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "radar" && <RadarTab />}
      {tab === "genome" && <GenomeTab />}
      {tab === "benchmark" && <BenchmarkTab />}
      {tab === "predict" && <PredictTab />}
    </div>
  );
}
