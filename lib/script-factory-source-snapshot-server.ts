import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TeacherOriginalSourceSnapshot {
  schemaVersion: 1;
  sourceId: string;
  ipId: string;
  title: string;
  rawContent: string;
  contentSha256: string;
  provenance: "user_declared_teacher_original";
  createdAt: string;
}

interface SourceSnapshotLedger {
  schemaVersion: 1;
  sources: TeacherOriginalSourceSnapshot[];
  idempotencyRecords: Array<{
    idempotencyKey: string;
    requestHash: string;
    sourceId: string;
  }>;
}

type RuntimeGlobal = typeof globalThis & {
  __flowpilotScriptSourceSnapshotQueue?: Promise<unknown>;
};

function ledgerFile(): string {
  return process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE
    ?? path.join(process.cwd(), ".flowpilot", "ledger", "script-factory-source-snapshots.json");
}

function contentDigest(rawContent: string): string {
  return createHash("sha256").update(rawContent, "utf8").digest("hex");
}

function registrationRequestHash(input: {
  ipId: string;
  title: string;
  rawContent: string;
}): string {
  return createHash("sha256").update(JSON.stringify([
    input.ipId,
    input.title,
    input.rawContent,
    "user_declared_teacher_original",
  ])).digest("hex");
}

export class ScriptSourceSnapshotError extends Error {
  constructor(
    message: string,
    readonly code:
      | "SOURCE_IDEMPOTENCY_CONFLICT"
      | "SOURCE_LEDGER_READ_FAILED"
      | "SOURCE_LEDGER_WRITE_FAILED",
  ) {
    super(message);
    this.name = "ScriptSourceSnapshotError";
  }
}

let failNextWriteForTests = false;

function isSourceSnapshot(value: unknown): value is TeacherOriginalSourceSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as TeacherOriginalSourceSnapshot;
  return source.schemaVersion === 1
    && /^ipsrc_[0-9a-f-]{36}$/.test(source.sourceId)
    && typeof source.ipId === "string" && Boolean(source.ipId.trim())
    && typeof source.title === "string" && Boolean(source.title.trim())
    && typeof source.rawContent === "string" && Boolean(source.rawContent.trim())
    && typeof source.contentSha256 === "string"
    && source.contentSha256 === contentDigest(source.rawContent)
    && source.provenance === "user_declared_teacher_original"
    && typeof source.createdAt === "string" && Boolean(source.createdAt);
}

async function loadLedger(): Promise<SourceSnapshotLedger> {
  try {
    const parsed = JSON.parse(await readFile(ledgerFile(), "utf8")) as SourceSnapshotLedger;
    if (
      parsed.schemaVersion !== 1
      || !Array.isArray(parsed.sources)
      || !parsed.sources.every(isSourceSnapshot)
      || !Array.isArray(parsed.idempotencyRecords)
      || !parsed.idempotencyRecords.every(record => Boolean(
        record
        && typeof record === "object"
        && typeof record.idempotencyKey === "string" && record.idempotencyKey
        && typeof record.requestHash === "string" && /^[a-f0-9]{64}$/.test(record.requestHash)
        && typeof record.sourceId === "string" && /^ipsrc_[0-9a-f-]{36}$/.test(record.sourceId)
      ))
    ) {
      throw new Error("invalid source snapshot ledger");
    }
    const sourceIds = parsed.sources.map(source => source.sourceId);
    const idempotencyKeys = parsed.idempotencyRecords.map(record => record.idempotencyKey);
    const referencedSourceIds = parsed.idempotencyRecords.map(record => record.sourceId);
    if (
      new Set(sourceIds).size !== sourceIds.length
      || new Set(idempotencyKeys).size !== idempotencyKeys.length
      || new Set(referencedSourceIds).size !== referencedSourceIds.length
      || parsed.sources.length !== parsed.idempotencyRecords.length
    ) {
      throw new Error("invalid source snapshot ledger relations");
    }
    const sourcesById = new Map(parsed.sources.map(source => [source.sourceId, source]));
    for (const record of parsed.idempotencyRecords) {
      const source = sourcesById.get(record.sourceId);
      if (!source || record.requestHash !== registrationRequestHash(source)) {
        throw new Error("invalid source snapshot ledger relation");
      }
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { schemaVersion: 1, sources: [], idempotencyRecords: [] };
    }
    throw new ScriptSourceSnapshotError("老师原文来源账本读取失败或已损坏", "SOURCE_LEDGER_READ_FAILED");
  }
}

