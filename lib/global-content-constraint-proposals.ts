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
  judgmentStandards?: readonly string[];
  highRiskScenarios?: readonly string[];
  keyExamples?: readonly string[];
  protectedConfirmedAssets?: readonly string[];
  protectedFormalRecords?: readonly string[];
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

const UNAUTHORIZED_IP_VOICE_CORE =
  "普通观点可以依据已确权知识自然代笔；承诺、决定、敏感立场以及直接对外互动，必须由本人逐次确认。内容真实不等于系统已经获得公开表达或发送的授权。";

const UNAUTHORIZED_IP_VOICE_JUDGMENT_STANDARDS = [
  "第一条底线判断“这件事是否真实、有无依据”。",
  "本条底线判断“即使事情真实，系统是否有权代表IP公开说出或发送”。",
  "第一人称只是一种表达方式，不自动构成越权。依据已确权观点进行自然代笔属于允许范围。",
] as const;

const UNAUTHORIZED_IP_VOICE_APPLICABLE_SCOPES = [
  "脚本、标题、发布文案和公开声明。",
  "评论区回复、私信话术、公开回复及其他直接对外互动。",
  "合作、价格、服务、交付、退款和效果承诺。",
  "对个人、机构、行业事件及敏感议题的公开支持、反对或评价。",
] as const;

const UNAUTHORIZED_IP_VOICE_HIGH_RISK_SCENARIOS = [
  "新增承诺：价格、退款、交付期限、收益和效果保证。",
  "新增立场：公开支持、反对、评价某个人或机构。",
  "新增决定：合作、涨价、停更、离职、投资等尚未确认的安排。",
  "冒充经历：把已确权资料中不存在的事情写成“我亲身经历过”。",
  "敏感发声：道歉、承认责任、法律回应、医疗或金融建议。",
  "直接互动：发送评论、私信、公开回复或其他代表IP的对外消息。",
] as const;

const UNAUTHORIZED_IP_VOICE_ALLOWED_BOUNDARIES = [
  "将已确权的IP观点改写成自然的第一人称。",
  "引用原始资料中IP真实说过的话。",
  "普通语气表达，例如“我更倾向于……”，前提是能对应到已确认观点。",
  "明确标为草稿、模板或假设的内容，且尚未对外发送。",
  "带占位符的文案，例如“我将在【日期】公布结果”，但系统不得擅自补造日期。",
  "AI可以起草评论或私信，但不得未经本人确认直接发送。",
] as const;

const UNAUTHORIZED_IP_VOICE_KEY_EXAMPLES = [
  "“我下个月要涨价”可能来自真实的内部计划，因此未必违反第一条规则；但未经本人批准公开，仍然违反本条规则。是否公开、何时公开以及以什么方式公开，决定权始终属于IP本人。",
] as const;

export const UNAUTHORIZED_IP_VOICE_PROPOSAL = Object.freeze({
  proposalId: "unauthorized-ip-voice-v1",
  ruleId: "global-constraint-unauthorized-ip-voice-v1",
  title: "禁止越权代表IP主体发声",
  canonicalText: [
    "【核心判断】",
    UNAUTHORIZED_IP_VOICE_CORE,
    "",
    "【判断标准】",
    ...UNAUTHORIZED_IP_VOICE_JUDGMENT_STANDARDS.map((item, index) => `${index + 1}. ${item}`),
    "",
    "【适用范围】",
    ...UNAUTHORIZED_IP_VOICE_APPLICABLE_SCOPES.map((item, index) => `${index + 1}. ${item}`),
    "",
    "【必须逐次确认的高风险场景】",
    ...UNAUTHORIZED_IP_VOICE_HIGH_RISK_SCENARIOS.map((item, index) => `${index + 1}. ${item}`),
    "",
    "【允许边界】",
    ...UNAUTHORIZED_IP_VOICE_ALLOWED_BOUNDARIES.map((item, index) => `${index + 1}. ${item}`),
    "",
    "【关键例子】",
    ...UNAUTHORIZED_IP_VOICE_KEY_EXAMPLES,
  ].join("\n"),
  prohibitedIntent: "未经本人逐次确认，代表IP公开作出承诺、决定、敏感立场或直接发送对外互动消息。",
  traceabilityStandards: [],
  applicableScopes: UNAUTHORIZED_IP_VOICE_APPLICABLE_SCOPES,
  priorityRedlines: [],
  prohibitedScenarios: [],
  allowedBoundaries: UNAUTHORIZED_IP_VOICE_ALLOWED_BOUNDARIES,
  runtimePositioning: "本人逐次确认边界，检测范围待配置",
  detectionTerms: null,
  activationMode: "confirmed_pending_detection",
  confirmationAcknowledgement: "我已逐字核对并确认规则内容，检测范围待配置",
  judgmentStandards: UNAUTHORIZED_IP_VOICE_JUDGMENT_STANDARDS,
  highRiskScenarios: UNAUTHORIZED_IP_VOICE_HIGH_RISK_SCENARIOS,
  keyExamples: UNAUTHORIZED_IP_VOICE_KEY_EXAMPLES,
} satisfies GlobalConstraintProposal);

