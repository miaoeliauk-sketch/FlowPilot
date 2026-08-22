import {
  addVideoReview,
  getKnowledgeEntries,
  getScriptAssets,
  getTopicAsset,
  getVideoReviews,
} from "./ip-store";
import type { KnowledgeEntry, VideoReview } from "./types";
import { isTrustedKnowledgeUsageForScript } from "./knowledge-effect-contract";

type ReviewPayload = Omit<
  VideoReview,
  | "id"
  | "ipId"
  | "topicId"
  | "scriptId"
  | "sourceType"
  | "traceabilityStatus"
  | "knowledgeEffectStatus"
  | "createdAt"
  | "savedToKnowledge"
  | "knowledgeEntryId"
>;

export type VideoReviewSourceSelection =
  | { type: "flowpilot"; scriptId: string }
  | { type: "external" };

interface AddVideoReviewForSourceInput {
  activeIPId: string;
  source: VideoReviewSourceSelection;
  review: ReviewPayload;
}

type NewVideoReview = VideoReview & (
  | { sourceType: "flowpilot"; traceabilityStatus: "traceable" }
  | { sourceType: "external"; traceabilityStatus: "external_untraceable" }
);

export type VideoReviewTraceabilityStatus = NonNullable<
  VideoReview["traceabilityStatus"]
>;

export class VideoReviewSourceInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoReviewSourceInvalidError";
  }
}

export const VIDEO_REVIEW_TRACEABILITY_LABELS: Record<
  VideoReviewTraceabilityStatus,
  string
> = {
  traceable: "可追溯",
  external_untraceable: "外部内容不可追溯",
  legacy_missing_link: "历史记录关联缺失",
  broken_link: "关联损坏",
};

export function assessVideoReviewTraceability(
  review: VideoReview,
): VideoReviewTraceabilityStatus {
  if (!review.sourceType && !review.traceabilityStatus) {
    return "legacy_missing_link";
  }
  if (review.sourceType === "external") {
    return review.traceabilityStatus === "external_untraceable" &&
      review.topicId === null &&
      review.scriptId === null
      ? "external_untraceable"
      : "broken_link";
  }
  if (
    review.sourceType !== "flowpilot" ||
    review.traceabilityStatus !== "traceable" ||
    !review.ipId ||
    !review.scriptId ||
    !review.topicId
  ) {
    return "broken_link";
  }

  const script = getScriptAssets(review.ipId)
    .find(item => item.id === review.scriptId);
  const topic = getTopicAsset(review.topicId);
  return script &&
    topic &&
    script.ipId === review.ipId &&
    topic.ipId === review.ipId &&
    script.topicId === topic.id
    ? "traceable"
    : "broken_link";
}

export function getLearningEligibleVideoReviews(ipId: string): VideoReview[] {
  return getVideoReviews(ipId).filter(
    review => assessVideoReviewTraceability(review) === "traceable",
  );
}

type ReviewKnowledgeSummary = Pick<KnowledgeEntry, "id" | "title" | "category">;

export type VideoReviewKnowledgeEffect =
  | {
      status: "tracked";
      knowledgeEntries: ReviewKnowledgeSummary[];
    }
  | {
      status: "tracked_status_pending";
      knowledgeEntries: ReviewKnowledgeSummary[];
    }
  | {
      status: "not_counted";
      knowledgeEntries: [];
      reason:
        | "source_untraceable"
        | "no_linked_knowledge"
        | "knowledge_unavailable";
    };

export function getVideoReviewKnowledgeEffect(
  review: VideoReview,
): VideoReviewKnowledgeEffect {
  if (assessVideoReviewTraceability(review) !== "traceable") {
    return {
      status: "not_counted",
      knowledgeEntries: [],
      reason: "source_untraceable",
    };
  }
  const script = getScriptAssets(review.ipId!)
    .find(item => item.id === review.scriptId);
  if (!script) {
    return {
      status: "not_counted",
      knowledgeEntries: [],
      reason: "source_untraceable",
    };
  }
  let knowledgeEntries: ReviewKnowledgeSummary[];
  try {
    knowledgeEntries = getKnowledgeEntries()
      .filter(entry =>
        entry.usageRecords.some(record =>
          record.reviewId === review.id &&
          isTrustedKnowledgeUsageForScript(entry, record, script)
        )
      )
      .map(entry => ({
        id: entry.id,
        title: entry.title,
        category: entry.category,
      }));
  } catch {
    return {
      status: "not_counted",
      knowledgeEntries: [],
      reason: "knowledge_unavailable",
    };
  }
  if (knowledgeEntries.length > 0) {
    return {
      status: review.knowledgeEffectStatus === "tracked"
        ? "tracked"
        : "tracked_status_pending",
      knowledgeEntries,
    };
  }
  return review.knowledgeEffectStatus === "knowledge_unavailable" ||
    review.knowledgeEffectStatus === "tracked_status_pending"
    ? {
        status: "not_counted",
        knowledgeEntries: [],
        reason: "knowledge_unavailable",
      }
    : {
        status: "not_counted",
        knowledgeEntries: [],
        reason: "no_linked_knowledge",
      };
}

type ResolvedVideoReviewSource =
  | {
    ipId: string;
    topicId: string;
    scriptId: string;
    sourceType: "flowpilot";
    traceabilityStatus: "traceable";
  }
  | {
    ipId: string;
    topicId: null;
    scriptId: null;
    sourceType: "external";
    traceabilityStatus: "external_untraceable";
  };

export function resolveVideoReviewSource(input: {
  activeIPId: string;
  source: VideoReviewSourceSelection;
}): ResolvedVideoReviewSource {
  const activeIPId = input.activeIPId.trim();
  if (!activeIPId) throw new Error("当前操盘IP缺少有效ID");
  if (input.source.type === "external") {
    return {
      ipId: activeIPId,
      topicId: null,
      scriptId: null,
      sourceType: "external",
      traceabilityStatus: "external_untraceable",
    };
  }

  const scriptId = input.source.scriptId.trim();
  const script = getScriptAssets(activeIPId).find(item => item.id === scriptId);
  if (!script) throw new VideoReviewSourceInvalidError("没有找到属于当前IP的脚本");
  if (!script.topicId?.trim()) throw new VideoReviewSourceInvalidError("该脚本没有关联选题，不能建立可追溯复盘");

  const topic = getTopicAsset(script.topicId);
  if (!topic) throw new VideoReviewSourceInvalidError("脚本关联的选题不存在，不能建立可追溯复盘");
  if (topic.ipId !== activeIPId || script.ipId !== activeIPId) {
    throw new VideoReviewSourceInvalidError("选题、脚本与当前IP不一致，已拒绝保存复盘");
  }
  return {
    ipId: activeIPId,
    topicId: topic.id,
    scriptId: script.id,
    sourceType: "flowpilot",
    traceabilityStatus: "traceable",
  };
}

export function addVideoReviewForSource(
  input: AddVideoReviewForSourceInput,
): NewVideoReview {
  const source = resolveVideoReviewSource(input);
  return addVideoReview({
    ...input.review,
    ...source,
  }) as NewVideoReview;
}
