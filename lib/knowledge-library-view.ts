import { getNormalizedCategory } from "./knowledge-categories";
import {
  buildKnowledgeEffectReference,
  createKnowledgeEffectReferenceIndex,
  deriveKnowledgeTrustStatus,
  type KnowledgeEffectReference,
} from "./knowledge-effect-reference";
import { filterKnowledgeVisibleToIP } from "./knowledge-scope";
import {
  getKnowledgeEntriesForLibraryView,
  getScriptAssetsReadOnly,
  getVideoReviewsReadOnly,
} from "./ip-store";
import type {
  KnowledgeEntry,
  KnowledgeTrustStatus,
  ScriptAsset,
  VideoReview,
} from "./types";

export type KnowledgeLibraryTrustStatus =
  | KnowledgeTrustStatus
  | "not_in_trust_system";

export type KnowledgeLibrarySourceKind =
  | "ip_original"
  | "hot_analysis_case"
  | "hot_analysis_method"
  | "reviewed_method"
  | "exact_template"
  | "review_experience"
  | "external_case"
  | "other"
  | "unknown";

export interface KnowledgeLibrarySource {
  kind: KnowledgeLibrarySourceKind;
  label: string;
  name: string | null;
  platform: string | null;
  url: string | null;
}

export interface KnowledgeLibraryRelatedKnowledge {
  id: string;
  title: string;
  category: string;
  role: "viral_case" | "method_card" | "reviewed_method" | "execution_template";
}

export interface KnowledgeLibraryOriginalSource {
  kind: KnowledgeLibrarySourceKind;
  content: string;
  sourceName: string | null;
  sourcePlatform: string | null;
  sourceUrl: string | null;
  analysisId: string | null;
  templateKey: string | null;
  templateVersion: string | null;
  reviewStatus: string | null;
}

export interface KnowledgeLibraryEffectEvidence {
  scriptId: string;
  scriptTitle: string;
  usedAt: string;
  sectionLabel: string | null;
  evidenceExcerpt: string | null;
  reviewId: string | null;
  reviewTitle: string | null;
  platform: string | null;
  publishedAt: string | null;
  videoUrl: string | null;
  metrics: VideoReview["metrics"] | null;
  manualReviewStatus: VideoReview["manualReviewStatus"] | null;
  manualReviewNote: string | null;
}

export interface KnowledgeLibraryLegacyUsage {
  id: string;
  usedAt: string;
  module: string;
  reason: string;
}

export interface KnowledgeLibraryDetail {
  originalSource: KnowledgeLibraryOriginalSource;
  effectEvidence: KnowledgeLibraryEffectEvidence[];
  legacyUnverifiedRecords: KnowledgeLibraryLegacyUsage[];
}

export interface KnowledgeLibraryItem {
  id: string;
  title: string;
  content: string;
  category: string;
  normalizedCategory: string;
  ipId: string | null;
  tags: string[];
  keywords: string[];
  trustStatus: KnowledgeLibraryTrustStatus;
  source: KnowledgeLibrarySource;
  relatedKnowledge: KnowledgeLibraryRelatedKnowledge[];
  effect: KnowledgeEffectReference;
  detail: KnowledgeLibraryDetail;
  entry: KnowledgeEntry;
}

export interface KnowledgeLibrarySnapshot {
  items: KnowledgeLibraryItem[];
}

export interface KnowledgeLibraryQuery {
  query?: string;
  categories?: readonly string[];
  trustStatuses?: readonly KnowledgeLibraryTrustStatus[];
  sourceKinds?: readonly KnowledgeLibrarySourceKind[];
}

const TRUST_STATUSES: ReadonlySet<KnowledgeTrustStatus> = new Set([
  "ai_derived_unverified",
  "adopted_awaiting_effect",
  "effect_evidence_awaiting_judgment",
  "human_confirmed_effective",
]);

function cleanOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function safeTrustStatus(value: unknown): KnowledgeLibraryTrustStatus {
  return typeof value === "string" && TRUST_STATUSES.has(value as KnowledgeTrustStatus)
    ? value as KnowledgeTrustStatus
    : "not_in_trust_system";
}

