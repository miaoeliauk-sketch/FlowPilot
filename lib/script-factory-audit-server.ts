import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ScriptDeliveryGate,
  ScriptFactAudit,
  ScriptFactPendingItem,
  ScriptFactResolutionStatus,
  ScriptSourceIntegrityAudit,
} from "./script-factory-contract";

interface AuditResolutionResponse {
  status: "resolved";
  auditSessionId: string;
  auditVersion: string;
  pendingItem: ScriptFactPendingItem;
  deliveryGate: ScriptDeliveryGate;
}

interface ResolutionRecord {
  idempotencyKey: string;
  requestHash: string;
  response: AuditResolutionResponse;
}

interface AuditSessionRecord {
  auditSessionId: string;
  auditVersion: string;
  generationEvidenceDigest: string;
  factAudit: ScriptFactAudit;
  sourceIntegrityAudit: ScriptSourceIntegrityAudit;
  deliveryGate: ScriptDeliveryGate;
  resolutions: ResolutionRecord[];
}

interface AuditLedger {
  schemaVersion: 1;
  sessions: AuditSessionRecord[];
}

type RuntimeGlobal = typeof globalThis & {
  __flowpilotScriptAuditLedgerQueue?: Promise<unknown>;
};

export class ScriptAuditServerError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ScriptAuditServerError";
  }
}

function ledgerFile(): string {
  return process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE
    ?? path.join(process.cwd(), "data", "script-factory-audit-ledger.json");
}

async function loadLedger(): Promise<AuditLedger> {
  try {
    const parsed = JSON.parse(await readFile(ledgerFile(), "utf8")) as AuditLedger;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.sessions)) throw new Error("invalid ledger");
    return parsed;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { schemaVersion: 1, sessions: [] };
    }
    throw new ScriptAuditServerError("审计会话账本读取失败", "AUDIT_LEDGER_READ_FAILED", 500);
  }
}

async function saveLedger(ledger: AuditLedger): Promise<void> {
  const target = ledgerFile();
  const temporary = `${target}.${randomUUID()}.tmp`;
  const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
  try {
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(temporary, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, target);
    if (await readFile(target, "utf8") !== serialized) throw new Error("readback mismatch");
  } catch {
    try { await unlink(temporary); } catch { /* 临时文件可能尚未创建。 */ }
    throw new ScriptAuditServerError("审计会话账本写入失败", "AUDIT_LEDGER_WRITE_FAILED", 500);
  }
}

function withLedgerLock<T>(operation: () => Promise<T>): Promise<T> {
  const runtime = globalThis as RuntimeGlobal;
  const previous = runtime.__flowpilotScriptAuditLedgerQueue ?? Promise.resolve();
  const current = previous.then(operation, operation);
  runtime.__flowpilotScriptAuditLedgerQueue = current.then(() => undefined, () => undefined);
  return current;
}

export function createScriptAuditSession(input: {
  auditSessionId?: string;
  auditVersion: string;
  generationEvidenceDigest: string;
  factAudit: ScriptFactAudit;
  sourceIntegrityAudit: ScriptSourceIntegrityAudit;
  deliveryGate: ScriptDeliveryGate;
}): Promise<{ auditSessionId: string }> {
  return withLedgerLock(async () => {
    const ledger = await loadLedger();
    const auditSessionId = input.auditSessionId ?? randomUUID();
    const existing = input.auditSessionId
      ? ledger.sessions.find(session => session.auditSessionId === input.auditSessionId)
      : undefined;
    if (input.auditSessionId && !existing) {
      throw new ScriptAuditServerError("审计会话不存在", "AUDIT_SESSION_NOT_FOUND", 404);
    }
    if (existing && existing.generationEvidenceDigest !== input.generationEvidenceDigest) {
      throw new ScriptAuditServerError("生成证据凭证与审计会话不一致", "GENERATION_EVIDENCE_MISMATCH", 409);
    }
    const nextSession: AuditSessionRecord = {
      auditSessionId,
      auditVersion: input.auditVersion,
      generationEvidenceDigest: input.generationEvidenceDigest,
      factAudit: input.factAudit,
      sourceIntegrityAudit: input.sourceIntegrityAudit,
      deliveryGate: input.deliveryGate,
      resolutions: [],
    };
    if (existing) Object.assign(existing, nextSession);
    else ledger.sessions.push(nextSession);
    await saveLedger(ledger);
    return { auditSessionId };
  });
}

export function verifyScriptAuditSessionGenerationEvidence(input: {
  auditSessionId: string;
  generationEvidenceDigest: string;
}): Promise<void> {
  return withLedgerLock(async () => {
    const ledger = await loadLedger();
    const session = ledger.sessions.find(item => item.auditSessionId === input.auditSessionId);
    if (!session) {
      throw new ScriptAuditServerError("审计会话不存在", "AUDIT_SESSION_NOT_FOUND", 404);
    }
    if (!session.generationEvidenceDigest
      || session.generationEvidenceDigest !== input.generationEvidenceDigest) {
      throw new ScriptAuditServerError("生成证据凭证与审计会话不一致", "GENERATION_EVIDENCE_MISMATCH", 409);
    }
  });
}

