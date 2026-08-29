import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseGlobalBlockingConstraint, type GlobalBlockingConstraint } from "./global-content-constraint-contract";
import { calculateSHA256 } from "./sha256";

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const ACKNOWLEDGEMENT = "我已逐字核对并确认启用";

export const EMOTIONAL_COERCION_PROPOSAL = Object.freeze({
  proposalId: "emotional-coercion-v2",
  ruleId: "global-constraint-emotional-coercion-v2",
  title: "禁止利用无力感进行情绪绑架",
  canonicalText: [
    "判断对象是表达动机，不是具体词汇。",
    "允许反差、悬念和适度焦虑。",
    "禁止利用受众的无力感进行情绪操纵，迫使其被动接受或行动。",
  ].join("\n"),
  prohibitedIntent: "利用受众的无力感进行情绪操纵，迫使其被动接受或行动",
  allowedBoundaries: ["反差", "悬念", "适度焦虑", "引用", "批判", "合理语境"],
  detectionTerms: ["被时代抛弃", "阶级固化"],
});

export interface GlobalConstraintSourceFacts {
  sourceType: "user_confirmed";
  confirmedBy: "彭彭";
  intakeChannel: "manual_confirmation_ui";
  sourceYear: 2026;
  sourceDate: null;
  dateStatus: "pending_exact_date";
}
export interface ServerGlobalConstraintRecord {
  proposalId: typeof EMOTIONAL_COERCION_PROPOSAL.proposalId;
  rule: GlobalBlockingConstraint;
  sourceFacts: GlobalConstraintSourceFacts;
  idempotencyKey: string;
}

interface ServerLedgerEnvelope {
  schemaVersion: 1;
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

function parseRecord(value: unknown): ServerGlobalConstraintRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GlobalConstraintServerError("服务端规则账本数据损坏", "LEDGER_CORRUPTED", 500);
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(",") !== "idempotencyKey,proposalId,rule,sourceFacts") {
    throw new GlobalConstraintServerError("服务端规则账本数据损坏", "LEDGER_CORRUPTED", 500);
  }
  if (raw.proposalId !== EMOTIONAL_COERCION_PROPOSAL.proposalId
    || typeof raw.idempotencyKey !== "string" || !raw.idempotencyKey) {
    throw new GlobalConstraintServerError("服务端规则账本数据损坏", "LEDGER_CORRUPTED", 500);
  }
  const facts = raw.sourceFacts as Record<string, unknown> | null;
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
  let rule: GlobalBlockingConstraint;
  try {
    rule = parseGlobalBlockingConstraint(raw.rule);
  } catch {
    throw new GlobalConstraintServerError("服务端规则账本数据损坏", "LEDGER_CORRUPTED", 500);
  }
  const expectedSourceId = `user-confirmed:${EMOTIONAL_COERCION_PROPOSAL.proposalId}`;
  if (rule.ruleId !== EMOTIONAL_COERCION_PROPOSAL.ruleId
    || rule.sourceKnowledgeEntryId !== expectedSourceId
    || rule.sourceSnapshot.title !== EMOTIONAL_COERCION_PROPOSAL.title
    || rule.sourceSnapshot.rawContentSha256 !== calculateSHA256(EMOTIONAL_COERCION_PROPOSAL.canonicalText)
    || rule.scope !== "all_ips"
    || rule.category !== "通用禁用规则"
    || rule.priority !== "global_baseline"
    || rule.enforcement !== "block"
    || rule.status !== "active"
    || rule.title !== EMOTIONAL_COERCION_PROPOSAL.title
    || rule.canonicalText !== EMOTIONAL_COERCION_PROPOSAL.canonicalText
    || rule.prohibitedIntent !== EMOTIONAL_COERCION_PROPOSAL.prohibitedIntent
    || JSON.stringify(rule.allowedBoundaries) !== JSON.stringify(EMOTIONAL_COERCION_PROPOSAL.allowedBoundaries)
    || rule.detection.type !== "keyword"
    || rule.detection.matchMode !== "any"
    || JSON.stringify(rule.detection.terms) !== JSON.stringify(EMOTIONAL_COERCION_PROPOSAL.detectionTerms)
    || !rule.humanConfirmation
    || rule.humanConfirmation.confirmedBy !== "彭彭"
    || rule.humanConfirmation.confirmationMethod !== "explicit_ui_action"
    || rule.humanConfirmation.identityAssurance !== "self_asserted"
    || rule.revision !== 1) {
    throw new GlobalConstraintServerError("服务端规则账本与固定提案不一致", "LEDGER_CORRUPTED", 500);
  }
  return {
    proposalId: raw.proposalId,
    rule,
    sourceFacts: facts as unknown as GlobalConstraintSourceFacts,
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
    || envelope.schemaVersion !== 1 || !Array.isArray(envelope.records)) {
    throw new GlobalConstraintServerError("服务端规则账本数据损坏", "LEDGER_CORRUPTED", 500);
  }
  const records = envelope.records.map(parseRecord);
  if (new Set(records.map(record => record.proposalId)).size !== records.length) {
    throw new GlobalConstraintServerError("服务端规则账本存在重复规则", "LEDGER_CORRUPTED", 500);
  }
  return records;
}

