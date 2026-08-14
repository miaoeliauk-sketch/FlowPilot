import {
  applyEvidenceReview,
  CopyIntegrationValidationError,
  parseAndValidateEvidenceExtraction,
  parseAndValidateSynthesis,
  requiresRiskReview,
} from "./copy-integration-evidence";
import type {
  CopyIntegrationInternalResult,
  CopyIntegrationModelAdapter,
  CopyIntegrationModelRequest,
  EvidenceTable,
} from "./copy-integration-internal-types";
import {
  buildExtractionPrompt,
  buildReviewPrompt,
  buildSynthesisPrompt,
  EXTRACTION_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  SYNTHESIS_SYSTEM_PROMPT,
} from "./copy-integration-prompts";
import type { CopyIntegrationSource } from "./copy-integration-types";

const MAX_MODEL_CALLS = 4;

export class CopyIntegrationPipelineError extends Error {
  readonly stage: CopyIntegrationModelRequest["stage"];
  readonly callCount: number;
  readonly diagnosticCode: string;

  constructor(stage: CopyIntegrationModelRequest["stage"], callCount: number, cause: unknown) {
    super("文案整合流水线校验失败");
    this.name = "CopyIntegrationPipelineError";
    this.stage = stage;
    this.callCount = callCount;
    this.diagnosticCode = cause instanceof CopyIntegrationValidationError
      ? cause.diagnosticCode
      : "MODEL_REQUEST_FAILED";
  }
}

function safeCorrection(error: unknown): string {
  const code = error instanceof CopyIntegrationValidationError ? error.diagnosticCode : "MODEL_REQUEST_FAILED";
  const instructions: Record<string, string> = {
    ORIGINAL_QUOTE_NOT_FOUND: "Original_Quote未在对应素材中逐字找到。请重新逐字复制原文，不得改写或拼接。",
    SOURCE_CONTENT_OMITTED: "有素材文字未被证据覆盖。请为每个独立观点、案例和故事提取原子事实；提问过渡、序号、自我表态等不承载观点的文字也要逐字登记，并归类为context_only。Original_Quote必须逐字来自素材。",
    OBVIOUS_RELATION_MISSING: "跨素材中存在明显重复观点但缺少关系。请补充overlap、complement或conflict关系。",
    INVALID_RELATION_FACTS: "关系必须引用至少两个不同且真实存在的Fact_ID；conflict只能并列双方事实。",
    DUPLICATE_FACT_CONTENT: "同一素材中的同一段原文被重复登记。请只保留一次。",
    DUPLICATE_RELATION_CONTENT: "同一组Fact_ID被重复登记为相同关系。请只保留一条关系。",
    NON_EXTRACTIVE_STATEMENT: "statement必须逐字来自originalQuote，并完整表达核心意思，不能概括改写。请重新提取。",
    EXCLUSION_CANDIDATE_NOT_ISOLATED: "待用户确认的排除候选必须独占一个section，且该section只能包含这一个Fact_ID的paragraphPlan，不能和正常观点合并。",
    CONFLICTING_RELATION_TYPES: "同一对Fact_ID只能有一种关系类型。请拒绝错误旧关系，再提交正确的新关系。",
    UNSUPPORTED_SPECIFIC_DETAIL: "母稿加入了证据表之外的人物、数字、时间、地点或案例。请删除所有无证据细节，只使用已登记事实。",
    UNSUPPORTED_CLAIM: "母稿存在证据无法支持的普通事实或结论。请逐句核对，只保留证据表能够直接支持的表达。",
    FACT_NOT_REPRESENTED: "有可用观点只挂了引用编号或被完全遗漏。请让每个未拒绝的Fact_ID都在母稿中得到实质表达。",
    RELATION_NOT_INTEGRATED: "有关联的观点仍被分开罗列。请把overlap或complement关系的事实编织进同一逻辑段落。",
    RELATION_COMPONENT_SPLIT: "同一关系链中的Fact_ID必须放进同一逻辑段落，不能拆开罗列。",
    OVERLAP_NOT_DEDUPLICATED: "重叠观点仍在重复搬运原文。请提炼成一次统一表达，并保留全部来源引用。",
    CONFLICT_AUTO_DECIDED: "冲突观点不能自动选边。请并列双方说法，明确分歧并保留待确认状态。",
    INVALID_PARAGRAPH_PLAN: "母稿规划只能输出paragraphPlans，每项只能包含factIds，不能输出标题、正文或其他字段。",
    EVIDENCE_NOTICE_MISSING: "依据不足观点必须保留在母稿中，并明确写出“这部分说法缺乏权威来源支撑，建议使用前核实。”",
  };
  return instructions[code] ?? "上次输出未通过固定校验。请严格按结构输出，并只使用已提供的证据。";
}