function requestHash(input: {
  auditSessionId: string;
  auditVersion: string;
  pendingItemId: string;
  resolutionStatus: ScriptFactResolutionStatus;
}): string {
  return createHash("sha256").update(JSON.stringify([
    input.auditSessionId,
    input.auditVersion,
    input.pendingItemId,
    input.resolutionStatus,
  ])).digest("hex");
}

export function resolveScriptAuditItem(input: {
  auditSessionId: unknown;
  auditVersion: unknown;
  pendingItemId: unknown;
  resolutionStatus: unknown;
  idempotencyKey: unknown;
}): Promise<AuditResolutionResponse> {
  return withLedgerLock(async () => {
    if (
      typeof input.auditSessionId !== "string" || !input.auditSessionId
      || typeof input.auditVersion !== "string" || !input.auditVersion
      || typeof input.pendingItemId !== "string" || !input.pendingItemId
      || typeof input.idempotencyKey !== "string" || !input.idempotencyKey
      || !["CONFIRMED_ALLOWED", "SUPPORTED", "REMOVED"].includes(String(input.resolutionStatus))
    ) {
      throw new ScriptAuditServerError("人工处理请求格式错误", "INVALID_RESOLUTION_REQUEST", 400);
    }
    const resolutionStatus = input.resolutionStatus as ScriptFactResolutionStatus;
    if (resolutionStatus !== "CONFIRMED_ALLOWED") {
      throw new ScriptAuditServerError(
        "该处理状态需要服务端核对来源或正文变化",
        "SERVER_VERIFICATION_REQUIRED",
        400,
      );
    }
    const ledger = await loadLedger();
    const session = ledger.sessions.find(item => item.auditSessionId === input.auditSessionId);
    if (!session) throw new ScriptAuditServerError("审计会话不存在", "AUDIT_SESSION_NOT_FOUND", 404);

    const hash = requestHash({
      auditSessionId: input.auditSessionId,
      auditVersion: input.auditVersion,
      pendingItemId: input.pendingItemId,
      resolutionStatus,
    });
    if (session.auditVersion !== input.auditVersion) {
      throw new ScriptAuditServerError("审计版本已过期", "STALE_AUDIT_VERSION", 409);
    }
    const pendingItem = session.factAudit.pendingItems.find(
      (item): item is ScriptFactPendingItem => typeof item !== "string" && item.id === input.pendingItemId,
    );
    if (!pendingItem) throw new ScriptAuditServerError("待核验项不存在", "PENDING_ITEM_NOT_FOUND", 404);
    if (pendingItem.subtype !== "unsupported_specific_claim") {
      throw new ScriptAuditServerError(
        "该待核验类型不允许通过人工确认直接放行",
        "RESOLUTION_NOT_ALLOWED_FOR_PENDING_ITEM_TYPE",
        400,
      );
    }
    const repeated = session.resolutions.find(item => item.idempotencyKey === input.idempotencyKey);
    if (repeated) {
      if (repeated.requestHash !== hash) {
        throw new ScriptAuditServerError("幂等键已用于不同请求", "IDEMPOTENCY_CONFLICT", 409);
      }
      return repeated.response;
    }

    pendingItem.resolutionStatus = resolutionStatus;
    const unresolvedItems = session.factAudit.pendingItems
      .filter((item): item is ScriptFactPendingItem => typeof item !== "string")
      .filter(item => item.resolutionStatus === "PENDING");
    const pendingItemIds = unresolvedItems.map(item => item.id);
    const blockerCodes = [
      ...(session.sourceIntegrityAudit.issues.length > 0 ? ["SOURCE_INTEGRITY_REVIEW_REQUIRED"] : []),
      ...(unresolvedItems.some(item => item.subtype === "unsupported_specific_claim")
        ? ["UNRESOLVED_UNSUPPORTED_SPECIFIC_CLAIM"]
        : []),
      ...(unresolvedItems.some(item => item.subtype === "declared_pending_verification")
        ? ["UNRESOLVED_FACT_VERIFICATION"]
        : []),
    ];
    session.deliveryGate = {
      status: blockerCodes.length > 0 ? "BLOCKED" : "OPEN",
      auditVersion: session.auditVersion,
      blockerCodes,
      pendingItemIds,
    };
    const response: AuditResolutionResponse = {
      status: "resolved",
      auditSessionId: session.auditSessionId,
      auditVersion: session.auditVersion,
      pendingItem: { ...pendingItem },
      deliveryGate: { ...session.deliveryGate },
    };
    session.resolutions.push({ idempotencyKey: input.idempotencyKey, requestHash: hash, response });
    await saveLedger(ledger);
    return response;
  });
}
