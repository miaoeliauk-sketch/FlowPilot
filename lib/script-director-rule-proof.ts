import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ScriptDirectorRuleTestType } from "./script-director-rule";

const PROOF_VERSION = 1;
const SECRET_FILE = path.join(process.cwd(), "data", ".script-director-rule-proof.key");

export interface ScriptDirectorRuleTestProofClaims {
  ipId: string;
  ruleId: string;
  contentHash: string;
  testType: ScriptDirectorRuleTestType;
}

export type ScriptDirectorRuleActivationProofClaims = Omit<ScriptDirectorRuleTestProofClaims, "testType"> & {
  activationId: string;
};

function encodedClaims(kind: "test" | "activation", claims: object): string {
  return Buffer.from(JSON.stringify({ v: PROOF_VERSION, kind, ...claims }), "utf8").toString("base64url");
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createScriptDirectorRuleTestProof(
  claims: ScriptDirectorRuleTestProofClaims,
  secret: string,
): string {
  const payload = encodedClaims("test", claims);
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyScriptDirectorRuleTestProof(
  proof: string,
  expected: ScriptDirectorRuleTestProofClaims,
  secret: string,
): boolean {
  const [payload, suppliedSignature, extra] = proof.split(".");
  if (!payload || !suppliedSignature || extra !== undefined) return false;
  const expectedSignature = signature(payload, secret);
  const suppliedBytes = Buffer.from(suppliedSignature);
  const expectedBytes = Buffer.from(expectedSignature);
  if (suppliedBytes.length !== expectedBytes.length
    || !timingSafeEqual(suppliedBytes, expectedBytes)) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    return decoded.v === PROOF_VERSION
      && decoded.kind === "test"
      && decoded.ipId === expected.ipId
      && decoded.ruleId === expected.ruleId
      && decoded.contentHash === expected.contentHash
      && decoded.testType === expected.testType;
  } catch {
    return false;
  }
}

export function createScriptDirectorRuleActivationProof(
  claims: ScriptDirectorRuleActivationProofClaims,
  secret: string,
): string {
  const payload = encodedClaims("activation", claims);
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyScriptDirectorRuleActivationProof(
  proof: string,
  expected: ScriptDirectorRuleActivationProofClaims,
  secret: string,
): boolean {
  const [payload, suppliedSignature, extra] = proof.split(".");
  if (!payload || !suppliedSignature || extra !== undefined) return false;
  const expectedSignature = signature(payload, secret);
  const suppliedBytes = Buffer.from(suppliedSignature);
  const expectedBytes = Buffer.from(expectedSignature);
  if (suppliedBytes.length !== expectedBytes.length
    || !timingSafeEqual(suppliedBytes, expectedBytes)) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    return decoded.v === PROOF_VERSION
      && decoded.kind === "activation"
      && decoded.ipId === expected.ipId
      && decoded.ruleId === expected.ruleId
      && decoded.contentHash === expected.contentHash
      && decoded.activationId === expected.activationId;
  } catch {
    return false;
  }
}

let secretPromise: Promise<string> | null = null;

export function assertScriptDirectorRuleProofConfiguration(input: {
  nodeEnv: string | undefined;
  configuredSecret: string | undefined;
}): void {
  if (input.configuredSecret && input.configuredSecret.length < 32) {
    throw new Error("专属编导规则验证密钥长度不足");
  }
  if (input.nodeEnv === "production" && !input.configuredSecret) {
    throw new Error("非本地环境必须配置固定密钥FLOWPILOT_SCRIPT_DIRECTOR_PROOF_SECRET");
  }
}

async function loadOrCreateSecret(): Promise<string> {
  const configured = process.env.FLOWPILOT_SCRIPT_DIRECTOR_PROOF_SECRET;
  assertScriptDirectorRuleProofConfiguration({
    nodeEnv: process.env.NODE_ENV,
    configuredSecret: configured,
  });
  if (configured) {
    return configured;
  }

  try {
    const existing = (await readFile(SECRET_FILE, "utf8")).trim();
    if (existing.length < 32) throw new Error("专属编导规则验证密钥文件损坏");
    return existing;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (code && code !== "ENOENT") throw error;
  }

  await mkdir(path.dirname(SECRET_FILE), { recursive: true, mode: 0o700 });
  const created = randomBytes(32).toString("base64url");
  try {
    await writeFile(SECRET_FILE, `${created}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return created;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (code !== "EEXIST") throw error;
    const existing = (await readFile(SECRET_FILE, "utf8")).trim();
    if (existing.length < 32) throw new Error("专属编导规则验证密钥文件损坏");
    return existing;
  }
}

export function getScriptDirectorRuleProofSecret(): Promise<string> {
  secretPromise ??= loadOrCreateSecret();
  return secretPromise;
}
