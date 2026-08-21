export type ScriptDirectorRuleStatus = "draft" | "pending_validation" | "active" | "inactive";
export type ScriptDirectorRuleLevel = "hard_block" | "quality_warning" | "preference";
export type ScriptDirectorRuleEnforcement = "deterministic" | "model_review" | "prompt_only";
export type ScriptDirectorRuleScope =
  | "title"
  | "opening"
  | "body"
  | "ending"
  | "fact"
  | "attribution"
  | "compression"
  | "output";
export type ScriptDirectorRuleTestType = "familiar" | "unfamiliar" | "stress";

export interface ScriptDirectorRuleTestValidation {
  completedAt: string;
  testTypes: ScriptDirectorRuleTestType[];
  proofs?: Record<ScriptDirectorRuleTestType, string>;
  activationProof?: string;
}

export interface ScriptDirectorRuleItem {
  id: string;
  text: string;
  level: ScriptDirectorRuleLevel;
  enforcement: ScriptDirectorRuleEnforcement;
  scope: ScriptDirectorRuleScope;
}

export interface ScriptDirectorRuleExample {
  id: string;
  kind: "title" | "opening" | "ending" | "body";
  content: string;
  demonstrates: string;
  sourceReference: string;
  confirmationStatus: "confirmed" | "unconfirmed";
  materialPermission: false;
  protectedEntities: string[];
}

export interface ScriptDirectorRule {
  id: string;
  ipId: string;
  name: string;
  version: string;
  status: ScriptDirectorRuleStatus;
  source: {
    type: "markdown" | "built_in";
    fileName: string | null;
    rawMarkdown: string;
    contentHash: string;
    importedAt: string;
  };
  profileContext: {
    ipNameSnapshot: string;
    source: "ip_profile";
    usePlatformPositioningFromProfile: true;
  };
  targetAudience: string[];
  language: {
    catchphrases: ScriptDirectorRuleItem[];
    forbiddenExpressions: ScriptDirectorRuleItem[];
    toneGuidelines: ScriptDirectorRuleItem[];
  };
  opening: {
    requirements: ScriptDirectorRuleItem[];
    forbiddenPatterns: ScriptDirectorRuleItem[];
  };
  body: {
    reasoningSequence: ScriptDirectorRuleItem[];
    casePolicy: {
      maximumCasesPerClaim: number | null;
      level: ScriptDirectorRuleLevel;
      enforcement: ScriptDirectorRuleEnforcement;
      scope: "body";
      requirements: ScriptDirectorRuleItem[];
    };
    materialPolicies: ScriptDirectorRuleItem[];
  };
  ending: {
    requirements: ScriptDirectorRuleItem[];
    forbiddenPatterns: ScriptDirectorRuleItem[];
  };
  examples: ScriptDirectorRuleExample[];
  compression: {
    enabled: boolean;
    targetReduction: {
      minimumPercent: number;
      maximumPercent: number;
      level: ScriptDirectorRuleLevel;
      enforcement: ScriptDirectorRuleEnforcement;
      scope: "compression";
    } | null;
    mustKeep: ScriptDirectorRuleItem[];
    preferRemove: ScriptDirectorRuleItem[];
    otherRequirements: ScriptDirectorRuleItem[];
  };
  specialRules: ScriptDirectorRuleItem[];
  validationRequirements: ScriptDirectorRuleItem[];
  testValidation?: ScriptDirectorRuleTestValidation;
  createdAt: string;
  updatedAt: string;
}

export type CreateScriptDirectorRuleInput = Omit<
  ScriptDirectorRule,
  "id" | "status" | "source" | "createdAt" | "updatedAt"
> & {
  rawMarkdown: string;
  fileName: string | null;
  importedAt: string;
  sourceType?: "markdown" | "built_in";
};

export type ParseScriptDirectorRuleResult =
  | { ok: true; rule: ScriptDirectorRule }
  | { ok: false; error: string };

const RULE_LEVELS = new Set<ScriptDirectorRuleLevel>(["hard_block", "quality_warning", "preference"]);
const RULE_ENFORCEMENTS = new Set<ScriptDirectorRuleEnforcement>(["deterministic", "model_review", "prompt_only"]);
const RULE_SCOPES = new Set<ScriptDirectorRuleScope>([
  "title", "opening", "body", "ending", "fact", "attribution", "compression", "output",
]);
const RULE_STATUSES = new Set<ScriptDirectorRuleStatus>(["draft", "pending_validation", "active", "inactive"]);
const RULE_TEST_TYPES = new Set<ScriptDirectorRuleTestType>(["familiar", "unfamiliar", "stress"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function validateRuleItems(value: unknown, path: string): string | null {
  if (!Array.isArray(value)) return path;
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isRecord(item)) return `${path}[${index}]`;
    if (!isNonEmptyString(item.id)) return `${path}[${index}].id`;
    if (!isNonEmptyString(item.text)) return `${path}[${index}].text`;
    if (!RULE_LEVELS.has(item.level as ScriptDirectorRuleLevel)) return `${path}[${index}].level`;
    if (!RULE_ENFORCEMENTS.has(item.enforcement as ScriptDirectorRuleEnforcement)) return `${path}[${index}].enforcement`;
    if (!RULE_SCOPES.has(item.scope as ScriptDirectorRuleScope)) return `${path}[${index}].scope`;
  }
  return null;
}

