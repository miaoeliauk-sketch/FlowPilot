export const DECISION_CATEGORIES = [
  "选题",
  "标题",
  "脚本",
  "产品",
  "工具",
  "战略",
  "面试",
  "个人成长",
] as const;

export type DecisionCategory = (typeof DECISION_CATEGORIES)[number];

export const CONFIDENCE_LEVELS = [1, 2, 3, 4, 5] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const DECISION_VERDICTS = [
  "成立",
  "部分成立",
  "不成立",
  "暂无法判断",
] as const;

export type DecisionVerdict = (typeof DECISION_VERDICTS)[number];

export interface DecisionAISummary {
  theme: string;
  coreDecision: string;
  basis: string;
  applicableScenarios: string[];
  corePrinciple: string;
  keywords: string[];
  organizedAt: string;
  model: string;
}

export interface DecisionReview {
  actualOutcome: string;
  verdict: DecisionVerdict;
  explanation: string;
  newPrinciple: string;
  nextTimeAction: string;
  reviewedAt: string;
}

export interface DecisionRecord {
  id: string;
  decision: string;
  context: string;
  reasoning: string;
  category: DecisionCategory;
  futureValidation: string;
  source: string;
  confidence: ConfidenceLevel;
  aiSummary: DecisionAISummary | null;
  review: DecisionReview | null;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionMemoryState {
  schemaVersion: 1;
  records: DecisionRecord[];
}

export type CreateDecisionInput = Pick<
  DecisionRecord,
  | "decision"
  | "context"
  | "reasoning"
  | "category"
  | "futureValidation"
  | "source"
  | "confidence"
>;

export type DecisionAIResult = Omit<DecisionAISummary, "organizedAt">;
export type SaveDecisionReviewInput = Omit<DecisionReview, "reviewedAt">;
