import type {
  KnowledgeEntry,
  KnowledgeUsageRecord,
  KnowledgeUsageTrackingStatus,
  ScriptAsset,
  ScriptKnowledgeTracking,
  ScriptKnowledgeUsage,
  ScriptKnowledgeUsageType,
} from "./types";

const TRUSTED_USAGE_STATUSES: ReadonlySet<KnowledgeUsageTrackingStatus> = new Set([
  "module_recorded",
  "script_adopted",
]);

export function isTrustedKnowledgeUsageForScript(
  entry: Pick<KnowledgeEntry, "id" | "ipId">,
  record: Pick<KnowledgeUsageRecord, "scriptId" | "topicId" | "trackingStatus">,
  script: Pick<ScriptAsset, "id" | "ipId" | "topicId" | "knowledgeTracking">,
): boolean {
  const candidateKnowledgeEntryIds: readonly string[] =
    script.knowledgeTracking.candidateKnowledgeEntryIds;
  return candidateKnowledgeEntryIds.includes(entry.id) &&
    (entry.ipId === null || entry.ipId === script.ipId) &&
    record.scriptId === script.id &&
    record.topicId === script.topicId &&
    TRUSTED_USAGE_STATUSES.has(record.trackingStatus);
}

const USAGE_TYPES: ScriptKnowledgeUsageType[] = [
  "structure",
  "argument",
  "case",
  "expression",
];

export class KnowledgeEffectContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeEffectContractError";
  }
}

interface VerifiedTrackingInput {
  candidateKnowledgeEntryIds: string[];
  finalScriptText: string;
  verifiedAt: string;
  usages: unknown;
}

function requireText(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new KnowledgeEffectContractError(`${fieldName}不能为空`);
  }
  return value.trim();
}

function parseUsage(
  value: unknown,
  candidates: Set<string>,
  finalScriptText: string,
): ScriptKnowledgeUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KnowledgeEffectContractError("知识采用记录格式不正确");
  }
  const raw = value as Record<string, unknown>;
  const knowledgeEntryId = requireText(raw.knowledgeEntryId, "知识条目编号");
  if (!candidates.has(knowledgeEntryId)) {
    throw new KnowledgeEffectContractError("采用的知识不在本次候选知识中");
  }
  if (!USAGE_TYPES.includes(raw.usageType as ScriptKnowledgeUsageType)) {
    throw new KnowledgeEffectContractError("知识采用类型不正确");
  }
  const evidenceExcerpt = requireText(raw.evidenceExcerpt, "引用证据");
  if (!finalScriptText.includes(evidenceExcerpt)) {
    throw new KnowledgeEffectContractError("引用证据不在最终脚本中");
  }
  return {
    knowledgeEntryId,
    usageType: raw.usageType as ScriptKnowledgeUsageType,
    sectionLabel: requireText(raw.sectionLabel, "脚本位置"),
    evidenceExcerpt,
    reason: requireText(raw.reason, "采用原因"),
  };
}

export function parseVerifiedScriptKnowledgeTracking(
  input: VerifiedTrackingInput,
): ScriptKnowledgeTracking {
  const candidateKnowledgeEntryIds = [...new Set(
    input.candidateKnowledgeEntryIds.map(id => requireText(id, "候选知识条目编号")),
  )];
  const finalScriptText = requireText(input.finalScriptText, "最终脚本");
  const verifiedAt = requireText(input.verifiedAt, "确认时间");
  if (!Array.isArray(input.usages)) {
    throw new KnowledgeEffectContractError("知识采用记录必须是列表");
  }
  const candidates = new Set(candidateKnowledgeEntryIds);
  const usages = input.usages.map(usage => parseUsage(usage, candidates, finalScriptText));
  const usedKnowledgeIds = new Set<string>();
  for (const usage of usages) {
    if (usedKnowledgeIds.has(usage.knowledgeEntryId)) {
      throw new KnowledgeEffectContractError("同一知识条目只能提交一条采用记录");
    }
    usedKnowledgeIds.add(usage.knowledgeEntryId);
  }
  return {
    status: "verified",
    candidateKnowledgeEntryIds,
    verifiedAt,
    usages,
  };
}
