import { selectActiveGlobalBlockingConstraints } from "./global-content-constraint-contract";
import type { GlobalBlockingConstraintMatch } from "./global-content-constraint-detector";

const EMOTIONAL_COERCION_RULE_PREFIX = "global-constraint-emotional-coercion";
const EMOTIONAL_TARGET_PATTERN =
  "(?:焦虑(?:感|氛围|情绪)?|恐慌(?:感|情绪)?|恐惧(?:感|情绪)?|无力感|紧张感|压迫感|危机感)";
const PRODUCTION_INTENT_PATTERN =
  new RegExp(
    `(?:营造|制造|强化|加剧|渲染|煽动|激发|引发)(?:\\s|“|”|'|")*(?:受众|观众|用户)?(?:的)?${EMOTIONAL_TARGET_PATTERN}`,
    "g",
  );

export function detectProductionInstructionRisks(
  content: string,
  values: readonly unknown[],
): GlobalBlockingConstraintMatch[] {
  const rules = selectActiveGlobalBlockingConstraints(values)
    .filter(rule => rule.ruleId.startsWith(EMOTIONAL_COERCION_RULE_PREFIX));
  if (rules.length === 0) return [];

  const matches: GlobalBlockingConstraintMatch[] = [];
  for (const rule of rules) {
    for (const match of content.matchAll(PRODUCTION_INTENT_PATTERN)) {
      const start = match.index;
      matches.push({
        ruleId: rule.ruleId,
        sourceKnowledgeEntryId: rule.sourceKnowledgeEntryId,
        matchedText: match[0],
        start,
        end: start + match[0].length,
        reason: `命中通用禁用规则《${rule.title}》：拍摄制作建议出现明确高风险表达，需人工结合完整语境判断`,
      });
    }
  }
  return matches;
}
