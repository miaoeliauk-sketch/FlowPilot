"use client";
import { apiFetch } from "@/lib/api-fetch";

import { useState, useEffect, useRef } from "react";
import CommentRadarResult from "@/components/comment-radar/CommentRadarResult";
import type { CommentRadarResult as ResultType } from "@/components/comment-radar/types";
import { useIP } from "@/lib/ip-context";
import { addCommentAsset, getCommentAssets, getKnowledgeEntries, recordKnowledgeUsage, addKnowledgeEntry, savePersonaResult, getUserPersonas } from "@/lib/ip-store";
import type { CommentAsset, KnowledgeEntry, CommentPersonaResult, UserPersona } from "@/lib/types";
import { XlsxUploadPanel } from "@/components/ui/xlsx-upload-panel";
import type { ImportedData } from "@/components/ui/xlsx-upload-panel";

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

// ── 参考知识面板：评论文本停止变化后自动检索知识库 ──
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

// ════════════════════ 用户人格区块 ════════════════════
const CONFIDENCE_COLOR = { "高": { bg: "#EAF3DE", text: "#3B6D11" }, "中": { bg: "#FBF3D6", text: "#7A5C00" }, "低": { bg: "#FCEBEB", text: "#A32D2D" } };
const INTENT_LABEL = { "高": "购买意向高", "中": "购买意向中", "低": "购买意向低" };

