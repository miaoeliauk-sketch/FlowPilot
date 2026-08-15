import { NextRequest, NextResponse } from "next/server";
import {
  type CoverageSourceReference,
} from "@/lib/script-factory-coverage";
import {
  analyzeScriptCoverage,
  isCoverageSource,
} from "@/lib/script-factory-coverage-analysis";
import { StructuredDeepSeekError } from "@/lib/structured-deepseek";

interface CoverageRequestBody {
  topic?: string;
  angle?: string;
  sources?: CoverageSourceReference[];
}

export async function POST(req: NextRequest) {
  let body: CoverageRequestBody;
  try {
    body = await req.json() as CoverageRequestBody;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const topic = body.topic?.trim() ?? "";
  const angle = body.angle?.trim() ?? "";
  if (!topic) return NextResponse.json({ error: "请先填写选题" }, { status: 400 });
  const sources = Array.isArray(body.sources) ? body.sources.filter(isCoverageSource).slice(0, 120) : [];
  try {
    const assessment = await analyzeScriptCoverage({
      topic,
      angle,
      sources,
      apiKey: req.headers.get("X-DeepSeek-Key") ?? "",
    });
    return NextResponse.json({ assessment });
  } catch (error) {
    const message = error instanceof StructuredDeepSeekError
      ? "观点覆盖度分析失败，请稍后重试。"
      : error instanceof Error ? error.message : "观点覆盖度分析失败";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
