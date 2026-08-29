import {
  parseGlobalBlockingConstraint,
  transitionGlobalBlockingConstraint,
  type GlobalBlockingConstraint,
  type GlobalBlockingConstraintTransition,
} from "./global-content-constraint-contract";

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
  _storage: GlobalBlockingConstraintStorage,
  _value: unknown,
): Promise<GlobalBlockingConstraint> {
  return Promise.reject(new GlobalBlockingConstraintConfirmationError(
    "浏览器本地确认入口已停用，必须通过服务端一次性挑战确认",
  ));
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
