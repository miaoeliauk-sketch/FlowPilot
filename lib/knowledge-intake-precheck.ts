import {
  compareKnowledgeSimilarity,
  type KnowledgeSimilarityContent,
  type KnowledgeSimilarityTier,
} from "./knowledge-similarity";
import type { KnowledgeEntry } from "./types";

export type KnowledgeIntakeCandidateKind = "method_card" | "raw_text";

export interface KnowledgeIntakePrecheckCandidate extends KnowledgeSimilarityContent {
  id: string;
  kind: KnowledgeIntakeCandidateKind;
  rawContent: string;
}

export interface KnowledgeIntakeQualityIssue {
  code: string;
  message: string;
}

export interface KnowledgeIntakeQualityResult {
  status: "pass" | "needs_manual_review";
  issues: KnowledgeIntakeQualityIssue[];
}

export interface SimilarExistingKnowledgeEvidence {
  knowledgeId: string;
  tier: Exclude<KnowledgeSimilarityTier, "none">;
  reasons: string[];
  title: string;
  category: string;
  ownershipLabel: string;
  sourceDescription: string;
  sourceUrl: string;
  createdAt: string;
}

export interface KnowledgeIntakePrecheckAssessment {
  candidateId: string;
  quality: KnowledgeIntakeQualityResult;
  similarEntries: SimilarExistingKnowledgeEvidence[];
}

export interface KnowledgeIntakePrecheckInput {
  candidates: KnowledgeIntakePrecheckCandidate[];
  existingEntries: KnowledgeEntry[];
  ipNamesById?: Record<string, string>;
}

export interface KnowledgeIntakePrecheckResult {
  assessments: KnowledgeIntakePrecheckAssessment[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseNote(note: unknown): Record<string, unknown> | null {
  if (typeof note !== "string" || !note.trim()) return null;
  try {
    return asRecord(JSON.parse(note) as unknown);
  } catch {
    return null;
  }
}

function readSection(rawContent: unknown, label: string): string {
  if (typeof rawContent !== "string") return "";
  const match = rawContent.match(new RegExp(
    `【${label}】\\s*([\\s\\S]*?)(?=\\n\\s*【|$)`,
    "u",
  ));
  return match?.[1]?.trim() ?? "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
      .map(item => item.trim())
      .filter(Boolean)
    : [];
}

function sectionList(value: string): string[] {
  return value.split(/[\n、，；;]/u).map(item => item.trim()).filter(Boolean);
}

function convertExistingEntry(entry: KnowledgeEntry): KnowledgeSimilarityContent {
  const note = parseNote(entry.note);
  const noteScenarios = stringArray(note?.applicableScenarios);
  const storedDirections = stringArray(entry.contentDirection);
  return {
    title: stringValue(entry.title),
    summary: readSection(entry.rawContent, "一句话总结") ||
      readSection(entry.rawContent, "内容概要"),
    coreMethod: stringValue(note?.coreMethod) ||
      readSection(entry.rawContent, "核心方法"),
    applicableScenarios: noteScenarios.length > 0
      ? noteScenarios
      : storedDirections.length > 0
        ? storedDirections
        : sectionList(readSection(entry.rawContent, "适用场景")),
    aiUsage: stringValue(note?.aiUsage) ||
      readSection(entry.rawContent, "AI调用方式"),
  };
}

function convertRawText(rawContent: unknown): KnowledgeSimilarityContent {
  const text = stringValue(rawContent);
  return {
    title: "原始文字",
    summary: text,
    coreMethod: text,
    applicableScenarios: ["原始文字"],
    aiUsage: text,
  };
}

function buildOwnershipLabel(
  entry: KnowledgeEntry,
  ipNamesById: Record<string, string>,
): string {
  if (!entry.ipId) return "全局知识";
  const ipName = ipNamesById[entry.ipId];
  if (!ipName) return `IP：${entry.ipId}`;
  return ipName.endsWith("IP") ? ipName : `${ipName}IP`;
}

function buildSourceDescription(entry: KnowledgeEntry): string {
  const parts = [stringValue(entry.sourcePlatform), stringValue(entry.sourceName)]
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);
  return parts.join("｜") || "来源未标注";
}

const TIER_ORDER: Record<Exclude<KnowledgeSimilarityTier, "none">, number> = {
  exact: 0,
  high: 1,
  partial: 2,
};

function findSimilarEntries(
  candidate: KnowledgeIntakePrecheckCandidate,
  entries: KnowledgeEntry[],
  ipNamesById: Record<string, string>,
): SimilarExistingKnowledgeEvidence[] {
  return entries.flatMap(entry => {
    const rawComparison = () => compareKnowledgeSimilarity(
      convertRawText(candidate.rawContent),
      convertRawText(entry.rawContent),
    );
    const structuredComparison = candidate.kind === "method_card"
      ? compareKnowledgeSimilarity(candidate, convertExistingEntry(entry))
      : null;
    const usesStructuredEvidence = structuredComparison !== null
      && structuredComparison.tier !== "none";
    const comparison = usesStructuredEvidence ? structuredComparison : rawComparison();
    if (comparison.tier === "none") return [];
    const reasons = usesStructuredEvidence
      ? comparison.reasons
      : candidate.kind === "raw_text"
        ? [comparison.tier === "exact" ? "原文内容完全一致" : "原文内容存在相似或重合"]
        : [comparison.tier === "exact" ? "正文内容完全一致" : "正文内容存在相似或重合"];
    return [{
      knowledgeId: entry.id,
      tier: comparison.tier,
      reasons,
      title: stringValue(entry.title),
      category: stringValue(entry.category),
      ownershipLabel: buildOwnershipLabel(entry, ipNamesById),
      sourceDescription: buildSourceDescription(entry),
      sourceUrl: stringValue(entry.sourceUrl),
      createdAt: stringValue(entry.createdAt),
    }];
  }).sort((left, right) => TIER_ORDER[left.tier] - TIER_ORDER[right.tier]);
}

function hasExcessiveRepetition(rawContent: string): boolean {
  const lines = rawContent.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  if (lines.length >= 4 && new Set(lines).size / lines.length <= 0.5) return true;

  const meaningfulText = (rawContent.match(/[\p{L}\p{N}]/gu) ?? []).join("");
  const maximumUnitLength = Math.min(30, Math.floor(meaningfulText.length / 4));
  for (let unitLength = 1; unitLength <= maximumUnitLength; unitLength += 1) {
    if (meaningfulText.length % unitLength !== 0) continue;
    const unit = meaningfulText.slice(0, unitLength);
    if (unit.repeat(meaningfulText.length / unitLength) === meaningfulText) return true;
  }
  return false;
}

function hasObviousTruncation(rawContent: string): boolean {
  if (/(?:…|\.\.\.)[”’」』】）)]?$/u.test(rawContent)) return true;
  const pairs: Array<[string, string]> = [
    ["（", "）"],
    ["(", ")"],
    ["【", "】"],
    ["[", "]"],
    ["“", "”"],
    ["‘", "’"],
  ];
  return pairs.some(([opening, closing]) =>
    rawContent.split(opening).length !== rawContent.split(closing).length);
}

