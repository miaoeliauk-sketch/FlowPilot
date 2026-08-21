import type { ScriptDirectorRule } from "./script-director-rule";

export type ScriptDirectorContaminationStatus = "clean" | "warning" | "blocked";

export interface ScriptDirectorContaminationItem {
  name: string;
  count: number;
  severity: Exclude<ScriptDirectorContaminationStatus, "clean">;
}

export interface ScriptDirectorContaminationResult {
  status: ScriptDirectorContaminationStatus;
  canSave: boolean;
  items: ScriptDirectorContaminationItem[];
}

function countLiteralOccurrences(source: string, target: string): number {
  let count = 0;
  let offset = 0;
  while (offset < source.length) {
    const matchAt = source.indexOf(target, offset);
    if (matchAt < 0) break;
    count += 1;
    offset = matchAt + target.length;
  }
  return count;
}

export function detectScriptDirectorExampleContamination(
  rule: ScriptDirectorRule,
): ScriptDirectorContaminationResult {
  const ignoredName = rule.profileContext.ipNameSnapshot.trim();
  const entityNames = new Set(
    rule.examples
      .flatMap(example => example.protectedEntities)
      .map(name => name.trim())
      .filter(name => name.length >= 2 && name !== ignoredName),
  );

  const items = Array.from(entityNames)
    .map(name => ({ name, count: countLiteralOccurrences(rule.source.rawMarkdown, name) }))
    .filter(item => item.count >= 2)
    .map<ScriptDirectorContaminationItem>(item => ({
      ...item,
      severity: item.count > 3 ? "blocked" : "warning",
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN"));
  const blocked = items.some(item => item.severity === "blocked");

  return {
    status: blocked ? "blocked" : items.length > 0 ? "warning" : "clean",
    canSave: !blocked,
    items,
  };
}
