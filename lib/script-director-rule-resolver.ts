import {
  calculateScriptDirectorRuleContentHash,
  parseScriptDirectorRule,
  type ScriptDirectorRule,
} from "./script-director-rule";

export interface ScriptDirectorRuleRepository {
  getForIP(ipId: string, ruleId: string): ScriptDirectorRule | null;
}

export type ResolvedScriptDirectorRule =
  | {
    enabled: true;
    ruleId: string;
    version: string;
    source: "stored";
    promptBlock: string;
    rule: ScriptDirectorRule;
  }
  | {
    enabled: false;
    reason: "no_applicable_rule" | "rule_not_found" | "rule_not_active" | "rule_not_tested" | "rule_invalid" | "rule_ip_mismatch";
  };

export function resolveScriptDirectorRuleForGeneration(input: {
  generationMode: "standard" | "ip";
  ipId: string;
  activeRuleId: string | null | undefined;
  repository?: ScriptDirectorRuleRepository;
}): ResolvedScriptDirectorRule {
  if (input.generationMode !== "ip") {
    return { enabled: false, reason: "no_applicable_rule" };
  }

  if (input.activeRuleId) {
    const rule = input.repository?.getForIP(input.ipId, input.activeRuleId) ?? null;
    if (!rule) return { enabled: false, reason: "rule_not_found" };
    const parsed = parseScriptDirectorRule(rule);
    if (!parsed.ok) return { enabled: false, reason: "rule_invalid" };
    if (parsed.rule.ipId !== input.ipId) return { enabled: false, reason: "rule_ip_mismatch" };
    if (calculateScriptDirectorRuleContentHash(parsed.rule.source.rawMarkdown) !== parsed.rule.source.contentHash) {
      return { enabled: false, reason: "rule_invalid" };
    }
    if (!parsed.rule.testValidation) return { enabled: false, reason: "rule_not_tested" };
    if (parsed.rule.status !== "active") return { enabled: false, reason: "rule_not_active" };
    return {
      enabled: true,
      ruleId: parsed.rule.id,
      version: parsed.rule.version,
      source: "stored",
      promptBlock: parsed.rule.source.rawMarkdown,
      rule: parsed.rule,
    };
  }

  return { enabled: false, reason: "no_applicable_rule" };
}
