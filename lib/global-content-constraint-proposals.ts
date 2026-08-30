export type GlobalConstraintActivationMode =
  | "active_on_confirmation"
  | "confirmed_pending_detection";

export interface GlobalConstraintProposal {
  proposalId: string;
  ruleId: string;
  title: string;
  canonicalText: string;
  prohibitedIntent: string;
  traceabilityStandards: readonly string[];
  applicableScopes: readonly string[];
  priorityRedlines: readonly string[];
  prohibitedScenarios: readonly string[];
  allowedBoundaries: readonly string[];
  runtimePositioning: string;
  detectionTerms: readonly string[] | null;
  activationMode: GlobalConstraintActivationMode;
  confirmationAcknowledgement: string;
}

export const EMOTIONAL_COERCION_PROPOSAL = Object.freeze({
  proposalId: "emotional-coercion-v2",
  ruleId: "global-constraint-emotional-coercion-v2",
  title: "禁止利用无力感进行情绪绑架",
  canonicalText: [
    "判断对象是表达动机，不是具体词汇。",
    "允许反差、悬念和适度焦虑。",
    "禁止利用受众的无力感进行情绪操纵，迫使其被动接受或行动。",
  ].join("\n"),
  prohibitedIntent: "利用受众的无力感进行情绪操纵，迫使其被动接受或行动",
  traceabilityStandards: [],
  applicableScopes: ["所有IP的脚本生成"],
  priorityRedlines: ["不得利用受众的无力感迫使其被动接受或行动"],
  prohibitedScenarios: [],
  allowedBoundaries: ["反差", "悬念", "适度焦虑", "引用", "批判", "合理语境"],
  runtimePositioning: "明确高风险表达召回＋人工判断语境",
  detectionTerms: ["被时代抛弃", "阶级固化"],
  activationMode: "active_on_confirmation",
  confirmationAcknowledgement: "我已逐字核对并确认启用",
} satisfies GlobalConstraintProposal);

const UNTRACEABLE_FACTS_TRACEABILITY_STANDARDS = [
  "不要求普通口播逐句公开标注出处。",
  "系统内部必须能够追溯到具体的原始资料、原文段落或用户确认记录。",
  "精确数据、直接引语以及医疗、金融等高风险领域的结论，需要额外对外标明来源。",
  "来源可以呈现在字幕、简介、置顶评论或其他便于受众核验的位置，不必强行写入口播正文。",
] as const;

const UNTRACEABLE_FACTS_APPLICABLE_SCOPES = [
  "选题、标题、封面文案、口播脚本、图文正文和发布文案。",
  "评论、私信和公开回复中出现的事实性陈述。",
  "客户案例、业绩展示、调查结果、研究结论和权威背书。",
  "AI对原始资料进行摘要、改写、扩写和跨资料合并时产生的新增事实。",
] as const;

const UNTRACEABLE_FACTS_PRIORITY_REDLINES = [
  "IP本人经历",
  "客户案例",
  "业绩数据",
  "权威引语",
] as const;

const UNTRACEABLE_FACTS_PROHIBITED_SCENARIOS = [
  "无依据地写出具体比例、金额、人数、增长率或调查结论。",
  "虚构客户身份、服务过程、成交结果或使用效果。",
  "把他人的经历或AI生成情节写成IP本人的亲身经历。",
  "声称某位专家、企业家或机构说过无法核验的话。",
  "原始资料只表达“有所改善”，生成内容却升级为“效果提升300%”。",
  "把“可能相关”“个人观察”改写成“已经证实”“行业公认”。",
] as const;

const UNTRACEABLE_FACTS_ALLOWED_BOUNDARIES = [
  "明确标注为“假设”“示例”或“虚构情境”的内容。",
  "明确标注为个人观点、推测或待验证判断的内容。",
  "为保护隐私而匿名化的真实案例，但不得修改关键事实。",
  "常识性表达可以不附公开出处，但不得伪造精确数字和权威背书。",
  "文学创作可以虚构，但不得冒充真实报道、真实案例或IP亲历。",
] as const;

const UNTRACEABLE_FACTS_CORE =
  "禁止将未经验证、来源不明或超出原始证据的信息，以确定事实、真实案例、精确数据、直接引语或IP亲历的形式对外输出。";

export const UNTRACEABLE_FACTS_PROPOSAL = Object.freeze({
  proposalId: "untraceable-facts-v1",
  ruleId: "global-constraint-untraceable-facts-v1",
  title: "禁止编造不可溯源的事实",
  canonicalText: [
    "【核心判断】",
    UNTRACEABLE_FACTS_CORE,
    "",
    "【可溯源标准】",
    ...UNTRACEABLE_FACTS_TRACEABILITY_STANDARDS.map((item, index) => `${index + 1}. ${item}`),
    "",
    "【适用范围】",
    ...UNTRACEABLE_FACTS_APPLICABLE_SCOPES.map((item, index) => `${index + 1}. ${item}`),
    "",
    "【四项最高优先级红线】",
    ...UNTRACEABLE_FACTS_PRIORITY_REDLINES.map((item, index) => `${index + 1}. ${item}`),
    "",
    "【典型禁止场景】",
    ...UNTRACEABLE_FACTS_PROHIBITED_SCENARIOS.map((item, index) => `${index + 1}. ${item}`),
    "",
    "【允许边界】",
    ...UNTRACEABLE_FACTS_ALLOWED_BOUNDARIES.map((item, index) => `${index + 1}. ${item}`),
  ].join("\n"),
  prohibitedIntent: UNTRACEABLE_FACTS_CORE,
  traceabilityStandards: UNTRACEABLE_FACTS_TRACEABILITY_STANDARDS,
  applicableScopes: UNTRACEABLE_FACTS_APPLICABLE_SCOPES,
  priorityRedlines: UNTRACEABLE_FACTS_PRIORITY_REDLINES,
  prohibitedScenarios: UNTRACEABLE_FACTS_PROHIBITED_SCENARIOS,
  allowedBoundaries: UNTRACEABLE_FACTS_ALLOWED_BOUNDARIES,
  runtimePositioning: "高风险事实召回＋人工核验来源",
  detectionTerms: null,
  activationMode: "confirmed_pending_detection",
  confirmationAcknowledgement: "我已逐字核对并确认规则内容，检测范围待配置",
} satisfies GlobalConstraintProposal);

export const GLOBAL_CONSTRAINT_PROPOSALS = Object.freeze([
  EMOTIONAL_COERCION_PROPOSAL,
  UNTRACEABLE_FACTS_PROPOSAL,
] satisfies readonly GlobalConstraintProposal[]);

export function getGlobalConstraintProposal(proposalId: unknown): GlobalConstraintProposal | null {
  if (typeof proposalId !== "string") return null;
  return GLOBAL_CONSTRAINT_PROPOSALS.find(proposal => proposal.proposalId === proposalId) ?? null;
}
