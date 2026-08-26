import type { MissingElement } from "./ip-boundary-engine";
import type { CognitionNodeV2, IPSourceAnalysisV2 } from "./types";
import { buildIPSourceAnalysisV2, parseStoredIPSourceAnalysis } from "./ip-source-analysis-v2";

export type InterviewCoverage = "NONE" | "PARTIAL";
export type InterviewPanelState =
  | "closed"
  | "generating_questions"
  | "answering"
  | "draft_saved"
  | "ready_for_next_step"
  | "question_error"
  | "session_invalid";

export interface InterviewContextNode {
  nodeId: string;
  claim: string;
}

export interface InterviewQuestion {
  id: string;
  missingElement: MissingElement;
  content: string;
  basedOnNodeIds: string[];
}

export interface InterviewQuestionModelRequest {
  topic: string;
  coverage: InterviewCoverage;
  missingElements: MissingElement[];
  contextNodes: InterviewContextNode[];
  instruction: string;
}

export interface InterviewQuestionResult {
  activeIPId: string;
  topicId: string;
  interviewId: string;
  questions: InterviewQuestion[];
}

export interface GenerateInterviewQuestionsInput {
  activeIPId: string;
  topicId: string;
  interviewId: string;
  topic: string;
  coverage: InterviewCoverage;
  missingElements: MissingElement[];
  contextNodes: InterviewContextNode[];
  callModel: (request: InterviewQuestionModelRequest) => Promise<unknown>;
}

export interface InterviewRawInteraction {
  questionId: string;
  question: string;
  answer: string;
}

export interface InterviewSource {
  id: string;
  ipId: string;
  topicId: string;
  interviewId: string;
  rawInteraction: InterviewRawInteraction[];
  timestamp: string;
}

export interface InterviewCandidateNode {
  sourceId: string;
  node: CognitionNodeV2;
}

export interface InterviewExtractionModelRequest {
  rawInteraction: InterviewRawInteraction[];
  answerText: string;
  instruction: string;
}

export interface ExtractInterviewSourceInput {
  activeIPId: string;
  topicId: string;
  interviewId: string;
  rawInteraction: InterviewRawInteraction[];
  sourceId: string;
  timestamp: string;
  callModel: (request: InterviewExtractionModelRequest) => Promise<unknown>;
  createNodeId?: () => string;
}

export interface InterviewExtractionResult {
  source: InterviewSource;
  analysis: IPSourceAnalysisV2;
  candidates: InterviewCandidateNode[];
}

export interface EphemeralCognitionContext {
  activeIPId: string;
  topicId: string;
  sourceId: string;
  rawContent: string;
  analysis: IPSourceAnalysisV2;
  temporaryProof: string;
  expiresAt: number;
}

export function ephemeralCognitionStorageKey(activeIPId: string, topicId: string): string {
  return `FP_EPHEMERAL_COGNITION_V1:${encodeURIComponent(activeIPId)}:${encodeURIComponent(topicId)}`;
}

