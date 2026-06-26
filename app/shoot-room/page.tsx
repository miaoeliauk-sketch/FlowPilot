"use client";
import { useState, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api-fetch";
import BasicInfoForm from "@/components/shoot-room/BasicInfoForm";
import EquipmentForm from "@/components/shoot-room/EquipmentForm";
import VideoTaskCard from "@/components/shoot-room/VideoTaskCard";
import ShootResultPanel from "@/components/shoot-room/ShootResultPanel";
import { VideoTask, ShootRoomInput, ShootRoomResult } from "@/components/shoot-room/types";
import { CATEGORY_OPTIONS, DURATION_OPTIONS } from "@/components/shoot-room/constants";
import { Icon } from "@/components/ui/icon";
import { getKnowledgeEntries, recordKnowledgeUsage, getScriptAssets, addKnowledgeEntry } from "@/lib/ip-store";
import { KnowledgeEntry, ScriptAsset } from "@/lib/types";
import { useIP } from "@/lib/ip-context";

type ProductionMode = "real" | "digital" | "hybrid";

function genId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

// ────────────────────────────────────────────────────
// 通用子组件
// ────────────────────────────────────────────────────
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[20px] border border-[#EDECEA] bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)] ${className}`}>{children}</div>;
}

function ModeSelector({ mode, onChange }: { mode: ProductionMode; onChange: (m: ProductionMode) => void }) {
  const MODES: { id: ProductionMode; label: string; desc: string; icon: string }[] = [
    { id: "real", label: "真人拍摄", desc: "摄像机拍摄，人工执行", icon: "🎬" },
    { id: "digital", label: "数字人拍摄", desc: "AI克隆形象+声音自动生成", icon: "🤖" },
    { id: "hybrid", label: "混合模式", desc: "真人+数字人组合（架构预留）", icon: "⚡" },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {MODES.map(m => (
        <button key={m.id} onClick={() => onChange(m.id)}
          className="flex flex-col gap-1.5 rounded-[14px] border-2 p-4 text-left transition"
          style={{ borderColor: mode === m.id ? "#1C1C1B" : "#E5E4DE", background: mode === m.id ? "#1C1C1B" : "#fff" }}>
          <span className="text-[20px]">{m.icon}</span>
          <span className="text-[13.5px] font-bold" style={{ color: mode === m.id ? "#fff" : "#1C1C1B" }}>{m.label}</span>
          <span className="text-[11.5px]" style={{ color: mode === m.id ? "#aaa" : "#8A8A86" }}>{m.desc}</span>
        </button>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────
// 真人拍摄模式
// ────────────────────────────────────────────────────
interface KnowledgeRef { id: string; reason: string; relevanceTier: string; relevanceReason: string; entry: KnowledgeEntry }
const REL_COLOR: Record<string, { bg: string; text: string }> = {
  "高度相关": { bg: "#EAF3DE", text: "#3B6D11" },
  "中度相关": { bg: "#FBF3D6", text: "#7A5C00" },
  "低度相关": { bg: "#F2F1ED", text: "#888" },
};

function KnowledgePanel({ loading, refs, searched }: { loading: boolean; refs: KnowledgeRef[]; searched: boolean }) {
  if (!loading && !searched) return null;
  return (
    <Card>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-[13px] font-bold text-[#1C1C1B]">【参考方法论】</span>
        <span className="text-[11px] text-[#999]">从方法论库自动检索</span>
      </div>
      {loading && <p className="text-[12.5px] text-[#888]">检索中…</p>}
      {!loading && refs.length === 0 && <p className="text-[12.5px] text-[#999]">方法论库暂无强相关参考。</p>}
      {!loading && refs.map(r => (
        <div key={r.id} className="mb-2 rounded-[10px] bg-[#F7F6F2] p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span className="text-[12px] font-semibold text-[#1C1C1B]">{r.entry.title}</span>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ background: (REL_COLOR[r.relevanceTier] ?? REL_COLOR["低度相关"]).bg, color: (REL_COLOR[r.relevanceTier] ?? REL_COLOR["低度相关"]).text }}>
              {r.relevanceTier}
            </span>
          </div>
          <p className="mt-1 text-[11.5px] leading-5 text-[#555]">{r.reason}</p>
        </div>
      ))}
    </Card>
  );
}

function RealShootMode() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [availableTime, setAvailableTime] = useState<"2h" | "4h" | "full">("4h");
  const [location, setLocation] = useState("");
  const [soloShoot, setSoloShoot] = useState(true);
  const [hasPhotographer, setHasPhotographer] = useState(false);
  const [videos, setVideos] = useState<VideoTask[]>([createEmptyVideo()]);
  const [props, setProps] = useState(false);
  const [outfit, setOutfit] = useState(false);
  const [mic, setMic] = useState(false);
  const [lighting, setLighting] = useState(false);
  const [teleprompter, setTeleprompter] = useState(false);
  const [reshootNeeds, setReshootNeeds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShootRoomResult | null>(null);
  const [knowledgeRefs, setKnowledgeRefs] = useState<KnowledgeRef[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeSearched, setKnowledgeSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function createEmptyVideo(): VideoTask {
    return {
      id: genId(), name: "", category: CATEGORY_OPTIONS[0], duration: DURATION_OPTIONS[0],
      priority: "A", scriptStatus: "todo", titleReady: false,
      coverCopyReady: false, caseReady: false, dataReady: false, screenshotReady: false, scenes: [],
    };
  }

  const videoNamesQuery = videos.map(v => v.name).filter(Boolean).join(" ");

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (videoNamesQuery.trim().length < 4) { setKnowledgeSearched(false); setKnowledgeRefs([]); return; }
    debounceRef.current = setTimeout(() => searchKnowledge(videoNamesQuery), 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [videoNamesQuery]);

  async function searchKnowledge(query: string) {
    const allEntries = [...getKnowledgeEntries("方法论"), ...getKnowledgeEntries("复盘经验库")];
    if (allEntries.length === 0) { setKnowledgeSearched(true); setKnowledgeRefs([]); return; }
    setKnowledgeLoading(true); setKnowledgeSearched(true);
    try {
      const res = await apiFetch("/api/knowledge-search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, entries: allEntries.map(e => ({ id: e.id, category: e.category, title: e.title, tags: e.tags, keywords: e.keywords })) }),
      });
      const data = await res.json();
      if (!res.ok) { setKnowledgeRefs([]); return; }
      const entryMap = new Map(allEntries.map(e => [e.id, e]));
      const refs: KnowledgeRef[] = (data.results ?? [])
        .map((r: { id: string; reason: string; relevanceTier: string; relevanceReason: string }) => { const entry = entryMap.get(r.id); return entry ? { ...r, entry } : null; })
        .filter((r: KnowledgeRef | null): r is KnowledgeRef => r !== null);
      setKnowledgeRefs(refs);
      refs.forEach(r => recordKnowledgeUsage(r.id, { module: "拍摄作战室", usedAt: new Date().toISOString(), reason: r.reason, relevanceTier: r.relevanceTier as "高度相关" | "中度相关" | "低度相关", relevanceReason: r.relevanceReason, context: query }, "已用于分析"));
    } catch { setKnowledgeRefs([]); } finally { setKnowledgeLoading(false); }
  }

  async function handleSubmit() {
    if (videos.some(v => !v.name.trim())) { setError("每个视频任务都需要填写名称"); return; }
    const input: ShootRoomInput = { date, availableTime, location, soloShoot, hasPhotographer, videos, props, outfit, mic, lighting, teleprompter, reshootNeeds };
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await apiFetch("/api/shoot-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? `HTTP ${res.status}`);
      else setResult(data as ShootRoomResult);
    } catch (err) { setError(`网络错误：${err instanceof Error ? err.message : String(err)}`); }
    finally { setLoading(false); }
  }

  return (
    <div className="flex flex-col gap-5">
      <BasicInfoForm date={date} availableTime={availableTime} location={location} soloShoot={soloShoot} hasPhotographer={hasPhotographer}
        onChange={p => { if (p.date !== undefined) setDate(p.date); if (p.availableTime !== undefined) setAvailableTime(p.availableTime); if (p.location !== undefined) setLocation(p.location); if (p.soloShoot !== undefined) setSoloShoot(p.soloShoot); if (p.hasPhotographer !== undefined) setHasPhotographer(p.hasPhotographer); }} />
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-[#8A8A86]">今日视频任务</h3>
          <button onClick={() => setVideos(vs => [...vs, createEmptyVideo()])}
            className="flex items-center gap-1.5 rounded-[10px] bg-[#1C1C1B] px-3 py-1.5 text-[12px] font-semibold text-white">
            <Icon name="plus" size="sm" /> 添加视频
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {videos.map((v, i) => (
            <VideoTaskCard key={v.id} video={v} index={i}
              onChange={(id, patch) => setVideos(vs => vs.map(v => v.id === id ? { ...v, ...patch } : v))}
              onRemove={id => setVideos(vs => vs.length > 1 ? vs.filter(v => v.id !== id) : vs)}
              canRemove={videos.length > 1} />
          ))}
        </div>
      </div>
      <EquipmentForm props={props} outfit={outfit} mic={mic} lighting={lighting} teleprompter={teleprompter} reshootNeeds={reshootNeeds}
        onChange={p => { if (p.props !== undefined) setProps(p.props); if (p.outfit !== undefined) setOutfit(p.outfit); if (p.mic !== undefined) setMic(p.mic); if (p.lighting !== undefined) setLighting(p.lighting); if (p.teleprompter !== undefined) setTeleprompter(p.teleprompter); if (p.reshootNeeds !== undefined) setReshootNeeds(p.reshootNeeds); }} />
      {error && <div className="rounded-[12px] bg-[#FCEBEB] px-4 py-3 text-[13px] text-[#A32D2D]">{error}</div>}
      <KnowledgePanel loading={knowledgeLoading} refs={knowledgeRefs} searched={knowledgeSearched} />
      <button onClick={handleSubmit} disabled={loading}
        className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[16px] bg-[#1C1C1B] text-[14px] font-semibold text-white disabled:opacity-60 md:w-auto md:self-end md:px-10">
        {loading ? "计算中…" : "生成今日拍摄作战计划"}
      </button>
      {result && <Card><ShootResultPanel result={result} /></Card>}
    </div>
  );
}

// ────────────────────────────────────────────────────
// 数字人拍摄模式
// ────────────────────────────────────────────────────
function getHiflyKey(): string { return typeof window !== "undefined" ? (localStorage.getItem("ipwr:hiflyApiKey") ?? "") : ""; }
async function hiflyFetch(url: string, init?: RequestInit): Promise<Response> {
  const key = getHiflyKey();
  const headers = new Headers(init?.headers);
  if (key) headers.set("X-Hifly-Key", key);
  return fetch(url, { ...init, headers });
}

interface AvatarProfile { taskId: string; avatarId: string | null; status: number; statusLabel: string; title: string; type: "video" | "image" }
interface VoiceProfile { taskId: string; voiceId: string | null; status: number; statusLabel: string; title: string }
interface VideoTaskDH { taskId: string; status: number; statusLabel: string; videoUrl: string | null; coverUrl: string | null; script: string; title: string; createdAt: string }

const DH_STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  "等待中": { bg: "#FBF3D6", text: "#7A5C00" }, "处理中": { bg: "#DCEFFA", text: "#1A5276" },
  "完成": { bg: "#EAF3DE", text: "#3B6D11" }, "失败": { bg: "#FCEBEB", text: "#A32D2D" },
};
function DHStatusBadge({ label }: { label: string }) {
  const c = DH_STATUS_COLOR[label] ?? { bg: "#F2F1ED", text: "#888" };
  return <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: c.bg, color: c.text }}>{label}</span>;
}

function DigitalHumanMode() {
  const { activeIP } = useIP();
  const [error, setError] = useState<string | null>(null);
  const [hiflyKey] = useState(() => getHiflyKey());

  // Avatar
  const [avatarProfile, setAvatarProfile] = useState<AvatarProfile | null>(null);
  const [avatarInputType, setAvatarInputType] = useState<"video" | "image" | "existing">("video");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarId, setAvatarId] = useState("");
  const [avatarTitle, setAvatarTitle] = useState("");
  const [avatarLoading, setAvatarLoading] = useState(false);

  // Voice
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null);
  const [voiceAudioUrl, setVoiceAudioUrl] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [voiceTitle, setVoiceTitle] = useState("");
  const [voiceInputType, setVoiceInputType] = useState<"upload" | "existing">("upload");
  const [voiceLoading, setVoiceLoading] = useState(false);

  // Script
  const [scriptSource, setScriptSource] = useState<"select" | "paste">("paste");
  const [scriptText, setScriptText] = useState("");
  const [scripts, setScripts] = useState<ScriptAsset[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState("");

  // Video
  const [videoTitle, setVideoTitle] = useState("");
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoTasks, setVideoTasks] = useState<VideoTaskDH[]>([]);

  useEffect(() => {
    if (activeIP) {
      setScripts(getScriptAssets(activeIP.id));
      setAvatarTitle(`${activeIP.name}数字人`);
      setVoiceTitle(`${activeIP.name}声音`);
      setVideoTitle(`${activeIP.name}视频`);
    }
  }, [activeIP]);

  async function pollAvatar(taskId: string) {
    const res = await hiflyFetch(`/api/hifly/avatar?taskId=${taskId}`).catch(() => null);
    if (!res?.ok) return;
    const d = await res.json();
    setAvatarProfile(p => p ? { ...p, status: d.status, statusLabel: d.statusLabel, avatarId: d.avatarId } : null);
  }

  async function pollVoice(taskId: string) {
    const res = await hiflyFetch(`/api/hifly/voice?taskId=${taskId}`).catch(() => null);
    if (!res?.ok) return;
    const d = await res.json();
    setVoiceProfile(p => p ? { ...p, status: d.status, statusLabel: d.statusLabel, voiceId: d.voiceId } : null);
  }

  async function handleCreateAvatar() {
    setError(null);
    if (!getHiflyKey()) { setError("请先在「设置」页面填写飞影 API Key"); return; }
    if (avatarInputType === "existing") {
      if (!avatarId.trim()) { setError("请输入 Avatar ID"); return; }
      setAvatarProfile({ taskId: "", avatarId: avatarId.trim(), status: 3, statusLabel: "完成", title: avatarTitle || "已有数字人", type: "video" });
      return;
    }
    if (!avatarUrl.trim()) { setError("请输入URL"); return; }
    setAvatarLoading(true);
    try {
      const res = await hiflyFetch("/api/hifly/avatar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: avatarInputType, title: avatarTitle, ...(avatarInputType === "video" ? { videoUrl: avatarUrl } : { imageUrl: avatarUrl }) }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "创建失败"); return; }
      const profile: AvatarProfile = { taskId: data.taskId, avatarId: null, status: 1, statusLabel: "等待中", title: avatarTitle, type: avatarInputType };
      setAvatarProfile(profile);
      const poll = setInterval(async () => {
        await pollAvatar(data.taskId);
        setAvatarProfile(p => { if (p && (p.status === 3 || p.status === 4)) clearInterval(poll); return p; });
      }, 5000);
    } catch (err) { setError(err instanceof Error ? err.message : "网络错误"); }
    finally { setAvatarLoading(false); }
  }

  async function handleCreateVoice() {
    setError(null);
    if (!getHiflyKey()) { setError("请先在「设置」页面填写飞影 API Key"); return; }
    if (voiceInputType === "existing") {
      if (!voiceId.trim()) { setError("请输入 Voice ID"); return; }
      setVoiceProfile({ taskId: "", voiceId: voiceId.trim(), status: 3, statusLabel: "完成", title: voiceTitle || "已有声音" });
      return;
    }
    if (!voiceAudioUrl.trim()) { setError("请输入音频URL"); return; }
    setVoiceLoading(true);
    try {
      const res = await hiflyFetch("/api/hifly/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: voiceTitle, audioUrl: voiceAudioUrl }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "创建失败"); return; }
      const profile: VoiceProfile = { taskId: data.taskId, voiceId: null, status: 1, statusLabel: "等待中", title: voiceTitle };
      setVoiceProfile(profile);
      const poll = setInterval(async () => {
        await pollVoice(data.taskId);
        setVoiceProfile(p => { if (p && (p.status === 3 || p.status === 4)) clearInterval(poll); return p; });
      }, 5000);
    } catch (err) { setError(err instanceof Error ? err.message : "网络错误"); }
    finally { setVoiceLoading(false); }
  }

  async function handleGenerateVideo() {
    setError(null);
    const finalAvatarId = avatarProfile?.avatarId;
    const finalVoiceId = voiceProfile?.voiceId;
    const finalScript = scriptSource === "paste" ? scriptText : scripts.find(s => s.id === selectedScriptId)?.content ?? "";
    if (!finalAvatarId) { setError("请先完成数字人形象克隆或填入已有 Avatar ID"); return; }
    if (!finalVoiceId) { setError("请先完成声音克隆或填入已有 Voice ID"); return; }
    if (!finalScript.trim()) { setError("请输入或选择脚本文案"); return; }
    setVideoLoading(true);
    try {
      const res = await hiflyFetch("/api/hifly/video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ avatarId: finalAvatarId, voiceId: finalVoiceId, script: finalScript, title: videoTitle || "FlowPilot生成视频" }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "视频生成失败"); return; }
      const task: VideoTaskDH = { taskId: data.taskId, status: 1, statusLabel: "等待中", videoUrl: null, coverUrl: null, script: finalScript, title: videoTitle, createdAt: new Date().toISOString() };
      setVideoTasks(prev => [task, ...prev]);
      const poll = setInterval(async () => {
        const r = await hiflyFetch(`/api/hifly/video?taskId=${data.taskId}`).catch(() => null);
        if (!r?.ok) return;
        const d = await r.json();
        setVideoTasks(prev => prev.map(t => t.taskId === data.taskId ? { ...t, status: d.status, statusLabel: d.statusLabel, videoUrl: d.videoUrl, coverUrl: d.coverUrl } : t));
        if (d.status === 3 || d.status === 4) clearInterval(poll);
      }, 8000);
    } catch (err) { setError(err instanceof Error ? err.message : "网络错误"); }
    finally { setVideoLoading(false); }
  }

  function handleSaveToKnowledge(task: VideoTaskDH) {
    if (!activeIP || !task.videoUrl) return;
    addKnowledgeEntry({ category: "方法论", title: `数字人视频：${task.title}`, rawContent: `脚本：${task.script}\n视频链接：${task.videoUrl}`, tags: ["数字人", activeIP.name], keywords: [], ipId: activeIP.id, sourceTier: "高", sourceTierReason: "AI数字人生成视频", contentDirection: [], sourcePlatform: "飞影数字人", sourceUrl: task.videoUrl, note: "", extractedAt: new Date().toISOString(), metrics: null, viralEvaluation: null, usageRecords: [], status: "未使用", dna: null });
    alert("已保存到知识库");
  }

  if (!hiflyKey) {
    return (
      <Card>
        <p className="mb-3 text-[13px] font-bold text-[#1C1C1B]">使用数字人拍摄前，需要先配置 API Key</p>
        <p className="mb-4 text-[12.5px] text-[#8A8A86]">飞影数字人 API Key 用于形象克隆和视频生成，仅保存在本地。</p>
        <a href="/settings" className="rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white">去设置页填写 API Key →</a>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="rounded-[10px] bg-[#FCEBEB] px-4 py-3 text-[12.5px] font-semibold text-[#A32D2D]">{error}</div>}

      {/* 选择脚本 */}
      <Card>
        <div className="mb-3 text-[13px] font-bold text-[#1C1C1B]">① 脚本文案</div>
        <div className="mb-3 flex gap-2">
          {(["paste", "select"] as const).map(s => (
            <button key={s} onClick={() => setScriptSource(s)} className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold"
              style={scriptSource === s ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}>
              {s === "paste" ? "手动粘贴" : `从脚本库选择（${scripts.length}条）`}
            </button>
          ))}
        </div>
        {scriptSource === "paste"
          ? <textarea value={scriptText} onChange={e => setScriptText(e.target.value)} placeholder="粘贴口播脚本…" rows={5} className="w-full resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3 text-[13.5px] outline-none focus:border-[#639922]" />
          : <div className="flex flex-col gap-1.5">{scripts.length === 0 ? <p className="text-[12.5px] text-[#999]">脚本库为空，请先去 AI IP脚本工厂 生成脚本</p> : scripts.map(s => (
              <label key={s.id} className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border p-2.5" style={{ borderColor: selectedScriptId === s.id ? "#639922" : "#E5E4DE" }}>
                <input type="radio" name="script" value={s.id} checked={selectedScriptId === s.id} onChange={() => setSelectedScriptId(s.id)} className="mt-0.5" />
                <div><div className="text-[12.5px] font-semibold">{s.title}</div><div className="text-[11.5px] text-[#999]">{s.content.slice(0, 60)}…</div></div>
              </label>))}</div>}
      </Card>

      {/* 数字人形象 */}
      <Card>
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[13px] font-bold text-[#1C1C1B]">② 数字人形象</span>
          {avatarProfile && <DHStatusBadge label={avatarProfile.statusLabel} />}
          {avatarProfile?.avatarId && <span className="font-mono text-[11px] text-[#3B6D11]">ID: {avatarProfile.avatarId}</span>}
        </div>
        <p className="mb-3 text-[11.5px] text-[#999]">只允许克隆本人或已获得授权的形象。</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {(["video", "image", "existing"] as const).map(t => (
            <button key={t} onClick={() => setAvatarInputType(t)} className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold"
              style={avatarInputType === t ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}>
              {t === "video" ? "上传视频URL克隆" : t === "image" ? "上传图片URL克隆" : "已有 Avatar ID"}
            </button>
          ))}
        </div>
        {avatarInputType !== "existing"
          ? <><input value={avatarTitle} onChange={e => setAvatarTitle(e.target.value)} placeholder="数字人名称" className="mb-2 w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13px]" />
              <input value={avatarUrl} onChange={e => setAvatarUrl(e.target.value)} placeholder={avatarInputType === "video" ? "视频URL (mp4/mov)" : "图片URL (jpg/png)"} className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13px]" /></>
          : <input value={avatarId} onChange={e => setAvatarId(e.target.value)} placeholder="Avatar ID，例如 av_abc123" className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 font-mono text-[13px]" />}
        <button onClick={handleCreateAvatar} disabled={avatarLoading} className="mt-3 rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">
          {avatarLoading ? "提交中…" : avatarInputType === "existing" ? "使用此 Avatar ID" : "创建数字人克隆"}
        </button>
        {avatarProfile?.status === 4 && <p className="mt-2 text-[12px] text-[#A32D2D]">克隆失败，请检查视频/图片格式</p>}
      </Card>

      {/* 声音克隆 */}
      <Card>
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[13px] font-bold text-[#1C1C1B]">③ 声音克隆</span>
          {voiceProfile && <DHStatusBadge label={voiceProfile.statusLabel} />}
          {voiceProfile?.voiceId && <span className="font-mono text-[11px] text-[#3B6D11]">ID: {voiceProfile.voiceId}</span>}
        </div>
        <p className="mb-3 text-[11.5px] text-[#999]">只允许克隆本人或已获得授权的声音。</p>
        <div className="mb-3 flex gap-2">
          {(["upload", "existing"] as const).map(t => (
            <button key={t} onClick={() => setVoiceInputType(t)} className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold"
              style={voiceInputType === t ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}>
              {t === "upload" ? "上传音频URL克隆" : "已有 Voice ID"}
            </button>
          ))}
        </div>
        {voiceInputType === "upload"
          ? <><input value={voiceTitle} onChange={e => setVoiceTitle(e.target.value)} placeholder="声音名称" className="mb-2 w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13px]" />
              <input value={voiceAudioUrl} onChange={e => setVoiceAudioUrl(e.target.value)} placeholder="音频URL (mp3/wav，建议30秒以上)" className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13px]" /></>
          : <input value={voiceId} onChange={e => setVoiceId(e.target.value)} placeholder="Voice ID" className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 font-mono text-[13px]" />}
        <button onClick={handleCreateVoice} disabled={voiceLoading} className="mt-3 rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">
          {voiceLoading ? "提交中…" : voiceInputType === "existing" ? "使用此 Voice ID" : "创建声音克隆"}
        </button>
      </Card>

      {/* 生成视频 */}
      <Card>
        <div className="mb-3 text-[13px] font-bold text-[#1C1C1B]">④ 生成视频</div>
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-[10px] bg-[#F7F6F2] p-3 text-[12px]">
          <div><span className="text-[#999]">数字人：</span><span className={avatarProfile?.avatarId ? "text-[#3B6D11]" : "text-[#A32D2D]"}>{avatarProfile?.avatarId ? "✓ 就绪" : "未就绪"}</span></div>
          <div><span className="text-[#999]">声音：</span><span className={voiceProfile?.voiceId ? "text-[#3B6D11]" : "text-[#A32D2D]"}>{voiceProfile?.voiceId ? "✓ 就绪" : "未就绪"}</span></div>
        </div>
        <input value={videoTitle} onChange={e => setVideoTitle(e.target.value)} placeholder="视频标题" className="mb-3 w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2 text-[13px]" />
        <button onClick={handleGenerateVideo} disabled={videoLoading || !avatarProfile?.avatarId || !voiceProfile?.voiceId}
          className="w-full rounded-[12px] bg-[#1C1C1B] py-3.5 text-[14px] font-bold text-white disabled:opacity-40">
          {videoLoading ? "提交生成任务…" : "🎬 生成数字人视频"}
        </button>
      </Card>

      {/* 任务状态 */}
      {videoTasks.length > 0 && (
        <Card>
          <div className="mb-3 text-[13px] font-bold text-[#1C1C1B]">⑤ 生成任务</div>
          {videoTasks.map(task => (
            <div key={task.taskId} className="mb-3 rounded-[12px] border border-[#E5E4DE] p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-[#1C1C1B]">{task.title}</span>
                <DHStatusBadge label={task.statusLabel} />
              </div>
              {(task.status === 1 || task.status === 2) && <p className="text-[12.5px] text-[#7A5C00]">视频生成通常需要2-10分钟，每8秒自动刷新…</p>}
              {task.status === 3 && task.videoUrl && (
                <div className="flex flex-col gap-2">
                  <video src={task.videoUrl} controls className="w-full rounded-[10px]" />
                  <div className="flex flex-wrap gap-2">
                    <a href={task.videoUrl} target="_blank" rel="noopener noreferrer" className="rounded-[10px] bg-[#EAF3DE] px-4 py-2 text-[12.5px] font-semibold text-[#3B6D11]">下载视频</a>
                    <button onClick={() => handleSaveToKnowledge(task)} className="rounded-[10px] bg-[#F2F1ED] px-4 py-2 text-[12.5px] font-semibold text-[#555]">保存到知识库</button>
                    <a href="/review" className="rounded-[10px] bg-[#F2F1ED] px-4 py-2 text-[12.5px] font-semibold text-[#555]">进入发布复盘 →</a>
                  </div>
                </div>
              )}
              {task.status === 4 && <p className="text-[12.5px] text-[#A32D2D]">生成失败，请检查 Avatar ID 和 Voice ID 是否正确，或账户积分是否充足</p>}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────
// 混合模式（架构预留）
// ────────────────────────────────────────────────────
function HybridMode() {
  return (
    <Card>
      <div className="mb-2 text-[13px] font-bold text-[#1C1C1B]">混合模式 — 架构预留</div>
      <p className="text-[12.5px] leading-6 text-[#8A8A86]">
        混合模式将支持同一条内容中真人片段与数字人片段的组合制作，例如：真人出镜开头 + 数字人讲解主体 + 真人结尾互动。<br />
        当前版本架构已预留此入口，功能将在后续版本中开放。
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href="/shoot-room" onClick={e => { e.preventDefault(); }} className="rounded-[10px] bg-[#F2F1ED] px-4 py-2 text-[12.5px] font-semibold text-[#BBB] cursor-not-allowed">
          真人片段管理（即将开放）
        </a>
        <a href="/shoot-room" onClick={e => { e.preventDefault(); }} className="rounded-[10px] bg-[#F2F1ED] px-4 py-2 text-[12.5px] font-semibold text-[#BBB] cursor-not-allowed">
          数字人片段管理（即将开放）
        </a>
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────
// 主页面
// ────────────────────────────────────────────────────
export default function ShootRoomPage() {
  const [mode, setMode] = useState<ProductionMode>("real");

  return (
    <div className="min-h-screen p-6 md:p-8">
      <header className="mb-6">
        <div className="mb-1.5 text-[13px] text-[#8A8A86]">
          <a href="/" className="font-semibold text-[#639922]">工作台</a> / AI 拍摄作战室
        </div>
        <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1B]">AI 拍摄作战室</h1>
        <p className="mt-1.5 text-[13.5px] leading-6 text-[#8A8A86]">
          内容视频生产执行中心。选择生产方式，按需使用真人拍摄或数字人生成。
        </p>
      </header>

      {/* 生产方式选择器 */}
      <div className="mb-6">
        <div className="mb-2.5 text-[12px] font-bold uppercase tracking-wider text-[#8A8A86]">选择生产方式</div>
        <ModeSelector mode={mode} onChange={setMode} />
      </div>

      {/* 各模式内容 */}
      {mode === "real" && <RealShootMode />}
      {mode === "digital" && <DigitalHumanMode />}
      {mode === "hybrid" && <HybridMode />}
    </div>
  );
}