function checkQuality(candidate: KnowledgeIntakePrecheckCandidate): KnowledgeIntakeQualityResult {
  const issues: KnowledgeIntakeQualityIssue[] = [];
  const rawContent = candidate.rawContent.trim();
  const meaningfulCharacters = rawContent.match(/[\p{L}\p{N}]/gu) ?? [];
  const visibleLength = rawContent.replace(/\s/gu, "").length;
  if (!rawContent) {
    issues.push({
      code: "EMPTY_CONTENT",
      message: "内容为空，请人工检查原始资料是否完整",
    });
  } else if (visibleLength >= 8 && meaningfulCharacters.length / visibleLength < 0.2) {
    issues.push({
      code: "MOSTLY_SYMBOLS",
      message: "内容几乎全是符号，请人工检查文本提取是否正常",
    });
  } else if (meaningfulCharacters.length > 0 && meaningfulCharacters.length < 20) {
    issues.push({
      code: "TOO_SHORT",
      message: "有效文字过少，请人工确认是否包含可用信息",
    });
  }
  if (
    meaningfulCharacters.length >= 20 &&
    meaningfulCharacters.length / Math.max(visibleLength, 1) >= 0.2 &&
    hasExcessiveRepetition(rawContent)
  ) {
    issues.push({
      code: "EXCESSIVE_REPETITION",
      message: "内容存在大量重复，请人工检查是否为转录或复制异常",
    });
  }
  if (candidate.kind === "method_card") {
    const missingParts = [
      [candidate.title.trim(), "标题"],
      [candidate.summary.trim(), "内容摘要"],
      [candidate.coreMethod?.trim() ?? "", "核心方法"],
      [(candidate.applicableScenarios ?? []).some(item => item.trim()) ? "present" : "", "适用场景"],
      [candidate.aiUsage?.trim() ?? "", "使用方式"],
    ].filter(([value]) => !value).map(([, label]) => label);
    if (missingParts.length > 0) {
      issues.push({
        code: "MISSING_CRITICAL_PARTS",
        message: `关键部分缺失：${missingParts.join("、")}，请人工检查`,
      });
    }
  }
  if (rawContent && hasObviousTruncation(rawContent)) {
    issues.push({
      code: "POSSIBLY_TRUNCATED",
      message: "内容存在明显截断迹象，请人工检查原文是否完整",
    });
  }
  return {
    status: issues.length > 0 ? "needs_manual_review" : "pass",
    issues,
  };
}

export function runKnowledgeIntakePrecheck(
  input: KnowledgeIntakePrecheckInput,
): KnowledgeIntakePrecheckResult {
  const ipNamesById = input.ipNamesById ?? {};
  return {
    assessments: input.candidates.map(candidate => ({
      candidateId: candidate.id,
      quality: checkQuality(candidate),
      similarEntries: findSimilarEntries(candidate, input.existingEntries, ipNamesById),
    })),
  };
}
