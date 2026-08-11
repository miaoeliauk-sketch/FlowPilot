"use client";

import { apiFetch } from "@/lib/api-fetch";
import { useIP } from "@/lib/ip-context";
import {
  createClipPlans,
  createEmptyLiveClipState,
  LiveClipStorageError,
  loadLiveClipState,
  saveLiveClipState,
} from "@/lib/live-clips-store";
import { dedupeClipCandidates } from "@/lib/live-clips-response";
import {
  applyVerifiedRemovals,
  buildTranscriptChunks,
  mergeAdjacentTopicBlocks,
  parseLiveTranscript,
} from "@/lib/live-clips-transcript";
import {
  CLIP_TYPE_LABELS,
  LIVE_CLIP_TYPES,
  type ClipCandidate,
  type ClipRecommendation,
  type ClipType,
  type LiveClipApiError,
  type LiveClipFailureCause,
  type LiveClipWorkspaceState,
  type LivePlatform,
  type LiveTranscript,
  type TargetDuration,
  type TopicBlock,
  type TranscriptChunk,
  type TranscriptParagraph,
  type TranscriptSourceType,
} from "@/lib/live-clips-types";
import ClipCandidateCard from "@/components/live-clips/ClipCandidateCard";
import { useEffect, useMemo, useRef, useState } from "react";

type Step = 1 | 2 | 3;

const PLATFORMS: LivePlatform[] = ["抖音", "视频号", "小红书", "B站"];
const DURATIONS: TargetDuration[] = ["30—60秒", "1—3分钟", "3—5分钟", "不限制"];
const FAILURE_LABELS: Record<LiveClipFailureCause, string> = {
  EMPTY_CONTENT: "AI返回为空",
  JSON_PARSE_FAIL: "JSON格式异常",
  SCHEMA_FAIL: "字段异常或原话无法追溯",
  TRUNCATED: "AI返回被截断",
  TIMEOUT: "请求超时",
  AI_REQUEST_FAIL: "AI请求失败",
  MISSING_API_KEY: "未配置DeepSeek API Key",
};

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[16px] border border-[#E5E4DE] bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

function StepIndicator({ step }: { step: Step }) {
  const labels = ["导入直播", "AI分析", "切片候选"];
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      {labels.map((label, index) => {
        const number = (index + 1) as Step;
        const done = step > number;
        const active = step === number;
        return (
          <div key={label} className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold" style={{ background: active ? "#1C1C1B" : done ? "#C8F04A" : "#E5E4DE", color: active ? "#fff" : done ? "#1C1C1B" : "#999" }}>{done ? "✓" : number}</span>
            <span className="text-[12.5px] font-semibold" style={{ color: active ? "#1C1C1B" : done ? "#639922" : "#999" }}>{label}</span>
            {number < 3 && <span className="h-px w-8 bg-[#DAD9D4]" />}
          </div>
        );
      })}
    </div>
  );
}

async function parseImportFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "txt" || extension === "md") {
    return { text: await file.text(), sourceType: extension as TranscriptSourceType };
  }
  if (extension === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { text: result.value, sourceType: "docx" as const };
  }
  throw new Error("仅支持TXT、MD或DOCX文件");
}

function apiFailure(data: unknown, fallback: LiveClipFailureCause): LiveClipApiError {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    return {
      error: typeof record.error === "string" ? record.error : "AI分析失败",
      stageCode: record.stageCode === "CLIP_ANALYSIS_FAIL" ? "CLIP_ANALYSIS_FAIL" : "TOPIC_ANALYSIS_FAIL",
      causeCode: typeof record.causeCode === "string" ? record.causeCode as LiveClipFailureCause : fallback,
    };
  }
  return { error: "AI分析失败", stageCode: "TOPIC_ANALYSIS_FAIL", causeCode: fallback };
}

function paragraphsNearRange(paragraphs: TranscriptParagraph[], start: number, end: number) {
  const selected = paragraphs.filter(paragraph => paragraph.paragraphNumber >= start && paragraph.paragraphNumber <= end);
  const precedingTimecode = paragraphs.filter(paragraph => paragraph.paragraphNumber < start && paragraph.startTime).at(-1);
  const followingTimecode = paragraphs.find(paragraph => paragraph.paragraphNumber > end && paragraph.startTime);
  const context = [precedingTimecode, ...selected, followingTimecode].filter((paragraph): paragraph is TranscriptParagraph => !!paragraph);
  return Array.from(new Map(context.map(paragraph => [paragraph.paragraphNumber, paragraph])).values())
    .sort((a, b) => a.paragraphNumber - b.paragraphNumber);
}