async function saveLedger(ledger: SourceSnapshotLedger): Promise<void> {
  const target = ledgerFile();
  const temporary = `${target}.${randomUUID()}.tmp`;
  const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
  try {
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(temporary, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    if (failNextWriteForTests) {
      failNextWriteForTests = false;
      throw new Error("模拟老师原文来源账本写入失败");
    }
    await rename(temporary, target);
    if (await readFile(target, "utf8") !== serialized) throw new Error("readback mismatch");
  } catch {
    try { await unlink(temporary); } catch { /* 临时文件可能尚未创建。 */ }
    throw new ScriptSourceSnapshotError("老师原文来源账本写入失败", "SOURCE_LEDGER_WRITE_FAILED");
  }
}

function withLedgerLock<T>(operation: () => Promise<T>): Promise<T> {
  const runtime = globalThis as RuntimeGlobal;
  const previous = runtime.__flowpilotScriptSourceSnapshotQueue ?? Promise.resolve();
  const current = previous.then(operation, operation);
  runtime.__flowpilotScriptSourceSnapshotQueue = current.then(() => undefined, () => undefined);
  return current;
}

export function failNextScriptSourceSnapshotWriteForTests(): void {
  if (!process.env.NODE_TEST_CONTEXT) {
    throw new Error("只能在Node测试进程中模拟老师原文来源账本写入失败");
  }
  failNextWriteForTests = true;
}

export function createTeacherOriginalSourceSnapshot(input: {
  ipId: string;
  title: string;
  rawContent: string;
  idempotencyKey: string;
}): Promise<TeacherOriginalSourceSnapshot> {
  return withLedgerLock(async () => {
    const ledger = await loadLedger();
    const requestHash = registrationRequestHash(input);
    const repeated = ledger.idempotencyRecords.find(record => record.idempotencyKey === input.idempotencyKey);
    if (repeated) {
      if (repeated.requestHash !== requestHash) {
        throw new ScriptSourceSnapshotError(
          "幂等键已用于另一份老师原文",
          "SOURCE_IDEMPOTENCY_CONFLICT",
        );
      }
      const existing = ledger.sources.find(source => source.sourceId === repeated.sourceId);
      if (!existing) throw new Error("老师原文来源账本读取失败");
      return existing;
    }
    const source: TeacherOriginalSourceSnapshot = {
      schemaVersion: 1,
      sourceId: `ipsrc_${randomUUID()}`,
      ipId: input.ipId,
      title: input.title,
      rawContent: input.rawContent,
      contentSha256: contentDigest(input.rawContent),
      provenance: "user_declared_teacher_original",
      createdAt: new Date().toISOString(),
    };
    ledger.sources.push(source);
    ledger.idempotencyRecords.push({
      idempotencyKey: input.idempotencyKey,
      requestHash,
      sourceId: source.sourceId,
    });
    await saveLedger(ledger);
    return source;
  });
}

export function getTeacherOriginalSourceSnapshot(input: {
  sourceId: string;
  ipId: string;
  contentSha256: string;
}): Promise<TeacherOriginalSourceSnapshot | null> {
  return withLedgerLock(async () => {
    const ledger = await loadLedger();
    const source = ledger.sources.find(item => item.sourceId === input.sourceId);
    if (!source
      || source.ipId !== input.ipId
      || source.contentSha256 !== input.contentSha256) {
      return null;
    }
    return { ...source };
  });
}
