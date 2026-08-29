export type GlobalBlockingConstraintStatus = "draft" | "active" | "disabled";

export interface KeywordConstraintDetection {
  type: "keyword";
  matchMode: "any";
  terms: string[];
}

export interface GlobalBlockingConstraint {
  schemaVersion: 2;
  ruleId: string;
  sourceKnowledgeEntryId: string;
  sourceSnapshot: {
    title: string;
    rawContentSha256: string;
  };
  scope: "all_ips";
  category: "通用禁用规则";
  priority: "global_baseline";
  enforcement: "block";
  status: GlobalBlockingConstraintStatus;
  title: string;
  canonicalText: string;
  prohibitedIntent: string;
  allowedBoundaries: string[];
  detection: KeywordConstraintDetection;
  humanConfirmation: {
    confirmedBy: string;
    confirmedAt: string;
    confirmationMethod: "explicit_ui_action";
    identityAssurance: "self_asserted";
  } | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type GlobalBlockingConstraintTransition =
  | { type: "activate"; confirmedBy: string; at: string }
  | { type: "disable"; at: string };

export class GlobalBlockingConstraintContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlobalBlockingConstraintContractError";
  }
}

const RULE_KEYS = [
  "schemaVersion",
  "ruleId",
  "sourceKnowledgeEntryId",
  "sourceSnapshot",
  "scope",
  "category",
  "priority",
  "enforcement",
  "status",
  "title",
  "canonicalText",
  "prohibitedIntent",
  "allowedBoundaries",
  "detection",
  "humanConfirmation",
  "revision",
  "createdAt",
  "updatedAt",
] as const;

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function requireNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new GlobalBlockingConstraintContractError(`${field}不能为空`);
  }
}

function requireUniqueStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new GlobalBlockingConstraintContractError(`${field}至少包含一项`);
  }
  if (value.some(item => typeof item !== "string" || !item.trim())) {
    throw new GlobalBlockingConstraintContractError(`${field}只能包含非空字符串`);
  }
  const normalized = value.map(item => item.trim().toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new GlobalBlockingConstraintContractError(`${field}不能包含重复项`);
  }
}

function requireIsoTimestamp(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new GlobalBlockingConstraintContractError(`${field}必须是ISO时间`);
  }
  try {
    if (new Date(value).toISOString() !== value) {
      throw new GlobalBlockingConstraintContractError(`${field}必须是ISO时间`);
    }
  } catch {
    throw new GlobalBlockingConstraintContractError(`${field}必须是ISO时间`);
  }
}

