"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DouyinHealth,
  DouyinTranscriptResult,
  DouyinTranscriptionMode,
  DouyinTranscriptionRequest,
} from "@/lib/douyin-transcription";
import type { TranscriptSource } from "@/lib/transcription-source";

interface DouyinTranscribePanelProps {
  onDone: (source: TranscriptSource) => void;
}

function modeLabel(mode: DouyinTranscriptionMode): string {
  if (mode === "api") return "在线接口";
  if (mode === "bailian") return "阿里云百炼";
  return "本地Whisper";
}

export function DouyinTranscribePanel({ onDone }: DouyinTranscribePanelProps) {
  const [linksText, setLinksText] = useState("");
  const [mode, setMode] = useState<DouyinTranscriptionMode>("local");
  const [modelSize, setModelSize] = useState("small");
  const [apiKey, setApiKey] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("https://api.openai.com/v1");
  const [apiModel, setApiModel] = useState("whisper-1");
  const [dashscopeApiKey, setDashscopeApiKey] = useState("");
  const [cookiesFromBrowser, setCookiesFromBrowser] = useState("");
  const [health, setHealth] = useState<DouyinHealth | null>(null);
  const [healthError, setHealthError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<DouyinTranscriptResult[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/transcribe/douyin")
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "无法检查本机转写环境。");
        return body as DouyinHealth;
      })
      .then(nextHealth => { if (active) setHealth(nextHealth); })
      .catch(reason => { if (active) setHealthError(reason instanceof Error ? reason.message : "无法检查本机转写环境。"); });
    return () => { active = false; };
  }, []);

  const successfulResults = useMemo(() => results.filter(result => result.status === "success"), [results]);
  const modeReady = Boolean(health?.modes[mode]);
  const missingKey = (mode === "api" && !apiKey.trim()) || (mode === "bailian" && !dashscopeApiKey.trim());
  const unavailable = Boolean(healthError) || (health !== null && (!health.ready || !modeReady));

  async function handleTranscribe() {
    setLoading(true);
    setError("");
    setResults([]);
    const payload: DouyinTranscriptionRequest = {
      linksText,
      mode,
      modelSize,
      apiKey,
      apiBaseUrl,
      apiModel,
      dashscopeApiKey,
      cookiesFromBrowser,
    };
    try {
      const response = await fetch("/api/transcribe/douyin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as { results?: DouyinTranscriptResult[]; error?: string };
      if (!response.ok) throw new Error(body.error || "抖音链接转写失败。");
      setResults(body.results ?? []);
      if (!(body.results ?? []).some(result => result.status === "success")) {
        setError(body.results?.[0]?.message || "这批链接都没有转写成功。");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "抖音链接转写失败。");
    } finally {
      setLoading(false);
    }
  }

  function useAllResults() {
    onDone({
      kind: "douyin",
      items: successfulResults.map(result => ({
        title: result.title,
        text: result.text,
        sourceUrl: result.sourceUrl,
      })),
    });
  }

  const environmentMessage = healthError
    || (health?.missing.length ? `本机缺少：${health.missing.join("、")}` : "")
    || (health && !modeReady ? `本机还没有安装${modeLabel(mode)}所需组件。` : "")
    || "本机工具已就绪。API Key不会保存，浏览器登录信息默认不读取。";

  return (
    <div className="rounded-[14px] border border-[#C8F04A] bg-white p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="text-[13px] font-bold text-[#1C1C1B]">抖音链接转逐字稿</div>
        <span className="rounded-full bg-[#EAF3DE] px-2.5 py-1 text-[10.5px] font-bold text-[#3B6D11]">本机处理</span>
      </div>
      <p className="mb-3 text-[12px] leading-5 text-[#888]">直接粘贴抖音分享文案或视频链接，支持单条和批量，一次最多20条。</p>

      <textarea
        value={linksText}
        onChange={event => setLinksText(event.target.value)}
        maxLength={50_000}
        placeholder="把抖音分享文案或视频链接粘贴到这里，可一行一条"
        rows={5}
        className="w-full resize-y rounded-[12px] border border-[#E5E4DE] bg-[#F7F6F2] px-3.5 py-3 text-[13px] leading-6 outline-none focus:border-[#639922]"
      />

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="text-[11.5px] font-semibold text-[#666]">
          转写方式
          <select value={mode} onChange={event => setMode(event.target.value as DouyinTranscriptionMode)} className="mt-1 h-10 w-full rounded-[10px] border border-[#E5E4DE] bg-white px-3 text-[12.5px]">
            <option value="local">本地免费</option>
            <option value="api">在线接口</option>
            <option value="bailian">阿里云百炼</option>
          </select>
        </label>
        <label className="text-[11.5px] font-semibold text-[#666]">
          读取抖音登录信息
          <select value={cookiesFromBrowser} onChange={event => setCookiesFromBrowser(event.target.value)} className="mt-1 h-10 w-full rounded-[10px] border border-[#E5E4DE] bg-white px-3 text-[12.5px]">
            <option value="">不读取</option>
            <option value="chrome">Chrome</option>
            <option value="edge">Edge</option>
            <option value="safari">Safari</option>
            <option value="firefox">Firefox</option>
          </select>
        </label>
        {mode === "local" && (
          <label className="text-[11.5px] font-semibold text-[#666]">
            本地模型
            <select value={modelSize} onChange={event => setModelSize(event.target.value)} className="mt-1 h-10 w-full rounded-[10px] border border-[#E5E4DE] bg-white px-3 text-[12.5px]">
              <option value="tiny">tiny，最快</option>
              <option value="base">base，较快</option>
              <option value="small">small，推荐</option>
              <option value="medium">medium，更准确</option>
              <option value="large">large，最慢</option>
            </select>
          </label>
        )}
      </div>

      {mode === "api" && (
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <input type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="API Key" className="h-10 rounded-[10px] border border-[#E5E4DE] px-3 text-[12.5px]" />
          <input value={apiBaseUrl} onChange={event => setApiBaseUrl(event.target.value)} placeholder="接口地址" className="h-10 rounded-[10px] border border-[#E5E4DE] px-3 text-[12.5px]" />
          <input value={apiModel} onChange={event => setApiModel(event.target.value)} placeholder="模型名称" className="h-10 rounded-[10px] border border-[#E5E4DE] px-3 text-[12.5px]" />
        </div>
      )}

      {mode === "bailian" && (
        <input type="password" autoComplete="off" value={dashscopeApiKey} onChange={event => setDashscopeApiKey(event.target.value)} placeholder="DashScope API Key" className="mt-3 h-10 w-full rounded-[10px] border border-[#E5E4DE] px-3 text-[12.5px]" />
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className={`text-[11.5px] ${unavailable ? "text-[#A32D2D]" : "text-[#639922]"}`}>{environmentMessage}</p>
        <button
          type="button"
          onClick={handleTranscribe}
          disabled={loading || unavailable || missingKey || !linksText.trim()}
          className="shrink-0 rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "下载并转写中…" : "开始提取逐字稿"}
        </button>
      </div>
      {cookiesFromBrowser && <p className="mt-2 text-[11px] text-[#A66A00]">浏览器Cookies属于登录凭证，仅在抖音要求登录时读取，不要上传或分享。</p>}
      {missingKey && <p className="mt-2 text-[11.5px] text-[#A32D2D]">请填写当前转写方式需要的密钥。</p>}
      {error && <div className="mt-3 rounded-[10px] bg-[#FCEBEB] px-3 py-2.5 text-[12px] text-[#A32D2D]">{error}</div>}

      {results.length > 0 && (
        <div className="mt-4 border-t border-[#F0EFE9] pt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[12px] font-bold text-[#666]">处理结果：成功{successfulResults.length}/{results.length}</div>
            {successfulResults.length > 1 && (
              <button type="button" onClick={useAllResults} className="rounded-[9px] bg-[#639922] px-3 py-1.5 text-[11.5px] font-semibold text-white">合并成功结果并继续</button>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {results.map((result, index) => (
              <div key={`${result.sourceUrl}-${index}`} className="flex items-center gap-3 rounded-[10px] bg-[#F7F6F2] px-3 py-2.5">
                <span className={`text-[12px] ${result.status === "success" ? "text-[#3B6D11]" : "text-[#A32D2D]"}`}>{result.status === "success" ? "✓" : "!"}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-[#333]">{result.title}</div>
                  <div className="truncate text-[11px] text-[#999]">{result.status === "success" ? `${result.text.length}字` : result.message}</div>
                </div>
                {result.status === "success" && (
                  <button type="button" onClick={() => onDone({ kind: "douyin", items: [{ title: result.title, text: result.text, sourceUrl: result.sourceUrl }] })} className="shrink-0 rounded-[8px] bg-[#1C1C1B] px-3 py-1.5 text-[11.5px] font-semibold text-white">使用此逐字稿</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
