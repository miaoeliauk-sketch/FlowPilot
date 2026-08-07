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
2. 保持分主题组织，但相邻段落和主题之间要有自然过渡，让观点形成递进；过渡句不得增加新事实。
3. 只改善连接和阅读流畅度，不模仿任何人的口吻，不做语气风格改写。
4. 互补内容可以合并；实质冲突不得自行裁决，必须放入conflicts并保留不同说法。
5. 无依据的具体时间预测或确定性时间断言必须放入contentReview.exclusions，不得写入母稿。
6. 重要但缺乏权威来源、仍有整理价值的观点应保留在母稿，同时放入contentReview.evidenceGaps，并提示使用前核实。不得擅自补充来源或包装成既定事实。
7. 正文只做合并、去重和逻辑整理，不生成爆款开头、传播标题、CTA、拍摄或分镜建议。
8. 只能使用输入素材中的信息，不得补充外部事实。
9. 每个结果项的sourceIds只能使用输入中真实存在的素材id。
10. 严格输出指定JSON对象，不要输出其他文字。`;

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
  "conflicts": [{
    "topic": "冲突主题，控制在20字内",
    "conflictPoint": "两者矛盾点，简洁说明",
    "alternatives": [
      { "brief": "说法一简述，控制在30字内", "text": "说法一的完整原话或原意", "sourceIds": ["对应素材id"] },
      { "brief": "说法二简述，控制在30字内", "text": "说法二的完整原话或原意", "sourceIds": ["对应素材id"] }
    ]
  }],
  "contentReview": {
    "exclusions": [{ "summary": "未采用内容", "reason": "排除原因", "sourceIds": ["素材id"] }],
    "evidenceGaps": [{
      "summary": "依据不足但保留的内容",
      "reason": "缺乏何种依据，建议使用前核实",
      "draftExcerpt": "从母稿paragraphs中逐字复制的对应片段",
      "sourceIds": ["素材id"]
    }]
  }
}

补充要求：
- conflicts中的每条冲突只归纳两种实质不同的立场；同一立场可关联多份素材。
- exclusions与evidenceGaps必须严格区分，具体时间预测归入exclusions。
- 每条evidenceGaps对应的观点必须出现在母稿中，并明确写出“缺乏权威来源支撑，建议使用前核实”或同等清晰的提示。draftExcerpt必须从母稿对应paragraph中逐字复制，不得改写。
- 没有冲突、未采用内容或依据不足内容时，对应数组必须返回[]，不得为了填充示例而虚构条目。
- 不要输出决策摘要，系统会根据已校验的冲突和依据不足条目生成固定格式摘要。`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field}无效`);
  return value.trim();
}

function requireShortString(value: unknown, field: string, maxLength: number): string {
  const text = requireString(value, field);
  if (text.length > maxLength) throw new Error(`${field}过长`);
  return text;
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

function parseReviewItem(
  value: unknown,
  field: string,
  allowedSourceIds: Set<string>,
) {
  const base = parseIntegrationItem(value, field, allowedSourceIds);
  return {
    ...base,
    reason: requireString(isRecord(value) ? value.reason : undefined, `${field}.reason`),
  };
}

function parseEvidenceGapItem(
  value: unknown,
  field: string,
  allowedSourceIds: Set<string>,
  draftParagraphs: string[],
) {
  const item = parseReviewItem(value, field, allowedSourceIds);
  const draftExcerpt = requireShortString(
    isRecord(value) ? value.draftExcerpt : undefined,
    `${field}.draftExcerpt`,
    160,
  );
  if (!draftParagraphs.some((paragraph) => paragraph.includes(draftExcerpt))) {
    throw new Error(`${field}.draftExcerpt未出现在母稿正文段落中`);
  }
  const statesEvidenceLimit = /(?:缺乏|缺少|没有|尚无|暂无|不足|未有|未经).{0,24}(?:来源|依据|证据|数据|研究|支持|验证|核实)/.test(draftExcerpt);
  const asksForVerification = /(?:建议|需要|需|应).{0,12}(?:核实|验证|查证|确认)/.test(draftExcerpt);
  if (!statesEvidenceLimit || !asksForVerification) {
    throw new Error(`${field}.draftExcerpt缺少明确的依据不足或核实提示`);
  }
  return item;
}

function buildDecisionSummary(
  conflicts: CopyIntegrationResult["conflicts"],
  evidenceGapCount: number,
  sources: CopyIntegrationSource[],
): CopyIntegrationResult["decisionSummary"] {
  const sourceLabels = new Map(sources.map((source, index) => [source.id, `素材${index + 1}`]));
  const formatSourceLabels = (sourceIds: string[]) =>
    sourceIds.map((sourceId) => sourceLabels.get(sourceId) ?? sourceId).join("、");
  const items = conflicts.map((conflict) => {
    const [first, second] = conflict.alternatives;
    return `关于${conflict.topic}，${formatSourceLabels(first.sourceIds)}和${formatSourceLabels(second.sourceIds)}存在冲突：${first.brief} vs ${second.brief}。正式使用前需确定统一立场。`;
  });
  if (evidenceGapCount > 0) {
    items.push(`另有${evidenceGapCount}处内容标记为依据不足，详见下文“未采用及依据不足内容”部分。`);
  }
  if (items.length === 0) {
    items.push("当前没有需要老师决策或核实的事项。");
  }
  return { items };
}

function parseCopyIntegrationResult(
  content: string,
  sources: CopyIntegrationSource[],
): CopyIntegrationResult {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed) || !isRecord(parsed.draft) || !isRecord(parsed.contentReview)) {
    throw new Error("文案整合响应结构无效");
  }
  const allowedSourceIds = new Set(sources.map((source) => source.id));

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
  const draftFullText = sections
    .map((section) => `## ${section.heading}\n\n${section.paragraphs.join("\n\n")}`)
    .join("\n\n");
  const draftParagraphs = sections.flatMap((section) => section.paragraphs);

  if (!Array.isArray(parsed.conflicts)) {
    throw new Error("conflicts无效");
  }
  const conflicts = parsed.conflicts.map((item, index) => {
    if (!isRecord(item)) throw new Error(`conflicts[${index}]无效`);
    if (!Array.isArray(item.alternatives) || item.alternatives.length !== 2) {
      throw new Error(`conflicts[${index}].alternatives必须包含两个说法`);
    }
    return {
      topic: requireShortString(item.topic, `conflicts[${index}].topic`, 20),
      conflictPoint: requireString(item.conflictPoint, `conflicts[${index}].conflictPoint`),
      alternatives: item.alternatives.map((alternative, alternativeIndex) => {
        if (!isRecord(alternative)) {
          throw new Error(`conflicts[${index}].alternatives[${alternativeIndex}]无效`);
        }
        return {
          brief: requireShortString(
            alternative.brief,
            `conflicts[${index}].alternatives[${alternativeIndex}].brief`,
            30,
          ),
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
  });

  const contentReview = parsed.contentReview;
  if (!Array.isArray(contentReview.exclusions) || !Array.isArray(contentReview.evidenceGaps)) {
    throw new Error("contentReview无效");
  }
  const exclusions = contentReview.exclusions.map((item, index) =>
    parseReviewItem(item, `contentReview.exclusions[${index}]`, allowedSourceIds));
  const evidenceGaps = contentReview.evidenceGaps.map((item, index) =>
    parseEvidenceGapItem(
      item,
      `contentReview.evidenceGaps[${index}]`,
      allowedSourceIds,
      draftParagraphs,
    ));

  return {
    draft: {
      sections,
      fullText: draftFullText,
    },
    decisionSummary: buildDecisionSummary(conflicts, evidenceGaps.length, sources),
    conflicts,
    contentReview: {
      exclusions,
      evidenceGaps,
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
    const result = await callStructuredDeepSeek({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(
        sources,
        typeof body.instruction === "string" ? body.instruction.trim() : "",
      ),
      parse: (content) => parseCopyIntegrationResult(content, sources),
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
