function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
  if (result.postGenerationAuditStatus !== "completed") return "出处审计尚未完成";
  const integrity = asRecord(result.sourceIntegrityAudit);
  if (integrity?.status !== "passed" || integrity.deliveryBlocked !== false) {
    return "出处审计未通过";
  }
  return null;
}
