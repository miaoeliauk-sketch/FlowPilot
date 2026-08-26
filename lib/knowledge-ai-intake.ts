import {
  getAIExtractedKnowledgePersistenceState,
  getKnowledgeEntriesForFullLibraryComparison,
  runKnowledgeLibraryWriteTransaction,
  saveAIExtractedKnowledgeEntriesStrict,
  type AIExtractedKnowledgeStrictStorageItem,
} from "./ip-store";
import {
  runKnowledgeIntakePrecheck,
  type KnowledgeIntakePrecheckAssessment,
  type KnowledgeIntakePrecheckCandidate,
} from "./knowledge-intake-precheck";
import type { KnowledgeEntry } from "./types";

export interface AIExtractedKnowledgeSaveItem {
  candidate: KnowledgeIntakePrecheckCandidate;
  entry: Omit<KnowledgeEntry, "id" | "createdAt">;
  confirmation?: AIExtractedKnowledgeConfirmation;
}

export interface PrepareAIExtractedKnowledgeBatchInput {
  items: AIExtractedKnowledgeSaveItem[];
  ipNamesById?: Record<string, string>;
}

const preparedBatchMarker = Symbol("ai-extracted-knowledge-batch");
const inputFingerprintKey = Symbol("ai-extracted-knowledge-input-fingerprint");
const comparisonFingerprintKey = Symbol("ai-extracted-knowledge-comparison-fingerprint");
const assessmentsFingerprintKey = Symbol("ai-extracted-knowledge-assessments-fingerprint");
const confirmationMarker = Symbol("ai-extracted-knowledge-confirmation");
const confirmationFingerprintKey = Symbol("ai-extracted-knowledge-confirmation-fingerprint");
const issuedConfirmations = new WeakSet<object>();

export interface AIExtractedKnowledgeConfirmation {
  readonly confirmedAt: string;
  readonly [confirmationMarker]: true;
  readonly [confirmationFingerprintKey]: string;
}

export interface PreparedAIExtractedKnowledgeBatch {
  assessments: KnowledgeIntakePrecheckAssessment[];
  checkedAt: string;
  items: AIExtractedKnowledgeSaveItem[];
  ipNamesById: Record<string, string>;
  [preparedBatchMarker]: true;
  [inputFingerprintKey]: string;
  [comparisonFingerprintKey]: string;
  [assessmentsFingerprintKey]: string;
}

function normalizeSerializable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSerializable);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, normalizeSerializable(nested)]),
  );
}

function serialize(value: unknown): string {
  return JSON.stringify(normalizeSerializable(value));
}

function inputFingerprint(items: readonly AIExtractedKnowledgeSaveItem[]): string {
  return serialize(items.map(item => ({
    candidate: item.candidate,
    entry: item.entry,
  })));
}

function comparisonFingerprint(entries: readonly KnowledgeEntry[]): string {
  return serialize(entries.map(entry => ({
    id: entry.id,
    title: entry.title,
    category: entry.category,
    rawContent: entry.rawContent,
    keywords: entry.keywords,
    contentDirection: entry.contentDirection,
    ipId: entry.ipId,
    sourcePlatform: entry.sourcePlatform,
    sourceName: entry.sourceName,
    sourceUrl: entry.sourceUrl,
    note: entry.note,
    createdAt: entry.createdAt,
  })).sort((left, right) => left.id.localeCompare(right.id)));
}

export function fingerprintKnowledgeIntakeAssessment(
  assessment: KnowledgeIntakePrecheckAssessment,
): string {
  return serialize(assessment);
}

export function confirmAIExtractedKnowledgeAssessment(
  assessment: KnowledgeIntakePrecheckAssessment,
): AIExtractedKnowledgeConfirmation {
  const confirmation = Object.freeze({
    confirmedAt: new Date().toISOString(),
    [confirmationMarker]: true as const,
    [confirmationFingerprintKey]: fingerprintKnowledgeIntakeAssessment(assessment),
  });
  issuedConfirmations.add(confirmation);
  return confirmation;
}

export function isAIExtractedKnowledgeConfirmationValid(
  assessment: KnowledgeIntakePrecheckAssessment,
  confirmation: AIExtractedKnowledgeConfirmation | undefined,
): boolean {
  return Boolean(
    confirmation
    && issuedConfirmations.has(confirmation)
    && confirmation[confirmationMarker] === true
    && confirmation[confirmationFingerprintKey]
      === fingerprintKnowledgeIntakeAssessment(assessment)
    && !Number.isNaN(Date.parse(confirmation.confirmedAt)),
  );
}

function assessmentsFingerprint(
  assessments: readonly KnowledgeIntakePrecheckAssessment[],
): string {
  return serialize(assessments);
}

