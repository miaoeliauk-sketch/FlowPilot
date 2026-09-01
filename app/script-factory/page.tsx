"use client";
import { apiFetch } from "@/lib/api-fetch";
import { useState, useEffect, useRef } from "react";
import { useIP } from "@/lib/ip-context";
import { addScriptAsset, getKnowledgeEntries, getScriptAssets, recordKnowledgeUsage, getStyleProfile, updateScriptAssetResult } from "@/lib/ip-store";
import { IPProfile, KnowledgeEntry, ScriptAsset, TopicAsset } from "@/lib/types";
import { buildIPContextBlock } from "@/lib/ip-prompt";
import { Select, SelectOption } from "@/components/ui/select";
import { CitationSummary } from "@/components/ui/citation-summary";
import { getNormalizedCategory, isGlobalMethodCategory, isIPKnowledgeCategory } from "@/lib/knowledge-categories";
import {
  clearPartialScriptDraft,
  getPartialScriptDraft,
  PartialScriptDraft,
  savePartialScriptDraft,
} from "@/lib/script-factory-draft";
import type {
  ScriptAttributionAudit,
  ScriptCompressionAudit,
  ScriptDeliveryGate,
  ScriptFactAudit,
  ScriptFactPendingItem,
  ScriptGenerationStatus,
  ScriptOutputStatus,
  ScriptPartialFailure,
  ScriptPostGenerationAudit,
  ScriptQualityCheck,
  ScriptSourceIntegrityAudit,
  SourceIntegrityIssue,
} from "@/lib/script-factory-contract";
import {
  isFactCaseEvidenceConfirmed,
  parseScriptPostGenerationAudit,
} from "@/lib/script-factory-contract";
import {
  getPendingScriptAuditDraft,
  promoteScriptAuditDraft,
  saveScriptAuditDraft,
} from "@/lib/script-factory-audit-draft";
import { addScriptAssetForTopic, resolveTopicForScript, TopicScriptLinkError } from "@/lib/topic-script-link";
import type { CaseDecision, CoverageAssessment, CoverageSourceReference } from "@/lib/script-factory-coverage";
import type { ScriptDirectorRule } from "@/lib/script-director-rule";
import { getScriptDirectorRules } from "@/lib/script-director-rule-store";
import { ensureShuimuranDirectorRuleMigrated } from "@/lib/shuimuran-director-rule-migration";
import { KnowledgeInspirationDrawer } from "@/components/knowledge/KnowledgeInspirationDrawer";
import { getLegacyIPSourceAnalysisItems } from "@/lib/ip-source-analysis-v2";
import {
  BoundaryAuditPanel,
  type BoundaryAuditStatus,
} from "@/components/ip-boundary/BoundaryAuditPanel";
import type { BoundaryReport } from "@/lib/ip-boundary-engine";
import {
  BoundaryAuditTimeoutError,
  buildBoundarySourceBundle,
  decideBoundaryAction,
  fetchBoundaryCheckWithTimeout,
  parseBoundaryCheckUIResponse,
  type BoundaryEvidenceNode,
} from "@/lib/ip-boundary-ui";
import {
  readEphemeralCognitionContext,
  type EphemeralCognitionContext,
} from "@/lib/ip-boundary-interview";
import type {
  GlobalBlockingConstraintDetectionResult,
  GlobalBlockingConstraintMatch,
} from "@/lib/global-content-constraint-detector";
import type { ScriptFactoryConstraintMatchSource } from "@/lib/script-factory-global-constraint-audit";
import {
  applyManualScriptRewrite,
  type ScriptManualRewriteAction,
  type ScriptManualRewriteRecord,
} from "@/lib/script-factory-manual-rewrite";
import { getScriptDeliveryBlockReason } from "@/lib/script-factory-delivery";

const TOPIC_PLACEHOLDER = "输入选题，或粘贴一段需要按当前IP改写的原文";
type GenerationMode = "standard" | "ip";

// ── Types ──
interface TitleOption { title: string; formula: string; platform: string; whyFitsIP: string; role?: "主推" | "流量" | "安全"; recommended?: boolean; }
interface KeywordReply { keyword: string; reply: string; }
interface CommentGuidance { interactionPrompt: string; keywordReplies: KeywordReply[]; dmGuidance: string; materialPackGuidance: string; }
interface OutlineSection { label: string; timeRange: string; content: string; subPoints?: string[]; }
interface StoryboardRow { time: string; scene: string; voiceover: string; subtitle: string; shot: string; material: string; editingTip: string; }
interface ShotPrompt { scene: string; prompt: string; }
interface EditingRhythm { subtitleHighlights: string[]; soundEffects: string[]; screenRecordingCuts: string[]; caseInserts: string[]; pauses: string[]; }
interface OutputLabels { cover: string; outline: string; shooting: string; comment: string; }
interface ApiMeta { apiCalled: boolean; calledAt: string; model: string | null; ipUsed: string | null; mockHit: boolean; error?: string; }
interface EvidenceAudit {
  coverage: string;
  reason: string;
  sourceReferences: CoverageSourceReference[];
  caseNeed: string;
  caseEvidence: { title: string; sourceType: string; verificationStatus: string; sourceUrl?: string; occurredAt?: string } | null;
}
interface GenerationCaseEvidence {
  ipId?: string | null;
  title: string;
  content: string;
  sourceType: string;
  verificationStatus: string;
  sourceUrl?: string;
}
type ScriptFactoryGlobalConstraintReview = Omit<GlobalBlockingConstraintDetectionResult, "matches"> & {
  matches: Array<GlobalBlockingConstraintMatch & {
    sources?: ScriptFactoryConstraintMatchSource[];
  }>;
};
interface ScriptResult {
  generationMode?: GenerationMode;
  outputMode?: "default" | "shuimuran-confirmed";
  generationStatus: ScriptGenerationStatus; partialFailure: ScriptPartialFailure | null;
  ipId: string; ipName: string; topic: string; platform: string;
  formatCategory: string; formatLabel: string; durationSeconds: number; durationLabel: string; goal: string; videoType: string;
  outputLabels: OutputLabels;
  titles: TitleOption[]; coverCopy: string[]; outline: OutlineSection[]; commentGuidance: CommentGuidance;
  ipStyleExplanation: string;
  pendingVerification?: string[];
  compressionAudit?: ScriptCompressionAudit;
  qualityCheck?: ScriptQualityCheck;
  storyboard: StoryboardRow[]; shootingSuggestions: string[]; shotPrompts: ShotPrompt[]; editingRhythm: EditingRhythm;
  apiMeta: ApiMeta;
  globalConstraintReview?: ScriptFactoryGlobalConstraintReview & { source: "server_ledger" };
  evidenceAudit?: EvidenceAudit;
  coverageAssessment?: CoverageAssessment;
  attributionAudit?: ScriptAttributionAudit;
  sourceIntegrityAudit?: ScriptSourceIntegrityAudit;
  factAudit?: ScriptFactAudit;
  postGenerationAuditStatus?: ScriptPostGenerationAudit["status"];
  postGenerationAuditMessage?: string;
  auditVersion?: string;
  auditSessionId?: string;
  deliveryGate?: ScriptDeliveryGate;
  deliveryPersistenceStatus?: "blocked";
  scriptAssetId?: string;
  manualRewrite?: ScriptManualRewriteRecord;
  generationApproval?: {
    coverage: CoverageAssessment["coverage"];
    outputStatus: ScriptOutputStatus;
    confirmationType: "evidence_confirmed" | "limitations_acknowledged";
    missingDimensions: string[];
    confirmedAt: string;
  };
}

interface PendingConstraintReview {
  detection: ScriptFactoryGlobalConstraintReview;
  persist: () => void;
  phase: "awaiting_decision" | "finalizing";
}

