export interface KnowledgeSimilarityContent {
  title: string;
  summary: string;
  coreMethod?: string;
  applicableScenarios?: string[];
  aiUsage?: string;
}

export type KnowledgeSimilarityTier = "exact" | "high" | "partial" | "none";

export interface KnowledgeSimilarityScores {
  title: number;
  summary: number;
  coreMethod: number;
  scenarios: number;
  aiUsage: number;
}

export interface KnowledgeSimilarityResult {
  tier: KnowledgeSimilarityTier;
  reasons: string[];
  scores: KnowledgeSimilarityScores;
}

const FULL_WIDTH_CURRENCY_EQUIVALENTS = new Map<string, string>([
  ["￥", "¥"],
  ["￡", "£"],
  ["￦", "₩"],
]);

export function normalizeKnowledgeText(value: string | undefined): string {
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
  const normalizedLeft = normalizeKnowledgeText(left);
  const normalizedRight = normalizeKnowledgeText(right);
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
  return new Set((values ?? []).map(normalizeKnowledgeText).filter(Boolean));
}

function setSimilarity(left: string[] | undefined, right: string[] | undefined): number {
  const leftSet = normalizedSet(left);
  const rightSet = normalizedSet(right);
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

function hasComparableCriticalFields(content: KnowledgeSimilarityContent): boolean {
  return Boolean(
    normalizeKnowledgeText(content.title) &&
    normalizeKnowledgeText(content.summary) &&
    normalizeKnowledgeText(content.coreMethod) &&
    normalizedSet(content.applicableScenarios).size > 0 &&
    normalizeKnowledgeText(content.aiUsage),
  );
}

function compareScores(
  left: KnowledgeSimilarityContent,
  right: KnowledgeSimilarityContent,
): KnowledgeSimilarityScores {
  return {
    title: textSimilarity(left.title, right.title),
    summary: textSimilarity(left.summary, right.summary),
    coreMethod: textSimilarity(left.coreMethod, right.coreMethod),
    scenarios: setSimilarity(left.applicableScenarios, right.applicableScenarios),
    aiUsage: textSimilarity(left.aiUsage, right.aiUsage),
  };
}

function matchingReasons(scores: KnowledgeSimilarityScores, threshold: number): string[] {
  const dimensions: Array<[keyof KnowledgeSimilarityScores, string]> = [
    ["coreMethod", "核心方法"],
    ["summary", "内容摘要"],
    ["aiUsage", "使用方式"],
    ["scenarios", "适用场景"],
    ["title", "标题表达"],
  ];
  return dimensions
    .filter(([key]) => scores[key] >= threshold)
    .map(([, label]) => `${label}存在相似或重合`);
}

export function compareKnowledgeSimilarity(
  left: KnowledgeSimilarityContent,
  right: KnowledgeSimilarityContent,
): KnowledgeSimilarityResult {
  const scores = compareScores(left, right);
  const comparable = hasComparableCriticalFields(left) && hasComparableCriticalFields(right);
  const exact = comparable &&
    normalizeKnowledgeText(left.title) === normalizeKnowledgeText(right.title) &&
    normalizeKnowledgeText(left.summary) === normalizeKnowledgeText(right.summary) &&
    normalizeKnowledgeText(left.coreMethod) === normalizeKnowledgeText(right.coreMethod) &&
    setsEqual(left.applicableScenarios, right.applicableScenarios) &&
    normalizeKnowledgeText(left.aiUsage) === normalizeKnowledgeText(right.aiUsage);
  if (exact) {
    return {
      tier: "exact",
      reasons: ["标题、内容摘要、核心方法、适用场景和使用方式完全一致"],
      scores,
    };
  }
  if (!comparable) return { tier: "none", reasons: [], scores };

  const contentScores = [scores.summary, scores.coreMethod, scores.scenarios, scores.aiUsage];
  const weighted = scores.title * 0.1 +
    scores.summary * 0.22 +
    scores.coreMethod * 0.3 +
    scores.scenarios * 0.16 +
    scores.aiUsage * 0.22;
  const highlyRelatedDimensions = contentScores.filter(score => score >= 0.45).length;
  if (
    scores.title >= 0.4 &&
    scores.coreMethod >= 0.58 &&
    highlyRelatedDimensions >= 3 &&
    weighted >= 0.55
  ) {
    return { tier: "high", reasons: matchingReasons(scores, 0.45), scores };
  }

  const partiallyRelatedDimensions = contentScores.filter(score => score >= 0.3).length;
  if (
    scores.coreMethod >= 0.35 &&
    partiallyRelatedDimensions >= 2 &&
    weighted >= 0.29
  ) {
    return { tier: "partial", reasons: matchingReasons(scores, 0.3), scores };
  }
  return { tier: "none", reasons: [], scores };
}

export function groupPairwiseMatches<T>(
  items: T[],
  matches: (left: T, right: T) => boolean,
): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const group = groups.find(candidate => candidate.every(member => matches(member, item)));
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups;
}
