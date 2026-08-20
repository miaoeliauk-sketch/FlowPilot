export interface KnowledgeMethodCardSource {
  id: string;
  title: string;
  index: number;
}

export interface KnowledgeMethodCardForDeduplication {
  id: string;
  title: string;
  summary: string;
  coreMethod?: string;
  applicableScenarios?: string[];
  category: string;
  aiUsage?: string;
  sourceSegments: KnowledgeMethodCardSource[];
  tags?: string[];
  triggerKeywords?: string[];
  similarPhrases?: string[];
  examples?: Array<{ input?: string; output?: string }>;
  unsuitableCases?: string[];
  ingestRecommend?: string;
  ingestReason?: string;
  selected?: boolean;
  confidence?: string;
  confidenceReason?: string;
  reusableValue?: string;
}

export interface SimilarKnowledgeMethodCardGroup {
  id: string;
  cardIds: string[];
}

interface ComparisonScores {
  title: number;
  summary: number;
  coreMethod: number;
  scenarios: number;
  aiUsage: number;
}

const FULL_WIDTH_CURRENCY_EQUIVALENTS = new Map<string, string>([
  ["￥", "¥"],
  ["￡", "£"],
  ["￦", "₩"],
]);

function normalizeText(value: string | undefined): string {
  return (value ?? "")
    .replace(/\u3000/gu, " ")
    .replace(/[\uFF01-\uFF5E]/gu, character =>
      String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
    .replace(/[￥￡￦]/gu, character =>
      FULL_WIDTH_CURRENCY_EQUIVALENTS.get(character) ?? character)
    .normalize("NFC")
    .replace(/\s+/gu, "");
}

function bigrams(value: string): Set<string> {
  if (value.length < 2) return new Set(value ? [value] : []);
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

function textSimilarity(left: string | undefined, right: string | undefined): number {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft && !normalizedRight) return 0;
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;

  const leftBigrams = bigrams(normalizedLeft);
  const rightBigrams = bigrams(normalizedRight);
  let shared = 0;
  for (const part of leftBigrams) {
    if (rightBigrams.has(part)) shared += 1;
  }
  const dice = (2 * shared) / (leftBigrams.size + rightBigrams.size);
  const shorter = normalizedLeft.length <= normalizedRight.length ? normalizedLeft : normalizedRight;
  const longer = normalizedLeft.length > normalizedRight.length ? normalizedLeft : normalizedRight;
  const containment = longer.includes(shorter) ? (shorter.length / longer.length) * 0.95 : 0;
  return Math.max(dice, containment);
}

function normalizedSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map(normalizeText).filter(Boolean));
}

function setSimilarity(left: string[] | undefined, right: string[] | undefined): number {
  const leftSet = normalizedSet(left);
  const rightSet = normalizedSet(right);
  if (leftSet.size === 0 && rightSet.size === 0) return 0;
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  let intersection = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) intersection += 1;
  }
  return intersection / new Set([...leftSet, ...rightSet]).size;
}

function setsEqual(left: string[] | undefined, right: string[] | undefined): boolean {
  const leftSet = normalizedSet(left);
  const rightSet = normalizedSet(right);
  return leftSet.size === rightSet.size && [...leftSet].every(value => rightSet.has(value));
}

function hasComparableCriticalFields(card: KnowledgeMethodCardForDeduplication): boolean {
  return Boolean(
    normalizeText(card.title) &&
    normalizeText(card.summary) &&
    normalizeText(card.coreMethod) &&
    normalizedSet(card.applicableScenarios).size > 0 &&
    normalizeText(card.aiUsage),
  );
}

function compareCards(
  left: KnowledgeMethodCardForDeduplication,
  right: KnowledgeMethodCardForDeduplication,
): ComparisonScores {
  return {
    title: textSimilarity(left.title, right.title),
    summary: textSimilarity(left.summary, right.summary),
    coreMethod: textSimilarity(left.coreMethod, right.coreMethod),
    scenarios: setSimilarity(left.applicableScenarios, right.applicableScenarios),
    aiUsage: textSimilarity(left.aiUsage, right.aiUsage),
  };
}

