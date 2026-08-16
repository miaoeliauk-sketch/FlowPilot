const CHECK_KEYS = [
  "titleKeepsAnswer",
  "openingBuildsSuspense",
  "concreteEntry",
  "classicExplainsReality",
  "risesToPattern",
  "conciseWithoutRepetition",
  "staleHotspotReframed",
  "titleOpeningEndingClosed",
  "soundsLikeTeacher",
  "singleCoreIdea",
  "reasoningSupported",
  "endingClosesSpecificLoop",
] as const;

export interface ShuimuranScriptReview {
  passed: boolean;
  issues: string[];
}

const FORBIDDEN_OPENINGS = [
  "大家有没有发现一个很有意思的现象",
  "今天跟大家聊一个话题",
  "最近发生了一件事",
  "你知道为什么吗",
] as const;

const GENERIC_ENDINGS = [
  /1%的人/,
  /值得(?:你)?反复琢磨/,
  /记住这(?:三个字|几个字|句话|一点)/,
] as const;

const MECHANICAL_LIST_SEQUENCES: ReadonlyArray<ReadonlyArray<RegExp>> = [
  [
    /(?:第一(?:种|点|个|条|步|层|类|件事)|第一(?=[，、：:。！？!?；;\s]|$))/,
    /(?:第二(?:种|点|个|条|步|层|类|件事)|第二(?=[，、：:。！？!?；;\s]|$))/,
    /(?:第三(?:种|点|个|条|步|层|类|件事)|第三(?=[，、：:。！？!?；;\s]|$))/,
  ],
  [/一是/, /二是/, /三是/],
  [/首先/, /其次/, /最后/],
];

function containsOrderedSequence(text: string, sequence: ReadonlyArray<RegExp>): boolean {
  let offset = 0;
  for (const pattern of sequence) {
    const match = pattern.exec(text.slice(offset));
    if (!match || match.index === undefined) return false;
    offset += match.index + match[0].length;
  }
  return true;
}

function containsLocalMechanicalList(fullScript: string): boolean {
  const paragraphs = fullScript
    .split(/\n+/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.some(paragraph =>
    MECHANICAL_LIST_SEQUENCES.some(sequence => containsOrderedSequence(paragraph, sequence))
  )) {
    return true;
  }
  for (let index = 0; index < paragraphs.length; index += 1) {
    const nearbyParagraphs = paragraphs.slice(index, index + 3).join("\n");
    if (MECHANICAL_LIST_SEQUENCES.some(sequence =>
      containsOrderedSequence(nearbyParagraphs, sequence)
    )) {
      return true;
    }
  }

  const sentences = fullScript.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) ?? [];
  for (let index = 0; index < sentences.length; index += 1) {
    const nearbySentences = sentences.slice(index, index + 3).join("");
    if (MECHANICAL_LIST_SEQUENCES.some(sequence =>
      containsOrderedSequence(nearbySentences, sequence)
    )) {
      return true;
    }
  }
  return false;
}

export function findShuimuranDeterministicReviewIssues(input: {
  title: string;
  fullScript: string;
}): string[] {
  const issues: string[] = [];
  const normalizedScript = input.fullScript.trim();
  const opening = normalizedScript.slice(0, 120);
  const forbiddenOpening = FORBIDDEN_OPENINGS.find(pattern => opening.includes(pattern));
  if (forbiddenOpening) {
    issues.push(`禁用开头：命中“${forbiddenOpening}”，必须改为直接判断式开头。`);
  }

  if (containsLocalMechanicalList(normalizedScript)) {
    issues.push("机械清单：正文短距离内连续使用“第一、第二、第三”“一是、二是、三是”或“首先、其次、最后”等固定枚举，必须围绕一条推理链重组。");
  }

  const ending = normalizedScript.slice(-220);
  const genericEnding = GENERIC_ENDINGS.find(pattern => pattern.test(ending));
  if (genericEnding) {
    issues.push("通用结尾：命中脱离本文仍成立的收尾，必须回答标题悬念并回扣本篇案例、经典或核心规律。");
  }

  return issues;
}

export const SHUIMURAN_REVIEW_SYSTEM = `你是水木然IP专属脚本的独立终审员。只检查老师已经确认的12项内容质量标准，不负责观点归属审计、事实核验、润色或改写文案。
必须逐项给出布尔值。任何一项不通过，issues中必须写明可直接用于重写的具体原因。
只输出合法JSON，不要输出Markdown或解释。`;

