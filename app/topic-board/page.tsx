"use client";
import { apiFetch } from "@/lib/api-fetch";

import { useState, useEffect, useRef } from "react";
import { getKnowledgeEntries, recordKnowledgeUsage, getLatestPersonas } from "@/lib/ip-store";
import { KnowledgeEntry } from "@/lib/types";
import { CitationSummary } from "@/components/ui/citation-summary";
import { useIP } from "@/lib/ip-context";
import { buildTopicReviewRequestPayload } from "@/lib/topic-review-request";

// ── Types ──
interface Dim { label: string; score: number; max: number; }
interface DimData { dims: Dim[]; formula: string; computed: number; }
interface Expert {
  role: string; observation: string; reasoning: string; conclusion: string;
  initialScore: number; finalScore: number; scoreChange: number;
  dimData: DimData; vote: string;
}
interface ChiefOfficer {
  role: string; reasons: string[]; riskLevel: string;
  failProbability: number; dismissalSuggestion: string;
}
interface Challenge {
  from: string; to: string; targetScore: number;
  challenge: string; affectedDimension: string; impact: string;
}
interface ResponseItem {
  role: string; challenge: string | null; response: string;
  initialScore: number; finalScore: number; scoreChange: number; finalFormula: string;
}
interface VoteItem { role: string; vote: string; }
interface VoteResult { supportCount: number; reserveCount: number; opposeCount: number; verdict: string; }
interface WeightedScore { role: string; score: number; weight: number; contribution: number; }
interface BoardResult {
  topic: string; experts: Expert[]; chiefOfficer: ChiefOfficer;
  challenges: Challenge[]; responses: ResponseItem[];
  votes: VoteItem[]; voteResult: VoteResult;
  weights: WeightedScore[]; totalScore: number; level: string;
  credScore: number; credReasons: string[];
  risks: string[]; upgradedTopics: string[]; titles: string[];
  hasPersonas?: boolean;
  personaPreview?: {
    personaReactions: { personaName: string; wouldClick: string; wouldUnderstand: string; wouldSave: string; wouldComment: string; wouldPay: string; howToPresent: string; mainConcern: string }[];
    mostInterestedPersona: string; leastInterestedPersona?: string;
    biggestConcern: string; mostLikelyComment: string; mostLikelyToSave: string; conversionOpportunity: string;
  } | null;
}

// ── Constants ──
const PHASES = [
  { id: 1, desc: "召集董事会成员…" },
  { id: 2, desc: "8位专家独立评审中…" },
  { id: 3, desc: "专家互相质疑辩论中…" },
  { id: 4, desc: "各专家根据质疑修正评分…" },
  { id: 5, desc: "首席反对官发表驳回意见…" },
  { id: 6, desc: "全员投票表决中…" },
  { id: 7, desc: "生成最终董事会决议…" },
];

const EXPERT_COLORS = ["#E05C3A","#C99A1E","#4A8FD6","#E0608E","#3DA876","#9B7ED9","#639922","#D9824A"];
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
interface KnowledgeRef { id: string; reason: string; relevanceTier: string; relevanceReason: string; entry: KnowledgeEntry }
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

