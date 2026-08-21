"use client";
import { apiFetch } from "@/lib/api-fetch";
import { useState, useEffect, useRef } from "react";
import { useIP } from "@/lib/ip-context";
import { getIPDisplayLabel } from "@/lib/ip-display";
import { IPProfile, VoiceSample, IPStyleProfile } from "@/lib/types";
import { getTopicAssets, getCommentAssets, getScriptAssets, getKnowledgeEntries, getVoiceSamples, addVoiceSample, deleteVoiceSample, getStyleProfile, saveStyleProfile } from "@/lib/ip-store";
import { buildIPContextBlock } from "@/lib/ip-prompt";
import { buildVoiceStyleProfileForSave, getDefaultVoiceStyleSampleIds } from "@/lib/voice-style-profile";
import { Icon } from "@/components/ui/icon";
import { Select } from "@/components/ui/select";
import { SCRIPT_DIRECTOR_PROFILE_OPTIONS, type ScriptDirectorProfileId } from "@/lib/script-director-profile";
import {
  calculateScriptDirectorRuleContentHash,
  parseScriptDirectorRule,
  type ScriptDirectorRule,
  type ScriptDirectorRuleEnforcement,
  type ScriptDirectorRuleItem,
  type ScriptDirectorRuleLevel,
  type ScriptDirectorRuleScope,
  type ScriptDirectorRuleTestType,
} from "@/lib/script-director-rule";
import {
  getScriptDirectorRules,
  markScriptDirectorRuleTestCompleted,
  saveScriptDirectorRule,
  setScriptDirectorRuleActive,
} from "@/lib/script-director-rule-store";
import { detectScriptDirectorExampleContamination } from "@/lib/script-director-rule-contamination";
import type { ScriptDirectorRuleTestGenerationResult } from "@/lib/script-director-rule-test-generation";

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
  scriptDirectorProfileId: ScriptDirectorProfileId | null;
  bio: string;
}