function parseNote(note: string): Record<string, unknown> {
  if (!note.trim()) return {};
  try {
    const parsed = JSON.parse(note) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function runCurrentCheck(
  items: readonly AIExtractedKnowledgeSaveItem[],
  ipNamesById: Record<string, string>,
) {
  const ownIdempotencyKeys = new Set(items.map(idempotencyKey));
  const existingEntries = getKnowledgeEntriesForFullLibraryComparison()
    .filter(entry => {
      const note = parseNote(entry.note);
      const precheck = note.intakePrecheck;
      if (!precheck || typeof precheck !== "object" || Array.isArray(precheck)) return true;
      const key = (precheck as Record<string, unknown>).idempotencyKey;
      return typeof key !== "string" || !ownIdempotencyKeys.has(key);
    });
  const assessments = runKnowledgeIntakePrecheck({
    candidates: items.map(item => item.candidate),
    existingEntries,
    ipNamesById,
  }).assessments;
  return { assessments, existingEntries };
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function idempotencyKey(item: AIExtractedKnowledgeSaveItem): string {
  const { extractedAt: _extractedAt, ...stableEntry } = item.entry;
  return `ai-intake:${item.candidate.id}:${stableHash(serialize({
    candidate: item.candidate,
    entry: stableEntry,
  }))}`;
}

export function prepareAIExtractedKnowledgeBatch(
  input: PrepareAIExtractedKnowledgeBatchInput,
): PreparedAIExtractedKnowledgeBatch {
  if (input.items.length === 0) throw new Error("至少需要一张AI提炼方法卡");
  const ipNamesById = input.ipNamesById ?? {};
  const { assessments, existingEntries } = runCurrentCheck(input.items, ipNamesById);
  return {
    assessments,
    checkedAt: new Date().toISOString(),
    items: input.items,
    ipNamesById,
    [preparedBatchMarker]: true,
    [inputFingerprintKey]: inputFingerprint(input.items),
    [comparisonFingerprintKey]: comparisonFingerprint(existingEntries),
    [assessmentsFingerprintKey]: assessmentsFingerprint(assessments),
  };
}

function buildStrictStorageItems(
  prepared: PreparedAIExtractedKnowledgeBatch,
  assessments: readonly KnowledgeIntakePrecheckAssessment[],
  checkedAt: string,
): AIExtractedKnowledgeStrictStorageItem[] {
  return prepared.items.map((item, index) => {
    const assessment = assessments[index];
    if (!assessment) throw new Error("AI提炼方法卡缺少全库检查结果，已拒绝保存");
    const hasSimilarEntries = assessment.similarEntries.length > 0;
    if (
      hasSimilarEntries
      && (
        !item.confirmation
        || !isAIExtractedKnowledgeConfirmationValid(assessment, item.confirmation)
      )
    ) {
      throw new Error(item.confirmation
        ? "相似内容确认凭证无效，请重新确认后再保存"
        : "检测到相似内容，请明确确认后再保存");
    }
    const note = parseNote(item.entry.note);
    const key = idempotencyKey(item);
    return {
      idempotencyKey: key,
      entry: {
        ...item.entry,
        note: JSON.stringify({
          ...note,
          intakePrecheck: {
            version: 1,
            comparisonScope: "full_library",
            decision: hasSimilarEntries ? "confirmed_continue" : "saved_without_similar_match",
            initialCheckedAt: prepared.checkedAt,
            checkedAt,
            confirmedAt: hasSimilarEntries ? item.confirmation?.confirmedAt ?? null : null,
            idempotencyKey: key,
            quality: assessment.quality,
            similarEntries: assessment.similarEntries,
          },
        }),
      },
    };
  });
}

export async function saveAIExtractedKnowledgeBatch(
  prepared: PreparedAIExtractedKnowledgeBatch,
  options: { isStillCurrent?: () => boolean } = {},
): Promise<KnowledgeEntry[]> {
  if (prepared[preparedBatchMarker] !== true) {
    throw new Error("AI提炼方法卡尚未完成本次全库检查，已拒绝保存");
  }
  if (prepared[inputFingerprintKey] !== inputFingerprint(prepared.items)) {
    throw new Error("AI提炼方法卡内容已变化，请重新检查并确认后再保存");
  }

  return runKnowledgeLibraryWriteTransaction(transaction => {
    if (options.isStillCurrent && !options.isStillCurrent()) {
      throw new Error("入库内容或决定已变化，本次保存已取消");
    }
    if (prepared[assessmentsFingerprintKey] !== assessmentsFingerprint(prepared.assessments)) {
      throw new Error("AI提炼方法卡检查结果已变化，请重新检查并确认后再保存");
    }
    const replayItems = buildStrictStorageItems(prepared, prepared.assessments, prepared.checkedAt);
    const persistenceState = getAIExtractedKnowledgePersistenceState(transaction, replayItems);
    if (persistenceState === "partial") {
      throw new Error("检测到AI方法卡批次仅部分落盘，已拒绝补齐；请先核对并修复异常数据");
    }
    if (persistenceState === "all") {
      return saveAIExtractedKnowledgeEntriesStrict(transaction, replayItems);
    }
    const { assessments, existingEntries } = runCurrentCheck(prepared.items, prepared.ipNamesById);
    const finalCheckedAt = new Date().toISOString();
    if (
      prepared[comparisonFingerprintKey] !== comparisonFingerprint(existingEntries)
      || prepared[assessmentsFingerprintKey] !== assessmentsFingerprint(assessments)
    ) {
      throw new Error("全库检查结果已变化，请重新检查并确认后再保存");
    }

    return saveAIExtractedKnowledgeEntriesStrict(
      transaction,
      buildStrictStorageItems(prepared, assessments, finalCheckedAt),
    );
  });
}
