import type { IPProfile, IPStyleProfile } from "./types";
import { splitSentences } from "./deepseek";
import type { ScriptContentResponse } from "./script-factory-response";
import type {
  ScriptQualityCheck,
  ScriptQualityWarning,
  ScriptQualityWarningCode,
} from "./script-factory-contract";

const ARGUMENT_WARNING_CODES = new Set<ScriptQualityWarningCode>([
  "example_not_supporting_claim",
  "analogy_mechanism_mismatch",
  "correlation_as_causation",
]);

const EMPHATIC_CLOSING_PATTERNS = [
  /^(?:你要)?记住(?:，|,|：|:|这件事|一点)?/,
  /(?:明白吗|明白了没有|听懂了吗|听懂了没有|懂了吗|知道了吗|清楚了吗|对不对|是不是)[？?!！。]*$/,
];

interface ArgumentReviewIssue {
  code: Exclude<ScriptQualityWarningCode, "dense_closing_style">;
  sectionLabel: string;
  excerpt: string;
  reason: string;
}

class ScriptArgumentReviewParseError extends Error {
  readonly diagnosticCode: string;

  constructor(diagnosticCode: string) {
    super("脚本论证复核结果结构无效");
    this.name = "ScriptArgumentReviewParseError";
    this.diagnosticCode = diagnosticCode;
  }
}

function normalizedSentence(sentence: string): string {
  return sentence.trim().replace(/[。！？?!]+$/g, "").trim();
}

function literalStyleMarkers(
  ip: IPProfile,
  styleProfile?: IPStyleProfile | null,
): string[] {
  return [
    ...(ip.commonClosings ?? []),
    ...(ip.catchphrases ?? []),
    ...(styleProfile?.commonPhrases ?? []),
  ]
    .map(item => item.trim())
    .filter(item => item.length >= 2);
}

function isEmphaticClosingSentence(
  sentence: string,
  markers: string[],
): boolean {
  const normalized = normalizedSentence(sentence);
  if (!normalized) return false;
  return EMPHATIC_CLOSING_PATTERNS.some(pattern => pattern.test(normalized)) ||
    markers.some(marker => normalized.includes(marker));
}

export function findDenseClosingStyleWarning(
  content: ScriptContentResponse,
  ip: IPProfile,
  styleProfile?: IPStyleProfile | null,
): ScriptQualityWarning | null {
  const closingSection = content.outline.at(-1);
  if (!closingSection) return null;
  const markers = literalStyleMarkers(ip, styleProfile);
  const sentences = splitSentences(closingSection.content);
  let previousWasEmphatic = false;

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    const emphatic = isEmphaticClosingSentence(sentence, markers);
    if (emphatic && previousWasEmphatic) {
      return {
        category: "style",
        code: "dense_closing_style",
        title: "表达待调整",
        sectionLabel: closingSection.label,
        excerpt: sentences.slice(Math.max(0, index - 1), index + 1).join(""),
        message: "结尾连续使用了多个功能相同的强调式口头禅或反问，建议只保留一个。",
      };
    }
    previousWasEmphatic = emphatic;
  }

  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(
  object: Record<string, unknown>,
  field: string,
): string {
  const value = object[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new ScriptArgumentReviewParseError("INVALID_REVIEW_FIELD");
  }
  return value.trim();
}

function parseJSONObject(content: string): Record<string, unknown> {
  const cleaned = content.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    const object = asObject(parsed);
    if (!object) throw new Error("invalid root");
    return object;
  } catch (error) {
    if (error instanceof ScriptArgumentReviewParseError) throw error;
    throw new ScriptArgumentReviewParseError("INVALID_REVIEW_JSON");
  }
}

export function parseScriptArgumentReview(
  response: string,
  content: ScriptContentResponse,
): ScriptQualityWarning[] {
  const object = parseJSONObject(response);
  if (!Array.isArray(object.issues)) {
    throw new ScriptArgumentReviewParseError("INVALID_REVIEW_ISSUES");
  }
  const sections = new Map(content.outline.map(section => [section.label, section.content]));

  return object.issues.map((rawIssue): ScriptQualityWarning => {
    const issue = asObject(rawIssue);
    if (!issue) throw new ScriptArgumentReviewParseError("INVALID_REVIEW_ITEM");
    const code = requiredString(issue, "code") as ScriptQualityWarningCode;
    if (!ARGUMENT_WARNING_CODES.has(code)) {
      throw new ScriptArgumentReviewParseError("INVALID_REVIEW_CODE");
    }
    const sectionLabel = requiredString(issue, "sectionLabel");
    const excerpt = requiredString(issue, "excerpt");
    const reason = requiredString(issue, "reason");
    const sectionContent = sections.get(sectionLabel);
    if (!sectionContent || !sectionContent.includes(excerpt)) {
      throw new ScriptArgumentReviewParseError("REVIEW_EXCERPT_NOT_FOUND");
    }
    return {
      category: "argument",
      code: code as ArgumentReviewIssue["code"],
      title: "论证待核对",
      sectionLabel,
      excerpt,
      message: reason,
    };
  });
}

export const ARGUMENT_REVIEW_SYSTEM = `你是独立的短视频论证审校员。你不负责改写文案，也不评价标题、语气、传播性或拍摄方式。
你只检查案例是否支持结论、类比双方的因果机制是否一致、是否把相关性误写成因果关系。
没有明确问题时issues必须返回空数组。只输出合法JSON对象，不输出其他文字。`;

export function buildArgumentReviewPrompt(
  topic: string,
  content: ScriptContentResponse,
): string {
  const transcript = content.outline
    .map(section => `【${section.label}】${section.content}`)
    .join("\n");
  return `选题：「${topic}」

待复核正文：
${transcript}

只检查以下三类问题：
1. 案例是否真正支持它前后的结论；
2. 类比双方是否具有相同的因果机制，是否能明确说明哪一项对应哪一项；
3. 是否把同时出现或相关关系误写成因果关系。

不要因为观点有争议就报错，不要补充新事实，不要改写正文。
excerpt必须逐字截取自对应正文，不能概括或改写。

严格按以下JSON格式输出：
{
  "issues": [
    {
      "code": "example_not_supporting_claim|analogy_mechanism_mismatch|correlation_as_causation",
      "sectionLabel": "正文中的阶段标签",
      "excerpt": "正文中的连续原文片段",
      "reason": "为什么这一处论证需要人工核对"
    }
  ]
}`;
}

export function buildScriptQualityCheck(input: {
  styleWarning: ScriptQualityWarning | null;
  semanticWarnings?: ScriptQualityWarning[];
  argumentWarnings: ScriptQualityWarning[];
  reviewUnavailable: boolean;
}): ScriptQualityCheck {
  const warnings = [
    ...(input.styleWarning ? [input.styleWarning] : []),
    ...(input.semanticWarnings ?? []),
    ...input.argumentWarnings,
  ];
  if (input.reviewUnavailable) {
    return {
      status: "unavailable",
      warnings,
      message: "自动论证复核暂未完成，请在正式使用前人工核对案例和类比。",
    };
  }
  return {
    status: warnings.length > 0 ? "needs_review" : "passed",
    warnings,
  };
}