function validateExample(value: unknown, path: string): string | null {
  if (!isRecord(value)) return path;
  if (!isNonEmptyString(value.id)) return `${path}.id`;
  if (!new Set(["title", "opening", "ending", "body"]).has(String(value.kind))) return `${path}.kind`;
  if (!isNonEmptyString(value.content)) return `${path}.content`;
  if (!isNonEmptyString(value.demonstrates)) return `${path}.demonstrates`;
  if (!isNonEmptyString(value.sourceReference)) return `${path}.sourceReference`;
  if (value.confirmationStatus !== "confirmed" && value.confirmationStatus !== "unconfirmed") {
    return `${path}.confirmationStatus`;
  }
  if (value.materialPermission !== false) return `${path}.materialPermission`;
  if (!isStringArray(value.protectedEntities)) return `${path}.protectedEntities`;
  return null;
}

function validateStructuredRuleMetadata(
  value: Record<string, unknown>,
  path: string,
  expectedScope: "body" | "compression",
): string | null {
  if (!RULE_LEVELS.has(value.level as ScriptDirectorRuleLevel)) return `${path}.level`;
  if (!RULE_ENFORCEMENTS.has(value.enforcement as ScriptDirectorRuleEnforcement)) return `${path}.enforcement`;
  if (value.scope !== expectedScope) return `${path}.scope`;
  return null;
}

function validationError(path: string): ParseScriptDirectorRuleResult {
  return { ok: false, error: `专属编导规则内容损坏：${path}` };
}

export function parseScriptDirectorRule(value: unknown): ParseScriptDirectorRuleResult {
  if (!isRecord(value)) return validationError("root");
  if (!isNonEmptyString(value.id)) return validationError("id");
  if (!isNonEmptyString(value.ipId)) return validationError("ipId");
  if (!isNonEmptyString(value.name)) return validationError("name");
  if (!isNonEmptyString(value.version) || !/^\d+\.\d+\.\d+$/.test(value.version)) return validationError("version");
  if (!RULE_STATUSES.has(value.status as ScriptDirectorRuleStatus)) return validationError("status");

  if (!isRecord(value.source)) return validationError("source");
  if (value.source.type !== "markdown" && value.source.type !== "built_in") return validationError("source.type");
  if (value.source.fileName !== null && typeof value.source.fileName !== "string") return validationError("source.fileName");
  if (typeof value.source.rawMarkdown !== "string") return validationError("source.rawMarkdown");
  if (typeof value.source.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(value.source.contentHash)) return validationError("source.contentHash");
  if (!isNonEmptyString(value.source.importedAt)) return validationError("source.importedAt");

  if (!isRecord(value.profileContext)) return validationError("profileContext");
  if (!isNonEmptyString(value.profileContext.ipNameSnapshot)) return validationError("profileContext.ipNameSnapshot");
  if (value.profileContext.source !== "ip_profile") return validationError("profileContext.source");
  if (value.profileContext.usePlatformPositioningFromProfile !== true) {
    return validationError("profileContext.usePlatformPositioningFromProfile");
  }
  if (!isStringArray(value.targetAudience)) return validationError("targetAudience");

  if (!isRecord(value.language)) return validationError("language");
  for (const field of ["catchphrases", "forbiddenExpressions", "toneGuidelines"] as const) {
    const error = validateRuleItems(value.language[field], `language.${field}`);
    if (error) return validationError(error);
  }

  for (const [sectionName, fields] of [
    ["opening", ["requirements", "forbiddenPatterns"]],
    ["body", ["reasoningSequence", "materialPolicies"]],
    ["ending", ["requirements", "forbiddenPatterns"]],
  ] as const) {
    const section = value[sectionName];
    if (!isRecord(section)) return validationError(sectionName);
    for (const field of fields) {
      const error = validateRuleItems(section[field], `${sectionName}.${field}`);
      if (error) return validationError(error);
    }
  }
  const body = value.body;
  if (!isRecord(body) || !isRecord(body.casePolicy)) return validationError("body.casePolicy");
  {
    const error = validateStructuredRuleMetadata(body.casePolicy, "body.casePolicy", "body");
    if (error) return validationError(error);
  }
  if (body.casePolicy.maximumCasesPerClaim !== null
    && (!Number.isInteger(body.casePolicy.maximumCasesPerClaim)
      || Number(body.casePolicy.maximumCasesPerClaim) < 1)) {
    return validationError("body.casePolicy.maximumCasesPerClaim");
  }
  {
    const error = validateRuleItems(body.casePolicy.requirements, "body.casePolicy.requirements");
    if (error) return validationError(error);
  }

  if (!Array.isArray(value.examples)) return validationError("examples");
  for (let index = 0; index < value.examples.length; index += 1) {
    const error = validateExample(value.examples[index], `examples[${index}]`);
    if (error) return validationError(error);
  }

  if (!isRecord(value.compression)) return validationError("compression");
  if (typeof value.compression.enabled !== "boolean") return validationError("compression.enabled");
  if (value.compression.targetReduction !== null) {
    if (!isRecord(value.compression.targetReduction)
      || typeof value.compression.targetReduction.minimumPercent !== "number"
      || typeof value.compression.targetReduction.maximumPercent !== "number"
      || !Number.isFinite(value.compression.targetReduction.minimumPercent)
      || !Number.isFinite(value.compression.targetReduction.maximumPercent)
      || value.compression.targetReduction.minimumPercent < 0
      || value.compression.targetReduction.maximumPercent > 100
      || value.compression.targetReduction.minimumPercent > value.compression.targetReduction.maximumPercent) {
      return validationError("compression.targetReduction");
    }
    const metadataError = validateStructuredRuleMetadata(
      value.compression.targetReduction,
      "compression.targetReduction",
      "compression",
    );
    if (metadataError) return validationError(metadataError);
  }
  if (value.compression.enabled && value.compression.targetReduction === null) {
    return validationError("compression.targetReduction");
  }
  for (const field of ["mustKeep", "preferRemove", "otherRequirements"] as const) {
    const error = validateRuleItems(value.compression[field], `compression.${field}`);
    if (error) return validationError(error);
  }
  for (const field of ["specialRules", "validationRequirements"] as const) {
    const error = validateRuleItems(value[field], field);
    if (error) return validationError(error);
  }
  if (value.testValidation !== undefined) {
    const testValidation = value.testValidation;
    if (!isRecord(testValidation)) return validationError("testValidation");
    if (!isNonEmptyString(testValidation.completedAt)) return validationError("testValidation.completedAt");
    if (!Array.isArray(testValidation.testTypes)
      || testValidation.testTypes.length !== RULE_TEST_TYPES.size
      || !testValidation.testTypes.every(item => RULE_TEST_TYPES.has(item as ScriptDirectorRuleTestType))
      || new Set(testValidation.testTypes).size !== RULE_TEST_TYPES.size) {
      return validationError("testValidation.testTypes");
    }
    const proofs = testValidation.proofs;
    if (proofs !== undefined) {
      if (!isRecord(proofs)
        || Object.keys(proofs).length !== RULE_TEST_TYPES.size
        || [...RULE_TEST_TYPES].some(testType => !isNonEmptyString(proofs[testType]))) {
        return validationError("testValidation.proofs");
      }
    }
    if (testValidation.activationProof !== undefined
      && !isNonEmptyString(testValidation.activationProof)) {
      return validationError("testValidation.activationProof");
    }
  }
  if (!isNonEmptyString(value.createdAt)) return validationError("createdAt");
  if (!isNonEmptyString(value.updatedAt)) return validationError("updatedAt");

  return { ok: true, rule: value as unknown as ScriptDirectorRule };
}

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