function isExactDuplicate(
  left: KnowledgeMethodCardForDeduplication,
  right: KnowledgeMethodCardForDeduplication,
): boolean {
  if (left.category !== right.category) return false;
  if (!hasComparableCriticalFields(left) || !hasComparableCriticalFields(right)) return false;
  return normalizeText(left.title) === normalizeText(right.title) &&
    normalizeText(left.summary) === normalizeText(right.summary) &&
    normalizeText(left.coreMethod) === normalizeText(right.coreMethod) &&
    setsEqual(left.applicableScenarios, right.applicableScenarios) &&
    normalizeText(left.aiUsage) === normalizeText(right.aiUsage);
}

function isHighlySimilar(
  left: KnowledgeMethodCardForDeduplication,
  right: KnowledgeMethodCardForDeduplication,
): boolean {
  if (left.category !== right.category) return false;
  if (!hasComparableCriticalFields(left) || !hasComparableCriticalFields(right)) return false;
  const scores = compareCards(left, right);
  const contentScores = [scores.summary, scores.coreMethod, scores.scenarios, scores.aiUsage];
  const relatedDimensions = contentScores.filter(score => score >= 0.45).length;
  const weighted = scores.title * 0.1 +
    scores.summary * 0.22 +
    scores.coreMethod * 0.3 +
    scores.scenarios * 0.16 +
    scores.aiUsage * 0.22;
  return scores.title >= 0.4 && scores.coreMethod >= 0.58 && relatedDimensions >= 3 && weighted >= 0.55;
}

function completenessScore(card: KnowledgeMethodCardForDeduplication): number {
  const textScore = [card.title, card.summary, card.coreMethod, card.aiUsage]
    .reduce((total, value) => total + normalizeText(value).length, 0);
  return textScore +
    (card.applicableScenarios?.length ?? 0) * 10 +
    (card.tags?.length ?? 0) * 2 +
    (card.triggerKeywords?.length ?? 0) * 2 +
    (card.similarPhrases?.length ?? 0) * 2 +
    (card.examples?.length ?? 0) * 15 +
    (card.unsuitableCases?.length ?? 0) * 8;
}

function uniqueSources(sources: KnowledgeMethodCardSource[]): KnowledgeMethodCardSource[] {
  const seen = new Set<string>();
  return sources
    .filter(source => {
      if (seen.has(source.id)) return false;
      seen.add(source.id);
      return true;
    })
    .sort((left, right) => left.index - right.index);
}

function uniqueStrings(values: Array<string[] | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values.flatMap(item => item ?? [])) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
  }
  return result;
}

function uniqueExamples(
  values: Array<Array<{ input?: string; output?: string }> | undefined>,
): Array<{ input?: string; output?: string }> {
  const result: Array<{ input?: string; output?: string }> = [];
  const seen = new Set<string>();
  for (const example of values.flatMap(item => item ?? [])) {
    const key = JSON.stringify([
      normalizeText(example.input),
      normalizeText(example.output),
    ]);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(example);
  }
  return result;
}

function chooseLonger(values: Array<string | undefined>): string | undefined {
  return values.reduce<string | undefined>((best, value) =>
    normalizeText(value).length > normalizeText(best).length ? value : best, undefined);
}

function mergeDistinctText(values: Array<string | undefined>): string | undefined {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (value === undefined) continue;
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
  }
  return result.length > 0 ? result.join("；") : undefined;
}

