import type { TopicBoardResult, TopicEvaluationSummary } from "./topic-board-contract";
import type { ScriptDirectorProfileId } from "./script-director-profile";

// ── IP风格改写引擎：口播逐字稿样本库 + 风格学习机制 ──
// 注：原 StyleProfile / AIMemory / TrainingSource 三个接口是早期"AI人格训练"功能
// 留下的死代码（ip-store.ts 里有读写函数，但全项目零调用），已在本次重构中移除，
// 由下面的 VoiceSample + IPStyleProfile 取代，走 buildIPContextBlock 统一注入、
// apiMeta 可信度面板的项目标准约定，不再是孤立的一套机制。
/**
 * @deprecated 已由 KnowledgeEntry(category="IP语料库") 取代。
 * getVoiceSamples()/addVoiceSample() 函数签名保持不变（透明兼容），
 * 内部实现已改为读写知识库 IP语料库 分类。
 * 这个接口定义暂时保留供数据迁移函数使用，后续清理时可删除。
 */
export interface VoiceSample {
  id: string;
  ipId: string;
  title: string; // 样本标题，例如《AI工作流教程》，用于"改写结果页·引用来源"展示
  type: "口播逐字稿" | "文案" | "视频字幕" | "其他";
  rawText: string;
  note: string;
  createdAt: string;
}

// 从多篇 VoiceSample 中提取出的结构化风格画像，对应"IP风格学习机制"要求的7类要素
export interface IPStyleProfile {
  ipId: string;
  openingHabits: string[]; // 开头习惯，例如"很多人以为…"
  viewpointStyle: string; // 观点表达方式，例如"先讲案例再给结论，不直接说教"
  sentenceLength: "短句为主" | "中句为主" | "长句为主" | "长短句结合";
  emotionalTone: string[]; // 情绪风格标签，例如["理性","犀利","操盘手视角"]
  commonPhrases: string[]; // 常用词/高频表达
  closingHabits: string[]; // 结尾方式
  forbiddenExpressions: string[]; // 从真实样本反推出的禁用表达（AI味/书面语/不像本人）
  styleSummary: string; // 一段可读的整体语感总结
  sourceSampleIds: string[]; // 这次提取基于哪些样本
  sourceSampleTitles: string[]; // 对应标题，结果页"引用来源"直接展示，不用每次反查
  extractedAt: string;
  model: string;
}

