import { CONTENT_PURPOSES, type ContentPurpose } from "./content-purpose";

export const CONTENT_TRACKS = [
  "财经商业",
  "职场成长",
  "情感关系",
  "知识科普",
  "生活方式",
  "本地生活",
  "健康养生",
  "教育亲子",
  "科技数码",
  "其他",
] as const;

export type ContentTrack = typeof CONTENT_TRACKS[number];
export type ContentIPFitTier = "高度匹配" | "中度匹配" | "低度匹配";

export interface ContentAdaptationProfile {
  primaryTrack: ContentTrack;
  secondaryTrack: ContentTrack | null;
  fineTags: string[];
  targetAudience: string;
  audienceTags: string[];
  primaryPurpose: ContentPurpose;
  secondaryPurpose: ContentPurpose | null;
  reasons: {
    track: string;
    audience: string;
    purpose: string;
  };
}

export interface ContentIPFitAssessment {
  tier: ContentIPFitTier;
  reason: string;
}

export interface EditableContentAdaptationProfile {
  primaryTrack: ContentTrack | null;
  secondaryTrack: ContentTrack | null;
  fineTags: string[];
  targetAudience: string | null;
  audienceTags: string[];
  primaryPurpose: ContentPurpose | null;
  secondaryPurpose: ContentPurpose | null;
  reasons: {
    track: string | null;
    audience: string | null;
    purpose: string | null;
  };
}

export interface ContentAdaptationAssessment {
  key: string;
  contentProfile: ContentAdaptationProfile;
  ipFit: ContentIPFitAssessment | null;
}

export interface ContentAdaptationSnapshot {
  contentProfile: EditableContentAdaptationProfile;
  ipFit: ContentIPFitAssessment | null;
}

export interface ContentAdaptationAIOriginalSnapshot {
  contentProfile: ContentAdaptationProfile;
  ipFit: ContentIPFitAssessment | null;
}

export type ContentAdaptationReviewStatus =
  | "ai_prefill"
  | "human_confirmed"
  | "human_modified"
  | "human_removed";

export type ContentAdaptationIPFitStatus =
  | "current"
  | "needs_refresh"
  | "not_applicable";

export interface ContentAdaptationRevision {
  action: "confirm" | "modify" | "remove" | "refresh_ip_fit";
  changedAt: string;
  before: ContentAdaptationSnapshot | null;
  after: ContentAdaptationSnapshot | null;
}

export interface ContentAdaptationRecord {
  key: string;
  aiOriginal: ContentAdaptationAIOriginalSnapshot;
  current: ContentAdaptationSnapshot | null;
  reviewStatus: ContentAdaptationReviewStatus;
  ipFitStatus: ContentAdaptationIPFitStatus;
  generatedAt: string;
  updatedAt: string;
  revisions: ContentAdaptationRevision[];
}

export type ContentAdaptationReviewAction =
  | { type: "confirm" }
  | { type: "modify"; contentProfile: EditableContentAdaptationProfile }
  | { type: "remove" }
  | { type: "refresh_ip_fit"; ipFit: ContentIPFitAssessment | null };

export type RestoredContentAdaptationRecord =
  | { status: "missing"; record: null }
  | { status: "invalid"; record: null }
  | { status: "valid"; record: ContentAdaptationRecord };

export type ContentAdaptationContractErrorCode =
  | "INVALID_JSON"
  | "INVALID_ROOT"
  | "INVALID_FIELD"
  | "BATCH_MISMATCH";

export class ContentAdaptationContractError extends Error {
  readonly code: ContentAdaptationContractErrorCode;
  readonly field: string;
  readonly diagnosticCode: string;

  constructor(
    code: ContentAdaptationContractErrorCode,
    field: string,
    message: string,
  ) {
    super(message);
    this.name = "ContentAdaptationContractError";
    this.code = code;
    this.field = field;
    this.diagnosticCode = code;
  }
}

