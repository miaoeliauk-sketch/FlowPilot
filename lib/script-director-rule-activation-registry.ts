import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_STORE_PATH = path.join(process.cwd(), "data", "script-director-rule-activations.json");

export interface ActiveScriptDirectorRuleRecord {
  ipId: string;
  ruleId: string;
  contentHash: string;
  activationId: string;
  activatedAt: string;
}

let testStorePath: string | null = null;

function storePath(): string {
  return testStorePath ?? DEFAULT_STORE_PATH;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAll(): ActiveScriptDirectorRuleRecord[] {
  let raw: string;
  try {
    raw = readFileSync(storePath(), "utf8");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return [];
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("专属编导规则服务端启用记录损坏，已停止读取和写入");
  }
  if (!Array.isArray(value)) {
    throw new Error("专属编导规则服务端启用记录损坏，已停止读取和写入");
  }
  const records = value.map(item => {
    if (!isRecord(item)
      || typeof item.ipId !== "string" || !item.ipId.trim()
      || typeof item.ruleId !== "string" || !item.ruleId.trim()
      || typeof item.contentHash !== "string" || !/^[a-f0-9]{64}$/i.test(item.contentHash)
      || typeof item.activationId !== "string" || !item.activationId.trim()
      || typeof item.activatedAt !== "string" || !item.activatedAt.trim()) {
      throw new Error("专属编导规则服务端启用记录损坏，已停止读取和写入");
    }
    return item as unknown as ActiveScriptDirectorRuleRecord;
  });
  if (new Set(records.map(record => record.ipId)).size !== records.length) {
    throw new Error("专属编导规则服务端启用记录损坏，已停止读取和写入");
  }
  return records;
}

function writeAll(records: ActiveScriptDirectorRuleRecord[]): void {
  const target = storePath();
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(records, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, target);
}

export function getActiveScriptDirectorRuleOnServer(ipId: string): ActiveScriptDirectorRuleRecord | null {
  if (!ipId.trim()) return null;
  return readAll().find(record => record.ipId === ipId) ?? null;
}

export function activateScriptDirectorRuleOnServer(input: {
  ipId: string;
  ruleId: string;
  contentHash: string;
}): ActiveScriptDirectorRuleRecord {
  const all = readAll();
  const record: ActiveScriptDirectorRuleRecord = {
    ...input,
    activationId: randomUUID(),
    activatedAt: new Date().toISOString(),
  };
  writeAll([...all.filter(item => item.ipId !== input.ipId), record]);
  return record;
}

export function deactivateScriptDirectorRuleOnServer(
  ipId: string,
  ruleId: string,
  activationId: string,
): void {
  const all = readAll();
  const active = all.find(record => record.ipId === ipId);
  if (active && active.ruleId !== ruleId) {
    throw new Error("当前IP启用的是另一份专属编导规则，已拒绝停用");
  }
  if (active && active.activationId !== activationId) {
    throw new Error("专属编导规则启用版本已经变化，已拒绝停用");
  }
  writeAll(all.filter(record => record.ipId !== ipId));
}

export function setScriptDirectorRuleActivationStorePathForTests(value: string | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("生产环境不允许修改专属编导规则启用记录路径");
  }
  testStorePath = value;
}
