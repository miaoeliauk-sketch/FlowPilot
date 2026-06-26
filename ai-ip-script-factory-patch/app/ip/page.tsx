"use client";
import { useState, useEffect } from "react";
import { useIP } from "@/lib/ip-context";
import { IPProfile } from "@/lib/types";
import { getTopicAssets, getCommentAssets, getScriptAssets } from "@/lib/ip-store";
import { buildIPContextBlock } from "@/lib/ip-prompt";

const PLATFORM_OPTIONS = ["抖音", "小红书", "B站", "视频号", "微博", "公众号"];

interface FormState {
  name: string;
  positioning: string;
  platforms: string[];
  audience: string;
  contentDirection: string[];
  personaKeywords: string[];
  professionalIdentity: string;
  personalityTags: string[];
  credibilitySource: string;
  representativeViewpoints: string[];
  tone: string;
  commonOpenings: string[];
  commonClosings: string[];
  catchphrases: string[];
  forbiddenExpressions: string[];
  pacing: string;
  commonScenes: string[];
  commonShotTypes: string[];
  showsFace: boolean;
  usesScreenRecording: boolean;
  needsBroll: boolean;
  needsCaseScreenshots: boolean;
  needsSubtitleHighlight: boolean;
  sampleViralTitles: string[];
  styleNotes: string;
  bio: string;
}

const EMPTY_FORM: FormState = {
  name: "", positioning: "", platforms: [], audience: "", contentDirection: [],
  personaKeywords: [], professionalIdentity: "", personalityTags: [], credibilitySource: "", representativeViewpoints: [],
  tone: "", commonOpenings: [], commonClosings: [], catchphrases: [], forbiddenExpressions: [], pacing: "",
  commonScenes: [], commonShotTypes: [],
  showsFace: true, usesScreenRecording: true, needsBroll: false, needsCaseScreenshots: true, needsSubtitleHighlight: true,
  sampleViralTitles: [], styleNotes: "", bio: "",
};

function Icon({ name }: { name: "edit" | "trash" | "plus" | "check" | "flask" }) {
  const paths: Record<string, JSX.Element> = {
    edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    trash: <><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16z"/></>,
    plus: <path d="M12 5v14M5 12h14" strokeLinecap="round"/>,
    check: <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round"/>,
    flask: <><path d="M9 2v6.5L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L15 8.5V2"/><path d="M7 14h10" strokeLinecap="round"/><path d="M9 2h6" strokeLinecap="round"/></>,
  };
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      {paths[name]}
    </svg>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 mt-2 text-[11.5px] font-bold uppercase tracking-wide text-[#A8C95A]">{children}</div>;
}

function TagListEditor({
  label, placeholder, values, onChange, hint,
}: {
  label: string; placeholder: string; values: string[]; onChange: (v: string[]) => void; hint?: string;
}) {
  const [input, setInput] = useState("");
  const add = () => {
    const v = input.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setInput("");
  };
  const remove = (v: string) => onChange(values.filter((x) => x !== v));
  return (
    <div>
      <label className="mb-1.5 block text-[12.5px] font-semibold text-[#555]">{label}</label>
      {hint && <p className="mb-1.5 text-[11px] text-[#AAA]">{hint}</p>}
      {values.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {values.map((v) => (
            <button
              key={v} type="button" onClick={() => remove(v)}
              className="rounded-full px-3 py-1.5 text-[12px] font-medium"
              style={{ background: "#C8F04A", color: "#1A1A1A" }}
            >
              {v} ×
            </button>
          ))}
        </div>
      )}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder={placeholder}
        className="w-full rounded-[10px] border border-[#EAEAE6] bg-[#FAFAF8] px-3 py-1.5 text-[12.5px] outline-none focus:border-[#C8F04A]"
      />
    </div>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button" onClick={() => onChange(!value)}
      className="flex items-center justify-between rounded-[10px] border border-[#EAEAE6] bg-[#FAFAF8] px-3 py-2 text-[12.5px]"
    >
      <span className="text-[#555]">{label}</span>
      <span className={`flex h-5 w-9 items-center rounded-full p-0.5 transition ${value ? "justify-end bg-[#C8F04A]" : "justify-start bg-[#DDD]"}`}>
        <span className="h-4 w-4 rounded-full bg-white shadow" />
      </span>
    </button>
  );
}

