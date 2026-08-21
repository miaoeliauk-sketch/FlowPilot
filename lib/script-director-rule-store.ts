import {
  calculateScriptDirectorRuleContentHash,
  parseScriptDirectorRule,
  type ScriptDirectorRule,
  type ScriptDirectorRuleTestValidation,
} from "./script-director-rule";

export const SCRIPT_DIRECTOR_RULE_STORAGE_KEY = "ipwr:script_director_rules_v1";

function requireStorage(): Storage {
  if (typeof localStorage === "undefined") {
    throw new Error("当前环境不支持专属编导规则存储");
  }
  return localStorage;
}

function readAllRules(): ScriptDirectorRule[] {
  const raw = requireStorage().getItem(SCRIPT_DIRECTOR_RULE_STORAGE_KEY);
  if (raw === null) return [];

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("专属编导规则库数据损坏，已停止读取和写入");
  }
  if (!Array.isArray(value)) {
    throw new Error("专属编导规则库数据损坏，已停止读取和写入");
  }

  return value.map(item => {
    const result = parseScriptDirectorRule(item);
    if (!result.ok) {
      throw new Error(`专属编导规则库数据损坏，已停止读取和写入：${result.error}`);
    }
    if (calculateScriptDirectorRuleContentHash(result.rule.source.rawMarkdown) !== result.rule.source.contentHash) {
      throw new Error("专属编导规则库数据损坏，已停止读取和写入：规则正文与内容哈希不一致");
    }
    return result.rule;
  });
}

export function getScriptDirectorRules(ipId: string): ScriptDirectorRule[] {
  if (!ipId.trim()) return [];
  return readAllRules()
    .filter(rule => rule.ipId === ipId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function getScriptDirectorRuleForIP(
  ipId: string,
  ruleId: string,
): ScriptDirectorRule | null {
  if (!ipId.trim() || !ruleId.trim()) return null;
  return readAllRules().find(rule => rule.ipId === ipId && rule.id === ruleId) ?? null;
}

export function saveScriptDirectorRule(rule: ScriptDirectorRule): void {
  const parsed = parseScriptDirectorRule(rule);
  if (!parsed.ok) throw new Error(parsed.error);
  if (parsed.rule.testValidation) {
    throw new Error("专属编导规则测试完成凭证只能由完整测试流程写入");
  }
  if (calculateScriptDirectorRuleContentHash(parsed.rule.source.rawMarkdown) !== parsed.rule.source.contentHash) {
    throw new Error("专属编导规则内容损坏：规则正文与内容哈希不一致");
  }

  const all = readAllRules();
  const existing = all.find(item => item.id === rule.id);
  if (existing && existing.ipId !== rule.ipId) {
    throw new Error("专属编导规则归属冲突，已拒绝保存");
  }
  const next = existing
    ? all.map(item => item.id === rule.id ? parsed.rule : item)
    : [...all, parsed.rule];

  try {
    requireStorage().setItem(SCRIPT_DIRECTOR_RULE_STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    throw new Error(`专属编导规则保存失败：${message}`);
  }
}

export function setScriptDirectorRuleActive(
  ipId: string,
  ruleId: string,
  active: boolean,
  activationProof?: string,
): void {
  const all = readAllRules();
  const target = all.find(rule => rule.ipId === ipId && rule.id === ruleId);
  if (!target) throw new Error("没有找到属于当前IP的专属编导规则");
  if (active && !target.testValidation) {
    throw new Error("专属编导规则至少完成一次三类测试生成后才能启用");
  }
  if (active && target.source.type === "markdown" && !activationProof?.trim()) {
    throw new Error("专属编导规则必须通过服务端核验后才能启用");
  }

  const updatedAt = new Date().toISOString();
  const next = all.map(rule => {
    if (rule.ipId !== ipId) return rule;
    if (rule.id === ruleId) {
      return {
        ...rule,
        status: active ? "active" as const : "inactive" as const,
        testValidation: rule.testValidation
          ? {
              ...rule.testValidation,
              ...(active && activationProof ? { activationProof } : {}),
              ...(!active ? { activationProof: undefined } : {}),
            }
          : undefined,
        updatedAt,
      };
    }
    if (active && rule.status === "active") {
      return { ...rule, status: "inactive" as const, updatedAt };
    }
    return rule;
  });

  try {
    requireStorage().setItem(SCRIPT_DIRECTOR_RULE_STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    throw new Error(`专属编导规则状态更新失败：${message}`);
  }
}

export function markScriptDirectorRuleTestCompleted(
  ipId: string,
  ruleId: string,
  validation: ScriptDirectorRuleTestValidation,
): void {
  const all = readAllRules();
  const target = all.find(rule => rule.ipId === ipId && rule.id === ruleId);
  if (!target) throw new Error("没有找到属于当前IP的专属编导规则");

  const parsed = parseScriptDirectorRule({
    ...target,
    status: "inactive",
    testValidation: validation,
    updatedAt: validation.completedAt,
  });
  if (!parsed.ok) throw new Error(parsed.error);

  const next = all.map(rule => rule.ipId === ipId && rule.id === ruleId ? parsed.rule : rule);
  try {
    requireStorage().setItem(SCRIPT_DIRECTOR_RULE_STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    throw new Error(`专属编导规则测试状态保存失败：${message}`);
  }
}
