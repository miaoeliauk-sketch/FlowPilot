import { GLOBAL_CATEGORIES, IP_CATEGORIES } from "./knowledge-categories";

export type KnowledgeHubSection =
  | "global"
  | "ip"
  | "viral"
  | "hook"
  | "voice"
  | "material";

export type KnowledgeHubAddAction =
  | "smart-intake"
  | "viral-form"
  | "hook-form"
  | "voice-form"
  | "cover-form";

export const KNOWLEDGE_HUB_LEGACY_SECTIONS: ReadonlyArray<{
  section: Extract<KnowledgeHubSection, "viral" | "hook" | "voice">;
  label: string;
}> = [
  { section: "viral", label: "爆款案例" },
  { section: "hook", label: "Hook库" },
  { section: "voice", label: "IP口播" },
];

export function getKnowledgeHubCorrectionCategories(ipId: string | null): string[] {
  if (ipId !== null && ipId.trim().length === 0) return [];
  const categories = ipId === null ? GLOBAL_CATEGORIES : IP_CATEGORIES;
  return categories
    .map(category => category.id)
    .filter(category => category !== "IP原始内容");
}

export function isKnowledgeHubCorrectionAllowed(
  ipId: string | null,
  category: string,
): boolean {
  return getKnowledgeHubCorrectionCategories(ipId).includes(category);
}

export function getKnowledgeHubAddAction(
  section: KnowledgeHubSection,
): KnowledgeHubAddAction {
  if (section === "viral") return "viral-form";
  if (section === "hook") return "hook-form";
  if (section === "voice") return "voice-form";
  if (section === "material") return "cover-form";
  return "smart-intake";
}

export function getKnowledgeHubIntakeHref(
  section: KnowledgeHubSection,
  selectedCategory: string | null,
): string {
  return section === "ip" && selectedCategory === "IP原始内容"
    ? "/knowledge-intake/original"
    : "/knowledge-intake";
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
    return entry.ipId === null && (
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
