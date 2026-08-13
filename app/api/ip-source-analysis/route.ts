import { NextRequest, NextResponse } from "next/server";
import { DEEPSEEK_MODEL as MODEL } from "@/lib/deepseek";
import {
  callStructuredDeepSeek,
  StructuredDeepSeekError,
} from "@/lib/structured-deepseek";
import type {
  IPSourceAnalysis,
  IPSourceAnalysisKind,
  IPSourceAnalysisItem,
} from "@/lib/types";

interface RequestBody {
  sourceId?: string;
  activeIPId?: string;
  rawContent?: string;
}

interface RawAnalysisItem {
  kind: IPSourceAnalysisKind;
  content: string;
  originalExcerpt: string;
}

const VALID_KINDS: IPSourceAnalysisKind[] = [
  "question",
  "claim",
  "reasoning",
  "evidence",
  "concept",
  "topic",
  "expression",
];
const SOURCE_CHUNK_CHARS = 8_000;
const MAX_SOURCE_CHARS = 160_000;

function validationError(code: string, message: string, itemIndex?: number) {
  return Object.assign(new Error(message), {
    diagnosticCode: code,
    diagnosticDetails: itemIndex === undefined ? {} : { itemIndex },
  });
}

const SYSTEM = `你是FlowPilot的IP原始内容解析环节。你的任务不是总结成一篇新文章，而是识别老师在原文中真正表达过的内容。

只允许提取以下类型：
- question：老师正在回答的问题
- claim：老师明确表达的判断或立场
- reasoning：老师如何从前提推进到判断
- evidence：老师原文提到的案例、事实或数据
- concept：老师区分或定义的概念
- topic：原文可以自然延展的选题方向
- expression：具有代表性的表达方式、用词或节奏

严格规则：
1. 每条必须附带一段可以在原文中逐字找到的originalExcerpt。
2. originalExcerpt只负责定位证据，必须逐字复制原文，不得改写。
3. content可以概括含义，但不得改变原意，不得补充老师没有表达过的观点。
4. 不要输出位置数字，位置由程序根据originalExcerpt计算。
5. 同一段原文可以支持不同用途的解析，但不要机械重复。
6. 严格输出JSON，不输出说明文字。`;

const PROMPT = (rawContent: string) => `请解析以下IP原始内容：

<SOURCE>
${rawContent}
</SOURCE>

输出：
{
  "items": [{
    "kind": "question|claim|reasoning|evidence|concept|topic|expression",
    "content": "忠于原意的结构化理解",
    "originalExcerpt": "原文中逐字存在的连续片段"
  }]
}`;

function parseResponse(content: string): RawAnalysisItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw validationError("INVALID_JSON", "AI返回不是完整JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw validationError("INVALID_ROOT", "AI返回的顶层结构不是对象");
  }
  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) {
    throw validationError("ITEMS_MISSING", "AI没有返回可用的原文解析");
  }
  if (items.length > 40) {
    throw validationError("ITEM_COUNT_EXCEEDED", "AI返回的解析条目过多");
  }
  return items.map((item, itemIndex) => {
    if (!item || typeof item !== "object") {
      throw validationError("INVALID_ITEM", "AI返回包含非法解析条目", itemIndex);
    }
    const record = item as Record<string, unknown>;
    if (!VALID_KINDS.includes(record.kind as IPSourceAnalysisKind)) {
      throw validationError("INVALID_KIND", "AI返回了不支持的解析类型", itemIndex);
    }
    const itemContent = typeof record.content === "string" ? record.content.trim() : "";
    const originalExcerpt = typeof record.originalExcerpt === "string"
      ? record.originalExcerpt.trim()
      : "";
    if (!itemContent || !originalExcerpt) {
      throw validationError("MISSING_CONTENT", "AI解析缺少内容或原文快照", itemIndex);
    }
    return {
      kind: record.kind as IPSourceAnalysisKind,
      content: itemContent.slice(0, 500),
      originalExcerpt: originalExcerpt.slice(0, 1000),
    };
  });
}

