import {
  parseGlobalBlockingConstraint,
  transitionGlobalBlockingConstraint,
  type GlobalBlockingConstraint,
  type GlobalBlockingConstraintTransition,
} from "./global-content-constraint-contract";
import { calculateSHA256 } from "./sha256";

export const GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY = "ipwr:global_blocking_constraints_v2";
export const LEGACY_GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY = "ipwr:global_blocking_constraints_v1";

export interface GlobalBlockingConstraintStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const GLOBAL_BLOCKING_CONSTRAINT_CONFIRMATION_STATEMENT =
  "我已逐字核对并确认将这条规则作为所有IP共同遵守的强制底线";

export interface ConfirmGlobalBlockingConstraintRequest {
  sourceKnowledgeEntryId: string;
  expectedSourceTitle: string;
  expectedSourceRawContent: string;
  confirmedBy: string;
  confirmationStatement: string;
  rule: {
    title: string;
    canonicalText: string;
    prohibitedIntent: string;
    allowedBoundaries: string[];
    detectionTerms: string[];
  };
}

interface SourceKnowledgeSnapshot {
  id: string;
  title: string;
  category: string;
  ipId: string | null;
  rawContent: string;
}

export class GlobalBlockingConstraintConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlobalBlockingConstraintConfirmationError";
  }
}

interface GlobalBlockingConstraintWriteLock {
  request<T>(name: string, operation: () => T): Promise<T>;
}

export class GlobalBlockingConstraintStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlobalBlockingConstraintStoreError";
  }
}

interface StoredGlobalBlockingConstraintEnvelope {
  schemaVersion: 2;
  writeOperationId: string;
  rules: unknown[];
}

let writeOperationSequence = 0;
const GLOBAL_BLOCKING_CONSTRAINT_WRITE_LOCK_NAME = `${GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY}:write`;

const UNSUPPORTED_BROWSER_WRITE_LOCK: GlobalBlockingConstraintWriteLock = {
  request() {
    return Promise.reject(new GlobalBlockingConstraintStoreError(
      "当前浏览器不支持安全保存通用强制规则，请升级浏览器后重试",
    ));
  },
};

function getBrowserWriteLock(): GlobalBlockingConstraintWriteLock | null {
  if (typeof window === "undefined") return null;
  if (typeof navigator === "undefined" || !navigator.locks) {
    return UNSUPPORTED_BROWSER_WRITE_LOCK;
  }
  return {
    request(name, operation) {
      return navigator.locks.request(name, operation);
    },
  };
}

function runWithWriteLock<T>(
  operation: () => T,
): Promise<T> {
  const targetLock = getBrowserWriteLock();
  if (!targetLock) return Promise.resolve().then(operation);
  return targetLock.request(GLOBAL_BLOCKING_CONSTRAINT_WRITE_LOCK_NAME, operation);
}

