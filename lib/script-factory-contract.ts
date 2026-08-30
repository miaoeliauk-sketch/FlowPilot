import type { CoverageAssessment } from "./script-factory-coverage";

export type ScriptFactoryStage = "content" | "storyboard" | "execution";
export type PartialScriptFailedStage = Exclude<ScriptFactoryStage, "content">;
export type ScriptGenerationStatus = "complete" | "partial";
export type ScriptOutputStatus = "formal" | "review" | "exploratory";
export type AttributionConfidenceLevel = "high" | "medium" | "low";
export type AttributionAuditStatus = "completed" | "unavailable";
export type ScriptPostGenerationAuditStatus = "pending" | "completed" | "unavailable";
export type ScriptCompressionStatus = "precise" | "tolerated" | "closest_fallback" | "unavailable";

export interface ScriptCompressionAudit {
  status: ScriptCompressionStatus;
  initialChars: number;
  idealMinimumChars: number;
  idealMaximumChars: number;
  acceptableMinimumChars: number;
  acceptableMaximumChars: number;
  actualChars: number;
  actualRatio: number;
  selectedAttempt: 0 | 1 | 2;
  message: string;
}
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

export type SourceIntegrityIssueCode =
  | "responsibility_subject_distortion"
  | "unsupported_arbitration"
  | "certainty_shift";

export interface SourceIntegrityIssue {
  code: SourceIntegrityIssueCode;
  sectionIndex: number;
  paragraphIndex: number;
  excerpt: string;
  sourceReferences: AttributionSourceReference[];
  reason: string;
}

export interface ScriptSourceIntegrityAudit {
  status: "passed" | "needs_review";
  deliveryBlocked: boolean;
  issues: SourceIntegrityIssue[];
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
      auditVersion: string;
      coverageAssessment: CoverageAssessment;
      attributionAudit: ScriptAttributionAudit;
      sourceIntegrityAudit: ScriptSourceIntegrityAudit;
      factAudit: ScriptFactAudit;
    }
  | {
      status: "unavailable";
      auditVersion: string;
      message: string;
      coverageAssessment?: CoverageAssessment;
      attributionAudit?: ScriptAttributionAudit;
      sourceIntegrityAudit?: ScriptSourceIntegrityAudit;
      factAudit: ScriptFactAudit;
    };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function isCoverageAssessment(value: unknown): value is CoverageAssessment {
  const assessment = asRecord(value);
  if (!assessment) return false;
  const coverageLevels = new Set(["FULL", "PARTIAL", "NONE"]);
  const caseNeeds = new Set(["NOT_ASSESSED", "NOT_NEEDED", "ENHANCEMENT", "REQUIRED"]);
  return typeof assessment.coverage === "string"
    && coverageLevels.has(assessment.coverage)
    && typeof assessment.reason === "string"
    && isStringArray(assessment.coveredDimensions)
    && isStringArray(assessment.missingDimensions)
    && Array.isArray(assessment.sourceReferences)
    && typeof assessment.caseNeed === "string"
    && caseNeeds.has(assessment.caseNeed)
    && typeof assessment.caseReason === "string";
}

function isParagraphAttribution(value: unknown): value is ParagraphAttribution {
  const paragraph = asRecord(value);
  if (!paragraph) return false;
  const attributionTypes = new Set(["teacher_explicit", "faithful_rewrite", "ai_reasoning", "case_fact"]);
  return Number.isInteger(paragraph.sectionIndex)
    && Number.isInteger(paragraph.paragraphIndex)
    && typeof paragraph.excerpt === "string"
    && typeof paragraph.attributionType === "string"
    && attributionTypes.has(paragraph.attributionType)
    && Array.isArray(paragraph.sourceReferences)
    && paragraph.sourceReferences.every(reference => {
      const source = asRecord(reference);
      return Boolean(source && typeof source.sourceId === "string" && typeof source.itemId === "string");
    })
    && typeof paragraph.reason === "string";
}

