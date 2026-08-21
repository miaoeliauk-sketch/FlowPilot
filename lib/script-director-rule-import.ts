import {
  calculateScriptDirectorRuleContentHash,
  parseScriptDirectorRule,
  type ScriptDirectorRule,
} from "./script-director-rule";

export interface ScriptDirectorRuleImportContext {
  ipId: string;
  ipName: string;
  rawMarkdown: string;
  fileName: string | null;
  importedAt: string;
  version: string;
}

export class ScriptDirectorRuleImportError extends Error {
  readonly diagnosticCode: "INVALID_JSON" | "INVALID_FIELDS" | "INVALID_CONTRACT";
  readonly retryInstruction: string;

  constructor(
    diagnosticCode: ScriptDirectorRuleImportError["diagnosticCode"],
    message: string,
    retryInstruction: string,
  ) {
    super(message);
    this.name = "ScriptDirectorRuleImportError";
    this.diagnosticCode = diagnosticCode;
    this.retryInstruction = retryInstruction;
  }
}

const ANALYSIS_FIELDS = [
  "targetAudience",
  "language",
  "opening",
  "body",
  "ending",
  "examples",
  "compression",
  "specialRules",
  "validationRequirements",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseScriptDirectorRuleImportResponse(
  content: string,
  context: ScriptDirectorRuleImportContext,
): ScriptDirectorRule {
  let analysis: unknown;
  try {
    analysis = JSON.parse(content);
  } catch {
    throw new ScriptDirectorRuleImportError(
      "INVALID_JSON",
      "AI返回的专属规则不是合法JSON",
      "只输出一个完整JSON对象，不要使用Markdown代码块，也不要输出解释。",
    );
  }
  if (!isRecord(analysis)) {
    throw new ScriptDirectorRuleImportError(
      "INVALID_FIELDS",
      "AI返回的专属规则不是普通对象",
      "输出必须是一个JSON对象，并完整包含要求的规则字段。",
    );
  }

  const actualFields = Object.keys(analysis).sort();
  const expectedFields = [...ANALYSIS_FIELDS].sort();
  if (actualFields.length !== expectedFields.length
    || actualFields.some((field, index) => field !== expectedFields[index])) {
    throw new ScriptDirectorRuleImportError(
      "INVALID_FIELDS",
      "AI返回的专属规则字段不完整或包含未授权字段",
      `仅输出这些顶层字段：${ANALYSIS_FIELDS.join("、")}。不得输出IP编号、原文、哈希或状态。`,
    );
  }

  const contentHash = calculateScriptDirectorRuleContentHash(context.rawMarkdown);
  const candidate = {
    id: `director-rule:${context.ipId}:${context.version}:${contentHash.slice(0, 12)}`,
    ipId: context.ipId,
    name: `${context.ipName}专属编导规则`,
    version: context.version,
    status: "draft",
    source: {
      type: "markdown",
      fileName: context.fileName,
      rawMarkdown: context.rawMarkdown,
      contentHash,
      importedAt: context.importedAt,
    },
    profileContext: {
      ipNameSnapshot: context.ipName,
      source: "ip_profile",
      usePlatformPositioningFromProfile: true,
    },
    ...analysis,
    createdAt: context.importedAt,
    updatedAt: context.importedAt,
  };
  const parsed = parseScriptDirectorRule(candidate);
  if (!parsed.ok) {
    throw new ScriptDirectorRuleImportError(
      "INVALID_CONTRACT",
      parsed.error,
      `严格修正字段类型和规则元数据。每条规则必须包含level、enforcement、scope；结构化案例数量和压缩比例也必须包含这3项。具体错误：${parsed.error}`,
    );
  }
  return parsed.rule;
}