async function saveServerGlobalConstraintRecords(records: ServerGlobalConstraintRecord[]): Promise<void> {
  const target = ledgerFile();
  const temporary = `${target}.${randomUUID()}.tmp`;
  const serialized = `${JSON.stringify({ schemaVersion: 1, records } satisfies ServerLedgerEnvelope, null, 2)}\n`;
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
  if (proposalId !== EMOTIONAL_COERCION_PROPOSAL.proposalId) {
    throw new GlobalConstraintServerError("待确认规则不存在", "UNKNOWN_PROPOSAL", 404);
  }
  const now = Date.now();
  for (const [id, record] of challenges) {
    if (record.expiresAt <= now) challenges.delete(id);
  }
  const challengeId = randomUUID();
  const challenge = randomBytes(32).toString("base64url");
  const expiresAt = now + CHALLENGE_TTL_MS;
  challenges.set(challengeId, { proposalId, challenge, expiresAt, consumedBy: null });
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
    if (input.proposalId !== EMOTIONAL_COERCION_PROPOSAL.proposalId
      || typeof input.challengeId !== "string" || !input.challengeId
      || typeof input.challenge !== "string" || !input.challenge
      || typeof input.idempotencyKey !== "string" || !input.idempotencyKey
      || input.confirmedBy !== "彭彭"
      || input.acknowledgement !== ACKNOWLEDGEMENT) {
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
    const existing = (await loadServerGlobalConstraintRecords())
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
    const rule = parseGlobalBlockingConstraint({
      schemaVersion: 2,
      ruleId: EMOTIONAL_COERCION_PROPOSAL.ruleId,
      sourceKnowledgeEntryId: "user-confirmed:emotional-coercion-v2",
      sourceSnapshot: {
        title: EMOTIONAL_COERCION_PROPOSAL.title,
        rawContentSha256: calculateSHA256(EMOTIONAL_COERCION_PROPOSAL.canonicalText),
      },
      scope: "all_ips",
      category: "通用禁用规则",
      priority: "global_baseline",
      enforcement: "block",
      status: "active",
      title: EMOTIONAL_COERCION_PROPOSAL.title,
      canonicalText: EMOTIONAL_COERCION_PROPOSAL.canonicalText,
      prohibitedIntent: EMOTIONAL_COERCION_PROPOSAL.prohibitedIntent,
      allowedBoundaries: [...EMOTIONAL_COERCION_PROPOSAL.allowedBoundaries],
      detection: { type: "keyword", matchMode: "any", terms: [...EMOTIONAL_COERCION_PROPOSAL.detectionTerms] },
      humanConfirmation: {
        confirmedBy: "彭彭",
        confirmedAt,
        confirmationMethod: "explicit_ui_action",
        identityAssurance: "self_asserted",
      },
      revision: 1,
      createdAt: confirmedAt,
      updatedAt: confirmedAt,
    });
    const record: ServerGlobalConstraintRecord = {
      proposalId: EMOTIONAL_COERCION_PROPOSAL.proposalId,
      rule,
      sourceFacts: {
        sourceType: "user_confirmed",
        confirmedBy: "彭彭",
        intakeChannel: "manual_confirmation_ui",
        sourceYear: 2026,
        sourceDate: null,
        dateStatus: "pending_exact_date",
      },
      idempotencyKey: input.idempotencyKey,
    };
    await saveServerGlobalConstraintRecords([record]);
    challengeRecord.consumedBy = input.idempotencyKey;
    return record;
  });
  confirmationQueue = operation.catch(() => undefined);
  return operation;
}

export async function getEmotionalCoercionConstraintStatus() {
  const record = (await loadServerGlobalConstraintRecords())
    .find(item => item.proposalId === EMOTIONAL_COERCION_PROPOSAL.proposalId) ?? null;
  return {
    proposal: EMOTIONAL_COERCION_PROPOSAL,
    active: record?.rule.status === "active",
    rule: record?.rule ?? null,
    sourceFacts: record?.sourceFacts ?? null,
  };
}
