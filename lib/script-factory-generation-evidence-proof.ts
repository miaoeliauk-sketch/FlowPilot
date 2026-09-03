import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { CoverageSourceReference } from "./script-factory-coverage";
import type { ScriptFactCaseEvidence } from "./script-factory-contract";

const PROOF_VERSION = 1;

export interface ScriptGenerationAuditContent {
  outline: Array<{
    label: string;
    timeRange: string;
    content: string;
    subPoints: string[];
  }>;
  pendingVerification: string[];
}

export interface ScriptGenerationNonEvidenceReference {
  id: string;
  title: string;
  category: string;
  reason: string;
  evidenceRole: "non_evidence";
}

export interface ScriptGenerationEvidenceClaims {
  generationEvidenceId: string;
  ipId: string;
  contentDigest: string;
  sourcesDigest: string;
  sources: CoverageSourceReference[];
  caseEvidence: ScriptFactCaseEvidence | null;
  nonEvidenceReferences: ScriptGenerationNonEvidenceReference[];
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

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function encryptionKey(secret: string): Buffer {
  return createHash("sha256")
    .update(`script-generation-evidence-encryption:${secret}`)
    .digest();
}

export function digestScriptGenerationAuditContent(content: ScriptGenerationAuditContent): string {
  return digest(content);
}

export function digestScriptGenerationEvidenceProof(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createScriptGenerationEvidenceProof(input: {
  ipId: string;
  content: ScriptGenerationAuditContent;
  sources: CoverageSourceReference[];
  caseEvidence: ScriptFactCaseEvidence | null;
  nonEvidenceReferences: ScriptGenerationNonEvidenceReference[];
}, secret: string): string {
  const claims: ScriptGenerationEvidenceClaims = {
    generationEvidenceId: randomUUID(),
    ipId: input.ipId,
    contentDigest: digestScriptGenerationAuditContent(input.content),
    sourcesDigest: digest({ sources: input.sources, caseEvidence: input.caseEvidence }),
    sources: input.sources,
    caseEvidence: input.caseEvidence,
    nonEvidenceReferences: input.nonEvidenceReferences,
  };
  const plaintext = Buffer.from(JSON.stringify({
    v: PROOF_VERSION,
    kind: "script_generation_evidence",
    ...claims,
  }), "utf8");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const protectedPayload = [
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
  return `${protectedPayload}.${signature(protectedPayload, secret)}`;
}

function isSourceReference(value: unknown): value is CoverageSourceReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return typeof source.sourceId === "string" && Boolean(source.sourceId.trim())
    && typeof source.sourceTitle === "string"
    && typeof source.itemId === "string" && Boolean(source.itemId.trim())
    && ["question", "claim", "reasoning", "evidence", "concept", "topic", "expression"].includes(String(source.kind))
    && typeof source.content === "string"
    && typeof source.originalExcerpt === "string"
    && typeof source.extractionStatus === "string";
}

function isNonEvidenceReference(value: unknown): value is ScriptGenerationNonEvidenceReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const reference = value as Record<string, unknown>;
  return typeof reference.id === "string" && Boolean(reference.id.trim())
    && typeof reference.title === "string" && Boolean(reference.title.trim())
    && typeof reference.category === "string" && Boolean(reference.category.trim())
    && typeof reference.reason === "string" && Boolean(reference.reason.trim())
    && reference.evidenceRole === "non_evidence";
}

function isCaseEvidence(value: unknown): value is ScriptFactCaseEvidence | null {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const evidence = value as Record<string, unknown>;
  const allowed = new Set(["title", "content", "sourceType", "verificationStatus", "sourceUrl", "occurredAt"]);
  return Object.keys(evidence).every(key => allowed.has(key))
    && typeof evidence.title === "string"
    && typeof evidence.sourceType === "string"
    && typeof evidence.verificationStatus === "string"
    && ["content", "sourceUrl", "occurredAt"].every(
      key => evidence[key] === undefined || typeof evidence[key] === "string",
    );
}

export function readVerifiedScriptGenerationEvidenceProof(
  token: string,
  secret: string,
): ScriptGenerationEvidenceClaims | null {
  const [ivValue, ciphertextValue, authTagValue, suppliedSignature, extra] = token.split(".");
  if (!ivValue || !ciphertextValue || !authTagValue || !suppliedSignature || extra !== undefined) return null;
  const protectedPayload = `${ivValue}.${ciphertextValue}.${authTagValue}`;
  const expectedSignature = signature(protectedPayload, secret);
  const suppliedBytes = Buffer.from(suppliedSignature);
  const expectedBytes = Buffer.from(expectedSignature);
  if (suppliedBytes.length !== expectedBytes.length
    || !timingSafeEqual(suppliedBytes, expectedBytes)) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(secret),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]);
    const decoded = JSON.parse(plaintext.toString("utf8")) as Record<string, unknown>;
    if (decoded.v !== PROOF_VERSION || decoded.kind !== "script_generation_evidence"
      || typeof decoded.generationEvidenceId !== "string" || !decoded.generationEvidenceId.trim()
      || typeof decoded.ipId !== "string" || !decoded.ipId.trim()
      || typeof decoded.contentDigest !== "string" || !/^[a-f0-9]{64}$/.test(decoded.contentDigest)
      || typeof decoded.sourcesDigest !== "string" || !/^[a-f0-9]{64}$/.test(decoded.sourcesDigest)
      || !Array.isArray(decoded.sources)
      || !decoded.sources.every(isSourceReference)
      || !isCaseEvidence(decoded.caseEvidence)
      || !Array.isArray(decoded.nonEvidenceReferences) || decoded.nonEvidenceReferences.length > 120
      || !decoded.nonEvidenceReferences.every(isNonEvidenceReference)
      || digest({ sources: decoded.sources, caseEvidence: decoded.caseEvidence }) !== decoded.sourcesDigest) return null;
    return {
      generationEvidenceId: decoded.generationEvidenceId,
      ipId: decoded.ipId,
      contentDigest: decoded.contentDigest,
      sourcesDigest: decoded.sourcesDigest,
      sources: decoded.sources,
      caseEvidence: decoded.caseEvidence,
      nonEvidenceReferences: decoded.nonEvidenceReferences,
    };
  } catch {
    return null;
  }
}
