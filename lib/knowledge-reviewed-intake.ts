import {
  getKnowledgeEntriesForFullLibraryComparison,
  saveReviewedMethodCardEntries,
} from "./ip-store";
import {
  runKnowledgeIntakePrecheck,
  type KnowledgeIntakePrecheckAssessment,
  type KnowledgeIntakePrecheckCandidate,
} from "./knowledge-intake-precheck";
import type { KnowledgeCategory, KnowledgeEntry } from "./types";

const REVIEWED_METHOD_CATEGORIES = new Set<KnowledgeCategory>([
  "方法论",
  "定位方法库",
  "选题方法库",
  "标题方法库",
  "开头方法库",
  "文案框架方法库",
]);

const preparedBatchMarker = Symbol("reviewed-method-card-batch");
const cardsFingerprintKey = Symbol("reviewed-method-card-content-fingerprint");
const comparisonFingerprintKey = Symbol("reviewed-method-card-comparison-fingerprint");
const assessmentFingerprintKey = Symbol("reviewed-method-card-assessment-fingerprint");

export interface ReviewedMethodCardInput {
  cardKey: string;
  title: string;
  category: KnowledgeCategory;
  summary: string;
  coreMethod: string;
  checkQuestions: string[];
  applicableScenarios: string[];
  triggerKeywords: string[];
  aiUsage: string;
  unsuitableCases: string[];
  sourceChapterBasis: string[];
  sourceName: string;
}

export interface PrepareReviewedMethodCardBatchInput {
  collectionKey: string;
  cards: ReviewedMethodCardInput[];
}

export interface PreparedReviewedMethodCardBatch {
  readonly assessments: readonly KnowledgeIntakePrecheckAssessment[];
  readonly collectionKey: string;
  readonly cards: readonly ReviewedMethodCardInput[];
  readonly [preparedBatchMarker]: true;
  readonly [cardsFingerprintKey]: string;
  readonly [comparisonFingerprintKey]: string;
  readonly [assessmentFingerprintKey]: string;
}

function cleanRequiredText(value: string, label: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label}不能为空`);
  return cleaned;
}

function cleanRequiredList(values: string[], label: string): string[] {
  const cleaned = values.map(value => value.trim()).filter(Boolean);
  if (cleaned.length === 0) throw new Error(`${label}不能为空`);
  return cleaned;
}

function normalizeCard(card: ReviewedMethodCardInput): ReviewedMethodCardInput {
  const cardKey = cleanRequiredText(card.cardKey, "方法卡编号");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cardKey)) {
    throw new Error("方法卡编号只能使用小写字母、数字和连字符");
  }
  if (!REVIEWED_METHOD_CATEGORIES.has(card.category)) {
    throw new Error("人工确认方法卡必须保存到通用方法类知识库");
  }
  return {
    cardKey,
    title: cleanRequiredText(card.title, "方法卡标题"),
    category: card.category,
    summary: cleanRequiredText(card.summary, "一句话总结"),
    coreMethod: cleanRequiredText(card.coreMethod, "核心方法"),
    checkQuestions: cleanRequiredList(card.checkQuestions, "具体检查问题"),
    applicableScenarios: cleanRequiredList(card.applicableScenarios, "适用场景"),
    triggerKeywords: cleanRequiredList(card.triggerKeywords, "触发关键词"),
    aiUsage: cleanRequiredText(card.aiUsage, "AI调用方式"),
    unsuitableCases: cleanRequiredList(card.unsuitableCases, "不适用范围"),
    sourceChapterBasis: cleanRequiredList(card.sourceChapterBasis, "原文章节依据"),
    sourceName: cleanRequiredText(card.sourceName, "来源名称"),
  };
}

function buildRawContent(card: ReviewedMethodCardInput): string {
  return [
    `【一句话总结】\n${card.summary}`,
    `【核心方法】\n${card.coreMethod}`,
    `【具体检查问题】\n${card.checkQuestions.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
    `【适用场景】\n${card.applicableScenarios.join("、")}`,
    `【触发关键词】\n${card.triggerKeywords.join("、")}`,
    `【AI调用方式】\n${card.aiUsage}`,
    `【不适用范围】\n${card.unsuitableCases.join("、")}`,
    `【原文章节依据】\n${card.sourceChapterBasis.join("、")}`,
    `【来源】\n${card.sourceName}`,
    "【来源等级】\n待确认",
    "【可信度说明】\n人工依据原文整理，尚未结合真实采用和发布效果验证",
  ].join("\n\n");
}

function toPrecheckCandidate(card: ReviewedMethodCardInput): KnowledgeIntakePrecheckCandidate {
  return {
    id: card.cardKey,
    kind: "method_card",
    title: card.title,
    summary: card.summary,
    coreMethod: card.coreMethod,
    applicableScenarios: card.applicableScenarios,
    aiUsage: card.aiUsage,
    rawContent: buildRawContent(card),
  };
}

