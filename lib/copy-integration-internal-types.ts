import type { CopyIntegrationSource } from "./copy-integration-types";

export type EvidenceClassification = "usable" | "evidence_gap" | "exclude_time_prediction" | "context_only";
export type EvidenceStatus = "verified" | "needs_review" | "pending_user_review" | "rejected" | "human_approved";
export type EvidenceConfidence = "high" | "medium" | "low";
export type EvidenceRelationType = "overlap" | "complement" | "conflict";

export interface EvidenceFactCandidate {
  id: string;
  statement: string;
  originalQuote: string;
  sourceId: string;
  classification: EvidenceClassification;
  confidence: EvidenceConfidence;
}

export interface EvidenceFact extends EvidenceFactCandidate {
  quoteStart: number;
  quoteEnd: number;
  sourceHash: string;
  status: EvidenceStatus;
}

export interface EvidenceRelation {
  id: string;
  type: EvidenceRelationType;
  factIds: string[];
  summary: string;
}

export interface EvidenceTable {
  sources: CopyIntegrationSource[];
  facts: EvidenceFact[];
  relations: EvidenceRelation[];
}

export interface EvidenceReviewDecision {
  factId: string;
  decision: "passed" | "needs_review" | "rejected";
  reason: string;
  classification: EvidenceClassification;
  atomicity: "atomic" | "over_grouped";
}

export interface EvidenceReviewResult {
  decisions: EvidenceReviewDecision[];
  relationDecisions: Array<{
    relationId: string;
    decision: "passed" | "needs_review" | "rejected";
    reason: string;
  }>;
  suggestedRelations: EvidenceRelation[];
}

export interface SynthesisParagraphReference {
  paragraphIndex: number;
  factIds: string[];
}

export interface SynthesisSection {
  heading: string;
  paragraphs: string[];
  paragraphRefs: SynthesisParagraphReference[];
}

export interface SynthesisResult {
  sections: SynthesisSection[];
}

export type CopyIntegrationStage = "extract" | "review" | "synthesize";

export interface CopyIntegrationModelRequest {
  stage: CopyIntegrationStage;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
}

export interface CopyIntegrationModelAdapter {
  complete(request: CopyIntegrationModelRequest): Promise<string>;
}

export interface CopyIntegrationInternalResult {
  evidenceTable: EvidenceTable;
  synthesis: SynthesisResult;
  callCount: number;
  riskReviewUsed: boolean;
}
