export const SHUIMURAN_REVIEW_CHECK_KEYS = [
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
  "compressionAddsNoFacts",
] as const;

export type ShuimuranReviewCheckKey = typeof SHUIMURAN_REVIEW_CHECK_KEYS[number];

export type ScriptHardBlockCode =
  | "cross_ip_material"
  | "fabricated_teacher_attribution";

export type ScriptQualityWarningGroupCode =
  | "mechanical_structure"
  | "generic_ending"
  | "dense_catchphrases"
  | "core_focus"
  | "reasoning_support"
  | "compression_quality"
  | "structure_and_style";

export interface ScriptHardBlockRule {
  code: ScriptHardBlockCode;
  severity: "hard_block";
  label: string;
}

export interface ScriptQualityWarningGroup {
  code: ScriptQualityWarningGroupCode;
  severity: "quality_warning";
  label: string;
}

export const HARD_BLOCK_RULES: readonly ScriptHardBlockRule[] = [
  {
    code: "cross_ip_material",
    severity: "hard_block",
    label: "跨IP资料混用",
  },
  {
    code: "fabricated_teacher_attribution",
    severity: "hard_block",
    label: "伪造老师已确认观点",
  },
];

export const QUALITY_WARNING_GROUPS: readonly ScriptQualityWarningGroup[] = [
  {
    code: "mechanical_structure",
    severity: "quality_warning",
    label: "机械清单结构",
  },
  {
    code: "generic_ending",
    severity: "quality_warning",
    label: "通用结尾",
  },
  {
    code: "dense_catchphrases",
    severity: "quality_warning",
    label: "口头禅或反问堆叠",
  },
  {
    code: "core_focus",
    severity: "quality_warning",
    label: "核心思想不集中",
  },
  {
    code: "reasoning_support",
    severity: "quality_warning",
    label: "推理支撑不足",
  },
  {
    code: "compression_quality",
    severity: "quality_warning",
    label: "压缩质量未达目标",
  },
  {
    code: "structure_and_style",
    severity: "quality_warning",
    label: "结构与表达待调整",
  },
];

export const SHUIMURAN_CHECK_TO_WARNING_GROUP: Record<
  ShuimuranReviewCheckKey,
  ScriptQualityWarningGroupCode
> = {
  titleKeepsAnswer: "structure_and_style",
  openingBuildsSuspense: "structure_and_style",
  concreteEntry: "structure_and_style",
  classicExplainsReality: "reasoning_support",
  risesToPattern: "structure_and_style",
  conciseWithoutRepetition: "structure_and_style",
  staleHotspotReframed: "structure_and_style",
  titleOpeningEndingClosed: "structure_and_style",
  soundsLikeTeacher: "structure_and_style",
  singleCoreIdea: "core_focus",
  reasoningSupported: "reasoning_support",
  endingClosesSpecificLoop: "generic_ending",
  compressionAddsNoFacts: "compression_quality",
};

export type ScriptDeliveryStatus =
  | "deliverable"
  | "deliverable_with_warnings"
  | "blocked"
  | "no_usable_content";

export interface ScriptDeliveryClassification {
  status: ScriptDeliveryStatus;
  hardBlockCodes: ScriptHardBlockCode[];
  warningCodes: ScriptQualityWarningGroupCode[];
}

export function classifyScriptDelivery(input: {
  hasUsableContent: boolean;
  hardBlockCodes: ScriptHardBlockCode[];
  warningCodes: ScriptQualityWarningGroupCode[];
}): ScriptDeliveryClassification {
  if (!input.hasUsableContent) {
    return {
      status: "no_usable_content",
      hardBlockCodes: input.hardBlockCodes,
      warningCodes: input.warningCodes,
    };
  }
  if (input.hardBlockCodes.length > 0) {
    return {
      status: "blocked",
      hardBlockCodes: input.hardBlockCodes,
      warningCodes: input.warningCodes,
    };
  }
  return {
    status: input.warningCodes.length > 0 ? "deliverable_with_warnings" : "deliverable",
    hardBlockCodes: [],
    warningCodes: input.warningCodes,
  };
}