export interface IPProfile {
  id: string;
  name: string;
  avatar: string;
  // 基础信息
  positioning: string;
  platforms: string[];
  audience: string;
  contentDirection: string[];
  // 人设信息
  personaKeywords: string[];
  professionalIdentity: string;
  personalityTags: string[];
  credibilitySource: string;
  representativeViewpoints: string[];
  // 表达风格
  tone: string;
  commonOpenings: string[];
  commonClosings: string[];
  catchphrases: string[];
  forbiddenExpressions: string[];
  pacing: string;
  // 拍摄信息
  commonScenes: string[];
  commonShotTypes: string[];
  showsFace: boolean;
  usesScreenRecording: boolean;
  needsBroll: boolean;
  needsCaseScreenshots: boolean;
  needsSubtitleHighlight: boolean;
  // 历史内容（轻量字段，完整资产走 TopicAsset/ScriptAsset 资产库）
  sampleViralTitles: string[];
  styleNotes: string;
  scriptDirectorProfileId?: ScriptDirectorProfileId | null;
  bio: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export type TopicAssetStatus = "草稿" | "已评估" | "已采用" | "已拍摄" | "已废弃";

export interface TopicAssetEvaluationIssue {
  code: "INVALID_LEGACY_BOARD_RESULT";
  message: string;
}

export interface TopicAsset {
  id: string;
  ipId: string;
  title: string;
  source: "manual" | "comment-radar";
  status: TopicAssetStatus;
  evaluationSummary?: TopicEvaluationSummary;
  boardResult?: TopicBoardResult;
  evaluationIssue?: TopicAssetEvaluationIssue;
  createdAt: string;
  updatedAt: string;
}

export interface CommentAsset {
  id: string;
  ipId: string;
  rawText: string;
  platform: string;
  radarResult?: unknown;
  importedAt: string;
}

export interface ScriptAsset {
  id: string;
  ipId: string;
  topicId?: string;
  title: string;
  cover: string;
  content: string;
  status: "草稿" | "定稿" | "已拍摄";
  scriptResult?: unknown;
  knowledgeTracking: ScriptKnowledgeTracking;
  createdAt: string;
}

export type ScriptKnowledgeUsageType = "structure" | "argument" | "case" | "expression";

export interface ScriptKnowledgeUsage {
  knowledgeEntryId: string;
  usageType: ScriptKnowledgeUsageType;
  sectionLabel: string;
  evidenceExcerpt: string;
  reason: string;
}

export type ScriptKnowledgeTracking =
  | {
      status: "not_tracked";
      candidateKnowledgeEntryIds: [];
      verifiedAt: null;
      usages: [];
    }
  | {
      status: "unavailable";
      candidateKnowledgeEntryIds: string[];
      verifiedAt: string;
      usages: [];
    }
  | {
      status: "verified";
      candidateKnowledgeEntryIds: string[];
      verifiedAt: string;
      usages: ScriptKnowledgeUsage[];
    };

export type NewScriptAssetInput = Omit<
  ScriptAsset,
  "id" | "createdAt" | "knowledgeTracking"
> & {
  knowledgeTracking?: ScriptKnowledgeTracking;
};

// ══════════════════════════════════════════════════════════════
// 统一知识模型 KnowledgeItem（V2重构）
// 所有旧知识库分类通过 adapter 层映射到此模型，历史数据不受影响。
// 旧分类 KnowledgeCategory 继续保留供现有接口使用。
// ══════════════════════════════════════════════════════════════

/** 知识类型：描述这条知识是什么 */
export type KnowledgeItemType =
  | "source"    // IP原始内容——老师真实表达过的完整资料
  | "case"      // 案例——来自爆款案例库/选题案例库
  | "method"    // 方法论——来自方法论库/复盘经验库
  | "hook"      // 钩子——来自Hook库
  | "insight"   // 评论洞察——来自评论需求库
  | "script"    // 脚本——来自脚本资产
  | "persona";  // 人设——来自IP语料库

/** 应用场景：描述这条知识适合在哪个生产环节使用 */
export type KnowledgeItemScene =
  | "idea"      // 选题环节
  | "script"    // 脚本生成环节
  | "analysis"  // 分析环节（爆款研究/内容诊断）
  | "comment"   // 评论区环节
  | "review";   // 发布复盘环节

/** 统一知识条目——所有旧知识库分类在逻辑层映射到此结构 */
export interface KnowledgeItem {
  id: string;
  type: KnowledgeItemType;
  scene: KnowledgeItemScene[];       // 可同时适用多个场景
  title: string;
  content: string;                   // 对应旧的 rawContent
  tags: string[];
  keywords: string[];
  ipId: string | null;
  sourceTier: "高" | "中" | "低";
  sourceTierReason: string;
  createdAt: string;

  // 引用追踪——记录AI使用了哪些知识，供CitationSummary展示
  usageCount: number;
  lastUsedAt: string | null;
  usedByModules: string[];          // 哪些模块引用过，例如["脚本工厂","选题董事会"]

  // 溯源——链接回旧系统，方便渐进迁移期间双向对照
  legacyCategory: string;           // 原来的 KnowledgeCategory 字符串
  legacyId: string;                 // 原来的 KnowledgeEntry.id（相同，方便查找）

