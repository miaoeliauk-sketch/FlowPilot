"use client";
import { apiFetch } from "@/lib/api-fetch";
import { useState, useRef, useEffect } from "react";
import { useIP } from "@/lib/ip-context";
import { addVoiceSample, addKnowledgeEntry } from "@/lib/ip-store";
import { addIPOriginalSource } from "@/lib/ip-original-source";
import { DouyinTranscribePanel } from "@/components/transcribe/DouyinTranscribePanel";
import {
  attachManualTranscript,
  buildTranscriptText,
  type TranscriptSource,
} from "@/lib/transcription-source";

// ── 类型 ──
type Step = 1 | 2 | 3 | 4;
type RecordState = "idle" | "requesting" | "recording" | "paused" | "done";
interface CleanResult {
  cleaned: string;
  segmented: string;
  summary: { theme: string; keyPoints: string[]; cases: string[]; quotables: string[] };
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[14px] border border-[#E5E4DE] bg-white p-5 ${className}`}>{children}</div>;
}

function StepBadge({ n, current }: { n: number; current: Step }) {
  const done = n < current;
  const active = n === current;
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold"
        style={{ background: done ? "#EAF3DE" : active ? "#1C1C1B" : "#F2F1ED", color: done ? "#3B6D11" : active ? "#fff" : "#BBB" }}>
        {done ? "✓" : n}
      </div>
      <span className="text-[12.5px] font-semibold" style={{ color: active ? "#1C1C1B" : done ? "#639922" : "#BBB" }}>
        {["获取音频", "输入逐字稿", "清洗整理", "保存流转"][n - 1]}
      </span>
    </div>
  );
}

// ════════════════════ Step1：录音或上传 ════════════════════
// 转写接口配置——目前没有接入真实ASR，hasASRConfig=false，按钮置灰并说明原因。
// 后续接入Whisper/DeepSeek ASR/通义听悟/火山引擎时，把hasASRConfig改为true并实现handleAutoTranscribe。
const hasASRConfig = false;

