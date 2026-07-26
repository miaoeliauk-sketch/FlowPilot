"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import {
  createDecisionRecord,
  createQuickDecisionRecord,
  getDecisionRecords,
  saveDecisionAISummary,
  saveDecisionReview,
} from "@/lib/decision-memory-store";
import {
  CONFIDENCE_LEVELS,
  CONTENT_DECISION_STAGES,
  ContentDecisionStage,
  CreateDecisionInput,
  DECISION_CATEGORIES,
  DECISION_VERDICTS,
  DecisionAIResult,
  DecisionCategory,
  DecisionRecord,
  DecisionVerdict,
  QuickCaptureAIResult,
  SaveDecisionReviewInput,
} from "@/lib/decision-memory-types";
import { useIP } from "@/lib/ip-context";
import { Select } from "@/components/ui/select";
import { Icon } from "@/components/ui/icon";

type ReviewFilter = "全部" | "未复盘" | "已复盘";

const EMPTY_FORM: CreateDecisionInput = {
  decision: "",
  context: "",
  reasoning: "",
  category: "选题",
  futureValidation: "",
  source: "",
  confidence: 3,
};

const EMPTY_REVIEW: SaveDecisionReviewInput = {
  actualOutcome: "",
  verdict: "成立",
  explanation: "",
  newPrinciple: "",
  nextTimeAction: "",
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function recordTitle(record: DecisionRecord): string {
  if (record.aiSummary?.theme) return record.aiSummary.theme;
  return record.decision.length > 34
    ? `${record.decision.slice(0, 34)}…`
    : record.decision;
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  multiline = true,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  required?: boolean;
}) {
  const className =
    "w-full rounded-[12px] border border-[#E5E4DE] bg-white px-3.5 py-3 text-[13px] leading-6 text-[#1C1C1B] outline-none transition focus:border-[#8DB52A] focus:ring-2 focus:ring-[#C8F04A]/20";
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-bold text-[#555]">
        {label}{required && <span className="ml-1 text-[#A32D2D]">*</span>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={3}
          className={`${className} resize-y`}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={className}
        />
      )}
    </label>
  );
}

