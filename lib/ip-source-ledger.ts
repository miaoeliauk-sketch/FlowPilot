import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

const PRODUCTION_LEDGER_DIRECTORY = path.join(process.cwd(), ".flowpilot", "ledger");
const TEST_LEDGER_DIRECTORY = path.join(
  os.tmpdir(),
  "flowpilot-ip-source-ledger-tests",
  String(process.pid),
);

interface IPSourceLedgerRecord {
  kind: "v1_legacy" | "v2";
  ipId: string;
  currentNonce: number;
  lastDigest: string;
  finalizedDigest: string | null;
}

function getLedgerPaths() {
  const directory = process.env.NODE_TEST_CONTEXT
    ? TEST_LEDGER_DIRECTORY
    : PRODUCTION_LEDGER_DIRECTORY;
  return {
    directory,
    ledgerFile: path.join(directory, "ip-source-analysis.json"),
    trustedLegacyFile: path.join(directory, "ip-source-v1-trusted-migrations.json"),
  };
}

type IPSourceLedger = Record<string, IPSourceLedgerRecord>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLedger(value: unknown): IPSourceLedger {
  if (!isRecord(value)) throw new Error("IP认知状态账本已损坏");
  const ledger: IPSourceLedger = {};
  for (const [sourceId, raw] of Object.entries(value)) {
    if (!sourceId.trim() || !isRecord(raw)
      || !(raw.kind === undefined || raw.kind === "v1_legacy" || raw.kind === "v2")
      || typeof raw.ipId !== "string" || !raw.ipId.trim()
      || !Number.isInteger(raw.currentNonce) || (raw.currentNonce as number) < 1
      || typeof raw.lastDigest !== "string" || !/^[a-f0-9]{64}$/.test(raw.lastDigest)
      || !(raw.finalizedDigest === null
        || (typeof raw.finalizedDigest === "string" && /^[a-f0-9]{64}$/.test(raw.finalizedDigest)))) {
      throw new Error("IP认知状态账本已损坏");
    }
    ledger[sourceId] = {
      kind: raw.kind === "v1_legacy" ? "v1_legacy" : "v2",
      ipId: raw.ipId,
      currentNonce: raw.currentNonce as number,
      lastDigest: raw.lastDigest,
      finalizedDigest: raw.finalizedDigest,
    };
  }
  return ledger;
}

async function readLedger(): Promise<IPSourceLedger> {
  const { ledgerFile } = getLedgerPaths();
  try {
    return parseLedger(JSON.parse(await readFile(ledgerFile, "utf8")));
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return {};
    if (error instanceof SyntaxError) throw new Error("IP认知状态账本已损坏");
    throw error;
  }
}