export function mergeKnowledgeMethodCards<T extends KnowledgeMethodCardForDeduplication>(
  cards: T[],
): T {
  if (cards.length === 0) throw new Error("至少需要一张方法卡");
  const base = cards.reduce((best, card) =>
    completenessScore(card) > completenessScore(best) ? card : best);
  const recommendations = cards
    .map(card => card.ingestRecommend)
    .filter((value): value is string => Boolean(value));
  const recommendationConflict = new Set(recommendations).size > 1;
  const confidenceOrder: Record<string, number> = { "低": 0, "中": 1, "高": 2 };
  const confidences = cards
    .map(card => card.confidence)
    .filter((value): value is string => Boolean(value));
  const mergedConfidence = confidences.reduce<string | undefined>((lowest, value) => {
    if (!lowest) return value;
    return (confidenceOrder[value] ?? 0) < (confidenceOrder[lowest] ?? 0) ? value : lowest;
  }, undefined);
  const confidenceConflict = new Set(confidences).size > 1;
  const reviewConflict = recommendationConflict || confidenceConflict;
  const mergedRecommendation = reviewConflict ? "待确认" : recommendations[0];
  const mergedIngestReason = recommendationConflict
    ? "合并来源的入库建议不一致，请人工确认后再入库。"
    : confidenceConflict
      ? "合并来源的置信度判断不一致，入库状态已降为待确认，请人工确认。"
      : mergeDistinctText(cards.map(card => card.ingestReason));
  const mergedConfidenceReason = confidenceConflict
    ? `合并来源的置信度判断不一致，已按${mergedConfidence ?? "较低"}置信度保守处理，请人工确认。`
    : recommendationConflict
      ? mergeDistinctText(cards.map(card => card.confidenceReason)) ??
        "置信度判断一致，但入库建议存在冲突，请人工确认入库结论。"
      : mergeDistinctText(cards.map(card => card.confidenceReason));
  const mergedReviewState = recommendations.length > 0 || confidences.length > 0
    ? {
        ingestRecommend: mergedRecommendation,
        ingestReason: mergedIngestReason,
        selected: !reviewConflict && mergedRecommendation === "建议入库" && cards.every(card => card.selected === true),
        confidence: mergedConfidence,
        confidenceReason: mergedConfidenceReason,
      }
    : {};
  return {
    ...base,
    ...mergedReviewState,
    title: chooseLonger(cards.map(card => card.title)) ?? base.title,
    summary: chooseLonger(cards.map(card => card.summary)) ?? base.summary,
    coreMethod: chooseLonger(cards.map(card => card.coreMethod)),
    aiUsage: chooseLonger(cards.map(card => card.aiUsage)),
    applicableScenarios: uniqueStrings(cards.map(card => card.applicableScenarios)),
    tags: uniqueStrings(cards.map(card => card.tags)),
    triggerKeywords: uniqueStrings(cards.map(card => card.triggerKeywords)),
    similarPhrases: uniqueStrings(cards.map(card => card.similarPhrases)),
    unsuitableCases: uniqueStrings(cards.map(card => card.unsuitableCases)),
    reusableValue: mergeDistinctText(cards.map(card => card.reusableValue)),
    examples: uniqueExamples(cards.map(card => card.examples)),
    sourceSegments: uniqueSources(cards.flatMap(card => card.sourceSegments)),
  };
}

function buildPairwiseGroups<T extends KnowledgeMethodCardForDeduplication>(
  cards: T[],
  matches: (left: T, right: T) => boolean,
): T[][] {
  const groups: T[][] = [];
  for (const card of cards) {
    const group = groups.find(candidate => candidate.every(member => matches(member, card)));
    if (group) group.push(card);
    else groups.push([card]);
  }
  return groups;
}

function buildGroups<T extends KnowledgeMethodCardForDeduplication>(
  cards: T[],
  matches: (left: T, right: T) => boolean,
): T[][] {
  const parents = cards.map((_, index) => index);
  const find = (index: number): number => {
    if (parents[index] !== index) parents[index] = find(parents[index]!);
    return parents[index]!;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  for (let left = 0; left < cards.length; left += 1) {
    for (let right = left + 1; right < cards.length; right += 1) {
      if (matches(cards[left]!, cards[right]!)) union(left, right);
    }
  }
  const grouped = new Map<number, T[]>();
  cards.forEach((card, index) => {
    const root = find(index);
    grouped.set(root, [...(grouped.get(root) ?? []), card]);
  });
  return [...grouped.values()];
}

export function groupKnowledgeMethodCards<T extends KnowledgeMethodCardForDeduplication>(
  cards: T[],
): {
  cards: T[];
  exactDuplicateCount: number;
  similarGroups: SimilarKnowledgeMethodCardGroup[];
} {
  const exactGroups = buildGroups(cards, isExactDuplicate);
  const consolidated = exactGroups.map(group => {
    if (group.length === 1) return group[0]!;
    return mergeKnowledgeMethodCards(group);
  });
  const similarGroups = buildPairwiseGroups(consolidated, (left, right) =>
    !isExactDuplicate(left, right) && isHighlySimilar(left, right))
    .filter(group => group.length > 1)
    .map(group => ({
      id: `similar:${group.map(card => card.id).sort().join(":")}`,
      cardIds: group.map(card => card.id),
    }));
  return {
    cards: consolidated,
    exactDuplicateCount: cards.length - consolidated.length,
    similarGroups,
  };
}
