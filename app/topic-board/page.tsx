"use client";
import { apiFetch } from "@/lib/api-fetch";

import { useState, useEffect, useRef } from "react";
import {
  getKnowledgeEntries,
  getTopicAssets,
  recordKnowledgeUsage,
  getLatestPersonas,
  updateTopicAssetStatus,
} from "@/lib/ip-store";
import { IPProfile, KnowledgeEntry, TopicAsset, TopicAssetStatus } from "@/lib/types";
import { CitationSummary } from "@/components/ui/citation-summary";
import { useIP } from "@/lib/ip-context";
import { searchKnowledgeEntries, KnowledgeSearchMatch } from "@/lib/knowledge-search-utils";
import { getNormalizedCategory, isGlobalMethodCategory, isIPKnowledgeCategory } from "@/lib/knowledge-categories";
import { buildTopicReviewRequestPayload } from "@/lib/topic-review-request";
import { TopicBoardContractError, type TopicBoardResult } from "@/lib/topic-board-contract";
import { saveTopicBoardEvaluation, TopicBoardOwnershipError } from "@/lib/topic-board-history";
import { filterKnowledgeVisibleToIP } from "@/lib/knowledge-scope";

// ── Constants ──
const PHASES = [
  { id: 1, desc: "召集董事会成员…" },
  { id: 2, desc: "9位专家独立评审中…" },
  { id: 3, desc: "专家互相质疑辩论中…" },
  { id: 4, desc: "各专家根据质疑修正评分…" },
  { id: 5, desc: "首席反对官发表驳回意见…" },
  { id: 6, desc: "全员投票表决中…" },
  { id: 7, desc: "生成最终董事会决议…" },
];

const EXPERT_COLORS = ["#E05C3A","#C99A1E","#4A8FD6","#E0608E","#3DA876","#9B7ED9","#639922","#D9824A","#8A8A86"];
const VOTE_STYLES: Record<string, string> = {
  "支持": "bg-[#EAF3DE] text-[#3B6D11]",
  "保留意见": "bg-[#FBF3D6] text-[#7A5C00]",
  "反对": "bg-[#FCEBEB] text-[#A32D2D]",
};

const DEMO_TOPIC = "普通人如何判断一个机会是否真的适合自己？";
const EXAMPLES = [
  "为什么同样的方法，有人有效，有人却没效果？",
  "一个专业服务最容易被用户误解的地方是什么？",
  "新手开始一件事时，最应该避开的误区是什么？",
];

function levelColor(s: number) {
  return s >= 90 ? "#3DA876" : s >= 80 ? "#639922" : s >= 70 ? "#C99A1E" : "#E0608E";
}

// ── UI Helpers ──
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[14px] border border-[#E5E4DE] bg-white p-5 ${className}`}>{children}</div>;
}

function STitle({ num, children, sub }: { num?: string; children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      {num && <span className="rounded-full bg-[#1C1C1B] px-2.5 py-0.5 text-[11px] font-bold text-white">{num}</span>}
      <h2 className="text-[17px] font-semibold text-[#1C1C1B]">{children}</h2>
      {sub && <span className="text-[12.5px] text-[#8A8A86]">{sub}</span>}
    </div>
  );
}

function ScoreCircle({ score, color, size = 56 }: { score: number; color: string; size?: number }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#F1EFE8" strokeWidth="5"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${dash} ${circ-dash}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}/>
      <text x={size/2} y={size/2+5} textAnchor="middle" fontSize={size > 70 ? "18" : "13"} fontWeight="700" fill="#1C1C1B">{score}</text>
    </svg>
  );
}

function getBoardKnowledgeEntries(activeIP: IPProfile | null): KnowledgeEntry[] {
  return filterKnowledgeVisibleToIP(getKnowledgeEntries(), activeIP?.id ?? null).filter(e => {
    const category = getNormalizedCategory(e);
    return isGlobalMethodCategory(category) || isIPKnowledgeCategory(category);
  });
}

function collectKnowledgeContext(topic: string, activeIP: IPProfile | null): {
  id: string; title: string; category: string; reason: string; relevanceTier: string; relevanceReason: string; matchScore: number;
  matchedFields: string[]; matchedKeywords: string[]; methodMatches: string[]; methodAdvice: string;
}[] {
  return searchKnowledgeEntries(topic, getBoardKnowledgeEntries(activeIP), { limit: 8, minScore: 2 }).results;
}

