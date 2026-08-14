const CHECK_KEYS = [
  "viewpointBelongs",
  "titleKeepsAnswer",
  "openingBuildsSuspense",
  "concreteEntry",
  "classicExplainsReality",
  "risesToPattern",
  "conciseWithoutRepetition",
  "staleHotspotReframed",
  "titleOpeningEndingClosed",
  "soundsLikeTeacher",
] as const;

export interface ShuimuranScriptReview {
  passed: boolean;
  issues: string[];
}

export const SHUIMURAN_REVIEW_SYSTEM = `你是水木然IP专属脚本的独立终审员。只检查老师已经确认的10项标准，不负责润色或改写文案。
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
- “观点属于水木然本人”只能依据上面的老师原文判断，不能依据语气、常用词或IP人设猜测。
- 正文中的人物、时间、数据、热点和古籍原文，如果没有出现在老师原文或已提供的案例依据中，且没有列入待核验内容，不得判为通过。
- “有来源”不等于“已核实”。案例核实状态不是“有明确来源”或“人工已核实”时，不能把它当作已核实事实。
- 判断24小时时效必须对照发生时间和审查时间；没有明确发生时间时，不得把案例判断为24小时内热点，也不得放行“最近、刚刚、突然、官宣”等新闻口吻。

逐项检查：
1. 观点是否属于水木然本人？
2. 标题是否保留了核心答案？
3. 开头是否在15秒内形成悬念？
4. 是否从具体案例进入，而不是从大道理进入？
5. 传统经典是否真正解释了现实问题？没有使用传统经典时，本项按“未滥用经典”判断。
6. 是否完成了从现象到规律的上升？
7. 是否存在重复观点和啰嗦段落，是否已经足够精简？
8. 过期热点是否已经转为长期认知内容？没有使用热点时通过。
9. 标题、开头和结尾是否形成闭环？
10. 全文是否像老师在表达，而不是AI模仿几个关键词？

严格输出：
{
  "checks": {
    "viewpointBelongs": true,
    "titleKeepsAnswer": true,
    "openingBuildsSuspense": true,
    "concreteEntry": true,
    "classicExplainsReality": true,
    "risesToPattern": true,
    "conciseWithoutRepetition": true,
    "staleHotspotReframed": true,
    "titleOpeningEndingClosed": true,
    "soundsLikeTeacher": true
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