const EMPTY_FORM: FormState = {
  name: "", positioning: "", platforms: [], audience: "", contentDirection: [],
  personaKeywords: [], professionalIdentity: "", personalityTags: [], credibilitySource: "", representativeViewpoints: [],
  tone: "", commonOpenings: [], commonClosings: [], catchphrases: [], forbiddenExpressions: [], pacing: "",
  commonScenes: [], commonShotTypes: [],
  showsFace: true, usesScreenRecording: true, needsBroll: false, needsCaseScreenshots: true, needsSubtitleHighlight: true,
  sampleViralTitles: [], styleNotes: "", scriptDirectorProfileId: null, bio: "",
};

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

          <SectionTitle>脚本工厂专属规则</SectionTitle>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-[#555]">专属编导规则</label>
            <p className="mb-1.5 text-[11px] leading-5 text-[#AAA]">只影响脚本工厂的素材分工、推理和表达，不会替代知识库中的老师原始观点。</p>
            <Select
              value={form.scriptDirectorProfileId ?? ""}
              onChange={(value) => set("scriptDirectorProfileId", value ? value as ScriptDirectorProfileId : null)}
              options={[
                { value: "", label: "不使用专属编导规则" },
                ...SCRIPT_DIRECTOR_PROFILE_OPTIONS,
              ]}
            />
          </div>

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
        <p className="mb-5 text-[13px] leading-6 text-[#888]">删除后该IP的基础信息将无法恢复，已归档的选题、脚本、评论、语料和语气画像暂不会被删除。</p>
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

// ── 口播逐字稿样本库 + 风格学习：IP风格改写引擎的数据来源 ──
const SAMPLE_TYPE_OPTIONS: VoiceSample["type"][] = ["口播逐字稿", "文案", "视频字幕", "其他"];

interface ExtractApiMeta { apiCalled: boolean; calledAt: string; model: string | null; ipUsed: string | null; mockHit: boolean; error?: string; }

function VoiceSampleModal({ ip, onClose }: { ip: IPProfile; onClose: () => void }) {
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [selectedSampleIds, setSelectedSampleIds] = useState<string[]>([]);
  const [profile, setProfile] = useState<IPStyleProfile | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<VoiceSample["type"]>("口播逐字稿");
  const [rawText, setRawText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractMeta, setExtractMeta] = useState<ExtractApiMeta | null>(null);

  useEffect(() => {
    const storedSamples = getVoiceSamples(ip.id);
    setSamples(storedSamples);
    setSelectedSampleIds(getDefaultVoiceStyleSampleIds(storedSamples));
    setProfile(getStyleProfile(ip.id));
  }, [ip.id]);

  const handleAdd = () => {
    if (!rawText.trim()) return;
    const added = addVoiceSample({ ipId: ip.id, title: title.trim() || `未命名样本${samples.length + 1}`, type, rawText: rawText.trim(), note: "" });
    setSamples(getVoiceSamples(ip.id));
    setSelectedSampleIds((current) => current.length < 5 ? [...current, added.id] : current);
    setTitle(""); setRawText(""); setType("口播逐字稿"); setShowAddForm(false);
  };

  const handleDelete = (id: string) => {
    deleteVoiceSample(id);
    setSamples(getVoiceSamples(ip.id));
    setSelectedSampleIds((current) => current.filter((sampleId) => sampleId !== id));
  };

  const toggleSample = (id: string) => {
    setSelectedSampleIds((current) => {
      if (current.includes(id)) return current.filter((sampleId) => sampleId !== id);
      if (current.length >= 5) {
        setExtractError("一次最多选择5篇样本");
        return current;
      }
      setExtractError(null);
      return [...current, id];
    });
  };

  const handleExtract = async () => {
    const selectedSamples = samples.filter((sample) => selectedSampleIds.includes(sample.id));
    if (selectedSamples.length === 0) { setExtractError("请先选择至少1篇样本，建议3-5篇效果更稳定"); return; }
    setShowAddForm(false);
    setExtracting(true); setExtractError(null);
    try {
      const res = await apiFetch("/api/voice-style-extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ipName: ip.name, samples: selectedSamples.map(s => ({ id: s.id, title: s.title, rawText: s.rawText })) }),
      });
      const data = await res.json();
      if (data.apiMeta) setExtractMeta(data.apiMeta);
      if (!res.ok) { setExtractError(data.error ?? `HTTP ${res.status}`); return; }
      const newProfile = buildVoiceStyleProfileForSave(data, ip.id);
      if (!newProfile) {
        setExtractError("AI返回的风格画像不完整，本次结果未保存，请重试");
        return;
      }
      saveStyleProfile(newProfile);
      setProfile(newProfile);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "风格提取失败，请重试");
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={onClose}>
      <div className="card max-h-[88vh] w-full max-w-[680px] overflow-hidden p-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#F0EFE9] px-5 py-4">
          <div>
            <div className="text-[15px] font-bold text-[#1A1A1A]">「{ip.name}」口播逐字稿样本库</div>
            <p className="mt-0.5 text-[11.5px] text-[#999]">添加3-5篇真实逐字稿，AI会学习这个IP的语感，供「文案改写工作台」改写时优先参考。</p>
          </div>
          <button onClick={onClose} className="text-[13px] text-[#999]">关闭</button>
        </div>

        <div className="max-h-[calc(88vh-72px)] overflow-y-auto p-5">
          {/* 已学习的风格画像 */}
          {profile && (
            <div className="mb-5 rounded-[14px] border border-[#C8F04A] bg-[#FBFEF2] p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-[#3B6D11]">
                  <Icon name="sparkle" /> 已学习的风格画像
                </div>
                <span className="text-[11px] text-[#888]">基于 {profile.sourceSampleTitles.length} 篇样本 · {new Date(profile.extractedAt).toLocaleString()}</span>
              </div>
              <p className="mb-3 text-[12.5px] leading-5 text-[#444]">{profile.styleSummary}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-[10px] bg-white p-2.5"><div className="mb-1 text-[10.5px] font-bold text-[#639922]">开头习惯</div><div className="text-[12px] leading-5 text-[#333]">{profile.openingHabits.join("；") || "无"}</div></div>
                <div className="rounded-[10px] bg-white p-2.5"><div className="mb-1 text-[10.5px] font-bold text-[#639922]">结尾方式</div><div className="text-[12px] leading-5 text-[#333]">{profile.closingHabits.join("；") || "无"}</div></div>
                <div className="rounded-[10px] bg-white p-2.5"><div className="mb-1 text-[10.5px] font-bold text-[#639922]">观点表达方式</div><div className="text-[12px] leading-5 text-[#333]">{profile.viewpointStyle || "无"}</div></div>
                <div className="rounded-[10px] bg-white p-2.5"><div className="mb-1 text-[10.5px] font-bold text-[#639922]">句子长度</div><div className="text-[12px] leading-5 text-[#333]">{profile.sentenceLength}</div></div>
                <div className="rounded-[10px] bg-white p-2.5"><div className="mb-1 text-[10.5px] font-bold text-[#639922]">情绪风格</div><div className="text-[12px] leading-5 text-[#333]">{profile.emotionalTone.join("、") || "无"}</div></div>
                <div className="rounded-[10px] bg-white p-2.5"><div className="mb-1 text-[10.5px] font-bold text-[#639922]">常用词</div><div className="text-[12px] leading-5 text-[#333]">{profile.commonPhrases.join("、") || "无"}</div></div>
                <div className="rounded-[10px] bg-white p-2.5 sm:col-span-2"><div className="mb-1 text-[10.5px] font-bold text-[#A32D2D]">禁用表达（从样本反推）</div><div className="text-[12px] leading-5 text-[#333]">{profile.forbiddenExpressions.join("、") || "无"}</div></div>
              </div>
            </div>
          )}

          {extractError && <div className="mb-3 rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{extractError}</div>}

          {extractMeta && (
            <div className="mb-4 rounded-[10px] border border-[#E5E4DE] bg-[#FAFAF8] p-3 font-mono text-[11px]">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#888]">提取API调用状态（调试）</div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                <div><span className="text-[#999]">apiCalled: </span><span className={extractMeta.apiCalled ? "font-bold text-[#3B6D11]" : "font-bold text-[#A32D2D]"}>{String(extractMeta.apiCalled)}</span></div>
                <div><span className="text-[#999]">model: </span><span className="text-[#333]">{extractMeta.model ?? "-"}</span></div>
                <div><span className="text-[#999]">ipUsed: </span><span className="text-[#333]">{extractMeta.ipUsed ?? "-"}</span></div>
                <div><span className="text-[#999]">calledAt: </span><span className="text-[#333]">{extractMeta.calledAt}</span></div>
              </div>
            </div>
          )}

          <button
            onClick={handleExtract}
            disabled={extracting || selectedSampleIds.length === 0}
            className="mb-5 flex w-full items-center justify-center gap-2 rounded-[12px] bg-[#1C1C1B] px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            <Icon name="sparkle" /> {extracting ? "学习中，请稍候，请勿重复点击" : profile ? "重新学习风格" : "学习风格"}
          </button>

          {/* 样本列表 */}
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-[12px] font-bold text-[#888]">样本列表（{samples.length}篇）</div>
              <div className="mt-0.5 text-[10.5px] text-[#AAA]">本次已选{selectedSampleIds.length}/5篇，默认选择前5篇</div>
            </div>
            <button disabled={extracting} onClick={() => setShowAddForm(v => !v)} className="flex items-center gap-1 rounded-[8px] bg-[#F2F1ED] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#555] disabled:opacity-40">
              <Icon name="plus" /> 添加样本
            </button>
          </div>

          {showAddForm && (
            <div className="mb-4 rounded-[12px] border border-[#E5E4DE] bg-[#FAFAF8] p-3.5">
              <div className="mb-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="样本标题，例如《AI工作流教程》" className="w-full rounded-[10px] border border-[#E5E4DE] bg-white px-3 py-2 text-[12.5px]" />
                <Select value={type} onChange={(v) => setType(v as VoiceSample["type"])} options={SAMPLE_TYPE_OPTIONS} />
              </div>
              <textarea
                value={rawText} onChange={e => setRawText(e.target.value)}
                placeholder="粘贴这篇逐字稿的完整原文…"
                rows={6}
                className="w-full resize-y rounded-[10px] border border-[#E5E4DE] bg-white px-3 py-2.5 text-[12.5px] leading-5"
              />
              <div className="mt-2.5 flex justify-end gap-2">
                <button onClick={() => setShowAddForm(false)} className="rounded-[10px] px-3 py-1.5 text-[12px] font-medium text-[#888]">取消</button>
                <button onClick={handleAdd} disabled={!rawText.trim()} className="rounded-[10px] px-3.5 py-1.5 text-[12px] font-bold disabled:opacity-40" style={{ background: "#C8F04A", color: "#1A1A1A" }}>保存样本</button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {samples.length === 0 && !showAddForm && (
              <div className="rounded-[12px] border border-dashed border-[#E5E4DE] py-8 text-center text-[12.5px] text-[#999]">
                还没有样本，点击上方"添加样本"开始积累。
              </div>
            )}
            {samples.map(s => (
              <div key={s.id} className="flex items-start justify-between gap-3 rounded-[10px] border border-[#F0EFE9] p-3">
                <button
                  type="button"
                  onClick={() => toggleSample(s.id)}
                  disabled={extracting}
                  className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border text-[11px] ${selectedSampleIds.includes(s.id) ? "border-[#639922] bg-[#C8F04A] text-[#1A1A1A]" : "border-[#D7D6D0] bg-white text-transparent"}`}
                  aria-label={`${selectedSampleIds.includes(s.id) ? "取消选择" : "选择"}${s.title}`}
                >
                  ✓
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-[#1C1C1B]">{s.title}</span>
                    <span className="whitespace-nowrap rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10px] text-[#888]">{s.type}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-[#999]">{s.rawText.slice(0, 100)}…</p>
                  <div className="mt-1 text-[10.5px] text-[#BBB]">{s.rawText.trim().length}字 · {new Date(s.createdAt).toLocaleDateString()}</div>
                </div>
                <button
                  disabled={extracting}
                  onClick={() => handleDelete(s.id)}
                  aria-label={`删除${s.title}`}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] text-[#999] hover:bg-[#FCEBEB] hover:text-[#A32D2D] disabled:opacity-40"
                >
                  <Icon name="trash" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const DIRECTOR_LEVEL_LABELS: Record<ScriptDirectorRuleLevel, string> = {
  hard_block: "硬阻断",
  quality_warning: "质量提醒",
  preference: "风格偏好",
};

const DIRECTOR_ENFORCEMENT_LABELS: Record<ScriptDirectorRuleEnforcement, string> = {
  deterministic: "程序检查",
  model_review: "模型审查",
  prompt_only: "Prompt指导",
};

const DIRECTOR_SCOPE_LABELS: Record<ScriptDirectorRuleScope, string> = {
  title: "标题",
  opening: "开头",
  body: "正文",
  ending: "结尾",
  fact: "事实",
  attribution: "观点归属",
  compression: "压缩",
  output: "最终输出",
};

const MAX_DIRECTOR_RULE_FILE_BYTES = 200_000;

function DirectorRuleItems({ items }: { items: ScriptDirectorRuleItem[] }) {
  if (items.length === 0) return <div className="text-[11.5px] text-[#AAA]">未识别到明确规则</div>;
  return (
    <div className="space-y-2">
      {items.map(item => (
        <div key={item.id} className="rounded-[10px] border border-[#EEEDE8] bg-white p-2.5">
          <div className="text-[12px] leading-5 text-[#333]">{item.text}</div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-[#777]">
            <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5">{DIRECTOR_LEVEL_LABELS[item.level]}</span>
            <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5">{DIRECTOR_ENFORCEMENT_LABELS[item.enforcement]}</span>
            <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5">作用范围：{DIRECTOR_SCOPE_LABELS[item.scope]}（{item.scope}）</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function DirectorPreviewSection({ title, items }: { title: string; items: ScriptDirectorRuleItem[] }) {
  return (
    <section>
      <div className="mb-2 text-[11.5px] font-bold text-[#639922]">{title}</div>
      <DirectorRuleItems items={items} />
    </section>
  );
}

function ScriptDirectorRuleModal({ ip, onClose }: { ip: IPProfile; onClose: () => void }) {
  const [rules, setRules] = useState<ScriptDirectorRule[]>([]);
  const [rawMarkdown, setRawMarkdown] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScriptDirectorRule | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testingRuleId, setTestingRuleId] = useState<string | null>(null);
  const [testTopics, setTestTopics] = useState<Record<ScriptDirectorRuleTestType, string>>({
    familiar: "",
    unfamiliar: "",
    stress: "",
  });
  const [testResults, setTestResults] = useState<Partial<Record<ScriptDirectorRuleTestType, ScriptDirectorRuleTestGenerationResult>>>({});
  const [testing, setTesting] = useState(false);
  const [testProgress, setTestProgress] = useState<string | null>(null);
  const testRunSequence = useRef(0);

  const reloadRules = () => {
    try {
      setRules(getScriptDirectorRules(ip.id));
      setError(null);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "专属编导规则读取失败");
    }
  };

  useEffect(() => {
    reloadRules();
    setRawMarkdown("");
    setFileName(null);
    setPreview(null);
    setNotice(null);
    setTestingRuleId(null);
    setTestTopics({ familiar: "", unfamiliar: "", stress: "" });
    setTestResults({});
    setTesting(false);
    setTestProgress(null);
    testRunSequence.current += 1;
    return () => {
      testRunSequence.current += 1;
    };
  }, [ip.id]);

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.(md|txt)$/i.test(file.name)) {
      setError("仅支持.md或.txt规则文档");
      return;
    }
    if (file.size > MAX_DIRECTOR_RULE_FILE_BYTES) {
      setError("规则文档文件过大，请控制在200KB以内");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      if (!text.trim()) {
        setError("规则文档内容为空");
        return;
      }
      if (text.length > 50_000) {
        setError("规则文档最多50000字");
        return;
      }
      setRawMarkdown(text);
      setFileName(file.name);
      setPreview(null);
      setNotice(null);
      setError(null);
    };
    reader.onerror = () => setError("规则文档读取失败，请重新选择");
    reader.readAsText(file, "utf-8");
  };

  const handleParse = async () => {
    const source = rawMarkdown;
    if (!source.trim()) {
      setError("请上传或粘贴专属编导规则文档");
      return;
    }
    if (source.length > 50_000) {
      setError("规则文档最多50000字");
      return;
    }
    setParsing(true);
    setError(null);
    setNotice(null);
    setPreview(null);
    try {
      const response = await apiFetch("/api/script-director-rule/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ipProfile: { id: ip.id, name: ip.name, audience: ip.audience },
          rawMarkdown: source,
          fileName,
        }),
      });
      const data = await response.json() as { rule?: unknown; error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      const parsed = parseScriptDirectorRule(data.rule);
      if (!parsed.ok) throw new Error("AI返回的专属规则结构不完整，请重试");
      if (parsed.rule.ipId !== ip.id) throw new Error("解析结果不属于当前IP，已拒绝预览");
      if (parsed.rule.source.rawMarkdown !== source
        || parsed.rule.source.contentHash !== calculateScriptDirectorRuleContentHash(source)) {
        throw new Error("解析结果与本次规则原文不一致，已拒绝预览");
      }
      setPreview(parsed.rule);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "规则解析失败，请重试");
    } finally {
      setParsing(false);
    }
  };

  const handleConfirmSave = () => {
    if (!preview) return;
    const contamination = detectScriptDirectorExampleContamination(preview);
    if (!contamination.canSave) {
      setError("示例名称重复超过3次，请修改规则文档后重新解析");
      return;
    }
    try {
      saveScriptDirectorRule(preview);
      reloadRules();
      setPreview(null);
      setNotice("规则已保存，完成三类测试后才能启用");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "专属编导规则保存失败");
    }
  };

  const contamination = preview ? detectScriptDirectorExampleContamination(preview) : null;

  const handleToggle = (rule: ScriptDirectorRule) => {
    try {
      setScriptDirectorRuleActive(ip.id, rule.id, rule.status !== "active");
      reloadRules();
      setNotice(rule.status === "active" ? "规则已停用" : "规则已启用");
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "专属编导规则状态更新失败");
    }
  };

  const openRuleTest = (rule: ScriptDirectorRule) => {
    testRunSequence.current += 1;
    setTestingRuleId(rule.id);
    setTestTopics({ familiar: "", unfamiliar: "", stress: "" });
    setTestResults({});
    setTestProgress(null);
    setError(null);
    setNotice(null);
  };

  const handleRunRuleTests = async (rule: ScriptDirectorRule) => {
    const testTypes: ScriptDirectorRuleTestType[] = ["familiar", "unfamiliar", "stress"];
    if (testTypes.some(testType => !testTopics[testType].trim())) {
      setError("请填写熟悉题、陌生题和压力题后再开始测试");
      return;
    }
    const runId = testRunSequence.current + 1;
    testRunSequence.current = runId;
    setTesting(true);
    setError(null);
    setNotice(null);
    setTestResults({});
    const completed: Partial<Record<ScriptDirectorRuleTestType, ScriptDirectorRuleTestGenerationResult>> = {};
    try {
      const knowledgeContext = getKnowledgeEntries()
        .filter(entry => entry.ipId === ip.id)
        .map(entry => ({
          id: entry.id,
          ipId: entry.ipId,
          category: entry.category,
          title: entry.title,
          rawContent: entry.rawContent,
        }));
      for (let index = 0; index < testTypes.length; index += 1) {
        const testType = testTypes[index]!;
        setTestProgress(`正在生成第${index + 1}/3类测试稿`);
        const response = await apiFetch("/api/script-director-rule/test-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ipProfile: ip, rule, testType, topic: testTopics[testType], knowledgeContext }),
        });
        const data = await response.json() as { result?: ScriptDirectorRuleTestGenerationResult; error?: string };
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!data.result
          || data.result.testType !== testType
          || data.result.topic !== testTopics[testType].trim()
          || !data.result.title.trim()
          || !data.result.fullScript.trim()) {
          throw new Error("测试生成返回内容不完整，请重试");
        }
        if (testRunSequence.current !== runId) return;
        completed[testType] = data.result;
        setTestResults({ ...completed });
      }
      if (testRunSequence.current !== runId) return;
      markScriptDirectorRuleTestCompleted(ip.id, rule.id, {
        completedAt: new Date().toISOString(),
        testTypes,
      });
      reloadRules();
      setNotice("三类测试已完成，现在可以正式启用这份规则");
    } catch (testError) {
      if (testRunSequence.current !== runId) return;
      setError(testError instanceof Error ? testError.message : "测试生成失败，请重试");
    } finally {
      if (testRunSequence.current === runId) {
        setTesting(false);
        setTestProgress(null);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={() => {
      if (!parsing && !testing) onClose();
    }}>
      <div className="card max-h-[92vh] w-full max-w-[820px] overflow-hidden p-0" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#F0EFE9] px-5 py-4">
          <div>
            <div className="text-[15px] font-bold text-[#1A1A1A]">「{ip.name}」专属编导规则</div>
            <p className="mt-0.5 text-[11.5px] text-[#999]">上传或粘贴规则文档，AI只负责结构化；确认预览前不会保存。</p>
          </div>
          <button disabled={parsing || testing} onClick={onClose} className="text-[13px] text-[#999] disabled:opacity-40">关闭</button>
        </div>

        <div className="max-h-[calc(92vh-72px)] space-y-5 overflow-y-auto p-5">
          {error && <div className="rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{error}</div>}
          {notice && <div className="rounded-[10px] bg-[#FBFEF2] px-3 py-2 text-[12.5px] text-[#3B6D11]">{notice}</div>}

          <section className="rounded-[14px] border border-[#E5E4DE] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[13px] font-bold text-[#333]">导入规则文档</div>
                <div className="mt-0.5 text-[11px] text-[#999]">支持Markdown或纯文本，最多50000字。</div>
              </div>
              <label className="cursor-pointer rounded-[10px] bg-[#F2F1ED] px-3 py-1.5 text-[12px] font-semibold text-[#555]">
                上传.md/.txt
                <input
                  aria-label="上传规则文档"
                  type="file"
                  accept=".md,.txt,text/markdown,text/plain"
                  className="hidden"
                  disabled={parsing}
                  onChange={handleFile}
                />
              </label>
            </div>
            {fileName && <div className="mb-2 text-[11px] text-[#639922]">已读取：{fileName}</div>}
            <textarea
              aria-label="规则文档内容"
              value={rawMarkdown}
              onChange={event => {
                setRawMarkdown(event.target.value);
                setFileName(null);
                setPreview(null);
                setNotice(null);
              }}
              disabled={parsing}
              rows={10}
              placeholder="在这里粘贴完整的IP专属编导规则……"
              className="w-full resize-y rounded-[12px] border border-[#E5E4DE] bg-[#FAFAF8] px-3.5 py-2.5 text-[12.5px] leading-5 outline-none focus:border-[#C8F04A] disabled:opacity-60"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-[11px] text-[#AAA]">{rawMarkdown.length}字</span>
              <button
                onClick={handleParse}
                disabled={parsing || !rawMarkdown.trim()}
                className="rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-40"
              >
                {parsing ? "AI解析中，请稍候" : "AI解析并预览"}
              </button>
            </div>
          </section>

          {preview && (
            <section className="rounded-[14px] border border-[#C8F04A] bg-[#FBFEF2] p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[14px] font-bold text-[#2A5A0A]">解析预览</div>
                  <div className="mt-0.5 text-[11px] text-[#777]">请核对后再保存。平台定位继续读取IP档案，不在规则中重复存储。</div>
                </div>
                <button
                  onClick={handleConfirmSave}
                  disabled={contamination?.canSave === false}
                  className="rounded-[10px] bg-[#C8F04A] px-4 py-2 text-[12.5px] font-bold text-[#1A1A1A] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {contamination?.canSave === false ? "示例污染未通过，无法保存" : "确认并保存规则"}
                </button>
              </div>
              {contamination && contamination.items.length > 0 && (
                <div className={`mb-4 rounded-[10px] px-3 py-2.5 ${contamination.status === "blocked" ? "bg-[#FCEBEB] text-[#A32D2D]" : "bg-[#FFF7DF] text-[#8A5B00]"}`}>
                  <div className="text-[12.5px] font-bold">
                    {contamination.status === "blocked" ? "示例名称污染已拦截" : "示例名称使用提醒"}
                  </div>
                  <div className="mt-1 space-y-0.5 text-[11.5px]">
                    {contamination.items.map(item => (
                      <div key={item.name}>
                        {item.name}出现{item.count}次，{item.severity === "blocked"
                          ? "超过允许上限，请减少后重新解析"
                          : "可能让AI误把范例当成默认素材"}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <section>
                  <div className="mb-2 text-[11.5px] font-bold text-[#639922]">基础信息</div>
                  <div className="space-y-1 rounded-[10px] bg-white p-2.5 text-[12px] text-[#333]">
                    <div>规则名称：{preview.name}</div>
                    <div>版本：{preview.version}</div>
                    <div>目标受众：{preview.targetAudience.join("、") || "沿用IP档案"}</div>
                    <div>原文文件：{preview.source.fileName ?? "粘贴文本"}</div>
                  </div>
                </section>
                <DirectorPreviewSection title="常用口头禅" items={preview.language.catchphrases} />
                <DirectorPreviewSection title="禁用表达" items={preview.language.forbiddenExpressions} />
                <DirectorPreviewSection title="语气基调" items={preview.language.toneGuidelines} />
                <DirectorPreviewSection title="开头必须做到" items={preview.opening.requirements} />
                <DirectorPreviewSection title="开头禁止形式" items={preview.opening.forbiddenPatterns} />
                <DirectorPreviewSection title="正文推理顺序" items={preview.body.reasoningSequence} />
                <section>
                  <div className="mb-2 text-[11.5px] font-bold text-[#639922]">案例使用规则</div>
                  <div className="mb-2 rounded-[10px] bg-white p-2.5 text-[12px] text-[#333]">
                    <div>案例数量限制：{preview.body.casePolicy.maximumCasesPerClaim === null
                      ? "未设置"
                      : `每个观点最多${preview.body.casePolicy.maximumCasesPerClaim}个`}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-[#777]">
                      <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5">{DIRECTOR_LEVEL_LABELS[preview.body.casePolicy.level]}</span>
                      <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5">{DIRECTOR_ENFORCEMENT_LABELS[preview.body.casePolicy.enforcement]}</span>
                      <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5">作用范围：{DIRECTOR_SCOPE_LABELS[preview.body.casePolicy.scope]}（{preview.body.casePolicy.scope}）</span>
                    </div>
                  </div>
                  <DirectorRuleItems items={preview.body.casePolicy.requirements} />
                </section>
                <DirectorPreviewSection title="素材使用边界" items={preview.body.materialPolicies} />
                <DirectorPreviewSection title="结尾必须做到" items={preview.ending.requirements} />
                <DirectorPreviewSection title="结尾禁止形式" items={preview.ending.forbiddenPatterns} />
                <section>
                  <div className="mb-2 text-[11.5px] font-bold text-[#639922]">压缩目标</div>
                  <div className="mb-2 rounded-[10px] bg-white p-2.5 text-[12px] text-[#333]">
                    <div>{preview.compression.enabled ? "已启用压缩" : "未启用压缩"}</div>
                    {preview.compression.targetReduction
                      ? <>
                        <div className="mt-1">压缩目标：精简{preview.compression.targetReduction.minimumPercent}%至{preview.compression.targetReduction.maximumPercent}%</div>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-[#777]">
                          <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5">{DIRECTOR_LEVEL_LABELS[preview.compression.targetReduction.level]}</span>
                          <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5">{DIRECTOR_ENFORCEMENT_LABELS[preview.compression.targetReduction.enforcement]}</span>
                          <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5">作用范围：{DIRECTOR_SCOPE_LABELS[preview.compression.targetReduction.scope]}（{preview.compression.targetReduction.scope}）</span>
                        </div>
                      </>
                      : <div className="mt-1 text-[#999]">未设置具体压缩比例</div>}
                  </div>
                </section>
                <DirectorPreviewSection title="压缩时必须保留" items={preview.compression.mustKeep} />
                <DirectorPreviewSection title="压缩时优先删除" items={preview.compression.preferRemove} />
                <DirectorPreviewSection title="其他压缩要求" items={preview.compression.otherRequirements} />
                <DirectorPreviewSection title="特别说明" items={preview.specialRules} />
                <DirectorPreviewSection title="生成前检查" items={preview.validationRequirements} />
                <section className="md:col-span-2">
                  <div className="mb-2 text-[11.5px] font-bold text-[#639922]">举例（仅作格式参考）</div>
                  {preview.examples.length === 0
                    ? <div className="text-[11.5px] text-[#AAA]">未识别到范例</div>
                    : preview.examples.map(example => (
                      <div key={example.id} className="mb-2 rounded-[10px] bg-white p-2.5 text-[12px] leading-5 text-[#333]">
                        <div>{example.content}</div>
                        <div className="mt-1 text-[10.5px] text-[#999]">类型：{example.kind}；演示：{example.demonstrates}</div>
                        <div className="text-[10.5px] text-[#999]">来源：{example.sourceReference}；确认状态：{example.confirmationStatus}</div>
                        <div className="text-[10.5px] text-[#999]">保护对象：{example.protectedEntities.join("、") || "无"}；不作为创作素材</div>
                      </div>
                    ))}
                </section>
              </div>
            </section>
          )}

          <section>
            <div className="mb-2 text-[13px] font-bold text-[#333]">已保存规则（{rules.length}）</div>
            {rules.length === 0
              ? <div className="rounded-[12px] border border-dashed border-[#E5E4DE] py-6 text-center text-[12px] text-[#999]">当前IP还没有保存专属编导规则</div>
              : <div className="space-y-2">
                {rules.map(rule => {
                  const tested = Boolean(rule.testValidation);
                  const active = rule.status === "active" && tested;
                  const testingThisRule = testingRuleId === rule.id;
                  return (
                    <div key={rule.id} className="rounded-[12px] border border-[#E5E4DE] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[12.5px] font-bold text-[#333]">{rule.name} · v{rule.version}</div>
                          <div className={`mt-1 text-[11px] ${active ? "text-[#3B6D11]" : "text-[#999]"}`}>
                            {active ? "已启用" : tested ? "未启用" : "待完成测试"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            aria-label="测试规则"
                            disabled={testing}
                            onClick={() => openRuleTest(rule)}
                            className="rounded-[10px] bg-[#F2F1ED] px-3 py-1.5 text-[11.5px] font-bold text-[#555] disabled:opacity-40"
                          >
                            {tested ? "重新测试" : "测试规则"}
                          </button>
                          {(active || tested) && (
                            <button
                              aria-label={active ? "停用规则" : "启用规则"}
                              disabled={testing}
                              onClick={() => handleToggle(rule)}
                              className={`rounded-[10px] px-3 py-1.5 text-[11.5px] font-bold disabled:opacity-40 ${active ? "bg-[#F2F1ED] text-[#666]" : "bg-[#C8F04A] text-[#1A1A1A]"}`}
                            >
                              {active ? "停用" : "启用"}
                            </button>
                          )}
                        </div>
                      </div>
                      {testingThisRule && (
                        <div className="mt-3 border-t border-[#EEEDE8] pt-3">
                          <div className="text-[12px] font-bold text-[#333]">三类测试生成</div>
                          <p className="mt-1 text-[11px] text-[#888]">请分别填写你熟悉的题、较陌生的题和容易诱发模板化或越界的压力题。</p>
                          <p className="mt-1 text-[11px] font-semibold text-[#639922]">测试稿仅用于验证规则，不会进入正式脚本库或学习数据</p>
                          <div className="mt-3 grid gap-2">
                            {([
                              ["familiar", "熟悉题", "例如：你长期讲、最能判断是否像本人的选题"],
                              ["unfamiliar", "陌生题", "例如：当前IP较少谈论、容易暴露规则泛化能力的选题"],
                              ["stress", "压力题", "例如：容易诱发模板化、极端判断或事实越界的选题"],
                            ] as const).map(([testType, label, placeholder]) => (
                              <label key={testType} className="block">
                                <span className="mb-1 block text-[11px] font-semibold text-[#555]">{label}</span>
                                <input
                                  aria-label={`${label}测试选题`}
                                  value={testTopics[testType]}
                                  maxLength={500}
                                  disabled={testing}
                                  onChange={event => setTestTopics(current => ({ ...current, [testType]: event.target.value }))}
                                  placeholder={placeholder}
                                  className="w-full rounded-[9px] border border-[#E5E4DE] bg-white px-3 py-2 text-[12px] outline-none focus:border-[#C8F04A] disabled:opacity-60"
                                />
                              </label>
                            ))}
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-[11px] text-[#888]">{testProgress ?? (tested ? "已完成过测试，可再次验证新选题" : "完成本轮三类测试后解锁启用")}</span>
                            <button
                              onClick={() => handleRunRuleTests(rule)}
                              disabled={testing || Object.values(testTopics).some(topic => !topic.trim())}
                              className="rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[12px] font-bold text-white disabled:opacity-40"
                            >
                              {testing ? "测试生成中" : "运行三类测试"}
                            </button>
                          </div>
                          {Object.keys(testResults).length > 0 && (
                            <div className="mt-3 space-y-2">
                              {(["familiar", "unfamiliar", "stress"] as const).map(testType => {
                                const result = testResults[testType];
                                if (!result) return null;
                                const label = testType === "familiar" ? "熟悉题" : testType === "unfamiliar" ? "陌生题" : "压力题";
                                return (
                                  <article key={testType} className="rounded-[10px] bg-[#FAFAF8] p-3">
                                    <div className="text-[10.5px] font-bold text-[#639922]">{label}临时测试稿</div>
                                    <div className="mt-1 text-[12.5px] font-bold text-[#222]">{result.title}</div>
                                    <div className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-[#555]">{result.fullScript}</div>
                                  </article>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>}
          </section>
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
  const [managingSamples, setManagingSamples] = useState<IPProfile | null>(null);
  const [managingDirectorRules, setManagingDirectorRules] = useState<IPProfile | null>(null);
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
                      <span className="text-[15px] font-bold text-[#1A1A1A]">{getIPDisplayLabel(ip, ips)}</span>
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
                  <button onClick={() => setManagingDirectorRules(ip)} className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[#999] hover:bg-[#FBFEF2] hover:text-[#639922]" title="专属编导规则">
                    <Icon name="sparkle" />
                  </button>
                  <button onClick={() => setManagingSamples(ip)} className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[#999] hover:bg-[#FBFEF2] hover:text-[#639922]" title="口播逐字稿样本库">
                    <Icon name="book" />
                  </button>
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
          initial={editing
            ? { ...editing, scriptDirectorProfileId: editing.scriptDirectorProfileId ?? null }
            : EMPTY_FORM}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSave={handleSave}
        />
      )}

      {deleting && <ConfirmDeleteModal ip={deleting} onClose={() => setDeleting(null)} onConfirm={() => { deleteIP(deleting.id); setDeleting(null); }} />}

      {debugging && <DebugModal ip={debugging} isActive={debugging.id === activeIP?.id} onClose={() => setDebugging(null)} />}

      {managingSamples && <VoiceSampleModal ip={managingSamples} onClose={() => setManagingSamples(null)} />}

      {managingDirectorRules && <ScriptDirectorRuleModal ip={managingDirectorRules} onClose={() => setManagingDirectorRules(null)} />}
    </div>
  );
}
