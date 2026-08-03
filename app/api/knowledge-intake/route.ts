import { NextRequest, NextResponse } from "next/server";
import { DEEPSEEK_MODEL as MODEL } from "@/lib/deepseek";
import {
  callStructuredDeepSeek,
  StructuredDeepSeekError,
} from "@/lib/structured-deepseek";
import {
  ALL_NEW_CATS,
  isIPKnowledgeCategory,
} from "@/lib/knowledge-categories";

interface AvailableIP {
  id: string;
  name: string;
  positioning?: string;
  contentDirection?: string[];
}

interface RequestBody {
  rawContent?: string;
  sourceType?: "text" | "excel";
  sourceName?: string;
  activeIPId?: string | null;
  availableIPs?: AvailableIP[];
}

interface IntakeResponse {
  items: Record<string, unknown>[];
}

interface IntakeDiagnosticDetails {
  itemCount?: number;
  itemIndex?: number;
  fieldCount?: number;
}

const CONFIDENCE_LEVELS = ["高", "中", "低"] as const;
const INGEST_RECOMMENDATIONS = ["建议入库", "待确认", "不建议入库"] as const;

function intakeValidationError(
  diagnosticCode: string,
  message: string,
  diagnosticDetails: IntakeDiagnosticDetails = {},
): Error {
  return Object.assign(new Error(message), {
    diagnosticCode,
    diagnosticDetails,
  });
}

const SYSTEM = `你是一个短视频内容知识库的入库助手。
用户会粘贴一段原始资料（可能是逐字稿、文案、方法论笔记、评论等）。
你的任务是：
1. 理解这段资料的本质
2. 从原始资料中提炼可以被 AI 调用的「短视频方法论」
3. 为每条方法推荐正确的方法库分类
4. 判断是否值得入库
知识库不是原文仓库、关键词库或标题列表，而是短视频方法论知识库。
不要原封不动保存原文，要拆成方法、框架、判断标准、适用场景和调用方式。
严格按 JSON 格式输出，不输出任何其他文字。`;

const PROMPT = (
  content: string,
  ips: AvailableIP[],
  sourceType: "text" | "excel",
  sourceName: string,
  activeIPId: string | null,
) => `
资料来源：${sourceType === "excel" ? "Excel表格" : "文字或Markdown"}${sourceName ? `（${sourceName}）` : ""}

原始资料：
"""
${content.slice(0, 4000)}
"""

可选IP列表：${ips.length > 0 ? JSON.stringify(ips) : "暂无"}
当前操盘IP ID：${activeIPId ?? "未选择"}

请从这段资料中提取 1-8 条「短视频方法卡」。

提取规则：
1. 不要只看文档整体主题，要逐章节、逐方法判断每个方法的真正用途。
2. 同一个概念如果有多种用途，必须拆成多条。例如「心理账户」在选题判断时归「选题方法库」，但在文案价值表达时再单独提取一条归「文案框架方法库」。
3. 开头技巧（如A1阶段破圈开头、钩子设计）必须单独提取，归「开头方法库」。
4. 不要把不同类目的方法混在一条里。
5. 不要保存大段原文，要回答：这个方法解决什么问题，适合什么场景，什么选题会触发它，AI调用后怎么帮助用户，什么时候不适合用。

分类判断规则：
- 【选题方法库】：用户阶段判断、5A/AIDA决策链路、心理账户做选题判断、选题四变量、人群分层、痛点/场景挖掘
- 【开头方法库】：前3秒钩子、开场设计、让陌生人停留的开头技巧、A1阶段的破圈开头写法
- 【文案框架方法库】：脚本结构、口播结构、论证框架、价值表达顺序、心理账户在文案表达中的应用
- 【标题方法库】：标题公式、标题关键词、爆款标题结构
- 【定位方法库】：账号定位、人设定位、差异化定位

严格按以下 JSON 格式输出一个对象：
{
  "items": [{
    "title": "这条知识的标题（≤20字，概括核心方法）",
    "summary": "一句话总结这条方法解决什么问题",
    "category": "从以下11个分类中选一个：定位方法库/选题方法库/标题方法库/开头方法库/文案框架方法库/IP人设资料/IP表达语料/IP历史内容/IP高表现内容/IP受众反馈/IP禁用规则",
    "ipId": "IP专属分类填写可选IP列表中的完整id；通用分类或无法确定时填null",
    "ipMatchStatus": "matched/uncertain/not_applicable",
    "ipMatchReason": "IP匹配或无法匹配的具体依据",
    "coreMethod": "核心方法：用可复用的方法语言描述，不复述原文",
    "applicableScenarios": ["适用场景1", "适用场景2", "适用场景3"],
    "triggerKeywords": ["触发关键词1", "触发关键词2", "触发关键词3"],
    "similarPhrases": ["相似说法1", "相似说法2"],
    "aiUsage": "AI调用方式：当用户输入什么类型的选题/标题/脚本需求时调用，调用后怎么帮助用户",
    "examples": [{"input": "原始选题或表达", "output": "优化后的方向"}],
    "unsuitableCases": ["不适用情况1", "不适用情况2"],
    "tags": ["3-5个标签"],
    "reusableValue": "这条方法可以用在什么场景（1-2句话）",
    "confidence": "高/中/低",
    "confidenceReason": "为什么是这个置信度",
    "ingestRecommend": "建议入库/待确认/不建议入库",
    "ingestReason": "入库建议的原因（1句话）"
  }]
}`;

