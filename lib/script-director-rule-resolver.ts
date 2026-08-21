import type { ScriptDirectorProfileId } from "./script-director-profile";
import { buildScriptDirectorBlock, shouldUseShuimuranDirector } from "./script-director-profile";
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
    source: "stored" | "legacy_builtin";
    promptBlock: string;
  }
  | {
    enabled: false;
    reason: "no_applicable_rule" | "rule_not_found" | "rule_not_active" | "rule_invalid" | "rule_ip_mismatch";
  };

export function resolveScriptDirectorRuleForGeneration(input: {
  generationMode: "standard" | "ip";
  ipId: string;
  ipName: string;
  activeRuleId: string | null | undefined;
  legacyProfileId: ScriptDirectorProfileId | null | undefined;
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
    if (parsed.rule.status !== "active") return { enabled: false, reason: "rule_not_active" };
    return {
      enabled: true,
      ruleId: parsed.rule.id,
      version: parsed.rule.version,
      source: "stored",
      promptBlock: parsed.rule.source.rawMarkdown,
    };
  }

  if (shouldUseShuimuranDirector({
    generationMode: input.generationMode,
    ipName: input.ipName,
    profileId: input.legacyProfileId,
  })) {
    return {
      enabled: true,
      ruleId: "shuimuran-v1",
      version: "1.0.0",
      source: "legacy_builtin",
      promptBlock: buildScriptDirectorBlock("shuimuran-v1"),
    };
  }

  return { enabled: false, reason: "no_applicable_rule" };
}
