export interface KnowledgeOwnership {
  ipId: unknown;
}

export function isKnowledgeVisibleToIP(
  knowledge: KnowledgeOwnership,
  activeIPId: string | null,
): boolean {
  if (knowledge.ipId === null) return true;
  return typeof knowledge.ipId === "string"
    && activeIPId !== null
    && knowledge.ipId.trim().length > 0
    && activeIPId.trim().length > 0
    && knowledge.ipId === activeIPId;
}

export function filterKnowledgeVisibleToIP<T extends KnowledgeOwnership>(
  knowledgeItems: readonly T[],
  activeIPId: string | null,
): T[] {
  return knowledgeItems.filter(item => isKnowledgeVisibleToIP(item, activeIPId));
}
