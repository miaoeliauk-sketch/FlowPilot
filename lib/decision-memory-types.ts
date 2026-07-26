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

export const CONTENT_DECISION_STAGES = [
  "选题判断",
  "标题判断",
  "开头判断",
  "脚本结构",
  "内容形式",
  "受众判断",
  "流量判断",
  "转化判断",
  "拍摄执行",
  "发布策略",
  "其他",
] as const;

export type ContentDecisionStage = (typeof CONTENT_DECISION_STAGES)[number];
export type DecisionCaptureMode = "full" | "quick_capture";

export interface DecisionAISummary {
  theme: string;
  coreDecision: string;
  basis: string;
  applicableScenarios: string[];
  corePrinciple: string;
  keywords: string[];
  organizedAt: string;
  model: string;
  contentStage?: ContentDecisionStage;
  applicableIP?: string;
  futureValidationSuggestion?: string;
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
  rawInput?: string;
  captureMode?: DecisionCaptureMode;
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

export interface QuickCaptureAIResult {
  theme: string;
  coreDecision: string;
  basis: string;
  contentStage: ContentDecisionStage;
  applicableIP: string;
  futureValidationSuggestion: string;
  corePrinciple: string;
  keywords: string[];
  model: string;
}

export interface CreateQuickDecisionInput {
  rawInput: string;
  summary: QuickCaptureAIResult | null;
}

export type SaveDecisionReviewInput = Omit<DecisionReview, "reviewedAt">;