export async function runCopyIntegrationPipeline(input: {
  sources: CopyIntegrationSource[];
  instruction: string;
  model: CopyIntegrationModelAdapter;
}): Promise<CopyIntegrationInternalResult> {
  let callCount = 0;
  let correctionUsed = false;

  async function complete(request: CopyIntegrationModelRequest): Promise<string> {
    if (callCount >= MAX_MODEL_CALLS) throw new Error("文案整合模型调用次数超过上限");
    callCount += 1;
    return input.model.complete(request);
  }

  async function runValidated<T>(
    request: CopyIntegrationModelRequest,
    validate: (content: string) => T,
  ): Promise<T> {
    try {
      return validate(await complete(request));
    } catch (error) {
      if (!(error instanceof CopyIntegrationValidationError)) {
        throw new CopyIntegrationPipelineError(request.stage, callCount, error);
      }
      // 复核模型无权拆分或改写证据；原子性失败在当前阶段无法纠正，直接安全关闭。
      if (error.diagnosticCode === "NON_ATOMIC_FACT") {
        throw new CopyIntegrationPipelineError(request.stage, callCount, error);
      }
      if (correctionUsed || callCount >= MAX_MODEL_CALLS) {
        throw new CopyIntegrationPipelineError(request.stage, callCount, error);
      }
      correctionUsed = true;
      try {
        return validate(await complete({
          ...request,
          userPrompt: `${request.userPrompt}\n\n【上次输出纠错要求】\n${safeCorrection(error)}`,
        }));
      } catch (retryError) {
        throw new CopyIntegrationPipelineError(request.stage, callCount, retryError);
      }
    }
  }

  let evidenceTable = await runValidated({
    stage: "extract",
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    userPrompt: buildExtractionPrompt(input.sources, input.instruction),
    maxTokens: 6_000,
    temperature: 0.1,
  }, content => parseAndValidateEvidenceExtraction(content, input.sources));

  // 独立复核是正常路径的固定步骤：提取→复核→生成；整条链路仍最多4次调用。
  const riskReviewUsed = requiresRiskReview(evidenceTable);
  if (riskReviewUsed) {
    evidenceTable = await runValidated({
      stage: "review",
      systemPrompt: REVIEW_SYSTEM_PROMPT,
      userPrompt: buildReviewPrompt(evidenceTable),
      maxTokens: 3_000,
      temperature: 0,
    }, content => applyEvidenceReview(content, evidenceTable));
  }

  if (evidenceTable.facts.every(fact => fact.status === "rejected")) {
    throw new CopyIntegrationPipelineError(
      riskReviewUsed ? "review" : "extract",
      callCount,
      new CopyIntegrationValidationError("NO_USABLE_FACTS", "没有可用于生成母稿的证据"),
    );
  }

  const synthesis = await runValidated({
    stage: "synthesize",
    systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
    userPrompt: buildSynthesisPrompt(evidenceTable, input.instruction),
    maxTokens: 4_000,
    temperature: 0.2,
  }, content => parseAndValidateSynthesis(content, evidenceTable));

  return { evidenceTable, synthesis, callCount, riskReviewUsed };
}
