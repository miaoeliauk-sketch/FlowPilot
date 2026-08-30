export type ScriptManualRewriteAction = "replace" | "delete";

export interface ScriptManualRewriteRecord {
  auditVersion: string;
  action: ScriptManualRewriteAction;
  sectionIndex: number;
  paragraphIndex: number;
  originalExcerpt: string;
  appliedAt: string;
}

export interface ManualRewriteTarget {
  sectionIndex: number;
  paragraphIndex: number;
  excerpt: string;
}

export class ScriptManualRewriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptManualRewriteError";
  }
}

export function applyManualScriptRewrite<T extends { content: string }>(input: {
  outline: readonly T[];
  auditVersion: string;
  previousRewrite: ScriptManualRewriteRecord | null;
  target: ManualRewriteTarget;
  action: ScriptManualRewriteAction;
  replacement: string;
  deleteConfirmed: boolean;
  appliedAt?: string;
}): { outline: T[]; rewrite: ScriptManualRewriteRecord } {
  if (!input.auditVersion.trim()) {
    throw new ScriptManualRewriteError("缺少当前审计版本，不能处理正文");
  }
  if (input.previousRewrite) {
    throw new ScriptManualRewriteError("这份脚本已经使用过一次人工处理机会");
  }
  const section = input.outline[input.target.sectionIndex];
  if (!section) throw new ScriptManualRewriteError("待处理正文位置不存在");
  const paragraphs = section.content
    .split(/\n+/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
  if (paragraphs[input.target.paragraphIndex] !== input.target.excerpt) {
    throw new ScriptManualRewriteError("待处理原文已经变化，请重新审计后核对");
  }
  if (input.action === "delete" && !input.deleteConfirmed) {
    throw new ScriptManualRewriteError("删除前必须再次确认待删除原文");
  }
  const replacement = input.replacement.trim();
  if (input.action === "replace" && !replacement) {
    throw new ScriptManualRewriteError("替换内容不能为空");
  }
  if (replacement.length > 20_000) {
    throw new ScriptManualRewriteError("替换内容过长，请分段人工处理");
  }

  if (input.action === "delete") paragraphs.splice(input.target.paragraphIndex, 1);
  else paragraphs[input.target.paragraphIndex] = replacement;

  const outline = input.outline.map((item, index) => index === input.target.sectionIndex
    ? { ...item, content: paragraphs.join("\n") }
    : { ...item });
  return {
    outline,
    rewrite: {
      auditVersion: input.auditVersion,
      action: input.action,
      sectionIndex: input.target.sectionIndex,
      paragraphIndex: input.target.paragraphIndex,
      originalExcerpt: input.target.excerpt,
      appliedAt: input.appliedAt ?? new Date().toISOString(),
    },
  };
}
