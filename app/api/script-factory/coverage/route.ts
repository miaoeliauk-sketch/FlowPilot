import { NextRequest, NextResponse } from "next/server";
import {
  createEmptyCoverageAssessment,
  parseCoverageAssessment,
  type CoverageSourceReference,
} from "@/lib/script-factory-coverage";
import {
  callStructuredDeepSeek,
  StructuredDeepSeekError,
} from "@/lib/structured-deepseek";

interface CoverageRequestBody {
  topic?: string;
  angle?: string;
  sources?: CoverageSourceReference[];
}

const SYSTEM_PROMPT = `你是脚本工厂的观点覆盖度审查环节。你的职责不是写稿，而是判断：当前IP的原始内容是否真的表达过本次选题需要的核心判断。

严格规则：
1. 只能使用用户提供的IP原始内容条目，不能使用IP身份、常识或你自己的知识补足观点。
2. expression和topic条目只能帮助理解表达或方向，不能单独证明核心判断。
3. FULL：原始内容中有明确核心判断，并有足够的推理、概念区分或解释支撑本次切入角度。
4. PARTIAL：有明确核心判断，但本次切入仍缺推理过程或关键概念解释。
5. NONE：没有明确核心判断。只有案例、数据、表达习惯或相近话题也必须判NONE。
6. 缺案例不等于缺核心观点。覆盖度为FULL后，再单独判断案例是NOT_NEEDED、ENHANCEMENT还是REQUIRED。
7. 案例可以承担说明、证明、对比、故事和论证作用，但不能仅凭案例替IP生成从未表达过的核心观点。
8. 每个判断必须引用真实存在的sourceId和itemId，禁止编造引用。
9. PARTIAL或NONE时，caseNeed必须为NOT_ASSESSED。
10. 只输出JSON对象，不输出解释。`;

function buildPrompt(topic: string, angle: string, sources: CoverageSourceReference[]): string {
  return `本次选题：${topic}
切入角度：${angle || "未单独填写，以选题本身为准"}

当前IP原始内容解析条目：
${JSON.stringify(sources.map(source => ({
  sourceId: source.sourceId,
  sourceTitle: source.sourceTitle,
  itemId: source.itemId,
  kind: source.kind,
  content: source.content,
  originalExcerpt: source.originalExcerpt,
  extractionStatus: source.extractionStatus,
})), null, 2)}

严格按以下格式输出：
{
  "coverage": "FULL|PARTIAL|NONE",
  "reason": "为什么得到这个结论",
  "coveredDimensions": ["核心判断|推理过程|事实证据|案例|概念解释"],
  "missingDimensions": ["核心判断|推理过程|事实证据|案例|概念解释"],
  "sourceReferences": [{"sourceId": "真实sourceId", "itemId": "真实itemId"}],
  "caseNeed": "NOT_ASSESSED|NOT_NEEDED|ENHANCEMENT|REQUIRED",
  "caseReason": "案例在本次文章里承担什么职责；不得偷渡新的因果立场"
}`;
}

function isCoverageSource(value: unknown): value is CoverageSourceReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return ["sourceId", "sourceTitle", "itemId", "kind", "content", "originalExcerpt", "extractionStatus"]
    .every(field => typeof source[field] === "string" && String(source[field]).trim().length > 0);
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
  if (sources.length === 0) {
    return NextResponse.json({ assessment: createEmptyCoverageAssessment(topic) });
  }

  try {
    const result = await callStructuredDeepSeek({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildPrompt(topic, angle, sources),
      parse: response => parseCoverageAssessment(response, sources),
      apiKey: req.headers.get("X-DeepSeek-Key") ?? "",
      maxTokens: 1800,
      temperature: 0,
      timeoutMs: 60_000,
      maxRetries: 1,
    });
    return NextResponse.json({ assessment: result.data });
  } catch (error) {
    const message = error instanceof StructuredDeepSeekError
      ? "观点覆盖度分析失败，请稍后重试。"
      : error instanceof Error ? error.message : "观点覆盖度分析失败";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