function PersonaCard({ persona }: { persona: UserPersona }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[14px] border border-[#E5E4DE] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[14px] font-bold text-[#1C1C1B]">{persona.name}</span>
        <div className="flex gap-1.5">
          <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[11px] font-semibold text-[#555]">
            {INTENT_LABEL[persona.purchaseIntent]}
          </span>
          <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[11px] text-[#888]">
            {persona.commentCount}条评论
          </span>
        </div>
      </div>
      <p className="mt-2 text-[12.5px] leading-5 text-[#639922]">{persona.topicFocus}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {persona.keywords.map((k, i) => <span key={i} className="rounded-full bg-[#F7F6F2] px-2 py-0.5 text-[11px] text-[#666]">#{k}</span>)}
      </div>
      <button onClick={() => setOpen(v => !v)} className="mt-2 text-[12px] text-[#639922]">{open ? "收起详情" : "查看详情 →"}</button>
      {open && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-[10px] bg-[#F7F6F2] p-2.5">
            <div className="mb-1 text-[11px] font-bold text-[#888]">真实需求</div>
            {persona.coreNeeds.map((n, i) => <p key={i} className="text-[12px] leading-5 text-[#333]">· {n}</p>)}
          </div>
          <div className="rounded-[10px] bg-[#FCEBEB] p-2.5">
            <div className="mb-1 text-[11px] font-bold text-[#A32D2D]">核心顾虑</div>
            {persona.coreConcerns.map((c, i) => <p key={i} className="text-[12px] leading-5 text-[#A32D2D]">· {c}</p>)}
          </div>
          <div className="rounded-[10px] bg-[#EAF3DE] p-2.5">
            <div className="mb-1 text-[11px] font-bold text-[#3B6D11]">内容偏好</div>
            {persona.contentPreferences.map((p, i) => <p key={i} className="text-[12px] leading-5 text-[#3B6D11]">· {p}</p>)}
          </div>
          <div className="rounded-[10px] bg-[#F7F6F2] p-2.5">
            <div className="mb-1 text-[11px] font-bold text-[#888]">代表性评论</div>
            {persona.representativeComments.map((c, i) => <p key={i} className="text-[12px] leading-5 text-[#555] italic">「{c}」</p>)}
          </div>
        </div>
      )}
    </div>
  );
}

function PersonaSection({ ipId, platform, comments }: { ipId: string | null; platform: string; comments: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CommentPersonaResult | null>(null);
  const [savedToKB, setSavedToKB] = useState(false);
  const [history, setHistory] = useState<CommentPersonaResult[]>([]);

  useEffect(() => {
    if (ipId) setHistory(getUserPersonas(ipId).slice(0, 3));
  }, [ipId]);

  async function handleGenerate() {
    if (!comments.trim()) { setError("请先在上方填写评论内容"); return; }
    setLoading(true); setError(null); setResult(null); setSavedToKB(false);
    try {
      const res = await apiFetch("/api/comment-persona", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawComments: comments, platform, ipId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "分析失败"); return; }
      setResult(data);
    } catch (err) { setError(err instanceof Error ? err.message : "网络错误"); }
    finally { setLoading(false); }
  }

  function handleSaveToKB() {
    if (!result) return;
    // 1. 保存人格分析结果（供选题董事会调用）
    savePersonaResult(result);
    // 2. 每个人格也保存为一条知识库评论需求条目
    result.personas.forEach(p => {
      addKnowledgeEntry({
        category: "评论需求",
        title: `用户人格：${p.name}`,
        rawContent: `需求：${p.coreNeeds.join("；")}\n顾虑：${p.coreConcerns.join("；")}\n偏好：${p.contentPreferences.join("；")}\n代表评论：${p.representativeComments.join("；")}`,
        tags: [...p.keywords, platform, "用户人格"],
        keywords: p.keywords,
        ipId,
        sourceTier: result.confidenceTier,
        sourceTierReason: result.confidenceReason,
        contentDirection: [],
        sourcePlatform: platform,
        sourceUrl: "",
        note: p.topicFocus,
        extractedAt: result.createdAt,
        metrics: null, viralEvaluation: null, usageRecords: [], status: "未使用", dna: null,
      });
    });
    setSavedToKB(true);
    setHistory(ipId ? getUserPersonas(ipId).slice(0, 3) : []);
  }

  const confidenceColor = result ? CONFIDENCE_COLOR[result.confidenceTier] : null;

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-bold text-[#1C1C1B]">用户人格生成</h2>
          <p className="mt-0.5 text-[12px] text-[#8A8A86]">从评论区提炼真实用户画像，为选题董事会提供"真实用户视角"</p>
        </div>
        <button onClick={handleGenerate} disabled={loading || !comments.trim()}
          className="rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">
          {loading ? "分析中（约20秒）…" : "生成用户人格"}
        </button>
      </div>

      {error && <div className="mb-3 rounded-[10px] bg-[#FCEBEB] px-4 py-3 text-[12.5px] text-[#A32D2D]">{error}</div>}

      {result && (
        <div className="flex flex-col gap-4">
          {/* 分析概览 */}
          <div className="flex flex-wrap gap-3 rounded-[14px] border border-[#E5E4DE] bg-white p-4">
            <div className="text-[12.5px]"><span className="text-[#888]">导入评论：</span><span className="font-bold">{result.totalComments}条</span></div>
            <div className="text-[12.5px]"><span className="text-[#888]">有效评论：</span><span className="font-bold text-[#639922]">{result.validComments}条</span></div>
            <div className="text-[12.5px]"><span className="text-[#888]">过滤噪音：</span><span className="font-bold text-[#888]">{result.filteredCount}条</span></div>
            <div className="text-[12.5px]"><span className="text-[#888]">识别人格：</span><span className="font-bold text-[#1C1C1B]">{result.personas.length}个</span></div>
            {confidenceColor && (
              <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: confidenceColor.bg, color: confidenceColor.text }}>
                {result.confidenceTier}可信度
              </span>
            )}
            <span className="text-[11.5px] text-[#888]">{result.confidenceReason}</span>
          </div>

          {/* 人格卡片 */}
          {result.personas.length > 0 ? (
            <div className="flex flex-col gap-3">
              {result.personas.map(p => <PersonaCard key={p.id} persona={p} />)}
            </div>
          ) : (
            <div className="rounded-[10px] bg-[#F7F6F2] py-6 text-center text-[12.5px] text-[#888]">
              有效评论不足，未能识别出明确的用户人格
            </div>
          )}

          {/* 保存按钮 */}
          {result.personas.length > 0 && (
            <div className="flex justify-end">
              <button onClick={handleSaveToKB} disabled={savedToKB}
                className="rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">
                {savedToKB ? "✓ 已保存到知识库 + 选题董事会" : "保存到知识库 + 接入选题董事会"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 历史人格 */}
      {history.length > 0 && !result && (
        <div className="rounded-[14px] border border-[#E5E4DE] bg-white p-4">
          <div className="mb-2 text-[12.5px] font-bold text-[#888]">已保存的用户人格（最近{history.length}次分析）</div>
          {history[0].personas.map(p => (
            <div key={p.id} className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-[#1C1C1B]">{p.name}</span>
              {p.keywords.slice(0, 3).map((k, i) => <span key={i} className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[11px] text-[#666]">#{k}</span>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CommentRadarPage() {
  const { activeIP, loading: ipLoading } = useIP();
  const [platform, setPlatform] = useState("抖音");
  const [comments, setComments] = useState("");
  const [showXlsx, setShowXlsx] = useState(false);

  function handleXlsxImport(data: ImportedData) {
    if (data.mode === "comment" && data.comments) {
      setComments(data.comments.join("\n"));
      setShowXlsx(false);
    }
  }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultType | null>(null);
  const [history, setHistory] = useState<CommentAsset[]>([]);

  const [knowledgeRefs, setKnowledgeRefs] = useState<KnowledgeRef[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeSearched, setKnowledgeSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (comments.trim().length < 20) { setKnowledgeSearched(false); setKnowledgeRefs([]); return; }
    debounceRef.current = setTimeout(() => { searchKnowledge(comments); }, 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments]);

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
          query: query.slice(0, 2000), // 评论可能很长，截断到2000字防止payload过大
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
      refs.forEach(r => {
        recordKnowledgeUsage(r.id, {
          module: "评论区雷达", usedAt: new Date().toISOString(),
          reason: r.reason, relevanceTier: r.relevanceTier as "高度相关" | "中度相关" | "低度相关",
          relevanceReason: r.relevanceReason, context: query.slice(0, 200),
        }, "已用于分析");
      });
    } catch {
      setKnowledgeRefs([]);
    } finally {
      setKnowledgeLoading(false);
    }
  }

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
      const res = await apiFetch("/api/comment-radar", {
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
          <button onClick={() => setShowXlsx(v => !v)}
            className="ml-auto flex items-center gap-1.5 rounded-full bg-[#EAF3DE] px-3.5 py-1.5 text-[12.5px] font-semibold text-[#3B6D11]">
            📊 从 Excel 导入
          </button>
        </div>

        {showXlsx && (
          <div className="mb-4">
            <XlsxUploadPanel mode="comment" onImport={handleXlsxImport} onClose={() => setShowXlsx(false)} />
          </div>
        )}

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

      <KnowledgePanel loading={knowledgeLoading} refs={knowledgeRefs} searched={knowledgeSearched} />

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

      {/* ───────── 用户人格生成 ───────── */}
      <PersonaSection ipId={activeIP?.id ?? null} platform={platform} comments={comments} />
    </div>
  );
}