function parseInitialResponse(content: string): IntakeResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw intakeValidationError("INVALID_JSON", "AI返回不是完整JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw intakeValidationError("INVALID_ROOT", "AI返回的顶层结构不是对象");
  }
  const parsedRecord = parsed as { items?: unknown };
  if (!Array.isArray(parsedRecord.items)) {
    throw intakeValidationError("ITEMS_MISSING", "AI返回缺少items数组", {
      fieldCount: Object.keys(parsedRecord).length,
    });
  }
  if (parsedRecord.items.length > 8) {
    throw intakeValidationError("ITEM_COUNT_EXCEEDED", "AI返回的知识条目超过8条", {
      itemCount: parsedRecord.items.length,
      fieldCount: Object.keys(parsedRecord).length,
    });
  }
  for (const [itemIndex, item] of parsedRecord.items.entries()) {
    if (!item || typeof item !== "object") {
      throw intakeValidationError("INVALID_ITEM", "AI返回包含非法知识条目", {
        itemCount: parsedRecord.items.length,
        itemIndex,
      });
    }
    const record = item as Record<string, unknown>;
    const diagnosticDetails = {
      itemCount: parsedRecord.items.length,
      itemIndex,
      fieldCount: Object.keys(record).length,
    };
    if (typeof record.title !== "string" || !record.title.trim()) {
      throw intakeValidationError(
        "TITLE_MISSING",
        "AI返回的知识条目缺少标题",
        diagnosticDetails,
      );
    }
    if (record.title.trim().length > 20) {
      throw intakeValidationError(
        "TITLE_TOO_LONG",
        "AI返回的知识条目标题过长",
        diagnosticDetails,
      );
    }
    if (typeof record.summary !== "string" || !record.summary.trim()) {
      throw intakeValidationError(
        "SUMMARY_MISSING",
        "AI返回的知识条目缺少摘要",
        diagnosticDetails,
      );
    }
    if (
      typeof record.category !== "string" ||
      !ALL_NEW_CATS.includes(record.category as never)
    ) {
      throw intakeValidationError(
        "INVALID_CATEGORY",
        "AI返回的知识条目分类无效",
        diagnosticDetails,
      );
    }
    if (!CONFIDENCE_LEVELS.includes(record.confidence as never)) {
      throw intakeValidationError(
        "INVALID_CONFIDENCE",
        "AI返回的知识条目置信度无效",
        diagnosticDetails,
      );
    }
    if (!INGEST_RECOMMENDATIONS.includes(record.ingestRecommend as never)) {
      throw intakeValidationError(
        "INVALID_RECOMMENDATION",
        "AI返回的知识条目入库建议无效",
        diagnosticDetails,
      );
    }
  }
  return {
    items: parsedRecord.items as Record<string, unknown>[],
  };
}

const OPTIONAL_STRING_ARRAY_FIELDS = [
  "applicableScenarios",
  "triggerKeywords",
  "similarPhrases",
  "unsuitableCases",
  "tags",
] as const;

const OPTIONAL_STRING_FIELDS = [
  "coreMethod",
  "aiUsage",
  "reusableValue",
  "confidenceReason",
  "ingestReason",
] as const;

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((entry) => entry.slice(0, 120));
}

function normalizeOptionalFields(
  items: Record<string, unknown>[],
): Record<string, unknown>[] {
  return items.map((item) => {
    const normalized = { ...item };
    for (const field of OPTIONAL_STRING_ARRAY_FIELDS) {
      normalized[field] = normalizeStringArray(normalized[field]);
    }
    for (const field of OPTIONAL_STRING_FIELDS) {
      normalized[field] = typeof normalized[field] === "string"
        ? normalized[field].trim()
        : "";
    }
    normalized.title = String(normalized.title).trim();
    normalized.summary = String(normalized.summary).trim();
    normalized.examples = Array.isArray(normalized.examples)
      ? normalized.examples.flatMap((example) => {
          if (!example || typeof example !== "object") return [];
          const entry = example as Record<string, unknown>;
          if (typeof entry.input !== "string" || typeof entry.output !== "string") {
            return [];
          }
          return [{
            input: entry.input.trim().slice(0, 300),
            output: entry.output.trim().slice(0, 300),
          }];
        }).slice(0, 8)
      : [];
    return normalized;
  });
}