interface ScriptAuditResolutionResponse {
  status: "resolved";
  auditSessionId: string;
  auditVersion: string;
  pendingItem: ScriptFactPendingItem;
  deliveryGate: ScriptDeliveryGate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseScriptAuditResolutionResponse(value: unknown): ScriptAuditResolutionResponse | null {
  if (!isRecord(value) || value.status !== "resolved") return null;
  const pendingItem = isRecord(value.pendingItem) ? value.pendingItem : null;
  const deliveryGate = isRecord(value.deliveryGate) ? value.deliveryGate : null;
  if (
    typeof value.auditSessionId !== "string" || !value.auditSessionId.trim()
    || typeof value.auditVersion !== "string" || !value.auditVersion.trim()
    || !pendingItem
    || typeof pendingItem.id !== "string" || !pendingItem.id.trim()
    || (pendingItem.sectionIndex !== null && !Number.isInteger(pendingItem.sectionIndex))
    || !Number.isInteger(pendingItem.paragraphIndex)
    || !["unsupported_specific_claim", "declared_pending_verification"].includes(String(pendingItem.subtype))
    || typeof pendingItem.excerpt !== "string"
    || typeof pendingItem.reason !== "string"
    || pendingItem.resolutionStatus !== "CONFIRMED_ALLOWED"
    || !deliveryGate
    || !["OPEN", "BLOCKED"].includes(String(deliveryGate.status))
    || deliveryGate.auditVersion !== value.auditVersion
    || !Array.isArray(deliveryGate.blockerCodes)
    || !deliveryGate.blockerCodes.every(item => typeof item === "string")
    || !Array.isArray(deliveryGate.pendingItemIds)
    || !deliveryGate.pendingItemIds.every(item => typeof item === "string")
    || (deliveryGate.status === "OPEN"
      && (deliveryGate.blockerCodes.length > 0 || deliveryGate.pendingItemIds.length > 0))
  ) {
    return null;
  }
  return value as unknown as ScriptAuditResolutionResponse;
}

function hasStoredScriptResultShape(value: Record<string, unknown>): boolean {
  const outputLabels = value.outputLabels;
  const commentGuidance = value.commentGuidance;
  const editingRhythm = value.editingRhythm;
  const apiMeta = value.apiMeta;
  if (
    !isRecord(outputLabels) ||
    !isRecord(commentGuidance) ||
    !Array.isArray(commentGuidance.keywordReplies) ||
    !isRecord(editingRhythm) ||
    !isRecord(apiMeta)
  ) {
    return false;
  }
  const rhythmFields = [
    editingRhythm.subtitleHighlights,
    editingRhythm.soundEffects,
    editingRhythm.screenRecordingCuts,
    editingRhythm.caseInserts,
    editingRhythm.pauses,
  ];
  return (
    typeof value.ipId === "string" &&
    typeof value.ipName === "string" &&
    typeof value.topic === "string" &&
    typeof value.platform === "string" &&
    typeof value.formatCategory === "string" &&
    typeof value.formatLabel === "string" &&
    typeof value.durationSeconds === "number" &&
    typeof value.durationLabel === "string" &&
    typeof value.goal === "string" &&
    typeof value.videoType === "string" &&
    Array.isArray(value.titles) &&
    Array.isArray(value.coverCopy) &&
    Array.isArray(value.outline) &&
    value.outline.every(section =>
      isRecord(section) &&
      (section.subPoints === undefined || Array.isArray(section.subPoints))
    ) &&
    Array.isArray(value.storyboard) &&
    Array.isArray(value.shootingSuggestions) &&
    Array.isArray(value.shotPrompts) &&
    rhythmFields.every(Array.isArray)
  );
}

function isStoredScriptResult(value: unknown): value is ScriptResult {
  if (!isRecord(value) || value.generationStatus !== "partial") return false;
  const partialFailure = value.partialFailure;
  return (
    isRecord(partialFailure) &&
    (partialFailure.stage === "storyboard" || partialFailure.stage === "execution") &&
    typeof partialFailure.errorCode === "string" &&
    typeof partialFailure.message === "string" &&
    hasStoredScriptResultShape(value)
  );
}

function normalizeStoredCompleteScriptResult(value: unknown): ScriptResult | null {
  if (!isRecord(value) || !hasStoredScriptResultShape(value)) return null;
  const isCurrentComplete = value.generationStatus === "complete" && value.partialFailure === null;
  const isLegacyComplete = value.generationStatus === undefined && value.partialFailure === undefined;
  if (!isCurrentComplete && !isLegacyComplete) return null;
  return {
    ...(value as unknown as Omit<ScriptResult, "generationStatus" | "partialFailure">),
    generationStatus: "complete",
    partialFailure: null,
  };
}

function normalizeRestoredAuditState(result: ScriptResult): ScriptResult {
  const requiresV13Audit = result.generationMode === "ip"
    || result.outputMode === "shuimuran-confirmed"
    || result.postGenerationAuditStatus !== undefined
    || result.attributionAudit !== undefined;
  const restoredAudit = result.postGenerationAuditStatus === "completed"
    ? parseScriptPostGenerationAudit({
        status: result.postGenerationAuditStatus,
        auditSessionId: result.auditSessionId,
        auditVersion: result.auditVersion,
        coverageAssessment: result.coverageAssessment,
        attributionAudit: result.attributionAudit,
        sourceIntegrityAudit: result.sourceIntegrityAudit,
        factAudit: result.factAudit,
        deliveryGate: result.deliveryGate,
      })
    : null;
  const hasV13Audit = restoredAudit?.status === "completed";
  if (!requiresV13Audit || hasV13Audit) return result;
  return {
    ...result,
    postGenerationAuditStatus: "unavailable",
    postGenerationAuditMessage: "本次归属分析暂未完成。正文可查看，但不得视为审计通过或正式交付",
    auditSessionId: undefined,
    auditVersion: undefined,
    coverageAssessment: undefined,
    attributionAudit: undefined,
    sourceIntegrityAudit: undefined,
    factAudit: undefined,
    deliveryGate: undefined,
  };
}

// ── 内容形式 → 时长选项（架构在后端按formatCategory切换，这里只管UI选项） ──
const FORMAT_CATEGORIES = [
  { id: "short", label: "短视频", durations: [{ label: "30秒", value: 30 }, { label: "60秒", value: 60 }, { label: "90秒", value: 90 }, { label: "3分钟", value: 180 }] },
  { id: "medium", label: "中视频", durations: [{ label: "3分钟", value: 180 }, { label: "5分钟", value: 300 }, { label: "8分钟", value: 480 }, { label: "10分钟", value: 600 }] },
  { id: "long", label: "长视频", durations: [{ label: "15分钟", value: 900 }, { label: "20分钟", value: 1200 }, { label: "30分钟", value: 1800 }, { label: "45分钟", value: 2700 }, { label: "60分钟", value: 3600 }] },
  { id: "course", label: "课程", durations: [{ label: "10分钟", value: 600 }, { label: "20分钟", value: 1200 }, { label: "30分钟", value: 1800 }, { label: "45分钟", value: 2700 }, { label: "60分钟", value: 3600 }, { label: "90分钟", value: 5400 }, { label: "120分钟", value: 7200 }] },
  { id: "live", label: "直播", durations: [{ label: "30分钟", value: 1800 }, { label: "60分钟", value: 3600 }, { label: "90分钟", value: 5400 }, { label: "120分钟", value: 7200 }, { label: "180分钟", value: 10800 }] },
  { id: "talk", label: "分享会", durations: [{ label: "30分钟", value: 1800 }, { label: "45分钟", value: 2700 }, { label: "60分钟", value: 3600 }, { label: "90分钟", value: 5400 }, { label: "120分钟", value: 7200 }] },
];

const PLATFORM_OPTIONS = ["抖音", "小红书", "B站", "视频号"];
const GOAL_OPTIONS = ["涨粉", "引流", "转化", "建立信任", "教学"];
const VIDEO_TYPE_OPTIONS = ["口播", "教程", "案例拆解", "观点输出", "工具演示", "剧情"];
const toSelectOptions = (items: string[]): SelectOption[] => items.map(item => ({ value: item, label: item }));

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

function ApiStatusPanel({ meta }: { meta: ApiMeta | null }) {
  if (!meta) return null;
  return (
    <div className="mb-6 rounded-[14px] border border-[#E5E4DE] bg-[#FAFAF8] p-4 font-mono text-[12px]">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#888]">API调用状态（调试）</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div><span className="text-[#999]">apiCalled: </span><span className={meta.apiCalled ? "font-bold text-[#3B6D11]" : "font-bold text-[#A32D2D]"}>{String(meta.apiCalled)}</span></div>
        <div><span className="text-[#999]">mockHit: </span><span className="font-bold text-[#3B6D11]">{String(meta.mockHit)}</span></div>
        <div><span className="text-[#999]">model: </span><span className="text-[#333]">{meta.model ?? "-"}</span></div>
        <div><span className="text-[#999]">ipUsed: </span><span className="text-[#333]">{meta.ipUsed ?? "-"}</span></div>
        <div className="col-span-2 sm:col-span-1"><span className="text-[#999]">calledAt: </span><span className="text-[#333]">{meta.calledAt}</span></div>
      </div>
      {meta.error && <div className="mt-2 rounded-[8px] bg-[#FCEBEB] px-2.5 py-1.5 text-[#A32D2D]">error: {meta.error}</div>}
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
          下面这段文字会被原样拼接进发给DeepSeek的每一次调用里，和「IP身份中心」测试按钮里看到的完全一致。
        </p>
        <pre className="whitespace-pre-wrap rounded-[12px] bg-[#F7F6F2] p-4 text-[12px] leading-6 text-[#333]">{block}</pre>
        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[13px] font-semibold text-white">关闭</button>
        </div>
      </div>
    </div>
  );
}

const ATTRIBUTION_LABELS = {
  teacher_explicit: "老师明确表达",
  faithful_rewrite: "基于原意重组",
  ai_reasoning: "AI推理补充",
  case_fact: "案例事实补充",
} as const;

const SOURCE_INTEGRITY_LABELS = {
  responsibility_subject_distortion: "责任主体失真",
  unsupported_arbitration: "仲裁结论无出处",
  certainty_shift: "素材确定度被改变",
} as const;

const OUTPUT_STATUS_LABELS: Record<ScriptOutputStatus, string> = {
  formal: "正式稿",
  review: "待审核稿",
  exploratory: "探索稿",
};

const CONFIDENCE_LABELS = { high: "高", medium: "中", low: "低" } as const;

function CompressionReviewInfo({ audit }: { audit?: ScriptCompressionAudit }) {
  if (!audit) return null;
  const selectedLabel = audit.selectedAttempt === 0
    ? "保留完整初稿"
    : `采用第${audit.selectedAttempt}次压缩结果`;
  return (
    <div className="mt-3 rounded-[10px] bg-white p-3">
      <div className="text-[11px] font-bold text-[#888]">压缩状态</div>
      <p className="mt-1 text-[12px] font-semibold text-[#1C1C1B]">{audit.message}</p>
      <p className="mt-1 text-[11.5px] leading-5 text-[#777]">
        初稿{audit.initialChars}字，理想目标{audit.idealMinimumChars}—{audit.idealMaximumChars}字，
        可接受区间{audit.acceptableMinimumChars}—{audit.acceptableMaximumChars}字，
        最终{audit.actualChars}字（{(audit.actualRatio * 100).toFixed(1)}%），{selectedLabel}。
      </p>
    </div>
  );
}

function TeamReviewPanel({
  data,
  onManualRewrite,
  onConfirmPendingItem,
}: {
  data: ScriptResult;
  onManualRewrite?: (
    issue: SourceIntegrityIssue,
    action: ScriptManualRewriteAction,
    replacement: string,
    deleteConfirmed: boolean,
  ) => void;
  onConfirmPendingItem?: (pendingItemId: string) => Promise<void>;
}) {
  const attribution = data.attributionAudit;
  const fact = data.factAudit;
  const integrity = data.sourceIntegrityAudit;
  const displayedOutputStatus = integrity?.deliveryBlocked ? "review" : attribution?.outputStatus;
  const [editingIssueIndex, setEditingIssueIndex] = useState<number | null>(null);
  const [deletingIssueIndex, setDeletingIssueIndex] = useState<number | null>(null);
  const [replacement, setReplacement] = useState("");
  const [resolvingPendingItemId, setResolvingPendingItemId] = useState<string | null>(null);
  if (data.postGenerationAuditStatus === "pending") {
    return (
      <section aria-label="团队审核信息" className="rounded-[12px] border border-[#E5E4DE] bg-[#FAFAF8] p-4">
        <div className="text-[13px] font-bold text-[#1C1C1B]">团队审核信息</div>
        <p className="mt-2 text-[12.5px] text-[#666]">观点归属分析中。正文可查看，审计完成前不得视为正式交付</p>
        <CompressionReviewInfo audit={data.compressionAudit} />
      </section>
    );
  }
  if (data.postGenerationAuditStatus === "unavailable") {
    return (
      <section aria-label="团队审核信息" className="rounded-[12px] border border-[#E8C96A] bg-[#FFF8DC] p-4">
        <div className="text-[13px] font-bold text-[#1C1C1B]">团队审核信息</div>
        <p className="mt-2 text-[12.5px] text-[#755700]">{data.postGenerationAuditMessage ?? "本次归属分析暂未完成。正文可查看，但不得视为审计通过或正式交付"}</p>
        <CompressionReviewInfo audit={data.compressionAudit} />
      </section>
    );
  }
  if (!attribution) {
    return (
      <div className="rounded-[12px] border border-[#E5E4DE] bg-[#FAFAF8] p-4">
        <div className="text-[13px] font-bold text-[#1C1C1B]">团队审核信息</div>
        <p className="mt-2 text-[12.5px] text-[#8A6515]">历史稿未记录观点归属信息</p>
        <p className="mt-1 text-[11.5px] leading-5 text-[#777]">这不代表高置信度，正式发布前请人工核对观点来源和事实。</p>
        <CompressionReviewInfo audit={data.compressionAudit} />
      </div>
    );
  }
  return (
    <section aria-label="团队审核信息" className="rounded-[12px] border border-[#D9E8C7] bg-[#FBFEF7] p-4">
      <div className="text-[13px] font-bold text-[#1C1C1B]">团队审核信息</div>
      {data.postGenerationAuditMessage && (
        <div className="mt-3 rounded-[10px] border border-[#D98C8C] bg-[#FFF1F1] p-3 text-[#7A2525]" role="alert">
          <div className="text-[12.5px] font-bold">门禁响应矛盾</div>
          <p className="mt-1 text-[11.5px] leading-5">{data.postGenerationAuditMessage}</p>
        </div>
      )}
      {integrity?.deliveryBlocked && (
        <div className="mt-3 rounded-[10px] border border-[#D98C8C] bg-[#FFF1F1] p-3 text-[#7A2525]" role="alert">
          <div className="text-[12.5px] font-bold">出处审计未通过，当前稿件暂停交付</div>
          <p className="mt-1 text-[11.5px] leading-5">系统没有自动改稿。你可以对其中一处执行一次人工替换或删除，完成后系统只重新审计，不会继续循环改写。</p>
          <div className="mt-3 flex flex-col gap-3">
            {integrity.issues.map((issue, index) => (
              <div key={`${issue.code}-${issue.sectionIndex}-${issue.paragraphIndex}-${index}`} className="rounded-[9px] bg-white p-3">
                <div className="text-[12px] font-bold">{SOURCE_INTEGRITY_LABELS[issue.code]}</div>
                <p className="mt-1 text-[11.5px] leading-5">原文：{issue.excerpt}</p>
                <p className="mt-1 text-[11.5px] leading-5 text-[#8A4545]">{issue.reason}</p>
                {data.manualRewrite ? (
                  <p className="mt-2 text-[11.5px] font-semibold">这份脚本已经使用过一次人工处理机会；如果复审仍未通过，请在系统外人工编辑。</p>
                ) : onManualRewrite ? (
                  <div className="mt-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingIssueIndex(index);
                          setDeletingIssueIndex(null);
                          setReplacement(issue.excerpt);
                        }}
                        className="rounded-[8px] bg-[#1C1C1B] px-3 py-1.5 text-[11.5px] font-semibold text-white"
                      >
                        人工替换
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeletingIssueIndex(index);
                          setEditingIssueIndex(null);
                        }}
                        className="rounded-[8px] border border-[#C87D7D] bg-white px-3 py-1.5 text-[11.5px] font-semibold text-[#7A2525]"
                      >
                        删除这段
                      </button>
                    </div>
                    {editingIssueIndex === index && (
                      <div className="mt-3">
                        <textarea
                          aria-label="替换后的正文"
                          value={replacement}
                          onChange={event => setReplacement(event.target.value)}
                          className="min-h-[100px] w-full rounded-[8px] border border-[#D8B2B2] p-2.5 text-[12px] leading-5 text-[#333]"
                        />
                        <div className="mt-2 flex gap-2">
                          <button type="button" onClick={() => {
                            onManualRewrite(issue, "replace", replacement, false);
                            setEditingIssueIndex(null);
                          }} className="rounded-[8px] bg-[#1C1C1B] px-3 py-1.5 text-[11.5px] font-semibold text-white">确认替换</button>
                          <button type="button" onClick={() => setEditingIssueIndex(null)} className="rounded-[8px] bg-[#F2F1ED] px-3 py-1.5 text-[11.5px] font-semibold text-[#555]">取消</button>
                        </div>
                      </div>
                    )}
                    {deletingIssueIndex === index && (
                      <div className="mt-3 rounded-[8px] border border-[#C87D7D] bg-[#FFF7F7] p-3">
                        <div className="text-[11.5px] font-bold">请确认：将删除以下原文，删除后无法在本页面撤销。</div>
                        <p className="mt-1 text-[11.5px] leading-5">{issue.excerpt}</p>
                        <div className="mt-2 flex gap-2">
                          <button type="button" onClick={() => {
                            onManualRewrite(issue, "delete", "", true);
                            setDeletingIssueIndex(null);
                          }} className="rounded-[8px] bg-[#8A2F2F] px-3 py-1.5 text-[11.5px] font-semibold text-white">确认删除这段原文</button>
                          <button type="button" onClick={() => setDeletingIssueIndex(null)} className="rounded-[8px] bg-white px-3 py-1.5 text-[11.5px] font-semibold text-[#555]">取消</button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
      {data.manualRewrite && !integrity?.deliveryBlocked && (
        <div className="mt-3 rounded-[9px] bg-[#EEF6E7] p-3 text-[11.5px] font-semibold text-[#3B6D11]">
          这份脚本已经使用过一次人工处理机会，复审已通过。
        </div>
      )}
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="rounded-[10px] bg-white p-3">
          <div className="text-[11px] font-bold text-[#888]">整篇观点归属</div>
          <div className="mt-1 text-[13px] font-semibold text-[#1C1C1B]">
            {displayedOutputStatus ? OUTPUT_STATUS_LABELS[displayedOutputStatus] : "待审核稿"} · 置信度{CONFIDENCE_LABELS[attribution.confidenceLevel]}
          </div>
          {attribution.missingDimensions.length > 0 && <p className="mt-2 text-[11.5px] leading-5 text-[#8A6515]">具体缺口：{attribution.missingDimensions.join("、")}</p>}
          <p className="mt-2 text-[11.5px] leading-5 text-[#666]">{attribution.recommendation}</p>
        </div>
        <div className="rounded-[10px] bg-white p-3 md:col-span-2">
          <div className="text-[11px] font-bold text-[#888]">段落来源</div>
          <div className="mt-2 flex flex-col gap-2">
            {attribution.paragraphAttributions.length > 0 ? attribution.paragraphAttributions.map((paragraph, index) => (
              <div key={`${paragraph.sectionIndex}-${paragraph.paragraphIndex}-${index}`} className="rounded-[8px] bg-[#F7F6F2] px-3 py-2">
                <div className="text-[11.5px] font-bold text-[#3B6D11]">{ATTRIBUTION_LABELS[paragraph.attributionType]}</div>
                <p className="mt-1 text-[11.5px] leading-5 text-[#444]">{paragraph.excerpt}</p>
                <p className="mt-1 text-[11px] leading-5 text-[#777]">{paragraph.reason}</p>
              </div>
            )) : <p className="text-[11.5px] text-[#777]">段落归属审计未完成，请人工逐段核对。</p>}
          </div>
        </div>
      </div>
      <div className="mt-3 rounded-[10px] bg-white p-3">
        <div className="text-[11px] font-bold text-[#888]">事实核验状态</div>
        {fact ? (
          <>
            <p className="mt-1 text-[12px] font-semibold text-[#1C1C1B]">
              {fact.overallStatus === "user_confirmed" ? "用户已确认" : fact.overallStatus === "pending" ? "存在待核验内容" : "系统未核验"}
            </p>
            <p className="mt-1 text-[11px] text-[#777]">系统联网核验：未执行</p>
            {fact.pendingItems.length > 0 && (
              <div className="mt-2 flex flex-col gap-2">
                {fact.pendingItems.map((item, index) => {
                  if (typeof item === "string") {
                    return <div key={index} className="rounded-[8px] bg-[#FFF8DC] px-3 py-2 text-[11.5px] leading-5 text-[#8A6515]">{item}</div>;
                  }
                  const isPendingSpecificClaim = item.subtype === "unsupported_specific_claim"
                    && item.resolutionStatus === "PENDING";
                  return (
                    <div key={item.id} className="rounded-[8px] border border-[#E8C96A] bg-[#FFF8DC] px-3 py-2 text-[11.5px] leading-5 text-[#755700]">
                      <p>{item.excerpt}</p>
                      <p className="mt-1 text-[#8A6515]">{item.reason}</p>
                      {item.resolutionStatus === "CONFIRMED_ALLOWED" && (
                        <p className="mt-2 font-semibold text-[#3B6D11]">人工确认允许使用（仍无出处）</p>
                      )}
                      {isPendingSpecificClaim && onConfirmPendingItem && (
                        <button
                          type="button"
                          disabled={resolvingPendingItemId !== null}
                          onClick={() => {
                            setResolvingPendingItemId(item.id);
                            void onConfirmPendingItem(item.id).finally(() => setResolvingPendingItemId(null));
                          }}
                          className="mt-2 rounded-[8px] bg-[#1C1C1B] px-3 py-1.5 text-[11.5px] font-semibold text-white disabled:opacity-50"
                        >
                          {resolvingPendingItemId === item.id ? "正在登记人工决定…" : "人工确认允许使用"}
                        </button>
                      )}
                    </div>
                  );
                })}
                {fact.pendingItems.some(item => typeof item !== "string" && item.resolutionStatus === "PENDING") && (
                  <p className="text-[11px] leading-5 text-[#777]">补充出处和删除正文尚需后续安全流程，本页不会直接把它们标记为已处理。</p>
                )}
              </div>
            )}
          </>
        ) : <p className="mt-1 text-[11.5px] text-[#777]">历史稿未记录事实核验状态。</p>}
      </div>
      <CompressionReviewInfo audit={data.compressionAudit} />
    </section>
  );
}

// ── 结果展示：outline按通用结构渲染，标签随内容形式动态变化 ──
function ResultView({
  data,
  compact = false,
  draftSavedAt = null,
  onClearDraft,
  onManualRewrite,
  onConfirmPendingItem,
}: {
  data: ScriptResult;
  compact?: boolean;
  draftSavedAt?: string | null;
  onClearDraft?: () => void;
  onManualRewrite?: (
    issue: SourceIntegrityIssue,
    action: ScriptManualRewriteAction,
    replacement: string,
    deleteConfirmed: boolean,
  ) => void;
  onConfirmPendingItem?: (pendingItemId: string) => Promise<void>;
}) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const deliveryBlockReason = getScriptDeliveryBlockReason(data);
  const copyBlocked = deliveryBlockReason !== null;
  const copySpokenScript = async () => {
    if (copyBlocked) {
      setCopyStatus(`${deliveryBlockReason}，不能复制交付正文`);
      return;
    }
    const title = data.titles[0]?.title?.trim();
    const script = data.outline.map(section => section.content).join("\n\n");
    const text = [title ? `标题：${title}` : "", script].filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("正文已复制");
    } catch {
      setCopyStatus("复制失败，请手动选择正文");
    }
  };
  const reviewPanel = data.attributionAudit || data.factAudit || data.generationMode === "ip" || data.generationMode === undefined
    ? <TeamReviewPanel data={data} onManualRewrite={onManualRewrite} onConfirmPendingItem={onConfirmPendingItem} />
    : null;

  if (data.outputMode === "shuimuran-confirmed") {
    const fullScript = data.outline.map(section => section.content).join("\n\n");
    const pendingVerification = data.pendingVerification ?? [];
    return (
      <div className="flex flex-col gap-5">
        {reviewPanel}
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">标题：</div>
          <div className="rounded-[10px] bg-[#F7F6F2] p-3 text-[13.5px] font-semibold text-[#1C1C1B]">
            {data.titles[0]?.title ?? ""}
          </div>
        </div>
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] font-bold text-[#888]">完整口播文案：</div>
            <button type="button" disabled={copyBlocked} onClick={() => void copySpokenScript()} className="rounded-[8px] bg-[#F2F1ED] px-3 py-1.5 text-[11.5px] font-semibold text-[#555] disabled:cursor-not-allowed disabled:opacity-50">{copyBlocked ? "审核通过后可复制" : "复制正文"}</button>
          </div>
          <div className="whitespace-pre-wrap rounded-[10px] border border-[#F0EFE9] p-4 text-[13px] leading-7 text-[#333]">
            {fullScript}
          </div>
          {copyStatus && <div className="mt-2 text-[11.5px] text-[#666]">{copyStatus}</div>}
        </div>
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">待核验内容：</div>
          {pendingVerification.length > 0 ? (
            <ul className="list-disc rounded-[10px] bg-[#FFF8DC] px-8 py-3 text-[12.5px] leading-6 text-[#755700]">
              {pendingVerification.map((item, index) => <li key={index}>{item}</li>)}
            </ul>
          ) : (
            <div className="rounded-[10px] bg-[#F7F6F2] p-3 text-[12.5px] text-[#666]">无</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {reviewPanel}
      {data.evidenceAudit && (
        <div className="rounded-[12px] border border-[#C8F04A] bg-[#FBFEF2] p-4">
          <div className="text-[12.5px] font-bold text-[#3B6D11]">本次脚本观点来源</div>
          <p className="mt-1 text-[12px] leading-5 text-[#555]">{data.evidenceAudit.reason}</p>
          <div className="mt-2 flex flex-col gap-2">
            {data.evidenceAudit.sourceReferences.map(reference => (
              <div key={`${reference.sourceId}-${reference.itemId}`} className="rounded-[9px] bg-white px-3 py-2 text-[12px] leading-5 text-[#444]">
                <span className="font-semibold">【老师明确表达】《{reference.sourceTitle}》：</span>{reference.originalExcerpt}
              </div>
            ))}
            {data.evidenceAudit.caseEvidence && (
              <div className="rounded-[9px] bg-white px-3 py-2 text-[12px] leading-5 text-[#444]">
                <span className="font-semibold">【案例／事实补充】{data.evidenceAudit.caseEvidence.title}</span>
                <span className="ml-2 text-[#A36C16]">{data.evidenceAudit.caseEvidence.sourceType}·{data.evidenceAudit.caseEvidence.verificationStatus}</span>
              </div>
            )}
          </div>
        </div>
      )}
      {data.generationStatus === "partial" && data.partialFailure && (
        <div className="rounded-[12px] border border-[#E8C96A] bg-[#FFF8DC] p-4 text-[#755700]">
          <div className="text-[13px] font-bold">核心脚本已保留，补充内容未完成</div>
          <p className="mt-1 text-[12.5px] leading-5">{data.partialFailure.message}</p>
          {draftSavedAt && (
            <p className="mt-1 text-[11.5px] text-[#8A6B13]">
              已自动保存为本地临时草稿，刷新或离开后仍可恢复。
            </p>
          )}
          {onClearDraft && (
            <button
              type="button"
              onClick={onClearDraft}
              className="mt-2 rounded-[8px] border border-[#D8B94F] bg-white px-3 py-1.5 text-[11.5px] font-semibold text-[#755700]"
            >
              清除临时草稿
            </button>
          )}
        </div>
      )}

      {data.qualityCheck && data.qualityCheck.status !== "passed" && (
        <div className="rounded-[12px] border border-[#E8C96A] bg-[#FFF8DC] p-4 text-[#755700]">
          <div className="text-[13px] font-bold">
            {data.qualityCheck.status === "unavailable" ? "自动论证复核未完成" : "脚本质量提示"}
          </div>
          {data.qualityCheck.message && (
            <p className="mt-1 text-[12.5px] leading-5">{data.qualityCheck.message}</p>
          )}
          {data.qualityCheck.warnings.map((warning, index) => (
            <div key={`${warning.code}-${warning.sectionLabel}-${index}`} className="mt-2 rounded-[9px] bg-white/70 p-3">
              <div className="text-[12.5px] font-bold">{warning.title} · {warning.sectionLabel}</div>
              <p className="mt-1 text-[12px] leading-5 text-[#6B5512]">原文：{warning.excerpt}</p>
              <p className="mt-1 text-[12px] leading-5 text-[#6B5512]">{warning.message}</p>
            </div>
          ))}
          <p className="mt-2 text-[11.5px] text-[#8A6B13]">
            {data.qualityCheck.warnings.some(warning => warning.code === "shuimuran_review_failed" || warning.code === "shuimuran_review_unavailable")
              ? "脚本未通过现有终审，系统没有自动改稿；人工处理并重新生成前不得正式交付。"
              : "脚本仍可继续查看和使用，建议正式发布前完成核对。"}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#999]">
        <span className="rounded-full bg-[#F2F1ED] px-2 py-1 font-semibold text-[#555]">{data.formatLabel}</span>
        <span className="rounded-full bg-[#F2F1ED] px-2 py-1">{data.durationLabel}</span>
        <span className="rounded-full bg-[#F2F1ED] px-2 py-1">{data.platform}</span>
      </div>

      {data.ipStyleExplanation && (
        <div className="rounded-[10px] border border-[#C8F04A] bg-[#FBFEF2] p-3">
          <div className="mb-1 text-[11px] font-bold text-[#639922]">这次生成如何体现「{data.ipName}」的特征</div>
          <p className="text-[12.5px] leading-5 text-[#444]">{data.ipStyleExplanation}</p>
        </div>
      )}

      <div>
        <div className="mb-2 text-[12px] font-bold text-[#888]">视频标题（{data.titles.length}个）</div>
        <div className="flex flex-col gap-2">
          {data.titles.slice(0, compact ? 3 : undefined).map((t, i) => (
            <div key={i} className="rounded-[10px] bg-[#F7F6F2] p-3">
              <div className="flex flex-wrap items-center gap-2">
                {t.role && <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${t.recommended ? "bg-[#1C1C1B] text-white" : "bg-white text-[#777]"}`}>{t.role}{t.recommended ? "·推荐" : ""}</span>}
                <div className="text-[13.5px] font-semibold text-[#1C1C1B]">{t.title}</div>
              </div>
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
          <div className="mb-2 text-[12px] font-bold text-[#888]">{data.outputLabels.cover}</div>
          <div className="flex flex-wrap gap-2">
            {data.coverCopy.map((c, i) => <span key={i} className="rounded-[10px] bg-[#FBF3D6] px-3 py-2 text-[13px] font-semibold text-[#7A5C00]">{c}</span>)}
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[12px] font-bold text-[#888]">{data.outputLabels.outline}（{data.outline.length}个阶段）</div>
          {!compact && <button type="button" disabled={copyBlocked} onClick={() => void copySpokenScript()} className="rounded-[8px] bg-[#F2F1ED] px-3 py-1.5 text-[11.5px] font-semibold text-[#555] disabled:cursor-not-allowed disabled:opacity-50">{copyBlocked ? "审核通过后可复制" : "复制正文"}</button>}
        </div>
        <div className="flex flex-col gap-2">
          {(compact ? data.outline.slice(0, 3) : data.outline).map((seg, i) => (
            <div key={i} className="rounded-[10px] border border-[#F0EFE9] p-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[11px] font-bold text-[#639922]">{seg.label}</span>
                <span className="text-[10.5px] text-[#AAA]">{seg.timeRange}</span>
              </div>
              <p className="text-[13px] leading-6 text-[#333]">{seg.content}</p>
              {!compact && seg.subPoints && seg.subPoints.length > 0 && (
                <ul className="mt-2 list-disc pl-4 text-[12px] leading-5 text-[#666]">
                  {seg.subPoints.map((sp, j) => <li key={j}>{sp}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
        {copyStatus && <div className="mt-2 text-[11.5px] text-[#666]">{copyStatus}</div>}
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

      {data.shootingSuggestions.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] font-bold text-[#888]">{data.outputLabels.shooting}</div>
          <ul className="list-disc pl-5 text-[13px] leading-6 text-[#444]">
            {(compact ? data.shootingSuggestions.slice(0, 3) : data.shootingSuggestions).map((s, i) => <li key={i}>{s}</li>)}
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
        <div className="mb-2 text-[12px] font-bold text-[#888]">{data.outputLabels.comment}</div>
        <div className="flex flex-col gap-2 text-[13px] leading-6 text-[#444]">
          <div><span className="font-semibold text-[#1C1C1B]">互动引导：</span>{data.commentGuidance.interactionPrompt}</div>
          {!compact && data.commentGuidance.keywordReplies.map((kr, i) => (
            <div key={i}><span className="font-semibold text-[#1C1C1B]">「{kr.keyword}」→</span>{kr.reply}</div>
          ))}
          {!compact && <div><span className="font-semibold text-[#1C1C1B]">私信引导：</span>{data.commentGuidance.dmGuidance}</div>}
          <div><span className="font-semibold text-[#1C1C1B]">下一步引导：</span>{data.commentGuidance.materialPackGuidance}</div>
        </div>
      </div>
    </div>
  );
}

// ── 参考知识面板：topic停止变化后自动检索知识库 ──
interface KnowledgeRef { id: string; reason: string; relevanceTier: string; relevanceReason: string; entry: KnowledgeEntry }
const REL_COLOR: Record<string, { bg: string; text: string }> = {
  "高度相关": { bg: "#EAF3DE", text: "#3B6D11" }, "中度相关": { bg: "#FBF3D6", text: "#7A5C00" }, "低度相关": { bg: "#F2F1ED", text: "#888" },
};
function KnowledgePanel({ loading, refs, searched }: { loading: boolean; refs: KnowledgeRef[]; searched: boolean }) {
  if (!loading && !searched) return null;
  return (
    <div className="mb-6 rounded-[16px] border border-[#E5E4DE] bg-white p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-[13px] font-bold text-[#1C1C1B]">【参考知识】</span>
        <span className="text-[11px] text-[#999]">系统自动检索知识库，定性相关度档位，不编造精确相似度数字</span>
      </div>
      {loading && <div className="text-[12.5px] text-[#888]">检索中…</div>}
      {!loading && refs.length === 0 && <div className="text-[12.5px] text-[#999]">知识库里没有找到强相关的参考，将仅依靠模型自身判断。</div>}
      {!loading && refs.length > 0 && (
        <div className="flex flex-col gap-2">
          {refs.map(r => (
            <div key={r.id} className="rounded-[10px] bg-[#F7F6F2] p-2.5">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-[12px] font-semibold text-[#1C1C1B]">[{r.entry.category}] {r.entry.title}</span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: (REL_COLOR[r.relevanceTier] ?? REL_COLOR["低度相关"]).bg, color: (REL_COLOR[r.relevanceTier] ?? REL_COLOR["低度相关"]).text }}>{r.relevanceTier}</span>
              </div>
              <p className="text-[11.5px] leading-5 text-[#555]">引用原因：{r.reason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function useCognitionData() {
  const [readVersion, setReadVersion] = useState(0);
  try {
    return {
      entries: getKnowledgeEntries(),
      error: null as string | null,
      readVersion,
      retry: () => setReadVersion(version => version + 1),
    };
  } catch {
    return {
      entries: [] as KnowledgeEntry[],
      error: "部分认知数据损坏，请尝试重新解析相关资料",
      readVersion,
      retry: () => setReadVersion(version => version + 1),
    };
  }
}

export default function ScriptFactoryPage() {
  const { activeIP, loading: ipLoading } = useIP();
  const cognitionData = useCognitionData();
  const [generationMode, setGenerationMode] = useState<GenerationMode>("standard");
  const [topic, setTopic] = useState("");
  const [angle, setAngle] = useState("");
  const [caseDecision, setCaseDecision] = useState<CaseDecision | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [manualCaseTitle, setManualCaseTitle] = useState("");
  const [manualCaseContent, setManualCaseContent] = useState("");
  const [manualCaseSource, setManualCaseSource] = useState("");
  const [manualCaseVerified, setManualCaseVerified] = useState(false);
  const [knowledgeRefs, setKnowledgeRefs] = useState<KnowledgeRef[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeSearched, setKnowledgeSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationSequenceRef = useRef(0);
  const topicContentRef = useRef(topic);
  topicContentRef.current = topic;
  const boundaryRequestSeqRef = useRef(0);
  const activeIPIdRef = useRef<string | null>(activeIP?.id ?? null);
  activeIPIdRef.current = activeIP?.id ?? null;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (topic.trim().length < 5) { setKnowledgeSearched(false); setKnowledgeRefs([]); return; }
    debounceRef.current = setTimeout(() => { searchKnowledge(topic); }, 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, activeIP?.id]);

  async function searchKnowledge(query: string) {
    const allEntries = cognitionData.entries.filter(e => {
      if (e.ipId && e.ipId !== activeIP?.id) return false;
      const category = getNormalizedCategory(e);
      // 原始内容通过专属上下文进入生成和生成后审计，不能混入通用方法检索。
      if (category === "IP原始内容") return false;
      return isGlobalMethodCategory(category) || isIPKnowledgeCategory(category);
    });
    if (allEntries.length === 0) { setKnowledgeSearched(true); setKnowledgeRefs([]); return; }
    setKnowledgeLoading(true); setKnowledgeSearched(true);
    try {
      const res = await apiFetch("/api/knowledge-search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          entries: allEntries.map(e => ({
            id: e.id,
            category: getNormalizedCategory(e),
            normalizedCategory: getNormalizedCategory(e),
            title: e.title,
            tags: e.tags,
            keywords: e.keywords,
            rawContent: e.rawContent,
            summary: e.note,
            referenceReason: e.sourceTierReason,
            metadata: { contentDirection: e.contentDirection, sourcePlatform: e.sourcePlatform },
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setKnowledgeRefs([]); return; }
      const entryMap = new Map(allEntries.map(e => [e.id, e]));
      const refs: KnowledgeRef[] = (data.results ?? [])
        .map((r: { id: string; reason: string; relevanceTier: string; relevanceReason: string }) => { const entry = entryMap.get(r.id); return entry ? { ...r, entry } : null; })
        .filter((r: KnowledgeRef | null): r is KnowledgeRef => r !== null);
      setKnowledgeRefs(refs);
    } catch { setKnowledgeRefs([]); } finally { setKnowledgeLoading(false); }
  }
  const [platform, setPlatform] = useState("抖音");
  const [formatCategory, setFormatCategory] = useState("short");
  const [duration, setDuration] = useState(60);
  const [goal, setGoal] = useState("建立信任");
  const [videoType, setVideoType] = useState("口播");
  const [needsStoryboard, setNeedsStoryboard] = useState(true);
  const [needsShootingTips, setNeedsShootingTips] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [showKnowledgeDrawer, setShowKnowledgeDrawer] = useState(false);
  const [apiMeta, setApiMeta] = useState<ApiMeta | null>(null);
  const [partialDraftSavedAt, setPartialDraftSavedAt] = useState<string | null>(null);
  const [draftStorageError, setDraftStorageError] = useState<string | null>(null);
  const [linkedTopic, setLinkedTopic] = useState<TopicAsset | null>(null);
  const [activeDirectorRule, setActiveDirectorRule] = useState<ScriptDirectorRule | null>(null);
  const [boundaryStatus, setBoundaryStatus] = useState<BoundaryAuditStatus>("idle");
  const [boundaryReport, setBoundaryReport] = useState<BoundaryReport | null>(null);
  const [boundaryEvidence, setBoundaryEvidence] = useState<BoundaryEvidenceNode[]>([]);
  const [boundaryMessage, setBoundaryMessage] = useState<string | null>(null);
  const [boundaryTopicId, setBoundaryTopicId] = useState<string | null>(null);
  const [auditedTopicContent, setAuditedTopicContent] = useState<string | null>(null);
  const [pendingBoundaryConfirmation, setPendingBoundaryConfirmation] = useState(false);
  const [pendingConstraintReview, setPendingConstraintReview] = useState<PendingConstraintReview | null>(null);
  const pendingConstraintReviewRef = useRef<PendingConstraintReview | null>(null);

  useEffect(() => {
    pendingConstraintReviewRef.current = pendingConstraintReview;
  }, [pendingConstraintReview]);

  const currentFormat = FORMAT_CATEGORIES.find(f => f.id === formatCategory) ?? FORMAT_CATEGORIES[0];
  const caseCandidates = cognitionData.entries.filter(entry => {
    if (entry.ipId && entry.ipId !== activeIP?.id) return false;
    const category = getNormalizedCategory(entry);
    return category === "爆款案例" || category === "选题案例" || category === "IP历史内容" || category === "IP高表现内容";
  });
  const selectedKnowledgeCase = caseCandidates.find(entry => entry.id === selectedCaseId) ?? null;
  const isDirectorRuleEnabled = generationMode === "ip" && activeDirectorRule !== null;
  const isConstraintFinalizing = pendingConstraintReview?.phase === "finalizing";
  const isLinkedTopicBoundaryAllowed = !linkedTopic
    || (!cognitionData.error
      && boundaryTopicId === linkedTopic.id
      && (boundaryStatus === "legacy"
        || (boundaryStatus === "ready"
          && boundaryReport !== null
          && auditedTopicContent === topic.trim()
          && decideBoundaryAction(boundaryReport) !== "intercept")));
  function switchGenerationMode(nextMode: GenerationMode) {
    if (isConstraintFinalizing) {
      setError("请先补全已保存脚本的知识使用记录，再切换生成模式。");
      return;
    }
    generationSequenceRef.current += 1;
    setGenerationMode(nextMode);
    setError(null);
    setResult(null);
    setApiMeta(null);
    setPartialDraftSavedAt(null);
    setPendingConstraintReview(null);
  }

  function getIPSourceContext(ipId: string) {
    return cognitionData.entries
      .filter(entry => getNormalizedCategory(entry) === "IP原始内容" && entry.ipId === ipId)
      .flatMap(entry => getLegacyIPSourceAnalysisItems(entry.sourceAnalysis).map(item => ({
        parserVersion: entry.sourceAnalysis?.parserVersion ?? 1,
        ...(entry.sourceAnalysis?.parserVersion === 2
          ? { finalProof: entry.sourceFinalProof ?? undefined }
          : { legacyProof: entry.sourceLegacyProof ?? undefined }),
        ipId,
        sourceId: entry.id,
        sourceTitle: entry.title,
        itemId: item.id,
        kind: item.kind,
        content: item.content,
        originalExcerpt: item.originalExcerpt,
        extractionStatus: item.extractionStatus,
      })));
  }

  async function runLinkedTopicBoundaryAudit(asset: TopicAsset, requestIP: IPProfile, topicContent = asset.title) {
    const requestSeq = boundaryRequestSeqRef.current + 1;
    boundaryRequestSeqRef.current = requestSeq;
    setBoundaryTopicId(asset.id);
    setBoundaryReport(null);
    setBoundaryEvidence([]);
    setBoundaryMessage(null);
    setAuditedTopicContent(null);
    setPendingBoundaryConfirmation(false);

    if (cognitionData.error) {
      setBoundaryStatus("unavailable");
      setBoundaryMessage("认知库读取失败，本次审计已停止，且未修改原数据。");
      return;
    }

    const sourceEntries = cognitionData.entries.filter(entry => getNormalizedCategory(entry) === "IP原始内容");
    const bundle = buildBoundarySourceBundle(sourceEntries, requestIP.id);
    const temporaryContext = typeof window === "undefined"
      ? null
      : readEphemeralCognitionContext(window.sessionStorage, requestIP.id, asset.id);
    if (bundle.sources.length === 0 && !temporaryContext) {
      if (bundle.unregisteredV1) {
        setBoundaryStatus("upgrade_required");
        setBoundaryMessage("当前IP的历史认知尚未完成合规登记，已停止脚本生成。");
      } else if (bundle.registeredV1) {
        setBoundaryStatus("legacy");
      } else {
        setBoundaryStatus("unavailable");
        setBoundaryMessage("当前IP还没有可用于边界审计的已确认V2认知。");
      }
      return;
    }

    setBoundaryStatus("checking");
    try {
      const response = await fetchBoundaryCheckWithTimeout({
        fetcher: apiFetch,
        url: "/api/ip-boundary/check",
        init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeIPId: requestIP.id,
          topicId: asset.id,
          topic: topicContent,
          sources: bundle.sources,
          temporaryContext,
          includeEvidence: true,
        }),
        },
      });
      const raw: unknown = await response.json();
      if (boundaryRequestSeqRef.current !== requestSeq || activeIPIdRef.current !== requestIP.id) return;
      if (!response.ok) throw new Error("认知边界审计失败，请返回选题董事会重试。");
      const allowedNodeIds = new Set([
        ...bundle.nodeIds,
        ...(temporaryContext?.analysis.nodes.map(node => node.id) ?? []),
      ]);
      const parsed = parseBoundaryCheckUIResponse(raw, allowedNodeIds);
      if (!parsed) throw new Error("认知边界审计返回的数据不完整，已停止脚本生成。");
      setBoundaryReport(parsed.report);
      setBoundaryEvidence(parsed.evidenceNodes);
      setAuditedTopicContent(topicContent.trim());
      setBoundaryStatus("ready");
    } catch (boundaryError) {
      if (boundaryRequestSeqRef.current !== requestSeq || activeIPIdRef.current !== requestIP.id) return;
      if (boundaryError instanceof BoundaryAuditTimeoutError) {
        setBoundaryStatus("timeout");
        setBoundaryMessage("本次审计超过15秒，脚本生成继续保持锁定。请重新审计。");
        return;
      }
      setBoundaryStatus("unavailable");
      setBoundaryMessage(boundaryError instanceof Error ? boundaryError.message : "认知边界审计失败，请返回选题董事会重试。");
    }
  }

  useEffect(() => {
    let cancelled = false;
    const loadRule = async () => {
      if (!activeIP) {
        setActiveDirectorRule(null);
        return;
      }
      setActiveDirectorRule(null);
      try {
        await ensureShuimuranDirectorRuleMigrated({
          ipId: activeIP.id,
          ipName: activeIP.name,
          legacyProfileId: activeIP.scriptDirectorProfileId,
        });
        const activeRule = getScriptDirectorRules(activeIP.id)
          .find(rule => rule.status === "active"
            && rule.testValidation
            && rule.testValidation.activationProof) ?? null;
        if (!cancelled) setActiveDirectorRule(activeRule);
      } catch {
        if (!cancelled) setActiveDirectorRule(null);
      }
    };
    void loadRule();
    return () => { cancelled = true; };
  }, [activeIP?.id, activeIP?.name, activeIP?.scriptDirectorProfileId]);

  useEffect(() => {
    setCaseDecision(null);
    setSelectedCaseId("");
    setManualCaseTitle("");
    setManualCaseContent("");
    setManualCaseSource("");
    setManualCaseVerified(false);
  }, [topic, angle, activeIP?.id, generationMode]);

  function handleFormatChange(id: string) {
    setFormatCategory(id);
    const fc = FORMAT_CATEGORIES.find(f => f.id === id);
    if (fc) setDuration(fc.durations[0].value);
  }

  useEffect(() => {
    if (activeIP && activeIP.platforms.length > 0 && !activeIP.platforms.includes(platform)) {
      setPlatform(activeIP.platforms[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIP?.id]);

  function restorePartialDraft(
    draft: PartialScriptDraft<ScriptResult>,
    expectedIPId: string,
  ): string | null {
    generationSequenceRef.current += 1;
    if (draft.ipId !== expectedIPId || draft.result.ipId !== expectedIPId) {
      return "本地临时草稿数据不完整，已停止自动恢复。";
    }
    const settings = draft.generationSettings;
    setGenerationMode(settings.generationMode ?? draft.result.generationMode ?? "standard");
    setTopic(draft.topic);
    setPlatform(settings.platform);
    setFormatCategory(settings.formatCategory);
    setDuration(settings.durationSeconds);
    setGoal(settings.goal);
    setVideoType(settings.videoType);
    setNeedsStoryboard(settings.needsStoryboard);
    setNeedsShootingTips(settings.needsShootingTips);
    setResult(normalizeRestoredAuditState(draft.result));
    setApiMeta(draft.result.apiMeta);
    setPartialDraftSavedAt(draft.savedAt);
    setLinkedTopic(null);
    if (draft.topicId) {
      try {
        setLinkedTopic(resolveTopicForScript(draft.topicId, draft.ipId));
      } catch {
        return "临时草稿已恢复，但原关联选题已失效，本次不会继续建立选题关联。";
      }
    }
    return null;
  }

  function restoreSavedScript(script: ScriptAsset, expectedIPId: string): string | null {
    generationSequenceRef.current += 1;
    if (script.ipId !== expectedIPId) {
      return "保存的脚本所属IP与当前操盘IP不一致，已停止恢复。";
    }
    const storedResult = normalizeStoredCompleteScriptResult(script.scriptResult);
    if (!storedResult) {
      return "保存的脚本数据不完整，无法恢复到脚本工厂。";
    }
    const savedResult = {
      ...normalizeRestoredAuditState(storedResult),
      scriptAssetId: script.id,
    };
    if (savedResult.ipId !== expectedIPId) {
      return "保存的脚本所属IP与当前操盘IP不一致，已停止恢复。";
    }
    setGenerationMode(savedResult.generationMode ?? "standard");
    setTopic(savedResult.topic || script.title);
    setPlatform(savedResult.platform);
    setFormatCategory(savedResult.formatCategory);
    setDuration(savedResult.durationSeconds);
    setGoal(savedResult.goal);
    setVideoType(savedResult.videoType);
    setNeedsStoryboard(savedResult.storyboard.length > 0);
    setNeedsShootingTips(savedResult.shootingSuggestions.length > 0 || savedResult.shotPrompts.length > 0);
    setResult(savedResult);
    setPendingConstraintReview(null);
    setApiMeta(savedResult.apiMeta);
    setPartialDraftSavedAt(null);
    setLinkedTopic(null);
    if (script.topicId) {
      try {
        setLinkedTopic(resolveTopicForScript(script.topicId, expectedIPId));
      } catch {
        // 已保存脚本仍可查看；原选题失效不应阻断脚本恢复。
      }
    }
    return null;
  }

  useEffect(() => {
    boundaryRequestSeqRef.current += 1;
    setBoundaryStatus("idle");
    setBoundaryReport(null);
    setBoundaryEvidence([]);
    setBoundaryMessage(null);
    setBoundaryTopicId(null);
    setAuditedTopicContent(null);
    setPendingBoundaryConfirmation(false);
    generationSequenceRef.current += 1;
    setLinkedTopic(null);
    setResult(null);
    if (pendingConstraintReviewRef.current?.phase !== "finalizing") {
      setPendingConstraintReview(null);
    }
    setApiMeta(null);
    setPartialDraftSavedAt(null);
    if (!activeIP) {
      return;
    }
    const auditDraft = typeof window !== "undefined"
      ? getPendingScriptAuditDraft<ScriptResult>(window.sessionStorage, activeIP.id)
      : null;
    const restoredAuditResult = auditDraft
      ? normalizeStoredCompleteScriptResult(auditDraft.result)
      : null;
    const draft = getPartialScriptDraft(activeIP.id);
    if (restoredAuditResult) {
      const restored = restoredAuditResult;
      setGenerationMode(restored.generationMode ?? "ip");
      setTopic(restored.topic);
      setResult(restored);
      setApiMeta(restored.apiMeta);
      setDraftStorageError(null);
    } else if (draft && isStoredScriptResult(draft.result)) {
      setDraftStorageError(restorePartialDraft(draft as PartialScriptDraft<ScriptResult>, activeIP.id));
    }
    else {
      setDraftStorageError(draft ? "本地临时草稿数据不完整，已停止自动恢复。" : null);
    }
    setError(null);
    // 仅在切换IP时恢复该IP自己的临时草稿。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIP?.id]);

  useEffect(() => {
    if (ipLoading || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const scriptId = params.get("scriptId");
    const topicId = params.get("topicId");
    if (!scriptId && !topicId) return;
    if (!activeIP) {
      setLinkedTopic(null);
      setResult(null);
      setPendingConstraintReview(null);
      setError("需要先选择对应的当前操盘IP，才能恢复这条内容。");
      return;
    }

    if (scriptId) {
      setLinkedTopic(null);
      setTopic("");
      setResult(null);
      setPendingConstraintReview(null);
      setApiMeta(null);
      setPartialDraftSavedAt(null);
      const script = getScriptAssets(activeIP.id).find(asset => asset.id === scriptId);
      if (!script) {
        setError("没有找到这条脚本，或脚本不属于当前操盘IP。");
        return;
      }
      const restoreError = restoreSavedScript(script, activeIP.id);
      setDraftStorageError(restoreError);
      setError(restoreError);
      return;
    }

    try {
      const asset = resolveTopicForScript(topicId!, activeIP.id);
      const currentDraft = getPartialScriptDraft(activeIP.id);
      if (currentDraft?.topicId?.trim() !== asset.id) {
        setResult(null);
        setPendingConstraintReview(null);
        setApiMeta(null);
        setPartialDraftSavedAt(null);
      }
      setTopic(asset.title);
      setLinkedTopic(asset);
      setError(null);
      void runLinkedTopicBoundaryAudit(asset, activeIP);
    } catch (linkError) {
      setLinkedTopic(null);
      setError(
        linkError instanceof TopicScriptLinkError
          ? linkError.message
          : "读取关联选题失败，请返回选题库重试。",
      );
    }
  }, [activeIP?.id, ipLoading, cognitionData.readVersion]);

  function handleClearPartialDraft() {
    if (!activeIP) return;
    if (!clearPartialScriptDraft(activeIP.id)) {
      setDraftStorageError("浏览器未允许清除本地临时草稿，请检查站点存储权限。");
      return;
    }
    setResult(current => current?.generationStatus === "partial" ? null : current);
    setPartialDraftSavedAt(null);
    setDraftStorageError(null);
  }

  function handleTopicChange(nextTopic: string) {
    topicContentRef.current = nextTopic;
    setTopic(nextTopic);
    if (pendingConstraintReview?.phase === "awaiting_decision") {
      generationSequenceRef.current += 1;
      setPendingConstraintReview(null);
      setResult(null);
    } else if (pendingConstraintReview?.phase === "finalizing") {
      setResult(null);
      setApiMeta(null);
      setPartialDraftSavedAt(null);
    }
    if (!linkedTopic || boundaryStatus === "legacy") return;
    const normalized = nextTopic.trim();
    if (auditedTopicContent === normalized && boundaryStatus === "ready") return;
    generationSequenceRef.current += 1;
    boundaryRequestSeqRef.current += 1;
    setBoundaryReport(null);
    setBoundaryEvidence([]);
    setAuditedTopicContent(null);
    setPendingBoundaryConfirmation(false);
    setBoundaryStatus("stale");
    setBoundaryMessage("旧审计结论已失效，重新审计前不会开放生成入口。");
  }

  function getGenerationCaseEvidence(): GenerationCaseEvidence | null {
    if (caseDecision === "knowledge" && selectedKnowledgeCase) {
      return {
        ipId: selectedKnowledgeCase.ipId,
        title: selectedKnowledgeCase.title,
        content: selectedKnowledgeCase.rawContent,
        sourceType: "知识库",
        verificationStatus: selectedKnowledgeCase.sourceTier === "高" ? "有明确来源" : "未核实",
        sourceUrl: selectedKnowledgeCase.sourceUrl,
      };
    }
    if (caseDecision === "manual" && manualCaseContent.trim()) {
      return {
        ipId: null,
        title: manualCaseTitle.trim() || "人工补充案例",
        content: manualCaseContent.trim(),
        sourceType: "用户提供",
        verificationStatus: manualCaseVerified ? "人工已核实" : "未经系统核验",
        sourceUrl: manualCaseSource.trim() || undefined,
      };
    }
    return null;
  }

  async function generateFor(
    ip: IPProfile,
    t: string,
    requestMode: GenerationMode,
    ipSourceContext: ReturnType<typeof getIPSourceContext>,
    caseEvidence: GenerationCaseEvidence | null,
    temporaryCognition: EphemeralCognitionContext | null,
    linkedTopicId: string | null,
  ) {
    let res: Response;
    try {
      res = await apiFetch("/api/script-factory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationMode: requestMode,
          directorRule: requestMode === "ip" ? activeDirectorRule : undefined,
          ipProfile: ip, topic: t,
          topicId: linkedTopicId ?? undefined,
          temporaryCognition: temporaryCognition ?? undefined,
          styleProfile: getStyleProfile(ip.id) ?? null,
          platform: ip.platforms.includes(platform) ? platform : (ip.platforms[0] || "抖音"),
          formatCategory, durationSeconds: duration, goal, videoType,
          needsStoryboard, needsShootingTips,
          ipSourceContext: requestMode === "ip" ? ipSourceContext : undefined,
          caseEvidence: requestMode === "ip" ? caseEvidence : undefined,
          voiceSamples: cognitionData.entries
            .filter(entry => getNormalizedCategory(entry) === "IP表达语料" && entry.ipId === ip.id)
            .slice(0, 5)
            .map(entry => ({
              id: entry.id,
              title: entry.title,
              rawText: entry.rawContent,
              type: "IP表达语料",
            })),
          knowledgeRefs: knowledgeRefs.map(ref => ({
            id: ref.id,
            ipId: ref.entry.ipId ?? null,
            title: ref.entry.title,
            category: getNormalizedCategory(ref.entry),
            rawContent: ref.entry.rawContent,
            reason: ref.reason,
          })),
        }),
      });
    } catch (networkErr) {
      const msg = `网络错误：无法连接到 /api/script-factory，请确认开发服务器（npm run dev）正在运行（${networkErr instanceof Error ? networkErr.message : String(networkErr)}）`;
      setApiMeta({ apiCalled: false, calledAt: new Date().toISOString(), model: null, ipUsed: ip.name, mockHit: false, error: msg });
      throw new Error(msg);
    }

    let data: (ScriptResult & { error?: string }) | { error: string; apiMeta?: ApiMeta };
    try {
      data = await res.json();
    } catch (parseErr) {
      const msg = `JSON解析错误：服务器返回的不是合法JSON（HTTP ${res.status}），可能是服务端报错页面而不是API响应（${parseErr instanceof Error ? parseErr.message : String(parseErr)}）`;
      setApiMeta({ apiCalled: true, calledAt: new Date().toISOString(), model: null, ipUsed: ip.name, mockHit: false, error: msg });
      throw new Error(msg);
    }

    if ("apiMeta" in data && data.apiMeta) setApiMeta(data.apiMeta);

    if (!res.ok) {
      const errMsg = "error" in data && data.error ? data.error : `HTTP ${res.status}`;
      throw new Error(`${ip.name}：API返回错误（HTTP ${res.status}）：${errMsg}`);
    }
    return data as ScriptResult;
  }

  async function runPostGenerationAudit({
    requestSequence,
    requestIP,
    sources,
    caseEvidence,
    generatedData,
    savedAssetId,
    existingAuditSessionId,
    onDeliveryGateOpen,
  }: {
    requestSequence: number;
    requestIP: IPProfile;
    sources: ReturnType<typeof getIPSourceContext>;
    caseEvidence: GenerationCaseEvidence | null;
    generatedData: ScriptResult;
    savedAssetId: string | undefined;
    existingAuditSessionId?: string;
    onDeliveryGateOpen?: (auditedData: ScriptResult) => string | undefined;
  }) {
    let auditedData: ScriptResult;
    try {
      const response = await apiFetch("/api/script-factory/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(existingAuditSessionId ? { auditSessionId: existingAuditSessionId } : {}),
          sources: sources.map(source => ({
            sourceId: source.sourceId,
            sourceTitle: source.sourceTitle,
            itemId: source.itemId,
            kind: source.kind,
            content: source.content,
            originalExcerpt: source.originalExcerpt,
            extractionStatus: source.extractionStatus,
          })),
          content: {
            outline: generatedData.outline.map(section => ({
              ...section,
              subPoints: section.subPoints ?? [],
            })),
            pendingVerification: generatedData.pendingVerification ?? [],
          },
          caseEvidence: caseEvidence ? {
            title: caseEvidence.title,
            content: caseEvidence.content,
            sourceType: caseEvidence.sourceType,
            verificationStatus: caseEvidence.verificationStatus,
            sourceUrl: caseEvidence.sourceUrl,
          } : null,
        }),
      });
      const audit = parseScriptPostGenerationAudit(await response.json());
      if (!response.ok || !audit) throw new Error("审计接口返回异常");
      if (audit.status === "completed") {
        const hasContradictoryOpenGate = audit.deliveryGate.status === "OPEN"
          && (audit.deliveryGate.blockerCodes.length > 0 || audit.deliveryGate.pendingItemIds.length > 0);
        auditedData = {
          ...generatedData,
          scriptAssetId: savedAssetId ?? generatedData.scriptAssetId,
          postGenerationAuditStatus: "completed",
          postGenerationAuditMessage: hasContradictoryOpenGate
            ? "系统检测到响应内部逻辑矛盾：门禁标记为开放，但仍存在阻断原因或待核验项。已禁止正式入库和复制，请重新审计。"
            : undefined,
          auditVersion: audit.auditVersion,
          auditSessionId: audit.auditSessionId,
          deliveryGate: audit.deliveryGate,
          coverageAssessment: audit.coverageAssessment,
          attributionAudit: audit.attributionAudit,
          sourceIntegrityAudit: audit.sourceIntegrityAudit,
          factAudit: audit.factAudit,
        };
      } else {
        auditedData = {
          ...generatedData,
          scriptAssetId: savedAssetId ?? generatedData.scriptAssetId,
          postGenerationAuditStatus: "unavailable",
          postGenerationAuditMessage: `${audit.status === "unavailable" ? audit.message : "本次归属分析暂未完成"}。正文可查看，但不得视为审计通过或正式交付`,
          auditVersion: audit.status === "unavailable" ? audit.auditVersion : undefined,
          coverageAssessment: undefined,
          attributionAudit: audit.status === "unavailable" ? audit.attributionAudit : undefined,
          sourceIntegrityAudit: audit.status === "unavailable" ? audit.sourceIntegrityAudit : undefined,
          factAudit: audit.status === "unavailable" ? audit.factAudit : undefined,
        };
      }
    } catch {
      auditedData = {
        ...generatedData,
        scriptAssetId: savedAssetId ?? generatedData.scriptAssetId,
        postGenerationAuditStatus: "unavailable",
        postGenerationAuditMessage: "本次归属分析暂未完成。正文可查看，但不得视为审计通过或正式交付",
        auditVersion: undefined,
        coverageAssessment: undefined,
        attributionAudit: undefined,
        sourceIntegrityAudit: undefined,
        factAudit: undefined,
      };
    }

    if (generationSequenceRef.current !== requestSequence || activeIPIdRef.current !== requestIP.id) return;
    if (typeof window !== "undefined" && !saveScriptAuditDraft(window.sessionStorage, {
      ipId: requestIP.id,
      auditSessionId: auditedData.auditSessionId,
      auditVersion: auditedData.auditVersion,
      result: auditedData,
    })) {
      setDraftStorageError("待审正文未能保存到独立草稿区；刷新前请先复制内容。");
      setResult({ ...auditedData, deliveryPersistenceStatus: "blocked" });
      return;
    }
    if (getScriptDeliveryBlockReason(auditedData) === null && onDeliveryGateOpen) {
      try {
        if (!auditedData.auditSessionId || !auditedData.auditVersion || typeof window === "undefined") {
          throw new Error("审计会话或版本缺失，无法安全提升正式脚本");
        }
        const auditSessionId = auditedData.auditSessionId;
        const auditVersion = auditedData.auditVersion;
        const promotion = promoteScriptAuditDraft(window.sessionStorage, {
          ipId: requestIP.id,
          auditSessionId,
          auditVersion,
          findExistingAsset: () => {
            const asset = getScriptAssets(requestIP.id).find(item => {
              const stored = item.scriptResult as { auditSessionId?: string; auditVersion?: string } | undefined;
              if (!stored) return false;
              return stored.auditSessionId === auditSessionId
                && stored.auditVersion === auditVersion;
            });
            return asset ? {
              id: asset.id,
              auditSessionId,
              auditVersion,
            } : null;
          },
          createFormalAsset: () => {
            const assetId = onDeliveryGateOpen(auditedData);
            if (!assetId) throw new Error("正式脚本写入未返回记录标识");
            return assetId;
          },
          verifyFormalAsset: assetId => getScriptAssets(requestIP.id).some(asset => {
            const stored = asset.scriptResult as { auditSessionId?: string; auditVersion?: string } | undefined;
            if (asset.id !== assetId || !stored) return false;
            return stored.auditSessionId === auditSessionId
              && stored.auditVersion === auditVersion;
          }),
        });
        if (promotion.code === "PENDING_DRAFT_NOT_FOUND") {
          setDraftStorageError("待审正文没有成功保存，已停止写入正式脚本；请先保留当前正文后重试。");
        } else if (promotion.code === "PENDING_DRAFT_VERSION_MISMATCH") {
          setDraftStorageError("待审正文与当前审计版本不一致，已停止写入正式脚本；请重新审计后再试。");
        } else if (promotion.code === "FORMAL_WRITE_NOT_VERIFIED") {
          throw new Error("正式脚本回读核对失败");
        } else if (promotion.code === "COMMITTED_CLEANUP_PENDING") {
          auditedData = { ...auditedData, scriptAssetId: promotion.formalAssetId };
          setDraftStorageError("正式脚本已保存，但待审记录尚未完成清理标记；刷新后可重试收口。");
        } else {
          auditedData = { ...auditedData, scriptAssetId: promotion.formalAssetId };
        }
      } catch {
        setDraftStorageError("团队审核已经通过，但正式脚本写入失败；待审正文仍保留，请重试。");
      }
    }
    setResult(auditedData);
    if (generatedData.generationStatus === "partial") {
      const draft = getPartialScriptDraft(requestIP.id);
      if (draft && isStoredScriptResult(draft.result)) {
        savePartialScriptDraft({ ...draft, result: auditedData });
      }
      return;
    }
    if (savedAssetId && !updateScriptAssetResult(savedAssetId, requestIP.id, auditedData)) {
      setDraftStorageError("正文已经保存，但团队审核信息未能写入历史记录；不影响当前正文使用。");
    }
  }

  async function handleConfirmFactPendingItem(pendingItemId: string): Promise<void> {
    const currentResult = result;
    const requestIP = activeIP;
    const requestSequence = generationSequenceRef.current;
    if (
      !currentResult
      || !requestIP
      || !currentResult.auditSessionId
      || !currentResult.auditVersion
      || !currentResult.factAudit
      || typeof window === "undefined"
    ) {
      setError("当前待核验记录不完整，不能安全登记人工决定。");
      return;
    }
    const currentPendingItem = currentResult.factAudit.pendingItems.find(
      (item): item is ScriptFactPendingItem => typeof item !== "string" && item.id === pendingItemId,
    );
    if (
      !currentPendingItem
      || currentPendingItem.subtype !== "unsupported_specific_claim"
      || currentPendingItem.resolutionStatus !== "PENDING"
    ) {
      setError("这条待核验记录已变化，请以当前页面状态重新操作。");
      return;
    }
    const auditSessionId = currentResult.auditSessionId;
    const auditVersion = currentResult.auditVersion;
    try {
      setError(null);
      const response = await apiFetch("/api/script-factory/audit/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auditSessionId,
          auditVersion,
          pendingItemId,
          resolutionStatus: "CONFIRMED_ALLOWED",
          idempotencyKey: `confirm-allowed:${auditSessionId}:${auditVersion}:${pendingItemId}`,
        }),
      });
      const rawResponse = await response.json();
      if (!response.ok) {
        const message = isRecord(rawResponse) && typeof rawResponse.error === "string"
          ? rawResponse.error
          : "人工决定登记失败";
        throw new Error(message);
      }
      const resolution = parseScriptAuditResolutionResponse(rawResponse);
      if (
        !resolution
        || resolution.auditSessionId !== auditSessionId
        || resolution.auditVersion !== auditVersion
        || resolution.pendingItem.id !== pendingItemId
      ) {
        throw new Error("服务端返回的人工处理记录与当前审计不一致");
      }
      if (generationSequenceRef.current !== requestSequence || activeIPIdRef.current !== requestIP.id) {
        throw new Error("人工确认期间页面内容或当前IP已变化，旧结果未写入正式脚本");
      }
      const nextPendingItems = currentResult.factAudit.pendingItems.map(item => (
          typeof item !== "string" && item.id === pendingItemId
            ? resolution.pendingItem
            : item
        ));
      const hasUnresolvedFact = nextPendingItems.some(item => (
        typeof item === "string" || item.resolutionStatus === "PENDING"
      ));
      const caseEvidence = currentResult.factAudit.caseEvidence;
      const nextFactAudit: ScriptFactAudit = {
        ...currentResult.factAudit,
        overallStatus: hasUnresolvedFact || (caseEvidence && !isFactCaseEvidenceConfirmed(caseEvidence))
          ? "pending"
          : caseEvidence || nextPendingItems.length > 0 ? "user_confirmed" : "not_checked",
        pendingItems: nextPendingItems,
      };
      let nextResult: ScriptResult = {
        ...currentResult,
        factAudit: nextFactAudit,
        deliveryGate: resolution.deliveryGate,
      };
      if (!saveScriptAuditDraft(window.sessionStorage, {
        ipId: requestIP.id,
        auditSessionId,
        auditVersion,
        result: nextResult,
      })) {
        setDraftStorageError("人工决定已在服务端登记，但待审记录未能在浏览器中更新；请勿关闭页面。");
        return;
      }
      if (getScriptDeliveryBlockReason(nextResult) === null) {
        const promotion = promoteScriptAuditDraft(window.sessionStorage, {
          ipId: requestIP.id,
          auditSessionId,
          auditVersion,
          findExistingAsset: () => {
            const asset = getScriptAssets(requestIP.id).find(item => {
              const stored = item.scriptResult as { auditSessionId?: string; auditVersion?: string } | undefined;
              return stored?.auditSessionId === auditSessionId && stored.auditVersion === auditVersion;
            });
            return asset ? { id: asset.id, auditSessionId, auditVersion } : null;
          },
          createFormalAsset: () => addScriptAsset({
            ipId: requestIP.id,
            title: nextResult.titles?.find(item => item.recommended)?.title
              || nextResult.titles?.[0]?.title
              || nextResult.topic,
            cover: nextResult.coverCopy?.[0] || "",
            content: nextResult.outline.map(section => `【${section.label}】${section.content}`).join("\n\n"),
            status: "草稿",
            scriptResult: nextResult,
          }).id,
          verifyFormalAsset: assetId => getScriptAssets(requestIP.id).some(asset => {
            const stored = asset.scriptResult as { auditSessionId?: string; auditVersion?: string } | undefined;
            return asset.id === assetId
              && stored?.auditSessionId === auditSessionId
              && stored.auditVersion === auditVersion;
          }),
        });
        if (promotion.code === "PENDING_DRAFT_NOT_FOUND") {
          setDraftStorageError("待审正文没有成功保存，已停止写入正式脚本；请先保留当前正文后重试。");
        } else if (promotion.code === "PENDING_DRAFT_VERSION_MISMATCH") {
          setDraftStorageError("待审正文与当前审计版本不一致，已停止写入正式脚本；请重新审计后再试。");
        } else if (promotion.code === "FORMAL_WRITE_NOT_VERIFIED") {
          setDraftStorageError("人工决定已登记，但正式脚本回读核对失败；待审正文仍保留。");
        } else {
          nextResult = { ...nextResult, scriptAssetId: promotion.formalAssetId };
          if (promotion.code === "COMMITTED_CLEANUP_PENDING") {
            setDraftStorageError("正式脚本已保存，但待审记录尚未完成清理标记；刷新后可重试收口。");
          }
        }
      }
      setResult(nextResult);
    } catch (resolutionError) {
      setError(resolutionError instanceof Error ? resolutionError.message : "人工决定登记失败，请重试。");
    }
  }

  function handleManualRewrite(
    issue: SourceIntegrityIssue,
    action: ScriptManualRewriteAction,
    replacement: string,
    deleteConfirmed: boolean,
  ) {
    if (!result || !activeIP || !result.auditSessionId || !result.auditVersion) {
      setError("缺少当前审计会话或版本，不能处理正文。");
      return;
    }
    try {
      const applied = applyManualScriptRewrite({
        outline: result.outline,
        auditVersion: result.auditVersion,
        previousRewrite: result.manualRewrite ?? null,
        target: issue,
        action,
        replacement,
        deleteConfirmed,
      });
      const auditSessionId = result.auditSessionId;
      const editedData: ScriptResult = {
        ...result,
        outline: applied.outline,
        manualRewrite: applied.rewrite,
        postGenerationAuditStatus: "pending",
        postGenerationAuditMessage: undefined,
        auditSessionId: undefined,
        auditVersion: undefined,
        deliveryGate: undefined,
        coverageAssessment: undefined,
        attributionAudit: undefined,
        sourceIntegrityAudit: undefined,
        factAudit: undefined,
      };
      let rewriteSaved = false;
      if (result.generationStatus === "partial") {
        const draft = getPartialScriptDraft(activeIP.id);
        if (draft && isStoredScriptResult(draft.result)) {
          rewriteSaved = savePartialScriptDraft({ ...draft, result: editedData });
        }
      } else if (typeof window !== "undefined") {
        rewriteSaved = saveScriptAuditDraft(window.sessionStorage, {
          ipId: activeIP.id,
          auditSessionId,
          result: editedData,
        });
      }
      if (!rewriteSaved) {
        setError("人工处理记录未能安全保存，本次没有修改正文，也没有发起复审。请检查浏览器存储空间后重试。");
        return;
      }
      setError(null);
      const rewriteRequestSequence = generationSequenceRef.current + 1;
      generationSequenceRef.current = rewriteRequestSequence;
      setResult(editedData);
      const caseEvidence = result.factAudit?.caseEvidence
        ? {
            title: result.factAudit.caseEvidence.title,
            content: result.factAudit.caseEvidence.content ?? "",
            sourceType: result.factAudit.caseEvidence.sourceType,
            verificationStatus: result.factAudit.caseEvidence.verificationStatus,
            sourceUrl: result.factAudit.caseEvidence.sourceUrl,
            occurredAt: result.factAudit.caseEvidence.occurredAt,
          }
        : null;
      void runPostGenerationAudit({
        requestSequence: rewriteRequestSequence,
        requestIP: activeIP,
        sources: getIPSourceContext(activeIP.id),
        caseEvidence,
        generatedData: editedData,
        savedAssetId: undefined,
        existingAuditSessionId: auditSessionId,
        onDeliveryGateOpen: auditedData => {
          if (!auditedData.auditSessionId || !auditedData.auditVersion) {
            throw new Error("审计会话或版本缺失，无法安全写入正式脚本");
          }
          const auditSessionId = auditedData.auditSessionId;
          const auditVersion = auditedData.auditVersion;
          const existing = getScriptAssets(activeIP.id).find(asset => {
            const stored = asset.scriptResult as { auditSessionId?: string; auditVersion?: string } | undefined;
            return stored?.auditSessionId === auditSessionId
              && stored.auditVersion === auditVersion;
          });
          if (existing) return existing.id;
          return addScriptAsset({
            ipId: activeIP.id,
            title: auditedData.titles?.find(item => item.recommended)?.title
              || auditedData.titles?.[0]?.title
              || auditedData.topic,
            cover: auditedData.coverCopy?.[0] || "",
            content: auditedData.outline.map(section => `【${section.label}】${section.content}`).join("\n\n"),
            status: "草稿",
            scriptResult: auditedData,
          }).id;
        },
      });
    } catch (rewriteError) {
      setError(rewriteError instanceof Error ? rewriteError.message : "人工处理失败，请重新核对原文。");
    }
  }

  async function handleGenerate(allowPartialBoundary = false) {
    if (pendingConstraintReviewRef.current?.phase === "finalizing") {
      setError("请先补全已保存脚本的知识使用记录，再生成新脚本。");
      return;
    }
    if (!topic.trim()) { setError("请输入视频选题"); return; }
    if (!activeIP) { setError("请先在「IP身份中心」选择一个当前操盘IP"); return; }
    if (linkedTopic && !isLinkedTopicBoundaryAllowed) {
      setError("这条关联选题尚未通过认知边界审计，已停止脚本生成。");
      return;
    }
    if (linkedTopic
      && boundaryReport
      && decideBoundaryAction(boundaryReport) === "confirm"
      && !allowPartialBoundary) {
      setPendingBoundaryConfirmation(true);
      return;
    }
    setPendingBoundaryConfirmation(false);
    const requestIP = activeIP;
    const requestedTopic = topic.trim();
    const auditedTopicAtRequest = linkedTopic && boundaryStatus !== "legacy"
      ? auditedTopicContent
      : requestedTopic;
    const requestMode = generationMode;
    const knowledgeRefsAtRequest = knowledgeRefs;
    const requestSequence = generationSequenceRef.current + 1;
    generationSequenceRef.current = requestSequence;
    const sourceContext = requestMode === "ip" ? getIPSourceContext(requestIP.id) : [];
    const caseEvidence = requestMode === "ip" ? getGenerationCaseEvidence() : null;
    const temporaryCognition = requestMode === "ip" && linkedTopic && typeof window !== "undefined"
      ? readEphemeralCognitionContext(window.sessionStorage, requestIP.id, linkedTopic.id)
      : null;
    let linkedTopicAtRequest: TopicAsset | null = null;
    try {
      if (activeIPIdRef.current !== requestIP.id) {
        throw new Error("当前操盘IP刚刚发生变化，请确认后重新生成。");
      }
      if (linkedTopic) {
        linkedTopicAtRequest = resolveTopicForScript(linkedTopic.id, requestIP.id);
      }
    } catch (ownershipError) {
      setError(ownershipError instanceof Error ? ownershipError.message : "选题与当前IP校验失败，请重试。");
      return;
    }
    setError(null); setDraftStorageError(null); setResult(null); setPartialDraftSavedAt(null); setPendingConstraintReview(null); setLoading(true);
    try {
      const generatedData = await generateFor(
        requestIP,
        requestedTopic,
        requestMode,
        sourceContext,
        caseEvidence,
        temporaryCognition,
        linkedTopicAtRequest?.id ?? null,
      );
      const data: ScriptResult = {
        ...generatedData,
        generationMode: requestMode,
        coverageAssessment: undefined,
        attributionAudit: undefined,
        sourceIntegrityAudit: undefined,
        factAudit: undefined,
        postGenerationAuditStatus: requestMode === "ip" ? "pending" : undefined,
        postGenerationAuditMessage: undefined,
        auditVersion: undefined,
      };
      if (data.ipId !== requestIP.id) {
        throw new Error("接口返回的脚本IP与发起请求时的IP不一致，已停止保存。");
      }
      if (auditedTopicAtRequest !== requestedTopic || topicContentRef.current.trim() !== requestedTopic) {
        throw new Error("生成期间选题内容已变更，旧结果未展示、未保存；请重新审计后再生成。");
      }
      if (activeIPIdRef.current !== requestIP.id || generationSequenceRef.current !== requestSequence) {
        throw new Error("生成期间当前操盘IP已切换，结果未保存；请切回原IP后重新生成。");
      }
      if (linkedTopicAtRequest) {
        linkedTopicAtRequest = resolveTopicForScript(linkedTopicAtRequest.id, requestIP.id);
      }
      let persistedAssetId: string | undefined;
      let partialDraftPersisted = false;
      let persistenceCompleted = false;
      let postGenerationAuditStarted = false;
      const recordedKnowledgeEntryIds = new Set<string>();
      const startPostGenerationAudit = (
        savedAssetId?: string,
        onDeliveryGateOpen?: (auditedData: ScriptResult) => string | undefined,
      ) => {
        if (requestMode !== "ip" || postGenerationAuditStarted) return;
        postGenerationAuditStarted = true;
        void runPostGenerationAudit({
          requestSequence,
          requestIP,
          sources: sourceContext,
          caseEvidence,
          generatedData: data,
          savedAssetId,
          onDeliveryGateOpen,
        });
      };
      const persistResult = (approvedData?: ScriptResult) => {
        if (persistenceCompleted) return;
        if (!persistedAssetId) {
          if (activeIPIdRef.current !== requestIP.id || generationSequenceRef.current !== requestSequence) {
            throw new Error("人工确认前当前操盘IP已变化，旧结果未保存；请重新生成。");
          }
          if (topicContentRef.current.trim() !== requestedTopic) {
            throw new Error("人工确认前选题内容已变化，旧结果未保存；请重新生成。");
          }
          if (linkedTopicAtRequest) {
            linkedTopicAtRequest = resolveTopicForScript(linkedTopicAtRequest.id, requestIP.id);
          }
        }
        let savedAssetId = persistedAssetId;
        if (data.generationStatus === "partial") {
          if (!data.partialFailure) {
            throw new Error("部分成功响应缺少失败阶段信息，无法安全保存临时草稿");
          }
          if (!partialDraftPersisted) {
            const savedAt = new Date().toISOString();
            const saved = savePartialScriptDraft<ScriptResult>({
              version: 1,
              ipId: requestIP.id,
              topicId: linkedTopicAtRequest?.id,
              topic: requestedTopic,
              savedAt,
              failedStage: data.partialFailure.stage,
              warning: data.partialFailure.message,
              generationSettings: {
                generationMode: requestMode,
                platform,
                formatCategory,
                durationSeconds: duration,
                goal,
                videoType,
                needsStoryboard,
                needsShootingTips,
              },
              result: data,
            });
            if (saved) {
              partialDraftPersisted = true;
              setPartialDraftSavedAt(savedAt);
            } else {
              setDraftStorageError("核心脚本可以继续查看，但浏览器未能自动保存临时草稿。刷新或离开前请先复制内容。");
            }
          }
        } else {
          if (requestMode === "ip" && !approvedData) {
            setError(null);
            setPendingConstraintReview(null);
            startPostGenerationAudit(undefined, auditedData => {
              persistResult(auditedData);
              return persistedAssetId;
            });
            return;
          }
          const dataToPersist = approvedData ?? data;
          const knowledgeTracking = knowledgeRefsAtRequest.length > 0
            ? {
                status: "unavailable" as const,
                candidateKnowledgeEntryIds: knowledgeRefsAtRequest.map(ref => ref.id),
                verifiedAt: new Date().toISOString(),
                usages: [] as [],
              }
            : undefined;
          const scriptInput = {
            ipId: requestIP.id,
            title: dataToPersist.titles?.find(item => item.recommended)?.title || dataToPersist.titles?.[0]?.title || topic,
            cover: dataToPersist.coverCopy?.[0] || "",
            content: dataToPersist.outline.map(o => `【${o.label}】${o.content}`).join("\n\n"),
            status: "草稿" as const,
            scriptResult: dataToPersist,
            knowledgeTracking,
          };
          if (!savedAssetId && activeIPIdRef.current !== requestIP.id) {
            throw new Error("保存前检测到当前操盘IP已切换，结果未保存。");
          }
          if (!savedAssetId) {
            if (linkedTopicAtRequest) {
              savedAssetId = addScriptAssetForTopic({ ...scriptInput, topicId: linkedTopicAtRequest.id }).id;
            } else {
              savedAssetId = addScriptAsset(scriptInput).id;
            }
            persistedAssetId = savedAssetId;
            setPendingConstraintReview(current => current
              ? { ...current, phase: "finalizing" }
              : current);
            startPostGenerationAudit(savedAssetId);
          }
          if (!clearPartialScriptDraft(requestIP.id)) {
            setDraftStorageError("完整脚本已保存，但浏览器未能清除旧的本地临时草稿。");
          }
          knowledgeRefsAtRequest.forEach(ref => {
            if (recordedKnowledgeEntryIds.has(ref.id)) return;
            recordKnowledgeUsage(ref.id, {
              module: "脚本工厂",
              usedAt: new Date().toISOString(),
              reason: ref.reason,
              relevanceTier: ref.relevanceTier as "高度相关" | "中度相关" | "低度相关",
              relevanceReason: ref.relevanceReason,
              context: requestedTopic,
            }, "已用于脚本", savedAssetId);
            recordedKnowledgeEntryIds.add(ref.id);
          });
        }
        persistenceCompleted = true;
        setError(null);
        setPendingConstraintReview(null);
        startPostGenerationAudit(savedAssetId);
      };
      const detection = data.globalConstraintReview;
      if (!detection || detection.source !== "server_ledger") {
        throw new Error("服务端未返回通用强制规则审计结果，脚本已停止保存。");
      }
      setResult(data);
      if (detection.reviewRequired) {
        setPendingConstraintReview({ detection, persist: persistResult, phase: "awaiting_decision" });
      } else {
        persistResult();
      }
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "脚本生成失败，请重试");
      if (activeIPIdRef.current === requestIP.id) {
        const draft = getPartialScriptDraft(requestIP.id);
        if (draft && isStoredScriptResult(draft.result)) {
          setDraftStorageError(restorePartialDraft(draft as PartialScriptDraft<ScriptResult>, requestIP.id));
        }
      }
    } finally {
      setLoading(false);
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
            {generationMode === "standard"
              ? "固定脚本生成保留原来的直接产出流程；需要严格依据老师原始观点时，再切换到IP专属生成。"
              : "输入选题或原文后直接生成；观点归属和事实核验会在正文展示后自动补充。"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="打开灵感知识库" onClick={() => setShowKnowledgeDrawer(true)} className="whitespace-nowrap rounded-[10px] border border-[#DAD9D2] bg-white px-3.5 py-1.5 text-[12px] font-semibold text-[#555]">灵感／知识库</button>
          <span className="whitespace-nowrap rounded-full bg-[#EAF3DE] px-3.5 py-1.5 text-[12px] font-semibold text-[#3B6D11]">02 · 脚本生成</span>
        </div>
      </header>

      {showKnowledgeDrawer && (
        <KnowledgeInspirationDrawer
          key={activeIP?.id ?? "__global__"}
          activeIPId={activeIP?.id ?? null}
          activeIPName={activeIP?.name ?? null}
          onClose={() => setShowKnowledgeDrawer(false)}
        />
      )}

      <>

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-[16px] border border-[#E5E4DE] bg-white p-3 sm:grid-cols-2">
        <button
          type="button"
          aria-label="固定脚本生成"
          aria-pressed={generationMode === "standard"}
          disabled={isConstraintFinalizing}
          onClick={() => switchGenerationMode("standard")}
          className={`rounded-[12px] px-4 py-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-55 ${generationMode === "standard" ? "bg-[#1C1C1B] text-white" : "bg-[#F7F6F2] text-[#555]"}`}
        >
          <div className="text-[13.5px] font-bold">固定脚本生成</div>
          <div className={`mt-1 text-[11.5px] ${generationMode === "standard" ? "text-white/70" : "text-[#888]"}`}>输入选题后直接生成固定内容包，不检查观点覆盖度。</div>
        </button>
        <button
          type="button"
          aria-label="IP专属生成"
          aria-pressed={generationMode === "ip"}
          disabled={isConstraintFinalizing}
          onClick={() => switchGenerationMode("ip")}
          className={`rounded-[12px] px-4 py-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-55 ${generationMode === "ip" ? "bg-[#1C1C1B] text-white" : "bg-[#F7F6F2] text-[#555]"}`}
        >
          <div className="text-[13.5px] font-bold">IP专属生成</div>
          <div className={`mt-1 text-[11.5px] ${generationMode === "ip" ? "text-white/70" : "text-[#888]"}`}>调用当前IP的原始内容、表达语料和专属规则。</div>
        </button>
      </div>

      {!ipLoading && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[14px] bg-[#FBF3D6] px-4 py-2.5 text-[13px] text-[#7A5C00]">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: activeIP?.color ?? "#999" }}>
              {activeIP?.avatar ?? "?"}
            </span>
            当前以 <b>{activeIP?.name ?? "未选择IP"}</b> 的人设、受众、表达风格与拍摄习惯生成内容。
            {isDirectorRuleEnabled && (
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#639922]">{activeDirectorRule.name}已启用</span>
            )}
          </div>
          <button onClick={() => setShowContext(true)} disabled={!activeIP} className="whitespace-nowrap rounded-[10px] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#7A5C00] disabled:opacity-50">
            查看当前IP上下文
          </button>
        </div>
      )}
      {showContext && activeIP && <IPContextModal ip={activeIP} onClose={() => setShowContext(false)} />}

      {cognitionData.error && (
        <div className="mb-3 rounded-[14px] border border-[#E8C96A] bg-[#FFF8DC] px-4 py-3 text-[12.5px] text-[#755700]" role="alert">
          <div className="font-semibold">{cognitionData.error}</div>
          <p className="mt-1 leading-5">系统已停止认知审计和关联选题生成，没有修改或删除原始数据。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={cognitionData.retry} className="rounded-[9px] bg-white px-3 py-2 text-[12px] font-semibold text-[#755700]">
              重新读取认知数据
            </button>
            <a href={activeIP?.id ? `/knowledge-intake/original?ipId=${encodeURIComponent(activeIP.id)}` : "/knowledge-intake/original"} className="rounded-[9px] bg-[#1C1C1B] px-3 py-2 text-[12px] font-semibold text-white">
              去重新解析相关资料
            </a>
          </div>
        </div>
      )}

      {linkedTopic && (
        <div className="mb-3 rounded-[14px] border border-[#B8D98D] bg-[#F7FCF0] px-4 py-3 text-[12.5px] text-[#3B6D11]">
          <div className="font-semibold">当前关联选题</div>
          <div className="mt-1 text-[#1C1C1B]">{linkedTopic.title}</div>
        </div>
      )}

      {linkedTopic && (
        <div className="mb-6">
          <BoundaryAuditPanel
            status={boundaryStatus}
            report={boundaryReport}
            evidenceNodes={boundaryEvidence}
            message={boundaryMessage}
            activeIPId={activeIP?.id ?? null}
            onRetry={boundaryStatus === "timeout" && linkedTopic && activeIP
              ? () => { void runLinkedTopicBoundaryAudit(linkedTopic, activeIP, topic.trim()); }
              : boundaryStatus === "stale" && linkedTopic && activeIP && topic.trim()
                ? () => { void runLinkedTopicBoundaryAudit(linkedTopic, activeIP, topic.trim()); }
              : undefined}
          />
        </div>
      )}

      <ApiStatusPanel meta={apiMeta} />

      {/* 主工作流 */}
      <Card className="mb-6">
        <SectionHead num="①">输入选题或原文并设置产出</SectionHead>
        <div className="flex flex-col gap-3">
          <textarea
            value={topic} onChange={e => handleTopicChange(e.target.value)}
            placeholder={TOPIC_PLACEHOLDER}
            className="min-h-[52px] resize-y rounded-[14px] border border-[#E5E4DE] bg-[#F7F6F2] px-4 py-3.5 text-[14px] text-[#1C1C1B] outline-none focus:border-[#639922] focus:ring-2 focus:ring-[#EAF3DE]"
          />
          {generationMode === "ip" && <input
            aria-label="本次切入角度"
            value={angle}
            onChange={event => setAngle(event.target.value)}
            placeholder="本次切入角度，例如：从创作者只追求更新频率切入"
            className="rounded-[12px] border border-[#E5E4DE] bg-white px-4 py-3 text-[13.5px] text-[#1C1C1B] outline-none focus:border-[#639922]"
          />}
          {generationMode === "ip" && (
            <div className="rounded-[14px] border border-[#E5E4DE] bg-white p-4">
              <div className="mb-2 text-[13px] font-bold text-[#1C1C1B]">案例补充（可选）</div>
              <p className="text-[12px] leading-5 text-[#777]">案例可以帮助讲清楚观点，但不会作为生成前的门槛。人工提供的案例仍会在生成后单独提示核验状态。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setCaseDecision("skip")} className={`rounded-[9px] px-3 py-2 text-[12px] font-semibold ${caseDecision === "skip" || caseDecision === null ? "bg-[#1C1C1B] text-white" : "bg-[#F2F1ED] text-[#555]"}`}>不使用案例</button>
                <button type="button" onClick={() => setCaseDecision("knowledge")} className={`rounded-[9px] px-3 py-2 text-[12px] font-semibold ${caseDecision === "knowledge" ? "bg-[#1C1C1B] text-white" : "bg-[#F2F1ED] text-[#555]"}`}>从知识库选择</button>
                <button type="button" onClick={() => setCaseDecision("manual")} className={`rounded-[9px] px-3 py-2 text-[12px] font-semibold ${caseDecision === "manual" ? "bg-[#1C1C1B] text-white" : "bg-[#F2F1ED] text-[#555]"}`}>人工补充案例</button>
              </div>
              {caseDecision === "knowledge" && (
                <div className="mt-3">
                  {caseCandidates.length > 0 ? (
                    <select aria-label="知识库案例" value={selectedCaseId} onChange={event => setSelectedCaseId(event.target.value)} className="w-full rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 text-[12.5px]">
                      <option value="">请选择案例</option>
                      {caseCandidates.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
                    </select>
                  ) : <p className="text-[12px] text-[#888]">当前知识库暂无案例，可改用人工补充。</p>}
                </div>
              )}
              {caseDecision === "manual" && (
                <div className="mt-3 grid gap-2">
                  <input aria-label="案例名称" value={manualCaseTitle} onChange={event => setManualCaseTitle(event.target.value)} placeholder="案例人物或事件" className="rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 text-[12.5px]" />
                  <textarea aria-label="案例内容" value={manualCaseContent} onChange={event => setManualCaseContent(event.target.value)} placeholder="只填写你能确认的事实。人工提供不代表已经核实。" className="min-h-[90px] rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 text-[12.5px]" />
                  <input aria-label="案例来源" value={manualCaseSource} onChange={event => { setManualCaseSource(event.target.value); setManualCaseVerified(false); }} placeholder="来源链接或明确出处（可选）" className="rounded-[10px] border border-[#E5E4DE] px-3 py-2.5 text-[12.5px]" />
                  <label className="flex items-start gap-2 rounded-[9px] bg-[#F7F6F2] px-3 py-2 text-[11.5px] leading-5 text-[#555]">
                    <input type="checkbox" checked={manualCaseVerified} onChange={event => setManualCaseVerified(event.target.checked)} className="mt-1" />
                    <span>我已人工核对该案例。此确认不代表系统已联网核验。</span>
                  </label>
                </div>
              )}
            </div>
          )}

          <KnowledgePanel loading={knowledgeLoading} refs={knowledgeRefs} searched={knowledgeSearched} />

          <div>
            <label className="mb-1.5 block text-[11.5px] font-semibold text-[#888]">内容形式</label>
            <div className="flex flex-wrap gap-2">
              {FORMAT_CATEGORIES.map(f => (
                <button
                  key={f.id} type="button" onClick={() => handleFormatChange(f.id)}
                  className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-all"
                  style={formatCategory === f.id ? { background: "#1C1C1B", color: "#fff" } : { background: "#F2F1ED", color: "#888" }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">时长</label>
              <Select
                value={String(duration)} onChange={(v) => setDuration(Number(v))}
                options={currentFormat.durations.map((d): SelectOption => ({ value: String(d.value), label: d.label }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">发布平台</label>
              <Select
                value={platform} onChange={setPlatform}
                options={toSelectOptions(activeIP?.platforms.length ? activeIP.platforms : PLATFORM_OPTIONS)}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">内容目标</label>
              <Select value={goal} onChange={setGoal} options={toSelectOptions(GOAL_OPTIONS)} />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-[#888]">内容类型</label>
              <Select value={videoType} onChange={setVideoType} options={toSelectOptions(VIDEO_TYPE_OPTIONS)} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {(formatCategory === "short" || formatCategory === "medium") && (
              <label className="flex items-center gap-2 text-[12.5px] text-[#555]">
                <input type="checkbox" checked={needsStoryboard} onChange={e => setNeedsStoryboard(e.target.checked)} />需要分镜脚本
              </label>
            )}
            <label className="flex items-center gap-2 text-[12.5px] text-[#555]">
              <input type="checkbox" checked={needsShootingTips} onChange={e => setNeedsShootingTips(e.target.checked)} />
              需要{formatCategory === "live" ? "直播间布置建议" : "拍摄/呈现建议"}
            </label>
            <button
              onClick={() => { void handleGenerate(); }} disabled={loading || isConstraintFinalizing || !topic.trim() || !activeIP || !isLinkedTopicBoundaryAllowed}
              className="ml-auto flex h-[42px] items-center gap-2 whitespace-nowrap rounded-[12px] bg-[#1C1C1B] px-7 text-[13.5px] font-semibold text-white disabled:opacity-60"
            >
              {loading ? "生成中…" : generationMode === "standard" ? "生成完整内容" : "生成IP专属内容"}
            </button>
      </div>

      {pendingBoundaryConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-label="认知覆盖不完整" aria-modal="true">
          <div className="w-full max-w-[460px] rounded-[18px] bg-white p-5 shadow-xl">
            <h2 className="text-[18px] font-bold text-[#1C1C1B]">认知覆盖不完整</h2>
            <p className="mt-2 text-[13px] leading-6 text-[#666]">当前选题只有部分认知支撑，AI可能会补充尚未被IP确认的细节。请确认已知风险后再继续。</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingBoundaryConfirmation(false)} className="rounded-[10px] border border-[#D8D7D1] px-4 py-2 text-[13px] font-semibold text-[#555]">取消</button>
              <button type="button" onClick={() => { void handleGenerate(true); }} className="rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[13px] font-semibold text-white">确认已知风险并生成</button>
            </div>
          </div>
        </div>
      )}
        </div>
      </Card>

      {error && <div className="mb-6 rounded-[14px] bg-[#FCEBEB] px-5 py-4 text-[14px] font-semibold text-[#A32D2D]">{error}</div>}
      {draftStorageError && (
        <div className="mb-6 rounded-[14px] border border-[#E8C96A] bg-[#FFF8DC] px-5 py-4 text-[13px] font-semibold text-[#755700]">
          {draftStorageError}
        </div>
      )}
      {pendingConstraintReview?.phase === "finalizing" && (
        <div className="mb-6 rounded-[14px] border border-[#E8C96A] bg-[#FFF8DC] px-5 py-4 text-[#755700]" role="alert">
          <div className="text-[13px] font-bold">脚本已保存，后续记录待补全</div>
          <p className="mt-1 text-[12px] leading-5">你已确认属于合理语境，脚本已经保存；知识使用记录尚未完成，请重试补全。</p>
          <button
            type="button"
            onClick={() => {
              try {
                pendingConstraintReview.persist();
              } catch (persistError) {
                setError(persistError instanceof Error ? persistError.message : "补全保存记录失败，请重试。");
              }
            }}
            className="mt-3 rounded-[9px] bg-[#1C1C1B] px-3 py-2 text-[12px] font-semibold text-white"
          >
            重试完成保存记录
          </button>
        </div>
      )}
      {loading && (
        <div className="py-16 text-center text-[#8A8A86]">
          <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-4 border-[#EAF3DE] border-t-[#639922]" />
          <div className="text-[14px]">正在代入「{activeIP?.name}」的人设生成「{currentFormat.label}」内容…</div>
        </div>
      )}

      {!loading && !result && !error && (
        <div className="py-16 text-center text-[#8A8A86]">
          <h3 className="mb-2 text-[17px] font-semibold text-[#1C1C1B]">还没有生成结果</h3>
          <p className="text-[13.5px]">{generationMode === "standard" ? "输入选题、设置内容形式和时长后，即可生成完整内容包。" : "输入选题或原文后即可直接生成；观点归属和事实核验会在生成后补充。"}</p>
        </div>
      )}

      {!loading && result && (
        <>
          <CitationSummary
            refs={knowledgeRefs}
            loading={knowledgeLoading}
            searched={knowledgeSearched}
            label="本次脚本生成参考了"
          />
          <Card>
            <SectionHead num="②">生成结果</SectionHead>
            {pendingConstraintReview?.phase === "awaiting_decision" && (
              <div className="mb-5 rounded-[12px] border border-[#E8C96A] bg-[#FFF8DC] p-4 text-[#755700]" role="alert">
                <div className="text-[13px] font-bold">疑似违反通用禁用规则，等待人工确认</div>
                <p className="mt-1 text-[12px] leading-5">关键词命中不等于已经违规。系统暂未进行语义裁决，当前结果尚未保存。</p>
                <p className="mt-1 text-[12px] leading-5">当前检测只能识别明确的高风险表达，可能存在遗漏，最终内容合规性仍需要你自己整体判断。</p>
                <ul className="mt-2 list-disc pl-5 text-[12px] leading-5">
                  {pendingConstraintReview.detection.matches.map((match, index) => (
                    <li key={`${match.ruleId}-${match.start}-${index}`}>
                      命中片段“{match.matchedText}”：{match.reason}
                      {match.sources?.length ? `（涉及${match.sources.join("、")}）` : ""}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        pendingConstraintReview.persist();
                      } catch (persistError) {
                        setError(persistError instanceof Error ? persistError.message : "人工确认后保存失败，请重试。");
                      }
                    }}
                    className="rounded-[9px] bg-[#1C1C1B] px-3 py-2 text-[12px] font-semibold text-white"
                  >
                    确认属于合理语境，继续保存
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingConstraintReview(null);
                      setResult(null);
                      void handleGenerate();
                    }}
                    className="rounded-[9px] border border-[#D8B94F] bg-white px-3 py-2 text-[12px] font-semibold text-[#755700]"
                  >
                    确认违规，重新生成
                  </button>
                </div>
              </div>
            )}
            <ResultView
              data={result}
              draftSavedAt={partialDraftSavedAt}
              onClearDraft={partialDraftSavedAt ? handleClearPartialDraft : undefined}
              onManualRewrite={handleManualRewrite}
              onConfirmPendingItem={handleConfirmFactPendingItem}
            />
          </Card>
        </>
      )} {/* !loading && result */}
      </>
    </div>
  );
}