function Step1Panel({ onDone }: { onDone: (text: string, source: TranscriptSource) => void }) {
  const [recordState, setRecordState] = useState<RecordState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startTimer() { timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000); }
  function stopTimer() { if (timerRef.current) clearInterval(timerRef.current); }

  async function handleStartRecord() {
    setRecordError(null); setRecordState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioUrl(URL.createObjectURL(blob));
        setRecordState("done"); stopTimer();
      };
      mr.start(1000);
      mediaRef.current = mr;
      setRecordState("recording"); setSeconds(0); startTimer();
    } catch {
      setRecordError("无法获取麦克风权限，请在浏览器设置里允许麦克风访问。");
      setRecordState("idle");
    }
  }
  function handlePause() { mediaRef.current?.pause(); setRecordState("paused"); stopTimer(); }
  function handleResume() { mediaRef.current?.resume(); setRecordState("recording"); startTimer(); }
  function handleStop() { mediaRef.current?.stop(); mediaRef.current?.stream.getTracks().forEach(t => t.stop()); stopTimer(); }
  function handleDeleteRecord() { setAudioUrl(null); setRecordState("idle"); setSeconds(0); }
  function fmt(s: number) { return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }

  // 上传音频后的两个选项
  const hasAudio = audioFile || (recordState === "done" && audioUrl);

  return (
    <div className="flex flex-col gap-4">
      <DouyinTranscribePanel onDone={source => onDone(buildTranscriptText(source), source)} />

      {/* 上传音频 */}
      <Card>
        <div className="mb-1 text-[13px] font-bold text-[#1C1C1B]">上传音频文件</div>
        <p className="mb-3 text-[12px] text-[#999]">支持 mp3、m4a、wav、aac。视频（mp4/mov）后续支持。</p>
        <input type="file" accept=".mp3,.m4a,.wav,.aac,audio/*"
          onChange={e => { const f = e.target.files?.[0]; if (f) setAudioFile(f); }}
          className="text-[13px] text-[#555]" />
        {audioFile && (
          <div className="mt-2 text-[12px] text-[#3B6D11]">✓ 已选择：{audioFile.name}（{(audioFile.size / 1024 / 1024).toFixed(1)} MB）</div>
        )}
      </Card>

      {/* 上传成功后：两个明确选项 */}
      {audioFile && (
        <Card className="border-[#639922]">
          <div className="mb-3 text-[13px] font-bold text-[#1C1C1B]">选择转写方式</div>
          <div className="flex flex-col gap-3">
            {/* 模式2：AI自动转写——目前置灰，等待接入真实ASR */}
            <div>
              <button disabled={!hasASRConfig}
                className="w-full rounded-[10px] px-5 py-3 text-[13px] font-semibold text-left disabled:cursor-not-allowed"
                style={{ background: hasASRConfig ? "#1C1C1B" : "#F2F1ED", color: hasASRConfig ? "#fff" : "#BBB" }}>
                ⚡ 开始AI自动转写
              </button>
              {!hasASRConfig && (
                <p className="mt-1.5 text-[12px] text-[#999]">
                  当前未配置转写服务，请使用手动逐字稿模式。后续支持：Whisper / DeepSeek ASR / 通义听悟 / 火山引擎。
                </p>
              )}
            </div>

            {/* 模式1：手动粘贴——始终可用 */}
            <div>
              <button onClick={() => onDone("", { kind: "audio", items: [{ title: audioFile.name, text: "", sourceUrl: "" }] })}
                className="w-full rounded-[10px] bg-[#639922] px-5 py-3 text-[13px] font-semibold text-white text-left">
                📋 我已有逐字稿，直接粘贴整理
              </button>
              <p className="mt-1.5 text-[12px] text-[#888]">
                推荐先用剪映 / 飞书妙记 / 微信音转文 把录音转写好，再粘贴到下一步。
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* 在线录音 */}
      <Card>
        <div className="mb-1 text-[13px] font-bold text-[#1C1C1B]">在线录音</div>
        <p className="mb-3 text-[12px] text-[#999]">在页面直接录音，录完后用剪映等工具转写，再粘贴到下一步。</p>
        <div className="flex flex-wrap items-center gap-3">
          {recordState === "idle" && (
            <button onClick={handleStartRecord} className="flex h-[40px] items-center gap-2 rounded-[10px] bg-[#A32D2D] px-5 text-[13px] font-semibold text-white">
              ● 开始录音
            </button>
          )}
          {recordState === "requesting" && <span className="text-[13px] text-[#888]">请求麦克风权限中…</span>}
          {(recordState === "recording" || recordState === "paused") && (
            <>
              <div className="flex h-[40px] items-center gap-2 rounded-[10px] bg-[#FCEBEB] px-4 text-[13px] font-bold text-[#A32D2D]">
                {recordState === "recording" ? "● 录音中" : "⏸ 已暂停"} {fmt(seconds)}
              </div>
              {recordState === "recording"
                ? <button onClick={handlePause} className="rounded-[10px] bg-[#F2F1ED] px-4 py-2 text-[13px] font-semibold text-[#555]">暂停</button>
                : <button onClick={handleResume} className="rounded-[10px] bg-[#F2F1ED] px-4 py-2 text-[13px] font-semibold text-[#555]">继续</button>
              }
              <button onClick={handleStop} className="rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[13px] font-semibold text-white">停止录音</button>
            </>
          )}
          {recordState === "done" && audioUrl && (
            <div className="flex flex-wrap items-center gap-3 w-full">
              <audio src={audioUrl} controls className="h-[40px] flex-1 min-w-[200px]" />
              <button onClick={handleDeleteRecord} className="rounded-[10px] bg-[#F2F1ED] px-3 py-2 text-[12.5px] text-[#888]">删除重录</button>
            </div>
          )}
        </div>
        {recordError && <p className="mt-2 text-[12px] text-[#888]">{recordError}</p>}

        {/* 录音完成后同样给出两个选项 */}
        {recordState === "done" && audioUrl && (
          <div className="mt-4 flex flex-col gap-2 border-t border-[#F0EFE9] pt-4">
            <div className="mb-1 text-[12px] font-bold text-[#888]">选择下一步</div>
            <button disabled={!hasASRConfig}
              className="rounded-[10px] px-4 py-2.5 text-[12.5px] font-semibold text-left disabled:cursor-not-allowed"
              style={{ background: hasASRConfig ? "#1C1C1B" : "#F2F1ED", color: hasASRConfig ? "#fff" : "#BBB" }}>
              ⚡ 开始AI自动转写
              {!hasASRConfig && <span className="ml-2 text-[11px]">（未配置转写服务）</span>}
            </button>
            <button onClick={() => onDone("", { kind: "audio", items: [{ title: "在线录音", text: "", sourceUrl: "" }] })}
              className="rounded-[10px] bg-[#639922] px-4 py-2.5 text-[12.5px] font-semibold text-white text-left">
              📋 录音完成，去粘贴逐字稿 →
            </button>
          </div>
        )}
      </Card>

      {/* 没有上传文件时的引导 */}
      {!audioFile && recordState === "idle" && (
        <button onClick={() => onDone("", { kind: "manual", items: [] })}
          className="text-[12.5px] text-[#639922] underline self-start">
          我直接有逐字稿文本，跳过录音步骤 →
        </button>
      )}
    </div>
  );
}

