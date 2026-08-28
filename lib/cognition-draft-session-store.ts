import { createDraftCognitionBatchId } from "./cognition-graph-bridge";
import { parseStoredIPSourceAnalysis } from "./ip-source-analysis-v2";
import { calculateSHA256 } from "./sha256";
import type { IPSourceAnalysisV2 } from "./types";

const STORAGE_KEY_PREFIX = "FP_COGNITION_DRAFT_V1:";

export interface DraftSessionStorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DraftCognitionSessionRecord {
  schemaVersion: 1;
  batchId: string;
  ipId: string;
  rawContent: string;
  analysis: IPSourceAnalysisV2;
  analysisToken: string;
}

export type SaveDraftCognitionBatchResult =
  | { ok: true; key: string }
  | { ok: false; code: "QUOTA_EXCEEDED" | "WRITE_FAILED" };

export type RemoveDraftCognitionBatchResult =
  | { ok: true; removedCount: number }
  | { ok: false; code: "READ_FAILED" | "WRITE_FAILED" };

export interface LoadDraftCognitionBatchesResult {
  records: DraftCognitionSessionRecord[];
  corruptedRecordCount: number;
  errorCode: "READ_FAILED" | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function draftStorageKey(record: DraftCognitionSessionRecord): string {
  const identity = JSON.stringify([
    record.ipId,
    record.analysis.sourceId,
    record.batchId,
  ]);
  return `${STORAGE_KEY_PREFIX}${calculateSHA256(identity)}`;
}

function parseDraftRecord(value: unknown): DraftCognitionSessionRecord | null {
  if (!isRecord(value)
    || value.schemaVersion !== 1
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
    schemaVersion: 1,
    batchId: value.batchId,
    ipId: value.ipId,
    rawContent: value.rawContent,
    analysis: parsed.analysis,
    analysisToken: value.analysisToken,
  };
}

function isQuotaExceeded(error: unknown): boolean {
  return isRecord(error) && error.name === "QuotaExceededError";
}

export function saveDraftCognitionBatch(
  storage: DraftSessionStorageLike | null,
  record: DraftCognitionSessionRecord,
): SaveDraftCognitionBatchResult {
  if (!storage) return { ok: false, code: "WRITE_FAILED" };
  const parsed = parseDraftRecord(record);
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
  if (!storage || !ipId.trim()) {
    return { records: [], corruptedRecordCount: 0, errorCode: null };
  }
  const records: DraftCognitionSessionRecord[] = [];
  let corruptedRecordCount = 0;

  try {
    const length = storage.length;
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(STORAGE_KEY_PREFIX)) continue;
      const raw = storage.getItem(key);
      if (raw === null) continue;
      let parsed: DraftCognitionSessionRecord | null;
      try {
        parsed = parseDraftRecord(JSON.parse(raw));
      } catch {
        corruptedRecordCount += 1;
        continue;
      }
      if (!parsed) {
        corruptedRecordCount += 1;
      } else if (key !== draftStorageKey(parsed)) {
        corruptedRecordCount += 1;
      } else if (parsed.ipId === ipId) {
        records.push(parsed);
      }
    }
  } catch {
    return { records: [], corruptedRecordCount: 0, errorCode: "READ_FAILED" };
  }

  return { records, corruptedRecordCount, errorCode: null };
}

export function removeDraftsByBatch(
  storage: DraftSessionStorageLike | null,
  ipId: string,
  batchId: string,
): RemoveDraftCognitionBatchResult {
  if (!storage) return { ok: false, code: "READ_FAILED" };
  if (!ipId.trim() || !batchId.trim()) return { ok: true, removedCount: 0 };

  let keyToRemove: string | null = null;
  try {
    const length = storage.length;
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(STORAGE_KEY_PREFIX)) continue;
      const raw = storage.getItem(key);
      if (raw === null) continue;
      let parsed: DraftCognitionSessionRecord | null;
      try {
        parsed = parseDraftRecord(JSON.parse(raw));
      } catch {
        continue;
      }
      if (!parsed || key !== draftStorageKey(parsed)) continue;
      if (parsed.ipId === ipId && parsed.batchId === batchId) {
        keyToRemove = key;
        break;
      }
    }
  } catch {
    return { ok: false, code: "READ_FAILED" };
  }

  if (!keyToRemove) return { ok: true, removedCount: 0 };
  try {
    storage.removeItem(keyToRemove);
    return { ok: true, removedCount: 1 };
  } catch {
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
      if (!key?.startsWith(STORAGE_KEY_PREFIX)) continue;
      const raw = storage.getItem(key);
      if (raw === null) continue;
      let parsed: DraftCognitionSessionRecord | null;
      try {
        parsed = parseDraftRecord(JSON.parse(raw));
      } catch {
        continue;
      }
      if (!parsed || key !== draftStorageKey(parsed)) continue;
      if (parsed.ipId === ipId) recordsToRemove.push({ key, raw });
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
  if (!storage?.removeItem) return false;
  const parsed = parseDraftRecord(record);
  if (!parsed) return false;
  const key = draftStorageKey(parsed);
  try {
    storage.removeItem(key);
    return storage.getItem(key) === null;
  } catch {
    return false;
  }
}