function sanitizeAvailableIPs(value: unknown): AvailableIP[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id.trim()) return [];
    if (typeof record.name !== "string" || !record.name.trim()) return [];
    return [{
      id: record.id.trim(),
      name: record.name.trim(),
      positioning: typeof record.positioning === "string"
        ? record.positioning.trim()
        : undefined,
      contentDirection: normalizeStringArray(record.contentDirection),
    }];
  }).slice(0, 50);
}

function normalizeIPOwnership(
  items: Record<string, unknown>[],
  availableIPs: AvailableIP[],
): Record<string, unknown>[] {
  const availableIds = new Set(availableIPs.map((ip) => ip.id));
  return items.map((item) => {
    if (!isIPKnowledgeCategory(String(item.category ?? ""))) {
      return {
        ...item,
        ipId: null,
        ipMatchStatus: "not_applicable",
        ipMatchReason: "通用方法知识不绑定具体IP",
      };
    }
    if (typeof item.ipId === "string" && availableIds.has(item.ipId)) {
      return {
        ...item,
        ipMatchStatus: "matched",
      };
    }
    return {
      ...item,
      ipId: null,
      ipMatchStatus: "uncertain",
      ipMatchReason: "AI返回的归属不在可选IP中，无法确认所属IP",
      ingestRecommend: "待确认",
    };
  });
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: RequestBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  const content = (body.rawContent ?? "").trim();
  if (!content) return NextResponse.json({ error: "请提供原始资料" }, { status: 400 });
  const availableIPs = sanitizeAvailableIPs(body.availableIPs);
  const activeIPId = typeof body.activeIPId === "string" &&
      availableIPs.some((ip) => ip.id === body.activeIPId)
    ? body.activeIPId
    : null;

  const calledAt = new Date().toISOString();
  const diagnosticId = crypto.randomUUID();
  const baseApiMeta = {
    apiCalled: true,
    calledAt,
    model: MODEL,
    mockHit: false,
  };

  try {
    const result = await callStructuredDeepSeek({
      systemPrompt: SYSTEM,
      userPrompt: PROMPT(
        content,
        availableIPs,
        body.sourceType === "excel" ? "excel" : "text",
        typeof body.sourceName === "string" ? body.sourceName.trim() : "",
        activeIPId,
      ),
      parse: parseInitialResponse,
      apiKey,
      maxTokens: 2000,
      temperature: 0.3,
    });
    return NextResponse.json({
      items: normalizeIPOwnership(
        normalizeOptionalFields(result.data.items),
        availableIPs,
      ),
      model: MODEL,
      apiMeta: {
        ...baseApiMeta,
        attempts: result.attempts,
        requestId: result.responseMeta.requestId,
        finishReason: result.responseMeta.finishReason,
      },
    });
  } catch (error) {
    const structuredError = error instanceof StructuredDeepSeekError
      ? error
      : null;
    const message = structuredError?.stage === "timeout"
      ? "知识拆解超时，已自动重试，请稍后再试"
      : structuredError?.stage === "parse"
        ? "AI返回格式不完整，已自动重试，请稍后再试"
        : error instanceof Error
          ? error.message
          : "提取失败，请重试";
    const lastAttemptDiagnostic = structuredError?.attemptDiagnostics.at(-1);
    const failureCode = lastAttemptDiagnostic?.failureCode ??
      (structuredError?.stage === "timeout" ? "TIMEOUT" : "REQUEST_FAILED");
    console.warn("[knowledge-intake]", JSON.stringify({
      diagnosticId,
      calledAt,
      sourceType: body.sourceType === "excel" ? "excel" : "text",
      inputChars: content.length,
      availableIPCount: availableIPs.length,
      activeIPSelected: activeIPId !== null,
      maxTokens: 2000,
      failureCode,
      attempts: structuredError?.attemptDiagnostics ?? [],
    }));
    return NextResponse.json(
      {
        error: message,
        apiMeta: {
          ...baseApiMeta,
          attempts: structuredError?.attempts ?? 1,
          diagnosticId,
          failureCode,
          error: message,
        },
      },
      { status: structuredError?.stage === "timeout" ? 504 : 500 },
    );
  }
}