// ════════════════════ Step2：输入逐字稿 ════════════════════
function Step2Panel({ initialText = "", onDone }: { initialText?: string; onDone: (text: string) => void }) {
  const [text, setText] = useState(initialText);
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[10px] bg-[#F7F6F2] px-4 py-3 text-[12.5px] text-[#666]">
        把录音/音频的转写文字粘贴进来。可以是微信语音转文字、剪映自动字幕、手动整理的文字——任何来源都可以，这里只做文本整理，不判断来源。
      </div>
      <Card>
        <div className="mb-2 text-[13px] font-bold text-[#1C1C1B]">粘贴原始逐字稿</div>
        <textarea value={text} onChange={e => setText(e.target.value)}
          placeholder="把原始转写文字粘贴进来，包括口头禅、重复、停顿词都没关系，AI会帮你清洗。&#10;&#10;例如：然后啊，我就是，我就是说嘛，AI这个东西它确实很好用，就是那个门槛嘛，其实没那么高，我之前一直以为很难，结果上手了就，就觉得，哦就这样啊…"
          rows={12} className="w-full resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[13.5px] leading-6 outline-none focus:border-[#639922]" />
        <div className="mt-1 text-right text-[11.5px] text-[#BBB]">{text.length} 字</div>
      </Card>
      <div className="flex justify-end">
        <button onClick={() => onDone(text)} disabled={text.trim().length < 50}
          className="rounded-[12px] bg-[#1C1C1B] px-7 py-2.5 text-[13.5px] font-semibold text-white disabled:opacity-40">
          开始清洗整理 →
        </button>
      </div>
    </div>
  );
}

