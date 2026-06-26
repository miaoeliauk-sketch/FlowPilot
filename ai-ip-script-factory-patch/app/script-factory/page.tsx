"use client";
import { useState, useEffect } from "react";
import { useIP } from "@/lib/ip-context";
import { addScriptAsset } from "@/lib/ip-store";
import { IPProfile } from "@/lib/types";
import { buildIPContextBlock } from "@/lib/ip-prompt";

// ── Types ──
interface TitleOption { title: string; formula: string; platform: string; whyFitsIP: string; }
interface KeywordReply { keyword: string; reply: string; }
interface CommentGuidance { interactionPrompt: string; keywordReplies: KeywordReply[]; dmGuidance: string; materialPackGuidance: string; }
interface VoiceoverScript { hook: string; painPoint: string; core: string; summary: string; cta: string; }
interface StoryboardRow { time: string; scene: string; voiceover: string; subtitle: string; shot: string; material: string; editingTip: string; }
interface ShotPrompt { scene: string; prompt: string; }
interface EditingRhythm { subtitleHighlights: string[]; soundEffects: string[]; screenRecordingCuts: string[]; caseInserts: string[]; pauses: string[]; }
interface ScriptResult {
  ipId: string; ipName: string; topic: string; platform: string; durationSeconds: number; goal: string; videoType: string;
  titles: TitleOption[]; coverCopy: string[]; voiceover: VoiceoverScript; commentGuidance: CommentGuidance;
  storyboard: StoryboardRow[]; shootingSuggestions: string[]; shotPrompts: ShotPrompt[]; editingRhythm: EditingRhythm;
}

const PLATFORM_OPTIONS = ["抖音", "小红书", "B站", "视频号"];
const DURATION_OPTIONS = [
  { label: "30秒", value: 30 }, { label: "60秒", value: 60 }, { label: "90秒", value: 90 }, { label: "3分钟", value: 180 },
];
const GOAL_OPTIONS = ["涨粉", "引流", "转化", "建立信任", "教学"];
const VIDEO_TYPE_OPTIONS = ["口播", "教程", "案例拆解", "观点输出", "工具演示", "剧情"];

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[14px] border border-[#E5E4DE] bg-white p-5 ${className}`}>{children}</div>;
}

function SectionHead({ num, children }: { num: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1C1C1B] text-[11px] font-bold text-white">{num}</span>
      <h3 className="text-[14.5px] font-bold text-[#1C1C1B]">{children}</h3>
    </div>
  );
}

function IPContextModal({ ip, onClose }: { ip: IPProfile; onClose: () => void }) {
  const block = buildIPContextBlock(ip);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-[620px] overflow-y-auto rounded-[18px] bg-white p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-[#1C1C1B]">
          <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: ip.color }}>{ip.avatar}</span>
          「{ip.name}」当前模块实际使用的IP上下文
        </div>
        <p className="mb-4 text-[12px] text-[#999]">
          下面这段文字会被原样拼接进发给DeepSeek的两次调用里（核心内容生成 + 分镜拍摄生成），和「IP身份中心」测试按钮里看到的完全一致。
        </p>
        <pre className="whitespace-pre-wrap rounded-[12px] bg-[#F7F6F2] p-4 text-[12px] leading-6 text-[#333]">{block}</pre>
        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[13px] font-semibold text-white">关闭</button>
        </div>
      </div>
    </div>
  );
}

