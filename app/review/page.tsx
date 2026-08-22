"use client";
import { apiFetch } from "@/lib/api-fetch";
import { useState, useEffect, useRef } from "react";
import { useIP } from "@/lib/ip-context";
import { VideoReview, ReviewMetrics } from "@/lib/types";
import {
  getActiveIPId, getVideoReviews, getScriptAssets, updateVideoReview, deleteVideoReview,
  saveReviewExperienceToKnowledge, getKnowledgeEntries,
} from "@/lib/ip-store";
import {
  addVideoReviewForSource,
  assessVideoReviewTraceability,
  getVideoReviewKnowledgeEffect,
  getLearningEligibleVideoReviews,
  resolveVideoReviewSource,
  VideoReviewSourceInvalidError,
  VIDEO_REVIEW_TRACEABILITY_LABELS,
} from "@/lib/review-traceability";
import { Icon } from "@/components/ui/icon";
import { XlsxUploadPanel } from "@/components/ui/xlsx-upload-panel";
import type { ImportedData } from "@/components/ui/xlsx-upload-panel";

type TabId = "new" | "history" | "experience";
const TABS: { id: TabId; label: string }[] = [
  { id: "new", label: "新建复盘" },
  { id: "history", label: "复盘记录" },
  { id: "experience", label: "经验库" },
];

const PLATFORMS = ["抖音", "小红书", "视频号", "B站", "其他"];
const DIRECTIONS = ["AI工具测评", "AI工作流", "AI副业", "AI自媒体", "其他"];

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[14px] border border-[#E5E4DE] bg-white p-5 ${className}`}>{children}</div>;
}

const GRADE_COLOR: Record<string, { bg: string; text: string }> = {
  "S": { bg: "#FCEBEB", text: "#A32D2D" }, "A": { bg: "#FBF3D6", text: "#7A5C00" },
  "B": { bg: "#EAF3DE", text: "#3B6D11" }, "C": { bg: "#F2F1ED", text: "#888" },
};
function GradeBadge({ grade }: { grade: string }) {
  const c = GRADE_COLOR[grade] ?? GRADE_COLOR["C"];
  return <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: c.bg, color: c.text }}>{grade}级</span>;
}

const CONFIDENCE_COLOR: Record<string, { bg: string; text: string }> = {
  "高可信度": { bg: "#EAF3DE", text: "#3B6D11" },
  "中可信度": { bg: "#FBF3D6", text: "#7A5C00" },
  "低可信度": { bg: "#F2F1ED", text: "#888" },
};
function ConfidenceBadge({ tier }: { tier: string }) {
  const c = CONFIDENCE_COLOR[tier] ?? CONFIDENCE_COLOR["低可信度"];
  return <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: c.bg, color: c.text }}>{tier}</span>;
}

function MetricInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-[#888]">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value.replace(/\D/g, ""))}
        placeholder="0" className="rounded-[8px] border border-[#E5E4DE] px-2.5 py-1.5 text-[13px] text-center" />
    </div>
  );
}