// ════════════════════ Step3：清洗整理 ════════════════════
function Step3Panel({ rawText, onDone }: { rawText: string; onDone: (result: CleanResult, raw: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CleanResult | null>(null);
  const [activeTab, setActiveTab] = useState<"cleaned" | "segmented" | "summary">("cleaned");

  async function handleClean() {
    setLoading(true); setError(null);
    try {
      const res = await apiFetch("/api/transcribe/clean", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? `请求失败（${res.status}）`); return; }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "整理失败，请重试");
    } finally { setLoading(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="mb-2 text-[13px] font-bold text-[#1C1C1B]">原始逐字稿</div>
        <p className="whitespace-pre-wrap text-[12.5px] leading-6 text-[#666]">{rawText.slice(0, 300)}{rawText.length > 300 ? "…" : ""}</p>
        <div className="mt-3 flex justify-end">
          <button onClick={handleClean} disabled={loading || !!result}
            className="rounded-[10px] bg-[#1C1C1B] px-6 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">
            {loading ? "AI整理中（约15秒）…" : result ? "已完成" : "AI清洗 + 分段 + 摘要"}
          </button>
        </div>
        {error && <div className="mt-2 text-[12.5px] text-[#A32D2D]">{error}</div>}
      </Card>

      {result && (
        <>
          <div className="flex gap-2">
            {(["cleaned", "segmented", "summary"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className="rounded-[10px] px-4 py-2 text-[12.5px] font-semibold"
                style={activeTab === tab ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#666" }}>
                {tab === "cleaned" ? "清洗版" : tab === "segmented" ? "分段版" : "摘要"}
              </button>
            ))}
          </div>

          <Card>
            {activeTab === "cleaned" && (
              <div>
                <div className="mb-2 text-[11.5px] font-bold text-[#888]">清洗版逐字稿（已去除口头禅和无意义重复，内容不变）</div>
                <p className="whitespace-pre-wrap text-[13px] leading-7 text-[#333]">{result.cleaned}</p>
              </div>
            )}
            {activeTab === "segmented" && (
              <div>
                <div className="mb-2 text-[11.5px] font-bold text-[#888]">分段版（按语义自动分段，每段有小标题）</div>
                <p className="whitespace-pre-wrap text-[13px] leading-7 text-[#333]">{result.segmented}</p>
              </div>
            )}
            {activeTab === "summary" && (
              <div className="flex flex-col gap-3">
                <div className="rounded-[10px] bg-[#F7F6F2] p-3">
                  <div className="mb-1 text-[11px] font-bold text-[#888]">核心主题</div>
                  <p className="text-[13px] font-semibold text-[#1C1C1B]">{result.summary.theme}</p>
                </div>
                <div className="rounded-[10px] bg-[#F7F6F2] p-3">
                  <div className="mb-1.5 text-[11px] font-bold text-[#888]">关键观点</div>
                  {result.summary.keyPoints.map((p, i) => <p key={i} className="text-[12.5px] leading-6 text-[#333]">· {p}</p>)}
                </div>
                {result.summary.cases.length > 0 && (
                  <div className="rounded-[10px] bg-[#F7F6F2] p-3">
                    <div className="mb-1.5 text-[11px] font-bold text-[#888]">重点案例</div>
                    {result.summary.cases.map((c, i) => <p key={i} className="text-[12.5px] leading-6 text-[#333]">· {c}</p>)}
                  </div>
                )}
                {result.summary.quotables.length > 0 && (
                  <div className="rounded-[10px] bg-[#EAF3DE] p-3">
                    <div className="mb-1.5 text-[11px] font-bold text-[#3B6D11]">可复用金句</div>
                    {result.summary.quotables.map((q, i) => <p key={i} className="text-[12.5px] leading-6 text-[#3B6D11]">「{q}」</p>)}
                  </div>
                )}
              </div>
            )}
          </Card>

          <div className="flex justify-end">
            <button onClick={() => onDone(result, rawText)}
              className="rounded-[12px] bg-[#1C1C1B] px-7 py-2.5 text-[13.5px] font-semibold text-white">
              保存和流转 →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════ Step4：保存和流转 ════════════════════
function Step4Panel({ rawText, result, source }: { rawText: string; result: CleanResult; source: TranscriptSource }) {
  const { activeIP } = useIP();
  const [saved, setSaved] = useState<string[]>([]);
  const isDouyin = source.kind === "douyin";
  const sourceLabel = isDouyin ? "抖音逐字稿" : source.kind === "audio" ? "录音转逐字稿" : "手动逐字稿";
  const sourceUrl = source.items.length === 1 ? source.items[0]?.sourceUrl ?? "" : "";

  function handleSaveVoiceSample() {
    if (!activeIP) { alert("请先在IP身份中心选择一个IP"); return; }
    addVoiceSample({
      ipId: activeIP.id, type: "口播逐字稿",
      title: result.summary.theme.slice(0, 30) || `${sourceLabel}样本`,
      rawText: result.cleaned || rawText, note: `来源：${sourceLabel} | 主题：${result.summary.theme}`,
    });
    setSaved(s => [...s, "voice"]);
  }

  function handleSaveKnowledge() {
    if (!activeIP) { alert("请先在IP身份中心选择一个IP"); return; }
    try {
      const sourceItems = source.items.length > 0
        ? source.items.map(item => ({ ...item, text: item.text || rawText }))
        : [{ title: `${sourceLabel}原文`, text: rawText, sourceUrl: "" }];
      const sourceIds = sourceItems.map((item, index) => addIPOriginalSource({
        ipId: activeIP.id,
        title: item.title.trim() || `${sourceLabel}${index + 1}`,
        sourceKind: source.kind === "manual" ? "其他" : "语音整理",
        originalContent: item.text,
        sourceName: isDouyin ? "抖音" : sourceLabel,
        sourceUrl: item.sourceUrl,
        analysis: { analyzedAt: new Date().toISOString(), parserVersion: 1, items: [] },
      }).id);
      addKnowledgeEntry({
        category: "方法论", title: result.summary.theme.slice(0, 40) || "录音整理内容",
        rawContent: result.cleaned || rawText,
        tags: [isDouyin ? "抖音逐字稿" : source.kind === "audio" ? "录音转写" : "手动逐字稿", activeIP.name], keywords: result.summary.keyPoints.slice(0, 3),
        ipId: activeIP.id, sourceTier: "中", sourceTierReason: `AI整理自Source：${sourceIds.join("、")}`,
        contentDirection: [activeIP.contentDirection?.[0] ?? ""].filter(Boolean), sourcePlatform: isDouyin ? "抖音" : source.kind === "audio" ? "录音" : "手动输入",
        sourceUrl,
        note: JSON.stringify({ derivedFromSourceIds: sourceIds, aiCleaned: true, summary: result.summary }),
        extractedAt: new Date().toISOString(), trustStatus: "ai_derived_unverified",
        metrics: null, viralEvaluation: null, usageRecords: [], status: "未使用", dna: null,
      });
      setSaved(s => [...s, "knowledge"]);
    } catch (saveError) {
      alert(saveError instanceof Error ? saveError.message : "保存失败，请重试");
    }
  }

  function handleCopyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => alert("已复制到剪贴板，可以粘贴到其他模块使用"));
  }

  return (
    <div className="flex flex-col gap-4">
      {activeIP && (
        <div className="rounded-[10px] bg-[#EAF3DE] px-4 py-2.5 text-[12.5px] text-[#3B6D11]">
          当前IP：{activeIP.name} · 保存操作将归档到此IP
        </div>
      )}

      <Card>
        <div className="mb-3 text-[13px] font-bold text-[#1C1C1B]">保存到知识库</div>
        <p className="mb-3 text-[12px] text-[#888]">每条原始逐字稿会先独立保存并保留来源链接，再关联AI整理的方法论，可随时回看原文。</p>
        <button onClick={handleSaveKnowledge} disabled={saved.includes("knowledge")}
          className="rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">
          {saved.includes("knowledge") ? "✓ 原文和方法论已保存" : "保存原文和方法论"}
        </button>
      </Card>

      <Card>
        <div className="mb-3 text-[13px] font-bold text-[#1C1C1B]">保存为IP口播样本</div>
        <p className="mb-3 text-[12px] text-[#888]">将清洗版逐字稿保存为当前IP的口播风格样本，帮助AI学习说话方式。</p>
        <button onClick={handleSaveVoiceSample} disabled={saved.includes("voice")}
          className="rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">
          {saved.includes("voice") ? "✓ 已保存为口播样本" : "保存为IP口播样本"}
        </button>
      </Card>

      <Card>
        <div className="mb-3 text-[13px] font-bold text-[#1C1C1B]">复制内容去其他模块使用</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => handleCopyToClipboard(result.cleaned)} className="rounded-[10px] bg-[#F2F1ED] px-4 py-2 text-[12.5px] font-semibold text-[#555]">复制清洗版 → 文案优化</button>
          <button onClick={() => handleCopyToClipboard(result.segmented)} className="rounded-[10px] bg-[#F2F1ED] px-4 py-2 text-[12.5px] font-semibold text-[#555]">复制分段版 → 脚本工厂</button>
          <button onClick={() => handleCopyToClipboard(`${result.summary.theme}\n\n${result.summary.keyPoints.join("\n")}`)} className="rounded-[10px] bg-[#F2F1ED] px-4 py-2 text-[12.5px] font-semibold text-[#555]">复制摘要 → 选题董事会</button>
        </div>
        <p className="mt-2 text-[11.5px] text-[#BBB]">AI内容工厂和内容诊断中心尚未开发，暂时通过复制粘贴流转内容。</p>
      </Card>
    </div>
  );
}

// ════════════════════ Main ════════════════════
export default function TranscribePage() {
  const [step, setStep] = useState<Step>(1);
  const [rawText, setRawText] = useState("");
  const [source, setSource] = useState<TranscriptSource>({ kind: "manual", items: [] });
  const [cleanResult, setCleanResult] = useState<CleanResult | null>(null);

  return (
    <div className="min-h-screen p-6 md:p-8">
      <header className="mb-6">
        <div className="mb-1.5 text-[13px] text-[#8A8A86]">
          <a href="/" className="font-semibold text-[#639922]">工作台</a> / 逐字稿中心
        </div>
        <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1B]">逐字稿中心</h1>
        <p className="mt-1.5 max-w-[600px] text-[13.5px] leading-6 text-[#8A8A86]">
          抖音链接 / 录音 / 上传音频 → 生成或粘贴逐字稿 → AI清洗+分段+摘要 → 保存到知识库或IP口播样本
        </p>
      </header>

      <div className="rounded-[10px] bg-[#F7F6F2] px-4 py-2.5 mb-5 text-[12.5px] text-[#666]">
        四种用法都支持：① 抖音链接自动提取 → ② 直接粘贴已有逐字稿 → ③ 先录音或上传再转写 → ④ 手动整理后粘贴。所有路径都可以完整走完清洗、摘要和保存。
      </div>

      <div className="mb-6 flex flex-wrap gap-4">
        {([1, 2, 3, 4] as Step[]).map(n => <StepBadge key={n} n={n} current={step} />)}
      </div>

      {step === 1 && <Step1Panel onDone={(text, nextSource) => { setRawText(text); setSource(nextSource); setStep(text.trim() ? 3 : 2); }} />}
      {step === 2 && <Step2Panel initialText={rawText} onDone={(text) => { setRawText(text); setSource(current => attachManualTranscript(current, text)); setStep(3); }} />}
      {step === 3 && <Step3Panel rawText={rawText} onDone={(result, raw) => { setCleanResult(result); setRawText(raw); setStep(4); }} />}
      {step === 4 && cleanResult && <Step4Panel rawText={rawText} result={cleanResult} source={source} />}

      {step > 1 && (
        <button onClick={() => setStep(s => (s - 1) as Step)} className="mt-6 text-[12.5px] text-[#639922]">
          ← 返回上一步
        </button>
      )}
    </div>
  );
}