function normalizeSerializable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSerializable);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, normalizeSerializable(nested)]),
  );
}

function comparisonFingerprint(entries: readonly KnowledgeEntry[]): string {
  return JSON.stringify(normalizeSerializable(entries.map(entry => ({
    id: entry.id,
    title: entry.title,
    category: entry.category,
    rawContent: entry.rawContent,
    keywords: entry.keywords,
    contentDirection: entry.contentDirection,
    ipId: entry.ipId,
    sourcePlatform: entry.sourcePlatform,
    sourceName: entry.sourceName,
    sourceUrl: entry.sourceUrl,
    note: entry.note,
    createdAt: entry.createdAt,
  })).sort((left, right) => left.id.localeCompare(right.id))));
}

function assessmentsFingerprint(
  assessments: readonly KnowledgeIntakePrecheckAssessment[],
): string {
  return JSON.stringify(normalizeSerializable(assessments));
}

function batchContentFingerprint(
  collectionKey: string,
  cards: readonly ReviewedMethodCardInput[],
): string {
  return JSON.stringify(normalizeSerializable({ collectionKey, cards }));
}

function ownedEntryId(collectionKey: string, cardKey: string): string {
  return `reviewed-method:${collectionKey}:${cardKey}`;
}

function comparisonEntries(
  collectionKey: string,
  cards: readonly ReviewedMethodCardInput[],
): KnowledgeEntry[] {
  const ownedIds = new Set(cards.map(card => ownedEntryId(collectionKey, card.cardKey)));
  return getKnowledgeEntriesForFullLibraryComparison()
    .filter(entry => !ownedIds.has(entry.id));
}

export function prepareReviewedMethodCardBatch(
  input: PrepareReviewedMethodCardBatchInput,
): PreparedReviewedMethodCardBatch {
  const collectionKey = cleanRequiredText(input.collectionKey, "方法卡集合编号");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(collectionKey)) {
    throw new Error("方法卡集合编号只能使用小写字母、数字和连字符");
  }
  if (input.cards.length === 0) throw new Error("至少需要一张已审核方法卡");
  const cards = input.cards.map(normalizeCard);
  if (new Set(cards.map(card => card.cardKey)).size !== cards.length) {
    throw new Error("同一批次存在重复的方法卡编号");
  }
  const existingEntries = comparisonEntries(collectionKey, cards);
  const assessments = runKnowledgeIntakePrecheck({
    candidates: cards.map(toPrecheckCandidate),
    existingEntries,
  }).assessments;
  return {
    assessments,
    collectionKey,
    cards,
    [preparedBatchMarker]: true,
    [cardsFingerprintKey]: batchContentFingerprint(collectionKey, cards),
    [comparisonFingerprintKey]: comparisonFingerprint(existingEntries),
    [assessmentFingerprintKey]: assessmentsFingerprint(assessments),
  };
}

export function saveReviewedMethodCardBatch(
  prepared: PreparedReviewedMethodCardBatch,
): KnowledgeEntry[] {
  if (prepared[preparedBatchMarker] !== true) {
    throw new Error("方法卡尚未完成本次全库检查，已拒绝保存");
  }
  if (
    prepared[cardsFingerprintKey]
    !== batchContentFingerprint(prepared.collectionKey, prepared.cards)
  ) {
    throw new Error("方法卡内容已变化，请重新检查并确认后再保存");
  }
  const existingEntries = comparisonEntries(prepared.collectionKey, prepared.cards);
  const currentAssessments = runKnowledgeIntakePrecheck({
    candidates: prepared.cards.map(toPrecheckCandidate),
    existingEntries,
  }).assessments;
  if (
    prepared[comparisonFingerprintKey] !== comparisonFingerprint(existingEntries)
    || prepared[assessmentFingerprintKey] !== assessmentsFingerprint(currentAssessments)
  ) {
    throw new Error("全库检查结果已变化，请重新检查并确认后再保存");
  }
  return saveReviewedMethodCardEntries({
    collectionKey: prepared.collectionKey,
    cards: prepared.cards.map(card => ({
      cardKey: card.cardKey,
      category: card.category,
      title: card.title,
      rawContent: buildRawContent(card),
      tags: ["人工确认方法卡"],
      keywords: [...card.triggerKeywords],
      contentDirection: [...card.applicableScenarios],
      sourceName: card.sourceName,
      note: JSON.stringify({
        methodCard: true,
        coreMethod: card.coreMethod,
        checkQuestions: card.checkQuestions,
        applicableScenarios: card.applicableScenarios,
        triggerKeywords: card.triggerKeywords,
        aiUsage: card.aiUsage,
        unsuitableCases: card.unsuitableCases,
        sourceChapterBasis: card.sourceChapterBasis,
      }),
    })),
  });
}