// ════════════════════ Tab1 新建复盘 ════════════════════
function NewReviewTab({ onSaved }: { onSaved: () => void }) {
  const { activeIP } = useIP();
  const [reviewSource, setReviewSource] = useState<"flowpilot" | "external">("flowpilot");
  const [selectedScriptId, setSelectedScriptId] = useState("");
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState("抖音");
  const [publishedAt, setPublishedAt] = useState(new Date().toISOString().slice(0, 10));
  const [videoUrl, setVideoUrl] = useState("");
  const [contentDirection, setContentDirection] = useState("AI工具测评");
  const [scriptText, setScriptText] = useState("");
  const [m, setM] = useState<Record<string, string>>({
    views: "", likes: "", comments: "", favorites: "", shares: "",
    newFollowers: "", dms: "", leads: "", conversions: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VideoReview["analysis"] | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [showXlsx, setShowXlsx] = useState(false);
  const analysisRequestSequence = useRef(0);
  const availableScripts = activeIP ? getScriptAssets(activeIP.id) : [];

  useEffect(() => {
    analysisRequestSequence.current += 1;
    setLoading(false);
    setSelectedScriptId("");
    setResult(null);
    setSavedId(null);
    setError("");
  }, [activeIP?.id]);

  function handleXlsxImport(data: ImportedData) {
    if (data.mode === "review" && data.reviewMetrics) {
      const metrics = data.reviewMetrics;
      setM(prev => ({
        ...prev,
        views: metrics.views || prev.views,
        likes: metrics.likes || prev.likes,
        comments: metrics.comments || prev.comments,
        favorites: metrics.favorites || prev.favorites,
        shares: metrics.shares || prev.shares,
        newFollowers: metrics.newFollowers || prev.newFollowers,
      }));
      setShowXlsx(false);
    }
  }

  function n(k: string) { return Number(m[k]) || 0; }

  async function handleAnalyze() {
    if (!activeIP) { setError("请先选择当前操盘IP"); return; }
    if (reviewSource === "flowpilot" && !selectedScriptId) {
      setError("请选择这次发布使用的FlowPilot脚本");
      return;
    }
    try {
      resolveVideoReviewSource({
        activeIPId: activeIP.id,
        source: reviewSource === "flowpilot"
          ? { type: "flowpilot", scriptId: selectedScriptId }
          : { type: "external" },
      });
    } catch (sourceError) {
      setError(sourceError instanceof Error ? sourceError.message : "内容来源校验失败");
      return;
    }
    if (!title.trim()) { setError("请填写视频标题"); return; }
    const hasAnyMetric = Object.values(m).some(v => Number(v) > 0);
    if (!hasAnyMetric) { setError("请至少填写一项数据指标（播放量/点赞等）"); return; }

    const requestSequence = analysisRequestSequence.current + 1;
    analysisRequestSequence.current = requestSequence;
    setLoading(true); setError(null); setResult(null); setSavedId(null);

    // Layer4：历史均值由代码算，不传给AI让它乱猜
    const history = getLearningEligibleVideoReviews(activeIP.id).filter(r => r.analysis?.layer1);
    const avg = (key: keyof ReviewMetrics) => {
      const vals = history.map(r => r.metrics[key]).filter(v => v > 0);
      return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };
    const historicalAvg = {
      count: history.length,
      views: avg("views"), likes: avg("likes"), comments: avg("comments"), favorites: avg("favorites"),
    };

    const knowledgeContext = getKnowledgeEntries("爆款案例").slice(0, 10).map(e => ({ id: e.id, title: e.title, category: e.category }));

    try {
      const res = await apiFetch("/api/review/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, platform, contentDirection, scriptText: scriptText.trim(),
          metrics: { views: n("views"), likes: n("likes"), comments: n("comments"), favorites: n("favorites"), shares: n("shares"), newFollowers: n("newFollowers"), dms: n("dms"), leads: n("leads"), conversions: n("conversions") },
          historicalAvg,
          ipContext: activeIP ? { name: activeIP.name, positioning: activeIP.positioning, contentDirection: activeIP.contentDirection } : null,
          knowledgeContext,
        }),
      });
      const data = await res.json();
      if (analysisRequestSequence.current !== requestSequence) return;
      if (!res.ok) { setError(data.error ?? `请求失败（${res.status}）`); return; }
      if (getActiveIPId() !== activeIP.id) {
        setError("当前操盘IP刚刚发生变化，请确认后重新分析。");
        return;
      }

      const analysis: VideoReview["analysis"] = {
        layer1: data.layer1, layer2: data.layer2, layer3: data.layer3,
        layer4: data.layer4, layer5: data.layer5, layer6: data.layer6,
      };
      const saved = addVideoReviewForSource({
        activeIPId: activeIP.id,
        source: reviewSource === "flowpilot"
          ? { type: "flowpilot", scriptId: selectedScriptId }
          : { type: "external" },
        review: {
          title, platform, publishedAt, videoUrl, contentDirection, scriptText,
          metrics: { views: n("views"), likes: n("likes"), comments: n("comments"), favorites: n("favorites"), shares: n("shares"), newFollowers: n("newFollowers"), dms: n("dms"), leads: n("leads"), conversions: n("conversions") },
          analysis,
        },
      });
      setSavedId(saved.id);
      setResult(analysis);
      onSaved();
    } catch (err) {
      if (analysisRequestSequence.current !== requestSequence) return;
      const message = err instanceof Error ? err.message : "分析失败，请重试";
      setError(
        reviewSource === "flowpilot" && err instanceof VideoReviewSourceInvalidError
          ? "来源已失效，本次分析结果无法保存"
          : message,
      );
    } finally {
      if (analysisRequestSequence.current === requestSequence) setLoading(false);
    }
  }

  function handleSaveToKB() {
    if (!savedId || !result || !activeIP) return;
    const eligibleReview = getLearningEligibleVideoReviews(activeIP.id)
      .find(review => review.id === savedId);
    if (!eligibleReview) {
      setError("只有来源完整、可追溯的复盘才能存入复盘经验库");
      return;
    }
    const content = [
      `【视频标题】${title}`,
      `【内容方向】${contentDirection}`,
      result.layer5.successPatterns.length > 0 ? `【成功经验】${result.layer5.successPatterns.join("；")}` : "",
      result.layer5.failurePatterns.length > 0 ? `【失败经验】${result.layer5.failurePatterns.join("；")}` : "",
      result.layer5.reusableFormulas.length > 0 ? `【可复用公式】${result.layer5.reusableFormulas.join("；")}` : "",
    ].filter(Boolean).join("\n");

    try {
      saveReviewExperienceToKnowledge(savedId, {
        category: "复盘经验库", title: `复盘经验：${title.slice(0, 20)}`,
        rawContent: content, tags: [contentDirection, platform, result.layer1.performanceType],
        keywords: [result.layer1.grade + "级", result.layer1.performanceType],
        ipId: activeIP?.id ?? null, sourceTier: "高",
        sourceTierReason: "来自真实发布视频的数据复盘，有具体指标支撑",
        contentDirection: [contentDirection], sourcePlatform: platform, sourceUrl: videoUrl,
        note: "", extractedAt: new Date().toISOString(),
        metrics: null, viralEvaluation: null, usageRecords: [], status: "未使用", dna: null,
      });
      setSavedId(null);
      setError(null);
      alert("经验已存入知识库「方法论」分类");
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "经验保存失败，请稍后重试");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="mb-1 text-[13px] font-bold text-[#1C1C1B]">内容来源 *</div>
        <p className="mb-3 text-[11.5px] text-[#999]">来源完整的内部内容可以追溯到原选题；外部内容仍可复盘，但不会进入学习依据。</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {([
            ["flowpilot", "FlowPilot内部内容"],
            ["external", "外部或临时内容"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setReviewSource(value)}
              className="rounded-full px-3.5 py-1.5 text-[12px] font-semibold"
              style={reviewSource === value
                ? { background: "#1C1C1B", color: "#fff" }
                : { background: "#F2F1ED", color: "#666" }}
            >
              {label}
            </button>
          ))}
        </div>
        {reviewSource === "flowpilot" ? (
          <div>
            <label htmlFor="review-script-source" className="mb-1 block text-[11.5px] text-[#888]">选择已发布脚本</label>
            <select
              id="review-script-source"
              value={selectedScriptId}
              onChange={event => setSelectedScriptId(event.target.value)}
              className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13px]"
            >
              <option value="">请选择当前IP的脚本</option>
              {availableScripts.map(script => (
                <option key={script.id} value={script.id}>{script.title}</option>
              ))}
            </select>
            {availableScripts.length === 0 && (
              <p className="mt-2 text-[11.5px] text-[#A32D2D]">当前IP还没有可选择的脚本；如需复盘其他内容，请选择“外部或临时内容”。</p>
            )}
          </div>
        ) : (
          <p className="rounded-[10px] bg-[#FBF3D6] px-3 py-2 text-[11.5px] text-[#7A5C00]">这条复盘会保留，但由于内容来源不可追溯，暂不计入知识使用统计。</p>
        )}
      </Card>
      <Card>
        <div className="mb-3 text-[13px] font-bold text-[#1C1C1B]">视频基础信息</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[11.5px] text-[#888]">视频标题 *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="填写发布的标题" className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13.5px]" />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] text-[#888]">平台</label>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map(p => <button key={p} onClick={() => setPlatform(p)} className="rounded-full px-3 py-1 text-[12px] font-semibold" style={platform === p ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}>{p}</button>)}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] text-[#888]">内容方向</label>
            <div className="flex flex-wrap gap-1.5">
              {DIRECTIONS.map(d => <button key={d} onClick={() => setContentDirection(d)} className="rounded-full px-3 py-1 text-[12px] font-semibold" style={contentDirection === d ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}>{d}</button>)}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] text-[#888]">发布时间</label>
            <input type="date" value={publishedAt} onChange={e => setPublishedAt(e.target.value)} className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13px]" />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] text-[#888]">视频链接（可选）</label>
            <input value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="仅作引用记录，不自动抓取" className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13px]" />
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-1 text-[13px] font-bold text-[#1C1C1B]">真实数据 *</div>
        <p className="mb-3 text-[11.5px] text-[#999]">全部手动填写，系统不会自动抓取平台数据。填多少分析多少，没有的可以不填。</p>
        <div className="mb-3">
          <button onClick={() => setShowXlsx(v => !v)}
            className="flex items-center gap-1.5 rounded-full bg-[#EAF3DE] px-3.5 py-1.5 text-[12px] font-semibold text-[#3B6D11]">
            📊 从 Excel 导入数据
          </button>
        </div>
        {showXlsx && (
          <div className="mb-3">
            <XlsxUploadPanel mode="review" onImport={handleXlsxImport} onClose={() => setShowXlsx(false)} />
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          <MetricInput label="播放量" value={m.views} onChange={v => setM(p => ({ ...p, views: v }))} />
          <MetricInput label="点赞" value={m.likes} onChange={v => setM(p => ({ ...p, likes: v }))} />
          <MetricInput label="评论" value={m.comments} onChange={v => setM(p => ({ ...p, comments: v }))} />
          <MetricInput label="收藏" value={m.favorites} onChange={v => setM(p => ({ ...p, favorites: v }))} />
          <MetricInput label="转发" value={m.shares} onChange={v => setM(p => ({ ...p, shares: v }))} />
          <MetricInput label="涨粉" value={m.newFollowers} onChange={v => setM(p => ({ ...p, newFollowers: v }))} />
          <MetricInput label="私信" value={m.dms} onChange={v => setM(p => ({ ...p, dms: v }))} />
          <MetricInput label="线索" value={m.leads} onChange={v => setM(p => ({ ...p, leads: v }))} />
          <MetricInput label="成交" value={m.conversions} onChange={v => setM(p => ({ ...p, conversions: v }))} />
        </div>
      </Card>

      <Card>
        <div className="mb-1 text-[13px] font-bold text-[#1C1C1B]">口播稿 / 逐字稿（可选，但强烈建议填写）</div>
        <p className="mb-3 text-[11.5px] text-[#999]">内容结构拆解（Layer3）必须有完整文本作为依据。没有文本时该层分析会跳过，不会靠标题猜结构。</p>
        <textarea value={scriptText} onChange={e => setScriptText(e.target.value)} placeholder="粘贴口播稿或逐字稿…（没有的话留空，结构分析层会注明无法完成）" rows={6}
          className="w-full resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[13.5px] leading-6 outline-none focus:border-[#639922]" />
      </Card>

      {error && <div className="rounded-[10px] bg-[#FCEBEB] px-4 py-3 text-[13px] text-[#A32D2D]">{error}</div>}

      <div className="flex justify-end">
        <button onClick={handleAnalyze} disabled={loading} className="flex h-[44px] items-center gap-2 rounded-[12px] bg-[#1C1C1B] px-8 text-[13.5px] font-semibold text-white disabled:opacity-40">
          {loading ? "生成中，请稍候，请勿重复点击（最长约2分钟）…" : "开始六层复盘分析"}
        </button>
      </div>

      {result && (
        <div className="flex flex-col gap-4">
          {/* Layer1 */}
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-bold text-[#1C1C1B]">第一层 · 数据结果</span>
              <GradeBadge grade={result.layer1.grade} />
              <span className="rounded-full bg-[#F2F1ED] px-2.5 py-1 text-[11px] font-semibold text-[#555]">{result.layer1.performanceType}</span>
            </div>
            <p className="mb-3 text-[12px] leading-5 text-[#666]">{result.layer1.scoringBasis}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {result.layer1.highlights.length > 0 && (
                <div className="rounded-[10px] bg-[#EAF3DE] p-3">
                  <div className="mb-1 text-[11px] font-bold text-[#3B6D11]">数据亮点</div>
                  {result.layer1.highlights.map((h, i) => <p key={i} className="text-[12px] leading-5 text-[#3B6D11]">· {h}</p>)}
                </div>
              )}
              {result.layer1.weaknesses.length > 0 && (
                <div className="rounded-[10px] bg-[#FCEBEB] p-3">
                  <div className="mb-1 text-[11px] font-bold text-[#A32D2D]">数据短板</div>
                  {result.layer1.weaknesses.map((w, i) => <p key={i} className="text-[12px] leading-5 text-[#A32D2D]">· {w}</p>)}
                </div>
              )}
            </div>
          </Card>

          {/* Layer2 */}
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-bold text-[#1C1C1B]">第二层 · 爆款原因分析</span>
              <ConfidenceBadge tier={result.layer2.confidenceTier} />
              <span className="text-[12px] text-[#888]">{result.layer2.hasViralPotential ? "具备爆款潜力" : "暂未显示爆款潜力"}</span>
            </div>
            <p className="mb-2 text-[12.5px] leading-6 text-[#333]">{result.layer2.reasoning}</p>
            {result.layer2.dataEvidence && <div className="rounded-[10px] bg-[#F7F6F2] p-2.5 text-[12px] text-[#555]">数据依据：{result.layer2.dataEvidence}</div>}
            {result.layer2.structureEvidence && <div className="mt-1.5 rounded-[10px] bg-[#F7F6F2] p-2.5 text-[12px] text-[#555]">结构依据：{result.layer2.structureEvidence}</div>}
            {result.layer2.knowledgeEvidence && <div className="mt-1.5 rounded-[10px] bg-[#F7F6F2] p-2.5 text-[12px] text-[#555]">知识库引用：{result.layer2.knowledgeEvidence}</div>}
          </Card>

          {/* Layer3 */}
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-bold text-[#1C1C1B]">第三层 · 内容结构拆解</span>
              {!result.layer3.hasScriptText && <span className="rounded-full bg-[#FBF3D6] px-2 py-0.5 text-[10.5px] font-semibold text-[#7A5C00]">无文本，跳过结构分析</span>}
            </div>
            {!result.layer3.hasScriptText
              ? <p className="text-[12.5px] text-[#888]">{result.layer3.noScriptReason}</p>
              : (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {([["标题", result.layer3.titleAnalysis], ["开头钩子", result.layer3.hookAnalysis], ["中段价值", result.layer3.middleAnalysis], ["结尾转化", result.layer3.endingAnalysis]] as [string, typeof result.layer3.titleAnalysis][]).map(([label, item]) => (
                    <div key={label} className="rounded-[10px] bg-[#F7F6F2] p-3">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[12px] font-bold text-[#1C1C1B]">{label}</span>
                        <span className="text-[14px] font-bold text-[#639922]">{item.score}/10</span>
                      </div>
                      <p className="text-[12px] leading-5 text-[#555]">{item.feedback}</p>
                      {item.suggestion && <p className="mt-1 text-[11.5px] text-[#888]">建议：{item.suggestion}</p>}
                    </div>
                  ))}
                </div>
              )}
          </Card>

          {/* Layer4 */}
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-bold text-[#1C1C1B]">第四层 · 历史对比</span>
              {!result.layer4.hasHistoricalData && <span className="rounded-full bg-[#FBF3D6] px-2 py-0.5 text-[10.5px] font-semibold text-[#7A5C00]">历史数据不足</span>}
            </div>
            {!result.layer4.hasHistoricalData
              ? <p className="text-[12.5px] text-[#888]">{result.layer4.noHistoryReason}</p>
              : (
                <div className="flex flex-col gap-2">
                  {result.layer4.betterMetrics.length > 0 && (
                    <div className="rounded-[10px] bg-[#EAF3DE] p-3">
                      <div className="mb-1 text-[11px] font-bold text-[#3B6D11]">优于历史均值</div>
                      {result.layer4.betterMetrics.map((m, i) => <p key={i} className="text-[12px] text-[#3B6D11]">· {m}</p>)}
                    </div>
                  )}
                  {result.layer4.worseMetrics.length > 0 && (
                    <div className="rounded-[10px] bg-[#FCEBEB] p-3">
                      <div className="mb-1 text-[11px] font-bold text-[#A32D2D]">低于历史均值</div>
                      {result.layer4.worseMetrics.map((m, i) => <p key={i} className="text-[12px] text-[#A32D2D]">· {m}</p>)}
                    </div>
                  )}
                  {result.layer4.changeReason && <p className="text-[12px] text-[#888]">原因推测（AI）：{result.layer4.changeReason}</p>}
                </div>
              )}
          </Card>

          {/* Layer5 */}
          <Card>
            <div className="mb-3 text-[13px] font-bold text-[#1C1C1B]">第五层 · 经验沉淀</div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {result.layer5.successPatterns.length > 0 && (
                <div className="rounded-[10px] bg-[#EAF3DE] p-3">
                  <div className="mb-1.5 text-[11px] font-bold text-[#3B6D11]">成功经验</div>
                  {result.layer5.successPatterns.map((p, i) => <p key={i} className="text-[12px] leading-5 text-[#3B6D11]">· {p}</p>)}
                </div>
              )}
              {result.layer5.reusableFormulas.length > 0 && (
                <div className="rounded-[10px] bg-[#DCEFFA] p-3">
                  <div className="mb-1.5 text-[11px] font-bold text-[#1A5276]">可复用公式</div>
                  {result.layer5.reusableFormulas.map((f, i) => <p key={i} className="text-[12px] leading-5 text-[#1A5276]">· {f}</p>)}
                </div>
              )}
            </div>
            {savedId && activeIP && getLearningEligibleVideoReviews(activeIP.id).some(review => review.id === savedId) && (
              <div className="mt-3 flex justify-end">
                <button onClick={handleSaveToKB} className="rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white">存入复盘经验库</button>
              </div>
            )}
          </Card>

          {/* Layer6 */}
          <Card>
            <div className="mb-3 text-[13px] font-bold text-[#1C1C1B]">第六层 · 下一条内容建议</div>
            <div className="flex flex-col gap-3">
              {result.layer6.continueSuggestions.length > 0 && (
                <div><div className="mb-1 text-[11.5px] font-bold text-[#3B6D11]">建议继续做</div>
                  {result.layer6.continueSuggestions.map((s, i) => <p key={i} className="text-[12.5px] leading-5 text-[#444]">· {s}</p>)}</div>
              )}
              {result.layer6.optimizeSuggestions.length > 0 && (
                <div><div className="mb-1 text-[11.5px] font-bold text-[#7A5C00]">建议优化</div>
                  {result.layer6.optimizeSuggestions.map((s, i) => <p key={i} className="text-[12.5px] leading-5 text-[#444]">· {s}</p>)}</div>
              )}
              {result.layer6.recommendedTopics.length > 0 && (
                <div><div className="mb-1 text-[11.5px] font-bold text-[#555]">推荐选题</div>
                  <div className="flex flex-wrap gap-1.5">{result.layer6.recommendedTopics.map((t, i) => <span key={i} className="rounded-full bg-[#F2F1ED] px-2.5 py-1 text-[12px] text-[#444]">{t}</span>)}</div>
                </div>
              )}
              {result.layer6.recommendedTitles.length > 0 && (
                <div><div className="mb-1 text-[11.5px] font-bold text-[#555]">推荐标题</div>
                  {result.layer6.recommendedTitles.map((t, i) => <p key={i} className="text-[12.5px] leading-5 text-[#444]">· {t}</p>)}</div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ════════════════════ Tab2 复盘记录 ════════════════════
function HistoryTab() {
  const { activeIP } = useIP();
  const [reviews, setReviews] = useState<VideoReview[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setReviews(getVideoReviews(activeIP?.id));
    setDeleteError(null);
  }, [activeIP]);

  function handleDeleteReview(id: string) {
    try {
      deleteVideoReview(id);
      setDeleteError(null);
      setReviews(getVideoReviews(activeIP?.id));
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "复盘删除失败");
    }
  }

  if (reviews.length === 0) {
    return <Card><p className="py-8 text-center text-[13px] text-[#999]">还没有复盘记录，去「新建复盘」完成第一次分析。</p></Card>;
  }

  return (
    <div className="flex flex-col gap-3">
      {deleteError && (
        <div className="rounded-[10px] bg-[#FDECEC] px-3 py-2 text-[12px] text-[#A32D2D]">
          {deleteError}
        </div>
      )}
      {reviews.map(r => {
        const knowledgeEffect = getVideoReviewKnowledgeEffect(r);
        const knowledgeEffectLabel = knowledgeEffect.status === "tracked"
          ? `关联知识${knowledgeEffect.knowledgeEntries.length}条`
          : knowledgeEffect.status === "tracked_status_pending"
            ? `关联知识${knowledgeEffect.knowledgeEntries.length}条（状态同步待重试）`
          : knowledgeEffect.reason === "knowledge_unavailable"
            ? "知识关联暂不可用"
            : "暂不计入知识使用统计";
        return (
        <Card key={r.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {r.analysis?.layer1 && <GradeBadge grade={r.analysis.layer1.grade} />}
              <span className="text-[13px] font-semibold text-[#1C1C1B]">{r.title}</span>
              <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10.5px] text-[#666]">
                {VIDEO_REVIEW_TRACEABILITY_LABELS[assessVideoReviewTraceability(r)]}
              </span>
              <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10.5px] text-[#666]">
                {knowledgeEffectLabel}
              </span>
              {r.savedToKnowledge && <span className="text-[10.5px] text-[#3B6D11]">已入库</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setExpanded(expanded === r.id ? null : r.id)} className="text-[12px] text-[#639922]">{expanded === r.id ? "收起" : "展开"}</button>
              <button aria-label="删除复盘" onClick={() => handleDeleteReview(r.id)} className="text-[#999] hover:text-[#A32D2D]"><Icon name="trash" size="sm" /></button>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-[11.5px] text-[#999]">
            <span>{r.platform}</span><span>·</span><span>{r.contentDirection}</span><span>·</span><span>{r.publishedAt}</span>
            <span>·</span><span>播放{r.metrics.views.toLocaleString()}</span><span>·</span><span>点赞{r.metrics.likes.toLocaleString()}</span>
          </div>

          {expanded === r.id && r.analysis && (
            <div className="mt-4 flex flex-col gap-2.5 border-t border-[#F0EFE9] pt-4">
              <div className="text-[12px] leading-5 text-[#666]">{r.analysis.layer1.scoringBasis}</div>
              {knowledgeEffect.status === "tracked" ? (
                <div className="rounded-[10px] bg-[#F7F6F2] p-3">
                  <div className="mb-1 text-[11px] font-bold text-[#555]">本次脚本使用的知识（{knowledgeEffect.knowledgeEntries.length}条）</div>
                  {knowledgeEffect.knowledgeEntries.map(entry => (
                    <p key={entry.id} className="text-[12px] leading-5 text-[#555]">· {entry.title}</p>
                  ))}
                </div>
              ) : (
                <div className="rounded-[10px] bg-[#FBF3D6] p-3 text-[12px] text-[#7A5C00]">{knowledgeEffectLabel}</div>
              )}
              {r.analysis.layer6.recommendedTopics.length > 0 && (
                <div><div className="mb-1 text-[11px] font-bold text-[#888]">推荐下一条选题</div>
                  <div className="flex flex-wrap gap-1.5">{r.analysis.layer6.recommendedTopics.map((t, i) => <span key={i} className="rounded-full bg-[#F2F1ED] px-2.5 py-1 text-[12px] text-[#444]">{t}</span>)}</div>
                </div>
              )}
            </div>
          )}
        </Card>
        );
      })}
    </div>
  );
}

// ════════════════════ Tab3 经验库 ════════════════════
function ExperienceTab() {
  const entries = getKnowledgeEntries("方法论").filter(e => e.title.startsWith("复盘经验："));

  if (entries.length === 0) {
    return <Card><p className="py-8 text-center text-[13px] text-[#999]">还没有从复盘中沉淀出经验。完成分析后，在第五层点「存入知识库」即可。</p></Card>;
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.map(e => (
        <Card key={e.id}>
          <div className="mb-1.5 text-[13px] font-semibold text-[#1C1C1B]">{e.title.replace("复盘经验：", "")}</div>
          <div className="flex flex-wrap gap-1.5 mb-2">{e.tags.map((t, i) => <span key={i} className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10.5px] text-[#666]">#{t}</span>)}</div>
          <p className="whitespace-pre-line text-[12px] leading-6 text-[#555]">{e.rawContent}</p>
        </Card>
      ))}
    </div>
  );
}

// ════════════════════ Main ════════════════════
export default function ReviewPage() {
  const [tab, setTab] = useState<TabId>("new");
  const [historyKey, setHistoryKey] = useState(0);

  return (
    <div className="min-h-screen p-6 md:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[13px] text-[#8A8A86]">
            <a href="/" className="font-semibold text-[#639922]">工作台</a> / 发布复盘
          </div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1B]">发布复盘</h1>
          <p className="mt-1.5 max-w-[600px] text-[13.5px] leading-6 text-[#8A8A86]">
            内容增长分析中心。数据复盘 → 原因分析 → 结构拆解 → 经验沉淀 → 下一条建议
          </p>
        </div>
        <span className="whitespace-nowrap rounded-full bg-[#E9E6F7] px-3.5 py-1.5 text-[12px] font-semibold text-[#5B3FA0]">07 · 复盘</span>
      </header>

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className="rounded-[12px] px-4 py-2.5 text-[13px] font-semibold"
            style={tab === t.id ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "new" && <NewReviewTab onSaved={() => setHistoryKey(k => k + 1)} />}
      {tab === "history" && <HistoryTab key={historyKey} />}
      {tab === "experience" && <ExperienceTab key={historyKey} />}
    </div>
  );
}