function createWriteOperationId(): string {
  writeOperationSequence += 1;
  return `${Date.now().toString(36)}-${writeOperationSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function serializeRules(rules: GlobalBlockingConstraint[]): {
  operationId: string;
  serialized: string;
} {
  const operationId = createWriteOperationId();
  return {
    operationId,
    serialized: JSON.stringify({
      schemaVersion: 2,
      writeOperationId: operationId,
      rules,
    } satisfies StoredGlobalBlockingConstraintEnvelope),
  };
}

function extractWriteOperationId(raw: string | null): string | null {
  if (raw === null) return null;
  const match = raw.match(/^\{"schemaVersion":2,"writeOperationId":"([^"]+)","rules":/);
  return match?.[1] ?? null;
}

function readStoredRaw(storage: GlobalBlockingConstraintStorage): string | null {
  try {
    return storage.getItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知错误";
    throw new GlobalBlockingConstraintStoreError(`通用强制规则读取失败：${detail}`);
  }
}

function writeWithReadback(
  storage: GlobalBlockingConstraintStorage,
  rules: GlobalBlockingConstraint[],
  mismatchMessage: string,
): string {
  const previous = readStoredRaw(storage);
  const { operationId, serialized } = serializeRules(rules);
  try {
    storage.setItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY, serialized);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知错误";
    throw new GlobalBlockingConstraintStoreError(`通用强制规则写入失败：${detail}`);
  }
  let readback: string | null;
  try {
    readback = readStoredRaw(storage);
  } catch (error) {
    try {
      readback = readStoredRaw(storage);
    } catch {
      restorePreviousValue(storage, previous, operationId, "通用强制规则写入后回读失败", true);
      throw error;
    }
    if (extractWriteOperationId(readback) !== operationId) {
      throw new GlobalBlockingConstraintStoreError(
        "通用强制规则写入后发生并发写入冲突，已保留另一标签页内容",
      );
    }
    restorePreviousValue(storage, previous, operationId, "通用强制规则写入后回读失败");
    throw error;
  }
  if (readback === serialized) return operationId;
  if (extractWriteOperationId(readback) !== operationId) {
    throw new GlobalBlockingConstraintStoreError(
      "通用强制规则写入后发生并发写入冲突，已保留另一标签页内容",
    );
  }

  restorePreviousValue(storage, previous, operationId, mismatchMessage);
  throw new GlobalBlockingConstraintStoreError(mismatchMessage);
}

function restorePreviousValue(
  storage: GlobalBlockingConstraintStorage,
  previous: string | null,
  operationId: string,
  failureMessage: string,
  skipOwnershipCheck = false,
): void {
  try {
    if (!skipOwnershipCheck && extractWriteOperationId(readStoredRaw(storage)) !== operationId) {
      throw new GlobalBlockingConstraintStoreError(
        "通用强制规则写入后发生并发写入冲突，已保留另一标签页内容",
      );
    }
    if (previous === null) {
      storage.removeItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY);
    } else {
      storage.setItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY, previous);
    }
  } catch (error) {
    if (error instanceof GlobalBlockingConstraintStoreError) throw error;
    throw new GlobalBlockingConstraintStoreError(`${failureMessage}，且未能恢复写入前内容`);
  }
  if (readStoredRaw(storage) !== previous) {
    throw new GlobalBlockingConstraintStoreError(`${failureMessage}，且未能恢复写入前内容`);
  }
}

export function loadGlobalBlockingConstraints(
  storage: GlobalBlockingConstraintStorage,
): GlobalBlockingConstraint[] {
  const raw = readStoredRaw(storage);
  if (raw === null) return [];

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new GlobalBlockingConstraintStoreError("通用强制规则库数据损坏，已停止读取和写入");
  }
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "rules,schemaVersion,writeOperationId"
  ) {
    throw new GlobalBlockingConstraintStoreError("通用强制规则库数据损坏，已停止读取和写入");
  }
  const envelope = value as Partial<StoredGlobalBlockingConstraintEnvelope>;
  if (
    envelope.schemaVersion !== 2
    || typeof envelope.writeOperationId !== "string"
    || envelope.writeOperationId.length === 0
    || !Array.isArray(envelope.rules)
  ) {
    throw new GlobalBlockingConstraintStoreError("通用强制规则库数据损坏，已停止读取和写入");
  }
  const rules = envelope.rules.map(parseGlobalBlockingConstraint);
  if (new Set(rules.map(rule => rule.ruleId)).size !== rules.length) {
    throw new GlobalBlockingConstraintStoreError("通用强制规则库存在重复的规则编号，已停止读取和写入");
  }
  if (new Set(rules.map(rule => rule.sourceKnowledgeEntryId)).size !== rules.length) {
    throw new GlobalBlockingConstraintStoreError("通用强制规则库存在同一原知识重复绑定强制规则，已停止读取和写入");
  }
  return rules;
}

export function saveGlobalBlockingConstraintDraft(
  storage: GlobalBlockingConstraintStorage,
  value: unknown,
): Promise<GlobalBlockingConstraint> {
  return runWithWriteLock(() => saveGlobalBlockingConstraintDraftUnlocked(storage, value));
}

function saveGlobalBlockingConstraintDraftUnlocked(
  storage: GlobalBlockingConstraintStorage,
  value: unknown,
): GlobalBlockingConstraint {
  const draft = parseGlobalBlockingConstraint(value);
  if (draft.status !== "draft") {
    throw new GlobalBlockingConstraintStoreError("只能通过草稿入口创建规则，启用必须经过人工确认流程");
  }
  const rules = loadGlobalBlockingConstraints(storage);
  if (rules.some(rule => rule.ruleId === draft.ruleId)) {
    throw new GlobalBlockingConstraintStoreError("规则编号已存在");
  }
  if (rules.some(rule => rule.sourceKnowledgeEntryId === draft.sourceKnowledgeEntryId)) {
    throw new GlobalBlockingConstraintStoreError("原知识已经绑定强制规则");
  }
  writeWithReadback(storage, [...rules, draft], "通用强制规则保存后回读不一致");
  return draft;
}

export function getActiveGlobalBlockingConstraints(
  storage: GlobalBlockingConstraintStorage,
): GlobalBlockingConstraint[] {
  return loadGlobalBlockingConstraints(storage).filter(rule => rule.status === "active");
}

export function transitionStoredGlobalBlockingConstraint(
  storage: GlobalBlockingConstraintStorage,
  ruleId: string,
  transition: GlobalBlockingConstraintTransition,
): Promise<GlobalBlockingConstraint> {
  if (transition.type === "activate") {
    return Promise.reject(new GlobalBlockingConstraintStoreError(
      "启用规则必须经过原知识核对和人工确认入口",
    ));
  }
  return runWithWriteLock(
    () => transitionStoredGlobalBlockingConstraintUnlocked(storage, ruleId, transition),
  );
}

export function confirmGlobalBlockingConstraintFromKnowledge(
  storage: GlobalBlockingConstraintStorage,
  value: unknown,
): Promise<GlobalBlockingConstraint> {
  return runWithWriteLock(() => {
    const request = parseConfirmationRequest(value);
    const source = validateConfirmationSource(storage, request);
    const now = new Date().toISOString();
    const sourceHash = calculateSHA256(source.rawContent);
    const draft = parseGlobalBlockingConstraint({
      schemaVersion: 2,
      ruleId: `global-constraint:${source.id}:${sourceHash.slice(0, 12)}`,
      sourceKnowledgeEntryId: source.id,
      sourceSnapshot: { title: source.title, rawContentSha256: sourceHash },
      scope: "all_ips",
      category: "通用禁用规则",
      priority: "global_baseline",
      enforcement: "block",
      status: "draft",
      title: request.rule.title,
      canonicalText: request.rule.canonicalText,
      prohibitedIntent: request.rule.prohibitedIntent,
      allowedBoundaries: request.rule.allowedBoundaries,
      detection: { type: "keyword", matchMode: "any", terms: request.rule.detectionTerms },
      humanConfirmation: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    const active = transitionGlobalBlockingConstraint(draft, {
      type: "activate",
      confirmedBy: request.confirmedBy,
      at: now,
    });
    const rules = loadGlobalBlockingConstraints(storage);
    const existing = rules.find(rule => (
      rule.ruleId === active.ruleId
      || rule.sourceKnowledgeEntryId === active.sourceKnowledgeEntryId
    ));
    if (existing) {
      validateConfirmationSource(storage, request);
      if (isSameConfirmedRule(existing, active)) return existing;
      throw new GlobalBlockingConstraintStoreError("原知识已经绑定另一份强制规则，不能自动覆盖");
    }
    validateConfirmationSource(storage, request);
    const previous = readStoredRaw(storage);
    const operationId = writeWithReadback(storage, [...rules, active], "通用强制规则确认后回读不一致");
    try {
      validateConfirmationSource(storage, request);
    } catch {
      restorePreviousValue(storage, previous, operationId, "原知识在确认过程中发生变化，规则写入已回滚");
      throw new GlobalBlockingConstraintConfirmationError(
        "原知识在确认过程中发生变化，规则没有启用，请重新核对",
      );
    }
    const readback = loadGlobalBlockingConstraints(storage).find(rule => rule.ruleId === active.ruleId);
    if (!readback || !isSameConfirmedRule(readback, active)) {
      throw new GlobalBlockingConstraintStoreError("通用强制规则确认后严格回读失败");
    }
    return readback;
  });
}

function isSameConfirmedRule(
  existing: GlobalBlockingConstraint,
  expected: GlobalBlockingConstraint,
): boolean {
  return existing.status === "active"
    && existing.ruleId === expected.ruleId
    && existing.sourceKnowledgeEntryId === expected.sourceKnowledgeEntryId
    && JSON.stringify(existing.sourceSnapshot) === JSON.stringify(expected.sourceSnapshot)
    && existing.title === expected.title
    && existing.canonicalText === expected.canonicalText
    && existing.prohibitedIntent === expected.prohibitedIntent
    && JSON.stringify(existing.allowedBoundaries) === JSON.stringify(expected.allowedBoundaries)
    && JSON.stringify(existing.detection) === JSON.stringify(expected.detection)
    && existing.humanConfirmation?.confirmedBy === expected.humanConfirmation?.confirmedBy;
}

const KNOWLEDGE_STORAGE_KEY = "ipwr:knowledgeEntries";

function requireConfirmationString(value: unknown, message: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GlobalBlockingConstraintConfirmationError(message);
  }
}

function parseConfirmationRequest(value: unknown): ConfirmGlobalBlockingConstraintRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GlobalBlockingConstraintConfirmationError("人工确认请求格式不正确");
  }
  const request = value as Record<string, unknown>;
  requireConfirmationString(request.sourceKnowledgeEntryId, "原知识编号不能为空");
  requireConfirmationString(request.expectedSourceTitle, "待确认标题不能为空");
  requireConfirmationString(request.expectedSourceRawContent, "待确认原文不能为空");
  requireConfirmationString(request.confirmedBy, "确认人不能为空");
  if (["智能入库助手", "AI", "系统", "自动化流程"].includes(request.confirmedBy.trim())) {
    throw new GlobalBlockingConstraintConfirmationError("确认名称不能填写明确的系统或助手身份");
  }
  if (request.confirmationStatement !== GLOBAL_BLOCKING_CONSTRAINT_CONFIRMATION_STATEMENT) {
    throw new GlobalBlockingConstraintConfirmationError("缺少完整的显式确认记录");
  }
  if (!request.rule || typeof request.rule !== "object" || Array.isArray(request.rule)) {
    throw new GlobalBlockingConstraintConfirmationError("规则内容格式不正确");
  }
  const rule = request.rule as Record<string, unknown>;
  requireConfirmationString(rule.title, "规则标题不能为空");
  requireConfirmationString(rule.canonicalText, "规则全文不能为空");
  requireConfirmationString(rule.prohibitedIntent, "禁止动机不能为空");
  if (!Array.isArray(rule.allowedBoundaries) || !Array.isArray(rule.detectionTerms)) {
    throw new GlobalBlockingConstraintConfirmationError("允许边界和检测短语必须是列表");
  }
  return request as unknown as ConfirmGlobalBlockingConstraintRequest;
}

function parseSourceKnowledge(value: unknown): SourceKnowledgeSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.id !== "string"
    || typeof entry.title !== "string"
    || typeof entry.category !== "string"
    || typeof entry.rawContent !== "string"
    || !(entry.ipId === null || typeof entry.ipId === "string")
  ) return null;
  return {
    id: entry.id,
    title: entry.title,
    category: entry.category,
    ipId: entry.ipId,
    rawContent: entry.rawContent,
  };
}

function validateConfirmationSource(
  storage: GlobalBlockingConstraintStorage,
  request: ConfirmGlobalBlockingConstraintRequest,
): SourceKnowledgeSnapshot {
  let raw: string | null;
  try {
    raw = storage.getItem(KNOWLEDGE_STORAGE_KEY);
  } catch {
    throw new GlobalBlockingConstraintConfirmationError("原知识读取失败，未创建规则");
  }
  let entries: unknown;
  try {
    entries = raw === null ? [] : JSON.parse(raw);
  } catch {
    throw new GlobalBlockingConstraintConfirmationError("原知识库数据损坏，未创建规则");
  }
  if (!Array.isArray(entries)) {
    throw new GlobalBlockingConstraintConfirmationError("原知识库格式不正确，未创建规则");
  }
  const source = entries.map(parseSourceKnowledge).find(entry => entry?.id === request.sourceKnowledgeEntryId);
  if (!source) throw new GlobalBlockingConstraintConfirmationError("没有找到待确认的原知识");
  if (source.category !== "通用禁用规则") {
    throw new GlobalBlockingConstraintConfirmationError("原知识不是通用禁用规则");
  }
  if (source.ipId !== null) {
    throw new GlobalBlockingConstraintConfirmationError("通用禁用规则必须属于通用知识库，不能绑定单一IP");
  }
  if (source.title !== request.expectedSourceTitle || source.rawContent !== request.expectedSourceRawContent) {
    throw new GlobalBlockingConstraintConfirmationError("原知识内容已经变化，请重新打开并逐字核对");
  }
  return source;
}

function transitionStoredGlobalBlockingConstraintUnlocked(
  storage: GlobalBlockingConstraintStorage,
  ruleId: string,
  transition: GlobalBlockingConstraintTransition,
): GlobalBlockingConstraint {
  const rules = loadGlobalBlockingConstraints(storage);
  const current = rules.find(rule => rule.ruleId === ruleId);
  if (!current) {
    throw new GlobalBlockingConstraintStoreError("没有找到需要变更状态的通用强制规则");
  }
  const updated = transitionGlobalBlockingConstraint(current, transition);
  writeWithReadback(
    storage,
    rules.map(rule => rule.ruleId === ruleId ? updated : rule),
    "通用强制规则状态保存后回读不一致",
  );
  return updated;
}
