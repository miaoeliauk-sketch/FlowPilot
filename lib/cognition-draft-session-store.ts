import { createDraftCognitionBatchId } from "./cognition-graph-bridge";
import { parseStoredIPSourceAnalysis } from "./ip-source-analysis-v2";
import { calculateSHA256 } from "./sha256";
import type { IPOriginalSourceKind, IPSourceAnalysisV2 } from "./types";

const STORAGE_KEY_PREFIX_V1 = "FP_COGNITION_DRAFT_V1:";
const STORAGE_KEY_PREFIX_V2 = "FP_COGNITION_DRAFT_V2:";

export interface DraftSessionStorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DraftSourceMetadata {
  title: string;
  sourceKind: IPOriginalSourceKind;
  sourceName: string;
  sourceUrl: string;
}

interface DraftCognitionSessionFields {
  batchId: string;
  ipId: string;
  rawContent: string;
  analysis: IPSourceAnalysisV2;
  analysisToken: string;
}

export interface DraftCognitionSessionRecord extends DraftCognitionSessionFields {
  schemaVersion: 2;
  sourceMetadata: DraftSourceMetadata;
}

export interface LegacyDraftCognitionSessionRecord extends DraftCognitionSessionFields {
  schemaVersion: 1;
  sourceMetadata: DraftSourceMetadata | null;
}

export interface MetadataRequiredDraft {
  status: "metadata_required";
  record: LegacyDraftCognitionSessionRecord;
}

export type SaveDraftCognitionBatchResult =
  | { ok: true; key: string }
  | { ok: false; code: "QUOTA_EXCEEDED" | "WRITE_FAILED" };

export type UpdateDraftSourceMetadataResult =
  | { ok: true; key: string }
  | {
      ok: false;
      code:
        | "READ_FAILED"
        | "DRAFT_NOT_FOUND"
        | "INVALID_METADATA"
        | "QUOTA_EXCEEDED"
        | "WRITE_FAILED";
    };

export type RemoveDraftCognitionBatchResult =
  | { ok: true; removedCount: number }
  | { ok: false; code: "READ_FAILED" | "WRITE_FAILED" };

export interface LoadDraftCognitionBatchesResult {
  records: DraftCognitionSessionRecord[];
  metadataRequiredRecords: MetadataRequiredDraft[];
  corruptedRecordCount: number;
  errorCode: "READ_FAILED" | null;
}

type StoredDraftRecord = DraftCognitionSessionRecord | LegacyDraftCognitionSessionRecord;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SOURCE_KINDS = new Set<IPOriginalSourceKind>([
  "直播逐字稿",
  "课程内容",
  "文章",
  "语音整理",
  "其他",
]);

function parseSourceMetadata(value: unknown): DraftSourceMetadata | null {
  if (!isRecord(value)
    || typeof value.title !== "string" || !value.title.trim() || value.title.trim().length > 200
    || typeof value.sourceKind !== "string"
    || !SOURCE_KINDS.has(value.sourceKind as IPOriginalSourceKind)
    || typeof value.sourceName !== "string" || value.sourceName.length > 500
    || typeof value.sourceUrl !== "string" || value.sourceUrl.length > 2_048) {
    return null;
  }
  return {
    title: value.title.trim(),
    sourceKind: value.sourceKind as IPOriginalSourceKind,
    sourceName: value.sourceName,
    sourceUrl: value.sourceUrl,
  };
}

function parseDraftFields(value: unknown): DraftCognitionSessionFields | null {
  if (!isRecord(value)
    || typeof value.batchId !== "string" || !value.batchId.startsWith("draft-")
    || typeof value.ipId !== "string" || !value.ipId.trim()
    || typeof value.rawContent !== "string" || !value.rawContent.trim()
    || typeof value.analysisToken !== "string" || !value.analysisToken.trim()) {
    return null;
  }

  const parsed = parseStoredIPSourceAnalysis(
    value.analysis,
    value.rawContent,
    isRecord(value.analysis) && typeof value.analysis.sourceId === "string"
      ? value.analysis.sourceId
      : "",
  );
  if (!parsed.ok || parsed.version !== 2) return null;
  if (parsed.analysis.sourceHash !== calculateSHA256(value.rawContent)) return null;

  const expectedBatchId = createDraftCognitionBatchId({
    ipId: value.ipId,
    sourceId: parsed.analysis.sourceId,
    sourceHash: parsed.analysis.sourceHash,
    analyzedAt: parsed.analysis.analyzedAt,
  });
  if (value.batchId !== expectedBatchId) return null;

  return {
    batchId: value.batchId,
    ipId: value.ipId,
    rawContent: value.rawContent,
    analysis: parsed.analysis,
    analysisToken: value.analysisToken,
  };
}

