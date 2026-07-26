import {
  DECISION_CATEGORIES,
  DECISION_VERDICTS,
  CONFIDENCE_LEVELS,
  CONTENT_DECISION_STAGES,
  ContentDecisionStage,
  CreateQuickDecisionInput,
  DecisionAIResult,
  DecisionCategory,
  DecisionMemoryState,
  DecisionRecord,
  SaveDecisionReviewInput,
  CreateDecisionInput,
} from "./decision-memory-types";

export const DECISION_MEMORY_STORAGE_KEY = "flowpilot:decisionRecords:v1";

const EMPTY_STATE: DecisionMemoryState = {
  schemaVersion: 1,
  records: [],
};

function ensureBrowser(): void {
  if (typeof window === "undefined") {
    throw new Error("判断库只能在浏览器中读取或保存");
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isDecisionRecord(value: unknown): value is DecisionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<DecisionRecord>;
  const aiSummary = record.aiSummary;
  const review = record.review;

  const validSummary =
    aiSummary === null ||
    Boolean(
      aiSummary &&
      typeof aiSummary.theme === "string" &&
      typeof aiSummary.coreDecision === "string" &&
      typeof aiSummary.basis === "string" &&
      isStringArray(aiSummary.applicableScenarios) &&
      typeof aiSummary.corePrinciple === "string" &&
      isStringArray(aiSummary.keywords) &&
      typeof aiSummary.organizedAt === "string" &&
      typeof aiSummary.model === "string" &&
      (aiSummary.contentStage === undefined ||
        CONTENT_DECISION_STAGES.includes(aiSummary.contentStage)) &&
      (aiSummary.applicableIP === undefined ||
        typeof aiSummary.applicableIP === "string") &&
      (aiSummary.futureValidationSuggestion === undefined ||
        typeof aiSummary.futureValidationSuggestion === "string"),
    );

  const validReview =
    review === null ||
    Boolean(
      review &&
      typeof review.actualOutcome === "string" &&
      DECISION_VERDICTS.includes(review.verdict as (typeof DECISION_VERDICTS)[number]) &&
      typeof review.explanation === "string" &&
      typeof review.newPrinciple === "string" &&
      typeof review.nextTimeAction === "string" &&
      typeof review.reviewedAt === "string",
    );

  return Boolean(
    typeof record.id === "string" &&
    (record.rawInput === undefined || typeof record.rawInput === "string") &&
    (record.captureMode === undefined ||
      record.captureMode === "full" ||
      record.captureMode === "quick_capture") &&
    typeof record.decision === "string" &&
    typeof record.context === "string" &&
    typeof record.reasoning === "string" &&
    DECISION_CATEGORIES.includes(record.category as (typeof DECISION_CATEGORIES)[number]) &&
    typeof record.futureValidation === "string" &&
    typeof record.source === "string" &&
    CONFIDENCE_LEVELS.includes(record.confidence as (typeof CONFIDENCE_LEVELS)[number]) &&
    validSummary &&
    validReview &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string",
  );
}

function readState(): DecisionMemoryState {
  ensureBrowser();
  const raw = localStorage.getItem(DECISION_MEMORY_STORAGE_KEY);
  if (!raw) return { ...EMPTY_STATE, records: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("判断库本地数据无法解析。为避免覆盖原数据，系统已停止写入");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("判断库本地数据格式异常。为避免覆盖原数据，系统已停止写入");
  }

  const state = parsed as Partial<DecisionMemoryState>;
  if (
    state.schemaVersion !== 1 ||
    !Array.isArray(state.records) ||
    !state.records.every(isDecisionRecord)
  ) {
    throw new Error("判断库数据版本或字段不兼容。为避免覆盖原数据，系统已停止写入");
  }

  return { schemaVersion: 1, records: state.records };
}

function writeState(state: DecisionMemoryState): void {
  ensureBrowser();
  try {
    localStorage.setItem(DECISION_MEMORY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    throw new Error("判断保存失败，浏览器本地存储空间可能不足");
  }
}

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function clean(value: string): string {
  return value.trim();
}

function categoryFromContentStage(stage: ContentDecisionStage): DecisionCategory {
  if (stage === "选题判断") return "选题";
  if (stage === "标题判断") return "标题";
  if (["开头判断", "脚本结构", "内容形式"].includes(stage)) return "脚本";
  return "战略";
}

function updateRecord(
  id: string,
  updater: (record: DecisionRecord, now: string) => DecisionRecord,
): DecisionRecord {
  const state = readState();
  const index = state.records.findIndex((record) => record.id === id);
  if (index < 0) throw new Error("没有找到这条判断记录");

  const now = new Date().toISOString();
  const updated = updater(state.records[index], now);
  const records = [...state.records];
  records[index] = updated;
  writeState({ schemaVersion: 1, records });
  return updated;
}

export function getDecisionRecords(): DecisionRecord[] {
  return [...readState().records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getDecisionRecord(id: string): DecisionRecord | null {
  return readState().records.find((record) => record.id === id) ?? null;
}

export function createDecisionRecord(input: CreateDecisionInput): DecisionRecord {
  if (!DECISION_CATEGORIES.includes(input.category)) {
    throw new Error("判断分类不在允许范围内");
  }
  if (!CONFIDENCE_LEVELS.includes(input.confidence)) {
    throw new Error("确信程度必须是1至5级");
  }
  if (
    !input.decision.trim() ||
    !input.context.trim() ||
    !input.reasoning.trim() ||
    !input.futureValidation.trim() ||
    !input.source.trim()
  ) {
    throw new Error("请填写完整后再保存判断");
  }

  const state = readState();
  const now = new Date().toISOString();
  const record: DecisionRecord = {
    id: createId(),
    captureMode: "full",
    decision: clean(input.decision),
    context: clean(input.context),
    reasoning: clean(input.reasoning),
    category: input.category,
    futureValidation: clean(input.futureValidation),
    source: clean(input.source),
    confidence: input.confidence,
    aiSummary: null,
    review: null,
    createdAt: now,
    updatedAt: now,
  };

  writeState({ schemaVersion: 1, records: [record, ...state.records] });
  return record;
}

export function createQuickDecisionRecord(
  input: CreateQuickDecisionInput,
): DecisionRecord {
  const rawInput = clean(input.rawInput);
  if (!rawInput) {
    throw new Error("请先写下一句话判断");
  }

  const summary = input.summary;
  if (summary && !CONTENT_DECISION_STAGES.includes(summary.contentStage)) {
    throw new Error("涉及环节不在允许范围内");
  }

  const state = readState();
  const now = new Date().toISOString();
  const record: DecisionRecord = {
    id: createId(),
    rawInput,
    captureMode: "quick_capture",
    decision: clean(summary?.coreDecision || rawInput),
    context: rawInput,
    reasoning: clean(summary?.basis || ""),
    category: summary ? categoryFromContentStage(summary.contentStage) : "选题",
    futureValidation: clean(summary?.futureValidationSuggestion || ""),
    source: "quick_capture",
    confidence: 3,
    aiSummary: summary ? {
      theme: clean(summary.theme),
      coreDecision: clean(summary.coreDecision),
      basis: clean(summary.basis),
      applicableScenarios: [summary.contentStage],
      corePrinciple: clean(summary.corePrinciple),
      keywords: summary.keywords.map(clean).filter(Boolean).slice(0, 6),
      model: clean(summary.model),
      organizedAt: now,
      contentStage: summary.contentStage,
      applicableIP: clean(summary.applicableIP),
      futureValidationSuggestion: clean(summary.futureValidationSuggestion),
    } : null,
    review: null,
    createdAt: now,
    updatedAt: now,
  };

  writeState({ schemaVersion: 1, records: [record, ...state.records] });
  return record;
}

export function saveDecisionAISummary(id: string, result: DecisionAIResult): DecisionRecord {
  return updateRecord(id, (record, now) => ({
    ...record,
    aiSummary: {
      theme: clean(result.theme),
      coreDecision: clean(result.coreDecision),
      basis: clean(result.basis),
      applicableScenarios: result.applicableScenarios.map(clean).filter(Boolean),
      corePrinciple: clean(result.corePrinciple),
      keywords: result.keywords.map(clean).filter(Boolean),
      model: clean(result.model),
      organizedAt: now,
      contentStage: result.contentStage ?? record.aiSummary?.contentStage,
      applicableIP: result.applicableIP === undefined
        ? record.aiSummary?.applicableIP
        : clean(result.applicableIP),
      futureValidationSuggestion: result.futureValidationSuggestion === undefined
        ? record.aiSummary?.futureValidationSuggestion
        : clean(result.futureValidationSuggestion),
    },
    updatedAt: now,
  }));
}

export function saveDecisionReview(
  id: string,
  input: SaveDecisionReviewInput,
): DecisionRecord {
  if (!DECISION_VERDICTS.includes(input.verdict)) {
    throw new Error("复盘结论不在允许范围内");
  }
  if (
    !input.actualOutcome.trim() ||
    !input.explanation.trim() ||
    !input.newPrinciple.trim() ||
    !input.nextTimeAction.trim()
  ) {
    throw new Error("请完整填写复盘内容");
  }

  return updateRecord(id, (record, now) => ({
    ...record,
    review: {
      actualOutcome: clean(input.actualOutcome),
      verdict: input.verdict,
      explanation: clean(input.explanation),
      newPrinciple: clean(input.newPrinciple),
      nextTimeAction: clean(input.nextTimeAction),
      reviewedAt: now,
    },
    updatedAt: now,
  }));
}