  // 可选：富媒体指标（仅 case 类型有）
  metrics?: { likes?: number; views?: number; comments?: number } | null;
}

// 旧分类 → 新类型的映射表（供 adapter 层使用）
export const CATEGORY_TO_TYPE: Record<string, KnowledgeItemType> = {
  "IP原始内容": "source",
  "爆款案例":   "case",
  "方法论":     "method",
  "评论需求":   "insight",
  "选题案例":   "case",
  "IP语料库":   "persona",
  "复盘经验库": "method",
  "IP口播":     "persona",
  "Hook":       "hook",
};

// 旧分类 → 默认场景的映射表
export const CATEGORY_TO_SCENE: Record<string, KnowledgeItemScene[]> = {
  "IP原始内容": ["idea", "script", "analysis"],
  "爆款案例":   ["idea", "script", "analysis"],
  "方法论":     ["idea", "script", "review"],
  "评论需求":   ["idea", "comment"],
  "选题案例":   ["idea"],
  "IP语料库":   ["script"],
  "复盘经验库": ["review"],
  "IP口播":     ["script"],
  "Hook":       ["script"],
};

export const KNOWLEDGE_ITEM_TYPE_LABEL: Record<KnowledgeItemType, string> = {
  source: "IP原始内容",
  case: "案例", method: "方法论", hook: "钩子",
  insight: "评论洞察", script: "脚本", persona: "人设",
};

export const KNOWLEDGE_ITEM_SCENE_LABEL: Record<KnowledgeItemScene, string> = {
  idea: "选题", script: "脚本生成", analysis: "分析",
  comment: "评论", review: "复盘",
};

/** 用于 rebuild 管道做合法性校验的常量数组 */
export const VALID_TYPES: KnowledgeItemType[] = ["source", "case", "method", "hook", "insight", "script", "persona"];
export const VALID_SCENES: KnowledgeItemScene[] = ["idea", "script", "analysis", "comment", "review"];

// ── 知识库中心：FlowPilot底层数据中心 ──
// 注：「IP语料库」取代了原来的 VoiceSample 独立存储——
// 统一走 KnowledgeEntry 管理，不维护两套结构。
// getVoiceSamples()/addVoiceSample() 函数签名保持不变（透明兼容），
// 内部实现改为读写 KnowledgeEntry(category="IP语料库")。
export type KnowledgeCategory =
  | "爆款案例"
  | "方法论"
  | "评论需求"
  | "选题案例"
  | "IP语料库"   // 口播样本、直播样本、课程样本（由VoiceSample迁移而来）
  | "复盘经验库" // 发布复盘沉淀的成功/失败经验（从方法论分离）
  | "定位方法库"
  | "选题方法库"
  | "标题方法库"
  | "开头方法库"
  | "文案框架方法库"
  | "IP原始内容"
  | "IP人设资料"
  | "IP表达语料"
  | "IP历史内容"
  | "IP高表现内容"
  | "IP受众反馈"
  | "IP禁用规则";
export type SourceTier = "高" | "中" | "低";

export type IPOriginalSourceKind = "直播逐字稿" | "课程内容" | "文章" | "语音整理" | "其他";
export type IPSourceAnalysisKind = "question" | "claim" | "reasoning" | "evidence" | "concept" | "topic" | "expression";
export type IPSourceExtractionStatus = "AI提取" | "人工确认";

export interface IPSourceAnalysisItem {
  id: string;
  kind: IPSourceAnalysisKind;
  content: string;
  sourceId: string;
  startPosition: number;
  endPosition: number;
  originalExcerpt: string;
  extractionStatus: IPSourceExtractionStatus;
}

export interface IPSourceAnalysis {
  analyzedAt: string;
  parserVersion: 1;
  items: IPSourceAnalysisItem[];
}

export interface IPSourceAnchor {
  quote: string;
  startPosition: number;
  endPosition: number;
}

export interface IPSourceBackedStatement {
  content: string;
  anchors: IPSourceAnchor[];
}

export type CognitionEvidenceType = "case" | "data" | "external_fact" | "analogy" | "counter_example";
export type CognitionReviewStatus = "ai_extracted" | "human_confirmed" | "rejected";
export type CognitionReasoningStatus = "complete" | "partial" | "not_provided";

export interface CognitionNodeV2 {
  id: string;
  question: IPSourceBackedStatement & {
    derivation: "explicit" | "inferred";
  };
  claim: IPSourceBackedStatement;
  reasoning: {
    status: CognitionReasoningStatus;
    steps: Array<IPSourceBackedStatement & { order: number }>;
  };
  evidence: Array<IPSourceBackedStatement & {
    type: CognitionEvidenceType;
    verificationStatus: "unverified" | "verified";
  }>;
  concepts: Array<{
    term: string;
    definition: string;
    anchors: IPSourceAnchor[];
  }>;
  reviewStatus: CognitionReviewStatus;
}

export interface CognitionAISuggestion {
  content: string;
  basedOnNodeIds: string[];
}

export interface IPSourceAnalysisV2 {
  analyzedAt: string;
  parserVersion: 2;
  sourceId: string;
  sourceHash: string;
  nodes: CognitionNodeV2[];
  aiSuggestions: {
    potentialPrinciples: CognitionAISuggestion[];
    topicPotential: CognitionAISuggestion[];
  };
}

export type IPSourceAnalysisSnapshot = IPSourceAnalysis | IPSourceAnalysisV2;

// 调用方模块——故意不用closed union锁死，因为AI内容工厂/内容诊断中心这类还没建出来的
// 模块以后接入时，不应该需要回头改这个类型定义。已知模块给个集合方便UI下拉，不是类型层面的限制。
export type ConsumerModule = string;
export const KNOWN_CONSUMER_MODULES = ["选题董事会", "评论区雷达"] as const;

export type RelevanceTier = "高度相关" | "中度相关" | "低度相关";

export type KnowledgeUsageTrackingStatus =
  | "legacy_unverified"
  | "module_recorded"
  | "script_adopted";

export interface KnowledgeUsageRecord {
  id: string;
  module: ConsumerModule;
  usedAt: string;
  reason: string; // 引用原因——为什么这条知识被认为相关
  relevanceTier: RelevanceTier; // 定性档位，不是编造的精确相似度数字
  relevanceReason: string; // 为什么是这个相关度档位的具体依据
  context: string; // 当时检索的输入是什么（例如具体选题文本/评论内容摘要）
  trackingStatus: KnowledgeUsageTrackingStatus;
  topicId: string | null;
  scriptId: string | null;
  reviewId: string | null;
  usageType: ScriptKnowledgeUsageType | null;
  sectionLabel: string | null;
  evidenceExcerpt: string | null;
}

export type KnowledgeStatus = "未使用" | "已用于选题" | "已用于脚本" | "已用于分析";

export type KnowledgeTrustStatus =
  | "ai_derived_unverified"
  | "adopted_awaiting_effect"
  | "effect_evidence_awaiting_judgment"
  | "human_confirmed_effective";

export interface HotAnalysisKnowledgeSourceReference {
  sourceType: "hot_analysis";
  analysisId: string;
  role: "viral_case" | "method_card";
  groupItemId: string;
}

export interface KnowledgeExecutionTemplateReference {
  templateKey: string;
  version: string;
  contentHash: string;
}

export interface KnowledgeEntry {
  id: string;
  category: KnowledgeCategory;
  title: string;
  rawContent: string;
  // IP原始内容专用：原文永远保存在rawContent，解析层可以重做但不能覆盖原文。
  sourceKind?: IPOriginalSourceKind | null;
  sourceName?: string;
  sourceAnalysis?: IPSourceAnalysisSnapshot | null;
  tags: string[];
  keywords: string[];
  ipId: string | null; // 所属IP，方法论/通用评论可能不属于任何IP，允许为空
  sourceTier: SourceTier; // 来源等级：高=有可验证的来源链接/数据；中=来源清楚但无法验证；低=来源不明或用户自己的二手转述
  sourceTierReason: string; // 为什么是这个等级，AI给出建议，用户可在保存前编辑覆盖
  contentDirection: string[];
  sourcePlatform: string;
  sourceUrl: string;
  note: string;
  createdAt: string;
  extractedAt: string | null; // 自动提取完成时间，null表示提取失败/跳过，字段为用户手填
  // 仅"爆款案例"分类使用，其余分类（方法论/评论需求/选题案例）这两项始终为 null
  metrics: ViralMetrics | null;
  viralEvaluation: ViralCaseEvaluation | null;
  // ── 知识流转：被哪些模块调用、调用了多少次、当前处于什么状态 ──
  // "被哪些模块调用"和"调用次数"不单独存字段，从usageRecords派生，避免和明细记录数字对不上。
  usageRecords: KnowledgeUsageRecord[];
  status: KnowledgeStatus;
  // AI拆解出的知识必须从“尚未验证”开始；后续状态只能依据真实采用、发布效果和人工确认推进。
  trustStatus?: KnowledgeTrustStatus | null;
  // 爆款分析来源组直接保存在知识条目上，不依赖分析历史继续存在；旧数据不推断、不补造。
  sourceReference?: HotAnalysisKnowledgeSourceReference | null;
  // 保真执行模板的系统身份。普通新增和通用编辑入口不能写入或修改。
  executionTemplate?: KnowledgeExecutionTemplateReference | null;
  // 仅通过"爆款分析中心"录入的条目会有值，其余录入方式（知识库中心手动添加）始终为null。
  // 基因库统计直接读这个字段做计数，不需要额外调用AI。
  dna: ViralDNA | null;
}

// ── 爆款案例库专用：严格收录评估体系 ──
export interface ViralMetrics {
  likes: number;
  comments: number;
  shares: number;
  favorites: number;
  aboveAccountAverage: boolean; // 播放量是否明显高于账号平均水平，由用户自己判断勾选
}

export interface HookScore {
  painPoint: number; curiosity: number; conflict: number; benefit: number; emotion: number; total: number;
}

export type ViralGrade = "S" | "A" | "B" | "不收录";
export type HookType = "痛点型" | "反常识型" | "数据型" | "故事型" | "收益型" | "身份型" | "冲突型" | "情绪型";

export interface ViralCaseEvaluation {
  account: string;
  track: string;
  hook: string;
  hookType: HookType | null;
  hookScore: HookScore;
  grade: ViralGrade;
  whyViral: string;
  structureBreakdown: string;
  metricsLayerPassed: boolean; // 由代码计算，不是AI判断
  metricsLayerReason: string;
  contentLayerPassed: boolean;
  contentLayerMatched: string[];
  structureLayerPassed: boolean;
  structureLayerMissing: string[];
  exclusionMatched: string | null;
  selfCheckPassed: boolean;
  selfCheckReasoning: string;
  admitted: boolean; // 最终结论：指标层+内容层+结构层+排除标准+钩子分+自我检查 全部通过才为true，由代码统一裁决
}

// ── Hook知识库：广度层，先囤后筛，不实时深度分析 ──
// 和爆款案例库（深度层，严进严出）是互补关系，不是替代关系。
export interface LikesSnapshot { value: number; capturedAt: string; }

export interface HookEntry {
  id: string;
  hookText: string;
  title: string;
  author: string;
  publishedAt: string; // 用户/采集方填写，不是AI推断
  likesHistory: LikesSnapshot[]; // 时间序列，不是单一数字——能看出涨跌趋势
  sourceUrl: string;
  track: string; // 采集时给的初始赛道（例如来自Codex的Raw/分类文件夹）
  trackConfirmed: string | null; // 批量分析阶段AI复核后的赛道，可能和track不一致，两者都保留不互相覆盖
  hookType: HookType | null; // 批量分析阶段才补，默认null
  createdAt: string;
  analyzed: boolean;
  analyzedAt: string | null;
}

// ── 爆款分析中心：素材雷达 → 基因库 → 对标 → 预测 ──
export interface ViralDNA {
  titleStructure: string; // 反差型/结果型/痛点型/悬念型/认知颠覆型
  openingHookType: string; // 提问题/反常识/制造焦虑/展示结果/讲故事
  openingHookText: string;
  // percentage由代码按文本字数占比计算，AI只负责切分每一段属于哪个阶段/情绪，不让AI自己报数字
  structureBreakdown: { stage: "Hook" | "Problem" | "Solution" | "Case" | "CTA"; percentage: number; content: string }[];
  emotionValue: { emotion: string; percentage: number }[];
  userNeedLayer: string; // 知识/赚钱/效率/身份认同/情绪价值/案例参考
}

export interface HotMaterialAnalysis {
  id: string;
  inputType: "transcript" | "copy" | "title"; // 链接不能单独驱动分析，只能作为sourceUrl附加引用，不是独立输入类型
  inputRaw: string;
  sourceUrl: string;
  title: string;
  author: string;
  platform: string;
  publishedAt: string;
  contentDirection: string[];
  evaluation: ViralCaseEvaluation; // 复用爆款案例库的评级引擎，不重新发明一套
  hasRealMetrics: boolean; // 用户是否提供了真实互动数据——没提供时评级会明确标注"未验证传播表现"
  worthLearning: "值得学习" | "部分学习" | "不建议学习";
  worthLearningReason: string;
  ipId: string | null;
  ipFitTier: "高度匹配" | "中度匹配" | "低度匹配" | null;
  ipFitReason: string;
  dna: ViralDNA;
  createdAt: string;
  addedToKnowledgeBase: boolean;
  knowledgeEntryId: string | null;
}

// ── 用户配置：侧边栏底部显示的"操盘人"，独立于当前操盘IP，不受IP切换影响 ──
export interface UserProfile {
  nickname: string; // 昵称，优先显示
  name: string; // 真实姓名，昵称为空时退回显示
}

// ── 用户人格（从评论区聚类生成，绑定IP，保存至评论需求库） ──
export type PersonaConfidenceTier = "高" | "中" | "低";
export type PurchaseIntent = "高" | "中" | "低";

export interface UserPersona {
  id: string;
  name: string;                    // 例如：焦虑型AI小白
  representativeComments: string[]; // 代表性原始评论（3-5条）
  keywords: string[];              // 高频关键词
  coreNeeds: string[];             // 真实需求
  coreConcerns: string[];          // 核心顾虑
  contentPreferences: string[];    // 内容偏好
  purchaseIntent: PurchaseIntent;  // 购买意向
  topicFocus: string;              // 对选题的关注点
  commentCount: number;            // 支撑该人格的评论条数
}

export interface CommentPersonaResult {
  totalComments: number;           // 导入总评论数
  validComments: number;           // 清洗后有效评论数
  filteredCount: number;           // 过滤掉的数量
  cleanedComments: string[];       // 有效评论列表
  personas: UserPersona[];         // 生成的用户人格
  confidenceTier: PersonaConfidenceTier; // 整体可信度
  confidenceReason: string;        // 可信度说明
  ipId: string | null;
  platform: string;
  createdAt: string;
}
export interface ReviewMetrics {
  views: number;
  likes: number;
  comments: number;
  favorites: number;
  shares: number;
  newFollowers: number;
  dms: number;
  leads: number;
  conversions: number;
}

export type ReviewGrade = "S" | "A" | "B" | "C";
export type ReviewPerformanceType = "爆款" | "潜力款" | "普通款" | "失败款";
export type ConfidenceTier = "高可信度" | "中可信度" | "低可信度";

export interface ReviewLayer1 {
  grade: ReviewGrade;
  performanceType: ReviewPerformanceType;
  highlights: string[];   // 数据亮点，每条说具体是哪个指标高于什么基准
  weaknesses: string[];   // 数据短板，同上
  scoringBasis: string;   // 综合评分的计算依据说明
}

export interface ReviewLayer2 {
  hasViralPotential: boolean;
  confidenceTier: ConfidenceTier;
  reasoning: string;        // 爆款判断的综合依据
  dataEvidence: string;     // 引用的实际数据
  structureEvidence: string;// 引用的内容结构特征
  knowledgeEvidence: string;// 引用的知识库案例（没有可比案例时留空并说明）
}

export interface ReviewLayer3Item {
  score: number; // 0-10
  feedback: string;
  suggestion: string;
}

export interface ReviewLayer3 {
  hasScriptText: boolean; // 是否有文本依据——没有文本就不分析，如实说明
  noScriptReason: string; // 没有文本时的说明文字
  titleAnalysis: ReviewLayer3Item;
  hookAnalysis: ReviewLayer3Item;
  middleAnalysis: ReviewLayer3Item;
  endingAnalysis: ReviewLayer3Item;
}

export interface ReviewLayer4 {
  hasHistoricalData: boolean; // 是否有足够历史数据做对比（少于3条时诚实说明）
  noHistoryReason: string;
  betterMetrics: string[];    // 优于历史均值的指标，含具体数字（均值由代码算出，不是AI编的）
  worseMetrics: string[];     // 低于历史均值的指标，同上
  changeReason: string;       // 变化原因推测，AI给出，须标注是推测
  avgHistoricalViews: number | null;
  avgHistoricalLikes: number | null;
  avgHistoricalComments: number | null;
  avgHistoricalFavorites: number | null;
}

export interface ReviewLayer5 {
  successPatterns: string[];   // 成功经验，每条要有数据支撑
  failurePatterns: string[];   // 失败经验，同上
  reusableFormulas: string[];  // 可复用公式，例如"反常识开头+案例演示+工具展示+评论区领取"
}

export interface ReviewLayer6 {
  continueSuggestions: string[];  // 建议继续做的方向+理由
  stopSuggestions: string[];      // 建议停止做的方向+理由
  optimizeSuggestions: string[];  // 建议优化做的具体方法
  recommendedTopics: string[];    // 推荐选题（3-5条）
  recommendedTitles: string[];    // 推荐标题（3-5条）
}

export type ManualReviewStatus =
  | "pending"
  | "deferred"
  | "completed"
  | "legacy_needs_manual_review";

export type ManualReviewTag =
  | "选题角度新颖"
  | "引用具体案例或经典原文"
  | "标题结构有效"
  | "表达风格贴合IP"
  | "蹭中热点或时事"
  | "发布时间平台选得好"
  | "其他";

export interface VideoReview {
  id: string;
  ipId: string | null;
  title: string;
  platform: string;
  publishedAt: string;
  videoUrl: string;
  contentDirection: string;
  topicId: string | null;
  scriptId: string | null;
  sourceType?: "flowpilot" | "external";
  traceabilityStatus?:
    | "traceable"
    | "external_untraceable"
    | "legacy_missing_link"
    | "broken_link";
  knowledgeEffectStatus?:
    | "tracked"
    | "tracked_status_pending"
    | "no_linked_knowledge"
    | "knowledge_unavailable";
  scriptText: string; // 用户粘贴的口播稿/逐字稿，Layer3分析的直接依据
  metrics: ReviewMetrics;
  analysis: {
    layer1: ReviewLayer1;
    layer2: ReviewLayer2;
    layer3: ReviewLayer3;
    layer4: ReviewLayer4;
    layer5: ReviewLayer5;
    layer6: ReviewLayer6;
  } | null;
  savedToKnowledge: boolean;
  knowledgeEntryId: string | null;
  createdAt: string;
  updatedAt: string;
  manualReviewStatus: ManualReviewStatus;
  manualReviewTags: ManualReviewTag[];
  manualReviewNote: string;
}