// ── 结果展示（生成结果 / 对比测试都复用这个，compact控制详略） ──
function ResultView({ data, compact = false }: { data: ScriptResult; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-2 text-[12px] font-bold text-[#888]">视频标题（{data.titles.length}个）</div>
        <div className="flex flex-col gap-2">
          {data.titles.slice(0, compact ? 3 : undefined).map((t, i) => (
            <div key={i} className="rounded-[10px] bg-[#F7F6F2] p-3">
              <div className="text-[13.5px] font-semibold text-[#1C1C1B]">{t.title}</div>
              {!compact && (
                <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-[#888]">
                  <span className="rounded-full bg-[#EAF3DE] px-2 py-0.5 text-[#3B6D11]">{t.formula}</span>
                  <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5">{t.platform}</span>
                  <span>{t.whyFitsIP}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {!compact && (
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">封面文案</div>
          <div className="flex flex-wrap gap-2">
            {data.coverCopy.map((c, i) => <span key={i} className="rounded-[10px] bg-[#FBF3D6] px-3 py-2 text-[13px] font-semibold text-[#7A5C00]">{c}</span>)}
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 text-[12px] font-bold text-[#888]">口播逐字稿</div>
        <div className="flex flex-col gap-2">
          {[
            { label: "开头钩子", text: data.voiceover.hook },
            { label: "痛点共鸣", text: data.voiceover.painPoint },
            { label: "核心内容", text: data.voiceover.core },
            { label: "案例/总结", text: data.voiceover.summary },
            { label: "评论区引导", text: data.voiceover.cta },
          ].map((seg, i) => (
            <div key={i} className="rounded-[10px] border border-[#F0EFE9] p-3">
              <div className="mb-1 text-[11px] font-bold text-[#639922]">{seg.label}</div>
              <p className="text-[13px] leading-6 text-[#333]">{seg.text}</p>
            </div>
          ))}
        </div>
      </div>

      {!compact && data.storyboard.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">分镜脚本</div>
          <div className="overflow-x-auto rounded-[10px] border border-[#F0EFE9]">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-[#F7F6F2] text-left text-[#888]">
                  {["时间", "画面", "口播", "字幕", "镜头", "素材", "剪辑建议"].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.storyboard.map((row, i) => (
                  <tr key={i} className="border-t border-[#F0EFE9] align-top">
                    <td className="px-3 py-2 font-semibold text-[#1C1C1B]">{row.time}</td>
                    <td className="px-3 py-2">{row.scene}</td>
                    <td className="px-3 py-2 text-[#666]">{row.voiceover}</td>
                    <td className="px-3 py-2 text-[#666]">{row.subtitle}</td>
                    <td className="px-3 py-2">{row.shot}</td>
                    <td className="px-3 py-2 text-[#666]">{row.material}</td>
                    <td className="px-3 py-2 text-[#666]">{row.editingTip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!compact && data.shootingSuggestions.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">拍摄画面建议</div>
          <ul className="list-disc pl-5 text-[13px] leading-6 text-[#444]">
            {data.shootingSuggestions.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}

      {compact && data.shootingSuggestions.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">拍摄画面建议</div>
          <ul className="list-disc pl-5 text-[13px] leading-6 text-[#444]">
            {data.shootingSuggestions.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}

      {!compact && data.shotPrompts.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">镜头提示词</div>
          <div className="flex flex-col gap-2">
            {data.shotPrompts.map((s, i) => (
              <div key={i} className="rounded-[10px] bg-[#F7F6F2] p-3 text-[12.5px]">
                <span className="font-semibold text-[#1C1C1B]">{s.scene}：</span>
                <span className="text-[#666]">{s.prompt}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!compact && (
        data.editingRhythm.subtitleHighlights.length + data.editingRhythm.soundEffects.length +
        data.editingRhythm.screenRecordingCuts.length + data.editingRhythm.caseInserts.length + data.editingRhythm.pauses.length > 0
      ) && (
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">剪辑节奏建议</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              { label: "字幕放大", items: data.editingRhythm.subtitleHighlights },
              { label: "音效", items: data.editingRhythm.soundEffects },
              { label: "切录屏", items: data.editingRhythm.screenRecordingCuts },
              { label: "插入案例", items: data.editingRhythm.caseInserts },
              { label: "停顿", items: data.editingRhythm.pauses },
            ].filter(g => g.items.length > 0).map((g, i) => (
              <div key={i} className="rounded-[10px] bg-[#F7F6F2] p-3">
                <div className="mb-1 text-[11px] font-bold text-[#888]">{g.label}</div>
                <ul className="list-disc pl-4 text-[12.5px] leading-5 text-[#444]">
                  {g.items.map((it, j) => <li key={j}>{it}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 text-[12px] font-bold text-[#888]">评论区引导</div>
        <div className="flex flex-col gap-2 text-[13px] leading-6 text-[#444]">
          <div><span className="font-semibold text-[#1C1C1B]">互动引导：</span>{data.commentGuidance.interactionPrompt}</div>
          {!compact && data.commentGuidance.keywordReplies.map((kr, i) => (
            <div key={i}><span className="font-semibold text-[#1C1C1B]">「{kr.keyword}」→</span>{kr.reply}</div>
          ))}
          {!compact && <div><span className="font-semibold text-[#1C1C1B]">私信引导：</span>{data.commentGuidance.dmGuidance}</div>}
          <div><span className="font-semibold text-[#1C1C1B]">资料包/下一步引导：</span>{data.commentGuidance.materialPackGuidance}</div>
        </div>
      </div>
    </div>
  );
}

export default function ScriptFactoryPage() {
  const { activeIP, ips, loading: ipLoading } = useIP();
  const [topic, setTopic] = useState("AI小白如何用ChatGPT做副业");
  const [platform, setPlatform] = useState("抖音");
  const [duration, setDuration] = useState(60);
  const [goal, setGoal] = useState("建立信任");
  const [videoType, setVideoType] = useState("口播");
  const [needsStoryboard, setNeedsStoryboard] = useState(true);
  const [needsShootingTips, setNeedsShootingTips] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [showContext, setShowContext] = useState(false);

  useEffect(() => {
    if (activeIP && activeIP.platforms.length > 0 && !activeIP.platforms.includes(platform)) {
      setPlatform(activeIP.platforms[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIP?.id]);

  // ── 验收测试：同一选题，两个IP对比 ──
  const [compareTopic, setCompareTopic] = useState("Claude Code是什么");
  const [compareAId, setCompareAId] = useState("");
  const [compareBId, setCompareBId] = useState("");
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareResults, setCompareResults] = useState<{ ip: IPProfile; data: ScriptResult }[] | null>(null);

  useEffect(() => {
    if (ips.length >= 2 && !compareAId && !compareBId) {
      setCompareAId(ips[0].id);
      setCompareBId(ips[1].id);
    }
  }, [ips, compareAId, compareBId]);

  async function generateFor(ip: IPProfile, t: string) {
    const res = await fetch("/api/script-factory", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ipProfile: ip, topic: t,
        platform: ip.platforms[0] || "抖音",
        durationSeconds: 60, goal: "建立信任", videoType: "口播",
        needsStoryboard: true, needsShootingTips: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ? `${ip.name}：${data.error}` : `${ip.name} 请求失败`);
    return data as ScriptResult;
  }

  async function handleGenerate() {
    if (!topic.trim()) { setError("请输入视频选题"); return; }
    if (!activeIP) { setError("请先在「IP身份中心」选择一个当前操盘IP"); return; }
    setError(null); setResult(null); setLoading(true);
    try {
      const res = await fetch("/api/script-factory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ipProfile: activeIP, topic, platform, durationSeconds: duration, goal, videoType,
          needsStoryboard, needsShootingTips,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `请求失败（${res.status}）`);
      setResult(data as ScriptResult);
      addScriptAsset({
        ipId: activeIP.id,
        title: data.titles?.[0]?.title || topic,
        cover: data.coverCopy?.[0] || "",
        content: [data.voiceover?.hook, data.voiceover?.painPoint, data.voiceover?.core, data.voiceover?.summary, data.voiceover?.cta].filter(Boolean).join("\n\n"),
        status: "草稿",
        scriptResult: data,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "脚本生成失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  async function runCompare() {
    const ipA = ips.find(i => i.id === compareAId);
    const ipB = ips.find(i => i.id === compareBId);
    if (!compareTopic.trim()) { setCompareError("请输入测试选题"); return; }
    if (!ipA || !ipB) { setCompareError("请选择两个IP"); return; }
    if (ipA.id === ipB.id) { setCompareError("请选择两个不同的IP才能对比"); return; }
    setCompareError(null); setCompareLoading(true); setCompareResults(null);
    try {
      const [a, b] = await Promise.all([ipA, ipB].map(async (ip) => ({ ip, data: await generateFor(ip, compareTopic) })));
      setCompareResults([a, b]);
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : "对比测试失败，请重试");
    } finally {
      setCompareLoading(false);
    }
  }

  return (
    <div className="min-h-screen p-6 md:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[13px] text-[#8A8A86]">
            <a href="/" className="font-semibold text-[#639922]">工作台</a> / AI IP脚本工厂
          </div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1B]">AI IP脚本工厂</h1>
          <p className="mt-1.5 max-w-[640px] text-[13.5px] leading-6 text-[#8A8A86]">
            当前IP是谁，生成出来的脚本就应该像谁——标题、封面、口播逐字稿、分镜、拍摄建议、剪辑节奏、评论区引导，一次性生成，全部代入当前IP的人设与表达风格。
          </p>
        </div>
        <span className="whitespace-nowrap rounded-full bg-[#EAF3DE] px-3.5 py-1.5 text-[12px] font-semibold text-[#3B6D11]">02 · 脚本生成</span>
      </header>

      {!ipLoading && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[14px] bg-[#FBF3D6] px-4 py-2.5 text-[13px] text-[#7A5C00]">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: activeIP?.color ?? "#999" }}>
              {activeIP?.avatar ?? "?"}
            </span>
            当前以 <b>{activeIP?.name ?? "未选择IP"}</b> 的人设、受众、表达风格与拍摄习惯生成脚本。
          </div>
          <button onClick={() => setShowContext(true)} disabled={!activeIP} className="whitespace-nowrap rounded-[10px] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#7A5C00] disabled:opacity-50">
            查看当前IP上下文
          </button>
        </div>
      )}
      {showContext && activeIP && <IPContextModal ip={activeIP} onClose={() => setShowContext(false)} />}

      {/* IP差异化验收测试 */}
      <div className="mb-6 rounded-[20px] border-2 border-dashed border-[#C8F04A] bg-[#FBFEF2] p-5">
        <div className="mb-3">
          <div className="text-[14px] font-bold text-[#1C1C1B]">IP差异化验收测试</div>
          <p className="mt-0.5 text-[12px] text-[#888]">用同一个选题，分别套用两个不同IP的身份各生成一套完整脚本，对比标题/口播稿/受众视角/结尾引导/拍摄建议是否明显不同。</p>
        </div>
        {ips.length < 2 ? (
          <div className="rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">需要至少2个IP身份才能运行对比测试，请先在「IP身份中心」创建。</div>
        ) : (
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">测试选题</label>
              <input value={compareTopic} onChange={e => setCompareTopic(e.target.value)} className="w-full rounded-[10px] border border-[#E5E4DE] bg-white px-3 py-2 text-[13px] outline-none focus:border-[#639922]" />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">IP A</label>
              <select value={compareAId} onChange={e => setCompareAId(e.target.value)} className="rounded-[10px] border border-[#E5E4DE] bg-white px-3 py-2 text-[13px]">
                {ips.map(ip => <option key={ip.id} value={ip.id}>{ip.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">IP B</label>
              <select value={compareBId} onChange={e => setCompareBId(e.target.value)} className="rounded-[10px] border border-[#E5E4DE] bg-white px-3 py-2 text-[13px]">
                {ips.map(ip => <option key={ip.id} value={ip.id}>{ip.name}</option>)}
              </select>
            </div>
            <button onClick={runCompare} disabled={compareLoading} className="h-[38px] rounded-[10px] px-5 text-[13px] font-bold disabled:opacity-50" style={{ background: "#C8F04A", color: "#1A1A1A" }}>
              {compareLoading ? "对比中…" : "运行对比测试"}
            </button>
          </div>
        )}
        {compareError && <div className="mt-3 rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{compareError}</div>}
        {compareLoading && <div className="mt-4 text-[12.5px] text-[#888]">正在分别用两个IP的身份各生成一套完整脚本（标题/口播稿/分镜/拍摄建议），大约需要1-2分钟…</div>}
        {compareResults && (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {compareResults.map(({ ip, data }) => (
              <div key={ip.id} className="rounded-[14px] border border-[#E5E4DE] bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: ip.color }}>{ip.avatar}</span>
                  <span className="text-[13.5px] font-bold text-[#1C1C1B]">{ip.name}</span>
                </div>
                <ResultView data={data} compact />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 主生成表单 */}
      <Card className="mb-6">
        <SectionHead num="①">输入视频选题与生成条件</SectionHead>
        <div className="flex flex-col gap-3">
          <textarea
            value={topic} onChange={e => setTopic(e.target.value)}
            placeholder="例如：AI小白如何用ChatGPT做副业"
            className="min-h-[52px] resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[14px] text-[#1C1C1B] outline-none focus:border-[#639922] focus:ring-2 focus:ring-[#EAF3DE]"
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">视频平台</label>
              <select value={platform} onChange={e => setPlatform(e.target.value)} className="w-full rounded-[10px] border border-[#E5E4DE] bg-white px-3 py-2 text-[13px]">
                {(activeIP?.platforms.length ? activeIP.platforms : PLATFORM_OPTIONS).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">视频时长</label>
              <select value={duration} onChange={e => setDuration(Number(e.target.value))} className="w-full rounded-[10px] border border-[#E5E4DE] bg-white px-3 py-2 text-[13px]">
                {DURATION_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">内容目标</label>
              <select value={goal} onChange={e => setGoal(e.target.value)} className="w-full rounded-[10px] border border-[#E5E4DE] bg-white px-3 py-2 text-[13px]">
                {GOAL_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">视频类型</label>
              <select value={videoType} onChange={e => setVideoType(e.target.value)} className="w-full rounded-[10px] border border-[#E5E4DE] bg-white px-3 py-2 text-[13px]">
                {VIDEO_TYPE_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-[12.5px] text-[#555]">
              <input type="checkbox" checked={needsStoryboard} onChange={e => setNeedsStoryboard(e.target.checked)} />需要分镜脚本
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-[#555]">
              <input type="checkbox" checked={needsShootingTips} onChange={e => setNeedsShootingTips(e.target.checked)} />需要拍摄提示
            </label>
            <button
              onClick={handleGenerate} disabled={loading}
              className="ml-auto flex h-[42px] items-center gap-2 whitespace-nowrap rounded-[12px] bg-[#1C1C1B] px-7 text-[13.5px] font-semibold text-white disabled:opacity-60"
            >
              {loading ? "生成中…" : "生成完整脚本"}
            </button>
          </div>
        </div>
      </Card>

      {error && <div className="mb-6 rounded-[14px] bg-[#FCEBEB] px-5 py-4 text-[14px] font-semibold text-[#A32D2D]">{error}</div>}
      {loading && (
        <div className="py-16 text-center text-[#8A8A86]">
          <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-4 border-[#EAF3DE] border-t-[#639922]" />
          <div className="text-[14px]">正在代入「{activeIP?.name}」的人设生成标题、口播稿、分镜与拍摄建议…</div>
        </div>
      )}

      {!loading && !result && !error && (
        <div className="py-16 text-center text-[#8A8A86]">
          <h3 className="mb-2 text-[17px] font-semibold text-[#1C1C1B]">还没有生成结果</h3>
          <p className="text-[13.5px]">输入选题后点击「生成完整脚本」，系统会读取当前操盘IP的全部身份信息生成专属内容。</p>
        </div>
      )}

      {!loading && result && (
        <Card>
          <SectionHead num="②">生成结果</SectionHead>
          <ResultView data={result} />
        </Card>
      )}
    </div>
  );
}
