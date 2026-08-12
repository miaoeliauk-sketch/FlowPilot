import { NextRequest, NextResponse } from "next/server";
import {
  CopyIntegrationPipelineError,
  runCopyIntegrationPipeline,
} from "@/lib/copy-integration-pipeline";
import { toPublicResponse } from "@/lib/copy-integration-public-response";
import type { CopyIntegrationModelAdapter } from "@/lib/copy-integration-internal-types";
import type { CopyIntegrationSource } from "@/lib/copy-integration-types";
import { callStructuredDeepSeek } from "@/lib/structured-deepseek";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSources(value: unknown): CopyIntegrationSource[] {
  return Array.isArray(value)
    ? value
      .filter((source): source is CopyIntegrationSource =>
        isRecord(source) &&
        typeof source.id === "string" &&
        typeof source.name === "string" &&
        typeof source.content === "string" &&
        Boolean(source.id.trim()) &&
        Boolean(source.content.trim()))
      .map(source => ({
        id: source.id.trim(),
        name: source.name.trim() || "未命名素材",
        content: source.content.trim(),
      }))
    : [];
}

export async function POST(req: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await req.json() as unknown;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!isRecord(rawBody)) {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (rawBody.instruction !== undefined && typeof rawBody.instruction !== "string") {
    return NextResponse.json({ error: "补充要求格式错误" }, { status: 400 });
  }
  const sources = readSources(rawBody.sources);
  if (sources.length < 2) {
    return NextResponse.json({ error: "请至少提供2份有效素材" }, { status: 400 });
  }
  if (sources.length > 10) {
    return NextResponse.json({ error: "首版最多支持10份素材" }, { status: 400 });
  }
  if (new Set(sources.map(source => source.id)).size !== sources.length) {
    return NextResponse.json({ error: "素材编号不能重复" }, { status: 400 });
  }

  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  const model: CopyIntegrationModelAdapter = {
    async complete(request) {
      const result = await callStructuredDeepSeek({
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt,
        parse: content => content,
        apiKey,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        maxRetries: 0,
      });
      return result.data;
    },
  };

  try {
    const internal = await runCopyIntegrationPipeline({
      sources,
      instruction: typeof rawBody.instruction === "string" ? rawBody.instruction.trim() : "",
      model,
    });
    return NextResponse.json(toPublicResponse(internal, sources));
  } catch (error) {
    const pipelineError = error instanceof CopyIntegrationPipelineError ? error : null;
    console.error("[copy-integration]", JSON.stringify({
      stage: pipelineError?.stage ?? "unknown",
      attempts: pipelineError?.callCount ?? 1,
      failureCode: pipelineError?.diagnosticCode ?? "PIPELINE_FAILED",
    }));
    return NextResponse.json(
      { error: "文案整合失败，请重试" },
      { status: 502 },
    );
  }
}
