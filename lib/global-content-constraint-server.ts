import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseGlobalBlockingConstraint, type GlobalBlockingConstraint } from "./global-content-constraint-contract";
import {
  EMOTIONAL_COERCION_PROPOSAL,
  GLOBAL_CONSTRAINT_PROPOSALS,
  getGlobalConstraintProposal,
  type GlobalConstraintProposal,
} from "./global-content-constraint-proposals";
import { calculateSHA256 } from "./sha256";

const CHALLENGE_TTL_MS = 2 * 60 * 1000;

export interface GlobalConstraintSourceFacts {
  sourceType: "user_confirmed";
  confirmedBy: "彭彭";
  intakeChannel: "manual_confirmation_ui";
  sourceYear: 2026;
  sourceDate: null;
  dateStatus: "pending_exact_date";
}
export interface ServerActiveGlobalConstraintRecord {
  recordType: "active_rule";
  proposalId: string;
  rule: GlobalBlockingConstraint;
  sourceFacts: GlobalConstraintSourceFacts;
  idempotencyKey: string;
}

export interface ServerConfirmedGlobalConstraintProposalRecord {
  recordType: "confirmed_proposal";
  proposalId: string;
  proposal: GlobalConstraintProposal;
  confirmationStatus: "confirmed_pending_detection";
  runtimeStatus: "detection_pending";
  humanConfirmation: {
    confirmedBy: "彭彭";
    confirmedAt: string;
    confirmationMethod: "explicit_ui_action";
    identityAssurance: "self_asserted";
  };
  sourceFacts: GlobalConstraintSourceFacts;
  idempotencyKey: string;
}

export type ServerGlobalConstraintRecord =
  | ServerActiveGlobalConstraintRecord
  | ServerConfirmedGlobalConstraintProposalRecord;

interface ServerLedgerEnvelope {
  schemaVersion: 2;
  records: ServerGlobalConstraintRecord[];
}

interface ChallengeRecord {
  proposalId: string;
  challenge: string;
  expiresAt: number;
  consumedBy: string | null;
}

export class GlobalConstraintServerError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GlobalConstraintServerError";
  }
}

const challenges = new Map<string, ChallengeRecord>();
let confirmationQueue: Promise<unknown> = Promise.resolve();

function ledgerFile(): string {
  return process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE
    ?? path.join(process.cwd(), "data", "global-content-constraint-ledger.json");
}

function parseSourceFacts(value: unknown): GlobalConstraintSourceFacts {
  const facts = value as Record<string, unknown> | null;
  if (!facts
    || Object.keys(facts).sort().join(",") !== "confirmedBy,dateStatus,intakeChannel,sourceDate,sourceType,sourceYear"
    || facts.sourceType !== "user_confirmed"
    || facts.confirmedBy !== "彭彭"
    || facts.intakeChannel !== "manual_confirmation_ui"
    || facts.sourceYear !== 2026
    || facts.sourceDate !== null
    || facts.dateStatus !== "pending_exact_date") {
    throw new GlobalConstraintServerError("服务端规则账本来源信息损坏", "LEDGER_CORRUPTED", 500);
  }
  return facts as unknown as GlobalConstraintSourceFacts;
}

