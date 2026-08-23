"use client";
import { useEffect, useMemo, useState } from "react";
import { useIP } from "@/lib/ip-context";
import {
  addKnowledgeEntry,
  getKnowledgeEntriesForFullLibraryComparison,
} from "@/lib/ip-store";
import type { KnowledgeCategory } from "@/lib/types";
import { apiFetch } from "@/lib/api-fetch";
import { parseXlsxFile } from "@/lib/xlsx-parser";
import { IP_CATEGORIES, isIPKnowledgeCategory } from "@/lib/knowledge-categories";
import { getIPDisplayLabel } from "@/lib/ip-display";
import {
  buildGlobalKnowledgeIntakeLengthMessage,
  buildGlobalKnowledgeIntakeToleranceMessage,
  GLOBAL_KNOWLEDGE_INTAKE_MAX_CHARS,
  GLOBAL_KNOWLEDGE_INTAKE_TOLERANCE_MAX_CHARS,
} from "@/lib/knowledge-intake-limits";
import {
  segmentKnowledgeIntakeContent,
  type KnowledgeIntakeSegment,
} from "@/lib/knowledge-intake-segmentation";
import {
  groupKnowledgeMethodCards,
  mergeKnowledgeMethodCards,
  type KnowledgeMethodCardSource,
  type SimilarKnowledgeMethodCardGroup,
} from "@/lib/knowledge-intake-deduplication";
import {
  runKnowledgeIntakePrecheck,
  type KnowledgeIntakePrecheckAssessment,
  type KnowledgeIntakePrecheckCandidate,
  type SimilarExistingKnowledgeEvidence,
} from "@/lib/knowledge-intake-precheck";
import {
  EXACT_TEMPLATE_CATEGORIES,
  saveExactKnowledgeTemplate,
} from "@/lib/knowledge-exact-intake";
import {
  prepareReviewedMethodCardBatch,
  saveReviewedMethodCardBatch,
  type PrepareReviewedMethodCardBatchInput,
  type PreparedReviewedMethodCardBatch,
} from "@/lib/knowledge-reviewed-intake";

const ALL_CATS = ["定位方法库","选题方法库","标题方法库","开头方法库","文案框架方法库","IP人设资料","IP表达语料","IP历史内容","IP高表现内容","IP受众反馈","IP禁用规则"];
const INTAKE_FILE_ACCEPT = ".txt,.md,.xlsx,.xls,text/plain,text/markdown,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface IntakeItem {
  id: string;
  title: string;
  summary: string;
  category: string;
  ipId: string | null;
  ipMatchStatus: "matched" | "uncertain" | "not_applicable";
  ipMatchReason: string;
  coreMethod?: string;
  applicableScenarios?: string[];
  triggerKeywords?: string[];
  similarPhrases?: string[];
  aiUsage?: string;
  examples?: { input?: string; output?: string }[];
  unsuitableCases?: string[];
  tags: string[];
  reusableValue: string;
  confidence: string;
  confidenceReason: string;
  ingestRecommend: string;
  ingestReason: string;
  understanding?: string;
  keyPoints?: string[];
  relationToIP?: string;
  keywords?: string[];
  selected: boolean;
  categoryOverride?: string;
  sourceSegments: KnowledgeMethodCardSource[];
  precheck: KnowledgeIntakePrecheckAssessment;
}

interface SegmentRun {
  segment: KnowledgeIntakeSegment;
  status: "pending" | "processing" | "completed" | "failed";
  error?: string;
}

const CONF_STYLE: Record<string,{bg:string;color:string}> = {
  "高": { bg:"#EAF3DE", color:"#3B6D11" },
  "中": { bg:"#FEF3C7", color:"#92400E" },
  "低": { bg:"#FCEBEB", color:"#A32D2D" },
};
const REC_STYLE: Record<string,{bg:string;color:string}> = {
  "建议入库":   { bg:"#EAF3DE", color:"#3B6D11" },
  "待确认":     { bg:"#FEF3C7", color:"#92400E" },
  "不建议入库": { bg:"#FCEBEB", color:"#A32D2D" },
};
const SIMILARITY_LABEL: Record<SimilarExistingKnowledgeEvidence["tier"], string> = {
  exact: "完全相同",
  high: "高度相似",
  partial: "部分相似",
};