function dedupeRemovals(chunks: TranscriptChunk[]) {
  const seen = new Set<string>();
  return chunks.flatMap(chunk => chunk.removalSuggestions).filter(removal => {
    const key = `${removal.paragraphNumber}:${removal.quote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function replaceTranscript(state: LiveClipWorkspaceState, transcript: LiveTranscript) {
  return {
    ...state,
    liveTranscripts: state.liveTranscripts.map(item => item.id === transcript.id ? transcript : item),
  };
}

export default function LiveClipsPage() {
  const { ips, activeIP, loading: ipLoading } = useIP();
  const [workspace, setWorkspace] = useState<LiveClipWorkspaceState>(createEmptyLiveClipState());
  const workspaceRef = useRef(workspace);
  const [ready, setReady] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [title, setTitle] = useState("");
  const [ipId, setIpId] = useState("");
  const [platform, setPlatform] = useState<LivePlatform>("抖音");
  const [targetDuration, setTargetDuration] = useState<TargetDuration>("1—3分钟");
  const [preferredTypes, setPreferredTypes] = useState<ClipType[]>([]);
  const [rawTranscript, setRawTranscript] = useState("");
  const [sourceType, setSourceType] = useState<TranscriptSourceType>("paste");
  const [fileName, setFileName] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [recommendationFilter, setRecommendationFilter] = useState<"全部" | ClipRecommendation>("全部");
  const [typeFilter, setTypeFilter] = useState<"全部" | ClipType>("全部");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const loaded = loadLiveClipState();
      workspaceRef.current = loaded;
      setWorkspace(loaded);
      const activeId = loaded.activeLiveTranscriptId;
      if (activeId) {
        const hasCandidates = loaded.clipCandidates.some(candidate => candidate.liveTranscriptId === activeId);
        setStep(hasCandidates ? 3 : 2);
      }
    } catch (storageError) {
      setStorageBlocked(true);
      setError(storageError instanceof Error ? storageError.message : "直播切片本地数据读取失败");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ipId && activeIP) setIpId(activeIP.id);
  }, [activeIP, ipId]);

  function commit(next: LiveClipWorkspaceState) {
    if (storageBlocked) {
      setError("本地数据处于保护状态，已停止写入。请先备份并修复现有数据。");
      return false;
    }
    try {
      saveLiveClipState(next);
      workspaceRef.current = next;
      setWorkspace(next);
      return true;
    } catch (storageError) {
      setStorageBlocked(true);
      setError(storageError instanceof Error ? storageError.message : "本地保存失败");
      return false;
    }
  }

  const currentTranscript = workspace.liveTranscripts.find(item => item.id === workspace.activeLiveTranscriptId) ?? null;
  const currentChunks = currentTranscript
    ? workspace.transcriptChunks.filter(chunk => chunk.liveTranscriptId === currentTranscript.id)
    : [];
  const currentTopics = currentTranscript
    ? workspace.topicBlocks.filter(topic => topic.liveTranscriptId === currentTranscript.id)
    : [];
  const currentCandidates = currentTranscript
    ? workspace.clipCandidates.filter(candidate => candidate.liveTranscriptId === currentTranscript.id)
    : [];

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileLoading(true);
    setError(null);
    try {
      const parsed = await parseImportFile(file);
      setRawTranscript(parsed.text);
      setSourceType(parsed.sourceType);
      setFileName(file.name);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "文件读取失败");
    } finally {
      setFileLoading(false);
    }
  }

  function togglePreferredType(type: ClipType) {
    setPreferredTypes(current => current.includes(type) ? current.filter(item => item !== type) : [...current, type]);
  }

  function handleImport() {
    setError(null);
    setNotice(null);
    if (storageBlocked) { setError("本地数据处于保护状态，无法导入新直播。请先备份并修复现有数据。"); return; }
    if (!title.trim()) { setError("请填写直播名称"); return; }
    if (!ipId) { setError("请选择当前IP"); return; }
    if (rawTranscript.trim().length < 50) { setError("逐字稿内容太短，请至少提供50个字"); return; }
    try {
      const parsed = parseLiveTranscript(rawTranscript);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const transcript: LiveTranscript = {
        id,
        title: title.trim(),
        ipId,
        platform,
        rawTranscript,
        cleanedTranscript: parsed.paragraphs.map(paragraph => paragraph.text).join("\n"),
        hasTimecode: parsed.hasTimecode,
        sourceType,
        targetDuration,
        preferredClipTypes: preferredTypes,
        paragraphs: parsed.paragraphs,
        analysisStatus: "imported",
        createdAt: now,
        updatedAt: now,
      };
      const chunks = buildTranscriptChunks(id, parsed.paragraphs);
      const next: LiveClipWorkspaceState = {
        ...workspaceRef.current,
        activeLiveTranscriptId: id,
        liveTranscripts: [...workspaceRef.current.liveTranscripts, transcript],
        transcriptChunks: [...workspaceRef.current.transcriptChunks, ...chunks],
      };
      if (!commit(next)) return;
      setStep(2);
    } catch (parseError) {
      setError(parseError instanceof LiveClipStorageError
        ? parseError.message
        : `逐字稿解析失败（TRANSCRIPT_PARSE_FAIL）：${parseError instanceof Error ? parseError.message : "格式异常"}`);
    }
  }

  async function analyzeChunk(transcript: LiveTranscript, chunk: TranscriptChunk) {
    const response = await apiFetch("/api/live-clips/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        liveTranscriptId: transcript.id,
        chunk,
        paragraphs: paragraphsNearRange(transcript.paragraphs, chunk.startParagraph, chunk.endParagraph),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw apiFailure(data, "AI_REQUEST_FAIL");
    return data as { topics: TopicBlock[]; removalSuggestions: TranscriptChunk["removalSuggestions"] };
  }

  async function analyzeTopic(transcript: LiveTranscript, topic: TopicBlock) {
    const ip = ips.find(item => item.id === transcript.ipId) ?? null;
    const response = await apiFetch("/api/live-clips/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        liveTranscriptId: transcript.id,
        topic,
        paragraphs: paragraphsNearRange(transcript.paragraphs, topic.startParagraph, topic.endParagraph),
        preferredClipTypes: transcript.preferredClipTypes,
        targetDuration: transcript.targetDuration,
        platform: transcript.platform,
        ipContext: ip ? { name: ip.name, positioning: ip.positioning, audience: ip.audience } : null,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw apiFailure(data, "AI_REQUEST_FAIL");
    return data as { candidates: ClipCandidate[] };
  }

  async function runAnalysis(onlyChunkId?: string) {
    const initial = workspaceRef.current;
    const transcript = initial.liveTranscripts.find(item => item.id === initial.activeLiveTranscriptId);
    if (!transcript || analyzing) return;
    setAnalyzing(true);
    setError(null);
    setNotice(null);
    let working = replaceTranscript(initial, { ...transcript, analysisStatus: "analyzing", updatedAt: new Date().toISOString() });

    try {
      if (!commit(working)) throw new LiveClipStorageError("WRITE_FAILED", "分析进度保存失败，已停止继续分析。");
      const chunks = working.transcriptChunks.filter(chunk => (
        chunk.liveTranscriptId === transcript.id
        && (chunk.status === "pending" || chunk.status === "failed")
        && (!onlyChunkId || chunk.id === onlyChunkId)
      ));
      for (let index = 0; index < chunks.length; index += 2) {
        const batch = chunks.slice(index, index + 2);
        working = {
          ...working,
          transcriptChunks: working.transcriptChunks.map(chunk => batch.some(item => item.id === chunk.id)
            ? { ...chunk, status: "analyzing", errorStage: null, errorCause: null }
            : chunk),
        };
        if (!commit(working)) throw new LiveClipStorageError("WRITE_FAILED", "分析进度保存失败，已停止继续分析。");
        const outcomes = await Promise.all(batch.map(async chunk => {
          try { return { chunk, result: await analyzeChunk(transcript, chunk), failure: null }; }
          catch (failure) { return { chunk, result: null, failure: failure as LiveClipApiError }; }
        }));
        let topicBlocks = [...working.topicBlocks];
        let transcriptChunks = [...working.transcriptChunks];
        for (const outcome of outcomes) {
          if (outcome.result) {
            transcriptChunks = transcriptChunks.map(chunk => chunk.id === outcome.chunk.id ? {
              ...chunk, status: "completed", errorStage: null, errorCause: null,
              removalSuggestions: outcome.result!.removalSuggestions,
            } : chunk);
            topicBlocks = [...topicBlocks, ...outcome.result.topics];
          } else {
            transcriptChunks = transcriptChunks.map(chunk => chunk.id === outcome.chunk.id ? {
              ...chunk, status: "failed", errorStage: "TOPIC_ANALYSIS_FAIL",
              errorCause: outcome.failure?.causeCode ?? "AI_REQUEST_FAIL",
            } : chunk);
          }
        }
        const liveTopics = mergeAdjacentTopicBlocks(topicBlocks.filter(topic => topic.liveTranscriptId === transcript.id));
        topicBlocks = [...topicBlocks.filter(topic => topic.liveTranscriptId !== transcript.id), ...liveTopics];
        const removals = dedupeRemovals(transcriptChunks.filter(chunk => chunk.liveTranscriptId === transcript.id));
        const cleanedTranscript = applyVerifiedRemovals(transcript.paragraphs, removals);
        working = {
          ...working,
          transcriptChunks,
          topicBlocks,
          liveTranscripts: working.liveTranscripts.map(item => item.id === transcript.id
            ? { ...item, cleanedTranscript, updatedAt: new Date().toISOString() }
            : item),
        };
        if (!commit(working)) throw new LiveClipStorageError("WRITE_FAILED", "分析进度保存失败，已停止继续分析。");
      }

      const topicsToRun = working.topicBlocks.filter(topic => (
        topic.liveTranscriptId === transcript.id
        && (topic.candidateStatus === "pending" || topic.candidateStatus === "failed")
      ));
      for (let index = 0; index < topicsToRun.length; index += 2) {
        const batch = topicsToRun.slice(index, index + 2);
        working = {
          ...working,
          topicBlocks: working.topicBlocks.map(topic => batch.some(item => item.id === topic.id)
            ? { ...topic, candidateStatus: "analyzing", candidateError: null }
            : topic),
        };
        if (!commit(working)) throw new LiveClipStorageError("WRITE_FAILED", "分析进度保存失败，已停止继续分析。");
        const outcomes = await Promise.all(batch.map(async topic => {
          try { return { topic, result: await analyzeTopic(transcript, topic), failure: null }; }
          catch (failure) { return { topic, result: null, failure: failure as LiveClipApiError }; }
        }));
        let topicBlocks = [...working.topicBlocks];
        let candidates = [...working.clipCandidates];
        for (const outcome of outcomes) {
          if (outcome.result) {
            topicBlocks = topicBlocks.map(topic => topic.id === outcome.topic.id
              ? { ...topic, candidateStatus: "completed", candidateError: null }
              : topic);
            candidates = [
              ...candidates.filter(candidate => candidate.topicBlockId !== outcome.topic.id),
              ...outcome.result.candidates,
            ];
          } else {
            topicBlocks = topicBlocks.map(topic => topic.id === outcome.topic.id
              ? { ...topic, candidateStatus: "failed", candidateError: outcome.failure?.causeCode ?? "AI_REQUEST_FAIL" }
              : topic);
          }
        }
        working = { ...working, topicBlocks, clipCandidates: dedupeClipCandidates(candidates) };
        if (!commit(working)) throw new LiveClipStorageError("WRITE_FAILED", "分析进度保存失败，已停止继续分析。");
      }

      const failedChunks = working.transcriptChunks.some(chunk => chunk.liveTranscriptId === transcript.id && chunk.status === "failed");
      const failedTopics = working.topicBlocks.some(topic => topic.liveTranscriptId === transcript.id && topic.candidateStatus === "failed");
      const completedTranscript = {
        ...(working.liveTranscripts.find(item => item.id === transcript.id) ?? transcript),
        analysisStatus: failedChunks || failedTopics ? "partial" as const : "completed" as const,
        updatedAt: new Date().toISOString(),
      };
      working = replaceTranscript(working, completedTranscript);
      if (!commit(working)) throw new LiveClipStorageError("WRITE_FAILED", "分析结果保存失败。");
      setStep(3);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "AI分析失败");
    } finally {
      setAnalyzing(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${label}已复制`);
    } catch {
      setError("复制失败，请手动选择文字复制");
    }
  }

  function generatePlans() {
    if (!currentTranscript || selectedIds.size === 0) { setError("请至少勾选一条切片候选"); return; }
    const next = createClipPlans(workspaceRef.current, currentTranscript.id, [...selectedIds]);
    if (!commit(next)) return;
    const count = next.clipPlans.filter(plan => plan.liveTranscriptId === currentTranscript.id).length;
    setNotice(`已生成${count}条正式切片方案`);
    setError(null);
  }

  const visibleCandidates = useMemo(() => currentCandidates.filter(candidate => (
    (recommendationFilter === "全部" || candidate.recommendation === recommendationFilter)
    && (typeFilter === "全部" || candidate.clipType === typeFilter || candidate.secondaryTags.includes(typeFilter))
  )), [currentCandidates, recommendationFilter, typeFilter]);

  const counts = useMemo(() => ({
    strong: currentCandidates.filter(candidate => candidate.recommendation === "强烈建议切").length,
    consider: currentCandidates.filter(candidate => candidate.recommendation === "可以考虑").length,
    reject: currentCandidates.filter(candidate => candidate.recommendation === "不建议").length,
  }), [currentCandidates]);

  if (!ready || ipLoading) return <div className="p-8 text-[13px] text-[#888]">正在加载直播切片工作台…</div>;

  return (
    <div className="min-h-screen p-6 md:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 text-[13px] text-[#8A8A86]"><a href="/" className="font-semibold text-[#639922]">工作台</a> / 直播切片</div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1B]">直播切片工作台</h1>
          <p className="mt-1.5 max-w-[720px] text-[13.5px] leading-6 text-[#8A8A86]">把一场长直播整理成值得剪、知道从哪剪、可以直接交给剪辑的短视频切片方案。</p>
        </div>
        {step > 1 && <button type="button" onClick={() => { setStep(1); setError(null); setNotice(null); }} className="rounded-[10px] border border-[#DAD9D4] bg-white px-4 py-2 text-[12px] font-semibold text-[#555]">导入新直播</button>}
      </header>

      <StepIndicator step={step} />
      {error && <div role="alert" className="mb-4 rounded-[12px] bg-[#FCEBEB] px-4 py-3 text-[12.5px] text-[#A32D2D]">{error}</div>}
      {notice && <div className="mb-4 rounded-[12px] bg-[#EAF3DE] px-4 py-3 text-[12.5px] text-[#3B6D11]">{notice}</div>}

      {step === 1 && (
        <div className="grid gap-5 xl:grid-cols-[1fr_1.3fr]">
          <Card>
            <h2 className="text-[15px] font-bold text-[#1C1C1B]">直播基础信息</h2>
            <label className="mt-4 block text-[12px] font-bold text-[#666]" htmlFor="live-title">直播名称</label>
            <input id="live-title" aria-label="直播名称" value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：水木然8月10日直播" className="mt-1.5 w-full rounded-[10px] border border-[#E5E4DE] px-3.5 py-2.5 text-[13px] outline-none focus:border-[#639922]" />

            <label className="mt-4 block text-[12px] font-bold text-[#666]" htmlFor="live-ip">当前IP</label>
            <select id="live-ip" value={ipId} onChange={event => setIpId(event.target.value)} className="mt-1.5 w-full rounded-[10px] border border-[#E5E4DE] bg-white px-3.5 py-2.5 text-[13px] outline-none focus:border-[#639922]">
              <option value="">请选择IP</option>
              {ips.map(ip => <option key={ip.id} value={ip.id}>{ip.name}</option>)}
            </select>

            <label className="mt-4 block text-[12px] font-bold text-[#666]" htmlFor="live-platform">目标平台</label>
            <select id="live-platform" value={platform} onChange={event => setPlatform(event.target.value as LivePlatform)} className="mt-1.5 w-full rounded-[10px] border border-[#E5E4DE] bg-white px-3.5 py-2.5 text-[13px] outline-none focus:border-[#639922]">
              {PLATFORMS.map(item => <option key={item}>{item}</option>)}
            </select>

            <label className="mt-4 block text-[12px] font-bold text-[#666]" htmlFor="live-duration">目标切片长度</label>
            <select id="live-duration" value={targetDuration} onChange={event => setTargetDuration(event.target.value as TargetDuration)} className="mt-1.5 w-full rounded-[10px] border border-[#E5E4DE] bg-white px-3.5 py-2.5 text-[13px] outline-none focus:border-[#639922]">
              {DURATIONS.map(item => <option key={item}>{item}</option>)}
            </select>

            <div className="mt-4 text-[12px] font-bold text-[#666]">偏好切片类型（可多选，不选代表不限）</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {LIVE_CLIP_TYPES.map(type => (
                <button key={type} type="button" onClick={() => togglePreferredType(type)} className="rounded-full px-3 py-1.5 text-[12px] font-semibold" style={preferredTypes.includes(type) ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}>{CLIP_TYPE_LABELS[type]}</button>
              ))}
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold text-[#1C1C1B]">导入直播逐字稿</h2>
                <p className="mt-1 text-[12px] text-[#999]">支持直接粘贴，或上传TXT、MD、DOCX。</p>
              </div>
              <label className="cursor-pointer rounded-[10px] bg-[#F2F1ED] px-4 py-2 text-[12px] font-semibold text-[#555]">
                {fileLoading ? "解析中…" : "选择文件"}
                <input type="file" accept=".txt,.md,.docx" className="hidden" onChange={event => void handleFile(event.target.files?.[0])} />
              </label>
            </div>
            {fileName && <div className="mt-2 text-[11.5px] text-[#639922]">已读取：{fileName}</div>}
            <label className="sr-only" htmlFor="live-transcript">直播逐字稿</label>
            <textarea id="live-transcript" aria-label="直播逐字稿" value={rawTranscript} onChange={event => { setRawTranscript(event.target.value); setSourceType("paste"); setFileName(""); }} rows={18} placeholder="粘贴直播逐字稿。原始内容会在AI分析前先保存，清洗不会覆盖原文。" className="mt-4 w-full resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[13px] leading-6 outline-none focus:border-[#639922]" />
            <div className="mt-1 flex justify-between text-[11px] text-[#BBB]"><span>AI不会为无时间逐字稿编造时间码</span><span>{rawTranscript.length}字</span></div>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={handleImport} disabled={fileLoading || storageBlocked} className="rounded-[11px] bg-[#1C1C1B] px-6 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">保存并进入AI分析</button>
            </div>
          </Card>
        </div>
      )}

      {step === 2 && currentTranscript && (
        <div className="flex flex-col gap-4">
          {!currentTranscript.hasTimecode && <div className="rounded-[12px] bg-[#FBF3D6] px-4 py-3 text-[12.5px] text-[#7A5C00]">原始逐字稿未包含时间信息，无法提供准确剪辑时间。</div>}
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-[16px] font-bold text-[#1C1C1B]">{currentTranscript.title}</h2>
                <p className="mt-1 text-[12px] text-[#888]">共{currentTranscript.paragraphs.length}段，拆成{currentChunks.length}个分析块。每块单独保存，失败不会清空整场直播。</p>
              </div>
              <button type="button" onClick={() => void runAnalysis()} disabled={analyzing || storageBlocked} className="rounded-[11px] bg-[#1C1C1B] px-6 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">{analyzing ? "AI分析进行中…" : currentChunks.some(chunk => chunk.status === "failed") || currentTopics.some(topic => topic.candidateStatus === "failed") ? "重试失败项" : "开始AI分析"}</button>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="text-[13px] font-bold text-[#1C1C1B]">逐字稿清洗与主题识别</h3>
              <div className="mt-3 flex flex-col gap-2">
                {currentChunks.map((chunk, index) => (
                  <div key={chunk.id} className="flex items-center justify-between gap-3 rounded-[10px] bg-[#F7F6F2] px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-[#555]">分块{index + 1} · 第{chunk.ownedStartParagraph}—{chunk.ownedEndParagraph}段</div>
                      {chunk.errorCause && <div className="mt-0.5 text-[11px] text-[#A32D2D]">主题识别失败：{FAILURE_LABELS[chunk.errorCause]}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold" style={{ color: chunk.status === "completed" ? "#639922" : chunk.status === "failed" ? "#A32D2D" : "#999" }}>{chunk.status === "pending" ? "待分析" : chunk.status === "analyzing" ? "分析中" : chunk.status === "completed" ? "已完成" : "失败"}</span>
                      {chunk.status === "failed" && <button type="button" disabled={analyzing} onClick={() => void runAnalysis(chunk.id)} className="rounded-full bg-white px-2.5 py-1 text-[10.5px] font-semibold text-[#639922]">重试</button>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <h3 className="text-[13px] font-bold text-[#1C1C1B]">TopicBlock与切片发现</h3>
              {currentTopics.length === 0 ? <p className="mt-4 text-[12px] text-[#999]">完成主题识别后，会在这里显示独立主题。</p> : (
                <div className="mt-3 flex max-h-[420px] flex-col gap-2 overflow-y-auto">
                  {currentTopics.map((topic, index) => (
                    <div key={topic.id} className="rounded-[10px] border border-[#ECEBE6] px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-[12.5px] font-semibold text-[#333]">Topic {String(index + 1).padStart(2, "0")} · {topic.title}</div>
                        <span className="shrink-0 text-[10.5px] font-bold" style={{ color: topic.candidateStatus === "completed" ? "#639922" : topic.candidateStatus === "failed" ? "#A32D2D" : "#999" }}>{topic.candidateStatus === "pending" ? "待发现切片" : topic.candidateStatus === "analyzing" ? "发现中" : topic.candidateStatus === "completed" ? "已完成" : "失败"}</span>
                      </div>
                      <p className="mt-1 text-[11.5px] leading-5 text-[#888]">第{topic.startParagraph}—{topic.endParagraph}段 · {topic.summary}</p>
                      {topic.candidateError && <p className="mt-1 text-[11px] text-[#A32D2D]">切片识别失败：{FAILURE_LABELS[topic.candidateError]}</p>}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {step === 3 && currentTranscript && (
        <div className="flex flex-col gap-4">
          {(currentChunks.some(chunk => chunk.status === "failed") || currentTopics.some(topic => topic.candidateStatus === "failed")) && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-[#FBF3D6] px-4 py-3 text-[12.5px] text-[#7A5C00]">
              <span>部分内容分析失败，已成功的主题和切片都已保留。</span>
              <button type="button" onClick={() => setStep(2)} className="font-bold underline">查看并重试</button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Card className="p-4"><div className="text-[21px] font-bold text-[#1C1C1B]">{currentTopics.length}</div><div className="mt-1 text-[11.5px] text-[#888]">识别主题块</div></Card>
            <Card className="p-4"><div className="text-[21px] font-bold text-[#3B6D11]">{counts.strong}</div><div className="mt-1 text-[11.5px] text-[#888]">强烈建议切</div></Card>
            <Card className="p-4"><div className="text-[21px] font-bold text-[#7A5C00]">{counts.consider}</div><div className="mt-1 text-[11.5px] text-[#888]">可以考虑</div></Card>
            <Card className="p-4"><div className="text-[21px] font-bold text-[#999]">{counts.reject}</div><div className="mt-1 text-[11.5px] text-[#888]">不建议</div></Card>
          </div>

          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              {(["全部", "强烈建议切", "可以考虑", "不建议"] as const).map(value => <button key={value} type="button" onClick={() => setRecommendationFilter(value)} className="rounded-full px-3 py-1.5 text-[11.5px] font-semibold" style={recommendationFilter === value ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}>{value}</button>)}
              <span className="mx-1 h-5 w-px bg-[#E5E4DE]" />
              <select value={typeFilter} onChange={event => setTypeFilter(event.target.value as "全部" | ClipType)} className="rounded-[9px] border border-[#E5E4DE] bg-white px-3 py-1.5 text-[11.5px] text-[#555]">
                <option value="全部">全部类型</option>
                {LIVE_CLIP_TYPES.map(type => <option key={type} value={type}>{CLIP_TYPE_LABELS[type]}</option>)}
              </select>
              <span className="ml-auto text-[11.5px] text-[#888]">已选{selectedIds.size}条</span>
            </div>
          </Card>

          {visibleCandidates.length === 0 ? (
            <Card className="py-12 text-center text-[13px] text-[#999]">当前筛选条件下没有切片候选。</Card>
          ) : visibleCandidates.map(candidate => (
            <ClipCandidateCard key={candidate.id} candidate={candidate} selected={selectedIds.has(candidate.id)} onToggle={() => toggleSelected(candidate.id)} onCopy={copyText} />
          ))}

          <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-[14px] border border-[#DAD9D4] bg-white/95 px-5 py-3 shadow-lg backdrop-blur">
            <div className="text-[12.5px] text-[#555]">AI负责发现，人负责决定。已勾选<b className="mx-1 text-[#1C1C1B]">{selectedIds.size}</b>条。</div>
            <button type="button" onClick={generatePlans} disabled={selectedIds.size === 0 || storageBlocked} className="rounded-[11px] bg-[#1C1C1B] px-6 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">生成切片方案</button>
          </div>
        </div>
      )}
    </div>
  );
}