function TextField({ label, value, onChange, placeholder, rows }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <div>
      <label className="mb-1.5 block text-[12.5px] font-semibold text-[#555]">{label}</label>
      {rows ? (
        <textarea
          value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows}
          className="w-full resize-none rounded-[12px] border border-[#EAEAE6] bg-[#FAFAF8] px-3.5 py-2.5 text-[13.5px] outline-none focus:border-[#C8F04A]"
        />
      ) : (
        <input
          value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className="w-full rounded-[12px] border border-[#EAEAE6] bg-[#FAFAF8] px-3.5 py-2.5 text-[13.5px] outline-none focus:border-[#C8F04A]"
        />
      )}
    </div>
  );
}

function IPFormModal({
  initial, onClose, onSave,
}: {
  initial: FormState;
  onClose: () => void;
  onSave: (form: FormState) => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const togglePlatform = (p: string) => {
    setForm((f) => ({
      ...f,
      platforms: f.platforms.includes(p) ? f.platforms.filter((x) => x !== p) : [...f.platforms, p],
    }));
  };

  const canSave = form.name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={onClose}>
      <div className="card max-h-[88vh] w-full max-w-[600px] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 text-[16px] font-bold text-[#1A1A1A]">
          {initial.name ? "编辑 IP" : "新建 IP"}
        </div>

        <div className="flex flex-col gap-4">
          <TextField label="IP名称 *" value={form.name} onChange={(v) => set("name", v)} placeholder="例如：彭彭说AI" />

          <SectionTitle>基础信息</SectionTitle>
          <TextField label="IP定位" value={form.positioning} onChange={(v) => set("positioning", v)} placeholder="这个IP是做什么内容的，核心差异化是什么，账号处于什么阶段" rows={2} />
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-[#555]">运营平台</label>
            <div className="flex flex-wrap gap-2">
              {PLATFORM_OPTIONS.map((p) => (
                <button
                  key={p} type="button" onClick={() => togglePlatform(p)}
                  className="rounded-full px-3 py-1.5 text-[12px] font-medium transition-all"
                  style={form.platforms.includes(p) ? { background: "#C8F04A", color: "#1A1A1A" } : { background: "#F2F1ED", color: "#888" }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <TextField label="目标受众" value={form.audience} onChange={(v) => set("audience", v)} placeholder="例如：AI新手学习者、内容创作者" />
          <TagListEditor label="内容方向" hint="这个IP长期产出的内容主线，回车添加多个" placeholder="例如：AI工具实测，回车添加" values={form.contentDirection} onChange={(v) => set("contentDirection", v)} />

          <SectionTitle>人设信息</SectionTitle>
          <TagListEditor label="人设关键词" placeholder="例如：AI学习者，回车添加" values={form.personaKeywords} onChange={(v) => set("personaKeywords", v)} />
          <TextField label="专业身份" value={form.professionalIdentity} onChange={(v) => set("professionalIdentity", v)} placeholder="例如：AI内容创作者/自媒体新人操盘手" />
          <TagListEditor label="性格标签" placeholder="例如：真诚，回车添加" values={form.personalityTags} onChange={(v) => set("personalityTags", v)} />
          <TextField label="可信度来源" value={form.credibilitySource} onChange={(v) => set("credibilitySource", v)} placeholder="为什么观众该信你说的话" rows={2} />
          <TagListEditor label="代表观点" placeholder="这个IP反复强调的核心观点，回车添加" values={form.representativeViewpoints} onChange={(v) => set("representativeViewpoints", v)} />

          <SectionTitle>表达风格</SectionTitle>
          <TextField label="说话语气" value={form.tone} onChange={(v) => set("tone", v)} placeholder="例如：亲切真诚的同行者视角 / 专业老练直接给结论" rows={2} />
          <TagListEditor label="常用开头" placeholder="例如：最近我发现一个特别好用的工具，回车添加" values={form.commonOpenings} onChange={(v) => set("commonOpenings", v)} />
          <TagListEditor label="常用结尾" placeholder="例如：关注我一起进化，回车添加" values={form.commonClosings} onChange={(v) => set("commonClosings", v)} />
          <TagListEditor label="常用口头禅" placeholder="例如：说实话，回车添加" values={form.catchphrases} onChange={(v) => set("catchphrases", v)} />
          <TagListEditor label="禁用表达" placeholder="例如：颠覆性，回车添加" values={form.forbiddenExpressions} onChange={(v) => set("forbiddenExpressions", v)} />
          <TextField label="文案节奏" value={form.pacing} onChange={(v) => set("pacing", v)} placeholder="例如：节奏偏慢，留出停顿 / 节奏偏快，信息密度高" />

          <SectionTitle>拍摄信息</SectionTitle>
          <TagListEditor label="常用拍摄场景" placeholder="例如：居家书桌前，回车添加" values={form.commonScenes} onChange={(v) => set("commonScenes", v)} />
          <TagListEditor label="常用镜头形式" placeholder="例如：正面口播为主，回车添加" values={form.commonShotTypes} onChange={(v) => set("commonShotTypes", v)} />
          <div className="grid grid-cols-2 gap-2">
            <ToggleRow label="是否露脸" value={form.showsFace} onChange={(v) => set("showsFace", v)} />
            <ToggleRow label="是否录屏" value={form.usesScreenRecording} onChange={(v) => set("usesScreenRecording", v)} />
            <ToggleRow label="是否需要B-roll" value={form.needsBroll} onChange={(v) => set("needsBroll", v)} />
            <ToggleRow label="是否需要案例截图" value={form.needsCaseScreenshots} onChange={(v) => set("needsCaseScreenshots", v)} />
            <ToggleRow label="字幕重点强调" value={form.needsSubtitleHighlight} onChange={(v) => set("needsSubtitleHighlight", v)} />
          </div>

          <SectionTitle>历史内容参考</SectionTitle>
          <TagListEditor label="历史爆款标题" hint="供AI参考爆款规律，回车添加多个" placeholder="例如：我花了一周搞懂的AI工具，回车添加" values={form.sampleViralTitles} onChange={(v) => set("sampleViralTitles", v)} />
          <TextField label="账号爆款风格说明" value={form.styleNotes} onChange={(v) => set("styleNotes", v)} placeholder="总结一下这个账号过往爆款内容的共性规律" rows={2} />

          <TextField label="账号简介 / Bio" value={form.bio} onChange={(v) => set("bio", v)} rows={2} />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-[12px] px-4 py-2 text-[13px] font-medium text-[#888] hover:bg-[#F2F1ED]">取消</button>
          <button
            disabled={!canSave}
            onClick={() => canSave && onSave(form)}
            className="rounded-[12px] px-4 py-2 text-[13px] font-bold disabled:opacity-40"
            style={{ background: "#C8F04A", color: "#1A1A1A" }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteModal({ ip, onClose, onConfirm }: { ip: IPProfile; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={onClose}>
      <div className="card w-full max-w-[380px] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 text-[15px] font-bold text-[#1A1A1A]">删除「{ip.name}」？</div>
        <p className="mb-5 text-[13px] leading-6 text-[#888]">删除后该IP的基础信息将无法恢复，已归档的选题/脚本/评论资产暂不会被删除。</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-[12px] px-4 py-2 text-[13px] font-medium text-[#888] hover:bg-[#F2F1ED]">取消</button>
          <button onClick={onConfirm} className="rounded-[12px] px-4 py-2 text-[13px] font-bold" style={{ background: "#E0608E", color: "#fff" }}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

// ── 测试/调试模态框：验证IP切换是否真正影响AI调用 ──
function DebugModal({
  ip, isActive, onClose,
}: { ip: IPProfile; isActive: boolean; onClose: () => void }) {
  const promptBlock = buildIPContextBlock(ip);
  const [tab, setTab] = useState<"prompt" | "raw" | "context">("prompt");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={onClose}>
      <div className="card max-h-[85vh] w-full max-w-[640px] overflow-hidden p-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#F0EFE9] px-5 py-4">
          <div className="text-[15px] font-bold text-[#1A1A1A]">「{ip.name}」上下文检查</div>
          <button onClick={onClose} className="text-[13px] text-[#999]">关闭</button>
        </div>
        <div className="flex gap-1 px-5 pt-3">
          {[
            { k: "prompt", label: "实际注入Prompt" },
            { k: "context", label: "全局上下文状态" },
            { k: "raw", label: "IP原始数据" },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k as "prompt" | "raw" | "context")}
              className="rounded-[10px] px-3 py-1.5 text-[12px] font-semibold"
              style={tab === t.k ? { background: "#C8F04A", color: "#1A1A1A" } : { background: "#F2F1ED", color: "#888" }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-5">
          {tab === "prompt" && (
            <>
              <p className="mb-3 text-[11.5px] text-[#999]">
                这段文字会被原样拼接进每一次AI调用的Prompt里（选题董事会、脚本工厂都使用同一份）。
              </p>
              <pre className="whitespace-pre-wrap rounded-[12px] bg-[#FAFAF8] p-4 text-[12px] leading-6 text-[#333]">{promptBlock}</pre>
            </>
          )}
          {tab === "context" && (
            <>
              <p className="mb-3 text-[11.5px] text-[#999]">
                这是当前全局 useIP() Context 中实际保存的状态，证明"当前操盘IP"不是局部UI高亮，而是真正的全局状态。
              </p>
              <div className="rounded-[12px] bg-[#FAFAF8] p-4 text-[13px] text-[#333]">
                <div className="mb-1">查看的IP：<b>{ip.name}</b>（id: {ip.id}）</div>
                <div className={isActive ? "font-bold text-[#3B6D11]" : "text-[#A32D2D]"}>
                  {isActive ? "✓ 这正是当前全局激活的IP（currentIP.id === 此IP.id）" : "✗ 这不是当前全局激活的IP"}
                </div>
              </div>
            </>
          )}
          {tab === "raw" && (
            <pre className="whitespace-pre-wrap rounded-[12px] bg-[#FAFAF8] p-4 text-[11.5px] leading-5 text-[#333]">
              {JSON.stringify(ip, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export default function IPCenterPage() {
  const { ips, activeIP, switchIP, createIP, updateIP, deleteIP, loading } = useIP();
  const [editing, setEditing] = useState<IPProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<IPProfile | null>(null);
  const [debugging, setDebugging] = useState<IPProfile | null>(null);
  const [assetCounts, setAssetCounts] = useState<Record<string, { topics: number; comments: number; scripts: number }>>({});

  useEffect(() => {
    const counts: Record<string, { topics: number; comments: number; scripts: number }> = {};
    ips.forEach((ip) => {
      counts[ip.id] = { topics: getTopicAssets(ip.id).length, comments: getCommentAssets(ip.id).length, scripts: getScriptAssets(ip.id).length };
    });
    setAssetCounts(counts);
  }, [ips]);

  if (loading) return <div className="p-6 text-[13px] text-[#999]">加载中…</div>;

  const handleSave = (form: FormState) => {
    if (editing) {
      updateIP(editing.id, form);
      setEditing(null);
    } else {
      createIP({ ...form, avatar: form.name.slice(0, 1) });
      setCreating(false);
    }
  };

  return (
    <div className="max-w-[1000px]">
      <header className="mb-6">
        <h1 className="text-[22px] font-bold text-[#1A1A1A]">IP身份中心</h1>
        <p className="mt-1 text-[13px] text-[#999]">
          管理你操盘的所有IP身份。AI选题董事会和AI IP脚本工厂都会基于「当前操盘IP」的人设、受众、表达风格与拍摄习惯生成内容，不同IP产出不同结论。
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ips.map((ip) => {
          const isActiveIP = ip.id === activeIP?.id;
          const counts = assetCounts[ip.id] ?? { topics: 0, comments: 0, scripts: 0 };
          return (
            <div key={ip.id} className="card flex flex-col gap-3 p-5" style={isActiveIP ? { boxShadow: "0 0 0 2px #C8F04A, 0 2px 12px rgba(0,0,0,0.06)" } : undefined}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white" style={{ background: ip.color }}>
                    {ip.avatar}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-bold text-[#1A1A1A]">{ip.name}</span>
                      {isActiveIP && (
                        <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "#E4F9C0", color: "#2A5A0A" }}>
                          <Icon name="check" /> 使用中
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {ip.platforms.map((p) => <span key={p} className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10.5px] text-[#888]">{p}</span>)}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setDebugging(ip)} className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[#999] hover:bg-[#EAF3DE] hover:text-[#3B6D11]" title="测试/查看上下文">
                    <Icon name="flask" />
                  </button>
                  <button onClick={() => setEditing(ip)} className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[#999] hover:bg-[#F2F1ED] hover:text-[#1A1A1A]">
                    <Icon name="edit" />
                  </button>
                  <button onClick={() => setDeleting(ip)} className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[#999] hover:bg-[#FCEBEB] hover:text-[#A32D2D]">
                    <Icon name="trash" />
                  </button>
                </div>
              </div>

              {ip.positioning && <p className="text-[12.5px] leading-5 text-[#666]">{ip.positioning}</p>}

              {ip.tone && (
                <div className="rounded-[10px] bg-[#F2F1ED] px-3 py-2 text-[11.5px] leading-5 text-[#666]">
                  <span className="font-semibold text-[#555]">表达风格：</span>{ip.tone}
                </div>
              )}

              {ip.contentDirection.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {ip.contentDirection.map((c) => (
                    <span key={c} className="rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ background: "#EAF3DE", color: "#3B6D11" }}>{c}</span>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-4 border-t border-[#F0EFE9] pt-3 text-[11.5px] text-[#AAA]">
                <span>受众：{ip.audience || "未填写"}</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex gap-3 text-[11.5px] text-[#999]">
                  <span>📋 选题 {counts.topics}</span>
                  <span>🎬 脚本 {counts.scripts}</span>
                  <span>💬 评论 {counts.comments}</span>
                </div>
                {!isActiveIP && (
                  <button onClick={() => switchIP(ip.id)} className="rounded-[10px] px-3 py-1.5 text-[11.5px] font-bold" style={{ background: "#F2F1ED", color: "#555" }}>
                    设为当前操盘IP
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <button
          onClick={() => setCreating(true)}
          className="card flex min-h-[180px] flex-col items-center justify-center gap-2 border-2 border-dashed border-[#E5E4DE] bg-transparent p-5 text-[#999] shadow-none hover:border-[#C8F04A] hover:text-[#639922]"
        >
          <Icon name="plus" />
          <span className="text-[13px] font-medium">新建 IP 身份</span>
        </button>
      </div>

      {(creating || editing) && (
        <IPFormModal
          initial={editing ? { ...editing } : EMPTY_FORM}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSave={handleSave}
        />
      )}

      {deleting && <ConfirmDeleteModal ip={deleting} onClose={() => setDeleting(null)} onConfirm={() => { deleteIP(deleting.id); setDeleting(null); }} />}

      {debugging && <DebugModal ip={debugging} isActive={debugging.id === activeIP?.id} onClose={() => setDebugging(null)} />}
    </div>
  );
}