function KnowledgePrecheckPanel({ assessment }: { assessment: KnowledgeIntakePrecheckAssessment }) {
  return (
    <section className="mt-3 rounded-[10px] border border-[#E5E4DE] bg-[#FCFCFA] p-3">
      <h3 className="text-[12.5px] font-bold text-[#333]">入库前检查</h3>
      <p className="mt-1 text-[11.5px] text-[#666]">
        {assessment.quality.status === "pass"
          ? "基础质量：未发现明显问题"
          : "基础质量：需要人工检查"}
      </p>
      {assessment.quality.issues.length > 0 && (
        <ul className="mt-1 list-disc space-y-1 pl-4 text-[11.5px] text-[#8A6418]">
          {assessment.quality.issues.map(issue => <li key={issue.code}>{issue.message}</li>)}
        </ul>
      )}
      {assessment.similarEntries.length === 0 ? (
        <p className="mt-2 text-[11.5px] text-[#888]">全库暂未发现相似内容</p>
      ) : (
        <div className="mt-2 space-y-2">
          {assessment.similarEntries.map(similar => (
            <div key={similar.knowledgeId} className="rounded-[8px] bg-white px-3 py-2 text-[11.5px] text-[#666]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#F2EEDF] px-2 py-0.5 font-bold text-[#735F21]">
                  {SIMILARITY_LABEL[similar.tier]}
                </span>
                <span>{similar.title || "未命名内容"}｜{similar.category || "分类未标注"}</span>
              </div>
              <p className="mt-1">相似原因：{similar.reasons.join("；")}</p>
              <p className="mt-1 text-[#888]">{similar.ownershipLabel}｜{similar.sourceDescription}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ExactTemplateIntakePanel({ ipNamesById }: { ipNamesById: Record<string, string> }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<KnowledgeCategory>("文案框架方法库");
  const [sourceName, setSourceName] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [rawContent, setRawContent] = useState("");
  const [assessment, setAssessment] = useState<KnowledgeIntakePrecheckAssessment | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [error, setError] = useState("");

  function invalidateCheck() {
    setAssessment(null);
    setConfirmed(false);
    setSaved(false);
    setCheckFailed(false);
    setError("");
  }

  function handleCheck() {
    if (!title.trim() || !sourceName.trim() || !templateKey.trim() || !version.trim() || !rawContent.trim()) {
      setError("请完整填写标题、来源、模板标识、版本和正文");
      setCheckFailed(false);
      return;
    }
    try {
      const result = runKnowledgeIntakePrecheck({
        candidates: [{
          id: "exact-template-candidate",
          kind: "raw_text",
          title: title.trim(),
          summary: "",
          rawContent,
        }],
        existingEntries: getKnowledgeEntriesForFullLibraryComparison(),
        ipNamesById,
      });
      setAssessment(result.assessments[0] ?? null);
      setConfirmed(false);
      setSaved(false);
      setCheckFailed(false);
      setError("");
    } catch {
      setAssessment(null);
      setConfirmed(false);
      setSaved(false);
      setCheckFailed(true);
      setError("入库前检查失败，请检查知识库数据后重新检查");
    }
  }

  async function handleSave() {
    if (!assessment || !confirmed || saving || saved) return;
    setSaving(true);
    setError("");
    try {
      await saveExactKnowledgeTemplate({
        templateKey,
        version,
        title,
        rawContent,
        category,
        sourceName,
        sourceUrl: "",
        tags: ["执行模板"],
        keywords: [],
      });
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "执行模板保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-[16px] border border-[#E5E4DE] bg-white p-5">
      <div className="rounded-[10px] bg-[#F5F8EE] px-4 py-3 text-[12.5px] text-[#4E6C25]">
        <strong>不会调用AI，正文将逐字保存</strong>
        <p className="mt-1">保存后的版本不可编辑；如需更新，请使用新的版本号另存。</p>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-[12.5px] font-semibold text-[#555]">
          模板标题
          <input aria-label="模板标题" value={title} onChange={event => { invalidateCheck(); setTitle(event.target.value); }} className="mt-1 w-full rounded-[9px] border border-[#E5E4DE] px-3 py-2 font-normal" />
        </label>
        <label className="text-[12.5px] font-semibold text-[#555]">
          保存分类
          <select aria-label="保存分类" value={category} onChange={event => { invalidateCheck(); setCategory(event.target.value as KnowledgeCategory); }} className="mt-1 w-full rounded-[9px] border border-[#E5E4DE] px-3 py-2 font-normal">
            {EXACT_TEMPLATE_CATEGORIES.map(item => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-[12.5px] font-semibold text-[#555]">
          来源名称
          <input aria-label="来源名称" value={sourceName} onChange={event => { invalidateCheck(); setSourceName(event.target.value); }} className="mt-1 w-full rounded-[9px] border border-[#E5E4DE] px-3 py-2 font-normal" />
        </label>
        <label className="text-[12.5px] font-semibold text-[#555]">
          模板标识
          <input aria-label="模板标识" value={templateKey} onChange={event => { invalidateCheck(); setTemplateKey(event.target.value); }} placeholder="例如：precise-customer-diagnosis" className="mt-1 w-full rounded-[9px] border border-[#E5E4DE] px-3 py-2 font-normal" />
        </label>
        <label className="text-[12.5px] font-semibold text-[#555]">
          模板版本
          <input aria-label="模板版本" value={version} onChange={event => { invalidateCheck(); setVersion(event.target.value); }} placeholder="1.0.0" className="mt-1 w-full rounded-[9px] border border-[#E5E4DE] px-3 py-2 font-normal" />
        </label>
      </div>
      <label className="mt-4 block text-[12.5px] font-semibold text-[#555]">
        模板正文
        <textarea aria-label="模板正文" value={rawContent} onChange={event => { invalidateCheck(); setRawContent(event.target.value); }} rows={12} className="mt-1 w-full resize-y rounded-[10px] border border-[#E5E4DE] px-3 py-2 font-mono text-[12px] leading-5 font-normal" />
      </label>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={handleCheck} disabled={saving || saved} className="rounded-[9px] bg-[#1C1C1B] px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-40">{checkFailed ? "重新检查" : "检查入库内容"}</button>
      </div>
      {assessment && (
        <>
          <KnowledgePrecheckPanel assessment={assessment} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" aria-pressed={confirmed} onClick={() => setConfirmed(true)} disabled={saving || saved} className="rounded-[8px] border border-[#BFD59F] px-3 py-1.5 text-[11.5px] font-bold text-[#4E6C25] disabled:opacity-40">继续保真保存</button>
            <button type="button" aria-pressed={!confirmed} onClick={() => setConfirmed(false)} disabled={saving || saved} className="rounded-[8px] border border-[#D8D5C9] px-3 py-1.5 text-[11.5px] font-semibold text-[#666] disabled:opacity-40">暂不入库</button>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={handleSave} disabled={!confirmed || saving || saved} className="rounded-[9px] bg-[#639922] px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-40">
              {saved ? "已保真保存" : saving ? "正在保存…" : "确认并保真保存"}
            </button>
          </div>
        </>
      )}
      {saved && <p className="mt-3 rounded-[8px] bg-[#EAF3DE] px-3 py-2 text-[12.5px] font-semibold text-[#3B6D11]">执行模板已保真保存</p>}
      {error && <p role="alert" className="mt-3 rounded-[8px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{error}</p>}
    </section>
  );
}

function ReviewedMethodCardIntakePanel() {
  const [rawInput, setRawInput] = useState("");
  const [prepared, setPrepared] = useState<PreparedReviewedMethodCardBatch | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState("");

  function invalidateCheck() {
    setPrepared(null);
    setConfirmed(false);
    setSavedCount(0);
    setError("");
  }

  function handleCheck() {
    try {
      const input = JSON.parse(rawInput) as PrepareReviewedMethodCardBatchInput;
      const result = prepareReviewedMethodCardBatch(input);
      setPrepared(result);
      setConfirmed(false);
      setSavedCount(0);
      setError("");
    } catch (checkError) {
      setPrepared(null);
      setConfirmed(false);
      setSavedCount(0);
      setError(checkError instanceof Error ? checkError.message : "全库检查失败，请重新检查");
    }
  }

  function handleSave() {
    if (!prepared || !confirmed || saving || savedCount > 0) return;
    setSaving(true);
    setError("");
    try {
      const savedEntries = saveReviewedMethodCardBatch(prepared);
      setSavedCount(savedEntries.length);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "人工确认方法卡保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-[16px] border border-[#E5E4DE] bg-white p-5">
      <div className="rounded-[10px] bg-[#F5F8EE] px-4 py-3 text-[12.5px] text-[#4E6C25]">
        <strong>不会调用AI，只保存已经人工审核完成的字段</strong>
        <p className="mt-1">系统会在保存前重新核对全库检查结果，确认后再严格写入。</p>
      </div>
      <label className="mt-4 block text-[12.5px] font-semibold text-[#555]">
        已审核方法卡数据
        <textarea
          aria-label="已审核方法卡数据"
          value={rawInput}
          onChange={event => {
            invalidateCheck();
            setRawInput(event.target.value);
          }}
          rows={14}
          placeholder="粘贴已经人工审核完成的方法卡数据"
          className="mt-1 w-full resize-y rounded-[10px] border border-[#E5E4DE] px-3 py-2 font-mono text-[12px] leading-5 font-normal"
        />
      </label>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={handleCheck}
          disabled={!rawInput.trim() || saving || savedCount > 0}
          className="rounded-[9px] bg-[#1C1C1B] px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-40"
        >
          检查已审核方法卡
        </button>
      </div>
      {prepared && (
        <>
          <div className="mt-4 space-y-3">
            {prepared.cards.map((card, index) => (
              <article key={card.cardKey} className="rounded-[10px] border border-[#E5E4DE] p-3">
                <h2 className="text-[13px] font-bold text-[#333]">{card.title}</h2>
                <p className="mt-1 text-[11.5px] text-[#777]">{card.category}｜来源：{card.sourceName}</p>
                <KnowledgePrecheckPanel assessment={prepared.assessments[index]!} />
              </article>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" aria-pressed={confirmed} onClick={() => setConfirmed(true)} disabled={saving || savedCount > 0} className="rounded-[8px] border border-[#BFD59F] px-3 py-1.5 text-[11.5px] font-bold text-[#4E6C25] disabled:opacity-40">继续保存这批方法卡</button>
            <button type="button" aria-pressed={!confirmed} onClick={() => setConfirmed(false)} disabled={saving || savedCount > 0} className="rounded-[8px] border border-[#D8D5C9] px-3 py-1.5 text-[11.5px] font-semibold text-[#666] disabled:opacity-40">暂不入库</button>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={handleSave} disabled={!confirmed || saving || savedCount > 0} className="rounded-[9px] bg-[#639922] px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-40">
              {savedCount > 0 ? `已保存${savedCount}张方法卡` : saving ? "正在保存…" : `确认保存${prepared.cards.length}张方法卡`}
            </button>
          </div>
        </>
      )}
      {savedCount > 0 && <p className="mt-3 rounded-[8px] bg-[#EAF3DE] px-3 py-2 text-[12.5px] font-semibold text-[#3B6D11]">已严格保存{savedCount}张人工确认方法卡</p>}
      {error && <p role="alert" className="mt-3 rounded-[8px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{error}</p>}
    </section>
  );
}

function listText(items?: string[]) {
  return (items ?? []).map(t => t.trim()).filter(Boolean).join("、");
}

function sourceSegmentsText(sources: KnowledgeMethodCardSource[]) {
  if (sources.length === 0) return "";
  const visible = sources.slice(0, 2).map(source => `第${source.index}段·${source.title}`);
  return `来源：${visible.join("、")}${sources.length > 2 ? ` 等${sources.length}个章节` : ""}`;
}

function buildMethodCardContent(item: IntakeItem) {
  const examples = (item.examples ?? [])
    .map(ex => `原题：${ex.input ?? ""}\n优化：${ex.output ?? ""}`.trim())
    .filter(Boolean)
    .join("\n");
  return [
    `【一句话总结】\n${item.summary}`,
    item.coreMethod ? `【核心方法】\n${item.coreMethod}` : "",
    listText(item.applicableScenarios) ? `【适用场景】\n${listText(item.applicableScenarios)}` : "",
    listText(item.triggerKeywords) ? `【触发关键词】\n${listText(item.triggerKeywords)}` : "",
    listText(item.similarPhrases) ? `【相似说法】\n${listText(item.similarPhrases)}` : "",
    item.aiUsage ? `【AI调用方式】\n${item.aiUsage}` : "",
    examples ? `【示例】\n${examples}` : "",
    listText(item.unsuitableCases) ? `【不适用情况】\n${listText(item.unsuitableCases)}` : "",
    item.reusableValue ? `【可复用场景】\n${item.reusableValue}` : "",
  ].filter(Boolean).join("\n\n");
}

function buildIPUnderstandingContent(item: IntakeItem, originalContent: string) {
  return [
    `【内容概要】\n${item.summary}`,
    item.understanding ? `【AI对内容的理解】\n${item.understanding}` : "",
    listText(item.keyPoints) ? `【原文关键信息】\n${listText(item.keyPoints)}` : "",
    item.relationToIP ? `【与当前IP的关系】\n${item.relationToIP}` : "",
    `【原始内容】\n${originalContent.trim()}`,
  ].filter(Boolean).join("\n\n");
}

function buildPrecheckCandidate(
  item: Omit<IntakeItem, "precheck">,
  isIPMode: boolean,
  originalContent: string,
): KnowledgeIntakePrecheckCandidate {
  return {
    id: item.id,
    kind: isIPMode ? "raw_text" : "method_card",
    title: item.title,
    summary: item.summary,
    coreMethod: item.coreMethod,
    applicableScenarios: item.applicableScenarios,
    aiUsage: item.aiUsage,
    rawContent: isIPMode
      ? buildIPUnderstandingContent(item as IntakeItem, originalContent)
      : buildMethodCardContent(item as IntakeItem),
  };
}

interface KnowledgeIntakePageProps {
  searchParams?: {
    scope?: string;
    category?: string;
  };
}

export default function KnowledgeIntakePage({ searchParams }: KnowledgeIntakePageProps) {
  const { ips, activeIP } = useIP();
  const isIPMode = searchParams?.scope === "ip";
  const requestedCategory = searchParams?.category ?? "";
  const [intakeMode, setIntakeMode] = useState<"ai" | "exact" | "reviewed">("ai");
  const pageTitle = isIPMode
    ? "IP内容理解入库"
    : intakeMode === "exact"
      ? "原文保真保存"
      : intakeMode === "reviewed"
        ? "人工确认方法卡"
      : "智能入库助手";
  const availableCategories = isIPMode
    ? IP_CATEGORIES.map(category => category.id).filter(category => category !== "IP原始内容")
    : ALL_CATS;
  const [rawContent, setRawContent] = useState("");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [sourceType, setSourceType] = useState<"text" | "excel">("text");
  const [fileProcessing, setFileProcessing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<IntakeItem[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saveCount, setSaveCount] = useState(0);
  const [showSegmentPreview, setShowSegmentPreview] = useState(false);
  const [segmentRuns, setSegmentRuns] = useState<SegmentRun[]>([]);
  const [segmentProgress, setSegmentProgress] = useState<{ current: number; total: number; title: string } | null>(null);
  const [exactDuplicateCount, setExactDuplicateCount] = useState(0);
  const [resolvedSimilarGroupIds, setResolvedSimilarGroupIds] = useState<string[]>([]);
  const globalContentLength = rawContent.trim().length;
  const globalContentAboveRecommended = !isIPMode && globalContentLength > GLOBAL_KNOWLEDGE_INTAKE_MAX_CHARS;
  const globalSegmentation = useMemo(
    () => globalContentAboveRecommended ? segmentKnowledgeIntakeContent(rawContent) : null,
    [globalContentAboveRecommended, rawContent],
  );
  const globalUsesDirectTolerance = globalContentAboveRecommended &&
    globalContentLength <= GLOBAL_KNOWLEDGE_INTAKE_TOLERANCE_MAX_CHARS &&
    globalSegmentation?.status === "manual_required" &&
    globalSegmentation.reason === "no_reliable_headings";
  const globalContentTooLong = globalContentAboveRecommended && !globalUsesDirectTolerance;
  const globalLengthWarning = globalContentAboveRecommended
    ? globalUsesDirectTolerance
      ? buildGlobalKnowledgeIntakeToleranceMessage(globalContentLength)
      : globalSegmentation?.status === "manual_required" && globalSegmentation.reason === "section_too_long"
        ? globalSegmentation.message
      : buildGlobalKnowledgeIntakeLengthMessage(globalContentLength)
    : "";
  const segmentedDeduplicationActive = !isIPMode && segmentRuns.length > 0;
  const segmentWorkflowBusy = segmentedDeduplicationActive &&
    (loading || segmentRuns.some(run => run.status === "pending" || run.status === "processing"));
  const retryInProgress = segmentRuns.some(run => run.status === "processing");
  const similarGroups = useMemo(
    () => segmentedDeduplicationActive ? groupKnowledgeMethodCards(items).similarGroups : [],
    [items, segmentedDeduplicationActive],
  );
  const duplicateReviewReady = segmentedDeduplicationActive && !segmentWorkflowBusy;
  const unresolvedSimilarGroups = duplicateReviewReady
    ? similarGroups.filter(group => !resolvedSimilarGroupIds.includes(group.id))
    : [];

  useEffect(() => {
    setShowSegmentPreview(false);
    setSegmentRuns([]);
    setSegmentProgress(null);
    setExactDuplicateCount(0);
    setResolvedSimilarGroupIds([]);
  }, [rawContent, isIPMode]);

  function mapResponseItems(
    responseItems: IntakeItem[],
    originalContent: string,
    sourceSegment?: { id: string; title: string; index: number },
  ): IntakeItem[] {
    const mappedItems = responseItems.map((it, index) => ({
      ...it,
      tags: isIPMode ? it.keywords ?? [] : it.tags ?? [],
      id: `item-${sourceSegment?.id ?? "single"}-${index}-${Date.now()}`,
      selected: it.ingestRecommend === "建议入库" &&
        (!isIPKnowledgeCategory(it.category) || Boolean(it.ipId)),
      sourceSegments: sourceSegment ? [sourceSegment] : [],
    }));
    const result = runKnowledgeIntakePrecheck({
      candidates: mappedItems.map(item => buildPrecheckCandidate(item, isIPMode, originalContent)),
      existingEntries: getKnowledgeEntriesForFullLibraryComparison(),
      ipNamesById: Object.fromEntries(ips.map(ip => [ip.id, ip.name])),
    });
    const assessmentsById = new Map(result.assessments.map(assessment => [assessment.candidateId, assessment]));
    return mappedItems.map(item => ({
      ...item,
      precheck: assessmentsById.get(item.id) ?? {
        candidateId: item.id,
        quality: { status: "needs_manual_review", issues: [{
          code: "PRECHECK_UNAVAILABLE",
          message: "入库前检查结果暂不可用，请人工检查",
        }] },
        similarEntries: [],
      },
    }));
  }

  function applyDuplicateClassification(cards: IntakeItem[]) {
    const result = groupKnowledgeMethodCards(cards);
    setItems(cards);
    setExactDuplicateCount(result.exactDuplicateCount);
    setResolvedSimilarGroupIds([]);
  }

  async function requestIntake(
    content: string,
    sourceSegment?: { id: string; title: string; index: number },
  ): Promise<IntakeItem[]> {
    const res = await apiFetch("/api/knowledge-intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawContent: content,
        sourceType,
        sourceName: fileName,
        scope: isIPMode ? "ip" : "global",
        requestedCategory: isIPMode ? requestedCategory : undefined,
        activeIPId: activeIP?.id ?? null,
        availableIPs: ips.map(ip => ({
          id: ip.id,
          name: ip.name,
          positioning: ip.positioning,
          contentDirection: ip.contentDirection,
        })),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "分析失败");
    const responseItems = data.mode === "ip"
      ? data.item ? [data.item] : []
      : Array.isArray(data.items) ? data.items : [];
    return mapResponseItems(responseItems, content, sourceSegment);
  }

  async function handleInputFile(file: File) {
    setError("");
    setFileName(file.name);
    if (file.name.match(/\.xlsx?$/i)) {
      setFileProcessing(true);
      setSourceType("excel");
      try {
        const result = await parseXlsxFile(file);
        const sheet = result.sheets[0];
        if (!sheet) { setError("Excel 文件为空"); return; }
        const rows = sheet.rows.map(row => Object.values(row).filter(Boolean).join(" | ")).filter(Boolean);
        setRawContent(sheet.headers.join(" | ") + "\n" + rows.join("\n"));
      } catch {
        setRawContent("");
        setError("Excel 解析失败");
      } finally {
        setFileProcessing(false);
      }
      return;
    }

    if (!file.name.match(/\.(txt|md)$/i) && !["text/plain", "text/markdown"].includes(file.type)) {
      setError("暂时支持 txt、md、xlsx、xls 格式");
      return;
    }

    setSourceType("text");
    const reader = new FileReader();
    reader.onload = ev => setRawContent((ev.target && ev.target.result as string) || "");
    reader.onerror = () => setError("文件读取失败");
    reader.readAsText(file, "utf-8");
  }

  async function handleAnalyze() {
    if (!rawContent.trim()) { setError("请先粘贴原始资料"); return; }
    if (isIPMode && !activeIP) { setError("请先选择当前IP"); return; }
    if (globalContentTooLong) { setError(globalLengthWarning); return; }
    setLoading(true); setError(""); setItems([]); setSaved(false);
    setExactDuplicateCount(0);
    setResolvedSimilarGroupIds([]);
    try {
      setItems(await requestIntake(rawContent));
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误");
    } finally {
      setLoading(false);
    }
  }

  async function handleSegmentAnalyze() {
    if (globalSegmentation?.status !== "ready") return;
    const segments = globalSegmentation.segments;
    setLoading(true);
    setError("");
    setItems([]);
    setSaved(false);
    setShowSegmentPreview(false);
    setExactDuplicateCount(0);
    setResolvedSimilarGroupIds([]);
    setSegmentRuns(segments.map(segment => ({ segment, status: "pending" })));
    let collectedItems: IntakeItem[] = [];
    try {
      for (const [index, segment] of segments.entries()) {
        setSegmentProgress({ current: index + 1, total: segments.length, title: segment.title });
        setSegmentRuns(current => current.map(run => run.segment.id === segment.id
          ? { ...run, status: "processing", error: undefined }
          : run));
        try {
          const segmentItems = await requestIntake(segment.content, {
            id: segment.id,
            title: segment.title,
            index: index + 1,
          });
          collectedItems = [...collectedItems, ...segmentItems];
          setItems(collectedItems);
          setSegmentRuns(current => current.map(run => run.segment.id === segment.id
            ? { ...run, status: "completed", error: undefined }
            : run));
        } catch (segmentError) {
          setSegmentRuns(current => current.map(run => run.segment.id === segment.id
            ? { ...run, status: "failed", error: segmentError instanceof Error ? segmentError.message : "分析失败" }
            : run));
        }
      }
    } finally {
      applyDuplicateClassification(collectedItems);
      setSegmentProgress(null);
      setLoading(false);
    }
  }

  async function handleRetrySegment(segmentId: string) {
    const run = segmentRuns.find(candidate => candidate.segment.id === segmentId);
    if (!run || run.status === "processing" || retryInProgress) return;
    const segmentIndex = segmentRuns.findIndex(candidate => candidate.segment.id === segmentId) + 1;
    setSegmentRuns(current => current.map(candidate => candidate.segment.id === segmentId
      ? { ...candidate, status: "processing", error: undefined }
      : candidate));
    try {
      const segmentItems = await requestIntake(run.segment.content, {
        id: run.segment.id,
        title: run.segment.title,
        index: segmentIndex,
      });
      applyDuplicateClassification([...items, ...segmentItems]);
      setSegmentRuns(current => current.map(candidate => candidate.segment.id === segmentId
        ? { ...candidate, status: "completed", error: undefined }
        : candidate));
    } catch (segmentError) {
      setSegmentRuns(current => current.map(candidate => candidate.segment.id === segmentId
        ? { ...candidate, status: "failed", error: segmentError instanceof Error ? segmentError.message : "分析失败" }
        : candidate));
    }
  }

  function resetIntake() {
    if (retryInProgress) {
      setError("失败分段正在重试，请等待完成后再重新输入");
      return;
    }
    setItems([]);
    setSegmentRuns([]);
    setSegmentProgress(null);
    setExactDuplicateCount(0);
    setResolvedSimilarGroupIds([]);
    setRawContent("");
    setFileName("");
    setSourceType("text");
    setSaved(false);
    setError("");
  }

  function handleSave() {
    if (segmentWorkflowBusy) {
      setError("分段内容仍在提炼，请等待全部处理完成后再入库");
      return;
    }
    if (unresolvedSimilarGroups.length > 0) {
      setError("请先处理疑似重复项，再确认入库");
      return;
    }
    const toSave = items.filter(it => it.selected);
    const unboundItem = toSave.find(it => {
      const category = it.categoryOverride || it.category;
      return isIPKnowledgeCategory(category) && !it.ipId;
    });
    if (unboundItem) {
      setError(`请先为“${unboundItem.title}”选择所属IP`);
      return;
    }
    let count = 0;
    for (const it of toSave) {
      const cat = (it.categoryOverride || it.category) as KnowledgeCategory;
      if (isIPMode) {
        const keywords = (it.keywords ?? []).map(keyword => keyword.trim()).filter(Boolean);
        const evidence = JSON.stringify({
          intakeMode: "ip_understanding",
          originalCategory: it.category,
          normalizedCategory: cat,
          methodCard: false,
          understanding: it.understanding ?? "",
          keyPoints: it.keyPoints ?? [],
          relationToIP: it.relationToIP ?? "",
          confidence: it.confidence,
          reason: it.confidenceReason,
          needsReview: it.ingestRecommend === "待确认",
        });
        addKnowledgeEntry({
          category: cat,
          title: it.title,
          rawContent: buildIPUnderstandingContent(it, rawContent),
          tags: keywords,
          keywords,
          ipId: it.ipId ?? activeIP?.id ?? null,
          sourceTier: (["高","中","低"].includes(it.confidence) ? it.confidence as "高"|"中"|"低" : "低"),
          sourceTierReason: it.confidenceReason,
          contentDirection: [],
          sourcePlatform: "IP内容理解入库",
          sourceUrl: "",
          note: evidence,
          extractedAt: new Date().toISOString(),
          metrics: null,
          viralEvaluation: null,
          usageRecords: [],
          status: "未使用",
          dna: null,
        });
        count++;
        continue;
      }
      const triggerKeywords = [...(it.triggerKeywords ?? []), ...(it.similarPhrases ?? [])].map(t => t.trim()).filter(Boolean);
      const ev = JSON.stringify({
        originalCategory: it.category,
        normalizedCategory: cat,
        methodCard: true,
        coreMethod: it.coreMethod ?? "",
        applicableScenarios: it.applicableScenarios ?? [],
        triggerKeywords: it.triggerKeywords ?? [],
        similarPhrases: it.similarPhrases ?? [],
        aiUsage: it.aiUsage ?? "",
        examples: it.examples ?? [],
        unsuitableCases: it.unsuitableCases ?? [],
        confidence: it.confidence,
        reason: it.confidenceReason,
        matchedRules: [...(it.tags ?? []), ...triggerKeywords],
        needsReview: it.ingestRecommend === "待确认",
        sourceSegments: it.sourceSegments,
      });
      addKnowledgeEntry({ category: cat, title: it.title, rawContent: buildMethodCardContent(it), tags: it.tags ?? [], keywords: triggerKeywords, ipId: isIPKnowledgeCategory(cat) ? it.ipId : null, sourceTier: (["高","中","低"].includes(it.confidence) ? it.confidence as "高"|"中"|"低" : "低"), sourceTierReason: it.aiUsage || it.confidenceReason, contentDirection: it.applicableScenarios ?? [], sourcePlatform: "智能入库助手", sourceUrl: "", note: ev, extractedAt: new Date().toISOString(), metrics: null, viralEvaluation: null, usageRecords: [], status: "未使用", dna: null });
      count++;
    }
    setSaveCount(count);
    setSaved(true);
  }

  const selectedCount = items.filter(it => it.selected).length;

  function cardsForSimilarGroup(group: SimilarKnowledgeMethodCardGroup) {
    return group.cardIds
      .map(cardId => items.find(item => item.id === cardId))
      .filter((item): item is IntakeItem => Boolean(item));
  }

  function handleKeepSimilarCard(group: SimilarKnowledgeMethodCardGroup, cardId: string) {
    if (retryInProgress) return;
    const groupCardIds = new Set(group.cardIds);
    setItems(current => current.filter(item => !groupCardIds.has(item.id) || item.id === cardId));
  }

  function handleMergeSimilarGroup(group: SimilarKnowledgeMethodCardGroup) {
    if (retryInProgress) return;
    const groupCards = cardsForSimilarGroup(group);
    if (groupCards.length < 2) return;
    const merged = mergeKnowledgeMethodCards(groupCards);
    const groupCardIds = new Set(group.cardIds);
    const firstIndex = items.findIndex(item => groupCardIds.has(item.id));
    setItems(current => {
      const remaining = current.filter(item => !groupCardIds.has(item.id));
      remaining.splice(Math.max(0, firstIndex), 0, merged);
      return remaining;
    });
  }

  function handleKeepAllSimilarCards(group: SimilarKnowledgeMethodCardGroup) {
    if (retryInProgress) return;
    setResolvedSimilarGroupIds(current => current.includes(group.id) ? current : [...current, group.id]);
  }

  return (
    <div className="min-h-screen p-6 md:p-8">
      <header className="mb-6">
        <div className="mb-1.5 text-[13px] text-[#8A8A86]">
          <a href="/" className="font-semibold text-[#639922]">工作台</a> / <a href="/knowledge-hub" className="text-[#639922]">知识库中心</a> / {pageTitle}
        </div>
        <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1B]">{pageTitle}</h1>
        <p className="mt-1 text-[13px] text-[#888]">
          {isIPMode
            ? `忠实理解你输入的完整内容，保留原文和思维脉络，确认后写入「${activeIP?.name ?? "当前IP"}」知识库。`
            : intakeMode === "exact"
              ? "逐字保存完整执行模板，不调用AI；检查全库相似内容后由你确认是否入库。"
              : intakeMode === "reviewed"
                ? "保存已经人工审核完成的方法卡，不调用AI；保存前重新核对全库检查结果。"
              : "粘贴原始资料，AI自动提炼成可复用的短视频方法知识，确认后写入通用知识库。"}
        </p>
      </header>

      {!isIPMode && (
        <div className="mb-4 flex gap-2" aria-label="入库模式">
          <button type="button" aria-pressed={intakeMode === "ai"} onClick={() => setIntakeMode("ai")} className="rounded-[9px] border px-4 py-2 text-[12.5px] font-bold">AI提炼方法卡</button>
          <button type="button" aria-pressed={intakeMode === "exact"} onClick={() => setIntakeMode("exact")} className="rounded-[9px] border px-4 py-2 text-[12.5px] font-bold">原文保真保存</button>
          <button type="button" aria-pressed={intakeMode === "reviewed"} onClick={() => setIntakeMode("reviewed")} className="rounded-[9px] border px-4 py-2 text-[12.5px] font-bold">人工确认方法卡</button>
        </div>
      )}

      {intakeMode === "exact" && !isIPMode ? (
        <ExactTemplateIntakePanel ipNamesById={Object.fromEntries(ips.map(ip => [ip.id, ip.name]))} />
      ) : intakeMode === "reviewed" && !isIPMode ? (
        <ReviewedMethodCardIntakePanel />
      ) : (
        <>

      {items.length === 0 && !loading && (
        <div className="rounded-[16px] border border-[#E5E4DE] bg-white p-5">
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); setError(""); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault(); setDragging(false);
              const file = e.dataTransfer.files[0];
              if (!file) return;
              handleInputFile(file);
            }}
            className="mb-4 flex cursor-pointer flex-col items-center gap-2 rounded-[12px] border-2 border-dashed py-6 text-center transition-all"
            style={{ borderColor: dragging ? "#639922" : "#E5E4DE", background: dragging ? "#F7FCF0" : "#FAFAF8" }}
            onClick={() => { setError(""); const el = document.getElementById("kb-file-input"); if (el) el.click(); }}
          >
            <span className="text-[24px]">📄</span>
            <p className="text-[12.5px] font-semibold text-[#555]">{fileName || "拖拽文字或Excel资料到这里，或点击上传"}</p>
            <p className="text-[11.5px] text-[#AAA]">支持txt、md、xlsx、xls，也可以在下方直接粘贴文字</p>
            <input id="kb-file-input" type="file" accept={INTAKE_FILE_ACCEPT} className="hidden"
              onChange={e => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                handleInputFile(file);
                e.target.value = "";
              }} />
          </div>
          <label className="mb-2 block text-[13px] font-semibold text-[#555]">或粘贴原始资料</label>
          <textarea value={rawContent} onChange={e => { setRawContent(e.target.value); setFileName(""); setSourceType("text"); setError(""); }}
            placeholder={isIPMode
              ? "粘贴当前IP的逐字稿、文章、观点、经历或受众反馈…AI会理解完整内容，不会拆成方法卡。"
              : "粘贴逐字稿、文案、方法论笔记、评论洞察…AI会提炼成可复用的短视频方法知识。"}
            rows={8}
            className="w-full resize-none rounded-[12px] border border-[#E5E4DE] bg-[#FAFAF8] px-4 py-3 text-[13px] leading-6 text-[#333] outline-none focus:border-[#639922]" />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[12px] text-[#BBB]">{rawContent.length} 字{fileName ? " · " + fileName : ""}</span>
            <button
              onClick={handleAnalyze}
              disabled={!rawContent.trim() || fileProcessing || loading || globalContentTooLong || (isIPMode && !activeIP)}
              className="rounded-[12px] px-6 py-2.5 text-[13px] font-bold disabled:opacity-40"
              style={{ background: "#C8F04A", color: "#1A1A1A" }}>
              {fileProcessing ? "正在读取Excel…" : isIPMode ? "AI理解内容" : "AI提炼方法"}
            </button>
          </div>
          {globalLengthWarning && (
            <div className="mt-3 rounded-[8px] bg-[#FBF3D6] px-3 py-2 text-[12.5px] text-[#7A5C00]">
              <div className="flex items-center justify-between gap-3">
                <span>
                  {globalSegmentation?.status === "ready"
                    ? `当前内容${rawContent.trim().length}字，已识别为${globalSegmentation.segments.length}个不超过4000字的分段`
                    : globalLengthWarning}
                </span>
                {globalSegmentation?.status === "ready" && (
                  <button
                    type="button"
                    onClick={() => setShowSegmentPreview(current => !current)}
                    className="shrink-0 rounded-[8px] border border-[#D8BE63] bg-white px-3 py-1.5 font-bold text-[#6B5100]"
                  >
                    {showSegmentPreview ? "收起分段预览" : "预览自动分段"}
                  </button>
                )}
              </div>
            </div>
          )}
          {showSegmentPreview && globalSegmentation?.status === "ready" && (
            <section className="mt-3 rounded-[10px] border border-[#DDE8C5] bg-[#FAFCF5] p-3">
              <h2 className="text-[13px] font-bold text-[#34451F]">分段预览（共{globalSegmentation.segments.length}段）</h2>
              <p className="mt-1 text-[11.5px] text-[#788269]">分段只依据标题边界，不会拆开表格、代码块、引用或连续列表。</p>
              <div className="mt-3 space-y-2">
                {globalSegmentation.segments.map((segment, index) => (
                  <article key={segment.id} className="rounded-[8px] border border-[#E5E9DC] bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <strong className="text-[12.5px] text-[#333]">{index + 1}. {segment.title}</strong>
                      <span className="shrink-0 text-[11.5px] text-[#888]">{segment.charCount}字</span>
                    </div>
                    <p className="mt-1 text-[11.5px] text-[#888]">包含：{segment.chapterTitles.join("、")}</p>
                  </article>
                ))}
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={handleSegmentAnalyze}
                  className="rounded-[8px] bg-[#1C1C1B] px-4 py-2 text-[12.5px] font-bold text-white"
                >
                  确认分段并开始提炼
                </button>
              </div>
            </section>
          )}
          {error && <div className="mt-3 flex items-center justify-between rounded-[8px] bg-[#FCEBEB] px-3 py-2"><p className="text-[12.5px] text-[#A32D2D]">{error}</p><button onClick={() => setError("")} className="ml-2 text-[12px] text-[#A32D2D] font-bold">✕</button></div>}
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center gap-3 py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#E5E4DE] border-t-[#639922]" />
          <p className="text-[13px] text-[#888]">
            {segmentProgress
              ? `正在提炼第${segmentProgress.current}/${segmentProgress.total}段：${segmentProgress.title}`
              : `${isIPMode ? "AI正在理解完整内容" : "AI正在提炼资料"}，生成中请稍候，请勿重复提交，最坏约2分钟。`}
          </p>
        </div>
      )}

      {segmentRuns.length > 0 && !saved && (
        <section className="mb-4 rounded-[12px] border border-[#E5E4DE] bg-white p-4">
          <h2 className="text-[13px] font-bold text-[#333]">分段提炼进度</h2>
          <div className="mt-2 space-y-2">
            {segmentRuns.map((run, index) => (
              <div key={run.segment.id} className="flex items-center justify-between gap-3 rounded-[8px] bg-[#FAFAF8] px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-[#444]">第{index + 1}段·{run.segment.title}</p>
                  {run.status === "failed" && <p className="mt-0.5 text-[11.5px] text-[#A32D2D]">{run.error ?? "分析失败"}</p>}
                </div>
                {run.status === "failed" ? (
                  <button
                    type="button"
                    onClick={() => handleRetrySegment(run.segment.id)}
                    disabled={retryInProgress}
                    className="shrink-0 rounded-[8px] border border-[#D08A8A] bg-white px-3 py-1.5 text-[11.5px] font-bold text-[#A32D2D]"
                  >
                    重试第{index + 1}段
                  </button>
                ) : (
                  <span className="shrink-0 text-[11.5px] text-[#888]">
                    {run.status === "completed" ? "已完成" : run.status === "processing" ? "提炼中" : "等待中"}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {exactDuplicateCount > 0 && items.length > 0 && !saved && (
        <div className="mb-4 rounded-[10px] border border-[#DDE8C5] bg-[#F7FBEF] px-4 py-3 text-[12.5px] text-[#4E6C25]">
          {`发现${exactDuplicateCount}张批次内完全相同的方法卡，系统未自动合并，请逐条确认是否继续入库。`}
        </div>
      )}

      {unresolvedSimilarGroups.length > 0 && items.length > 0 && !saved && (
        <section className="mb-4 rounded-[12px] border border-[#E7D8A2] bg-[#FFFDF6] p-4">
          <h2 className="text-[14px] font-bold text-[#4D3F12]">疑似重复项确认</h2>
          <p className="mt-1 text-[12px] text-[#806F37]">这些方法卡的核心方法和使用场景高度相似。请确认后再入库，系统不会仅凭标题替你删除。</p>
          <div className="mt-3 space-y-3">
            {unresolvedSimilarGroups.map((group, groupIndex) => {
              const groupCards = cardsForSimilarGroup(group);
              return (
                <article key={group.id} className="rounded-[10px] border border-[#E9DFC0] bg-white p-3">
                  <h3 className="text-[12.5px] font-bold text-[#554819]">疑似重复组{groupIndex + 1}</h3>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {groupCards.map(card => (
                      <div key={card.id} className="rounded-[8px] bg-[#FAFAF8] p-3">
                        <strong className="text-[12.5px] text-[#333]">{card.title}</strong>
                        <p className="mt-1 text-[11.5px] leading-5 text-[#666]">{card.summary}</p>
                        {card.coreMethod && <p className="mt-1 text-[11.5px] text-[#777]">核心方法：{card.coreMethod}</p>}
                        {sourceSegmentsText(card.sourceSegments) && <p className="mt-1 text-[11px] text-[#73943D]">{sourceSegmentsText(card.sourceSegments)}</p>}
                        <button
                          type="button"
                          onClick={() => handleKeepSimilarCard(group, card.id)}
                          disabled={retryInProgress}
                          className="mt-2 rounded-[7px] border border-[#D8D5C9] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#555] disabled:opacity-40"
                        >
                          只保留「{card.title}」
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleMergeSimilarGroup(group)}
                      disabled={retryInProgress}
                      className="rounded-[8px] bg-[#1C1C1B] px-3 py-1.5 text-[11.5px] font-bold text-white disabled:opacity-40"
                    >
                      合并这组
                    </button>
                    <button
                      type="button"
                      onClick={() => handleKeepAllSimilarCards(group)}
                      disabled={retryInProgress}
                      className="rounded-[8px] border border-[#D8D5C9] bg-white px-3 py-1.5 text-[11.5px] font-semibold text-[#555] disabled:opacity-40"
                    >
                      全部保留
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {items.length > 0 && !saved && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <span className="text-[15px] font-bold text-[#1C1C1B]">{isIPMode ? "理解结果" : "提炼结果"}</span>
              <span className="ml-2 text-[13px] text-[#888]">共 {items.length} 条，已选 {selectedCount} 条</span>
            </div>
            <div className="flex gap-2">
              <button onClick={resetIntake} disabled={retryInProgress}
                className="rounded-[10px] bg-[#F2F1ED] px-4 py-2 text-[12.5px] font-semibold text-[#666] disabled:opacity-40">重新输入</button>
              <button onClick={handleSave} disabled={selectedCount === 0 || segmentWorkflowBusy || unresolvedSimilarGroups.length > 0}
                className="rounded-[10px] px-4 py-2 text-[12.5px] font-bold disabled:opacity-40"
                style={{ background: "#1C1C1B", color: "#fff" }}>
                {isIPMode ? "写入当前IP知识库" : "写入通用知识库"}（{selectedCount} 条）
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {items.map((item, i) => {
              const effectiveCategory = item.categoryOverride || item.category;
              return (
              <div key={item.id} className="rounded-[14px] border-2 bg-white p-4 transition-all"
                style={{ borderColor: item.selected ? "#639922" : "#E5E4DE" }}>
                <div className="mb-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-bold text-[#1C1C1B]">{item.title}</span>
                      {sourceSegmentsText(item.sourceSegments) && (
                        <span className="rounded-full bg-[#EEF4E2] px-2 py-0.5 text-[10.5px] font-semibold text-[#587B25]">
                          {sourceSegmentsText(item.sourceSegments)}
                        </span>
                      )}
                      <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={CONF_STYLE[item.confidence] ?? CONF_STYLE["低"]}>{item.confidence}置信度</span>
                      <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={REC_STYLE[item.ingestRecommend] ?? REC_STYLE["待确认"]}>{item.ingestRecommend}</span>
                    </div>
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11.5px] text-[#888]">分类：</span>
                      <select value={effectiveCategory} disabled={retryInProgress}
                        onChange={e => setItems(prev => prev.map((it,j) => j===i ? {
                          ...it,
                          categoryOverride: e.target.value,
                          ipId: isIPKnowledgeCategory(e.target.value) && ips.some(ip => ip.id === it.ipId)
                            ? it.ipId
                            : null,
                          selected: isIPKnowledgeCategory(e.target.value) ? false : it.selected,
                        } : it))}
                        className="rounded-[6px] border border-[#E5E4DE] px-2 py-0.5 text-[11.5px] outline-none">
                        {availableCategories.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    {isIPKnowledgeCategory(effectiveCategory) && (
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11.5px] text-[#888]">所属IP：</span>
                        <select
                          value={item.ipId ?? ""}
                          disabled={retryInProgress}
                          onChange={e => setItems(prev => prev.map((it,j) => j===i ? {
                            ...it,
                            ipId: e.target.value || null,
                            ipMatchStatus: e.target.value ? "matched" : "uncertain",
                            selected: e.target.value ? it.selected : false,
                          } : it))}
                          className="rounded-[6px] border border-[#E5E4DE] px-2 py-0.5 text-[11.5px] outline-none"
                        >
                          <option value="">请选择所属IP</option>
                          {ips.map(ip => <option key={ip.id} value={ip.id}>{getIPDisplayLabel(ip, ips)}</option>)}
                        </select>
                        {item.ipMatchReason && <span className="text-[11px] text-[#AAA]">{item.ipMatchReason}</span>}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {(item.tags ?? []).map(t => <span key={t} className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10.5px] text-[#666]">#{t}</span>)}
                    </div>
                  </div>
                </div>
                <div className="mb-2 rounded-[10px] bg-[#FAFAF8] px-3 py-2.5 text-[12.5px] leading-5 text-[#444]">
                  <p>{item.summary}</p>
                  {isIPMode && item.understanding && <p className="mt-1.5"><span className="font-semibold text-[#555]">内容理解：</span>{item.understanding}</p>}
                  {!isIPMode && item.coreMethod && <p className="mt-1.5"><span className="font-semibold text-[#555]">核心方法：</span>{item.coreMethod}</p>}
                </div>
                {isIPMode && listText(item.keyPoints) && <p className="mb-1 text-[12px] text-[#888]"><span className="font-semibold text-[#555]">原文关键信息：</span>{listText(item.keyPoints)}</p>}
                {isIPMode && item.relationToIP && <p className="mb-1.5 text-[12px] text-[#888]"><span className="font-semibold text-[#555]">与当前IP的关系：</span>{item.relationToIP}</p>}
                {!isIPMode && listText(item.applicableScenarios) && <p className="mb-1 text-[12px] text-[#888]"><span className="font-semibold text-[#555]">适用场景：</span>{listText(item.applicableScenarios)}</p>}
                {!isIPMode && listText(item.triggerKeywords) && <p className="mb-1 text-[12px] text-[#888]"><span className="font-semibold text-[#555]">触发关键词：</span>{listText(item.triggerKeywords)}</p>}
                {!isIPMode && item.aiUsage && <p className="mb-1.5 text-[12px] text-[#888]"><span className="font-semibold text-[#555]">AI调用方式：</span>{item.aiUsage}</p>}
                <p className="text-[11.5px] text-[#AAA]"><span className="font-semibold text-[#888]">入库依据：</span>{item.ingestReason} · {item.confidenceReason}</p>
                <KnowledgePrecheckPanel assessment={item.precheck} />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={item.selected}
                    onClick={() => setItems(previous => previous.map((candidate, index) =>
                      index === i ? { ...candidate, selected: true } : candidate))}
                    disabled={retryInProgress}
                    className="rounded-[8px] border px-3 py-1.5 text-[11.5px] font-bold disabled:opacity-40"
                    style={item.selected
                      ? { borderColor: "#639922", background: "#639922", color: "white" }
                      : { borderColor: "#BFD59F", background: "white", color: "#4E6C25" }}
                  >
                    继续入库「{item.title}」
                  </button>
                  <button
                    type="button"
                    aria-pressed={!item.selected}
                    onClick={() => setItems(previous => previous.map((candidate, index) =>
                      index === i ? { ...candidate, selected: false } : candidate))}
                    disabled={retryInProgress}
                    className="rounded-[8px] border px-3 py-1.5 text-[11.5px] font-semibold disabled:opacity-40"
                    style={!item.selected
                      ? { borderColor: "#C8C5BB", background: "#F2F1ED", color: "#555" }
                      : { borderColor: "#D8D5C9", background: "white", color: "#777" }}
                  >
                    暂不入库「{item.title}」
                  </button>
                </div>
              </div>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={resetIntake} disabled={retryInProgress}
              className="rounded-[10px] bg-[#F2F1ED] px-5 py-2.5 text-[13px] font-semibold text-[#666] disabled:opacity-40">重新输入</button>
            <button onClick={handleSave} disabled={selectedCount === 0 || segmentWorkflowBusy || unresolvedSimilarGroups.length > 0}
              className="rounded-[10px] px-5 py-2.5 text-[13px] font-bold disabled:opacity-40"
              style={{ background: "#1C1C1B", color: "#fff" }}>
              {isIPMode ? "写入当前IP知识库" : "写入通用知识库"}（{selectedCount} 条）
            </button>
          </div>
          {error && <div className="mt-3 rounded-[8px] bg-[#FCEBEB] px-3 py-2 text-[12.5px] text-[#A32D2D]">{error}</div>}
        </>
      )}

      {saved && (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <div className="text-[48px]">✅</div>
          <p className="text-[16px] font-bold text-[#1C1C1B]">成功写入 {saveCount} 条知识</p>
          <p className="text-[13px] text-[#888]">已保存到知识库，可在知识库中心查看和管理。</p>
          <div className="flex gap-3">
            <button onClick={resetIntake}
              className="rounded-[10px] bg-[#F2F1ED] px-5 py-2.5 text-[13px] font-semibold text-[#666]">继续入库</button>
            <a href="/knowledge-hub" className="rounded-[10px] px-5 py-2.5 text-[13px] font-bold text-white" style={{ background: "#1C1C1B" }}>去知识库查看</a>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
