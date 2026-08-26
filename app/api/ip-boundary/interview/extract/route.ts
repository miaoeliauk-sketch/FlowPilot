import { NextRequest, NextResponse } from "next/server";
import { callDeepSeek, parseDeepSeekJSON } from "@/lib/deepseek";
import {
  extractInterviewSource,
  InterviewExtractionError,
  type InterviewRawInteraction,
} from "@/lib/ip-boundary-interview";
import {
  buildIPSourceAnalysisProofClaims,
  createIPSourceAnalysisToken,
  digestIPSourceAnalysisProofClaims,
  getIPSourceAnalysisProofSecret,
} from "@/lib/ip-source-analysis-proof";
import { initializeIPSourceLedger } from "@/lib/ip-source-ledger";

const EXTRACTION_TIMEOUT_MS = 10_000;
const MAX_INTERACTIONS = 3;
const MAX_QUESTION_CHARS = 500;
const MAX_ANSWER_CHARS = 10_000;
const MAX_TOTAL_ANSWER_CHARS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRawInteraction(value: unknown): InterviewRawInteraction[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_INTERACTIONS) return null;
  const interactions: InterviewRawInteraction[] = [];
  let totalAnswerChars = 0;
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    const questionId = typeof candidate.questionId === "string" ? candidate.questionId.trim() : "";
    const question = typeof candidate.question === "string" ? candidate.question : "";
    const answer = typeof candidate.answer === "string" ? candidate.answer : "";
    const normalizedQuestion = question.trim();
    const normalizedAnswer = answer.trim();
    if (!questionId || !normalizedQuestion || question.length > MAX_QUESTION_CHARS
      || normalizedAnswer.length <= 10 || answer.length > MAX_ANSWER_CHARS) return null;
    totalAnswerChars += answer.length;
    if (totalAnswerChars > MAX_TOTAL_ANSWER_CHARS) return null;
    interactions.push({ questionId, question, answer });
  }
  return interactions;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }
  if (!isRecord(body)) return NextResponse.json({ error: "请求格式无效" }, { status: 400 });

  const activeIPId = typeof body.activeIPId === "string" ? body.activeIPId.trim() : "";
  if (!activeIPId) {
    return NextResponse.json({ error: "缺少当前IP归属，已拒绝提取访谈认知" }, { status: 403 });
  }
  const topicId = typeof body.topicId === "string" ? body.topicId.trim() : "";
  const interviewId = typeof body.interviewId === "string" ? body.interviewId.trim() : "";
  const rawInteraction = parseRawInteraction(body.rawInteraction);
  if (!topicId || !interviewId || !rawInteraction) {
    return NextResponse.json({ error: "访谈原文不完整或长度不符合要求" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);
  try {
    const result = await extractInterviewSource({
      activeIPId,
      topicId,
      interviewId,
      rawInteraction,
      sourceId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      callModel: async modelRequest => {
        const raw = await callDeepSeek(
          [
            "你是严谨的IP认知逻辑审计员。只输出JSON对象。",
            "直接输出V2认知节点候选结构：nodes与aiSuggestions。",
            "每个节点围绕一个明确观点，分别提供question、claim、reasoning、evidence和concepts。",
            "观点、每一步推理、每条案例都必须使用老师回答中的逐字锚点。",
            "严禁把AI提问当作老师观点，严禁引入原文没有表达的知识、因果或修饰。",
          ].join("\n"),
          JSON.stringify(modelRequest),
          2_000,
          0.1,
          request.headers.get("X-DeepSeek-Key") ?? undefined,
          {
            signal: controller.signal,
            responseFormat: { type: "json_object" },
            thinking: { type: "disabled" },
          },
        );
        return parseDeepSeekJSON<unknown>(raw, null);
      },
    });
    const secret = await getIPSourceAnalysisProofSecret();
    const claims = buildIPSourceAnalysisProofClaims({
      ipId: activeIPId,
      analysis: result.analysis,
    });
    const initialized = await initializeIPSourceLedger({
      sourceId: result.analysis.sourceId,
      ipId: activeIPId,
      nonce: result.analysis.nonce,
      digest: digestIPSourceAnalysisProofClaims(claims),
    });
    if (!initialized) {
      return NextResponse.json({ code: "SOURCE_CONFLICT", error: "访谈存证编号冲突，请重新提交" }, { status: 409 });
    }
    return NextResponse.json({
      ...result,
      analysisToken: createIPSourceAnalysisToken(claims, secret),
    });
  } catch (error) {
    if (error instanceof InterviewExtractionError) {
      const status = error.code === "EMPTY_LOGIC_WARNING" ? 422 : 502;
      return NextResponse.json({ code: error.code, error: error.message }, { status });
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      return NextResponse.json({ code: "TIMEOUT", error: "访谈认知提取超过10秒" }, { status: 504 });
    }
    return NextResponse.json({ code: "EXTRACTION_FAILED", error: "访谈认知提取失败" }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
