import { isTrustedKnowledgeUsageForScript } from "./knowledge-effect-contract";
import type {
  KnowledgeEntry,
  KnowledgeUsageRecord,
  ScriptAsset,
  VideoReview,
} from "./types";

export interface KnowledgeEffectScriptReference {
  script: ScriptAsset;
  usage: KnowledgeUsageRecord;
  review: VideoReview | null;
}

export interface KnowledgeEffectReference {
  adoptedScriptCount: number;
  reviewedScriptCount: number;
  awaitingReviewCount: number;
  legacyUnverifiedCount: number;
  scripts: KnowledgeEffectScriptReference[];
}

export interface KnowledgeEffectReferenceIndex {
  scriptById: ReadonlyMap<string, ScriptAsset>;
  reviewById: ReadonlyMap<string, VideoReview>;
  retainedReviewIdByRemovedId: ReadonlyMap<string, string>;
}

export function createKnowledgeEffectReferenceIndex(
  scripts: readonly ScriptAsset[],
  traceableReviews: readonly VideoReview[],
  retainedReviewIdByRemovedId: ReadonlyMap<string, string> = new Map(),
): KnowledgeEffectReferenceIndex {
  return {
    scriptById: new Map(scripts.map(script => [script.id, script])),
    reviewById: new Map(traceableReviews.map(review => [review.id, review])),
    retainedReviewIdByRemovedId,
  };
}

export function buildKnowledgeEffectReference(
  entry: KnowledgeEntry,
  index: KnowledgeEffectReferenceIndex,
): KnowledgeEffectReference {
  const trustedUsagesByScriptId = new Map<string, KnowledgeUsageRecord[]>();
  const usageRecords = (Array.isArray(entry.usageRecords) ? entry.usageRecords : [])
    .filter((usage): usage is KnowledgeUsageRecord =>
      Boolean(usage) &&
      typeof usage === "object" &&
      typeof usage.usedAt === "string" &&
      usage.usedAt.length > 0
    );

  for (const usage of usageRecords) {
    if (!usage.scriptId) continue;
    const script = index.scriptById.get(usage.scriptId);
    if (script && isTrustedKnowledgeUsageForScript(entry, usage, script)) {
      const usages = trustedUsagesByScriptId.get(script.id) ?? [];
      usages.push(usage);
      trustedUsagesByScriptId.set(script.id, usages);
    }
  }

  const scriptReferences = [...trustedUsagesByScriptId.entries()].map(
    ([scriptId, usages]) => {
      const script = index.scriptById.get(scriptId)!;
      for (const usage of usages) {
        const resolvedReviewId = usage.reviewId
          ? index.retainedReviewIdByRemovedId.get(usage.reviewId) ?? usage.reviewId
          : null;
        const review = resolvedReviewId
          ? index.reviewById.get(resolvedReviewId) ?? null
          : null;
        if (
          review &&
          review.sourceType === "flowpilot" &&
          review.traceabilityStatus === "traceable" &&
          review.ipId === script.ipId &&
          review.scriptId === script.id &&
          review.topicId === script.topicId
        ) {
          return { script, usage, review };
        }
      }
      const latestUsage = usages.reduce((latest, usage) =>
        usage.usedAt.localeCompare(latest.usedAt) > 0 ? usage : latest
      );
      return { script, usage: latestUsage, review: null };
    },
  );
  const reviewedScriptCount = scriptReferences.filter(item => item.review).length;

  return {
    adoptedScriptCount: scriptReferences.length,
    reviewedScriptCount,
    awaitingReviewCount: scriptReferences.length - reviewedScriptCount,
    legacyUnverifiedCount: usageRecords.filter(
      usage => usage.trackingStatus === "legacy_unverified",
    ).length,
    scripts: scriptReferences,
  };
}
