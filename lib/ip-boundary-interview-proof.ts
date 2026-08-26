import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IPSourceAnalysisV2 } from "./types";

const PROOF_VERSION = 1;
export const EPHEMERAL_COGNITION_TTL_MS = 30 * 60 * 1000;

export interface EphemeralCognitionProofClaims {
  ipId: string;
  topicId: string;
  topicHash: string;
  sourceId: string;
  analysisDigest: string;
  issuedAt: number;
  expiresAt: number;
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
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function buildEphemeralCognitionProofClaims(input: {
  ipId: string;
  topicId: string;
  topic: string;
  sourceId: string;
  analysis: IPSourceAnalysisV2;
  issuedAt?: number;
}): EphemeralCognitionProofClaims {
  const issuedAt = input.issuedAt ?? Date.now();
  return {
    ipId: input.ipId,
    topicId: input.topicId,
    topicHash: digest(input.topic.trim()),
    sourceId: input.sourceId,
    analysisDigest: digest(input.analysis),
    issuedAt,
    expiresAt: issuedAt + EPHEMERAL_COGNITION_TTL_MS,
  };
}

export function createEphemeralCognitionProof(
  claims: EphemeralCognitionProofClaims,
  secret: string,
): string {
  const payload = Buffer.from(JSON.stringify({
    v: PROOF_VERSION,
    kind: "ephemeral_cognition",
    ...claims,
  }), "utf8").toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyEphemeralCognitionProof(input: {
  token: string;
  ipId: string;
  topicId: string;
  topic: string;
  sourceId: string;
  analysis: IPSourceAnalysisV2;
  secret: string;
  now?: number;
}): boolean {
  const [payload, suppliedSignature, extra] = input.token.split(".");
  if (!payload || !suppliedSignature || extra !== undefined) return false;
  const expectedSignature = signature(payload, input.secret);
  const suppliedBytes = Buffer.from(suppliedSignature);
  const expectedBytes = Buffer.from(expectedSignature);
  if (suppliedBytes.length !== expectedBytes.length
    || !timingSafeEqual(suppliedBytes, expectedBytes)) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const now = input.now ?? Date.now();
    return claims.v === PROOF_VERSION
      && claims.kind === "ephemeral_cognition"
      && claims.ipId === input.ipId
      && claims.topicId === input.topicId
      && claims.topicHash === digest(input.topic.trim())
      && claims.sourceId === input.sourceId
      && claims.analysisDigest === digest(input.analysis)
      && typeof claims.issuedAt === "number"
      && typeof claims.expiresAt === "number"
      && claims.expiresAt > claims.issuedAt
      && now >= claims.issuedAt
      && now <= claims.expiresAt;
  } catch {
    return false;
  }
}
