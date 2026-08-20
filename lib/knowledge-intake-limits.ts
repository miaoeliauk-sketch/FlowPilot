export const GLOBAL_KNOWLEDGE_INTAKE_MAX_CHARS = 4_000;
export const GLOBAL_KNOWLEDGE_INTAKE_MAX_ITEMS = 4;
export const GLOBAL_KNOWLEDGE_INTAKE_MAX_TOKENS = 4_000;

export function buildGlobalKnowledgeIntakeLengthMessage(contentLength: number): string {
  const segmentCount = Math.max(
    1,
    Math.ceil(contentLength / GLOBAL_KNOWLEDGE_INTAKE_MAX_CHARS),
  );
  return `当前内容${contentLength}字，单次智能提炼建议不超过${GLOBAL_KNOWLEDGE_INTAKE_MAX_CHARS}字，请按章节分成约${segmentCount}段导入`;
}