function isAttributionAudit(value: unknown): value is ScriptAttributionAudit {
  const audit = asRecord(value);
  if (!audit) return false;
  const outputStatuses = new Set(["formal", "review", "exploratory"]);
  const confidenceLevels = new Set(["high", "medium", "low"]);
  const auditStatuses = new Set(["completed", "unavailable"]);
  return typeof audit.outputStatus === "string"
    && outputStatuses.has(audit.outputStatus)
    && typeof audit.confidenceLevel === "string"
    && confidenceLevels.has(audit.confidenceLevel)
    && isStringArray(audit.coveredDimensions)
    && isStringArray(audit.missingDimensions)
    && typeof audit.recommendation === "string"
    && typeof audit.auditStatus === "string"
    && auditStatuses.has(audit.auditStatus)
    && Array.isArray(audit.paragraphAttributions)
    && audit.paragraphAttributions.every(isParagraphAttribution);
}

function isSourceIntegrityAudit(value: unknown): value is ScriptSourceIntegrityAudit {
  const audit = asRecord(value);
  if (!audit || (audit.status !== "passed" && audit.status !== "needs_review")) return false;
  if (typeof audit.deliveryBlocked !== "boolean" || !Array.isArray(audit.issues)) return false;
  const issueCodes = new Set([
    "responsibility_subject_distortion",
    "unsupported_arbitration",
    "certainty_shift",
  ]);
  const validIssues = audit.issues.every(value => {
    const issue = asRecord(value);
    return Boolean(
      issue &&
      typeof issue.code === "string" &&
      issueCodes.has(issue.code) &&
      Number.isInteger(issue.sectionIndex) &&
      Number.isInteger(issue.paragraphIndex) &&
      typeof issue.excerpt === "string" &&
      issue.excerpt.trim() &&
      Array.isArray(issue.sourceReferences) &&
      issue.sourceReferences.length > 0 &&
      issue.sourceReferences.every(reference => {
        const source = asRecord(reference);
        return Boolean(source && typeof source.sourceId === "string" && typeof source.itemId === "string");
      }) &&
      typeof issue.reason === "string" &&
      issue.reason.trim()
    );
  });
  return validIssues &&
    audit.deliveryBlocked === (audit.issues.length > 0) &&
    audit.status === (audit.issues.length > 0 ? "needs_review" : "passed");
}

function isFactAudit(value: unknown): value is ScriptFactAudit {
  const audit = asRecord(value);
  if (!audit) return false;
  const statuses = new Set(["not_checked", "pending", "user_confirmed"]);
  const caseEvidence = audit.caseEvidence;
  const caseObject = caseEvidence === null ? null : asRecord(caseEvidence);
  const validCaseEvidence = caseEvidence === null || Boolean(
    caseObject
    && typeof caseObject.title === "string"
    && typeof caseObject.sourceType === "string"
    && typeof caseObject.verificationStatus === "string",
  );
  return typeof audit.overallStatus === "string"
    && statuses.has(audit.overallStatus)
    && audit.systemVerified === false
    && isStringArray(audit.pendingItems)
    && validCaseEvidence;
}

export function parseScriptPostGenerationAudit(value: unknown): ScriptPostGenerationAudit | null {
  const audit = asRecord(value);
  if (!audit || typeof audit.status !== "string") return null;
  if (audit.status === "pending") return { status: "pending" };
  if (audit.status === "completed") {
    if (
      typeof audit.auditVersion !== "string"
      || !audit.auditVersion.trim()
      || !isCoverageAssessment(audit.coverageAssessment)
      || !isAttributionAudit(audit.attributionAudit)
      || !isSourceIntegrityAudit(audit.sourceIntegrityAudit)
      || !isFactAudit(audit.factAudit)
    ) return null;
    return audit as unknown as ScriptPostGenerationAudit;
  }
  if (audit.status === "unavailable") {
    if (
      typeof audit.auditVersion !== "string"
      || !audit.auditVersion.trim()
      || typeof audit.message !== "string"
      || !isFactAudit(audit.factAudit)
    ) return null;
    if (audit.attributionAudit !== undefined && !isAttributionAudit(audit.attributionAudit)) return null;
    if (audit.sourceIntegrityAudit !== undefined && !isSourceIntegrityAudit(audit.sourceIntegrityAudit)) return null;
    if (audit.coverageAssessment !== undefined && !isCoverageAssessment(audit.coverageAssessment)) return null;
    return audit as unknown as ScriptPostGenerationAudit;
  }
  return null;
}

export interface ScriptPartialFailure {
  stage: PartialScriptFailedStage;
  errorCode: string;
  message: string;
}

export type ScriptQualityWarningCode =
  | "dense_closing_style"
  | "shuimuran_review_failed"
  | "shuimuran_review_unavailable"
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