// ── Main ──
export default function TopicBoardPage() {
  const { activeIP } = useIP();
  const [topic, setTopic] = useState(DEMO_TOPIC);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BoardResult | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  // 参考知识：选题输入停止变化800ms后自动检索，不是实时每个按键都查
  const [knowledgeRefs, setKnowledgeRefs] = useState<KnowledgeRef[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeSearched, setKnowledgeSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (topic.trim().length < 5) { setKnowledgeSearched(false); setKnowledgeRefs([]); return; }
    debounceRef.current = setTimeout(() => { searchKnowledge(topic); }, 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);

  async function searchKnowledge(query: string) {
    const allEntries = [
      ...getKnowledgeEntries("爆款案例"), ...getKnowledgeEntries("方法论"),
      ...getKnowledgeEntries("评论需求"), ...getKnowledgeEntries("选题案例"),
    ];
    if (allEntries.length === 0) { setKnowledgeSearched(true); setKnowledgeRefs([]); return; }
    setKnowledgeLoading(true); setKnowledgeSearched(true);
    try {
      const res = await apiFetch("/api/knowledge-search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          entries: allEntries.map(e => ({ id: e.id, category: e.category, title: e.title, tags: e.tags, keywords: e.keywords })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setKnowledgeRefs([]); return; }
      const entryMap = new Map(allEntries.map(e => [e.id, e]));
      const refs: KnowledgeRef[] = (data.results ?? [])
        .map((r: { id: string; reason: string; relevanceTier: string; relevanceReason: string }) => {
          const entry = entryMap.get(r.id);
          return entry ? { ...r, entry } : null;
        })
        .filter((r: KnowledgeRef | null): r is KnowledgeRef => r !== null);
      setKnowledgeRefs(refs);
      // 检索到的每一条都记一次引用——这就是"知识库→AI模块"调用链里真实发生的那一步
      refs.forEach(r => {
        recordKnowledgeUsage(r.id, {
          module: "选题董事会", usedAt: new Date().toISOString(),
          reason: r.reason, relevanceTier: r.relevanceTier as "高度相关" | "中度相关" | "低度相关",
          relevanceReason: r.relevanceReason, context: query,
        }, "已用于选题");
      });
    } catch {
      setKnowledgeRefs([]);
    } finally {
      setKnowledgeLoading(false);
    }
  }

  async function handleSubmit() {
    if (!topic.trim()) { setError("请输入选题内容"); return; }
    setError(null); setResult(null); setLoading(true); setPhase(1);
    setExpanded({});

    const delays = [500, 1000, 800, 700, 600, 500];
    for (let i = 0; i < delays.length; i++) {
      await new Promise(r => setTimeout(r, delays[i]));
      setPhase(i + 2);
    }

    try {
      const personas = activeIP ? getLatestPersonas(activeIP.id) : [];
      const res = await apiFetch("/api/topic-review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTopicReviewRequestPayload({ topic, userPersonas: personas }, activeIP)),
      });
      let data: BoardResult | { error: string } | null = null;
      try { data = await res.json(); } catch { throw new Error(`接口返回非JSON（${res.status}）`); }
      if (!res.ok) throw new Error(data && "error" in data ? data.error : `请求失败（${res.status}）`);
      setResult(data as BoardResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败，请重试");
    } finally { setLoading(false); setPhase(0); }
  }

  const toggleExp = (i: number) => setExpanded(prev => ({ ...prev, [i]: !prev[i] }));

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
          <button onClick={handleSubmit} disabled={loading}
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

      <KnowledgePanel loading={knowledgeLoading} refs={knowledgeRefs} searched={knowledgeSearched} />

      {error && <div className="mb-6 rounded-[14px] bg-[#FCEBEB] px-5 py-4 text-[14px] font-semibold text-[#A32D2D]">{error}</div>}
      {loading && phase > 0 && <PhaseLoader phase={phase} />}

      {!loading && !result && !error && (
        <div className="py-16 text-center text-[#8A8A86]">
          <h3 className="mb-2 text-[17px] font-semibold text-[#1C1C1B]">等待召开董事会</h3>
          <p className="mx-auto max-w-[460px] text-[13.5px] leading-6">
            输入选题后点击「召开董事会」，8位专家将经过7个阶段的完整推理、辩论和投票，给出有据可查的最终决议。
          </p>
        </div>
      )}

      {!loading && result && (
        <div className="flex flex-col gap-8">

          {/* 知识引用统计——让用户看到知识库参与了本次分析 */}
          <CitationSummary
            refs={knowledgeRefs}
            loading={knowledgeLoading}
            searched={knowledgeSearched}
            label="本次选题分析参考了"
          />

          {/* ① 议题卡 */}
          <div className="rounded-[16px] bg-[#1C1C1B] p-6">
            <div className="mb-1 text-[11px] font-semibold tracking-widest text-[#6B6B68]">BOARD MEETING · 董事会议题</div>
            <div className="text-[21px] font-semibold text-white">「{result.topic}」</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="text-[13px] text-[#8A8A86]">9位成员 · 7阶段评审 · 完整推理链</span>
              <span className="rounded-full px-3 py-1 text-[12px] font-bold" style={{ background: levelColor(result.totalScore) + "22", color: levelColor(result.totalScore) }}>
                {result.level}
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
                    <p className="text-[12px] leading-5 text-[#8A8A86]">{e.conclusion}</p>
                  ) : (
                    <div className="space-y-2">
                      {/* 推理链 */}
                      {[
                        { step: "观察", color: "#4A8FD6", text: e.observation },
                        { step: "推理", color: "#C99A1E", text: e.reasoning },
                        { step: "结论", color: "#3DA876", text: e.conclusion },
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
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${VOTE_STYLES[e.vote] ?? "bg-[#F1EFE8] text-[#8A8A86]"}`}>{e.vote}</span>
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
                    result.chiefOfficer.riskLevel === "高风险" ? "bg-[#FCEBEB] text-[#A32D2D]"
                    : result.chiefOfficer.riskLevel === "中风险" ? "bg-[#FBF3D6] text-[#7A5C00]"
                    : "bg-[#EAF3DE] text-[#3B6D11]"
                  }`}>{result.chiefOfficer.riskLevel}</span>
                  <span className="text-[13px] text-[#8A8A86]">失败概率 <span className="font-bold text-[#E0608E]">{result.chiefOfficer.failProbability}%</span></span>
                </div>
              </div>
              <div className="mb-3 space-y-2">
                {result.chiefOfficer.reasons.map((r, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="mt-0.5 text-[#E0608E]">✗</span>
                    <span className="text-[13.5px] text-[#1C1C1B]">{r}</span>
                  </div>
                ))}
              </div>
              <div className="rounded-[10px] bg-[#FBF3D6] px-4 py-3">
                <span className="text-[11px] font-bold text-[#7A5C00]">驳回建议 </span>
                <span className="text-[13px] text-[#1C1C1B]">{result.chiefOfficer.dismissalSuggestion}</span>
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
            <STitle num="05" sub="9位成员最终表态">全员投票表决</STitle>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
              <Card>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {result.votes.map((v, i) => (
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
                    <span className="text-[18px] font-bold text-[#3DA876]">{result.voteResult.supportCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-[#7A5C00]">◐ 保留</span>
                    <span className="text-[18px] font-bold text-[#C99A1E]">{result.voteResult.reserveCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-[#A32D2D]">✗ 反对</span>
                    <span className="text-[18px] font-bold text-[#E0608E]">{result.voteResult.opposeCount}</span>
                  </div>
                </div>
                <div className={`w-full rounded-[8px] py-2 text-center text-[13px] font-bold ${
                  result.voteResult.verdict === "通过" ? "bg-[#EAF3DE] text-[#3B6D11]"
                  : result.voteResult.verdict === "有条件通过" ? "bg-[#FBF3D6] text-[#7A5C00]"
                  : "bg-[#FCEBEB] text-[#A32D2D]"
                }`}>
                  董事会决议：{result.voteResult.verdict}
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
                    可信度 {result.credScore}/100 —— {result.credScore > 65 ? "结论具有一定参考价值" : result.credScore > 45 ? "结论需结合市场数据验证" : "结论仅供参考，强烈建议实测"}
                  </div>
                  <div className="space-y-1.5">
                    {result.credReasons.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-[12.5px] text-[#8A8A86]">
                        <span className="text-[#C99A1E]">·</span>{r}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 rounded-[10px] bg-[#EAF3DE] px-3 py-2 text-[12.5px] text-[#3B6D11]">
                    ✓ 提升可信度：发布1-2条测试视频后带真实数据回来重新评审，可信度预计提升20-30分
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
                  <span className="rounded-full px-4 py-2 text-[14px] font-bold" style={{ background: levelColor(result.totalScore) + "22", color: levelColor(result.totalScore) }}>{result.level}</span>
                  <span className={`rounded-full px-4 py-2 text-center text-[12px] font-bold ${
                    result.voteResult.verdict === "通过" ? "bg-[#EAF3DE] text-[#3B6D11]"
                    : result.voteResult.verdict === "有条件通过" ? "bg-[#FBF3D6] text-[#7A5C00]"
                    : "bg-[#FCEBEB] text-[#A32D2D]"
                  }`}>表决：{result.voteResult.verdict}</span>
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
              {result.risks.map((r, i) => (
                <div key={i} className={`flex items-start gap-3 rounded-[12px] px-4 py-3 ${r.startsWith("⚠") ? "bg-[#FCEBEB]" : "bg-[#F7F6F2]"}`}>
                  <span className="text-[13.5px] text-[#1C1C1B]">{r}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ⑪ 升级选题 */}
          <section>
            <STitle num="10">选题升级版</STitle>
            <div className="space-y-2">
              {result.upgradedTopics.map((t, i) => (
                <div key={i} className="flex items-center gap-3 rounded-[12px] border border-[#E5E4DE] bg-white px-4 py-3">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#EAF3DE] text-[11px] font-bold text-[#3B6D11]">{i + 1}</span>
                  <span className="text-[14px] text-[#1C1C1B]">{t}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ⑫ 爆款标题 */}
          <section>
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
          </section>

          {/* ⑬ 真实用户预演 */}
          {result.personaPreview && (
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