function StatusPill({ record }: { record: DecisionRecord }) {
  if (record.review) {
    return (
      <span className="rounded-full bg-[#EAF3DE] px-2.5 py-1 text-[11px] font-bold text-[#4A7318]">
        {record.review.verdict}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-[#F2F1ED] px-2.5 py-1 text-[11px] font-bold text-[#888]">
      未复盘
    </span>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-bold text-[#999]">{label}</div>
      <div className="whitespace-pre-wrap text-[13px] leading-6 text-[#333]">{children || "—"}</div>
    </div>
  );
}

export default function DecisionMemoryPage() {
  const { activeIP } = useIP();
  const [records, setRecords] = useState<DecisionRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [form, setForm] = useState<CreateDecisionInput>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [keyword, setKeyword] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"全部" | DecisionCategory>("全部");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("全部");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDraft, setReviewDraft] = useState<SaveDecisionReviewInput>(EMPTY_REVIEW);
  const [actionError, setActionError] = useState("");
  const [organizingId, setOrganizingId] = useState<string | null>(null);
  const [savingReview, setSavingReview] = useState(false);
  const [quickInput, setQuickInput] = useState("");
  const [quickDraft, setQuickDraft] = useState<QuickCaptureAIResult | null>(null);
  const [quickError, setQuickError] = useState("");
  const [quickOrganizing, setQuickOrganizing] = useState(false);
  const [quickEdited, setQuickEdited] = useState(false);
  const [fullFormOpen, setFullFormOpen] = useState(false);

  function refreshRecords() {
    try {
      setRecords(getDecisionRecords());
      setStorageError("");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "判断库读取失败");
    } finally {
      setHydrated(true);
    }
  }

  useEffect(() => {
    refreshRecords();
  }, []);

  const selectedRecord = records.find((record) => record.id === selectedId) ?? null;

  const filteredRecords = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return records.filter((record) => {
      if (categoryFilter !== "全部" && record.category !== categoryFilter) return false;
      if (reviewFilter === "未复盘" && record.review) return false;
      if (reviewFilter === "已复盘" && !record.review) return false;
      if (!query) return true;
      const searchable = [
        record.rawInput ?? "",
        record.decision,
        record.context,
        record.reasoning,
        record.source,
        record.aiSummary?.theme ?? "",
        record.aiSummary?.coreDecision ?? "",
        record.aiSummary?.basis ?? "",
        ...(record.aiSummary?.applicableScenarios ?? []),
        record.aiSummary?.corePrinciple ?? "",
        record.aiSummary?.contentStage ?? "",
        record.aiSummary?.applicableIP ?? "",
        record.aiSummary?.futureValidationSuggestion ?? "",
        ...(record.aiSummary?.keywords ?? []),
        record.review?.actualOutcome ?? "",
        record.review?.explanation ?? "",
        record.review?.newPrinciple ?? "",
        record.review?.nextTimeAction ?? "",
      ].join(" ").toLowerCase();
      return searchable.includes(query);
    });
  }, [records, keyword, categoryFilter, reviewFilter]);

  async function handleQuickOrganize() {
    const rawInput = quickInput.trim();
    if (!rawInput) {
      setQuickError("请先用一句话写下：你决定做什么，以及为什么");
      return;
    }

    setQuickOrganizing(true);
    setQuickError("");
    setNotice("");
    try {
      const response = await apiFetch("/api/decision-memory/organize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "quick_capture",
          rawInput,
          activeIPName: activeIP?.name || undefined,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.summary) {
        throw new Error(data?.error || "AI整理失败，请稍后重试");
      }
      setQuickDraft(data.summary as QuickCaptureAIResult);
      setQuickEdited(false);
    } catch (error) {
      setQuickError(
        `${error instanceof Error ? error.message : "AI整理失败"}。原始内容已保留，你可以重试或直接保存。`,
      );
    } finally {
      setQuickOrganizing(false);
    }
  }

  function updateQuickDraft<K extends keyof QuickCaptureAIResult>(
    key: K,
    value: QuickCaptureAIResult[K],
  ) {
    setQuickDraft((current) => current ? { ...current, [key]: value } : current);
    setQuickEdited(true);
    setQuickError("");
  }

  function resetQuickCapture() {
    setQuickInput("");
    setQuickDraft(null);
    setQuickError("");
    setQuickEdited(false);
  }

  function handleSaveQuick(useDraft: boolean) {
    if (!quickInput.trim()) {
      setQuickError("请先写下一句话判断");
      return;
    }
    if (useDraft && !quickDraft) {
      setQuickError("请先让AI整理判断卡");
      return;
    }
    if (
      useDraft &&
      quickDraft &&
      (!quickDraft.theme.trim() ||
        !quickDraft.coreDecision.trim() ||
        !quickDraft.basis.trim() ||
        quickDraft.keywords.filter((item) => item.trim()).length < 3)
    ) {
      setQuickError("请保留判断主题、核心判断、判断依据和至少3个关键词");
      return;
    }

    try {
      const created = createQuickDecisionRecord({
        rawInput: quickInput,
        summary: useDraft ? quickDraft : null,
      });
      resetQuickCapture();
      setNotice(useDraft ? "内容判断已保存" : "原始判断已保存，之后仍可在详情中整理");
      refreshRecords();
      openRecord(created);
    } catch (error) {
      setQuickError(error instanceof Error ? error.message : "判断保存失败");
    }
  }

  function updateForm<K extends keyof CreateDecisionInput>(
    key: K,
    value: CreateDecisionInput[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError("");
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    const required = [
      form.decision,
      form.context,
      form.reasoning,
      form.futureValidation,
      form.source,
    ];
    if (required.some((value) => !value.trim())) {
      setFormError("请填写完整后再保存判断");
      return;
    }

    try {
      const created = createDecisionRecord(form);
      setForm(EMPTY_FORM);
      setFormError("");
      setNotice("判断已保存。AI不会自动改写，你可以在详情中选择整理。");
      refreshRecords();
      openRecord(created);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "判断保存失败");
    }
  }

  function openRecord(record: DecisionRecord) {
    setSelectedId(record.id);
    setActionError("");
    setReviewOpen(false);
    setReviewDraft(record.review ? {
      actualOutcome: record.review.actualOutcome,
      verdict: record.review.verdict,
      explanation: record.review.explanation,
      newPrinciple: record.review.newPrinciple,
      nextTimeAction: record.review.nextTimeAction,
    } : EMPTY_REVIEW);
  }

  function closeDetail() {
    if (organizingId || savingReview) return;
    setSelectedId(null);
    setReviewOpen(false);
    setActionError("");
  }

  async function handleOrganize(record: DecisionRecord) {
    setOrganizingId(record.id);
    setActionError("");
    try {
      const quickCapture = record.captureMode === "quick_capture" && record.rawInput;
      const response = await apiFetch("/api/decision-memory/organize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quickCapture ? {
          mode: "quick_capture",
          rawInput: record.rawInput,
          activeIPName: record.aiSummary?.applicableIP || activeIP?.name || undefined,
        } : {
          decision: record.decision,
          context: record.context,
          reasoning: record.reasoning,
          category: record.category,
          futureValidation: record.futureValidation,
          source: record.source,
          confidence: record.confidence,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.summary) {
        throw new Error(data?.error || "AI整理失败，请稍后重试");
      }
      const result = data.summary as DecisionAIResult | QuickCaptureAIResult;
      saveDecisionAISummary(record.id, quickCapture ? {
        theme: result.theme,
        coreDecision: result.coreDecision,
        basis: result.basis,
        applicableScenarios: [(result as QuickCaptureAIResult).contentStage],
        corePrinciple: result.corePrinciple,
        keywords: result.keywords,
        model: result.model,
        contentStage: (result as QuickCaptureAIResult).contentStage,
        applicableIP: (result as QuickCaptureAIResult).applicableIP,
        futureValidationSuggestion: (result as QuickCaptureAIResult).futureValidationSuggestion,
      } : result as DecisionAIResult);
      refreshRecords();
    } catch (error) {
      setActionError(
        `${error instanceof Error ? error.message : "AI整理失败"}。原始判断已保留。`,
      );
    } finally {
      setOrganizingId(null);
    }
  }

  function updateReview<K extends keyof SaveDecisionReviewInput>(
    key: K,
    value: SaveDecisionReviewInput[K],
  ) {
    setReviewDraft((current) => ({ ...current, [key]: value }));
    setActionError("");
  }

  function handleSaveReview(event: FormEvent) {
    event.preventDefault();
    if (!selectedRecord) return;
    const required = [
      reviewDraft.actualOutcome,
      reviewDraft.explanation,
      reviewDraft.newPrinciple,
      reviewDraft.nextTimeAction,
    ];
    if (required.some((value) => !value.trim())) {
      setActionError("请完整填写复盘内容");
      return;
    }

    setSavingReview(true);
    try {
      saveDecisionReview(selectedRecord.id, reviewDraft);
      refreshRecords();
      setReviewOpen(false);
      setNotice("复盘已保存");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "复盘保存失败");
    } finally {
      setSavingReview(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1280px] pb-10">
      <header className="mb-5 rounded-[20px] bg-[#1C1C1B] px-6 py-5 text-white">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[0.18em] text-[#C8F04A]">
          <Icon name="flask" size="sm" />
          MEMORY LAYER · V0.1.1
        </div>
        <h1 className="text-[27px] font-bold tracking-tight">内容判断库</h1>
        <p className="mt-2 max-w-[720px] text-[13px] leading-6 text-white/65">
          记录你在选题、标题、脚本、拍摄和运营中，为什么这样选择。
        </p>
      </header>

      {storageError && (
        <div className="mb-5 rounded-[14px] border border-[#E8B4B4] bg-[#FFF4F4] px-4 py-3 text-[13px] leading-6 text-[#A32D2D]">
          {storageError}
        </div>
      )}
      {notice && (
        <div className="mb-5 rounded-[14px] border border-[#CFE2B1] bg-[#F3F8EA] px-4 py-3 text-[13px] text-[#4A7318]">
          {notice}
        </div>
      )}

      <section className="card mb-5 overflow-hidden border-[#D8E7B8]">
        <div className="grid gap-5 bg-gradient-to-br from-[#F7FBEF] to-white p-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] lg:p-6">
          <div>
            <div className="mb-1 text-[19px] font-bold text-[#1C1C1B]">快速记录一次内容判断</div>
            <p className="mb-4 text-[12.5px] leading-6 text-[#777]">
              用一句话写下：你决定做什么，以及为什么。
            </p>
            <label className="block">
              <span className="sr-only">一句话内容判断</span>
              <textarea
                value={quickInput}
                onChange={(event) => {
                  setQuickInput(event.target.value);
                  setQuickError("");
                  if (quickDraft) setQuickDraft(null);
                }}
                disabled={quickOrganizing}
                rows={6}
                placeholder="我决定把‘装修花很多钱却没有高级感’作为重点选题，因为高投入和低结果之间的反差更强，也更适合设计师展示专业判断。"
                className="w-full resize-y rounded-[16px] border border-[#DADFD0] bg-white px-4 py-3.5 text-[14px] leading-7 text-[#1C1C1B] outline-none transition focus:border-[#8DB52A] focus:ring-2 focus:ring-[#C8F04A]/25 disabled:cursor-wait disabled:bg-[#F7F6F2]"
              />
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleQuickOrganize}
                disabled={quickOrganizing || Boolean(storageError)}
                className="flex items-center justify-center gap-2 rounded-[12px] bg-[#1C1C1B] px-5 py-3 text-[13px] font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="sparkle" size="sm" />
                {quickOrganizing ? "AI正在整理…" : quickDraft ? "重新整理判断卡" : "AI整理成判断卡"}
              </button>
              <span className="text-[11px] text-[#999]">
                AI只整理原意，保存前由你确认。
              </span>
            </div>
            {quickError && (
              <div className="mt-3 rounded-[11px] border border-[#E8B4B4] bg-[#FFF4F4] px-3.5 py-3 text-[12px] leading-5 text-[#A32D2D]">
                {quickError}
                {!quickDraft && quickInput.trim() && (
                  <button
                    type="button"
                    onClick={() => handleSaveQuick(false)}
                    className="ml-2 font-bold underline underline-offset-2"
                  >
                    直接保存原始判断
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="rounded-[16px] border border-[#E5E4DE] bg-white p-4">
            {quickDraft ? (
              <>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[15px] font-bold text-[#1C1C1B]">内容判断卡预览</div>
                    <div className="mt-1 text-[11px] text-[#999]">所有字段都可以直接修改，确认后才会保存。</div>
                  </div>
                  <span className="rounded-full bg-[#EEF5DF] px-2.5 py-1 text-[10px] font-bold text-[#527D18]">
                    待确认
                  </span>
                </div>
                <div className="grid gap-3">
                  <TextField
                    label="判断主题"
                    value={quickDraft.theme}
                    onChange={(value) => updateQuickDraft("theme", value)}
                    placeholder="简短概括这次判断"
                    multiline={false}
                  />
                  <TextField
                    label="核心判断"
                    value={quickDraft.coreDecision}
                    onChange={(value) => updateQuickDraft("coreDecision", value)}
                    placeholder="忠实保留最终决定"
                  />
                  <TextField
                    label="判断依据"
                    value={quickDraft.basis}
                    onChange={(value) => updateQuickDraft("basis", value)}
                    placeholder="只保留原始输入中的理由"
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label>
                      <span className="mb-1.5 block text-[12px] font-bold text-[#555]">涉及环节</span>
                      <Select
                        value={quickDraft.contentStage}
                        onChange={(value) => updateQuickDraft("contentStage", value as ContentDecisionStage)}
                        options={[...CONTENT_DECISION_STAGES]}
                      />
                    </label>
                    <TextField
                      label="适用IP"
                      value={quickDraft.applicableIP}
                      onChange={(value) => updateQuickDraft("applicableIP", value)}
                      placeholder="可选"
                      multiline={false}
                      required={false}
                    />
                  </div>
                  <TextField
                    label="未来验证建议"
                    value={quickDraft.futureValidationSuggestion}
                    onChange={(value) => updateQuickDraft("futureValidationSuggestion", value)}
                    placeholder="这是建议，可以修改或删除"
                    required={false}
                  />
                  <TextField
                    label="核心原则"
                    value={quickDraft.corePrinciple}
                    onChange={(value) => updateQuickDraft("corePrinciple", value)}
                    placeholder="只总结原话中已有的原则"
                    required={false}
                  />
                  <TextField
                    label="关键词（用逗号分隔）"
                    value={quickDraft.keywords.join("，")}
                    onChange={(value) => updateQuickDraft(
                      "keywords",
                      value.split(/[，,]/).map((item) => item.trim()).filter(Boolean).slice(0, 6),
                    )}
                    placeholder="3—6个关键词"
                    multiline={false}
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[#EEEDE8] pt-4">
                  <button
                    type="button"
                    onClick={() => handleSaveQuick(true)}
                    disabled={quickOrganizing}
                    className="rounded-[11px] bg-[#1C1C1B] px-5 py-2.5 text-[12.5px] font-bold text-white disabled:cursor-wait disabled:opacity-50"
                  >
                    {quickEdited ? "修改后保存" : "保存判断"}
                  </button>
                  <button
                    type="button"
                    onClick={resetQuickCapture}
                    disabled={quickOrganizing}
                    className="rounded-[11px] bg-[#F2F1ED] px-4 py-2.5 text-[12.5px] font-bold text-[#666] disabled:cursor-wait disabled:opacity-50"
                  >
                    放弃
                  </button>
                </div>
              </>
            ) : (
              <div className="flex min-h-[310px] flex-col items-center justify-center rounded-[12px] border border-dashed border-[#DADFD0] bg-[#FAFBF7] px-6 text-center">
                <Icon name="sparkle" size="md" />
                <div className="mt-3 text-[14px] font-bold text-[#555]">AI整理后，判断卡会显示在这里</div>
                <div className="mt-2 max-w-[280px] text-[11.5px] leading-5 text-[#999]">
                  AI不会自动保存，也不会替你增加没有说过的判断理由。
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="card mb-5">
        <button
          type="button"
          onClick={() => setFullFormOpen((value) => !value)}
          className="flex w-full items-center justify-between gap-4 p-5 text-left"
        >
          <div>
            <div className="text-[15px] font-bold text-[#1C1C1B]">完整记录一项重要判断</div>
            <div className="mt-1 text-[11.5px] text-[#999]">适合复杂取舍、重要策略和长期验证，默认收起。</div>
          </div>
          <span className="rounded-full bg-[#F2F1ED] px-3 py-1.5 text-[11px] font-bold text-[#666]">
            {fullFormOpen ? "收起" : "补充更多背景（可选）"}
          </span>
        </button>

        {fullFormOpen && (
          <form onSubmit={handleCreate} className="border-t border-[#EEEDE8] p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label="我决定"
                value={form.decision}
                onChange={(value) => updateForm("decision", value)}
                placeholder="例如：这期内容不追热点，改做一个长期有搜索价值的教程"
              />
              <TextField
                label="背景"
                value={form.context}
                onChange={(value) => updateForm("context", value)}
                placeholder="当时发生了什么？有哪些约束和信息？"
              />
              <TextField
                label="我的理由"
                value={form.reasoning}
                onChange={(value) => updateForm("reasoning", value)}
                placeholder="为什么做出这个判断？"
              />
              <TextField
                label="未来验证"
                value={form.futureValidation}
                onChange={(value) => updateForm("futureValidation", value)}
                placeholder="未来看到什么结果，才知道这个判断是否成立？"
              />
              <TextField
                label="判断来源"
                value={form.source}
                onChange={(value) => updateForm("source", value)}
                placeholder="例如：亲自测试、用户反馈、历史数据、面试交流"
                multiline={false}
              />
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="mb-1.5 block text-[12px] font-bold text-[#555]">分类</span>
                  <Select
                    value={form.category}
                    onChange={(value) => updateForm("category", value as DecisionCategory)}
                    options={[...DECISION_CATEGORIES]}
                  />
                </label>
                <div>
                  <div className="mb-1.5 text-[12px] font-bold text-[#555]">确信程度</div>
                  <div className="grid grid-cols-5 gap-1">
                    {CONFIDENCE_LEVELS.map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => updateForm("confidence", level)}
                        className="h-[38px] rounded-[9px] text-[12px] font-bold transition"
                        style={form.confidence === level
                          ? { background: "#1C1C1B", color: "#C8F04A" }
                          : { background: "#F2F1ED", color: "#777" }}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            {formError && (
              <div className="mt-4 rounded-[10px] bg-[#FFF1F1] px-3 py-2 text-[12px] text-[#A32D2D]">
                {formError}
              </div>
            )}
            <button
              type="submit"
              disabled={Boolean(storageError)}
              className="mt-4 flex items-center justify-center gap-2 rounded-[12px] bg-[#1C1C1B] px-5 py-3 text-[13px] font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="plus" size="sm" />
              保存完整判断
            </button>
          </form>
        )}
      </section>

      <section className="min-w-0">
        <div className="card mb-4 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <span className="text-[16px] font-bold text-[#1C1C1B]">内容判断记录</span>
              <span className="ml-2 text-[11.5px] text-[#999]">
                {filteredRecords.length}/{records.length}条
              </span>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_150px_130px]">
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索判断、理由、原则或关键词"
              className="rounded-[10px] border border-[#E5E4DE] bg-white px-3 py-2 text-[12.5px] outline-none focus:border-[#8DB52A]"
            />
            <Select
              value={categoryFilter}
              onChange={(value) => setCategoryFilter(value as "全部" | DecisionCategory)}
              options={["全部", ...DECISION_CATEGORIES]}
            />
            <Select
              value={reviewFilter}
              onChange={(value) => setReviewFilter(value as ReviewFilter)}
              options={["全部", "未复盘", "已复盘"]}
            />
          </div>
        </div>

        {!hydrated ? (
          <div className="card p-10 text-center text-[13px] text-[#999]">正在读取判断记录…</div>
        ) : filteredRecords.length === 0 ? (
          <div className="card p-10 text-center">
            <div className="text-[15px] font-bold text-[#555]">
              {records.length === 0 ? "还没有内容判断" : "没有符合筛选条件的记录"}
            </div>
            <div className="mt-2 text-[12px] text-[#999]">
              {records.length === 0 ? "从上方用一句话记录你现在正在做的判断。" : "可以调整关键词或筛选条件。"}
            </div>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {filteredRecords.map((record) => (
              <button
                key={record.id}
                onClick={() => openRecord(record)}
                className="card group w-full p-4 text-left transition hover:-translate-y-0.5 hover:border-[#C8F04A] hover:shadow-md"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[#1C1C1B] px-2.5 py-1 text-[10.5px] font-bold text-[#C8F04A]">
                    {record.aiSummary?.contentStage || record.category}
                  </span>
                  {record.captureMode === "quick_capture" && (
                    <span className="rounded-full bg-[#F0F3E9] px-2.5 py-1 text-[10.5px] font-bold text-[#527D18]">
                      快速记录
                    </span>
                  )}
                  <StatusPill record={record} />
                  <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
                    record.aiSummary
                      ? "bg-[#EEF3FF] text-[#4F67A3]"
                      : "bg-[#FFF4DD] text-[#906518]"
                  }`}>
                    {record.aiSummary ? "AI已整理" : "待整理"}
                  </span>
                  <span className="ml-auto text-[10.5px] text-[#AAA]">{formatDate(record.createdAt)}</span>
                </div>
                <div className="text-[15px] font-bold leading-6 text-[#1C1C1B] group-hover:text-[#527D18]">
                  {recordTitle(record)}
                </div>
                <div className="mt-1.5 line-clamp-2 text-[12.5px] leading-5 text-[#777]">
                  {record.decision}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-[#999]">
                  {record.aiSummary?.applicableIP && <span>适用IP：{record.aiSummary.applicableIP}</span>}
                  <span>来源：{record.captureMode === "quick_capture" ? "快速记录" : record.source}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedRecord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDetail();
          }}
        >
          <div className="max-h-[92vh] w-full max-w-[820px] overflow-y-auto rounded-[20px] bg-[#F7F6F2] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[#E5E4DE] bg-white px-5 py-4">
              <div className="pr-4">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded-full bg-[#1C1C1B] px-2.5 py-1 text-[10.5px] font-bold text-[#C8F04A]">
                    {selectedRecord.category}
                  </span>
                  <StatusPill record={selectedRecord} />
                </div>
                <h2 className="text-[19px] font-bold leading-7 text-[#1C1C1B]">
                  {recordTitle(selectedRecord)}
                </h2>
              </div>
              <button
                onClick={closeDetail}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#F2F1ED] text-[18px] text-[#777]"
                aria-label="关闭详情"
              >
                ×
              </button>
            </div>

            <div className="flex flex-col gap-4 p-5">
              {actionError && (
                <div className="rounded-[12px] border border-[#E8B4B4] bg-[#FFF4F4] px-4 py-3 text-[12.5px] leading-5 text-[#A32D2D]">
                  {actionError}
                </div>
              )}

              <section className="rounded-[16px] bg-white p-5">
                <div className="mb-4 text-[14px] font-bold text-[#1C1C1B]">原始判断</div>
                <div className="grid gap-4 md:grid-cols-2">
                  {selectedRecord.rawInput && (
                    <div className="md:col-span-2">
                      <DetailRow label="最初输入的一句话">{selectedRecord.rawInput}</DetailRow>
                    </div>
                  )}
                  <DetailRow label="我决定">{selectedRecord.decision}</DetailRow>
                  <DetailRow label="背景">{selectedRecord.context}</DetailRow>
                  <DetailRow label="我的理由">{selectedRecord.reasoning}</DetailRow>
                  <DetailRow label="未来验证">{selectedRecord.futureValidation}</DetailRow>
                  <DetailRow label="判断来源">
                    {selectedRecord.captureMode === "quick_capture" ? "快速记录" : selectedRecord.source}
                  </DetailRow>
                  <DetailRow label="当时确信程度">{selectedRecord.confidence}/5</DetailRow>
                </div>
              </section>

              <section className="rounded-[16px] bg-white p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[14px] font-bold text-[#1C1C1B]">AI整理</div>
                    <div className="mt-1 text-[11px] text-[#999]">AI只整理上面的原始内容。</div>
                  </div>
                  <button
                    onClick={() => handleOrganize(selectedRecord)}
                    disabled={organizingId === selectedRecord.id}
                    className="flex items-center gap-1.5 rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[12px] font-bold text-white disabled:opacity-50"
                  >
                    <Icon name="sparkle" size="xs" />
                    {organizingId === selectedRecord.id
                      ? "整理中…"
                      : selectedRecord.aiSummary
                        ? "重新整理"
                        : "AI整理"}
                  </button>
                </div>

                {selectedRecord.aiSummary ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <DetailRow label="判断主题">{selectedRecord.aiSummary.theme}</DetailRow>
                    <DetailRow label="核心判断">{selectedRecord.aiSummary.coreDecision}</DetailRow>
                    <DetailRow label="判断依据">{selectedRecord.aiSummary.basis}</DetailRow>
                    {selectedRecord.aiSummary.contentStage && (
                      <DetailRow label="涉及环节">{selectedRecord.aiSummary.contentStage}</DetailRow>
                    )}
                    {selectedRecord.aiSummary.applicableIP && (
                      <DetailRow label="适用IP">{selectedRecord.aiSummary.applicableIP}</DetailRow>
                    )}
                    {selectedRecord.aiSummary.futureValidationSuggestion && (
                      <DetailRow label="未来验证建议">
                        {selectedRecord.aiSummary.futureValidationSuggestion}
                      </DetailRow>
                    )}
                    <DetailRow label="核心原则">{selectedRecord.aiSummary.corePrinciple}</DetailRow>
                    {!selectedRecord.aiSummary.contentStage && (
                      <DetailRow label="适用场景">
                        {selectedRecord.aiSummary.applicableScenarios.join("、")}
                      </DetailRow>
                    )}
                    <div>
                      <div className="mb-1.5 text-[11px] font-bold text-[#999]">关键词</div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedRecord.aiSummary.keywords.length > 0
                          ? selectedRecord.aiSummary.keywords.map((item) => (
                            <span key={item} className="rounded-full bg-[#F0F3E9] px-2.5 py-1 text-[11px] text-[#527D18]">
                              {item}
                            </span>
                          ))
                          : <span className="text-[13px] text-[#999]">—</span>}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[12px] bg-[#F7F6F2] px-4 py-5 text-center text-[12px] text-[#999]">
                    这条判断尚未整理。原始记录不依赖AI，可以随时回来处理。
                  </div>
                )}
              </section>

              <section className="rounded-[16px] bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[14px] font-bold text-[#1C1C1B]">手动复盘</div>
                    <div className="mt-1 text-[11px] text-[#999]">结果由你填写，AI不替你判定。</div>
                  </div>
                  <button
                    onClick={() => setReviewOpen((value) => !value)}
                    className="rounded-[10px] bg-[#C8F04A] px-4 py-2 text-[12px] font-bold text-[#1C1C1B]"
                  >
                    {reviewOpen ? "收起" : selectedRecord.review ? "更新复盘" : "开始复盘"}
                  </button>
                </div>

                {selectedRecord.review && !reviewOpen && (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <DetailRow label="实际结果">{selectedRecord.review.actualOutcome}</DetailRow>
                    <DetailRow label="判断是否成立">{selectedRecord.review.verdict}</DetailRow>
                    <DetailRow label="为什么成立或不成立">{selectedRecord.review.explanation}</DetailRow>
                    <DetailRow label="新形成的原则">{selectedRecord.review.newPrinciple}</DetailRow>
                    <div className="md:col-span-2">
                      <DetailRow label="下次遇到类似情况怎么做">
                        {selectedRecord.review.nextTimeAction}
                      </DetailRow>
                    </div>
                  </div>
                )}

                {reviewOpen && (
                  <form onSubmit={handleSaveReview} className="mt-4 flex flex-col gap-4 border-t border-[#EEEDE8] pt-4">
                    <TextField
                      label="实际结果"
                      value={reviewDraft.actualOutcome}
                      onChange={(value) => updateReview("actualOutcome", value)}
                      placeholder="后来实际发生了什么？"
                    />
                    <label>
                      <span className="mb-1.5 block text-[12px] font-bold text-[#555]">判断是否成立</span>
                      <Select
                        value={reviewDraft.verdict}
                        onChange={(value) => updateReview("verdict", value as DecisionVerdict)}
                        options={[...DECISION_VERDICTS]}
                      />
                    </label>
                    <TextField
                      label="为什么成立或不成立"
                      value={reviewDraft.explanation}
                      onChange={(value) => updateReview("explanation", value)}
                      placeholder="哪些信息被验证了？哪些假设出现了偏差？"
                    />
                    <TextField
                      label="新形成的原则"
                      value={reviewDraft.newPrinciple}
                      onChange={(value) => updateReview("newPrinciple", value)}
                      placeholder="这次复盘后，你形成了什么新原则？"
                    />
                    <TextField
                      label="下次遇到类似情况怎么做"
                      value={reviewDraft.nextTimeAction}
                      onChange={(value) => updateReview("nextTimeAction", value)}
                      placeholder="下次保留什么、调整什么？"
                    />
                    <button
                      type="submit"
                      disabled={savingReview}
                      className="rounded-[11px] bg-[#1C1C1B] px-5 py-3 text-[13px] font-bold text-white disabled:opacity-50"
                    >
                      {savingReview ? "保存中…" : "保存复盘"}
                    </button>
                  </form>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
