import type {
  KnowledgeLibrarySourceKind,
  KnowledgeLibraryTrustStatus,
} from "@/lib/knowledge-library-view";

export const KNOWLEDGE_TRUST_LABELS: Record<KnowledgeLibraryTrustStatus, string> = {
  ai_derived_unverified: "AI拆解，尚未验证",
  adopted_awaiting_effect: "已被采用，等待效果",
  effect_evidence_awaiting_judgment: "已有真实效果证据，待人工判断",
  human_confirmed_effective: "人工确认有效",
  not_in_trust_system: "未纳入可信度体系",
};

export const KNOWLEDGE_SOURCE_LABELS: Record<KnowledgeLibrarySourceKind, string> = {
  ip_original: "IP原始内容",
  hot_analysis_case: "爆款分析完整案例",
  hot_analysis_method: "爆款分析方法卡",
  reviewed_method: "人工审核方法卡",
  exact_template: "原文保真执行模板",
  review_experience: "人工复盘经验",
  external_case: "外部爆款案例",
  other: "其他已记录来源",
  unknown: "未记录来源",
};