export function readEphemeralCognitionContext(
  storage: Pick<Storage, "getItem">,
  activeIPId: string,
  topicId: string,
  now = Date.now(),
): EphemeralCognitionContext | null {
  try {
    const raw = storage.getItem(ephemeralCognitionStorageKey(activeIPId, topicId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const context = value as Record<string, unknown>;
    if (context.activeIPId !== activeIPId
      || context.topicId !== topicId
      || typeof context.sourceId !== "string" || !context.sourceId.trim()
      || typeof context.rawContent !== "string" || !context.rawContent.trim()
      || typeof context.temporaryProof !== "string" || !context.temporaryProof.trim()
      || typeof context.expiresAt !== "number" || context.expiresAt <= now) return null;
    const parsed = parseStoredIPSourceAnalysis(context.analysis, context.rawContent, context.sourceId);
    if (!parsed.ok || parsed.version !== 2) return null;
    return {
      activeIPId,
      topicId,
      sourceId: context.sourceId,
      rawContent: context.rawContent,
      analysis: parsed.analysis,
      temporaryProof: context.temporaryProof,
      expiresAt: context.expiresAt,
    };
  } catch {
    return null;
  }
}

export class InterviewExtractionError extends Error {
  readonly code: "EMPTY_LOGIC_WARNING" | "INVALID_EXTRACTION";

  constructor(code: "EMPTY_LOGIC_WARNING" | "INVALID_EXTRACTION", message: string) {
    super(message);
    this.name = "InterviewExtractionError";
    this.code = code;
  }
}

export class InterviewQuestionGenerationError extends Error {
  readonly code: "INVALID_RESPONSE";

  constructor() {
    super("访谈问题未通过中立性校验");
    this.name = "InterviewQuestionGenerationError";
    this.code = "INVALID_RESPONSE";
  }
}

const MISSING_ELEMENTS = new Set<MissingElement>(["CLAIM", "REASONING", "CASE", "DATA", "DETAIL"]);
const LEADING_PATTERNS = [
  /您是否也认为/u,
  /你是否也认为/u,
  /您是不是也认为/u,
  /你是不是也认为/u,
  /既然您认为/u,
  /既然你认为/u,
  /既然老师认为/u,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseQuestions(
  value: unknown,
  coverage: InterviewCoverage,
  missingElements: MissingElement[],
  allowedNodeIds: Set<string>,
): InterviewQuestion[] | null {
  if (!isRecord(value) || !Array.isArray(value.questions)) return null;
  if (value.questions.length < 1 || value.questions.length > 3) return null;
  const allowedMissingElements = new Set(missingElements);
  const seenIds = new Set<string>();
  const questions: InterviewQuestion[] = [];

  for (const candidate of value.questions) {
    if (!isRecord(candidate)) return null;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const content = typeof candidate.content === "string" ? candidate.content.trim() : "";
    const missingElement = candidate.missingElement;
    if (!id || seenIds.has(id) || !content || content.length > 300) return null;
    if (typeof missingElement !== "string" || !MISSING_ELEMENTS.has(missingElement as MissingElement)) return null;
    if (!allowedMissingElements.has(missingElement as MissingElement)) return null;
    if (LEADING_PATTERNS.some(pattern => pattern.test(content))) return null;
    if (!Array.isArray(candidate.basedOnNodeIds)) return null;
    const basedOnNodeIds = candidate.basedOnNodeIds;
    if (!basedOnNodeIds.every(nodeId => typeof nodeId === "string" && allowedNodeIds.has(nodeId))) return null;
    if (new Set(basedOnNodeIds).size !== basedOnNodeIds.length) return null;
    if (coverage === "NONE" && basedOnNodeIds.length > 0) return null;
    seenIds.add(id);
    questions.push({
      id,
      content,
      missingElement: missingElement as MissingElement,
      basedOnNodeIds,
    });
  }

  return questions;
}

export async function generateInterviewQuestions(
  input: GenerateInterviewQuestionsInput,
): Promise<InterviewQuestionResult> {
  const contextNodes = input.coverage === "NONE" ? [] : input.contextNodes.map(node => ({ ...node }));
  const allowedNodeIds = new Set(contextNodes.map(node => node.nodeId));
  const request: InterviewQuestionModelRequest = {
    topic: input.topic.trim(),
    coverage: input.coverage,
    missingElements: [...input.missingElements],
    contextNodes,
    instruction: input.coverage === "NONE"
      ? "使用开放式、中立问题了解老师的真实主张。不得预设立场，不得引用任何历史认知节点。最多输出3个原子问题。"
      : "只围绕已确认认知中缺失的要素追问。不得扩大或改写老师立场。最多输出3个原子问题。",
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await input.callModel(request);
    const questions = parseQuestions(response, input.coverage, input.missingElements, allowedNodeIds);
    if (questions) {
      return {
        activeIPId: input.activeIPId,
        topicId: input.topicId,
        interviewId: input.interviewId,
        questions,
      };
    }
  }

  throw new InterviewQuestionGenerationError();
}

export async function extractInterviewSource(
  input: ExtractInterviewSourceInput,
): Promise<InterviewExtractionResult> {
  const source: InterviewSource = {
    id: input.sourceId,
    ipId: input.activeIPId,
    topicId: input.topicId,
    interviewId: input.interviewId,
    rawInteraction: input.rawInteraction.map(item => ({ ...item })),
    timestamp: input.timestamp,
  };
  const answerText = source.rawInteraction.map(item => item.answer).join("\n\n");
  const candidate = await input.callModel({
    rawInteraction: source.rawInteraction.map(item => ({ ...item })),
    answerText,
    instruction: "只从老师回答原文提取V2认知节点。观点、推理和案例必须分别锚定回答中的逐字片段；不得把AI问题当作老师观点，不得补充外部知识。",
  });
  if (!isRecord(candidate) || !Array.isArray(candidate.nodes) || candidate.nodes.length === 0) {
    throw new InterviewExtractionError(
      "EMPTY_LOGIC_WARNING",
      "回答中暂未提取到明确观点，请补充您的判断、原因或案例。",
    );
  }

  try {
    const analysis = buildIPSourceAnalysisV2({
      sourceId: source.id,
      sourceContent: answerText,
      analyzedAt: source.timestamp,
      candidate,
      createId: input.createNodeId,
    });
    return {
      source,
      analysis,
      candidates: analysis.nodes.map(node => ({ sourceId: analysis.sourceId, node })),
    };
  } catch (error) {
    throw new InterviewExtractionError(
      "INVALID_EXTRACTION",
      error instanceof Error ? error.message : "访谈提取结果未通过证据校验",
    );
  }
}
