import { NextRequest, NextResponse } from "next/server";
import {
  callStructuredDeepSeek,
  StructuredDeepSeekError,
} from "@/lib/structured-deepseek";
import type {
  CopyIntegrationNote,
  CopyIntegrationResult,
  CopyIntegrationSource,
} from "@/lib/copy-integration-types";

const SYSTEM_PROMPT = `你是FlowPilot的文案整合助手。你的唯一任务是把多份素材合并成一份逻辑统一的内容母稿。

工作规则：
1. 对语义相同、措辞不同的观点进行观点级去重，但保留新增案例、数据和论据。
2. 互补内容可以合并；实质冲突不得自行裁决，必须放入conflicts并保留不同说法。
3. 正文只做合并、去重和逻辑整理，不生成爆款开头、传播标题、CTA、拍摄或分镜建议。
4. 只能使用输入素材中的信息，不得补充外部事实。
5. 每个结果项的sourceIds只能使用输入中真实存在的素材id。
6. 严格输出指定JSON对象，不要输出其他文字。`;

function buildUserPrompt(sources: CopyIntegrationSource[], instruction: string) {
  const materials = sources.map((source, index) => `【素材${index + 1}】
id：${source.id}
名称：${source.name}
正文：
${source.content}`).join("\n\n");

  return `请整合以下素材。${instruction ? `\n用户补充要求：${instruction}` : ""}

${materials}

严格按以下JSON结构输出：
{
  "draft": {
    "sections": [{ "heading": "中性结构标题", "paragraphs": ["连贯正文段落"], "sourceIds": ["素材id"] }]
  },
  "integrationNotes": {
    "mergedDuplicates": [{ "summary": "合并了什么", "sourceIds": ["素材id"] }],
    "conflicts": [{
      "summary": "冲突是什么",
      "alternatives": [
        { "text": "说法一", "sourceIds": ["对应素材id"] },
        { "text": "说法二", "sourceIds": ["对应素材id"] }
      ]
    }],
    "exclusions": [{ "summary": "未采用什么", "reason": "未采用原因", "sourceIds": ["素材id"] }]
  }
}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field}无效`);
  return value.trim();
}

