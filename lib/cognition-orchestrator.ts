"use client";

import { apiFetch } from "./api-fetch";
import {
  clearDraftCognitionBatch,
  loadDraftCognitionBatches,
  type DraftCognitionSessionRecord,
  type DraftSessionStorageLike,
  type DraftSourceMetadata,
} from "./cognition-draft-session-store";
import {
  addVerifiedIPOriginalSource,
  getIPOriginalSource,
} from "./ip-original-source";
import type { IPSourceAnalysisV2 } from "./types";

export type CognitionCommitProgress =
  | "READING_DRAFT"
  | "FINALIZING"
  | "PERSISTING"
  | "VERIFYING"
  | "CLEANING"
  | "COMPLETED"
  | "CLEANUP_PENDING";

export type CognitionCommitErrorCode = "READ_FAILED" | "DRAFT_NOT_FOUND";

export class CognitionCommitError extends Error {
  constructor(
    readonly code: CognitionCommitErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CognitionCommitError";
  }
}

interface VerifiedCognitionSnapshot {
  id: string;
  ipId: string | null;
  rawContent: string;
  sourceFinalProof?: string | null;
  sourceAnalysis?: IPSourceAnalysisV2 | null;
}

export interface CognitionCommitDependencies {
  finalize(record: DraftCognitionSessionRecord): Promise<{ finalProof: string }>;
  persistVerified(
    record: DraftCognitionSessionRecord,
    metadata: DraftSourceMetadata,
    finalProof: string,
  ): Promise<void>;
  readVerified(sourceId: string): Promise<VerifiedCognitionSnapshot | null>;
}

export interface CommitDraftCognitionBatchInput {
  storage: DraftSessionStorageLike | null;
  ipId: string;
  batchId: string;
  onProgress?: (status: CognitionCommitProgress) => void;
}

export type CommitDraftCognitionBatchResult =
  | { ok: true; status: "COMMITTED" }
  | { ok: true; status: "COMMITTED_CLEANUP_PENDING" };

function matchesDraft(
  verified: VerifiedCognitionSnapshot | null,
  draft: DraftCognitionSessionRecord,
  finalProof?: string,
): boolean {
  return Boolean(verified
    && verified.id === draft.analysis.sourceId
    && verified.ipId === draft.ipId
    && verified.rawContent === draft.rawContent
    && typeof verified.sourceFinalProof === "string"
    && verified.sourceFinalProof.trim()
    && (finalProof === undefined || verified.sourceFinalProof === finalProof)
    && JSON.stringify(verified.sourceAnalysis) === JSON.stringify(draft.analysis));
}

const defaultDependencies: CognitionCommitDependencies = {
  async finalize(record) {
    const response = await apiFetch("/api/ip-source-analysis/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activeIPId: record.ipId,
        sourceId: record.analysis.sourceId,
        rawContent: record.rawContent,
        analysis: record.analysis,
        analysisToken: record.analysisToken,
      }),
    });
    const result = await response.json() as {
      finalProof?: string;
      activeIPId?: string;
      sourceId?: string;
      nonce?: number;
      error?: string;
    };
    if (!response.ok || typeof result.finalProof !== "string" || !result.finalProof.trim()) {
      throw new Error(result.error ?? "最终入库校验失败");
    }
    if (result.activeIPId !== record.ipId
      || result.sourceId !== record.analysis.sourceId
      || result.nonce !== record.analysis.nonce) {
      throw new Error("最终入库响应与当前草稿不一致");
    }
    return { finalProof: result.finalProof };
  },
  async persistVerified(record, metadata, finalProof) {
    await addVerifiedIPOriginalSource({
      sourceId: record.analysis.sourceId,
      ipId: record.ipId,
      title: metadata.title,
      sourceKind: metadata.sourceKind,
      originalContent: record.rawContent,
      sourceName: metadata.sourceName,
      sourceUrl: metadata.sourceUrl,
      analysis: record.analysis,
      finalProof,
    });
  },
  async readVerified(sourceId) {
    const entry = getIPOriginalSource(sourceId);
    if (!entry || entry.sourceAnalysis?.parserVersion !== 2) return null;
    return {
      id: entry.id,
      ipId: entry.ipId,
      rawContent: entry.rawContent,
      sourceFinalProof: entry.sourceFinalProof,
      sourceAnalysis: entry.sourceAnalysis,
    };
  },
};

export async function commitDraftCognitionBatch(
  input: CommitDraftCognitionBatchInput,
  dependencies: CognitionCommitDependencies = defaultDependencies,
): Promise<CommitDraftCognitionBatchResult> {
  input.onProgress?.("READING_DRAFT");
  const loaded = loadDraftCognitionBatches(input.storage, input.ipId);
  if (loaded.errorCode === "READ_FAILED") {
    throw new CognitionCommitError("READ_FAILED", "认知草稿读取失败，请检查浏览器存储权限后重试");
  }
  const draft = loaded.records
    .find(record => record.batchId === input.batchId);
  if (!draft) {
    throw new CognitionCommitError("DRAFT_NOT_FOUND", "找不到当前IP的认知草稿批次");
  }

  const existing = await dependencies.readVerified(draft.analysis.sourceId);
  if (!existing) {
    input.onProgress?.("FINALIZING");
    const { finalProof } = await dependencies.finalize(draft);
    input.onProgress?.("PERSISTING");
    await dependencies.persistVerified(draft, draft.sourceMetadata, finalProof);
    input.onProgress?.("VERIFYING");
    const persisted = await dependencies.readVerified(draft.analysis.sourceId);
    if (!matchesDraft(persisted, draft, finalProof)) {
      throw new Error("正式认知写入后回读校验失败，草稿已保留");
    }
  } else if (!matchesDraft(existing, draft)) {
    throw new Error("同一Source已有不同的正式认知，草稿已保留");
  }

  input.onProgress?.("CLEANING");
  if (!clearDraftCognitionBatch(input.storage, draft)) {
    input.onProgress?.("CLEANUP_PENDING");
    return { ok: true, status: "COMMITTED_CLEANUP_PENDING" };
  }
  input.onProgress?.("COMPLETED");
  return { ok: true, status: "COMMITTED" };
}
