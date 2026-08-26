import { NextRequest, NextResponse } from "next/server";
import { callDeepSeek, parseDeepSeekJSON } from "@/lib/deepseek";
import {
  generateInterviewQuestions,
  InterviewQuestionGenerationError,
  type InterviewContextNode,
  type InterviewCoverage,
} from "@/lib/ip-boundary-interview";
import type { MissingElement } from "@/lib/ip-boundary-engine";

const QUESTION_TIMEOUT_MS = 5_000;
const MISSING_ELEMENTS = new Set<MissingElement>(["CLAIM", "REASONING", "CASE", "DATA", "DETAIL"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMissingElements(value: unknown): MissingElement[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) return null;
  if (!value.every(item => typeof item === "string" && MISSING_ELEMENTS.has(item as MissingElement))) return null;
  return [...new Set(value as MissingElement[])];
}

function parseContextNodes(value: unknown): InterviewContextNode[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) return null;
  const nodes: InterviewContextNode[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.nodeId !== "string" || typeof candidate.claim !== "string") return null;
    const nodeId = candidate.nodeId.trim();
    const claim = candidate.claim.trim();
    if (!nodeId || !claim) return null;
    nodes.push({ nodeId, claim });
  }
  return nodes;
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
    return NextResponse.json({ error: "缺少当前IP归属，已拒绝生成访谈问题" }, { status: 403 });
  }

  const topicId = typeof body.topicId === "string" ? body.topicId.trim() : "";
  const interviewId = typeof body.interviewId === "string" ? body.interviewId.trim() : "";
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const coverage = body.coverage === "NONE" || body.coverage === "PARTIAL"
    ? body.coverage as InterviewCoverage
    : null;
  const missingElements = parseMissingElements(body.missingElements);
  const contextNodes = parseContextNodes(body.contextNodes);
  if (!topicId || !interviewId || !topic || !coverage || !missingElements || !contextNodes) {
    return NextResponse.json({ error: "访谈上下文不完整" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUESTION_TIMEOUT_MS);
  try {
    const result = await generateInterviewQuestions({
      activeIPId,
      topicId,
      interviewId,
      topic,
      coverage,
      missingElements,
      contextNodes,
      callModel: async modelRequest => {
        const raw = await callDeepSeek(
          "你是中立的IP认知访谈记者。只输出JSON，不替老师预设立场。",
          JSON.stringify(modelRequest),
          700,
          0.2,
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
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InterviewQuestionGenerationError) {
      return NextResponse.json({ code: "NEUTRALITY_VIOLATION", error: "访谈问题未通过中立性校验" }, { status: 502 });
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      return NextResponse.json({ code: "TIMEOUT", error: "访谈问题生成超过5秒" }, { status: 504 });
    }
    return NextResponse.json({ code: "QUESTION_GENERATION_FAILED", error: "访谈问题生成失败" }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
