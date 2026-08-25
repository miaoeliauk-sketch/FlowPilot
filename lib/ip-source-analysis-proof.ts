import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { IPSourceAnalysisItem, IPSourceAnalysisV2 } from "./types";

const PROOF_VERSION = 1;
const SECRET_FILE = path.join(process.cwd(), "data", ".ip-source-analysis-proof.key");

export interface IPSourceAnalysisProofClaims {
  ipId: string;
  sourceId: string;
  sourceHash: string;
  nonce: number;
  nodesHash: string;
  suggestionsHash: string;
  reviewStateHash: string;
}

export interface IPSourceFinalProofClaims {
  ipId: string;
  sourceId: string;
  sourceHash: string;
  nonce: number;
  analysisDigest: string;
  contextDigest: string;
}

export interface IPSourceLegacyProofClaims {
  ipId: string;
  sourceId: string;
  sourceHash: string;
  contextDigest: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function immutableNodes(analysis: IPSourceAnalysisV2) {
  return analysis.nodes.map(node => ({
    id: node.id,
    question: node.question,
    claim: node.claim,
    reasoning: node.reasoning,
    evidence: node.evidence,
    concepts: node.concepts,
  }));
}

export function buildIPSourceAnalysisProofClaims(input: {
  ipId: string;
  analysis: IPSourceAnalysisV2;
}): IPSourceAnalysisProofClaims {
  return {
    ipId: input.ipId,
    sourceId: input.analysis.sourceId,
    sourceHash: input.analysis.sourceHash,
    nonce: input.analysis.nonce,
    nodesHash: digest(immutableNodes(input.analysis)),
    suggestionsHash: digest(input.analysis.aiSuggestions),
    reviewStateHash: digest(input.analysis.nodes.map(node => ({
      id: node.id,
      reviewStatus: node.reviewStatus,
      humanRevision: node.humanRevision ?? null,
    }))),
  };
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createIPSourceAnalysisToken(
  claims: IPSourceAnalysisProofClaims,
  secret: string,
): string {
  const payload = Buffer.from(JSON.stringify({
    v: PROOF_VERSION,
    kind: "ip_source_analysis",
    ...claims,
  }), "utf8").toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyIPSourceAnalysisToken(
  token: string,
  expected: IPSourceAnalysisProofClaims,
  secret: string,
): boolean {
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra !== undefined) return false;
  const expectedSignature = signature(payload, secret);
  const suppliedBytes = Buffer.from(suppliedSignature);
  const expectedBytes = Buffer.from(expectedSignature);
  if (suppliedBytes.length !== expectedBytes.length
    || !timingSafeEqual(suppliedBytes, expectedBytes)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    return decoded.v === PROOF_VERSION
      && decoded.kind === "ip_source_analysis"
      && decoded.ipId === expected.ipId
      && decoded.sourceId === expected.sourceId
      && decoded.sourceHash === expected.sourceHash
      && decoded.nonce === expected.nonce
      && decoded.nodesHash === expected.nodesHash
      && decoded.suggestionsHash === expected.suggestionsHash
      && decoded.reviewStateHash === expected.reviewStateHash;
  } catch {
    return false;
  }
}

export function digestIPSourceAnalysisProofClaims(
  claims: IPSourceAnalysisProofClaims,
): string {
  return digest(claims);
}

export function buildIPSourceFinalProofClaims(input: {
  ipId: string;
  analysis: IPSourceAnalysisV2;
  contextItems: IPSourceAnalysisItem[];
}): IPSourceFinalProofClaims {
  return {
    ipId: input.ipId,
    sourceId: input.analysis.sourceId,
    sourceHash: input.analysis.sourceHash,
    nonce: input.analysis.nonce,
    analysisDigest: digest(buildIPSourceAnalysisProofClaims({
      ipId: input.ipId,
      analysis: input.analysis,
    })),
    contextDigest: calculateIPSourceContextDigest(input.contextItems),
  };
}

export function calculateIPSourceContextDigest(items: IPSourceAnalysisItem[]): string {
  return digest(items.map(item => ({
    id: item.id,
    kind: item.kind,
    content: item.content.trim(),
    originalExcerpt: item.originalExcerpt.trim(),
    extractionStatus: item.extractionStatus,
  })));
}

export function buildIPSourceLegacyProofClaims(input: {
  ipId: string;
  sourceId: string;
  rawContent: string;
  contextItems: IPSourceAnalysisItem[];
}): IPSourceLegacyProofClaims {
  return {
    ipId: input.ipId,
    sourceId: input.sourceId,
    sourceHash: createHash("sha256").update(input.rawContent).digest("hex"),
    contextDigest: calculateIPSourceContextDigest(input.contextItems),
  };
}

export function digestIPSourceLegacyProofClaims(claims: IPSourceLegacyProofClaims): string {
  return digest(claims);
}

export function createIPSourceLegacyProof(
  claims: IPSourceLegacyProofClaims,
  secret: string,
): string {
  const payload = Buffer.from(JSON.stringify({
    v: PROOF_VERSION,
    kind: "ip_source_legacy",
    ...claims,
  }), "utf8").toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function readVerifiedIPSourceLegacyProof(
  token: string,
  secret: string,
): IPSourceLegacyProofClaims | null {
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra !== undefined) return null;
  const expectedSignature = signature(payload, secret);
  const suppliedBytes = Buffer.from(suppliedSignature);
  const expectedBytes = Buffer.from(expectedSignature);
  if (suppliedBytes.length !== expectedBytes.length
    || !timingSafeEqual(suppliedBytes, expectedBytes)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (decoded.v !== PROOF_VERSION || decoded.kind !== "ip_source_legacy"
      || typeof decoded.ipId !== "string" || !decoded.ipId.trim()
      || typeof decoded.sourceId !== "string" || !decoded.sourceId.trim()
      || typeof decoded.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(decoded.sourceHash)
      || typeof decoded.contextDigest !== "string" || !/^[a-f0-9]{64}$/.test(decoded.contextDigest)) {
      return null;
    }
    return {
      ipId: decoded.ipId,
      sourceId: decoded.sourceId,
      sourceHash: decoded.sourceHash,
      contextDigest: decoded.contextDigest,
    };
  } catch {
    return null;
  }
}

export function digestIPSourceFinalProofClaims(claims: IPSourceFinalProofClaims): string {
  return digest(claims);
}

export function createIPSourceFinalProof(
  claims: IPSourceFinalProofClaims,
  secret: string,
): string {
  const payload = Buffer.from(JSON.stringify({
    v: PROOF_VERSION,
    kind: "ip_source_final",
    ...claims,
  }), "utf8").toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyIPSourceFinalProof(
  token: string,
  expected: IPSourceFinalProofClaims,
  secret: string,
): boolean {
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra !== undefined) return false;
  const expectedSignature = signature(payload, secret);
  const suppliedBytes = Buffer.from(suppliedSignature);
  const expectedBytes = Buffer.from(expectedSignature);
  if (suppliedBytes.length !== expectedBytes.length
    || !timingSafeEqual(suppliedBytes, expectedBytes)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    return decoded.v === PROOF_VERSION
      && decoded.kind === "ip_source_final"
      && decoded.ipId === expected.ipId
      && decoded.sourceId === expected.sourceId
      && decoded.sourceHash === expected.sourceHash
      && decoded.nonce === expected.nonce
      && decoded.analysisDigest === expected.analysisDigest
      && decoded.contextDigest === expected.contextDigest;
  } catch {
    return false;
  }
}

export function readVerifiedIPSourceFinalProof(
  token: string,
  secret: string,
): IPSourceFinalProofClaims | null {
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra !== undefined) return null;
  const expectedSignature = signature(payload, secret);
  const suppliedBytes = Buffer.from(suppliedSignature);
  const expectedBytes = Buffer.from(expectedSignature);
  if (suppliedBytes.length !== expectedBytes.length
    || !timingSafeEqual(suppliedBytes, expectedBytes)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (decoded.v !== PROOF_VERSION || decoded.kind !== "ip_source_final"
      || typeof decoded.ipId !== "string" || !decoded.ipId.trim()
      || typeof decoded.sourceId !== "string" || !decoded.sourceId.trim()
      || typeof decoded.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(decoded.sourceHash)
      || !Number.isInteger(decoded.nonce) || (decoded.nonce as number) < 1
      || typeof decoded.analysisDigest !== "string" || !/^[a-f0-9]{64}$/.test(decoded.analysisDigest)
      || typeof decoded.contextDigest !== "string" || !/^[a-f0-9]{64}$/.test(decoded.contextDigest)) {
      return null;
    }
    return {
      ipId: decoded.ipId,
      sourceId: decoded.sourceId,
      sourceHash: decoded.sourceHash,
      nonce: decoded.nonce as number,
      analysisDigest: decoded.analysisDigest,
      contextDigest: decoded.contextDigest,
    };
  } catch {
    return null;
  }
}

let secretPromise: Promise<string> | null = null;

export function assertIPSourceAnalysisProofConfiguration(input: {
  nodeEnv: string | undefined;
  configuredSecret: string | undefined;
}): void {
  if (input.configuredSecret && input.configuredSecret.length < 32) {
    throw new Error("认知解析凭证密钥长度不足");
  }
  if (input.nodeEnv === "production" && !input.configuredSecret) {
    throw new Error("非本地环境必须配置固定密钥FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET");
  }
}

async function loadOrCreateSecret(): Promise<string> {
  const configured = process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET;
  assertIPSourceAnalysisProofConfiguration({
    nodeEnv: process.env.NODE_ENV,
    configuredSecret: configured,
  });
  if (configured) return configured;

  try {
    const existing = (await readFile(SECRET_FILE, "utf8")).trim();
    if (existing.length < 32) throw new Error("认知解析凭证密钥文件损坏");
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
    if (existing.length < 32) throw new Error("认知解析凭证密钥文件损坏");
    return existing;
  }
}

export function getIPSourceAnalysisProofSecret(): Promise<string> {
  secretPromise ??= loadOrCreateSecret();
  return secretPromise;
}
