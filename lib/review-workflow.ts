import type { ManualReviewStatus, ManualReviewTag, VideoReview } from "./types";

export const MANUAL_REVIEW_TAGS: readonly ManualReviewTag[] = [
  "选题角度新颖",
  "引用具体案例或经典原文",
  "标题结构有效",
  "表达风格贴合IP",
  "蹭中热点或时事",
  "发布时间平台选得好",
  "其他",
];
const MANUAL_REVIEW_TAG_SET: ReadonlySet<string> = new Set(MANUAL_REVIEW_TAGS);
const MANUAL_REVIEW_STATUS_SET: ReadonlySet<string> = new Set([
  "pending",
  "deferred",
  "completed",
  "legacy_needs_manual_review",
]);

export interface ManualReviewFields {
  manualReviewStatus: ManualReviewStatus;
  manualReviewTags: ManualReviewTag[];
  manualReviewNote: string;
  updatedAt: string;
}

export interface CompleteManualReviewInput {
  tags: ManualReviewTag[];
  note: string;
}

export function createPendingManualReviewFields(now: string): ManualReviewFields {
  return {
    manualReviewStatus: "pending",
    manualReviewTags: [],
    manualReviewNote: "",
    updatedAt: now,
  };
}

export function migrateManualReviewFields(review: VideoReview): VideoReview {
  const status = MANUAL_REVIEW_STATUS_SET.has(review.manualReviewStatus)
    ? review.manualReviewStatus
    : "legacy_needs_manual_review";
  const tags = Array.isArray(review.manualReviewTags)
    ? [...new Set(review.manualReviewTags.filter(tag =>
        typeof tag === "string" && MANUAL_REVIEW_TAG_SET.has(tag)
      ))]
    : [];
  const note = typeof review.manualReviewNote === "string"
    ? review.manualReviewNote.trim()
    : "";
  const completedIsValid = status === "completed" && tags.length > 0 && note.length > 0;
  return {
    ...review,
    manualReviewStatus: completedIsValid
      ? "completed"
      : status === "completed"
        ? "legacy_needs_manual_review"
        : status,
    manualReviewTags: completedIsValid ? tags : [],
    manualReviewNote: completedIsValid ? note : "",
    updatedAt: typeof review.updatedAt === "string" && review.updatedAt
      ? review.updatedAt
      : review.createdAt,
  };
}

export function transitionManualReviewStatus(
  review: VideoReview,
  targetStatus: "pending" | "deferred",
  now: string,
): VideoReview {
  if (
    targetStatus === "deferred" && review.manualReviewStatus !== "pending" ||
    targetStatus === "pending" && review.manualReviewStatus !== "deferred"
  ) {
    throw new Error("当前复盘状态不允许执行该操作");
  }
  return {
    ...review,
    manualReviewStatus: targetStatus,
    manualReviewTags: [],
    manualReviewNote: "",
    updatedAt: now,
  };
}

export function completeManualReview(
  review: VideoReview,
  input: CompleteManualReviewInput,
  now: string,
): VideoReview {
  if (review.manualReviewStatus === "deferred") {
    throw new Error("暂不复盘的内容请先恢复为待复盘");
  }
  if (!Array.isArray(input.tags) || input.tags.some(tag =>
    typeof tag !== "string" || !MANUAL_REVIEW_TAG_SET.has(tag)
  )) {
    throw new Error("人工复盘标签无效");
  }
  if (typeof input.note !== "string") throw new Error("人工复盘文字说明不能为空");
  const note = input.note.trim();
  if (!note) throw new Error("人工复盘文字说明不能为空");
  const meaningfulCharacters = note.match(/[\p{L}\p{N}]/gu) ?? [];
  if (
    meaningfulCharacters.length === 0 ||
    meaningfulCharacters.every(character => character === meaningfulCharacters[0])
  ) {
    throw new Error("请填写有实际内容的复盘说明");
  }
  if (input.tags.length === 0) throw new Error("至少选择一个复盘标签");
  return {
    ...review,
    manualReviewStatus: "completed",
    manualReviewTags: [...new Set(input.tags)],
    manualReviewNote: note,
    updatedAt: now,
  };
}