function locateItems(
  sourceId: string,
  rawContent: string,
  rawItems: RawAnalysisItem[],
): IPSourceAnalysisItem[] {
  const nextSearchPosition = new Map<string, number>();
  return rawItems.map((item, index) => {
    const from = nextSearchPosition.get(item.originalExcerpt) ?? 0;
    let startPosition = rawContent.indexOf(item.originalExcerpt, from);
    if (startPosition < 0 && from > 0) {
      startPosition = rawContent.indexOf(item.originalExcerpt);
    }
    if (startPosition < 0) {
      throw validationError(
        "EXCERPT_NOT_FOUND",
        `第${index + 1}条解析的原文出处无法定位`,
        index,
      );
    }
    const endPosition = startPosition + item.originalExcerpt.length;
    nextSearchPosition.set(item.originalExcerpt, endPosition);
    return {
      id: `A${String(index + 1).padStart(2, "0")}`,
      kind: item.kind,
      content: item.content,
      sourceId,
      startPosition,
      endPosition,
      originalExcerpt: item.originalExcerpt,
      extractionStatus: "AI提取",
    };
  });
}

interface SourceChunk {
  content: string;
  startPosition: number;
}

function splitSource(rawContent: string): SourceChunk[] {
  const chunks: SourceChunk[] = [];
  let startPosition = 0;
  while (startPosition < rawContent.length) {
    let endPosition = Math.min(startPosition + SOURCE_CHUNK_CHARS, rawContent.length);
    if (endPosition < rawContent.length) {
      const nextLineBreak = rawContent.indexOf("\n", endPosition);
      if (nextLineBreak >= 0 && nextLineBreak - endPosition <= 500) {
        endPosition = nextLineBreak + 1;
      }
    }
    chunks.push({
      content: rawContent.slice(startPosition, endPosition),
      startPosition,
    });
    startPosition = endPosition;
  }
  return chunks;
}

function offsetItems(items: IPSourceAnalysisItem[], offset: number): IPSourceAnalysisItem[] {
  return items.map(item => ({
    ...item,
    startPosition: item.startPosition + offset,
    endPosition: item.endPosition + offset,
  }));
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
  const activeIPId = typeof body.activeIPId === "string" ? body.activeIPId.trim() : "";
  const rawContent = typeof body.rawContent === "string" ? body.rawContent : "";
  if (!sourceId) return NextResponse.json({ error: "缺少Source编号" }, { status: 400 });
  if (!activeIPId) return NextResponse.json({ error: "请先选择当前IP" }, { status: 400 });
  if (!rawContent.trim()) return NextResponse.json({ error: "请提供IP原始内容" }, { status: 400 });
  if (rawContent.length > MAX_SOURCE_CHARS) {
    return NextResponse.json({ error: "单份原始内容暂时最多16万字，请按课程章节或直播场次拆分后入库" }, { status: 400 });
  }

  try {
    const chunks = splitSource(rawContent);
    const results = [];
    for (const chunk of chunks) {
      const result = await callStructuredDeepSeek({
        systemPrompt: SYSTEM,
        userPrompt: PROMPT(chunk.content),
        parse: content => offsetItems(
          locateItems(sourceId, chunk.content, parseResponse(content)),
          chunk.startPosition,
        ),
        apiKey,
        maxTokens: 6000,
        temperature: 0.1,
        maxRetries: 1,
      });
      results.push(result);
    }
    const items = results.flatMap(result => result.data).map((item, index) => ({
      ...item,
      id: `A${String(index + 1).padStart(2, "0")}`,
    }));
    const analysis: IPSourceAnalysis = {
      analyzedAt: new Date().toISOString(),
      parserVersion: 1,
      items,
    };
    return NextResponse.json({
      analysis,
      apiMeta: {
        apiCalled: true,
        model: MODEL,
        attempts: results.reduce((sum, result) => sum + result.attempts, 0),
        chunkCount: chunks.length,
      },
    });
  } catch (error) {
    const message = error instanceof StructuredDeepSeekError && error.cause instanceof Error
      ? error.cause.message
      : error instanceof Error
        ? error.message
        : "解析失败";
    return NextResponse.json({
      error: message.includes("原文") ? message : "原始内容解析失败，已自动重试，请稍后再试",
    }, { status: 500 });
  }
}
