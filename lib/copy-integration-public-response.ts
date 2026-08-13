import type { CopyIntegrationInternalResult } from "./copy-integration-internal-types";
import type { CopyIntegrationResult, CopyIntegrationSource } from "./copy-integration-types";

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function short(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

export function toPublicResponse(
  internal: CopyIntegrationInternalResult,
  sources: CopyIntegrationSource[],
): CopyIntegrationResult {
  const facts = new Map(internal.evidenceTable.facts.map(fact => [fact.id, fact]));
  const exclusionCandidateIds = new Map(
    internal.evidenceTable.facts
      .filter(fact => fact.status === "pending_user_review")
      .map((fact, index) => [fact.id, `candidate-${index + 1}`]),
  );
  const sections = internal.synthesis.sections.map(section => ({
    heading: section.heading,
    paragraphs: section.paragraphs.map((text, paragraphIndex) => {
      const ref = section.paragraphRefs.find(item => item.paragraphIndex === paragraphIndex);
      const paragraphCandidateIds = (ref?.factIds ?? [])
        .map(factId => exclusionCandidateIds.get(factId))
        .filter((candidateId): candidateId is string => Boolean(candidateId));
      return {
        text,
        sourceIds: unique((ref?.factIds ?? []).flatMap(factId => {
          const fact = facts.get(factId);
          return fact ? [fact.sourceId] : [];
        })),
        ...(paragraphCandidateIds.length > 0 ? { exclusionCandidateIds: paragraphCandidateIds } : {}),
      };
    }),
  }));
  const conflicts = internal.evidenceTable.relations
    .filter(relation => relation.type === "conflict")
    .map((relation) => {
      const alternatives = relation.factIds
        .map(factId => facts.get(factId))
        .filter((fact): fact is NonNullable<typeof fact> => Boolean(fact))
        .slice(0, 2)
        .map(fact => ({
          brief: short(fact.originalQuote, 30),
          text: fact.originalQuote,
          sourceIds: [fact.sourceId],
        }));
      return {
        topic: short(alternatives[0]?.text ?? "素材观点冲突", 20),
        conflictPoint: "两份素材对同一问题存在分歧，正式使用前需确认统一立场。",
        alternatives,
      };
    });
  const exclusions = internal.evidenceTable.facts
    .filter(fact => fact.classification === "exclude_time_prediction")
    .map(fact => ({
      summary: fact.originalQuote,
      reason: "属于缺乏依据的具体时间预测或确定性时间断言",
      sourceIds: [fact.sourceId],
    }));
  const evidenceGaps = internal.evidenceTable.facts
    .filter(fact => fact.status === "needs_review")
    .map(fact => ({
      summary: fact.originalQuote,
      reason: "缺乏权威来源支撑，建议使用前核实",
      sourceIds: [fact.sourceId],
    }));
  const exclusionCandidates = internal.evidenceTable.facts
    .filter(fact => fact.status === "pending_user_review")
    .map(fact => ({
      id: exclusionCandidateIds.get(fact.id)!,
      summary: fact.originalQuote,
      reason: "独立复核认为这段疑似口播过渡或结构提示，建议由用户确认是否排除",
      sourceIds: [fact.sourceId],
    }));
  const sourceLabels = new Map(sources.map((source, index) => [source.id, `素材${index + 1}`]));
  const decisionItems = conflicts.map((conflict) => {
    const [first, second] = conflict.alternatives;
    const firstLabel = first?.sourceIds.map(id => sourceLabels.get(id) ?? id).join("、") ?? "一方素材";
    const secondLabel = second?.sourceIds.map(id => sourceLabels.get(id) ?? id).join("、") ?? "另一方素材";
    return `关于${conflict.topic}，${firstLabel}和${secondLabel}存在冲突：${first?.brief ?? "说法一"} vs ${second?.brief ?? "说法二"}。正式使用前需确定统一立场。`;
  });
  if (evidenceGaps.length > 0) {
    decisionItems.push(`另有${evidenceGaps.length}处内容标记为依据不足，详见下文“未采用及依据不足内容”部分。`);
  }
  if (exclusionCandidates.length > 0) {
    decisionItems.push(`另有${exclusionCandidates.length}处疑似口播支架，需确认保留或排除。`);
  }
  if (decisionItems.length === 0) decisionItems.push("当前没有需要老师决策或核实的事项。");
  const fullText = sections
    .map(section => `## ${section.heading}\n\n${section.paragraphs.map(paragraph => paragraph.text).join("\n\n")}`)
    .join("\n\n");

  // 必须构造全新的公开对象，不能把内部证据对象扩展或透传到响应中。
  return {
    draft: { sections, fullText },
    decisionSummary: { items: decisionItems },
    conflicts,
    exclusionCandidates,
    contentReview: { exclusions, evidenceGaps },
  };
}
