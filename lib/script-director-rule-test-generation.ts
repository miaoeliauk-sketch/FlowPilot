import type { ScriptDirectorRuleTestType } from "./script-director-rule";

export interface ScriptDirectorRuleTestGenerationResult {
  testType: ScriptDirectorRuleTestType;
  topic: string;
  title: string;
  fullScript: string;
}

export class ScriptDirectorRuleTestGenerationError extends Error {
  readonly diagnosticCode: "INVALID_JSON" | "INVALID_FIELDS";

  constructor(diagnosticCode: ScriptDirectorRuleTestGenerationError["diagnosticCode"], message: string) {
    super(message);
    this.name = "ScriptDirectorRuleTestGenerationError";
    this.diagnosticCode = diagnosticCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseScriptDirectorRuleTestGeneration(
  content: string,
  context: { testType: ScriptDirectorRuleTestType; topic: string },
): ScriptDirectorRuleTestGenerationResult {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new ScriptDirectorRuleTestGenerationError("INVALID_JSON", "测试稿不是合法JSON");
  }
  if (!isRecord(value)
    || Object.keys(value).sort().join(",") !== "fullScript,title"
    || typeof value.title !== "string"
    || !value.title.trim()
    || value.title.length > 200
    || typeof value.fullScript !== "string"
    || !value.fullScript.trim()
    || value.fullScript.length > 8_000) {
    throw new ScriptDirectorRuleTestGenerationError("INVALID_FIELDS", "测试稿字段不完整");
  }
  return {
    testType: context.testType,
    topic: context.topic,
    title: value.title.trim(),
    fullScript: value.fullScript.trim(),
  };
}