// ── Phase loader ──
function PhaseLoader({ phase }: { phase: number }) {
  return (
    <div className="py-12 text-center">
      <div className="mx-auto mb-6 flex max-w-lg items-center justify-center gap-1">
        {PHASES.map((p, i) => (
          <div key={p.id} className="flex items-center">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold transition-all ${
              phase > p.id ? "bg-[#639922] text-white"
              : phase === p.id ? "bg-[#1C1C1B] text-white ring-4 ring-[#EAF3DE]"
              : "bg-[#F1EFE8] text-[#8A8A86]"
            }`}>{phase > p.id ? "✓" : p.id}</div>
            {i < PHASES.length - 1 && <div className={`mx-0.5 h-0.5 w-4 ${phase > p.id ? "bg-[#639922]" : "bg-[#E5E4DE]"}`}/>}
          </div>
        ))}
      </div>
      <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-4 border-[#EAF3DE] border-t-[#639922]"/>
      <div className="text-[14px] font-semibold text-[#1C1C1B]">{PHASES[phase - 1]?.desc}</div>
      <div className="mt-1 text-[12px] text-[#8A8A86]">阶段 {phase} / {PHASES.length}</div>
    </div>
  );
}

// ── 参考知识面板：选题输入变化后自动检索知识库，展示引用内容/原因/相关度档位 ──
interface KnowledgeRef {
  id: string; reason: string; relevanceTier: string; relevanceReason: string; entry: KnowledgeEntry;
  matchedFields?: string[]; matchedKeywords?: string[]; methodMatches?: string[]; methodAdvice?: string; matchScore?: number;
}
const REL_COLOR: Record<string, { bg: string; text: string }> = {
  "高度相关": { bg: "#EAF3DE", text: "#3B6D11" },
  "中度相关": { bg: "#FBF3D6", text: "#7A5C00" },
  "低度相关": { bg: "#F2F1ED", text: "#888" },
};
function KnowledgePanel({ loading, refs, searched }: { loading: boolean; refs: KnowledgeRef[]; searched: boolean }) {
  if (!loading && !searched) return null;
  return (
    <div className="mb-6 rounded-[16px] border border-[#E5E4DE] bg-white p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-[13px] font-bold text-[#1C1C1B]">【参考知识】</span>
        <span className="text-[11px] text-[#999]">系统自动检索知识库，定性相关度档位，不编造精确相似度数字</span>
      </div>
      {loading && <div className="text-[12.5px] text-[#888]">检索中…</div>}
      {!loading && refs.length === 0 && <div className="text-[12.5px] text-[#999]">知识库里没有找到强相关的参考，将仅依靠模型自身判断。</div>}
      {!loading && refs.length > 0 && (
        <div className="flex flex-col gap-2">
          {refs.map(r => {
            const c = REL_COLOR[r.relevanceTier] ?? REL_COLOR["低度相关"];
            return (
              <div key={r.id} className="rounded-[10px] bg-[#F7F6F2] p-2.5">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
                  <span className="text-[12px] font-semibold text-[#1C1C1B]">[{r.entry.category}] {r.entry.title}</span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: c.bg, color: c.text }}>{r.relevanceTier}</span>
                </div>
                <p className="text-[11.5px] leading-5 text-[#555]">引用原因：{r.reason}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TopicHistoryPanel({
  activeIPName,
  assets,
  onOpen,
  onStatusChange,
}: {
  activeIPName: string | null;
  assets: TopicAsset[];
  onOpen: (asset: TopicAsset) => void;
  onStatusChange: (asset: TopicAsset, status: Exclude<TopicAssetStatus, "草稿" | "已评估">) => void;
}) {
  return (
    <section aria-label="当前IP选题历史" className="mb-6 rounded-[20px] border border-[#E5E4DE] bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-[#1C1C1B]">当前IP选题历史</h2>
          <p className="mt-1 text-[12px] text-[#8A8A86]">
            {activeIPName ? `仅显示${activeIPName}名下的评估记录` : "请先选择当前操盘IP"}
          </p>
        </div>
        <span className="rounded-full bg-[#F1EFE8] px-3 py-1 text-[11px] font-semibold text-[#6B6B68]">{assets.length}条</span>
      </div>
      {assets.length === 0 ? (
        <div className="rounded-[12px] bg-[#F7F6F2] px-4 py-5 text-center text-[12.5px] text-[#8A8A86]">当前IP还没有保存过选题评估。</div>
      ) : (
        <div className="space-y-2.5">
          {assets.map(asset => (
            <article key={asset.id} className="rounded-[12px] border border-[#E5E4DE] bg-[#FDFDFC] p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-[#1C1C1B]">{asset.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#8A8A86]">
                    <span>{asset.status}</span>
                    {asset.evaluationSummary && (
                      <><span>总分{asset.evaluationSummary.scoreDisplay}</span><span>{asset.evaluationSummary.finalRecommendation}</span></>
                    )}
                  </div>
                  {asset.evaluationIssue && <p className="mt-1.5 text-[11.5px] text-[#A32D2D]">{asset.evaluationIssue.message}</p>}
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {(asset.status === "已评估" || asset.status === "已采用") && asset.boardResult && (
                    <a
                      href={`/script-factory?topicId=${encodeURIComponent(asset.id)}`}
                      aria-label={`用选题“${asset.title}”生成脚本`}
                      className="rounded-full bg-[#1C1C1B] px-2.5 py-1 text-[11px] font-semibold text-white"
                    >
                      生成脚本
                    </a>
                  )}
                  {asset.boardResult && (
                    <button type="button" aria-label={`查看选题“${asset.title}”完整评估`} onClick={() => onOpen(asset)} className="rounded-full bg-[#F1EFE8] px-2.5 py-1 text-[11px] font-semibold text-[#555]">查看评估</button>
                  )}
                  {asset.status === "已评估" && (
                    <button type="button" aria-label={`将选题“${asset.title}”标记为已采用`} onClick={() => onStatusChange(asset, "已采用")} className="rounded-full bg-[#EAF3DE] px-2.5 py-1 text-[11px] font-semibold text-[#3B6D11]">采纳</button>
                  )}
                  {asset.status === "已采用" && (
                    <button type="button" aria-label={`将选题“${asset.title}”标记为已拍摄`} onClick={() => onStatusChange(asset, "已拍摄")} className="rounded-full bg-[#DCEBFB] px-2.5 py-1 text-[11px] font-semibold text-[#315F91]">已拍摄</button>
                  )}
                  {(asset.status === "已评估" || asset.status === "已采用") && (
                    <button type="button" aria-label={`将选题“${asset.title}”标记为已废弃`} onClick={() => onStatusChange(asset, "已废弃")} className="rounded-full bg-[#FCEBEB] px-2.5 py-1 text-[11px] font-semibold text-[#A32D2D]">废弃</button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Main ──
export default function TopicBoardPage() {
  const { activeIP } = useIP();
  const [topic, setTopic] = useState(DEMO_TOPIC);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [result, setResult] = useState<TopicBoardResult | null>(null);
  const [topicHistory, setTopicHistory] = useState<TopicAsset[]>([]);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const activeIPIdRef = useRef<string | null>(activeIP?.id ?? null);

  // 参考知识：选题输入停止变化800ms后自动检索，不是实时每个按键都查
  const [knowledgeRefs, setKnowledgeRefs] = useState<KnowledgeRef[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeSearched, setKnowledgeSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knowledgeRequestSeqRef = useRef(0);

  useEffect(() => {
    activeIPIdRef.current = activeIP?.id ?? null;
    setTopicHistory(activeIP ? getTopicAssets(activeIP.id) : []);
    setResult(null);
    setSaveNotice(null);
  }, [activeIP?.id]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const requestSeq = knowledgeRequestSeqRef.current + 1;
    knowledgeRequestSeqRef.current = requestSeq;
    const requestIP = activeIP;
    setKnowledgeRefs([]);
    if (topic.trim().length < 5) {
      setKnowledgeLoading(false);
      setKnowledgeSearched(false);
      return;
    }
    setKnowledgeLoading(true);
    setKnowledgeSearched(true);
    debounceRef.current = setTimeout(() => {
      searchKnowledge(topic, requestIP, requestSeq);
    }, 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, activeIP?.id]);

  function refsFromMatches(matches: KnowledgeSearchMatch[], allEntries: KnowledgeEntry[]): KnowledgeRef[] {
    const entryMap = new Map(allEntries.map(e => [e.id, e]));
    return matches
      .map(r => {
        const entry = entryMap.get(r.id);
        if (!entry) return null;
        const ref: KnowledgeRef = {
          id: r.id,
          reason: r.reason,
          relevanceTier: r.relevanceTier,
          relevanceReason: r.relevanceReason,
          matchedFields: r.matchedFields,
          matchedKeywords: r.matchedKeywords,
          methodMatches: r.methodMatches,
          methodAdvice: r.methodAdvice,
          matchScore: r.matchScore,
          entry,
        };
        return ref;
      })
      .filter((r: KnowledgeRef | null): r is KnowledgeRef => r !== null);
  }

  async function searchKnowledge(query: string, requestIP: IPProfile | null, requestSeq: number) {
    const isCurrentRequest = () => (
      knowledgeRequestSeqRef.current === requestSeq &&
      activeIPIdRef.current === (requestIP?.id ?? null)
    );
    const allEntries = getBoardKnowledgeEntries(requestIP);
    if (allEntries.length === 0) {
      if (!isCurrentRequest()) return;
      setKnowledgeLoading(false);
      setKnowledgeSearched(true);
      setKnowledgeRefs([]);
      return;
    }
    setKnowledgeLoading(true); setKnowledgeSearched(true);
    try {
      const res = await apiFetch("/api/knowledge-search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          entries: allEntries.map(e => ({
            id: e.id,
            category: e.category,
            normalizedCategory: getNormalizedCategory(e),
            title: e.title,
            tags: e.tags,
            keywords: e.keywords,
            rawContent: e.rawContent,
            summary: e.note,
            referenceReason: e.sourceTierReason,
            note: e.note,
            metadata: { sourcePlatform: e.sourcePlatform, contentDirection: e.contentDirection, viralEvaluation: e.viralEvaluation },
          })),
        }),
      });
      const data = await res.json();
      if (!isCurrentRequest()) return;
      if (!res.ok) { setKnowledgeRefs([]); return; }
      const refs = refsFromMatches(data.results ?? [], allEntries);
      setKnowledgeRefs(refs);
    } catch {
      if (!isCurrentRequest()) return;
      setKnowledgeRefs([]);
    } finally {
      if (isCurrentRequest()) setKnowledgeLoading(false);
    }
  }

  async function handleSubmit() {
    if (!topic.trim()) { setError("请输入选题内容"); return; }
    const requestIP = activeIP;
    if (!requestIP) { setError("请先选择当前操盘IP"); return; }
    const requestedTopic = topic.trim();
    setError(null); setSaveNotice(null); setResult(null); setLoading(true); setPhase(1);
    setExpanded({});

    const delays = [500, 1000, 800, 700, 600, 500];
    for (let i = 0; i < delays.length; i++) {
      await new Promise(r => setTimeout(r, delays[i]));
      setPhase(i + 2);
    }

    try {
      const personas = getLatestPersonas(requestIP.id);
      const stableKnowledgeContext = collectKnowledgeContext(requestedTopic, requestIP);
      const allEntries = getBoardKnowledgeEntries(requestIP);
      const stableRefs = refsFromMatches(stableKnowledgeContext as KnowledgeSearchMatch[], allEntries);
      setKnowledgeRefs(stableRefs);
      setKnowledgeSearched(true);
      const res = await apiFetch("/api/topic-review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTopicReviewRequestPayload({
          topic: requestedTopic,
          userPersonas: personas,
          knowledgeContext: stableKnowledgeContext,
        }, requestIP)),
      });
      let data: unknown = null;
      try { data = await res.json(); } catch { throw new Error(`接口返回非JSON（${res.status}）`); }
      if (!res.ok) {
        const apiError = typeof data === "object" && data !== null && "error" in data
          && typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : `请求失败（${res.status}）`;
        throw new Error(apiError);
      }

      const saved = saveTopicBoardEvaluation(requestIP, data);
      if (!saved.boardResult) throw new Error("选题评估保存失败");
      stableRefs.forEach(ref => {
        recordKnowledgeUsage(ref.id, {
          module: "选题董事会",
          usedAt: new Date().toISOString(),
          reason: ref.reason,
          relevanceTier: ref.relevanceTier as "高度相关" | "中度相关" | "低度相关",
          relevanceReason: ref.relevanceReason,
          context: requestedTopic,
        }, "已用于选题");
      });
      const currentIPId = activeIPIdRef.current;
      setTopicHistory(currentIPId ? getTopicAssets(currentIPId) : []);
      setSaveNotice(
        currentIPId === requestIP.id
          ? `评估已保存到${requestIP.name}的选题库。`
          : `评估已保存到${requestIP.name}的选题库；当前IP已切换，可切回查看。`,
      );
      if (currentIPId === requestIP.id) setResult(saved.boardResult);
    } catch (err) {
      if (err instanceof TopicBoardOwnershipError) {
        setError("评估结果IP与发起请求时的IP不一致，已阻止保存，请重试。");
      } else if (err instanceof TopicBoardContractError) {
        setError("AI返回的选题评估结构不完整，未保存，请重试。");
      } else {
        setError(err instanceof Error ? err.message : "分析失败，请重试");
      }
    } finally { setLoading(false); setPhase(0); }
  }

  function openHistoryResult(asset: TopicAsset) {
    if (!asset.boardResult) {
      setError(asset.evaluationIssue?.message ?? "这条历史记录缺少完整评估结果，请重新评估。");
      return;
    }
    setError(null);
    setResult(asset.boardResult);
  }

  function changeHistoryStatus(
    asset: TopicAsset,
    status: Exclude<TopicAssetStatus, "草稿" | "已评估">,
  ) {
    try {
      const updated = updateTopicAssetStatus(asset.id, status);
      if (!updated) throw new Error("没有找到这条选题记录");
      const currentIPId = activeIPIdRef.current;
      setTopicHistory(currentIPId ? getTopicAssets(currentIPId) : []);
      setError(null);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "选题状态更新失败");
    }
  }

  const toggleExp = (i: number) => setExpanded(prev => ({ ...prev, [i]: !prev[i] }));
  const safetyBlockReason = result?.safetyVeto
    ? result.safetyVetoReason ?? "存在不可控的言行或合规风险。"
    : null;
  const displayedVotes = result?.votes.map(vote =>
    result.safetyVeto && vote.role === "安全合规官"
      ? { ...vote, vote: "反对" }
      : vote,
  ) ?? [];
  const displayedSupportCount = displayedVotes.filter(vote => vote.vote === "支持").length;
  const displayedReserveCount = displayedVotes.filter(vote => vote.vote === "保留意见").length;
  const displayedOpposeCount = displayedVotes.filter(vote => vote.vote === "反对").length;

  return (
    <div className="min-h-screen p-6 md:p-8">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[13px] text-[#8A8A86]">
            <a href="/" className="font-semibold text-[#639922]">工作台</a> / AI 选题董事会 V2
          </div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1B]">AI 选题董事会 <span className="text-[14px] font-normal text-[#8A8A86]">V2.0</span></h1>
          <p className="mt-1.5 max-w-[600px] text-[13.5px] leading-6 text-[#8A8A86]">
            完整推理链 · 子维度计算 · 专家辩论 · 首席反对官 · 全员投票 · 可信度评分
          </p>
        </div>
        <span className="whitespace-nowrap rounded-full bg-[#EAF3DE] px-3.5 py-1.5 text-[12px] font-semibold text-[#3B6D11]">01 · 选题评估</span>
      </header>

      {/* Input */}
      <div className="mb-6 rounded-[20px] border border-[#E5E4DE] bg-white p-5">
        <label className="mb-2.5 block text-[13px] font-semibold text-[#8A8A86]">输入你的选题</label>
        <div className="flex flex-col gap-3 md:flex-row">
          <textarea value={topic} onChange={e => setTopic(e.target.value)}
            placeholder={`例如：${DEMO_TOPIC}`}
            className="min-h-[52px] flex-1 resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[14px] text-[#1C1C1B] outline-none focus:border-[#639922] focus:ring-2 focus:ring-[#EAF3DE]"/>
          <button onClick={handleSubmit} disabled={loading || !activeIP}
            className="flex h-[52px] items-center justify-center gap-2 whitespace-nowrap rounded-[14px] bg-[#1C1C1B] px-8 text-[14px] font-semibold text-white disabled:opacity-60">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 12H19M19 12L13 6M19 12L13 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {loading ? "评审中…" : "召开董事会"}
          </button>
        </div>
        <p className="mt-3 rounded-[10px] bg-[#F7FCF0] px-3 py-2 text-[12px] leading-5 text-[#4F6F32]">
          {activeIP
            ? `评估背景：当前操盘IP为${activeIP.name}，将结合其受众、内容方向和表达风格进行判断。`
            : "评估背景：请先在左侧选择当前操盘IP，系统将结合对应档案进行判断。"}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map(ex => (
            <button key={ex} onClick={() => setTopic(ex)}
              className="rounded-full bg-[#F4F4F2] px-3 py-1.5 text-[12px] text-[#8A8A86] hover:text-[#1C1C1B]">{ex}</button>
          ))}
        </div>
      </div>

      <TopicHistoryPanel
        activeIPName={activeIP?.name ?? null}
        assets={topicHistory}
        onOpen={openHistoryResult}
        onStatusChange={changeHistoryStatus}
      />

      <KnowledgePanel loading={knowledgeLoading} refs={knowledgeRefs} searched={knowledgeSearched} />

      {saveNotice && <div className="mb-6 rounded-[14px] bg-[#EAF3DE] px-5 py-4 text-[14px] font-semibold text-[#3B6D11]">{saveNotice}</div>}
      {error && <div className="mb-6 rounded-[14px] bg-[#FCEBEB] px-5 py-4 text-[14px] font-semibold text-[#A32D2D]">{error}</div>}
      {loading && phase > 0 && <PhaseLoader phase={phase} />}

      {!loading && !result && !error && (
        <div className="py-16 text-center text-[#8A8A86]">
          <h3 className="mb-2 text-[17px] font-semibold text-[#1C1C1B]">等待召开董事会</h3>
          <p className="mx-auto max-w-[460px] text-[13.5px] leading-6">
            输入选题后点击「召开董事会」，9位专家将经过7个阶段的完整推理、辩论和投票，给出有据可查的最终决议。
          </p>
        </div>
      )}

      {!loading && result && (
        <div className="flex flex-col gap-8">

          {/* 安全合规官一票否决横幅 */}
          {result.safetyVeto && (
            <div className="rounded-[14px] border border-[#F3C6C6] bg-[#FCEBEB] px-5 py-4">
              <div className="text-[14px] font-bold text-[#A32D2D]">⚠ 安全合规官行使一票否决权</div>
              {result.safetyVetoReason && (
                <p className="mt-1 text-[13px] leading-6 text-[#A32D2D]">{result.safetyVetoReason}</p>
              )}
              <p className="mt-1 text-[12px] text-[#8A8A86]">该选题存在不可控的言行或合规风险，无论其他维度得分多高，均不建议制作。可参考下方专家意见调整方向后重新评审。</p>
            </div>
          )}

          {/* 知识引用统计——让用户看到知识库参与了本次分析 */}
          <CitationSummary
            refs={knowledgeRefs}
            loading={knowledgeLoading}
            searched={knowledgeSearched}
            label="本次选题分析参考了"
          />

          <section>
            <STitle num="00">小白决策建议</STitle>
            <Card>
              <div className="mb-3 rounded-[10px] bg-[#FFF7ED] px-3 py-2 text-[12.5px] leading-5 text-[#C2410C]">
                {result.safetyVeto ? "安全否决优先于其他评分和投票结果。" : result.confidenceNotice}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                {[
                  ["能不能做", result.safetyVeto ? "不能做当前版本。" : result.beginnerAdvice.canDo],
                  ["为什么", result.safetyVeto ? `安全合规官已行使一票否决权：${safetyBlockReason}` : result.beginnerAdvice.why],
                  ["最大问题", result.safetyVeto ? safetyBlockReason : result.beginnerAdvice.biggestProblem],
                  ["怎么改", result.safetyVeto ? "先移除不可控风险并重新评估，不要直接发布当前版本。" : result.beginnerAdvice.howToImprove],
                  ["要不要测", result.safetyVeto ? "不要测试当前版本，完成安全改写后重新评估。" : result.beginnerAdvice.shouldTest],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[10px] bg-[#F7F6F2] p-3">
                    <div className="mb-1 text-[11px] font-bold text-[#888]">{label}</div>
                    <p className="text-[12.5px] leading-5 text-[#1C1C1B]">{value}</p>
                  </div>
                ))}
              </div>
            </Card>
          </section>

          <section>
            <STitle num="00" sub="统一评分明细，每项都有一句解释">透明评分</STitle>
            <Card>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[12px] font-bold text-[#8A8A86]">最终建议</div>
                  <div className="mt-1 text-[20px] font-bold text-[#1C1C1B]">{result.safetyVeto ? "不建议" : result.finalRecommendation}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-[#F2F1ED] px-3 py-1 text-[12px] font-bold text-[#555]" title={result.safetyVeto ? safetyBlockReason ?? undefined : result.riskExplanation}>风险：{result.safetyVeto ? "高" : result.riskLevel}</span>
                  <span className="rounded-full bg-[#EAF3DE] px-3 py-1 text-[12px] font-bold text-[#3B6D11]">总分：{result.scoreDisplay}</span>
                </div>
              </div>
              <div className="mb-4 rounded-[10px] bg-[#FFF7ED] px-3 py-2 text-[12.5px] leading-5 text-[#C2410C]">
                风险项说明：{result.safetyVeto ? safetyBlockReason : result.riskExplanation}
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {result.scoreBreakdown.map(item => (
                  <div key={item.label} className="rounded-[10px] bg-[#F7F6F2] p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[12.5px] font-bold text-[#1C1C1B]">{item.label}</span>
                      <span className="text-[18px] font-bold" style={{ color: levelColor(item.score) }}>{item.score}</span>
                    </div>
                    <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-[#E5E4DE]">
                      <div className="h-full rounded-full" style={{ width: `${item.score}%`, background: levelColor(item.score) }} />
                    </div>
                    <p className="text-[12px] leading-5 text-[#666]">{item.explanation}</p>
                  </div>
                ))}
              </div>
            </Card>
          </section>

          {(result.safetyVeto || result.finalRecommendation === "不建议") && (
            <section>
              <STitle num="00" sub="不是只否定，而是给下一步改法">不建议后的优化方案</STitle>
              <Card>
                <div className="mb-3 rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">
                  核心原因：{result.safetyVeto ? safetyBlockReason : result.optimizationPlan.coreReason}
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-[10px] bg-[#F7FCF0] p-3">
                    <div className="mb-1 text-[12px] font-bold text-[#3B6D11]">{result.safetyVeto ? "当前版本不保留" : "可以保留的部分"}</div>
                    {(result.safetyVeto ? ["无，当前版本需要先完成安全改写。"] : result.optimizationPlan.keepParts).map((item, i) => <p key={i} className="text-[12px] leading-5 text-[#555]">· {item}</p>)}
                  </div>
                  <div className="rounded-[10px] bg-[#FFF7ED] p-3">
                    <div className="mb-1 text-[12px] font-bold text-[#C2410C]">应该删除或弱化的部分</div>
                    {(result.safetyVeto ? [safetyBlockReason ?? "存在不可控的言行或合规风险。"] : result.optimizationPlan.weakenParts).map((item, i) => <p key={i} className="text-[12px] leading-5 text-[#555]">· {item}</p>)}
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {(result.safetyVeto ? [] : result.optimizationPlan.rewrittenDirections).map((item, i) => (
                    <div key={i} className="rounded-[10px] bg-[#F7F6F2] px-3 py-2 text-[12.5px] text-[#1C1C1B]">{i + 1}. {item}</div>
                  ))}
                </div>
                <div className="mt-3 rounded-[10px] bg-[#EAF3DE] px-3 py-2 text-[12.5px] text-[#3B6D11]">
                  改写后是否建议测试：{result.safetyVeto ? "当前版本不得测试；完成安全改写后重新评估。" : result.optimizationPlan.retestSuggestion}
                </div>
              </Card>
            </section>
          )}

          {/* ① 议题卡 */}
          <div className="rounded-[16px] bg-[#1C1C1B] p-6">
            <div className="mb-1 text-[11px] font-semibold tracking-widest text-[#6B6B68]">BOARD MEETING · 董事会议题</div>
            <div className="text-[21px] font-semibold text-white">「{result.topic}」</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="text-[13px] text-[#8A8A86]">9位专家 · 7阶段评审 · 完整推理链</span>
              <span className="rounded-full px-3 py-1 text-[12px] font-bold" style={{ background: levelColor(result.totalScore) + "22", color: levelColor(result.totalScore) }}>
                {result.safetyVeto ? "安全否决" : result.level}
              </span>
            </div>
          </div>

          {/* ② 第一轮：推理链 */}
          <section>
            <STitle num="01" sub="点击专家卡展开完整推理链和子维度计算">第一轮 · 专家独立评审</STitle>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
              {result.experts.map((e, i) => (
                <div key={e.role} className={`cursor-pointer rounded-[14px] border p-4 transition ${expanded[i] ? "border-[#1C1C1B] bg-white shadow-md" : "border-[#E5E4DE] bg-white hover:border-[#1C1C1B]"}`}
                  onClick={() => toggleExp(i)}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[12.5px] font-semibold text-[#1C1C1B]">{e.role}</span>
                    <span className="text-[22px] font-bold" style={{ color: EXPERT_COLORS[i] }}>{e.initialScore}</span>
                  </div>

                  {/* 推理链时间轴（收起时简略，展开后完整） */}
                  {!expanded[i] ? (
                    <p className="text-[12px] leading-5 text-[#8A8A86]">{result.safetyVeto && e.role === "安全合规官" ? `安全否决：${safetyBlockReason}` : e.conclusion}</p>
                  ) : (
                    <div className="space-y-2">
                      {/* 推理链 */}
                      {[
                        { step: "观察", color: "#4A8FD6", text: e.observation },
                        { step: "推理", color: "#C99A1E", text: e.reasoning },
                        { step: "结论", color: "#3DA876", text: result.safetyVeto && e.role === "安全合规官" ? `安全否决：${safetyBlockReason}` : e.conclusion },
                      ].map((s, si) => (
                        <div key={si} className="flex gap-2">
                          <div className="flex flex-col items-center">
                            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: s.color }}>{s.step[0]}</span>
                            {si < 2 && <div className="mt-0.5 w-0.5 flex-1 bg-[#E5E4DE]" style={{ minHeight: "12px" }}/>}
                          </div>
                          <div className="pb-2">
                            <span className="text-[10px] font-bold" style={{ color: s.color }}>{s.step}</span>
                            <p className="mt-0.5 text-[12px] leading-5 text-[#1C1C1B]">{s.text}</p>
                          </div>
                        </div>
                      ))}

                      {/* 子维度计算 */}
                      <div className="mt-2 rounded-[10px] bg-[#F7F6F2] p-3">
                        <div className="mb-2 text-[10px] font-bold text-[#8A8A86]">评分计算过程</div>
                        <div className="space-y-1.5">
                          {e.dimData.dims.map(d => (
                            <div key={d.label} className="flex items-center gap-2">
                              <span className="w-[56px] flex-shrink-0 text-[10px] text-[#8A8A86]">{d.label}</span>
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#E5E4DE]">
                                <div className="h-full rounded-full" style={{ width: `${d.score * 10}%`, background: EXPERT_COLORS[i] }}/>
                              </div>
                              <span className="text-[10px] font-bold" style={{ color: EXPERT_COLORS[i] }}>{d.score}/{d.max}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 border-t border-[#E5E4DE] pt-2 text-[10px] text-[#8A8A86]">
                          {e.dimData.formula}
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-1">
                        <span className="text-[11px] text-[#8A8A86]">初始票</span>
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${VOTE_STYLES[result.safetyVeto && e.role === "安全合规官" ? "反对" : e.vote] ?? "bg-[#F1EFE8] text-[#8A8A86]"}`}>{result.safetyVeto && e.role === "安全合规官" ? "反对" : e.vote}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-[#8A8A86]">← 点击卡片展开：观察→推理→结论 + 子维度计算过程</p>
          </section>

          {/* ③ 首席反对官 */}
          <section>
            <STitle num="02" sub="专门寻找失败理由，永远站在反对立场">首席反对官</STitle>
            <div className="rounded-[14px] border-2 border-[#E0608E] bg-white p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-[#FCEBEB] px-3 py-1.5 text-[13px] font-bold text-[#A32D2D]">首席反对官</span>
                  <span className="text-[13px] font-semibold text-[#1C1C1B]">驳回意见</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-3 py-1 text-[12px] font-bold ${
                  (result.safetyVeto ? "高风险" : result.chiefOfficer.riskLevel) === "高风险" ? "bg-[#FCEBEB] text-[#A32D2D]"
                  : result.chiefOfficer.riskLevel === "中风险" ? "bg-[#FBF3D6] text-[#7A5C00]"
                  : "bg-[#EAF3DE] text-[#3B6D11]"
                  }`}>{result.safetyVeto ? "高风险" : result.chiefOfficer.riskLevel}</span>
                  <span className="text-[13px] text-[#8A8A86]">失败概率 <span className="font-bold text-[#E0608E]">{result.safetyVeto ? 100 : result.chiefOfficer.failProbability}%</span></span>
                </div>
              </div>
              <div className="mb-3 space-y-2">
                {(result.safetyVeto ? [safetyBlockReason ?? "存在不可控的言行或合规风险。"] : result.chiefOfficer.reasons).map((r, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="mt-0.5 text-[#E0608E]">✗</span>
                    <span className="text-[13.5px] text-[#1C1C1B]">{r}</span>
                  </div>
                ))}
              </div>
              <div className="rounded-[10px] bg-[#FBF3D6] px-4 py-3">
                <span className="text-[11px] font-bold text-[#7A5C00]">驳回建议 </span>
                <span className="text-[13px] text-[#1C1C1B]">{result.safetyVeto ? "当前版本不得制作或测试；完成安全改写后重新评估。" : result.chiefOfficer.dismissalSuggestion}</span>
              </div>
            </div>
          </section>

          {/* ④ 第二轮：质疑对话 */}
          <section>
            <STitle num="03" sub="专家之间基于具体评分展开质疑">第二轮 · 专家质疑辩论</STitle>
            <div className="space-y-3">
              {result.challenges.map((c, i) => (
                <Card key={i}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${c.from === "首席反对官" ? "bg-[#FCEBEB] text-[#A32D2D]" : "bg-[#F1EFE8] text-[#1C1C1B]"}`}>{c.from}</span>
                    <span className="text-[11px] text-[#8A8A86]">质疑</span>
                    <span className="rounded-full bg-[#FBF3D6] px-2.5 py-1 text-[12px] font-semibold text-[#7A5C00]">{c.to}（{c.targetScore}分）</span>
                  </div>
                  <p className="mb-2 text-[13.5px] leading-6 text-[#1C1C1B]">「{c.challenge}」</p>
                  <div className="flex flex-wrap gap-2 text-[12px] text-[#8A8A86]">
                    <span className="rounded bg-[#DCEBFB] px-2 py-0.5 text-[11px] font-semibold text-[#4A8FD6]">影响维度：{c.affectedDimension}</span>
                    <span className="text-[12px] text-[#8A8A86]">{c.impact}</span>
                  </div>
                </Card>
              ))}
            </div>
          </section>

          {/* ⑤ 第三轮：修正评分 */}
          <section>
            <STitle num="04" sub="专家回应质疑，展示修正后计算结果">第三轮 · 回应与修正评分</STitle>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {result.responses.map((r, i) => (
                <Card key={i}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-[#1C1C1B]">{r.role}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-[#8A8A86] line-through">{r.initialScore}</span>
                      <span className="text-[#8A8A86]">→</span>
                      <span className="text-[16px] font-bold text-[#1C1C1B]">{r.finalScore}</span>
                      {r.scoreChange !== 0 && (
                        <span className={`text-[12px] font-semibold ${r.scoreChange > 0 ? "text-[#3DA876]" : "text-[#E0608E]"}`}>
                          {r.scoreChange > 0 ? `+${r.scoreChange}` : r.scoreChange}
                        </span>
                      )}
                    </div>
                  </div>
                  {r.challenge && (
                    <div className="mb-2 rounded-[8px] bg-[#F7F6F2] px-3 py-2 text-[12px] italic text-[#8A8A86]">
                      被质疑：「{r.challenge.slice(0, 60)}…」
                    </div>
                  )}
                  <p className="mb-1.5 text-[13px] text-[#1C1C1B]">{r.response}</p>
                  <div className="text-[11px] text-[#8A8A86]">修正后计算：{r.finalFormula}</div>
                </Card>
              ))}
            </div>
          </section>

          {/* ⑥ 投票 */}
          <section>
            <STitle num="05" sub="9位专家＋1位首席反对官，共10位成员最终表态">全员投票表决</STitle>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
              <Card>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {displayedVotes.map((v, i) => (
                    <div key={i} className="flex items-center justify-between rounded-[10px] bg-[#F7F6F2] px-3 py-2.5">
                      <span className="text-[12.5px] text-[#1C1C1B]">{v.role}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${VOTE_STYLES[v.vote] ?? "bg-[#F1EFE8] text-[#8A8A86]"}`}>{v.vote}</span>
                    </div>
                  ))}
                </div>
              </Card>
              <div className="rounded-[14px] border-2 border-[#1C1C1B] bg-white p-5 flex flex-col items-center justify-center gap-3 min-w-[160px]">
                <div className="text-[12px] font-semibold text-[#8A8A86]">投票结果</div>
                <div className="space-y-1.5 w-full">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-[#3B6D11]">✓ 支持</span>
                    <span className="text-[18px] font-bold text-[#3DA876]">{result.safetyVeto ? displayedSupportCount : result.voteResult.supportCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-[#7A5C00]">◐ 保留</span>
                    <span className="text-[18px] font-bold text-[#C99A1E]">{result.safetyVeto ? displayedReserveCount : result.voteResult.reserveCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-[#A32D2D]">✗ 反对</span>
                    <span className="text-[18px] font-bold text-[#E0608E]">{result.safetyVeto ? displayedOpposeCount : result.voteResult.opposeCount}</span>
                  </div>
                </div>
                <div className={`w-full rounded-[8px] py-2 text-center text-[13px] font-bold ${
                  !result.safetyVeto && result.voteResult.verdict === "通过" ? "bg-[#EAF3DE] text-[#3B6D11]"
                  : !result.safetyVeto && result.voteResult.verdict === "有条件通过" ? "bg-[#FBF3D6] text-[#7A5C00]"
                  : "bg-[#FCEBEB] text-[#A32D2D]"
                }`}>
                  董事会决议：{result.safetyVeto ? "安全否决" : result.voteResult.verdict}
                </div>
              </div>
            </div>
          </section>

          {/* ⑦ 评分计算 */}
          <section>
            <STitle num="06" sub="加权模型，每分都有出处">综合评分计算</STitle>
            <Card>
              <div className="space-y-2.5">
                {result.weights.map((w, i) => (
                  <div key={w.role} className="flex items-center gap-3">
                    <span className="w-[110px] flex-shrink-0 text-[12.5px] text-[#1C1C1B]">{w.role}</span>
                    <span className="w-[28px] text-right text-[13px] font-bold text-[#1C1C1B]">{w.score}</span>
                    <span className="text-[11px] text-[#8A8A86]">×{(w.weight * 100).toFixed(0)}%</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#F1EFE8]">
                      <div className="h-full rounded-full" style={{ width: `${w.contribution}%`, background: EXPERT_COLORS[i] }}/>
                    </div>
                    <span className="w-[36px] text-right text-[12.5px] font-bold" style={{ color: EXPERT_COLORS[i] }}>{w.contribution.toFixed(1)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-[#E5E4DE] pt-3">
                  <span className="text-[14px] font-semibold text-[#1C1C1B]">最终综合得分</span>
                  <span className="text-[32px] font-bold" style={{ color: levelColor(result.totalScore) }}>{result.totalScore}</span>
                </div>
              </div>
            </Card>
          </section>

          {/* ⑧ 可信度仪表盘 */}
          <section>
            <STitle num="07" sub="本次评审结论的可靠程度">可信度仪表盘</STitle>
            <Card>
              <div className="flex flex-col gap-4 md:flex-row md:items-start">
                <div className="flex flex-col items-center gap-2">
                  <ScoreCircle score={result.credScore} color={result.credScore > 65 ? "#639922" : result.credScore > 45 ? "#C99A1E" : "#E0608E"} size={80}/>
                  <span className="text-[12px] text-[#8A8A86]">评审可信度</span>
                </div>
                <div className="flex-1">
                  <div className="mb-2 text-[13px] font-semibold text-[#1C1C1B]">
                    可信度 {result.credScore}/100 —— {result.safetyVeto ? "安全否决结论优先，不得测试当前版本" : result.credScore > 65 ? "结论具有一定参考价值" : result.credScore > 45 ? "结论需结合市场数据验证" : "结论仅供参考，强烈建议实测"}
                  </div>
                  <div className="space-y-1.5">
                    {result.credReasons.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-[12.5px] text-[#8A8A86]">
                        <span className="text-[#C99A1E]">·</span>{r}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 rounded-[10px] bg-[#EAF3DE] px-3 py-2 text-[12.5px] text-[#3B6D11]">
                    {result.safetyVeto
                      ? "安全否决已生效：不要发布或测试当前版本，完成安全改写后重新评审。"
                      : "✓ 提升可信度：发布1-2条测试视频后带真实数据回来重新评审，可信度预计提升20-30分"}
                  </div>
                </div>
              </div>
            </Card>
          </section>

          {/* ⑨ 最终决议 */}
          <section>
            <STitle num="08">最终董事会决议</STitle>
            <div className="rounded-[16px] bg-[#1C1C1B] p-6">
              <div className="mb-4 flex flex-wrap items-end gap-4">
                <div>
                  <div className="text-[11px] text-[#6B6B68]">综合评分</div>
                  <span className="text-[52px] font-bold leading-none" style={{ color: levelColor(result.totalScore) }}>{result.totalScore}</span>
                </div>
                <div className="flex flex-col gap-2 pb-1">
                  <span className="rounded-full px-4 py-2 text-[14px] font-bold" style={{ background: levelColor(result.totalScore) + "22", color: levelColor(result.totalScore) }}>{result.safetyVeto ? "安全否决" : result.level}</span>
                  <span className={`rounded-full px-4 py-2 text-center text-[12px] font-bold ${
                    !result.safetyVeto && result.voteResult.verdict === "通过" ? "bg-[#EAF3DE] text-[#3B6D11]"
                    : !result.safetyVeto && result.voteResult.verdict === "有条件通过" ? "bg-[#FBF3D6] text-[#7A5C00]"
                    : "bg-[#FCEBEB] text-[#A32D2D]"
                  }`}>表决：{result.safetyVeto ? "安全否决" : result.voteResult.verdict}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {result.weights.map((w, i) => (
                  <div key={w.role} className="rounded-[10px] bg-[#2A2A28] p-3">
                    <div className="text-[17px] font-bold" style={{ color: EXPERT_COLORS[i] }}>{w.score}</div>
                    <div className="text-[10px] text-[#6B6B68]">{w.role}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ⑩ 风险 */}
          <section>
            <STitle num="09">风险提示</STitle>
            <div className="space-y-2">
              {(result.safetyVeto ? [safetyBlockReason ?? "存在不可控的言行或合规风险。"] : result.risks).map((r, i) => (
                <div key={i} className={`flex items-start gap-3 rounded-[12px] px-4 py-3 ${r.startsWith("⚠") ? "bg-[#FCEBEB]" : "bg-[#F7F6F2]"}`}>
                  <span className="text-[13.5px] text-[#1C1C1B]">{r}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ⑪ 升级选题 */}
          {!result.safetyVeto && <section>
            <STitle num="10">选题升级版</STitle>
            <div className="space-y-2">
              {result.upgradedTopics.map((t, i) => (
                <div key={i} className="flex items-center gap-3 rounded-[12px] border border-[#E5E4DE] bg-white px-4 py-3">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#EAF3DE] text-[11px] font-bold text-[#3B6D11]">{i + 1}</span>
                  <span className="text-[14px] text-[#1C1C1B]">{t}</span>
                </div>
              ))}
            </div>
          </section>}

          {/* ⑫ 爆款标题 */}
          {!result.safetyVeto && <section>
            <STitle num="11" sub="10条">爆款标题生成</STitle>
            <Card>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {result.titles.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-[10px] bg-[#F7F6F2] px-4 py-2.5">
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#EAF3DE] text-[10px] font-bold text-[#3B6D11]">{i + 1}</span>
                    <span className="text-[13px] text-[#1C1C1B]">{t}</span>
                  </div>
                ))}
              </div>
            </Card>
          </section>}

          {/* ⑬ 真实用户预演 */}
          {!result.safetyVeto && result.personaPreview && (
            <section>
              <STitle num="12" sub="来自用户人格库">真实用户预演</STitle>
              <div className="flex flex-col gap-3">
                {/* 整体结论 */}
                <Card>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded-[10px] bg-[#EAF3DE] p-3">
                      <div className="mb-1 text-[11px] font-bold text-[#3B6D11]">最感兴趣</div>
                      <p className="text-[12.5px] text-[#3B6D11]">{result.personaPreview.mostInterestedPersona}</p>
                    </div>
                    {result.personaPreview.leastInterestedPersona && (
                      <div className="rounded-[10px] bg-[#FCEBEB] p-3">
                        <div className="mb-1 text-[11px] font-bold text-[#A32D2D]">最不感兴趣</div>
                        <p className="text-[12.5px] text-[#A32D2D]">{result.personaPreview.leastInterestedPersona}</p>
                      </div>
                    )}
                    <div className="rounded-[10px] bg-[#FBF3D6] p-3">
                      <div className="mb-1 text-[11px] font-bold text-[#7A5C00]">最大共同顾虑</div>
                      <p className="text-[12.5px] text-[#7A5C00]">{result.personaPreview.biggestConcern}</p>
                    </div>
                    <div className="rounded-[10px] bg-[#F7F6F2] p-3">
                      <div className="mb-1 text-[11px] font-bold text-[#888]">最可能评论类型</div>
                      <p className="text-[12.5px] text-[#555]">{result.personaPreview.mostLikelyComment}</p>
                    </div>
                    <div className="rounded-[10px] bg-[#F7F6F2] p-3">
                      <div className="mb-1 text-[11px] font-bold text-[#888]">最可能收藏的内容</div>
                      <p className="text-[12.5px] text-[#555]">{result.personaPreview.mostLikelyToSave}</p>
                    </div>
                    <div className="rounded-[10px] bg-[#DCEFFA] p-3">
                      <div className="mb-1 text-[11px] font-bold text-[#1A5276]">付费转化机会</div>
                      <p className="text-[12.5px] text-[#1A5276]">{result.personaPreview.conversionOpportunity}</p>
                    </div>
                  </div>
                </Card>

                {/* 各人格反应 */}
                {result.personaPreview.personaReactions?.map((r: { personaName: string; wouldClick: string; wouldUnderstand: string; wouldSave: string; wouldComment: string; wouldPay: string; howToPresent: string; mainConcern: string }, i: number) => (
                  <Card key={i}>
                    <div className="mb-2 text-[13px] font-bold text-[#1C1C1B]">{r.personaName}</div>
                    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                      {[["想点开", r.wouldClick], ["能看懂", r.wouldUnderstand], ["会收藏", r.wouldSave], ["会评论", r.wouldComment], ["会付费", r.wouldPay]].map(([label, val]) => (
                        <div key={label} className="rounded-[8px] bg-[#F7F6F2] p-2 text-center">
                          <div className="text-[10px] text-[#999]">{label}</div>
                          <div className="text-[12px] font-bold text-[#1C1C1B]">{val}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 text-[12px] text-[#555]">💬 {r.howToPresent}</div>
                    <div className="mt-1 text-[11.5px] text-[#A32D2D]">⚠️ {r.mainConcern}</div>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {!result.hasPersonas && (
            <section>
              <Card>
                <p className="text-center text-[12.5px] text-[#8A8A86]">
                  暂无用户人格数据。去「AI评论区需求雷达」导入评论、生成用户人格后，这里会自动出现「真实用户预演」。
                </p>
              </Card>
            </section>
          )}

        </div>
      )}
    </div>
  );
}
