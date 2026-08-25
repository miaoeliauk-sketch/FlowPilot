import type {
  CognitionAISuggestion,
  CognitionEvidenceType,
  CognitionHumanRevision,
  CognitionNodeV2,
  CognitionReasoningStatus,
  IPSourceAnalysis,
  IPSourceAnalysisKind,
  IPSourceAnalysisItem,
  IPSourceAnalysisSnapshot,
  IPSourceAnalysisV2,
  IPSourceAnchor,
  IPSourceBackedStatement,
} from "./types";
import { calculateSHA256 } from "./sha256";

export type ParseStoredIPSourceAnalysisResult =
  | { ok: true; version: 1; analysis: IPSourceAnalysis }
  | { ok: true; version: 2; analysis: IPSourceAnalysisV2 }
  | { ok: false; error: string };

export interface BuildIPSourceAnalysisV2Input {
  candidate: unknown;
  sourceId: string;
  sourceContent: string;
  analyzedAt: string;
  createId?: () => string;
  anchorScope?: {
    content: string;
    startPosition: number;
  };
}

interface AnchorContext {
  content: string;
  offset: number;
  label: "原文" | "当前分块原文";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVIDENCE_TYPES = new Set<CognitionEvidenceType>([
  "case", "data", "external_fact", "analogy", "counter_example",
]);
const REVIEW_STATUSES = new Set(["ai_extracted", "human_confirmed", "rejected"]);
const REASONING_STATUSES = new Set<CognitionReasoningStatus>(["complete", "partial", "not_provided"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isISOTime(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function createUUID(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("当前环境无法生成认知节点UUID");
  }
  return globalThis.crypto.randomUUID();
}

function locateAnchor(context: AnchorContext, quoteValue: unknown, errorPrefix: string): IPSourceAnchor {
  if (!isNonEmptyString(quoteValue)) {
    throw new Error(`${errorPrefix}缺少原文锚点`);
  }
  const relativeStartPosition = context.content.indexOf(quoteValue);
  if (relativeStartPosition < 0) {
    throw new Error(`${errorPrefix}无法回溯到${context.label}`);
  }
  if (context.content.lastIndexOf(quoteValue) !== relativeStartPosition) {
    throw new Error(`${errorPrefix}锚点不唯一，无法确定对应原文位置`);
  }
  const startPosition = context.offset + relativeStartPosition;
  return {
    quote: quoteValue,
    startPosition,
    endPosition: startPosition + quoteValue.length,
  };
}

function buildAnchors(value: unknown, context: AnchorContext, errorPrefix: string): IPSourceAnchor[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${errorPrefix}缺少原文锚点`);
  }
  return value.map(anchor => locateAnchor(
    context,
    isRecord(anchor) ? anchor.quote : undefined,
    errorPrefix,
  ));
}

function buildStatement(
  value: unknown,
  context: AnchorContext,
  errorPrefix: string,
): IPSourceBackedStatement {
  if (!isRecord(value) || !isNonEmptyString(value.content)) {
    throw new Error(`${errorPrefix}内容无效`);
  }
  return {
    content: value.content.trim(),
    anchors: buildAnchors(value.anchors, context, `${errorPrefix}锚点`),
  };
}

function buildNode(
  value: unknown,
  index: number,
  anchorContext: AnchorContext,
  id: string,
): { nodeRef: string; node: CognitionNodeV2 } {
  const prefix = `第${index + 1}个认知节点`;
  if (!isRecord(value) || !isNonEmptyString(value.nodeRef)) {
    throw new Error(`${prefix}缺少临时引用编号`);
  }
  if (!UUID_PATTERN.test(id)) throw new Error(`${prefix}的服务端UUID无效`);

  if (!isRecord(value.question)
    || (value.question.derivation !== "explicit" && value.question.derivation !== "inferred")) {
    throw new Error(`${prefix}的核心问题无效`);
  }
  const question = buildStatement(value.question, anchorContext, `${prefix}的问题`);
  const claim = buildStatement(value.claim, anchorContext, `${prefix}的观点`);

  if (!isRecord(value.reasoning) || !REASONING_STATUSES.has(value.reasoning.status as CognitionReasoningStatus)
    || !Array.isArray(value.reasoning.steps)) {
    throw new Error(`${prefix}的推理结构无效`);
  }
  const reasoningStatus = value.reasoning.status as CognitionReasoningStatus;
  if (reasoningStatus === "not_provided" && value.reasoning.steps.length > 0) {
    throw new Error(`${prefix}的推理状态为not_provided时不能包含推理步骤`);
  }
  if (reasoningStatus !== "not_provided" && value.reasoning.steps.length === 0) {
    throw new Error(`${prefix}的推理状态要求至少一个原文步骤`);
  }
  const steps = value.reasoning.steps.map((step, stepIndex) => {
    const statement = buildStatement(step, anchorContext, `${prefix}的第${stepIndex + 1}步推理`);
    if (!isRecord(step) || step.order !== stepIndex + 1) {
      throw new Error(`${prefix}的推理步骤顺序无效`);
    }
    return { ...statement, order: stepIndex + 1 };
  });

  if (!Array.isArray(value.evidence) || !Array.isArray(value.concepts)) {
    throw new Error(`${prefix}的证据或概念结构无效`);
  }
  const evidence = value.evidence.map((item, evidenceIndex) => {
    const statement = buildStatement(item, anchorContext, `${prefix}的第${evidenceIndex + 1}条证据`);
    if (!isRecord(item) || !EVIDENCE_TYPES.has(item.type as CognitionEvidenceType)) {
      throw new Error(`${prefix}的第${evidenceIndex + 1}条证据类型无效`);
    }
    if (item.verificationStatus !== undefined && item.verificationStatus !== "unverified") {
      throw new Error(`${prefix}的AI证据不能自行标记为已核实`);
    }
    return {
      ...statement,
      type: item.type as CognitionEvidenceType,
      verificationStatus: "unverified" as const,
    };
  });
  const concepts = value.concepts.map((item, conceptIndex) => {
    if (!isRecord(item) || !isNonEmptyString(item.term) || !isNonEmptyString(item.definition)) {
      throw new Error(`${prefix}的第${conceptIndex + 1}个概念无效`);
    }
    return {
      term: item.term.trim(),
      definition: item.definition.trim(),
      anchors: buildAnchors(
        item.anchors,
        anchorContext,
        `${prefix}的第${conceptIndex + 1}个概念锚点`,
      ),
    };
  });

  return {
    nodeRef: value.nodeRef,
    node: {
      id,
      question: { ...question, derivation: value.question.derivation },
      claim,
      reasoning: { status: reasoningStatus, steps },
      evidence,
      concepts,
      reviewStatus: "ai_extracted",
    },
  };
}

function buildSuggestions(
  value: unknown,
  nodeIdsByRef: Map<string, string>,
  label: string,
): CognitionAISuggestion[] {
  if (!Array.isArray(value)) throw new Error(`AI建议中的${label}结构无效`);
  return value.map((item) => {
    if (!isRecord(item) || !isNonEmptyString(item.content)
      || !Array.isArray(item.basedOnNodeRefs) || item.basedOnNodeRefs.length === 0) {
      throw new Error(`AI建议中的${label}缺少内容或认知节点依据`);
    }
    const basedOnNodeIds = item.basedOnNodeRefs.map((nodeRef) => {
      const id = typeof nodeRef === "string" ? nodeIdsByRef.get(nodeRef) : undefined;
      if (!id) throw new Error("AI建议引用了不存在的认知节点");
      return id;
    });
    return { content: item.content.trim(), basedOnNodeIds };
  });
}

export function buildIPSourceAnalysisV2(input: BuildIPSourceAnalysisV2Input): IPSourceAnalysisV2 {
  if (!isNonEmptyString(input.sourceId)) throw new Error("V2认知解析缺少Source编号");
  if (!isNonEmptyString(input.sourceContent)) throw new Error("V2认知解析缺少原始内容");
  if (!isISOTime(input.analyzedAt)) throw new Error("V2认知解析时间无效");
  if (!isRecord(input.candidate) || !Array.isArray(input.candidate.nodes)
    || !isRecord(input.candidate.aiSuggestions)) {
    throw new Error("V2认知解析顶层结构无效");
  }
  const anchorContext: AnchorContext = input.anchorScope
    ? {
        content: input.anchorScope.content,
        offset: input.anchorScope.startPosition,
        label: "当前分块原文",
      }
    : { content: input.sourceContent, offset: 0, label: "原文" };
  if (!Number.isInteger(anchorContext.offset)
    || anchorContext.offset < 0
    || input.sourceContent.slice(
      anchorContext.offset,
      anchorContext.offset + anchorContext.content.length,
    ) !== anchorContext.content) {
    throw new Error("V2认知解析的分块位置与完整原文不一致");
  }

  const createId = input.createId ?? createUUID;
  const built = input.candidate.nodes.map((node, index) => buildNode(
    node,
    index,
    anchorContext,
    createId(),
  ));
  const nodeIdsByRef = new Map<string, string>();
  for (const item of built) {
    if (nodeIdsByRef.has(item.nodeRef)) throw new Error("认知节点临时引用编号重复");
    nodeIdsByRef.set(item.nodeRef, item.node.id);
  }
  if (new Set(built.map(item => item.node.id)).size !== built.length) {
    throw new Error("服务端生成了重复的认知节点UUID");
  }

  return {
    analyzedAt: input.analyzedAt,
    parserVersion: 2,
    nonce: 1,
    sourceId: input.sourceId.trim(),
    sourceHash: calculateSHA256(input.sourceContent),
    nodes: built.map(item => item.node),
    aiSuggestions: {
      potentialPrinciples: buildSuggestions(
        input.candidate.aiSuggestions.potentialPrinciples,
        nodeIdsByRef,
        "潜在原则",
      ),
      topicPotential: buildSuggestions(
        input.candidate.aiSuggestions.topicPotential,
        nodeIdsByRef,
        "选题方向",
      ),
    },
  };
}

function isStoredAnchor(value: unknown, sourceContent: string): value is IPSourceAnchor {
  return isRecord(value)
    && hasExactKeys(value, ["quote", "startPosition", "endPosition"])
    && isNonEmptyString(value.quote)
    && Number.isInteger(value.startPosition)
    && Number.isInteger(value.endPosition)
    && (value.startPosition as number) >= 0
    && (value.endPosition as number) > (value.startPosition as number)
    && sourceContent.slice(value.startPosition as number, value.endPosition as number) === value.quote;
}

function isStoredStatement(value: unknown, sourceContent: string): value is IPSourceBackedStatement {
  return isRecord(value)
    && isNonEmptyString(value.content)
    && Array.isArray(value.anchors)
    && value.anchors.length > 0
    && value.anchors.every(anchor => isStoredAnchor(anchor, sourceContent));
}

function isStoredHumanRevision(
  value: unknown,
  reasoningStepOrders: ReadonlySet<number>,
): value is CognitionHumanRevision {
  if (!isRecord(value)) return false;
  const allowedKeys = new Set(["claim", "reasoningSteps", "updatedAt"]);
  const actualKeys = Object.keys(value);
  if (actualKeys.some(key => !allowedKeys.has(key)) || !isISOTime(value.updatedAt)) return false;
  const hasClaim = value.claim !== undefined;
  const hasReasoningSteps = value.reasoningSteps !== undefined;
  if (!hasClaim && !hasReasoningSteps) return false;
  if (hasClaim && (!isNonEmptyString(value.claim) || value.claim.length > 1_000)) return false;
  if (hasReasoningSteps) {
    if (!Array.isArray(value.reasoningSteps) || value.reasoningSteps.length === 0
      || value.reasoningSteps.length > reasoningStepOrders.size) return false;
    const seenOrders = new Set<number>();
    for (const step of value.reasoningSteps) {
      if (!isRecord(step) || !hasExactKeys(step, ["order", "content"])
        || !Number.isInteger(step.order) || !reasoningStepOrders.has(step.order as number)
        || seenOrders.has(step.order as number)
        || !isNonEmptyString(step.content) || step.content.length > 1_000) return false;
      seenOrders.add(step.order as number);
    }
  }
  return true;
}

function isStoredV1(
  value: unknown,
  sourceContent: string,
  contextKnowledgeId: string,
): value is IPSourceAnalysis {
  if (!isRecord(value) || value.parserVersion !== 1 || !isISOTime(value.analyzedAt)
    || !hasExactKeys(value, ["analyzedAt", "parserVersion", "items"])
    || !Array.isArray(value.items)) return false;
  return value.items.every(item => isRecord(item)
    && hasExactKeys(item, [
      "id", "kind", "content", "sourceId", "startPosition", "endPosition", "originalExcerpt",
      "extractionStatus",
    ])
    && isNonEmptyString(item.id)
    && ["question", "claim", "reasoning", "evidence", "concept", "topic", "expression"].includes(String(item.kind))
    && isNonEmptyString(item.content)
    && item.sourceId === contextKnowledgeId
    && Number.isInteger(item.startPosition)
    && Number.isInteger(item.endPosition)
    && typeof item.originalExcerpt === "string"
    && (item.startPosition as number) >= 0
    && (item.endPosition as number) > (item.startPosition as number)
    && sourceContent.slice(item.startPosition as number, item.endPosition as number) === item.originalExcerpt
    && (item.extractionStatus === "AI提取" || item.extractionStatus === "人工确认"));
}

function isStoredV2(value: unknown, sourceContent: string): value is IPSourceAnalysisV2 {
  if (!isRecord(value) || value.parserVersion !== 2 || !isISOTime(value.analyzedAt)
    || !hasExactKeys(value, ["analyzedAt", "parserVersion", "nonce", "sourceId", "sourceHash", "nodes", "aiSuggestions"])
    || !Number.isInteger(value.nonce) || (value.nonce as number) < 1
    || !isNonEmptyString(value.sourceId) || !/^[a-f0-9]{64}$/.test(String(value.sourceHash))
    || !Array.isArray(value.nodes) || !isRecord(value.aiSuggestions)
    || !hasExactKeys(value.aiSuggestions, ["potentialPrinciples", "topicPotential"])) return false;
  const ids = new Set<string>();
  for (const node of value.nodes) {
    const nodeKeys = [
      "id", "question", "claim", "reasoning", "evidence", "concepts", "reviewStatus",
      ...(isRecord(node) && node.humanRevision !== undefined ? ["humanRevision"] : []),
    ];
    if (!isRecord(node) || !hasExactKeys(node, nodeKeys)
      || !UUID_PATTERN.test(String(node.id)) || ids.has(String(node.id))
      || !isRecord(node.question)
      || !hasExactKeys(node.question, ["content", "anchors", "derivation"])
      || (node.question.derivation !== "explicit" && node.question.derivation !== "inferred")
      || !isStoredStatement(node.question, sourceContent)
      || !isRecord(node.claim)
      || !hasExactKeys(node.claim, ["content", "anchors"])
      || !isStoredStatement(node.claim, sourceContent)
      || !isRecord(node.reasoning)
      || !hasExactKeys(node.reasoning, ["status", "steps"])
      || !REASONING_STATUSES.has(node.reasoning.status as CognitionReasoningStatus)
      || !Array.isArray(node.reasoning.steps)
      || !Array.isArray(node.evidence)
      || !Array.isArray(node.concepts)
      || !REVIEW_STATUSES.has(String(node.reviewStatus))) return false;
    if (node.reasoning.status === "not_provided" && node.reasoning.steps.length > 0) return false;
    if (node.reasoning.status !== "not_provided" && node.reasoning.steps.length === 0) return false;
    if (!node.reasoning.steps.every((step, index) => isRecord(step)
      && hasExactKeys(step, ["order", "content", "anchors"])
      && step.order === index + 1 && isStoredStatement(step, sourceContent))) return false;
    if (node.humanRevision !== undefined && (
      node.reviewStatus !== "human_confirmed"
      || !isStoredHumanRevision(
        node.humanRevision,
        new Set(node.reasoning.steps.map(step => (step as { order: number }).order)),
      )
    )) return false;
    if (!node.evidence.every(item => isRecord(item)
      && hasExactKeys(item, ["type", "content", "anchors", "verificationStatus"])
      && EVIDENCE_TYPES.has(item.type as CognitionEvidenceType)
      && (item.verificationStatus === "unverified" || item.verificationStatus === "verified")
      && isStoredStatement(item, sourceContent))) return false;
    if (!node.concepts.every(item => isRecord(item)
      && hasExactKeys(item, ["term", "definition", "anchors"])
      && isNonEmptyString(item.term) && isNonEmptyString(item.definition)
      && Array.isArray(item.anchors) && item.anchors.length > 0
      && item.anchors.every(anchor => isStoredAnchor(anchor, sourceContent)))) return false;
    ids.add(String(node.id));
  }
  for (const key of ["potentialPrinciples", "topicPotential"] as const) {
    const suggestions = value.aiSuggestions[key];
    if (!Array.isArray(suggestions) || !suggestions.every(item => isRecord(item)
      && hasExactKeys(item, ["content", "basedOnNodeIds"])
      && isNonEmptyString(item.content)
      && Array.isArray(item.basedOnNodeIds)
      && item.basedOnNodeIds.length > 0
      && item.basedOnNodeIds.every(id => typeof id === "string" && ids.has(id)))) return false;
  }
  return true;
}

export function parseStoredIPSourceAnalysis(
  value: unknown,
  sourceContent: string,
  contextKnowledgeId: string,
): ParseStoredIPSourceAnalysisResult {
  if (isRecord(value) && value.parserVersion === 1) {
    if (Array.isArray(value.items) && value.items.some(item => isRecord(item)
      && typeof item.sourceId === "string"
      && item.sourceId !== contextKnowledgeId)) {
      return { ok: false, error: "V1解析项的Source编号与知识记录不一致" };
    }
    if (isStoredV1(value, sourceContent, contextKnowledgeId)) {
      return { ok: true, version: 1, analysis: value };
    }
    return { ok: false, error: "无法识别的IP原始内容解析版本" };
  }
  if (!isRecord(value) || value.parserVersion !== 2) {
    return { ok: false, error: "无法识别的IP原始内容解析版本" };
  }
  if (typeof value.sourceId === "string" && value.sourceId !== contextKnowledgeId) {
    return { ok: false, error: "V2认知解析的Source编号与知识记录不一致" };
  }
  if (value.sourceHash !== calculateSHA256(sourceContent)) {
    return { ok: false, error: "V2认知解析的原文哈希不一致" };
  }
  if (!isStoredV2(value, sourceContent)) {
    return { ok: false, error: "V2认知解析包含无法回溯的原文锚点" };
  }
  return { ok: true, version: 2, analysis: value };
}

export function isIPSourceAnalysisSnapshot(
  value: unknown,
  sourceContent: string,
  contextKnowledgeId: string,
): value is IPSourceAnalysisSnapshot {
  return parseStoredIPSourceAnalysis(value, sourceContent, contextKnowledgeId).ok;
}

export function getLegacyIPSourceAnalysisItems(
  analysis: IPSourceAnalysisSnapshot | null | undefined,
): IPSourceAnalysisItem[] {
  return toV1CompatibleItems(analysis);
}

export function toV1CompatibleItems(
  analysis: IPSourceAnalysisSnapshot | null | undefined,
): IPSourceAnalysisItem[] {
  if (!analysis) return [];
  if (analysis.parserVersion === 1) return analysis.items;
  const items: IPSourceAnalysisItem[] = [];
  for (const node of analysis.nodes) {
    if (node.reviewStatus === "rejected") continue;
    const extractionStatus = node.reviewStatus === "human_confirmed" ? "人工确认" : "AI提取";
    const revision = node.reviewStatus === "human_confirmed" ? node.humanRevision : undefined;
    const pushItem = (
      idSuffix: string,
      kind: IPSourceAnalysisKind,
      content: string,
      anchors: IPSourceAnchor[],
    ) => {
      const anchor = anchors[0];
      if (!anchor) return;
      items.push({
        id: `${node.id}:${idSuffix}`,
        kind,
        content,
        sourceId: analysis.sourceId,
        startPosition: anchor.startPosition,
        endPosition: anchor.endPosition,
        originalExcerpt: anchor.quote,
        extractionStatus,
      });
    };
    pushItem("question", "question", node.question.content, node.question.anchors);
    pushItem("claim", "claim", revision?.claim ?? node.claim.content, node.claim.anchors);
    const revisedSteps = new Map(
      revision?.reasoningSteps?.map(step => [step.order, step.content]) ?? [],
    );
    for (const step of node.reasoning.steps) {
      pushItem(
        `reasoning:${step.order}`,
        "reasoning",
        revisedSteps.get(step.order) ?? step.content,
        step.anchors,
      );
    }
    node.evidence.forEach((evidence, index) => {
      pushItem(`evidence:${index + 1}`, "evidence", evidence.content, evidence.anchors);
    });
    node.concepts.forEach((concept, index) => {
      pushItem(
        `concept:${index + 1}`,
        "concept",
        `${concept.term}：${concept.definition}`,
        concept.anchors,
      );
    });
  }
  return items;
}