async function writeLedger(ledger: IPSourceLedger): Promise<void> {
  const { directory, ledgerFile } = getLedgerPaths();
  const temporary = `${ledgerFile}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    if (failNextLedgerWriteForTests) {
      failNextLedgerWriteForTests = false;
      throw new Error("模拟账本写入失败");
    }
    await rename(temporary, ledgerFile);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

let ledgerQueue: Promise<void> = Promise.resolve();
let failNextLedgerWriteForTests = false;

function withLedgerQueue<T>(operation: (ledger: IPSourceLedger) => Promise<T> | T): Promise<T> {
  const result = ledgerQueue.then(async () => {
    const ledger = await readLedger();
    return await operation(ledger);
  });
  ledgerQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function initializeIPSourceLedger(input: {
  sourceId: string;
  ipId: string;
  nonce: number;
  digest: string;
}): Promise<boolean> {
  return withLedgerQueue(async ledger => {
    if (ledger[input.sourceId]) return false;
    ledger[input.sourceId] = {
      kind: "v2",
      ipId: input.ipId,
      currentNonce: input.nonce,
      lastDigest: input.digest,
      finalizedDigest: null,
    };
    await writeLedger(ledger);
    return true;
  });
}

export async function getIPSourceLedgerRecord(
  sourceId: string,
): Promise<Readonly<IPSourceLedgerRecord> | null> {
  return withLedgerQueue(ledger => ledger[sourceId] ? { ...ledger[sourceId] } : null);
}

export async function registerLegacyIPSourceLedger(input: {
  sourceId: string;
  ipId: string;
  digest: string;
}): Promise<boolean> {
  return withLedgerQueue(async ledger => {
    const existing = ledger[input.sourceId];
    if (existing) {
      return existing.kind === "v1_legacy"
        && existing.ipId === input.ipId
        && existing.lastDigest === input.digest
        && existing.finalizedDigest === input.digest;
    }
    ledger[input.sourceId] = {
      kind: "v1_legacy",
      ipId: input.ipId,
      currentNonce: 1,
      lastDigest: input.digest,
      finalizedDigest: input.digest,
    };
    await writeLedger(ledger);
    return true;
  });
}

interface TrustedLegacyMigrationRecord {
  ipId: string;
  sourceHash: string;
  contextDigest: string;
}

function parseTrustedLegacyMigrations(value: unknown): Record<string, TrustedLegacyMigrationRecord> {
  if (!isRecord(value)) throw new Error("V1可信迁移清单已损坏");
  const migrations: Record<string, TrustedLegacyMigrationRecord> = {};
  for (const [sourceId, raw] of Object.entries(value)) {
    if (!sourceId.trim() || !isRecord(raw)
      || typeof raw.ipId !== "string" || !raw.ipId.trim()
      || typeof raw.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(raw.sourceHash)
      || typeof raw.contextDigest !== "string" || !/^[a-f0-9]{64}$/.test(raw.contextDigest)) {
      throw new Error("V1可信迁移清单已损坏");
    }
    migrations[sourceId] = {
      ipId: raw.ipId,
      sourceHash: raw.sourceHash,
      contextDigest: raw.contextDigest,
    };
  }
  return migrations;
}

async function readTrustedLegacyMigrations(): Promise<Record<string, TrustedLegacyMigrationRecord>> {
  const { trustedLegacyFile } = getLedgerPaths();
  try {
    return parseTrustedLegacyMigrations(JSON.parse(await readFile(trustedLegacyFile, "utf8")));
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return {};
    if (error instanceof SyntaxError) throw new Error("V1可信迁移清单已损坏");
    throw error;
  }
}

export async function isTrustedLegacyMigration(input: {
  sourceId: string;
  ipId: string;
  sourceHash: string;
  contextDigest: string;
}): Promise<boolean> {
  const trusted = (await readTrustedLegacyMigrations())[input.sourceId];
  return Boolean(trusted
    && trusted.ipId === input.ipId
    && trusted.sourceHash === input.sourceHash
    && trusted.contextDigest === input.contextDigest);
}

export async function trustLegacyMigrationForTests(input: {
  sourceId: string;
  ipId: string;
  sourceHash: string;
  contextDigest: string;
}): Promise<void> {
  if (!process.env.NODE_TEST_CONTEXT) {
    throw new Error("只能在Node测试进程中登记V1可信迁移记录");
  }
  const { directory, trustedLegacyFile } = getLedgerPaths();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const migrations = await readTrustedLegacyMigrations();
  migrations[input.sourceId] = {
    ipId: input.ipId,
    sourceHash: input.sourceHash,
    contextDigest: input.contextDigest,
  };
  await writeFile(trustedLegacyFile, `${JSON.stringify(migrations, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function verifyLegacyIPSourceLedger(input: {
  sourceId: string;
  ipId: string;
  digest: string;
}): Promise<boolean> {
  return withLedgerQueue(ledger => {
    const current = ledger[input.sourceId];
    return Boolean(current
      && current.kind === "v1_legacy"
      && current.ipId === input.ipId
      && current.lastDigest === input.digest
      && current.finalizedDigest === input.digest);
  });
}

export async function resetIPSourceLedgerForTests(): Promise<void> {
  if (!process.env.NODE_TEST_CONTEXT) {
    throw new Error("测试账本只能在Node测试进程中重置");
  }
  await ledgerQueue;
  await rm(TEST_LEDGER_DIRECTORY, { recursive: true, force: true });
  failNextLedgerWriteForTests = false;
}

export function failNextIPSourceLedgerWriteForTests(): void {
  if (!process.env.NODE_TEST_CONTEXT) {
    throw new Error("测试写入故障只能在Node测试进程中使用");
  }
  failNextLedgerWriteForTests = true;
}

export async function advanceIPSourceLedger(input: {
  sourceId: string;
  ipId: string;
  expectedNonce: number;
  expectedDigest: string;
  nextNonce: number;
  nextDigest: string;
}): Promise<boolean> {
  return withLedgerQueue(async ledger => {
    const current = ledger[input.sourceId];
    if (!current || current.kind !== "v2" || current.ipId !== input.ipId
      || current.currentNonce !== input.expectedNonce
      || current.lastDigest !== input.expectedDigest
      || current.finalizedDigest !== null) return false;
    ledger[input.sourceId] = {
      ...current,
      currentNonce: input.nextNonce,
      lastDigest: input.nextDigest,
    };
    await writeLedger(ledger);
    return true;
  });
}

export async function finalizeIPSourceLedger(input: {
  sourceId: string;
  ipId: string;
  expectedNonce: number;
  expectedDigest: string;
  finalDigest: string;
}): Promise<boolean> {
  return withLedgerQueue(async ledger => {
    const current = ledger[input.sourceId];
    if (!current || current.kind !== "v2" || current.ipId !== input.ipId
      || current.currentNonce !== input.expectedNonce
      || current.lastDigest !== input.expectedDigest) return false;
    if (current.finalizedDigest !== null && current.finalizedDigest !== input.finalDigest) return false;
    current.finalizedDigest = input.finalDigest;
    await writeLedger(ledger);
    return true;
  });
}

export async function confirmAndFinalizeIPSourceLedger(input: {
  sourceId: string;
  ipId: string;
  expectedNonce: number;
  expectedDigest: string;
  nextNonce: number;
  nextDigest: string;
  finalDigest: string;
}): Promise<boolean> {
  return withLedgerQueue(async ledger => {
    const current = ledger[input.sourceId];
    if (!current || current.kind !== "v2" || current.ipId !== input.ipId
      || current.currentNonce !== input.expectedNonce
      || current.lastDigest !== input.expectedDigest
      || current.finalizedDigest !== null) return false;
    ledger[input.sourceId] = {
      ...current,
      currentNonce: input.nextNonce,
      lastDigest: input.nextDigest,
      finalizedDigest: input.finalDigest,
    };
    await writeLedger(ledger);
    return true;
  });
}

export async function verifyFinalizedIPSourceLedger(input: {
  sourceId: string;
  ipId: string;
  nonce: number;
  digest: string;
  finalDigest: string;
}): Promise<boolean> {
  return withLedgerQueue(ledger => {
    const current = ledger[input.sourceId];
    return Boolean(current
      && current.kind === "v2"
      && current.ipId === input.ipId
      && current.currentNonce === input.nonce
      && current.lastDigest === input.digest
      && current.finalizedDigest === input.finalDigest);
  });
}