type ContractObject = Record<string, unknown>;

function contractFail(
  field: string,
  message: string,
  code: ContentAdaptationContractErrorCode = "INVALID_FIELD",
): never {
  throw new ContentAdaptationContractError(code, field, message);
}

function contractObject(value: unknown, field: string): ContractObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    contractFail(field, `${field}必须是对象`);
  }
  return value as ContractObject;
}

function contractString(
  value: unknown,
  field: string,
  maxLength = 240,
): string {
  if (typeof value !== "string") contractFail(field, `${field}必须是字符串`);
  const normalized = value.trim();
  if (!normalized) contractFail(field, `${field}不能为空`);
  if (normalized.length > maxLength) contractFail(field, `${field}内容过长`);
  return normalized;
}

function contractStringArray(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    contractFail(field, `${field}必须包含${minimum}至${maximum}项`);
  }
  const normalized = value.map((item, index) =>
    contractString(item, `${field}[${index}]`, 40));
  if (new Set(normalized).size !== normalized.length) {
    contractFail(field, `${field}不能包含重复项`);
  }
  return normalized;
}

function contractNullableString(
  value: unknown,
  field: string,
  maxLength = 240,
): string | null {
  if (value === null) return null;
  return contractString(value, field, maxLength);
}

function contractEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  message: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    contractFail(field, message);
  }
  return value as T;
}

function parseContentProfile(value: unknown, field: string): ContentAdaptationProfile {
  const object = contractObject(value, field);
  const primaryTrack = contractEnum(
    object.primaryTrack,
    CONTENT_TRACKS,
    `${field}.primaryTrack`,
    `${field}.primaryTrack必须来自固定一级赛道`,
  );
  const secondaryTrack = object.secondaryTrack === null
    ? null
    : contractEnum(
      object.secondaryTrack,
      CONTENT_TRACKS,
      `${field}.secondaryTrack`,
      `${field}.secondaryTrack必须来自固定一级赛道或为null`,
    );
  if (secondaryTrack === primaryTrack) {
    contractFail(`${field}.secondaryTrack`, `${field}.secondaryTrack不能与主要赛道重复`);
  }

  const primaryPurpose = contractEnum(
    object.primaryPurpose,
    CONTENT_PURPOSES,
    `${field}.primaryPurpose`,
    `${field}.primaryPurpose必须来自固定内容目的`,
  );
  const secondaryPurpose = object.secondaryPurpose === null
    ? null
    : contractEnum(
      object.secondaryPurpose,
      CONTENT_PURPOSES,
      `${field}.secondaryPurpose`,
      `${field}.secondaryPurpose必须来自固定内容目的或为null`,
    );
  if (secondaryPurpose === primaryPurpose) {
    contractFail(`${field}.secondaryPurpose`, `${field}.secondaryPurpose不能与主要目的重复`);
  }

  const reasons = contractObject(object.reasons, `${field}.reasons`);
  return {
    primaryTrack,
    secondaryTrack,
    fineTags: contractStringArray(object.fineTags, `${field}.fineTags`, 2, 3),
    targetAudience: contractString(object.targetAudience, `${field}.targetAudience`),
    audienceTags: contractStringArray(object.audienceTags, `${field}.audienceTags`, 2, 3),
    primaryPurpose,
    secondaryPurpose,
    reasons: {
      track: contractString(reasons.track, `${field}.reasons.track`),
      audience: contractString(reasons.audience, `${field}.reasons.audience`),
      purpose: contractString(reasons.purpose, `${field}.reasons.purpose`),
    },
  };
}

