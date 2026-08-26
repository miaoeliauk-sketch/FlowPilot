import type { MissingElement } from "./ip-boundary-engine";

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