function hasTrustedExecutionTemplate(entry: KnowledgeEntry): boolean {
  const template = entry.executionTemplate;
  return Boolean(
    template &&
    cleanOptionalText(template.templateKey) &&
    cleanOptionalText(template.version) &&
    typeof template.contentHash === "string" &&
    /^[a-f0-9]{64}$/.test(template.contentHash)
  );
}

function isReviewedMethod(entry: KnowledgeEntry): boolean {
  return entry.sourcePlatform === "人工确认方法卡" &&
    cleanStringArray(entry.tags).includes("人工确认方法卡");
}

function describeSource(entry: KnowledgeEntry): KnowledgeLibrarySource {
  const sourceMember = trustedSourceGroupMember(entry);
  let kind: KnowledgeLibrarySourceKind;
  let label: string;

  if (hasTrustedExecutionTemplate(entry)) {
    kind = "exact_template";
    label = "原文保真执行模板";
  } else if (isReviewedMethod(entry)) {
    kind = "reviewed_method";
    label = "人工审核方法卡";
  } else if (sourceMember?.role === "method_card") {
    kind = "hot_analysis_method";
    label = "爆款分析拆解的方法卡";
  } else if (sourceMember?.role === "viral_case") {
    kind = "hot_analysis_case";
    label = "爆款分析收录的完整案例";
  } else if (entry.category === "IP原始内容") {
    kind = "ip_original";
    label = cleanOptionalText(entry.sourceKind) ?? "IP原始内容";
  } else if (entry.category === "复盘经验库") {
    kind = "review_experience";
    label = "人工复盘经验";
  } else if (entry.category === "爆款案例") {
    kind = "external_case";
    label = "外部爆款案例";
  } else if (
    cleanOptionalText(entry.sourceName) ||
    cleanOptionalText(entry.sourcePlatform) ||
    cleanOptionalText(entry.sourceUrl)
  ) {
    kind = "other";
    label = "其他已记录来源";
  } else {
    kind = "unknown";
    label = "未记录来源";
  }

  return {
    kind,
    label,
    name: cleanOptionalText(entry.sourceName),
    platform: cleanOptionalText(entry.sourcePlatform),
    url: cleanOptionalText(entry.sourceUrl),
  };
}

function buildKnowledgeLibraryDetail(
  entry: KnowledgeEntry,
  source: KnowledgeLibrarySource,
  effect: KnowledgeEffectReference,
): KnowledgeLibraryDetail {
  const sourceMember = trustedSourceGroupMember(entry);
  const template = hasTrustedExecutionTemplate(entry) ? entry.executionTemplate : null;
  const usageRecords = Array.isArray(entry.usageRecords) ? entry.usageRecords : [];
  return {
    originalSource: {
      kind: source.kind,
      content: typeof entry.rawContent === "string" ? entry.rawContent : "",
      sourceName: source.name,
      sourcePlatform: source.platform,
      sourceUrl: source.url,
      analysisId: sourceMember?.analysisId ?? null,
      templateKey: cleanOptionalText(template?.templateKey),
      templateVersion: cleanOptionalText(template?.version),
      reviewStatus: source.kind === "reviewed_method"
        ? "人工已审核，来源和效果仍待验证"
        : null,
    },
    effectEvidence: effect.scripts.map(({ script, usage, review }) => ({
      scriptId: script.id,
      scriptTitle: script.title,
      usedAt: usage.usedAt,
      sectionLabel: cleanOptionalText(usage.sectionLabel),
      evidenceExcerpt: cleanOptionalText(usage.evidenceExcerpt),
      reviewId: review?.id ?? null,
      reviewTitle: review ? cleanOptionalText(review.title) : null,
      platform: review ? cleanOptionalText(review.platform) : null,
      publishedAt: review ? cleanOptionalText(review.publishedAt) : null,
      videoUrl: review ? cleanOptionalText(review.videoUrl) : null,
      metrics: review?.metrics ?? null,
      manualReviewStatus: review?.manualReviewStatus ?? null,
      manualReviewNote: review ? cleanOptionalText(review.manualReviewNote) : null,
    })),
    legacyUnverifiedRecords: usageRecords
      .filter(usage =>
        Boolean(usage) &&
        typeof usage === "object" &&
        usage.trackingStatus === "legacy_unverified" &&
        typeof usage.id === "string" &&
        typeof usage.usedAt === "string" &&
        usage.usedAt.length > 0
      )
      .map(usage => ({
        id: usage.id,
        usedAt: usage.usedAt,
        module: typeof usage.module === "string" ? usage.module : "未记录模块",
        reason: typeof usage.reason === "string" ? usage.reason : "历史记录缺少说明",
      })),
  };
}