function parseEditableContentProfile(
  value: unknown,
  field: string,
): EditableContentAdaptationProfile {
  const object = contractObject(value, field);
  const primaryTrack = object.primaryTrack === null
    ? null
    : contractEnum(
      object.primaryTrack,
      CONTENT_TRACKS,
      `${field}.primaryTrack`,
      `${field}.primaryTrack必须来自固定一级赛道或为null`,
    );
  const secondaryTrack = object.secondaryTrack === null
    ? null
    : contractEnum(
      object.secondaryTrack,
      CONTENT_TRACKS,
      `${field}.secondaryTrack`,
      `${field}.secondaryTrack必须来自固定一级赛道或为null`,
    );
  if ((!primaryTrack && secondaryTrack) || (secondaryTrack !== null && secondaryTrack === primaryTrack)) {
    contractFail(`${field}.secondaryTrack`, `${field}.secondaryTrack与主要赛道不一致`);
  }
  const primaryPurpose = object.primaryPurpose === null
    ? null
    : contractEnum(
      object.primaryPurpose,
      CONTENT_PURPOSES,
      `${field}.primaryPurpose`,
      `${field}.primaryPurpose必须来自固定内容目的或为null`,
    );
  const secondaryPurpose = object.secondaryPurpose === null
    ? null
    : contractEnum(
      object.secondaryPurpose,
      CONTENT_PURPOSES,
      `${field}.secondaryPurpose`,
      `${field}.secondaryPurpose必须来自固定内容目的或为null`,
    );
  if (
    (!primaryPurpose && secondaryPurpose)
    || (secondaryPurpose !== null && secondaryPurpose === primaryPurpose)
  ) {
    contractFail(`${field}.secondaryPurpose`, `${field}.secondaryPurpose与主要目的不一致`);
  }
  const targetAudience = contractNullableString(
    object.targetAudience,
    `${field}.targetAudience`,
  );
  const reasons = contractObject(object.reasons, `${field}.reasons`);
  const parsedReasons = {
    track: contractNullableString(reasons.track, `${field}.reasons.track`),
    audience: contractNullableString(reasons.audience, `${field}.reasons.audience`),
    purpose: contractNullableString(reasons.purpose, `${field}.reasons.purpose`),
  };
  if (!primaryTrack && parsedReasons.track) {
    contractFail(`${field}.reasons.track`, "主要赛道已删除时不能保留赛道判断依据");
  }
  if (!targetAudience && parsedReasons.audience) {
    contractFail(`${field}.reasons.audience`, "目标人群已删除时不能保留人群判断依据");
  }
  if (!primaryPurpose && parsedReasons.purpose) {
    contractFail(`${field}.reasons.purpose`, "主要目的已删除时不能保留目的判断依据");
  }
  return {
    primaryTrack,
    secondaryTrack,
    fineTags: contractStringArray(object.fineTags, `${field}.fineTags`, 0, 3),
    targetAudience,
    audienceTags: contractStringArray(object.audienceTags, `${field}.audienceTags`, 0, 3),
    primaryPurpose,
    secondaryPurpose,
    reasons: parsedReasons,
  };
}

function parseIPFit(
  value: unknown,
  field: string,
  hasIPContext: boolean,
): ContentIPFitAssessment | null {
  if (!hasIPContext) {
    if (value !== null) contractFail(field, `${field}在没有当前IP时必须为null`);
    return null;
  }
  if (value === null) contractFail(field, `${field}在有当前IP时不能为空`);
  const object = contractObject(value, field);
  return {
    tier: contractEnum(
      object.tier,
      ["高度匹配", "中度匹配", "低度匹配"] as const,
      `${field}.tier`,
      `${field}.tier不是合法匹配档位`,
    ),
    reason: contractString(object.reason, `${field}.reason`),
  };
}

function cloneEditableProfile(
  profile: EditableContentAdaptationProfile,
): EditableContentAdaptationProfile {
  return {
    ...profile,
    fineTags: [...profile.fineTags],
    audienceTags: [...profile.audienceTags],
    reasons: { ...profile.reasons },
  };
}

function cloneAIProfile(profile: ContentAdaptationProfile): ContentAdaptationProfile {
  return cloneEditableProfile(profile) as ContentAdaptationProfile;
}

