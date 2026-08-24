import { calculateSHA256 } from "./sha256";

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

export function calculateScriptDirectorRuleContentHash(value: string): string {
  return calculateSHA256(value);
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