function requireStringArray(value: unknown, field: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${field}无效`);
  return value.map((item) => requireString(item, field));
}

function requireSourceIds(value: unknown, field: string, allowedSourceIds: Set<string>): string[] {
  const sourceIds = requireStringArray(value, field);
  if (sourceIds.some((sourceId) => !allowedSourceIds.has(sourceId))) {
    throw new Error(`${field}包含未知素材id`);
  }
  return Array.from(new Set(sourceIds));
}

function parseIntegrationItem(
  value: unknown,
  field: string,
  allowedSourceIds: Set<string>,
): CopyIntegrationNote {
  if (!isRecord(value)) throw new Error(`${field}无效`);
  return {
    summary: requireString(value.summary, `${field}.summary`),
    sourceIds: requireSourceIds(value.sourceIds, `${field}.sourceIds`, allowedSourceIds),
  };
}

function parseCopyIntegrationResult(content: string, allowedSourceIds: Set<string>): CopyIntegrationResult {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed) || !isRecord(parsed.draft) || !isRecord(parsed.integrationNotes)) {
    throw new Error("文案整合响应结构无效");
  }

  if (!Array.isArray(parsed.draft.sections) || parsed.draft.sections.length === 0) {
    throw new Error("draft.sections无效");
  }
  const sections = parsed.draft.sections.map((section, index) => {
    if (!isRecord(section)) throw new Error(`draft.sections[${index}]无效`);
    return {
      heading: requireString(section.heading, `draft.sections[${index}].heading`),
      paragraphs: requireStringArray(section.paragraphs, `draft.sections[${index}].paragraphs`),
      sourceIds: requireSourceIds(
        section.sourceIds,
        `draft.sections[${index}].sourceIds`,
        allowedSourceIds,
      ),
    };
  });

  const notes = parsed.integrationNotes;
  if (!Array.isArray(notes.mergedDuplicates) || !Array.isArray(notes.conflicts) || !Array.isArray(notes.exclusions)) {
    throw new Error("integrationNotes无效");
  }

  return {
    draft: {
      sections,
      fullText: sections
        .map((section) => `## ${section.heading}\n\n${section.paragraphs.join("\n\n")}`)
        .join("\n\n"),
    },
    integrationNotes: {
      mergedDuplicates: notes.mergedDuplicates.map((item, index) =>
        parseIntegrationItem(item, `mergedDuplicates[${index}]`, allowedSourceIds)),
      conflicts: notes.conflicts.map((item, index) => {
        if (!isRecord(item)) throw new Error(`conflicts[${index}]无效`);
        if (!Array.isArray(item.alternatives) || item.alternatives.length < 2) {
          throw new Error(`conflicts[${index}].alternatives至少需要两个说法`);
        }
        return {
          summary: requireString(item.summary, `conflicts[${index}].summary`),
          alternatives: item.alternatives.map((alternative, alternativeIndex) => {
            if (!isRecord(alternative)) {
              throw new Error(`conflicts[${index}].alternatives[${alternativeIndex}]无效`);
            }
            return {
              text: requireString(
                alternative.text,
                `conflicts[${index}].alternatives[${alternativeIndex}].text`,
              ),
              sourceIds: requireSourceIds(
                alternative.sourceIds,
                `conflicts[${index}].alternatives[${alternativeIndex}].sourceIds`,
                allowedSourceIds,
              ),
            };
          }),
        };
      }),
      exclusions: notes.exclusions.map((item, index) => {
        const base = parseIntegrationItem(item, `exclusions[${index}]`, allowedSourceIds);
        return {
          ...base,
          reason: requireString(isRecord(item) ? item.reason : undefined, `exclusions[${index}].reason`),
        };
      }),
    },
  };
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
  const body = rawBody;
  const sources = Array.isArray(body.sources)
    ? body.sources
      .filter((source): source is CopyIntegrationSource =>
        isRecord(source) &&
        typeof source.id === "string" &&
        typeof source.name === "string" &&
        typeof source.content === "string" &&
        Boolean(source.id.trim()) &&
        Boolean(source.content.trim()))
      .map((source) => ({
        id: source.id.trim(),
        name: source.name.trim() || "未命名素材",
        content: source.content.trim(),
      }))
    : [];
  if (sources.length < 2) {
    return NextResponse.json({ error: "请至少提供2份有效素材" }, { status: 400 });
  }
  if (sources.length > 10) {
    return NextResponse.json({ error: "首版最多支持10份素材" }, { status: 400 });
  }
  if (new Set(sources.map((source) => source.id)).size !== sources.length) {
    return NextResponse.json({ error: "素材编号不能重复" }, { status: 400 });
  }
  try {
    const allowedSourceIds = new Set(sources.map((source) => source.id));
    const result = await callStructuredDeepSeek({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(
        sources,
        typeof body.instruction === "string" ? body.instruction.trim() : "",
      ),
      parse: (content) => parseCopyIntegrationResult(content, allowedSourceIds),
      apiKey: req.headers.get("X-DeepSeek-Key") || "",
      maxTokens: 8_000,
      temperature: 0.2,
    });

    return NextResponse.json(result.data);
  } catch (error) {
    const structuredError = error instanceof StructuredDeepSeekError ? error : null;
    console.error("[copy-integration]", JSON.stringify({
      stage: structuredError?.stage ?? "unknown",
      attempts: structuredError?.attempts ?? 1,
      attemptDiagnostics: structuredError?.attemptDiagnostics ?? [],
    }));
    return NextResponse.json({
      error: "本次文案整合失败，请稍后重试",
      errorCode: "copy_integration_failed",
    }, { status: 502 });
  }
}
