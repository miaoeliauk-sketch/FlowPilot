import { calculateLexicalSimilarity } from "./cognition-associative-engine";
import {
  auditSemanticRelation,
  type SemanticRelation,
} from "./cognition-semantic-audit";
import type { CognitionNodeV2 } from "./types";

export interface AssociationAuditNodeResult {
  nodeId: string;
  relation: SemanticRelation;
  lexicalScore: number;
  reason: string | null;
  quote: string | null;
}

export interface AssociationAuditReport {
  results: AssociationAuditNodeResult[];
  truncated: boolean;
  candidateCountBeforeTruncation: number;
  assessedCandidateCount: number;
}

function authoritativeClaim(node: CognitionNodeV2): string {
  return node.humanRevision?.claim?.trim() || node.claim.content.trim();
}

export async function runAssociationAudit(
  input: string,
  candidates: CognitionNodeV2[],
  apiKey: string,
): Promise<AssociationAuditReport> {
  const ranked = candidates.map(node => ({
    node,
    lexicalScore: calculateLexicalSimilarity(input, authoritativeClaim(node)),
  })).sort((left, right) => (
    right.lexicalScore - left.lexicalScore || left.node.id.localeCompare(right.node.id)
  ));

  const semanticReport = await auditSemanticRelation(
    input,
    ranked.map(candidate => candidate.node),
    apiKey,
  );
  const semanticById = new Map(semanticReport.results.map(result => [result.nodeId, result]));
  const results = ranked.map(({ node, lexicalScore }): AssociationAuditNodeResult => {
    const semantic = semanticById.get(node.id);
    if (!semantic) throw new Error("语义审计结果未覆盖全部候选节点");
    const unassessed = semantic.relation === "UNASSESSED";
    return {
      nodeId: node.id,
      relation: semantic.relation,
      lexicalScore,
      reason: unassessed ? null : semantic.reason,
      quote: unassessed ? null : semantic.quote,
    };
  });

  return {
    results,
    truncated: semanticReport.unassessedNodeIds.length > 0,
    candidateCountBeforeTruncation: candidates.length,
    assessedCandidateCount: semanticReport.assessedNodeIds.length,
  };
}