function cloneIPFit(ipFit: ContentIPFitAssessment | null): ContentIPFitAssessment | null {
  return ipFit ? { ...ipFit } : null;
}

function cloneSnapshot(snapshot: ContentAdaptationSnapshot | null): ContentAdaptationSnapshot | null {
  if (!snapshot) return null;
  return {
    contentProfile: cloneEditableProfile(snapshot.contentProfile),
    ipFit: cloneIPFit(snapshot.ipFit),
  };
}

function cloneAIOriginalSnapshot(
  snapshot: ContentAdaptationAIOriginalSnapshot,
): ContentAdaptationAIOriginalSnapshot {
  return {
    contentProfile: cloneAIProfile(snapshot.contentProfile),
    ipFit: cloneIPFit(snapshot.ipFit),
  };
}

function cloneRevision(revision: ContentAdaptationRevision): ContentAdaptationRevision {
  return {
    ...revision,
    before: cloneSnapshot(revision.before),
    after: cloneSnapshot(revision.after),
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.values(value).forEach(nested => deepFreeze(nested));
  return Object.freeze(value);
}

function contractTimestamp(value: string, field: string): string {
  if (!value || Number.isNaN(Date.parse(value))) {
    contractFail(field, `${field}必须是有效时间`);
  }
  return value;
}

export function createContentAdaptationRecord(
  assessment: ContentAdaptationAssessment,
  generatedAt: string,
): ContentAdaptationRecord {
  const timestamp = contractTimestamp(generatedAt, "generatedAt");
  const key = contractString(assessment.key, "assessment.key", 80);
  const aiOriginal = cloneAIOriginalSnapshot({
    contentProfile: parseContentProfile(
      assessment.contentProfile,
      "assessment.contentProfile",
    ),
    ipFit: parseIPFit(
      assessment.ipFit,
      "assessment.ipFit",
      assessment.ipFit !== null,
    ),
  });
  return deepFreeze({
    key,
    aiOriginal,
    current: cloneSnapshot(aiOriginal),
    reviewStatus: "ai_prefill",
    ipFitStatus: assessment.ipFit ? "current" : "not_applicable",
    generatedAt: timestamp,
    updatedAt: timestamp,
    revisions: [],
  });
}

export function applyContentAdaptationReview(
  record: ContentAdaptationRecord,
  action: ContentAdaptationReviewAction,
  changedAt: string,
): ContentAdaptationRecord {
  const timestamp = contractTimestamp(changedAt, "changedAt");
  const previousUpdatedAt = contractTimestamp(record.updatedAt, "record.updatedAt");
  if (Date.parse(timestamp) < Date.parse(previousUpdatedAt)) {
    contractFail("changedAt", "changedAt不能早于上一版本更新时间");
  }
  const previous = cloneSnapshot(record.current);
  let current = cloneSnapshot(record.current);
  let reviewStatus: ContentAdaptationReviewStatus;
  let ipFitStatus = record.ipFitStatus;

  if (action.type === "confirm") {
    if (!current) contractFail("current", "已移除的适配判断不能直接确认");
    reviewStatus = "human_confirmed";
  } else if (action.type === "modify") {
    if (!current) contractFail("current", "已移除的适配判断不能直接修改");
    current = {
      contentProfile: parseEditableContentProfile(action.contentProfile, "contentProfile"),
      ipFit: cloneIPFit(current.ipFit),
    };
    reviewStatus = "human_modified";
    ipFitStatus = current.ipFit ? "needs_refresh" : "not_applicable";
  } else if (action.type === "remove") {
    current = null;
    reviewStatus = "human_removed";
    ipFitStatus = "not_applicable";
  } else {
    if (!current) contractFail("current", "已移除的适配判断不能重算IP匹配");
    const ipFit = parseIPFit(action.ipFit, "ipFit", action.ipFit !== null);
    current = {
      contentProfile: cloneEditableProfile(current.contentProfile),
      ipFit,
    };
    reviewStatus = record.reviewStatus;
    ipFitStatus = ipFit ? "current" : "not_applicable";
  }

  const revision: ContentAdaptationRevision = {
    action: action.type,
    changedAt: timestamp,
    before: previous,
    after: cloneSnapshot(current),
  };
  return deepFreeze({
    key: record.key,
    aiOriginal: cloneAIOriginalSnapshot(record.aiOriginal),
    current,
    reviewStatus,
    ipFitStatus,
    generatedAt: record.generatedAt,
    updatedAt: timestamp,
    revisions: [...record.revisions.map(cloneRevision), revision],
  });
}

function parseStoredSnapshot(value: unknown, field: string): ContentAdaptationSnapshot {
  const object = contractObject(value, field);
  return {
    contentProfile: parseEditableContentProfile(object.contentProfile, `${field}.contentProfile`),
    ipFit: parseIPFit(object.ipFit, `${field}.ipFit`, object.ipFit !== null),
  };
}

function parseStoredAIOriginalSnapshot(
  value: unknown,
  field: string,
): ContentAdaptationAIOriginalSnapshot {
  const object = contractObject(value, field);
  return {
    contentProfile: parseContentProfile(object.contentProfile, `${field}.contentProfile`),
    ipFit: parseIPFit(object.ipFit, `${field}.ipFit`, object.ipFit !== null),
  };
}

function snapshotsEqual(
  left: ContentAdaptationSnapshot | null,
  right: ContentAdaptationSnapshot | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function restoreContentAdaptationRecord(
  value: unknown,
): RestoredContentAdaptationRecord {
  if (value === undefined || value === null) {
    return { status: "missing", record: null };
  }
  try {
    const object = contractObject(value, "record");
    const key = contractString(object.key, "record.key", 80);
    const aiOriginal = parseStoredAIOriginalSnapshot(object.aiOriginal, "record.aiOriginal");
    const current = object.current === null
      ? null
      : parseStoredSnapshot(object.current, "record.current");
    const reviewStatus = contractEnum(
      object.reviewStatus,
      ["ai_prefill", "human_confirmed", "human_modified", "human_removed"] as const,
      "record.reviewStatus",
      "record.reviewStatus不合法",
    );
    const ipFitStatus = contractEnum(
      object.ipFitStatus,
      ["current", "needs_refresh", "not_applicable"] as const,
      "record.ipFitStatus",
      "record.ipFitStatus不合法",
    );
    const generatedAt = contractTimestamp(
      contractString(object.generatedAt, "record.generatedAt"),
      "record.generatedAt",
    );
    const updatedAt = contractTimestamp(
      contractString(object.updatedAt, "record.updatedAt"),
      "record.updatedAt",
    );
    if (Date.parse(updatedAt) < Date.parse(generatedAt)) {
      contractFail("record.updatedAt", "record.updatedAt不能早于生成时间");
    }
    if (!Array.isArray(object.revisions)) {
      contractFail("record.revisions", "record.revisions必须是数组");
    }
    let expectedBefore: ContentAdaptationSnapshot | null = aiOriginal;
    let previousChangedAt = generatedAt;
    const revisions = object.revisions.map((rawRevision, index) => {
      const field = `record.revisions[${index}]`;
      const revisionObject = contractObject(rawRevision, field);
      const action = contractEnum(
        revisionObject.action,
        ["confirm", "modify", "remove", "refresh_ip_fit"] as const,
        `${field}.action`,
        `${field}.action不合法`,
      );
      const changedAt = contractTimestamp(
        contractString(revisionObject.changedAt, `${field}.changedAt`),
        `${field}.changedAt`,
      );
      if (Date.parse(changedAt) < Date.parse(previousChangedAt)) {
        contractFail(`${field}.changedAt`, `${field}.changedAt时间顺序不合法`);
      }
      const before = revisionObject.before === null
        ? null
        : parseStoredSnapshot(revisionObject.before, `${field}.before`);
      const after = revisionObject.after === null
        ? null
        : parseStoredSnapshot(revisionObject.after, `${field}.after`);
      if (!snapshotsEqual(before, expectedBefore)) {
        contractFail(`${field}.before`, `${field}.before与上一版本不一致`);
      }
      if (
        (action === "confirm" && (!before || !after || !snapshotsEqual(before, after)))
        || (action === "modify" && (!before || !after))
        || (action === "remove" && (!before || after !== null))
        || (action === "refresh_ip_fit" && (
          !before
          || !after
          || JSON.stringify(before.contentProfile) !== JSON.stringify(after.contentProfile)
        ))
      ) {
        contractFail(field, `${field}与操作类型不一致`);
      }
      expectedBefore = after;
      previousChangedAt = changedAt;
      return { action, changedAt, before, after };
    });

    const lastRevision = revisions[revisions.length - 1];
    const expectedStatus = revisions.reduce<ContentAdaptationReviewStatus>(
      (status, revision) => revision.action === "confirm"
        ? "human_confirmed"
        : revision.action === "modify"
          ? "human_modified"
          : revision.action === "remove"
            ? "human_removed"
            : status,
      "ai_prefill",
    );
    if (reviewStatus !== expectedStatus || !snapshotsEqual(current, expectedBefore)) {
      contractFail("record.reviewStatus", "审核状态、当前结果与修改历史不一致");
    }
    if (updatedAt !== (lastRevision?.changedAt ?? generatedAt)) {
      contractFail("record.updatedAt", "更新时间与修改历史不一致");
    }
    if (
      (!current && ipFitStatus !== "not_applicable")
      || (current && !current.ipFit && ipFitStatus !== "not_applicable")
      || (current?.ipFit && ipFitStatus === "not_applicable")
    ) {
      contractFail("record.ipFitStatus", "IP匹配状态与当前结果不一致");
    }

    return {
      status: "valid",
      record: deepFreeze({
        key,
        aiOriginal,
        current,
        reviewStatus,
        ipFitStatus,
        generatedAt,
        updatedAt,
        revisions,
      }),
    };
  } catch {
    return { status: "invalid", record: null };
  }
}

export function parseContentAdaptationBatchResponse(
  content: string,
  expectedKeys: readonly string[],
  hasIPContext: boolean,
): ContentAdaptationAssessment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    contractFail("root", "AI返回不是合法JSON", "INVALID_JSON");
  }
  const root = contractObject(parsed, "root");
  if (!Array.isArray(root.items)) {
    contractFail("items", "items必须是数组", "INVALID_ROOT");
  }
  if (
    expectedKeys.length === 0
    || new Set(expectedKeys).size !== expectedKeys.length
    || root.items.length !== expectedKeys.length
  ) {
    contractFail("items", "AI返回条目与请求批次不一致", "BATCH_MISMATCH");
  }

  const expectedKeySet = new Set(expectedKeys);
  const parsedByKey = new Map<string, ContentAdaptationAssessment>();
  root.items.forEach((rawItem, index) => {
    const field = `items[${index}]`;
    const object = contractObject(rawItem, field);
    const key = contractString(object.key, `${field}.key`, 80);
    if (!expectedKeySet.has(key) || parsedByKey.has(key)) {
      contractFail("items", "AI返回了未知或重复的条目编号", "BATCH_MISMATCH");
    }
    parsedByKey.set(key, {
      key,
      contentProfile: parseContentProfile(object.contentProfile, `${field}.contentProfile`),
      ipFit: parseIPFit(object.ipFit, `${field}.ipFit`, hasIPContext),
    });
  });

  return expectedKeys.map((key) => {
    const item = parsedByKey.get(key);
    if (!item) contractFail("items", "AI缺少请求中的条目", "BATCH_MISMATCH");
    return item;
  });
}
