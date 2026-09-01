import {
  isFactCaseEvidenceConfirmed,
  parseScriptPostGenerationAudit,
} from "./script-factory-contract";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function isOpenDeliveryGate(value: unknown, auditVersion: unknown): boolean {
  const gate = asRecord(value);
  return typeof auditVersion === "string"
    && auditVersion.trim().length > 0
    && gate?.status === "OPEN"
    && gate.auditVersion === auditVersion
    && isStringArray(gate.blockerCodes)
    && gate.blockerCodes.length === 0
    && isStringArray(gate.pendingItemIds)
    && gate.pendingItemIds.length === 0;
}

export function getScriptDeliveryBlockReason(scriptResult: unknown): string | null {
  const result = asRecord(scriptResult);
  if (!result) return null;
  const qualityCheck = asRecord(result.qualityCheck);
  const warnings = Array.isArray(qualityCheck?.warnings) ? qualityCheck.warnings : [];
  const warningCodes = new Set(warnings.map(value => asRecord(value)?.code));
  if (warningCodes.has("shuimuran_review_failed")) return "脚本未通过水木然终审";
  if (warningCodes.has("shuimuran_review_unavailable")) return "水木然终审尚未完成";

  const needsV13Audit = result.generationMode === "ip"
    || result.outputMode === "shuimuran-confirmed"
    || result.postGenerationAuditStatus !== undefined
    || result.attributionAudit !== undefined;
  if (!needsV13Audit) return null;
  if (result.deliveryPersistenceStatus === "blocked") return "待审正文未能安全保存";
  if (result.postGenerationAuditStatus !== "completed") return "出处审计尚未完成";
  const integrity = asRecord(result.sourceIntegrityAudit);
  if (
    integrity?.status !== "passed"
    || integrity.deliveryBlocked !== false
    || !Array.isArray(integrity.issues)
    || integrity.issues.length > 0
  ) {
    return "出处审计未通过";
  }
  const factAudit = asRecord(result.factAudit);
  const pendingItems = Array.isArray(factAudit?.pendingItems) ? factAudit.pendingItems : null;
  if (
    !pendingItems
    || !["not_checked", "pending", "user_confirmed"].includes(String(factAudit?.overallStatus))
    || factAudit?.systemVerified !== false
  ) {
    return "事实核验状态不完整或存在矛盾";
  }
  const attributionAudit = asRecord(result.attributionAudit);
  const paragraphAttributions = Array.isArray(attributionAudit?.paragraphAttributions)
    ? attributionAudit.paragraphAttributions
    : [];
  const missingSpecificClaimItem = paragraphAttributions.some(value => {
    const paragraph = asRecord(value);
    if (paragraph?.reasoningSubtype !== "unsupported_specific_claim") return false;
    const expectedId = `${result.auditVersion}:${paragraph.sectionIndex}:${paragraph.paragraphIndex}:unsupported_specific_claim`;
    return !pendingItems.some(item => {
      const pendingItem = asRecord(item);
      return pendingItem?.id === expectedId
        && pendingItem.sectionIndex === paragraph.sectionIndex
        && pendingItem.paragraphIndex === paragraph.paragraphIndex
        && pendingItem.subtype === "unsupported_specific_claim";
    });
  });
  if (missingSpecificClaimItem) {
    return "高风险无依据具体陈述缺少对应事实待核验记录";
  }
  const hasPendingItem = pendingItems.some(item => {
    if (typeof item === "string") return true;
    const resolutionStatus = asRecord(item)?.resolutionStatus;
    return resolutionStatus !== "CONFIRMED_ALLOWED"
      && resolutionStatus !== "SUPPORTED"
      && resolutionStatus !== "REMOVED";
  });
  if (hasPendingItem) {
    return "仍有事实待核验项未处理";
  }
  const caseEvidence = factAudit.caseEvidence === null
    ? null
    : asRecord(factAudit.caseEvidence);
  if (
    factAudit.overallStatus === "pending"
    || (factAudit.overallStatus === "not_checked" && (caseEvidence !== null || pendingItems.length > 0))
    || (factAudit.overallStatus === "user_confirmed"
      && !caseEvidence
      && pendingItems.length === 0)
    || (caseEvidence !== null && !isFactCaseEvidenceConfirmed({
      title: typeof caseEvidence.title === "string" ? caseEvidence.title : "",
      content: typeof caseEvidence.content === "string" ? caseEvidence.content : undefined,
      sourceType: typeof caseEvidence.sourceType === "string" ? caseEvidence.sourceType : "",
      verificationStatus: typeof caseEvidence.verificationStatus === "string"
        ? caseEvidence.verificationStatus
        : "",
      sourceUrl: typeof caseEvidence.sourceUrl === "string" ? caseEvidence.sourceUrl : undefined,
      occurredAt: typeof caseEvidence.occurredAt === "string" ? caseEvidence.occurredAt : undefined,
    }))
  ) {
    return "事实核验状态与待核验明细矛盾";
  }
  if (!isOpenDeliveryGate(result.deliveryGate, result.auditVersion)) {
    return "交付门禁尚未明确开放或审计版本不一致";
  }
  const completedAudit = parseScriptPostGenerationAudit({
    status: result.postGenerationAuditStatus,
    auditSessionId: result.auditSessionId,
    auditVersion: result.auditVersion,
    coverageAssessment: result.coverageAssessment,
    attributionAudit: result.attributionAudit,
    sourceIntegrityAudit: result.sourceIntegrityAudit,
    factAudit: result.factAudit,
    deliveryGate: result.deliveryGate,
  });
  if (!completedAudit || completedAudit.status !== "completed") {
    return "审计结果不完整或明细相互矛盾";
  }
  return null;
}