function parseV2DraftRecord(value: unknown): DraftCognitionSessionRecord | null {
  if (!isRecord(value) || value.schemaVersion !== 2) return null;
  const fields = parseDraftFields(value);
  const sourceMetadata = parseSourceMetadata(value.sourceMetadata);
  if (!fields || !sourceMetadata) return null;
  return { schemaVersion: 2, ...fields, sourceMetadata };
}

function parseV1DraftRecord(value: unknown): LegacyDraftCognitionSessionRecord | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const fields = parseDraftFields(value);
  if (!fields) return null;
  return {
    schemaVersion: 1,
    ...fields,
    sourceMetadata: parseSourceMetadata(value.sourceMetadata),
  };
}

function storagePrefixFor(record: StoredDraftRecord): string {
  return record.schemaVersion === 2 ? STORAGE_KEY_PREFIX_V2 : STORAGE_KEY_PREFIX_V1;
}

function draftStorageKey(record: StoredDraftRecord): string {
  const identity = JSON.stringify([
    record.ipId,
    record.analysis.sourceId,
    record.batchId,
  ]);
  return `${storagePrefixFor(record)}${calculateSHA256(identity)}`;
}

function parseStoredDraft(key: string, raw: string): StoredDraftRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = key.startsWith(STORAGE_KEY_PREFIX_V2)
    ? parseV2DraftRecord(value)
    : key.startsWith(STORAGE_KEY_PREFIX_V1)
      ? parseV1DraftRecord(value)
      : null;
  return parsed && key === draftStorageKey(parsed) ? parsed : null;
}

function isDraftStorageKey(key: string | null): key is string {
  return Boolean(key?.startsWith(STORAGE_KEY_PREFIX_V1)
    || key?.startsWith(STORAGE_KEY_PREFIX_V2));
}

function emptyLoadResult(): LoadDraftCognitionBatchesResult {
  return {
    records: [],
    metadataRequiredRecords: [],
    corruptedRecordCount: 0,
    errorCode: null,
  };
}

interface LocatedDraftVersions {
  legacy: { key: string; record: LegacyDraftCognitionSessionRecord } | null;
  current: { key: string; record: DraftCognitionSessionRecord } | null;
}

function locateDraftVersions(
  storage: DraftSessionStorageLike,
  ipId: string,
  batchId: string,
): LocatedDraftVersions | null {
  const located: LocatedDraftVersions = { legacy: null, current: null };
  try {
    const length = storage.length;
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (!isDraftStorageKey(key)) continue;
      const raw = storage.getItem(key);
      if (raw === null) continue;
      const parsed = parseStoredDraft(key, raw);
      if (parsed?.ipId !== ipId || parsed.batchId !== batchId) continue;
      if (parsed.schemaVersion === 2) {
        located.current = { key, record: parsed };
      } else {
        located.legacy = { key, record: parsed };
      }
    }
    return located;
  } catch {
    return null;
  }
}

function isQuotaExceeded(error: unknown): boolean {
  return isRecord(error) && error.name === "QuotaExceededError";
}

export function saveDraftCognitionBatch(
  storage: DraftSessionStorageLike | null,
  record: DraftCognitionSessionRecord,
): SaveDraftCognitionBatchResult {
  if (!storage) return { ok: false, code: "WRITE_FAILED" };
  const parsed = parseV2DraftRecord(record);
  if (!parsed) return { ok: false, code: "WRITE_FAILED" };
  const key = draftStorageKey(parsed);
  try {
    storage.setItem(key, JSON.stringify(parsed));
    return { ok: true, key };
  } catch (error) {
    return {
      ok: false,
      code: isQuotaExceeded(error) ? "QUOTA_EXCEEDED" : "WRITE_FAILED",
    };
  }
}

export function loadDraftCognitionBatches(
  storage: DraftSessionStorageLike | null,
  ipId: string,
): LoadDraftCognitionBatchesResult {
  if (!storage || !ipId.trim()) return emptyLoadResult();
  const readyByBatch = new Map<string, DraftCognitionSessionRecord>();
  const legacyByBatch = new Map<string, MetadataRequiredDraft>();
  let corruptedRecordCount = 0;

  try {
    const length = storage.length;
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (!isDraftStorageKey(key)) continue;
      const raw = storage.getItem(key);
      if (raw === null) continue;
      const parsed = parseStoredDraft(key, raw);
      if (!parsed) {
        corruptedRecordCount += 1;
      } else if (parsed.ipId === ipId && parsed.schemaVersion === 2) {
        readyByBatch.set(parsed.batchId, parsed);
        legacyByBatch.delete(parsed.batchId);
      } else if (parsed.ipId === ipId
        && parsed.schemaVersion === 1
        && !readyByBatch.has(parsed.batchId)) {
        legacyByBatch.set(parsed.batchId, {
          status: "metadata_required",
          record: parsed,
        });
      }
    }
  } catch {
    return { ...emptyLoadResult(), errorCode: "READ_FAILED" };
  }

  return {
    records: [...readyByBatch.values()],
    metadataRequiredRecords: [...legacyByBatch.values()],
    corruptedRecordCount,
    errorCode: null,
  };
}

