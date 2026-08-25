import type { IPSourceAnalysisKind, IPSourceExtractionStatus } from "./types";

const VALID_KINDS: IPSourceAnalysisKind[] = [
  "question",
  "claim",
  "reasoning",
  "evidence",
  "concept",
  "topic",
  "expression",
];
const VALID_EXTRACTION_STATUSES: IPSourceExtractionStatus[] = ["AI提取", "人工确认"];

export interface ScriptFactoryIPSourceContextItem {
  parserVersion: 1 | 2;
  finalProof?: string;
  legacyProof?: string;
  ipId: string;
  sourceId: string;
  sourceTitle: string;
  itemId: string;
  kind: IPSourceAnalysisKind;
  content: string;
  originalExcerpt: string;
  extractionStatus: IPSourceExtractionStatus;
}

export interface ScriptFactoryCaseEvidence {
  ipId?: string | null;
  title?: string;
  content: string;
  sourceType: string;
  verificationStatus: string;
  sourceUrl?: string;
  occurredAt?: string;
}

export type ParseIPSourceContextResult =
  | { ok: true; items: ScriptFactoryIPSourceContextItem[] }
  | { ok: false; error: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

export function parseIPSourceContext(
  value: unknown,
  currentIPId: string,
): ParseIPSourceContextResult {
  if (value === undefined || value === null) return { ok: true, items: [] };
  if (!Array.isArray(value)) return { ok: false, error: "请求格式错误：IP原始内容上下文必须是数组。" };
  if (value.length > 120) return { ok: false, error: "请求格式错误：IP原始内容上下文数量过多。" };

  const items: ScriptFactoryIPSourceContextItem[] = [];
  for (const rawItem of value) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      return { ok: false, error: "请求格式错误：IP原始内容上下文条目不完整。" };
    }
    const item = rawItem as Record<string, unknown>;
    const parserVersion = item.parserVersion === undefined ? 1 : item.parserVersion;
    if (parserVersion !== 1 && parserVersion !== 2) {
      return { ok: false, error: "请求格式错误：IP原始内容解析版本无效。" };
    }
    if (!isNonEmptyString(item.ipId) || item.ipId.trim() !== currentIPId) {
      return { ok: false, error: "IP原始内容不属于当前IP，已拒绝生成。" };
    }
    if (parserVersion === 2 && !isNonEmptyString(item.finalProof)) {
      return { ok: false, error: "V2认知缺少最终凭证，已拒绝生成。" };
    }
    if (parserVersion === 1 && !isNonEmptyString(item.legacyProof)) {
      return { ok: false, error: "历史V1认知尚未完成合规登记，已拒绝生成。" };
    }
    if (
      !isNonEmptyString(item.sourceId) ||
      !isNonEmptyString(item.sourceTitle) ||
      !isNonEmptyString(item.itemId) ||
      !isNonEmptyString(item.content) ||
      !isNonEmptyString(item.originalExcerpt) ||
      !VALID_KINDS.includes(item.kind as IPSourceAnalysisKind) ||
      !VALID_EXTRACTION_STATUSES.includes(item.extractionStatus as IPSourceExtractionStatus)
    ) {
      return { ok: false, error: "请求格式错误：IP原始内容上下文条目不完整。" };
    }
    items.push({
      parserVersion,
      ...(parserVersion === 2 ? { finalProof: (item.finalProof as string).trim() } : {}),
      ...(parserVersion === 1 ? { legacyProof: (item.legacyProof as string).trim() } : {}),
      ipId: item.ipId.trim(),
      sourceId: item.sourceId.trim(),
      sourceTitle: item.sourceTitle.trim(),
      itemId: item.itemId.trim(),
      kind: item.kind as IPSourceAnalysisKind,
      content: item.content.trim(),
      originalExcerpt: item.originalExcerpt.trim(),
      extractionStatus: item.extractionStatus as IPSourceExtractionStatus,
    });
  }
  return { ok: true, items };
}

export function parseScriptFactoryCaseEvidence(
  value: unknown,
  currentIPId: string,
): { ok: true; value: ScriptFactoryCaseEvidence | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "请求格式错误：案例素材格式错误。" };
  }
  const item = value as Record<string, unknown>;
  if (item.ipId !== undefined && item.ipId !== null && (!isNonEmptyString(item.ipId) || item.ipId.trim() !== currentIPId)) {
    return { ok: false, error: "案例素材不属于当前IP，已拒绝生成。" };
  }
  if (
    !isNonEmptyString(item.content) ||
    !isNonEmptyString(item.sourceType) ||
    !isNonEmptyString(item.verificationStatus) ||
    (item.title !== undefined && typeof item.title !== "string") ||
    (item.sourceUrl !== undefined && typeof item.sourceUrl !== "string") ||
    (item.occurredAt !== undefined && typeof item.occurredAt !== "string")
  ) {
    return { ok: false, error: "请求格式错误：案例素材格式错误。" };
  }
  return {
    ok: true,
    value: {
      title: typeof item.title === "string" ? item.title.trim() : undefined,
      ipId: typeof item.ipId === "string" ? item.ipId.trim() : null,
      content: item.content.trim(),
      sourceType: item.sourceType.trim(),
      verificationStatus: item.verificationStatus.trim(),
      sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl.trim() : undefined,
      occurredAt: typeof item.occurredAt === "string" ? item.occurredAt.trim() : undefined,
    },
  };
}

export function buildIPSourceContextBlock(items: ScriptFactoryIPSourceContextItem[]): string {
  if (items.length === 0) {
    return `\n\n【IP原始内容上下文】
当前没有提供老师原始内容。本次仍需完成脚本，但只能视为AI依据当前IP风格进行的创作，不得写成老师已经确认或长期坚持的观点，不得虚构老师的亲身经历。生成后的观点归属与事实核验由独立审计提供参考。`;
  }

  return `\n\n【IP原始内容上下文】
以下内容属于当前IP，可用于忠实重组老师已经表达过的认知。它只提供创作依据，不是生成授权，也不代表其中涉及的外部事实已经核实。超出这些原文的推理可以用于成稿，但不得冒充老师已经确认的观点或亲身经历。\n\n${items.map((item, index) =>
    `${index + 1}.《${item.sourceTitle}》｜${item.kind}｜${item.extractionStatus}\n结构化理解：${item.content}\n老师原文：${item.originalExcerpt}`
  ).join("\n\n")}`;
}
