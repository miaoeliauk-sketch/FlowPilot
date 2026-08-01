import { GLOBAL_CATEGORIES, IP_CATEGORIES } from "./knowledge-categories";

export type KnowledgeHubSection = "global" | "ip" | "viral" | "hook" | "voice";

export type KnowledgeHubAddAction =
  | "smart-intake"
  | "viral-form"
  | "hook-form"
  | "voice-form";

export const KNOWLEDGE_HUB_LEGACY_SECTIONS: ReadonlyArray<{
  section: Extract<KnowledgeHubSection, "viral" | "hook" | "voice">;
  label: string;
}> = [
  { section: "viral", label: "爆款案例" },
  { section: "hook", label: "Hook库" },
  { section: "voice", label: "IP口播" },
];

export function getKnowledgeHubCorrectionCategories(ipId: string | null): string[] {
  const categories = ipId ? IP_CATEGORIES : GLOBAL_CATEGORIES;
  return categories.map(category => category.id);
}

export function getKnowledgeHubAddAction(
  section: KnowledgeHubSection,
): KnowledgeHubAddAction {
  if (section === "viral") return "viral-form";
  if (section === "hook") return "hook-form";
  if (section === "voice") return "voice-form";
  return "smart-intake";
}

export interface KnowledgeHubScopedEntry {
  category: string;
  normalizedCategory: string;
  ipId: string | null;
}

export function matchesKnowledgeHubSection(
  entry: KnowledgeHubScopedEntry,
  options: {
    section: KnowledgeHubSection;
    selectedCategory: string | null;
    activeIPId: string | null;
  },
): boolean {
  if (options.section === "viral") return entry.category === "爆款案例";
  if (options.section === "global") {
    return !entry.ipId && (
      !options.selectedCategory || entry.normalizedCategory === options.selectedCategory
    );
  }
  if (options.section === "ip") {
    return Boolean(options.activeIPId) &&
      entry.ipId === options.activeIPId &&
      (!options.selectedCategory || entry.normalizedCategory === options.selectedCategory);
  }
  return false;
}
