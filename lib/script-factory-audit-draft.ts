const STORAGE_KEY = "ipwr:scriptAuditDrafts:v1";

export interface ScriptAuditDraft<T = unknown> {
  version: 1;
  ipId: string;
  auditSessionId: string | null;
  auditVersion: string | null;
  promotionStatus: "PENDING" | "PROMOTED";
  promotedAssetId: string | null;
  savedAt: string;
  result: T;
}

function readDrafts(storage: Storage): ScriptAuditDraft[] {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ScriptAuditDraft => Boolean(
      item
      && typeof item === "object"
      && !Array.isArray(item)
      && (item as ScriptAuditDraft).version === 1
      && typeof (item as ScriptAuditDraft).ipId === "string"
      && ((item as ScriptAuditDraft).promotionStatus === "PENDING"
        || (item as ScriptAuditDraft).promotionStatus === "PROMOTED")
      && typeof (item as ScriptAuditDraft).savedAt === "string",
    ));
  } catch {
    return [];
  }
}

function writeDrafts(storage: Storage, drafts: ScriptAuditDraft[]): boolean {
  const serialized = JSON.stringify(drafts);
  try {
    storage.setItem(STORAGE_KEY, serialized);
    return storage.getItem(STORAGE_KEY) === serialized;
  } catch {
    return false;
  }
}

export function saveScriptAuditDraft<T>(storage: Storage, input: {
  ipId: string;
  auditSessionId?: string;
  auditVersion?: string;
  result: T;
}): boolean {
  const drafts = readDrafts(storage).filter(draft => draft.ipId !== input.ipId);
  drafts.push({
    version: 1,
    ipId: input.ipId,
    auditSessionId: input.auditSessionId ?? null,
    auditVersion: input.auditVersion ?? null,
    promotionStatus: "PENDING",
    promotedAssetId: null,
    savedAt: new Date().toISOString(),
    result: input.result,
  });
  return writeDrafts(storage, drafts);
}

export function getPendingScriptAuditDraft<T = unknown>(storage: Storage, ipId: string): ScriptAuditDraft<T> | null {
  const draft = readDrafts(storage).find(item => item.ipId === ipId && item.promotionStatus === "PENDING");
  return draft ? draft as ScriptAuditDraft<T> : null;
}

export function markScriptAuditDraftPromoted(
  storage: Storage,
  ipId: string,
  auditSessionId: string,
  promotedAssetId: string,
): boolean {
  const drafts = readDrafts(storage);
  const draft = drafts.find(item => item.ipId === ipId && item.auditSessionId === auditSessionId);
  if (!draft) return false;
  draft.promotionStatus = "PROMOTED";
  draft.promotedAssetId = promotedAssetId;
  return writeDrafts(storage, drafts);
}

export type PromoteScriptAuditDraftResult =
  | { ok: true; code: "PROMOTED"; formalAssetId: string }
  | { ok: false; code: "PENDING_DRAFT_NOT_FOUND" }
  | { ok: false; code: "PENDING_DRAFT_VERSION_MISMATCH" }
  | { ok: false; code: "FORMAL_WRITE_NOT_VERIFIED" }
  | { ok: false; code: "COMMITTED_CLEANUP_PENDING"; formalAssetId: string };

export interface ScriptAuditFormalAssetReference {
  id: string;
  auditSessionId: string;
  auditVersion: string;
}

export function promoteScriptAuditDraft(storage: Storage, input: {
  ipId: string;
  auditSessionId: string;
  auditVersion: string;
  findExistingAsset: () => ScriptAuditFormalAssetReference | null;
  createFormalAsset: () => string;
  verifyFormalAsset: (assetId: string) => boolean;
}): PromoteScriptAuditDraftResult {
  const pendingDraft = getPendingScriptAuditDraft(storage, input.ipId);
  if (!pendingDraft || pendingDraft.auditSessionId !== input.auditSessionId) {
    return { ok: false, code: "PENDING_DRAFT_NOT_FOUND" };
  }
  if (pendingDraft.auditVersion !== input.auditVersion) {
    return { ok: false, code: "PENDING_DRAFT_VERSION_MISMATCH" };
  }
  const existingAsset = input.findExistingAsset();
  const formalAssetId = existingAsset
    && existingAsset.auditSessionId === input.auditSessionId
    && existingAsset.auditVersion === input.auditVersion
    ? existingAsset.id
    : input.createFormalAsset();
  if (!input.verifyFormalAsset(formalAssetId)) {
    return { ok: false, code: "FORMAL_WRITE_NOT_VERIFIED" };
  }
  if (!markScriptAuditDraftPromoted(storage, input.ipId, input.auditSessionId, formalAssetId)) {
    return { ok: false, code: "COMMITTED_CLEANUP_PENDING", formalAssetId };
  }
  return { ok: true, code: "PROMOTED", formalAssetId };
}