export function updateDraftSourceMetadata(
  storage: DraftSessionStorageLike | null,
  ipId: string,
  batchId: string,
  metadata: DraftSourceMetadata,
): UpdateDraftSourceMetadataResult {
  const sourceMetadata = parseSourceMetadata(metadata);
  if (!sourceMetadata) return { ok: false, code: "INVALID_METADATA" };
  if (!storage) return { ok: false, code: "READ_FAILED" };

  const loaded = loadDraftCognitionBatches(storage, ipId);
  if (loaded.errorCode) return { ok: false, code: "READ_FAILED" };
  const draft = loaded.records.find(record => record.batchId === batchId);
  if (!draft) return { ok: false, code: "DRAFT_NOT_FOUND" };

  const saved = saveDraftCognitionBatch(storage, {
    ...draft,
    sourceMetadata,
  });
  if (!saved.ok) return saved;
  return saved;
}

export function removeDraftsByBatch(
  storage: DraftSessionStorageLike | null,
  ipId: string,
  batchId: string,
): RemoveDraftCognitionBatchResult {
  if (!storage) return { ok: false, code: "READ_FAILED" };
  if (!ipId.trim() || !batchId.trim()) return { ok: true, removedCount: 0 };

  const recordsToRemove: Array<{ key: string; raw: string }> = [];
  try {
    const length = storage.length;
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (!isDraftStorageKey(key)) continue;
      const raw = storage.getItem(key);
      if (raw === null) continue;
      const parsed = parseStoredDraft(key, raw);
      if (parsed?.ipId === ipId && parsed.batchId === batchId) {
        recordsToRemove.push({ key, raw });
      }
    }
  } catch {
    return { ok: false, code: "READ_FAILED" };
  }

  const removedRecords: Array<{ key: string; raw: string }> = [];
  try {
    recordsToRemove.forEach((record) => {
      storage.removeItem(record.key);
      removedRecords.push(record);
    });
    return { ok: true, removedCount: recordsToRemove.length };
  } catch {
    removedRecords.forEach((record) => {
      try {
        storage.setItem(record.key, record.raw);
      } catch {
        // 最佳努力回滚；仍以写入失败向调用方报告。
      }
    });
    return { ok: false, code: "WRITE_FAILED" };
  }
}

export function clearAllDraftsForIP(
  storage: DraftSessionStorageLike | null,
  ipId: string,
): RemoveDraftCognitionBatchResult {
  if (!storage) return { ok: false, code: "READ_FAILED" };
  if (!ipId.trim()) return { ok: true, removedCount: 0 };

  const recordsToRemove: Array<{ key: string; raw: string }> = [];
  try {
    const length = storage.length;
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (!isDraftStorageKey(key)) continue;
      const raw = storage.getItem(key);
      if (raw === null) continue;
      const parsed = parseStoredDraft(key, raw);
      if (parsed?.ipId === ipId) recordsToRemove.push({ key, raw });
    }
  } catch {
    return { ok: false, code: "READ_FAILED" };
  }

  const removedRecords: Array<{ key: string; raw: string }> = [];
  try {
    recordsToRemove.forEach((record) => {
      storage.removeItem(record.key);
      removedRecords.push(record);
    });
    return { ok: true, removedCount: recordsToRemove.length };
  } catch {
    removedRecords.forEach((record) => {
      try {
        storage.setItem(record.key, record.raw);
      } catch {
        // 最佳努力回滚；仍以写入失败向调用方报告。
      }
    });
    return { ok: false, code: "WRITE_FAILED" };
  }
}

export function clearDraftCognitionBatch(
  storage: DraftSessionStorageLike | null,
  record: DraftCognitionSessionRecord,
): boolean {
  if (!storage) return false;
  const parsed = parseV2DraftRecord(record);
  if (!parsed) return false;
  const key = draftStorageKey(parsed);
  try {
    storage.removeItem(key);
    return storage.getItem(key) === null;
  } catch {
    return false;
  }
}