const CONFIRMED_CORE_INTEGRITY_CORE = [
  "禁止任何自动化流程、模型调用或后台同步，静默覆盖或改变已确权规则、认知及正式内容的核心含义。任何语义变化必须生成新版本，保留旧版本和变更记录，并重新取得人工确认；原确认凭证不得沿用。",
  "禁止的是静默覆盖，不是禁止修正。系统可以提出修改草案，但不能把草案冒充成已经确认的新事实。",
] as const;

const CONFIRMED_CORE_INTEGRITY_ASSETS = [
  "所有IP通用底线。",
  "IP专属规则。",
  "已确认的观点、事实、判断和认知节点。",
  "与上述内容绑定的原始来源、版本和人工确认凭证。",
] as const;

const CONFIRMED_CORE_INTEGRITY_FORMAL_RECORDS = [
  "已发布或已保存为终稿的脚本、文案和正式回复不得被静默覆盖。",
  "后续修改应形成新版本并保留历史记录。",
  "尚未保存或发布的普通草稿可以自由编辑，不要求每次修改都走正式确认。",
] as const;

const CONFIRMED_CORE_INTEGRITY_PROHIBITED_SCENARIOS = [
  "把“可以尝试”静默改成“必须执行”。",
  "合并重复知识时丢失适用条件、限制或例外。",
  "用旧版本覆盖用户后来确认的新立场。",
  "自动学习后直接改写IP观点或通用底线。",
  "修改规则正文后继续沿用原来的确认凭证。",
  "切换IP或同步数据时，将另一个IP的规则覆盖进当前IP。",
  "将AI提出的修改建议直接写成正式知识，不经过人工确认。",
] as const;

const CONFIRMED_CORE_INTEGRITY_ALLOWED_BOUNDARIES = [
  "系统可以生成修改建议或新版本草案，但必须明确保持未确认状态。",
  "排版、显示样式和排序调整不属于核心含义变化。",
  "搜索索引、向量、缓存等派生数据可以重新生成，但不得反向覆盖原始确权内容。",
  "不改变含义的展示性元数据可以调整，并应留下必要的操作记录。",
  "系统格式升级可以执行，但必须能够证明升级前后正文、规则含义和确认关系没有改变。",
] as const;

export const CONFIRMED_CORE_INTEGRITY_PROPOSAL = Object.freeze({
  proposalId: "confirmed-core-integrity-v1",
  ruleId: "global-constraint-confirmed-core-integrity-v1",
  title: "禁止静默修改已确权的核心逻辑",
  canonicalText: [
    "【核心判断】",
    ...CONFIRMED_CORE_INTEGRITY_CORE,
    "",
    "【第一层保护：核心确权资产】",
    ...CONFIRMED_CORE_INTEGRITY_ASSETS.map((item, index) => `${index + 1}. ${item}`),
    "任何含义变化都必须形成新版本，重新人工确认，并保留旧版本供回溯。",
    "",
    "【第二层保护：正式内容记录】",
    ...CONFIRMED_CORE_INTEGRITY_FORMAL_RECORDS.map((item, index) => `${index + 1}. ${item}`),
    "",
    "【典型禁止场景】",
    ...CONFIRMED_CORE_INTEGRITY_PROHIBITED_SCENARIOS.map((item, index) => `${index + 1}. ${item}`),
    "",
    "【允许边界】",
    ...CONFIRMED_CORE_INTEGRITY_ALLOWED_BOUNDARIES.map((item, index) => `${index + 1}. ${item}`),
  ].join("\n"),
  prohibitedIntent: CONFIRMED_CORE_INTEGRITY_CORE.join("\n"),
  traceabilityStandards: [],
  applicableScopes: ["核心确权资产", "正式内容记录"],
  priorityRedlines: [],
  prohibitedScenarios: CONFIRMED_CORE_INTEGRITY_PROHIBITED_SCENARIOS,
  allowedBoundaries: CONFIRMED_CORE_INTEGRITY_ALLOWED_BOUNDARIES,
  runtimePositioning: "确权资产版本保护，执行范围待配置",
  detectionTerms: null,
  activationMode: "confirmed_pending_detection",
  confirmationAcknowledgement: "我已逐字核对并确认规则内容，检测范围待配置",
  protectedConfirmedAssets: CONFIRMED_CORE_INTEGRITY_ASSETS,
  protectedFormalRecords: CONFIRMED_CORE_INTEGRITY_FORMAL_RECORDS,
} satisfies GlobalConstraintProposal);

export const GLOBAL_CONSTRAINT_PROPOSALS = Object.freeze([
  EMOTIONAL_COERCION_PROPOSAL,
  UNTRACEABLE_FACTS_PROPOSAL,
  UNAUTHORIZED_IP_VOICE_PROPOSAL,
  CONFIRMED_CORE_INTEGRITY_PROPOSAL,
] satisfies readonly GlobalConstraintProposal[]);

export function getGlobalConstraintProposal(proposalId: unknown): GlobalConstraintProposal | null {
  if (typeof proposalId !== "string") return null;
  return GLOBAL_CONSTRAINT_PROPOSALS.find(proposal => proposal.proposalId === proposalId) ?? null;
}