export function calculateScriptDirectorRuleContentHash(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 1 + 8) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15] ?? 0;
      const previous2 = words[index - 2] ?? 0;
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temporary1 = (h! + sum1 + choice + SHA256_ROUND_CONSTANTS[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    hash[0] = (hash[0]! + a!) >>> 0;
    hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0;
    hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0;
    hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0;
    hash[7] = (hash[7]! + h!) >>> 0;
  }

  return hash.map(word => word.toString(16).padStart(8, "0")).join("");
}

export async function createScriptDirectorRule(
  input: CreateScriptDirectorRuleInput,
): Promise<ScriptDirectorRule> {
  if (!input.ipId.trim()) throw new Error("规则归属IP不能为空");
  if (!/^\d+\.\d+\.\d+$/.test(input.version)) throw new Error("规则版本格式无效，请使用1.0.0格式");
  if (!input.name.trim()) throw new Error("规则名称不能为空");
  if (!input.rawMarkdown.trim()) throw new Error("规则原始文档不能为空");

  const contentHash = calculateScriptDirectorRuleContentHash(input.rawMarkdown);
  const rule: ScriptDirectorRule = {
    id: `director-rule:${input.ipId}:${input.version}:${contentHash.slice(0, 12)}`,
    ipId: input.ipId,
    name: input.name,
    version: input.version,
    status: "draft",
    source: {
      type: input.sourceType ?? "markdown",
      fileName: input.fileName,
      rawMarkdown: input.rawMarkdown,
      contentHash,
      importedAt: input.importedAt,
    },
    profileContext: input.profileContext,
    targetAudience: input.targetAudience,
    language: input.language,
    opening: input.opening,
    body: input.body,
    ending: input.ending,
    examples: input.examples,
    compression: input.compression,
    specialRules: input.specialRules,
    validationRequirements: input.validationRequirements,
    createdAt: input.importedAt,
    updatedAt: input.importedAt,
  };
  const parsed = parseScriptDirectorRule(rule);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.rule;
}