export function parseGlobalBlockingConstraint(value: unknown): GlobalBlockingConstraint {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GlobalBlockingConstraintContractError("强制拦截规则必须是对象");
  }
  const rule = value as Record<string, unknown>;
  if (!hasExactKeys(rule, RULE_KEYS)) {
    throw new GlobalBlockingConstraintContractError("强制拦截规则字段不完整或包含未定义字段");
  }
  if (rule.schemaVersion !== 2) {
    throw new GlobalBlockingConstraintContractError("schemaVersion必须为2");
  }
  if (rule.scope !== "all_ips") {
    throw new GlobalBlockingConstraintContractError("scope必须为all_ips");
  }
  if (rule.category !== "通用禁用规则") {
    throw new GlobalBlockingConstraintContractError("category必须为通用禁用规则");
  }
  if (rule.priority !== "global_baseline") {
    throw new GlobalBlockingConstraintContractError("priority必须为global_baseline");
  }
  if (rule.enforcement !== "block") {
    throw new GlobalBlockingConstraintContractError("enforcement必须为block");
  }
  if (!(["draft", "active", "disabled"] as const).includes(rule.status as GlobalBlockingConstraintStatus)) {
    throw new GlobalBlockingConstraintContractError("status格式不正确");
  }
  for (const field of [
    "ruleId",
    "sourceKnowledgeEntryId",
    "title",
    "canonicalText",
    "prohibitedIntent",
  ] as const) {
    requireNonEmptyString(rule[field], field);
  }
  if (!rule.sourceSnapshot || typeof rule.sourceSnapshot !== "object" || Array.isArray(rule.sourceSnapshot)) {
    throw new GlobalBlockingConstraintContractError("sourceSnapshot格式不正确");
  }
  const sourceSnapshot = rule.sourceSnapshot as Record<string, unknown>;
  if (!hasExactKeys(sourceSnapshot, ["title", "rawContentSha256"])) {
    throw new GlobalBlockingConstraintContractError("sourceSnapshot字段不完整或包含未定义字段");
  }
  requireNonEmptyString(sourceSnapshot.title, "sourceSnapshot.title");
  if (typeof sourceSnapshot.rawContentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(sourceSnapshot.rawContentSha256)) {
    throw new GlobalBlockingConstraintContractError("sourceSnapshot.rawContentSha256必须是SHA-256摘要");
  }
  requireUniqueStringArray(rule.allowedBoundaries, "allowedBoundaries");
  if (!Number.isInteger(rule.revision) || (rule.revision as number) < 1) {
    throw new GlobalBlockingConstraintContractError("revision必须是正整数");
  }
  requireIsoTimestamp(rule.createdAt, "createdAt");
  requireIsoTimestamp(rule.updatedAt, "updatedAt");
  if (Date.parse(rule.updatedAt) < Date.parse(rule.createdAt)) {
    throw new GlobalBlockingConstraintContractError("updatedAt不能早于createdAt");
  }
  if (!rule.detection || typeof rule.detection !== "object" || Array.isArray(rule.detection)) {
    throw new GlobalBlockingConstraintContractError("detection格式不正确");
  }
  const detection = rule.detection as Record<string, unknown>;
  if (detection.type !== "keyword") {
    throw new GlobalBlockingConstraintContractError("detection只支持keyword");
  }
  if (!hasExactKeys(detection, ["type", "matchMode", "terms"])) {
    throw new GlobalBlockingConstraintContractError("detection字段不完整或包含未定义字段");
  }
  if (detection.matchMode !== "any") {
    throw new GlobalBlockingConstraintContractError("detection.matchMode必须为any");
  }
  requireUniqueStringArray(detection.terms, "detection.terms");

  const confirmation = rule.humanConfirmation;
  if (rule.status === "active" && confirmation === null) {
    throw new GlobalBlockingConstraintContractError("active规则必须经过人工确认");
  }
  if (rule.status === "draft" && confirmation !== null) {
    throw new GlobalBlockingConstraintContractError("draft规则不能携带人工确认凭证");
  }
  if (rule.status === "disabled" && confirmation === null) {
    throw new GlobalBlockingConstraintContractError("disabled规则必须保留人工确认凭证");
  }
  if (confirmation !== null) {
    if (!confirmation || typeof confirmation !== "object" || Array.isArray(confirmation)) {
      throw new GlobalBlockingConstraintContractError("humanConfirmation格式不正确");
    }
    const confirmationRecord = confirmation as Record<string, unknown>;
    if (!hasExactKeys(confirmationRecord, [
      "confirmedBy",
      "confirmedAt",
      "confirmationMethod",
      "identityAssurance",
    ])) {
      throw new GlobalBlockingConstraintContractError("humanConfirmation字段不完整或包含未定义字段");
    }
    requireNonEmptyString(confirmationRecord.confirmedBy, "humanConfirmation.confirmedBy");
    requireIsoTimestamp(confirmationRecord.confirmedAt, "humanConfirmation.confirmedAt");
    if (confirmationRecord.confirmationMethod !== "explicit_ui_action") {
      throw new GlobalBlockingConstraintContractError("humanConfirmation.confirmationMethod格式不正确");
    }
    if (confirmationRecord.identityAssurance !== "self_asserted") {
      throw new GlobalBlockingConstraintContractError("humanConfirmation.identityAssurance格式不正确");
    }
    if (Date.parse(confirmationRecord.confirmedAt) < Date.parse(rule.createdAt)) {
      throw new GlobalBlockingConstraintContractError("确认时间不能早于创建时间");
    }
    if (Date.parse(confirmationRecord.confirmedAt) > Date.parse(rule.updatedAt)) {
      throw new GlobalBlockingConstraintContractError("确认时间不能晚于更新时间");
    }
  }
  return rule as unknown as GlobalBlockingConstraint;
}

export function transitionGlobalBlockingConstraint(
  value: unknown,
  transition: GlobalBlockingConstraintTransition,
): GlobalBlockingConstraint {
  const rule = parseGlobalBlockingConstraint(value);
  const transitionType = (transition as { type?: unknown } | null)?.type;
  if (transitionType !== "activate" && transitionType !== "disable") {
    throw new GlobalBlockingConstraintContractError("状态变更类型不正确");
  }
  requireIsoTimestamp(transition.at, "transition.at");
  if (Date.parse(transition.at) < Date.parse(rule.updatedAt)) {
    throw new GlobalBlockingConstraintContractError("状态变更时间不能早于当前更新时间");
  }

  if (transition.type === "activate") {
    if (rule.status === "active") {
      throw new GlobalBlockingConstraintContractError("active规则不能重复启用");
    }
    if (rule.status !== "draft") {
      throw new GlobalBlockingConstraintContractError("只有draft规则可以启用");
    }
    requireNonEmptyString(transition.confirmedBy, "transition.confirmedBy");
    return parseGlobalBlockingConstraint({
      ...rule,
      status: "active",
      humanConfirmation: {
        confirmedBy: transition.confirmedBy,
        confirmedAt: transition.at,
        confirmationMethod: "explicit_ui_action",
        identityAssurance: "self_asserted",
      },
      revision: rule.revision + 1,
      updatedAt: transition.at,
    });
  }

  if (rule.status !== "active") {
    throw new GlobalBlockingConstraintContractError("只有active规则可以停用");
  }
  return parseGlobalBlockingConstraint({
    ...rule,
    status: "disabled",
    revision: rule.revision + 1,
    updatedAt: transition.at,
  });
}

export function selectActiveGlobalBlockingConstraints(
  values: readonly unknown[],
): GlobalBlockingConstraint[] {
  return values
    .map(parseGlobalBlockingConstraint)
    .filter(rule => rule.status === "active");
}