export function buildShuimuranReviewPrompt(input: {
  title: string;
  fullScript: string;
  pendingVerification: string[];
  reviewedAt?: string;
  sourceReferences?: Array<{
    sourceTitle: string;
    kind: string;
    originalExcerpt: string;
    extractionStatus: string;
  }>;
  caseEvidence?: {
    title?: string;
    content?: string;
    verificationStatus?: string;
    sourceUrl?: string;
    occurredAt?: string;
  } | null;
}): string {
  const sourceReferences = input.sourceReferences ?? [];
  const caseEvidence = input.caseEvidence ?? null;
  const sourceBlock = sourceReferences.length > 0
    ? sourceReferences.map((reference, index) =>
        `${index + 1}.《${reference.sourceTitle}》｜${reference.kind}｜${reference.extractionStatus}\n老师原文：${reference.originalExcerpt}`
      ).join("\n\n")
    : "无";
  const caseBlock = caseEvidence
    ? `案例：${caseEvidence.title ?? "未命名案例"}
案例内容：${caseEvidence.content ?? ""}
核实状态：${caseEvidence.verificationStatus ?? "未核实"}
发生时间：${caseEvidence.occurredAt ?? "未提供"}
来源链接：${caseEvidence.sourceUrl ?? "未提供"}`
    : "本次未使用案例";

  return `请审查以下脚本，不要改写文案。

标题：${input.title}
完整口播文案：${input.fullScript}
待核验内容：${input.pendingVerification.join("；") || "无"}

【老师观点依据】
${sourceBlock}

【案例与事实依据】
${caseBlock}

审查时间：${input.reviewedAt ?? "未提供"}

判断边界：
- 观点是否属于水木然本人由生成后的独立归属审计判断，不在本次内容质量终审中阻断正文。
- 事实核验由生成后的独立审计判断，不在本次内容质量终审中阻断正文。
- 判断24小时时效必须对照发生时间和审查时间；没有明确发生时间时，不得把案例判断为24小时内热点，也不得放行“最近、刚刚、突然、官宣”等新闻口吻。

逐项检查：
1. 标题是否保留了核心答案？
2. 开头是否在15秒内形成悬念？
3. 是否从具体案例进入，而不是从大道理进入？
4. 传统经典是否真正解释了现实问题？没有使用传统经典时，本项按“未滥用经典”判断。
5. 是否完成了从现象到规律的上升？
6. 是否存在重复观点和啰嗦段落，是否已经足够精简？
7. 过期热点是否已经转为长期认知内容？没有使用热点时通过。
8. 标题、开头和结尾是否形成闭环？
9. 全文是否像老师在表达，而不是AI模仿几个关键词？
10. 全文是否只围绕一个核心思想展开，而不是多个观点并列堆砌？
11. 每个锋利判断是否有事实、案例或清楚的因果桥梁支撑？如有口号或鸡汤式判断，issues必须指出缺少事实案例或因果桥梁的具体句子。
12. 结尾是否回答标题悬念，并明确回到本篇实际使用的案例、经典或核心规律？仅仅重复宽泛结论不能通过。

严格输出：
{
  "checks": {
    "titleKeepsAnswer": true,
    "openingBuildsSuspense": true,
    "concreteEntry": true,
    "classicExplainsReality": true,
    "risesToPattern": true,
    "conciseWithoutRepetition": true,
    "staleHotspotReframed": true,
    "titleOpeningEndingClosed": true,
    "soundsLikeTeacher": true,
    "singleCoreIdea": true,
    "reasoningSupported": true,
    "endingClosesSpecificLoop": true
  },
  "issues": []
}`;
}

export function parseShuimuranReview(content: unknown): ShuimuranScriptReview {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("水木然脚本终审没有返回内容");
  }
  let value: unknown;
  try {
    value = JSON.parse(content.trim());
  } catch {
    throw new Error("水木然脚本终审返回格式异常");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("水木然脚本终审返回格式异常");
  }
  const object = value as Record<string, unknown>;
  const checks = object.checks;
  const issues = object.issues;
  if (
    !checks ||
    typeof checks !== "object" ||
    Array.isArray(checks) ||
    !Array.isArray(issues) ||
    issues.some(issue => typeof issue !== "string")
  ) {
    throw new Error("水木然脚本终审返回字段不完整");
  }
  const checkObject = checks as Record<string, unknown>;
  if (
    Object.keys(checkObject).length !== CHECK_KEYS.length ||
    CHECK_KEYS.some(key => typeof checkObject[key] !== "boolean")
  ) {
    throw new Error("水木然脚本终审返回字段不完整");
  }
  const normalizedIssues = issues.map(issue => issue.trim()).filter(Boolean);
  const passed = CHECK_KEYS.every(key => checkObject[key] === true);
  if (passed && normalizedIssues.length > 0) {
    throw new Error("水木然脚本终审结果自相矛盾");
  }
  if (!passed && normalizedIssues.length === 0) {
    throw new Error("水木然脚本终审缺少重写原因");
  }
  return { passed, issues: normalizedIssues };
}
