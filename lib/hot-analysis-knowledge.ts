import { getKnowledgeEntriesForFullLibraryComparison } from "./ip-store";
import {
  runKnowledgeIntakePrecheck,
  type KnowledgeIntakePrecheckAssessment,
} from "./knowledge-intake-precheck";
import type { KnowledgeCategory } from "./types";

export interface HotAnalysisViralCaseCandidate {
  title: string;
  rawContent: string;
}

export interface HotAnalysisMethodCardCandidate {
  name: string;
  targetCategory: Extract<
    KnowledgeCategory,
    "定位方法库" | "选题方法库" | "标题方法库" | "开头方法库" | "文案框架方法库"
  >;
  summary: string;
  coreMethod?: string;
  applicableScenes?: string[];
  triggerKeywords?: string[];
  aiUsage?: string;
  example?: string;
  unsuitableCases?: string;
}

export interface HotAnalysisKnowledgePrecheckInput {
  analysisId: string;
  viralCase: HotAnalysisViralCaseCandidate | null;
  methodCards: HotAnalysisMethodCardCandidate[];
  ipNamesById?: Record<string, string>;
  alreadySavedKnowledgeEntryIds: string[];
}

export interface HotAnalysisKnowledgePrecheckResult {
  viralCase: KnowledgeIntakePrecheckAssessment | null;
  methodCards: KnowledgeIntakePrecheckAssessment[];
}

function listText(values: string[] | undefined): string {
  return (values ?? []).map(value => value.trim()).filter(Boolean).join("、");
}

export function buildHotAnalysisMethodCardContent(
  card: HotAnalysisMethodCardCandidate,
): string {
  return [
    card.summary.trim() ? `【一句话总结】\n${card.summary.trim()}` : "",
    (card.coreMethod ?? card.summary).trim()
      ? `【核心方法】\n${(card.coreMethod ?? card.summary).trim()}`
      : "",
    listText(card.applicableScenes)
      ? `【适用场景】\n${listText(card.applicableScenes)}`
      : "",
    listText(card.triggerKeywords)
      ? `【触发关键词】\n${listText(card.triggerKeywords)}`
      : "",
    card.aiUsage?.trim() ? `【AI调用方式】\n${card.aiUsage.trim()}` : "",
    card.example?.trim() ? `【示例】\n${card.example.trim()}` : "",
    card.unsuitableCases?.trim()
      ? `【不适用情况】\n${card.unsuitableCases.trim()}`
      : "",
  ].filter(Boolean).join("\n\n");
}

export function runHotAnalysisKnowledgePrecheck(
  input: HotAnalysisKnowledgePrecheckInput,
): HotAnalysisKnowledgePrecheckResult {
  const alreadySavedIds = new Set(input.alreadySavedKnowledgeEntryIds);
  const existingEntries = getKnowledgeEntriesForFullLibraryComparison()
    .filter(entry => !alreadySavedIds.has(entry.id));
  const viralCase = input.viralCase
    ? runKnowledgeIntakePrecheck({
      candidates: [{
        id: `${input.analysisId}:viral-case`,
        kind: "raw_text",
        title: input.viralCase.title,
        summary: "",
        rawContent: input.viralCase.rawContent,
      }],
      existingEntries,
      ipNamesById: input.ipNamesById,
    }).assessments[0] ?? null
    : null;
  const methodCards = input.methodCards.length > 0
    ? runKnowledgeIntakePrecheck({
      candidates: input.methodCards.map((card, index) => ({
        id: `${input.analysisId}:method-card:${index + 1}`,
        kind: "method_card" as const,
        title: card.name,
        summary: card.summary,
        coreMethod: card.coreMethod ?? card.summary,
        applicableScenarios: card.applicableScenes ?? [],
        aiUsage: card.aiUsage ?? "",
        rawContent: buildHotAnalysisMethodCardContent(card),
      })),
      existingEntries,
      ipNamesById: input.ipNamesById,
    }).assessments
    : [];

  return {
    viralCase,
    methodCards,
  };
}
