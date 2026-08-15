import type { CoverageAssessment } from "./script-factory-coverage";

export type ScriptFactoryStage = "content" | "storyboard" | "execution";
export type PartialScriptFailedStage = Exclude<ScriptFactoryStage, "content">;
export type ScriptGenerationStatus = "complete" | "partial";
export type ScriptOutputStatus = "formal" | "review" | "exploratory";
export type AttributionConfidenceLevel = "high" | "medium" | "low";
export type AttributionAuditStatus = "completed" | "unavailable";
export type ScriptPostGenerationAuditStatus = "pending" | "completed" | "unavailable";
export type ParagraphAttributionType =
  | "teacher_explicit"
  | "faithful_rewrite"
  | "ai_reasoning"
  | "case_fact";

export interface AttributionSourceReference {
  sourceId: string;
  itemId: string;
}

export interface ParagraphAttribution {
  sectionIndex: number;
  paragraphIndex: number;
  excerpt: string;
  attributionType: ParagraphAttributionType;
  sourceReferences: AttributionSourceReference[];
  reason: string;
}

export interface ScriptAttributionAudit {
  outputStatus: ScriptOutputStatus;
  confidenceLevel: AttributionConfidenceLevel;
  coveredDimensions: string[];
  missingDimensions: string[];
  recommendation: string;
  auditStatus: AttributionAuditStatus;
  paragraphAttributions: ParagraphAttribution[];
}

export interface ScriptFactCaseEvidence {
  title: string;
  content?: string;
  sourceType: string;
  verificationStatus: string;
  sourceUrl?: string;
  occurredAt?: string;
}

export interface ScriptFactAudit {
  overallStatus: "not_checked" | "pending" | "user_confirmed";
  systemVerified: false;
  pendingItems: string[];
  caseEvidence: ScriptFactCaseEvidence | null;
}

export type ScriptPostGenerationAudit =
  | { status: "pending" }
  | {
      status: "completed";
      coverageAssessment: CoverageAssessment;
      attributionAudit: ScriptAttributionAudit;
      factAudit: ScriptFactAudit;
    }
  | {
      status: "unavailable";
      message: string;
      coverageAssessment?: CoverageAssessment;
      attributionAudit?: ScriptAttributionAudit;
      factAudit: ScriptFactAudit;
    };

export interface ScriptPartialFailure {
  stage: PartialScriptFailedStage;
  errorCode: string;
  message: string;
}

export type ScriptQualityWarningCode =
  | "dense_closing_style"
  | "example_not_supporting_claim"
  | "analogy_mechanism_mismatch"
  | "correlation_as_causation";

export interface ScriptQualityWarning {
  category: "style" | "argument";
  code: ScriptQualityWarningCode;
  title: "表达待调整" | "论证待核对";
  sectionLabel: string;
  excerpt: string;
  message: string;
}

export interface ScriptQualityCheck {
  status: "passed" | "needs_review" | "unavailable";
  warnings: ScriptQualityWarning[];
  message?: string;
}