function parseActiveRecord(value: unknown, legacy: boolean): ServerActiveGlobalConstraintRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GlobalConstraintServerError("服务端规则账本数据损坏", "LEDGER_CORRUPTED", 500);
  }
  const raw = value as Record<string, unknown>;
  const expectedKeys = legacy
    ? "idempotencyKey,proposalId,rule,sourceFacts"
    : "idempotencyKey,proposalId,recordType,rule,sourceFacts";
  if (Object.keys(raw).sort().join(",") !== expectedKeys
    || (!legacy && raw.recordType !== "active_rule")) {
    throw new GlobalConstraintServerError("服务端规则账本数据损坏", "LEDGER_CORRUPTED", 500);
  }
  const proposal = getGlobalConstraintProposal(raw.proposalId);
  if (!proposal || proposal.activationMode !== "active_on_confirmation"
    || !proposal.detectionTerms
    || typeof raw.idempotencyKey !== "string" || !raw.idempotencyKey) {
    throw new GlobalConstraintServerError("服务端规则账本数据损坏", "LEDGER_CORRUPTED", 500);
  }
  const facts = parseSourceFacts(raw.sourceFacts);
  let rule: GlobalBlockingConstraint;
  try {
    rule = parseGlobalBlockingConstraint(raw.rule);
  } catch {
    throw new GlobalConstraintServerError("服务端规则账本数据损坏", "LEDGER_CORRUPTED", 500);
  }
  const expectedSourceId = `user-confirmed:${proposal.proposalId}`;
  if (rule.ruleId !== proposal.ruleId
    || rule.sourceKnowledgeEntryId !== expectedSourceId
    || rule.sourceSnapshot.title !== proposal.title
    || rule.sourceSnapshot.rawContentSha256 !== calculateSHA256(proposal.canonicalText)
    || rule.scope !== "all_ips"
    || rule.category !== "通用禁用规则"
    || rule.priority !== "global_baseline"
    || rule.enforcement !== "block"
    || rule.status !== "active"
    || rule.title !== proposal.title
    || rule.canonicalText !== proposal.canonicalText
    || rule.prohibitedIntent !== proposal.prohibitedIntent
    || JSON.stringify(rule.allowedBoundaries) !== JSON.stringify(proposal.allowedBoundaries)
    || rule.detection.type !== "keyword"
    || rule.detection.matchMode !== "any"
    || JSON.stringify(rule.detection.terms) !== JSON.stringify(proposal.detectionTerms)
    || !rule.humanConfirmation
    || rule.humanConfirmation.confirmedBy !== "彭彭"
    || rule.humanConfirmation.confirmationMethod !== "explicit_ui_action"
    || rule.humanConfirmation.identityAssurance !== "self_asserted"
    || rule.revision !== 1) {
    throw new GlobalConstraintServerError("服务端规则账本与固定提案不一致", "LEDGER_CORRUPTED", 500);
  }
  return {
    recordType: "active_rule",
    proposalId: proposal.proposalId,
    rule,
    sourceFacts: facts,
    idempotencyKey: raw.idempotencyKey,
  };
}

function parseConfirmedProposalRecord(value: unknown): ServerConfirmedGlobalConstraintProposalRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GlobalConstraintServerError("服务端规则账本数据损坏", "LEDGER_CORRUPTED", 500);
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(",")
    !== "confirmationStatus,humanConfirmation,idempotencyKey,proposal,proposalId,recordType,runtimeStatus,sourceFacts"
    || raw.recordType !== "confirmed_proposal"
    || raw.confirmationStatus !== "confirmed_pending_detection"
    || raw.runtimeStatus !== "detection_pending"
    || typeof raw.idempotencyKey !== "string" || !raw.idempotencyKey) {
    throw new GlobalConstraintServerError("服务端规则账本数据损坏", "LEDGER_CORRUPTED", 500);
  }
  const proposal = getGlobalConstraintProposal(raw.proposalId);
  if (!proposal || proposal.activationMode !== "confirmed_pending_detection"
    || proposal.detectionTerms !== null
    || JSON.stringify(raw.proposal) !== JSON.stringify(proposal)) {
    throw new GlobalConstraintServerError("服务端规则账本与固定提案不一致", "LEDGER_CORRUPTED", 500);
  }
  const confirmation = raw.humanConfirmation as Record<string, unknown> | null;
  let confirmedAtIsValid = false;
  if (typeof confirmation?.confirmedAt === "string") {
    try {
      confirmedAtIsValid = new Date(confirmation.confirmedAt).toISOString() === confirmation.confirmedAt;
    } catch {
      confirmedAtIsValid = false;
    }
  }
  if (!confirmation
    || Object.keys(confirmation).sort().join(",")
      !== "confirmationMethod,confirmedAt,confirmedBy,identityAssurance"
    || confirmation.confirmedBy !== "彭彭"
    || !confirmedAtIsValid
    || confirmation.confirmationMethod !== "explicit_ui_action"
    || confirmation.identityAssurance !== "self_asserted") {
    throw new GlobalConstraintServerError("服务端规则账本确认信息损坏", "LEDGER_CORRUPTED", 500);
  }
  return {
    recordType: "confirmed_proposal",
    proposalId: proposal.proposalId,
    proposal,
    confirmationStatus: "confirmed_pending_detection",
    runtimeStatus: "detection_pending",
    humanConfirmation: confirmation as ServerConfirmedGlobalConstraintProposalRecord["humanConfirmation"],
    sourceFacts: parseSourceFacts(raw.sourceFacts),
    idempotencyKey: raw.idempotencyKey,
  };
}

