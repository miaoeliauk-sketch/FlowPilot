interface CopyOptimizationResultLike {
  optimizedText?: string | null;
  rewrittenFullText?: string | null;
  impactAnalysis?: string | null;
  goalImpact?: {
    direction?: string | null;
    reasoning?: string | null;
  } | null;
  deviationScore?: number | null;
}

const FAILURE_MESSAGE_PATTERN =
  /未提供(?:待优化)?原文|解析失败|生成失败|改写失败|任务失败|AI未返回|返回内容(?:格式)?异常|无法执行/;

export function isCopyOptimizationTaskNotExecuted(
  result: CopyOptimizationResultLike,
): boolean {
  if (result.optimizedText === null) return true;

  const optimizedText = typeof result.optimizedText === "string"
    ? result.optimizedText.trim()
    : typeof result.rewrittenFullText === "string"
      ? result.rewrittenFullText.trim()
      : "";
  if (!optimizedText) return true;

  const impactAnalysis = typeof result.impactAnalysis === "string"
    ? result.impactAnalysis
    : typeof result.goalImpact?.reasoning === "string"
      ? result.goalImpact.reasoning
      : "";

  return FAILURE_MESSAGE_PATTERN.test(impactAnalysis);
}
