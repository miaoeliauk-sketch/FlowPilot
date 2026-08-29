import { selectActiveGlobalBlockingConstraints } from "./global-content-constraint-contract";

export interface GlobalBlockingConstraintMatch {
  ruleId: string;
  sourceKnowledgeEntryId: string;
  matchedText: string;
  start: number;
  end: number;
  reason: string;
}

export interface GlobalBlockingConstraintDetectionResult {
  blocked: boolean;
  detectionMode: "keyword";
  semanticAssessment: "not_implemented";
  matches: GlobalBlockingConstraintMatch[];
}

export class GlobalBlockingConstraintDetectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlobalBlockingConstraintDetectionError";
  }
}

export function detectGlobalBlockingConstraints(
  content: unknown,
  values: readonly unknown[],
): GlobalBlockingConstraintDetectionResult {
  if (typeof content !== "string") {
    throw new GlobalBlockingConstraintDetectionError("待检查内容必须是字符串");
  }
  const matches: GlobalBlockingConstraintMatch[] = [];

  for (const rule of selectActiveGlobalBlockingConstraints(values)) {
    for (const term of rule.detection.terms) {
      let start = content.indexOf(term);
      while (start !== -1) {
        matches.push({
          ruleId: rule.ruleId,
          sourceKnowledgeEntryId: rule.sourceKnowledgeEntryId,
          matchedText: content.slice(start, start + term.length),
          start,
          end: start + term.length,
          reason: `命中通用禁用规则《${rule.title}》：${rule.prohibitedIntent}`,
        });
        start = content.indexOf(term, start + 1);
      }
    }
  }

  matches.sort((left, right) => left.start - right.start || left.end - right.end);

  return {
    blocked: matches.length > 0,
    detectionMode: "keyword",
    semanticAssessment: "not_implemented",
    matches,
  };
}
