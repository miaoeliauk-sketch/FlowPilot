type ContractFailure = (message: string) => never;

export function strictJsonObject(content: string, jsonFail: ContractFailure): unknown {
  const trimmed = content.trim();
  if (!trimmed || trimmed.startsWith("```") || !trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return jsonFail("AI返回内容不是纯JSON对象");
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return jsonFail("AI返回内容不是有效JSON");
  }
}

export function contractObject(value: unknown, label: string, fail: ContractFailure): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(`${label}必须是对象`);
  return value as Record<string, unknown>;
}

export function contractArray(value: unknown, label: string, fail: ContractFailure): unknown[] {
  if (!Array.isArray(value)) return fail(`${label}必须是数组`);
  return value;
}

export function contractString(value: unknown, label: string, max: number, fail: ContractFailure) {
  if (typeof value !== "string" || !value.trim() || value.length > max) return fail(`${label}必须是非空字符串`);
  return value.trim();
}

export function contractEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
  fail: ContractFailure,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) return fail(`${label}不在允许范围内`);
  return value as T;
}
