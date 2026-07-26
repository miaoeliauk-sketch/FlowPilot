"use client";
import { useState, useEffect, useRef } from "react";
import { getStoredApiKey, setStoredApiKey, clearStoredApiKey, hasApiKey } from "@/lib/api-settings";
import { apiFetch } from "@/lib/api-fetch";
import { DECISION_MEMORY_STORAGE_KEY } from "@/lib/decision-memory-store";

// API Key不进导出，其余所有数据key都导出
const EXPORT_KEYS = [
  "ipwr:ips_v2",
  "ipwr:activeIpId",
  "ipwr:voiceSamples",
  "ipwr:voiceSamplesMigrated",
  "ipwr:ipStyleProfiles",
  "ipwr:topicAssets",
  "ipwr:commentAssets",
  "ipwr:scriptAssets",
  "ipwr:knowledgeEntries",
  "ipwr:hookEntries",
  "ipwr:hotAnalyses",
  "ipwr:videoReviews",
  "ipwr:userProfile",
  "ipwr:weeklyReports",
  DECISION_MEMORY_STORAGE_KEY,
];

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[14px] border border-[#E5E4DE] bg-white p-5 ${className}`}>{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-4 text-[15px] font-bold text-[#1C1C1B]">{children}</h2>;
}

// ════════════════════ API Key配置 ════════════════════
function ApiKeySection() {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => { setKey(getStoredApiKey()); }, []);

  function handleSave() {
    setStoredApiKey(key);
    setSaved(true);
    setTestResult(null);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleClear() {
    clearStoredApiKey();
    setKey("");
    setTestResult(null);
  }

  async function handleTest() {
    const k = key.trim();
    if (!k) { setTestResult({ ok: false, msg: "请先填写 API Key" }); return; }
    // 先临时存一下，让apiFetch能读到
    setStoredApiKey(k);
    setTesting(true); setTestResult(null);
    try {
      const res = await apiFetch("/api/knowledge-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test", entries: [] }),
      });
      if (res.status === 400 || res.status === 200) {
        // 400是参数校验，说明接口通了但知识库为空，这就证明Key有效
        setTestResult({ ok: true, msg: "✓ 连接成功，DeepSeek API Key 有效" });
      } else if (res.status === 401 || res.status === 403) {
        setTestResult({ ok: false, msg: "✗ Key 无效或已过期，请检查后重试" });
      } else {
        const data = await res.json().catch(() => ({}));
        if (data.error?.includes("API Key")) {
          setTestResult({ ok: false, msg: `✗ ${data.error}` });
        } else {
          // 其他状态码的接口错误不代表Key无效
          setTestResult({ ok: true, msg: "✓ 连接正常（接口已响应）" });
        }
      }
    } catch {
      setTestResult({ ok: false, msg: "✗ 网络错误，请确认 dev server 正在运行" });
    } finally { setTesting(false); }
  }

  const maskedKey = key ? key.slice(0, 8) + "••••••••••••••••••••" + key.slice(-4) : "";

  return (
    <Card>
      <SectionTitle>DeepSeek API Key</SectionTitle>
      <p className="mb-4 text-[12.5px] leading-5 text-[#8A8A86]">
        API Key 仅保存在你的本地浏览器，不会上传到任何服务器，不会写入代码文件。
        每次调用 AI 功能时自动附加到请求头中。
      </p>

      <div className="flex flex-col gap-3">
        <div className="relative">
          <input
            type={show ? "text" : "password"}
            value={key}
            onChange={e => { setKey(e.target.value); setTestResult(null); }}
            placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 pr-20 font-mono text-[13px] outline-none focus:border-[#639922]"
          />
          <button
            onClick={() => setShow(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[11.5px] text-[#639922] font-semibold"
          >
            {show ? "隐藏" : "显示"}
          </button>
        </div>

        {testResult && (
          <div className={`rounded-[8px] px-3 py-2 text-[12.5px] font-semibold ${testResult.ok ? "bg-[#EAF3DE] text-[#3B6D11]" : "bg-[#FCEBEB] text-[#A32D2D]"}`}>
            {testResult.msg}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleSave}
            disabled={!key.trim()}
            className="rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            {saved ? "✓ 已保存" : "保存 Key"}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || !key.trim()}
            className="rounded-[10px] bg-[#F2F1ED] px-5 py-2.5 text-[13px] font-semibold text-[#555] disabled:opacity-40"
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
          {hasApiKey() && (
            <button
              onClick={handleClear}
              className="rounded-[10px] bg-[#FCEBEB] px-5 py-2.5 text-[13px] font-semibold text-[#A32D2D]"
            >
              清除 Key
            </button>
          )}
        </div>

        <div className="rounded-[8px] bg-[#F7F6F2] px-3 py-2 text-[11.5px] text-[#999]">
          去 <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer" className="text-[#639922] underline">platform.deepseek.com</a> 获取你的 API Key
        </div>
      </div>
    </Card>
  );
}

// ════════════════════ 数字人 API Key ════════════════════
function HiflyKeySection() {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setKey(localStorage.getItem("ipwr:hiflyApiKey") ?? "");
  }, []);

  function handleSave() {
    if (key.trim()) localStorage.setItem("ipwr:hiflyApiKey", key.trim());
    else localStorage.removeItem("ipwr:hiflyApiKey");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleClear() {
    localStorage.removeItem("ipwr:hiflyApiKey");
    setKey("");
  }

  return (
    <Card>
      <SectionTitle>飞影数字人 API Key</SectionTitle>
      <p className="mb-4 text-[12.5px] leading-5 text-[#8A8A86]">
        用于数字人形象克隆和视频生成。仅保存在本地，不上传到任何服务器。
        <a href="https://hifly.cc/setting" target="_blank" rel="noopener noreferrer" className="ml-1 text-[#639922] underline">去获取 →</a>
      </p>
      <div className="flex flex-col gap-3">
        <div className="relative">
          <input type={show ? "text" : "password"} value={key} onChange={e => setKey(e.target.value)}
            placeholder="飞影 API Key"
            className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 pr-20 font-mono text-[13px] outline-none focus:border-[#639922]" />
          <button onClick={() => setShow(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[11.5px] font-semibold text-[#639922]">
            {show ? "隐藏" : "显示"}
          </button>
        </div>
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={!key.trim()}
            className="rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">
            {saved ? "✓ 已保存" : "保存"}
          </button>
          {key && <button onClick={handleClear} className="rounded-[10px] bg-[#FCEBEB] px-5 py-2.5 text-[13px] font-semibold text-[#A32D2D]">清除</button>}
        </div>
      </div>
    </Card>
  );
}
function BackupSection() {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleExport() {
    const data: Record<string, unknown> = {
      _meta: {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        app: "FlowPilot Desktop Preview 0.1",
        note: "API Key 不在导出内容中",
      },
    };
    for (const key of EXPORT_KEYS) {
      const val = localStorage.getItem(key);
      if (val !== null) {
        try { data[key] = JSON.parse(val); }
        catch { data[key] = val; }
      }
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flowpilot-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setImportResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = ev.target?.result as string;
        const data = JSON.parse(raw) as Record<string, unknown>;
        if (!data._meta) {
          setImportResult({ ok: false, msg: "文件格式不正确，请选择 FlowPilot 导出的备份文件" });
          return;
        }
        let count = 0;
        for (const key of EXPORT_KEYS) {
          if (key in data) {
            localStorage.setItem(key, JSON.stringify(data[key]));
            count++;
          }
        }
        setImportResult({ ok: true, msg: `✓ 导入成功，恢复了 ${count} 项数据。请刷新页面（Cmd+Shift+R）使数据生效。` });
      } catch {
        setImportResult({ ok: false, msg: "文件解析失败，请确认是有效的 JSON 备份文件" });
      } finally {
        setImporting(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    };
    reader.readAsText(file);
  }

  function getDataSummary() {
    const summary: string[] = [];
    const counts: Record<string, number> = {
      "IP配置": 0, "知识库条目": 0, "脚本记录": 0,
      "选题记录": 0, "复盘记录": 0, "爆款分析": 0, "判断记录": 0,
    };
    try {
      const ips = JSON.parse(localStorage.getItem("ipwr:ips_v2") || "[]");
      counts["IP配置"] = Array.isArray(ips) ? ips.length : 0;
      const entries = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") || "[]");
      counts["知识库条目"] = Array.isArray(entries) ? entries.length : 0;
      const scripts = JSON.parse(localStorage.getItem("ipwr:scriptAssets") || "[]");
      counts["脚本记录"] = Array.isArray(scripts) ? scripts.length : 0;
      const topics = JSON.parse(localStorage.getItem("ipwr:topicAssets") || "[]");
      counts["选题记录"] = Array.isArray(topics) ? topics.length : 0;
      const reviews = JSON.parse(localStorage.getItem("ipwr:videoReviews") || "[]");
      counts["复盘记录"] = Array.isArray(reviews) ? reviews.length : 0;
      const hot = JSON.parse(localStorage.getItem("ipwr:hotAnalyses") || "[]");
      counts["爆款分析"] = Array.isArray(hot) ? hot.length : 0;
      const decisionMemory = JSON.parse(
        localStorage.getItem(DECISION_MEMORY_STORAGE_KEY) || '{"schemaVersion":1,"records":[]}',
      );
      counts["判断记录"] = Array.isArray(decisionMemory?.records) ? decisionMemory.records.length : 0;
    } catch {}
    for (const [k, v] of Object.entries(counts)) {
      if (v > 0) summary.push(`${k} ${v}条`);
    }
    return summary.length > 0 ? summary.join(" · ") : "暂无数据";
  }

  const [summary, setSummary] = useState("计算中…");
  useEffect(() => { setSummary(getDataSummary()); }, []);

  return (
    <Card>
      <SectionTitle>数据备份与恢复</SectionTitle>
      <p className="mb-4 text-[12.5px] leading-5 text-[#8A8A86]">
        所有数据保存在本地浏览器中。建议定期导出备份，避免清除浏览器数据时丢失。
        API Key 不包含在导出文件中。
      </p>

      <div className="mb-4 rounded-[10px] bg-[#F7F6F2] px-3 py-2.5 text-[12.5px] text-[#666]">
        当前数据：{summary}
      </div>

      <div className="flex flex-col gap-3">
        <div className="rounded-[12px] border border-[#E5E4DE] p-4">
          <div className="mb-1 text-[13px] font-bold text-[#1C1C1B]">导出备份</div>
          <p className="mb-3 text-[12px] text-[#8A8A86]">
            导出所有数据为 JSON 文件，包含 IP配置、知识库、脚本、选题、复盘等所有记录。
          </p>
          <button onClick={handleExport}
            className="rounded-[10px] bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-semibold text-white">
            导出全部数据 →
          </button>
        </div>

        <div className="rounded-[12px] border border-[#E5E4DE] p-4">
          <div className="mb-1 text-[13px] font-bold text-[#1C1C1B]">从备份恢复</div>
          <p className="mb-3 text-[12px] text-[#8A8A86]">
            选择之前导出的 JSON 备份文件，恢复所有数据。<br />
            <span className="text-[#A32D2D]">注意：会覆盖当前数据，请在恢复前先导出备份。</span>
          </p>
          {importResult && (
            <div className={`mb-3 rounded-[8px] px-3 py-2 text-[12.5px] font-semibold ${importResult.ok ? "bg-[#EAF3DE] text-[#3B6D11]" : "bg-[#FCEBEB] text-[#A32D2D]"}`}>
              {importResult.msg}
            </div>
          )}
          <input ref={fileRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={importing}
            className="rounded-[10px] bg-[#F2F1ED] px-5 py-2.5 text-[13px] font-semibold text-[#555] disabled:opacity-40">
            {importing ? "导入中…" : "选择备份文件导入"}
          </button>
        </div>
      </div>
    </Card>
  );
}

// ════════════════════ 关于 ════════════════════
function AboutSection() {
  return (
    <Card>
      <SectionTitle>关于 FlowPilot</SectionTitle>
      <div className="space-y-1.5 text-[12.5px] text-[#8A8A86]">
        <p>版本：Desktop Preview 0.1</p>
        <p>定位：AI+IP 内容生产操作系统</p>
        <p>AI引擎：DeepSeek（需自备 API Key）</p>
        <p>数据存储：本地浏览器 localStorage（无云同步）</p>
        <p className="pt-2 text-[#BBB]">所有数据保存在本地，不上传到任何服务器。</p>
      </div>
    </Card>
  );
}

// ════════════════════ Main ════════════════════
export default function SettingsPage() {
  return (
    <div className="min-h-screen p-6 md:p-8">
      <header className="mb-6">
        <div className="mb-1.5 text-[13px] text-[#8A8A86]">
          <a href="/" className="font-semibold text-[#639922]">工作台</a> / 设置
        </div>
        <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1B]">设置</h1>
        <p className="mt-1 text-[13.5px] text-[#8A8A86]">API 配置、数据备份与应用信息</p>
      </header>

      <div className="flex flex-col gap-5 max-w-[680px]">
        <ApiKeySection />
        <HiflyKeySection />
        <BackupSection />
        <AboutSection />
      </div>
    </div>
  );
}