interface TrustedSourceGroupMember {
  entry: KnowledgeEntry;
  analysisId: string;
  role: "viral_case" | "method_card";
}

function trustedSourceGroupMember(entry: KnowledgeEntry): TrustedSourceGroupMember | null {
  const reference = entry.sourceReference;
  if (
    !reference ||
    reference.sourceType !== "hot_analysis" ||
    typeof reference.analysisId !== "string" ||
    !reference.analysisId.trim() ||
    typeof reference.groupItemId !== "string" ||
    !reference.groupItemId.trim() ||
    (reference.role !== "viral_case" && reference.role !== "method_card") ||
    ((reference.role === "viral_case") !== (entry.category === "爆款案例"))
  ) {
    return null;
  }
  return { entry, analysisId: reference.analysisId.trim(), role: reference.role };
}

function sourceGroupKey(entry: KnowledgeEntry, analysisId: string): string {
  return `${entry.ipId ?? "__global__"}\u0000${analysisId}`;
}

export function createKnowledgeLibrarySnapshot(input: {
  activeIPId: string | null;
  entries: readonly KnowledgeEntry[];
  scripts?: readonly ScriptAsset[];
  reviews?: readonly VideoReview[];
  retainedReviewIdByRemovedId?: ReadonlyMap<string, string>;
}): KnowledgeLibrarySnapshot {
  const visibleEntries = filterKnowledgeVisibleToIP(input.entries, input.activeIPId);
  const scopedScripts = input.activeIPId
    ? (input.scripts ?? []).filter(script => script.ipId === input.activeIPId)
    : [];
  const scopedReviews = input.activeIPId
    ? (input.reviews ?? []).filter(review => review.ipId === input.activeIPId)
    : [];
  const effectIndex = createKnowledgeEffectReferenceIndex(
    scopedScripts,
    scopedReviews,
    input.retainedReviewIdByRemovedId,
  );
  const sourceGroups = new Map<string, TrustedSourceGroupMember[]>();
  const exactTemplatesBySource = new Map<string, KnowledgeEntry[]>();
  const reviewedMethodsBySource = new Map<string, KnowledgeEntry[]>();
  for (const entry of visibleEntries) {
    const member = trustedSourceGroupMember(entry);
    if (!member) continue;
    const key = sourceGroupKey(entry, member.analysisId);
    sourceGroups.set(key, [...(sourceGroups.get(key) ?? []), member]);
  }
  for (const entry of visibleEntries) {
    const sourceName = cleanOptionalText(entry.sourceName);
    if (!sourceName) continue;
    const key = `${entry.ipId ?? "__global__"}\u0000${sourceName}`;
    if (hasTrustedExecutionTemplate(entry)) {
      exactTemplatesBySource.set(key, [...(exactTemplatesBySource.get(key) ?? []), entry]);
    } else if (isReviewedMethod(entry)) {
      reviewedMethodsBySource.set(key, [...(reviewedMethodsBySource.get(key) ?? []), entry]);
    }
  }

  return {
    items: visibleEntries.map(entry => {
      const sourceMember = trustedSourceGroupMember(entry);
      const sourceGroupRelations: KnowledgeLibraryRelatedKnowledge[] = sourceMember
        ? (sourceGroups.get(sourceGroupKey(entry, sourceMember.analysisId)) ?? [])
          .filter(member => member.entry.id !== entry.id && member.role !== sourceMember.role)
          .map(member => ({
            id: member.entry.id,
            title: member.entry.title,
            category: member.entry.category,
            role: member.role,
          }))
        : [];
      const sourceName = cleanOptionalText(entry.sourceName);
      const documentSourceKey = sourceName
        ? `${entry.ipId ?? "__global__"}\u0000${sourceName}`
        : null;
      const documentRelations: KnowledgeLibraryRelatedKnowledge[] = documentSourceKey && isReviewedMethod(entry)
        ? (exactTemplatesBySource.get(documentSourceKey) ?? []).map(related => ({
          id: related.id,
          title: related.title,
          category: related.category,
          role: "execution_template",
        }))
        : documentSourceKey && hasTrustedExecutionTemplate(entry)
          ? (reviewedMethodsBySource.get(documentSourceKey) ?? []).map(related => ({
            id: related.id,
            title: related.title,
            category: related.category,
            role: "reviewed_method",
          }))
          : [];
      const relatedKnowledge = [...sourceGroupRelations, ...documentRelations];
      const effect = buildKnowledgeEffectReference(entry, effectIndex);
      const derivedTrustStatus = deriveKnowledgeTrustStatus(entry, effectIndex);
      const tags = cleanStringArray(entry.tags);
      const source = describeSource(entry);
      return {
        id: entry.id,
        title: entry.title,
        content: typeof entry.rawContent === "string" ? entry.rawContent : "",
        category: entry.category,
        normalizedCategory: getNormalizedCategory({ ...entry, tags }),
        ipId: entry.ipId,
        tags,
        keywords: cleanStringArray(entry.keywords),
        trustStatus: safeTrustStatus(derivedTrustStatus),
        source,
        relatedKnowledge,
        effect,
        detail: buildKnowledgeLibraryDetail(entry, source, effect),
        entry,
      };
    }),
  };
}