export async function loadServerGlobalConstraintRecords(): Promise<ServerGlobalConstraintRecord[]> {
  let raw: string;
  try {
    raw = await readFile(ledgerFile(), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw new GlobalConstraintServerError("服务端规则账本读取失败", "LEDGER_READ_FAILED", 500);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GlobalConstraintServerError("服务端规则账本数据损坏", "LEDGER_CORRUPTED", 500);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GlobalConstraintServerError("服务端规则账本数据损坏", "LEDGER_CORRUPTED", 500);
  }
  const envelope = parsed as Record<string, unknown>;
  if (Object.keys(envelope).sort().join(",") !== "records,schemaVersion"
    || (envelope.schemaVersion !== 1 && envelope.schemaVersion !== 2)
    || !Array.isArray(envelope.records)) {
    throw new GlobalConstraintServerError("服务端规则账本数据损坏", "LEDGER_CORRUPTED", 500);
  }
  const records = envelope.schemaVersion === 1
    ? envelope.records.map(record => parseActiveRecord(record, true))
    : envelope.records.map(record => {
      const recordType = record && typeof record === "object" && !Array.isArray(record)
        ? (record as Record<string, unknown>).recordType
        : null;
      if (recordType === "active_rule") return parseActiveRecord(record, false);
      if (recordType === "confirmed_proposal") return parseConfirmedProposalRecord(record);
      throw new GlobalConstraintServerError("服务端规则账本数据损坏", "LEDGER_CORRUPTED", 500);
    });
  if (new Set(records.map(record => record.proposalId)).size !== records.length) {
    throw new GlobalConstraintServerError("服务端规则账本存在重复规则", "LEDGER_CORRUPTED", 500);
  }
  return records;
}

async function saveServerGlobalConstraintRecords(records: ServerGlobalConstraintRecord[]): Promise<void> {
  const target = ledgerFile();
  const temporary = `${target}.${randomUUID()}.tmp`;
  const serialized = `${JSON.stringify({ schemaVersion: 2, records } satisfies ServerLedgerEnvelope, null, 2)}\n`;
  try {
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(temporary, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, target);
    if (await readFile(target, "utf8") !== serialized) {
      throw new Error("readback mismatch");
    }
  } catch {
    try { await unlink(temporary); } catch { /* 临时文件可能尚未创建。 */ }
    throw new GlobalConstraintServerError("服务端规则账本写入或回读失败", "LEDGER_WRITE_FAILED", 500);
  }
}

export function issueGlobalConstraintChallenge(proposalId: unknown) {
  const proposal = getGlobalConstraintProposal(proposalId);
  if (!proposal) {
    throw new GlobalConstraintServerError("待确认规则不存在", "UNKNOWN_PROPOSAL", 404);
  }
  const now = Date.now();
  for (const [id, record] of challenges) {
    if (record.expiresAt <= now) challenges.delete(id);
  }
  const challengeId = randomUUID();
  const challenge = randomBytes(32).toString("base64url");
  const expiresAt = now + CHALLENGE_TTL_MS;
  challenges.set(challengeId, { proposalId: proposal.proposalId, challenge, expiresAt, consumedBy: null });
  return { challengeId, challenge, expiresAt: new Date(expiresAt).toISOString() };
}

export function confirmGlobalConstraintOnServer(input: {
  proposalId: unknown;
  challengeId: unknown;
  challenge: unknown;
  idempotencyKey: unknown;
  confirmedBy: unknown;
  acknowledgement: unknown;
}): Promise<ServerGlobalConstraintRecord> {
  const operation = confirmationQueue.then(async () => {
    const proposal = getGlobalConstraintProposal(input.proposalId);
    if (!proposal
      || typeof input.challengeId !== "string" || !input.challengeId
      || typeof input.challenge !== "string" || !input.challenge
      || typeof input.idempotencyKey !== "string" || !input.idempotencyKey
      || input.confirmedBy !== "彭彭"
      || input.acknowledgement !== proposal.confirmationAcknowledgement) {
      throw new GlobalConstraintServerError(
        "人工确认请求无效，未启用任何规则",
        "INVALID_CONFIRMATION_REQUEST",
        400,
      );
    }
    const challengeRecord = challenges.get(input.challengeId);
    if (!challengeRecord
      || challengeRecord.proposalId !== input.proposalId
      || challengeRecord.challenge !== input.challenge
      || challengeRecord.expiresAt <= Date.now()) {
      throw new GlobalConstraintServerError(
        "一次性确认挑战无效或已过期",
        "INVALID_CONFIRMATION_CHALLENGE",
        403,
      );
    }
    const records = await loadServerGlobalConstraintRecords();
    const existing = records
      .find(record => record.proposalId === input.proposalId);
    if (challengeRecord.consumedBy !== null) {
      if (challengeRecord.consumedBy === input.idempotencyKey && existing) return existing;
      throw new GlobalConstraintServerError(
        "一次性确认挑战已经使用",
        "INVALID_CONFIRMATION_CHALLENGE",
        403,
      );
    }
    if (existing) {
      challengeRecord.consumedBy = input.idempotencyKey;
      return existing;
    }
    const confirmedAt = new Date().toISOString();
    const sourceFacts: GlobalConstraintSourceFacts = {
      sourceType: "user_confirmed",
      confirmedBy: "彭彭",
      intakeChannel: "manual_confirmation_ui",
      sourceYear: 2026,
      sourceDate: null,
      dateStatus: "pending_exact_date",
    };
    const humanConfirmation = {
      confirmedBy: "彭彭" as const,
      confirmedAt,
      confirmationMethod: "explicit_ui_action" as const,
      identityAssurance: "self_asserted" as const,
    };
    let record: ServerGlobalConstraintRecord;
    if (proposal.activationMode === "active_on_confirmation") {
      if (!proposal.detectionTerms) {
        throw new GlobalConstraintServerError("固定提案缺少检测范围", "PROPOSAL_MISCONFIGURED", 500);
      }
      const rule = parseGlobalBlockingConstraint({
        schemaVersion: 2,
        ruleId: proposal.ruleId,
        sourceKnowledgeEntryId: `user-confirmed:${proposal.proposalId}`,
        sourceSnapshot: {
          title: proposal.title,
          rawContentSha256: calculateSHA256(proposal.canonicalText),
        },
        scope: "all_ips",
        category: "通用禁用规则",
        priority: "global_baseline",
        enforcement: "block",
        status: "active",
        title: proposal.title,
        canonicalText: proposal.canonicalText,
        prohibitedIntent: proposal.prohibitedIntent,
        allowedBoundaries: [...proposal.allowedBoundaries],
        detection: { type: "keyword", matchMode: "any", terms: [...proposal.detectionTerms] },
        humanConfirmation,
        revision: 1,
        createdAt: confirmedAt,
        updatedAt: confirmedAt,
      });
      record = {
        recordType: "active_rule",
        proposalId: proposal.proposalId,
        rule,
        sourceFacts,
        idempotencyKey: input.idempotencyKey,
      };
    } else {
      record = {
        recordType: "confirmed_proposal",
        proposalId: proposal.proposalId,
        proposal,
        confirmationStatus: "confirmed_pending_detection",
        runtimeStatus: "detection_pending",
        humanConfirmation,
        sourceFacts,
        idempotencyKey: input.idempotencyKey,
      };
    }
    await saveServerGlobalConstraintRecords([...records, record]);
    challengeRecord.consumedBy = input.idempotencyKey;
    return record;
  });
  confirmationQueue = operation.catch(() => undefined);
  return operation;
}

export async function getEmotionalCoercionConstraintStatus() {
  const record = (await loadServerGlobalConstraintRecords())
    .find((item): item is ServerActiveGlobalConstraintRecord => (
      item.recordType === "active_rule"
      && item.proposalId === EMOTIONAL_COERCION_PROPOSAL.proposalId
    )) ?? null;
  return {
    proposal: EMOTIONAL_COERCION_PROPOSAL,
    active: record?.rule.status === "active",
    rule: record?.rule ?? null,
    sourceFacts: record?.sourceFacts ?? null,
  };
}

export async function getGlobalConstraintProposalStatuses() {
  const records = await loadServerGlobalConstraintRecords();
  return GLOBAL_CONSTRAINT_PROPOSALS.map(proposal => {
    const record = records.find(item => item.proposalId === proposal.proposalId) ?? null;
    const activeRecord = record?.recordType === "active_rule" ? record : null;
    const confirmedProposal = record?.recordType === "confirmed_proposal" ? record : null;
    return {
      proposal,
      confirmationStatus: activeRecord
        ? "active"
        : confirmedProposal?.confirmationStatus ?? "pending_confirmation",
      runtimeStatus: activeRecord ? "active" : "detection_pending",
      rule: activeRecord?.rule ?? null,
      sourceFacts: record?.sourceFacts ?? null,
    };
  });
}