export function queryKnowledgeLibrary(
  snapshot: KnowledgeLibrarySnapshot,
  query: KnowledgeLibraryQuery,
): KnowledgeLibraryItem[] {
  const categories = new Set(query.categories ?? []);
  const trustStatuses = new Set(query.trustStatuses ?? []);
  const sourceKinds = new Set(query.sourceKinds ?? []);
  const filtered = snapshot.items.filter(item =>
    (categories.size === 0 || categories.has(item.normalizedCategory)) &&
    (trustStatuses.size === 0 || trustStatuses.has(item.trustStatus)) &&
    (sourceKinds.size === 0 || sourceKinds.has(item.source.kind))
  );
  const searchText = query.query?.trim() ?? "";
  if (!searchText) return filtered;
  const normalizedQuery = searchText.toLocaleLowerCase();
  return filtered.filter(item => [
    item.title,
    item.content,
    item.category,
    item.normalizedCategory,
    ...item.tags,
    ...item.keywords,
    item.source.label,
    item.source.name ?? "",
    item.source.platform ?? "",
  ].some(value => value.toLocaleLowerCase().includes(normalizedQuery)));
}

export function loadKnowledgeLibrarySnapshot(
  activeIPId: string | null,
): KnowledgeLibrarySnapshot {
  if (!activeIPId) {
    return createKnowledgeLibrarySnapshot({
      activeIPId: null,
      entries: getKnowledgeEntriesForLibraryView(null),
    });
  }
  const reviewSnapshot = getVideoReviewsReadOnly(activeIPId);
  return createKnowledgeLibrarySnapshot({
    activeIPId,
    entries: getKnowledgeEntriesForLibraryView(activeIPId),
    scripts: getScriptAssetsReadOnly(activeIPId),
    reviews: reviewSnapshot.reviews,
    retainedReviewIdByRemovedId: reviewSnapshot.retainedReviewIdByRemovedId,
  });
}
