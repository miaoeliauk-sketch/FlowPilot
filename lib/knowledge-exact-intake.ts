import { saveExactKnowledgeTemplateEntry } from "./ip-store";
import type { KnowledgeCategory, KnowledgeEntry } from "./types";

export const EXACT_TEMPLATE_CATEGORIES = [
  "方法论",
  "定位方法库",
  "选题方法库",
  "标题方法库",
  "开头方法库",
  "文案框架方法库",
] as const satisfies readonly KnowledgeCategory[];

const EXACT_TEMPLATE_CATEGORY_SET = new Set<KnowledgeCategory>(EXACT_TEMPLATE_CATEGORIES);

export interface SaveExactKnowledgeTemplateInput {
  templateKey: string;
  version: string;
  title: string;
  rawContent: string;
  category: KnowledgeCategory;
  sourceName: string;
  sourceUrl: string;
  tags: string[];
  keywords: string[];
}

function assertInput(input: SaveExactKnowledgeTemplateInput): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.templateKey)) {
    throw new Error("模板编号只能使用小写字母、数字和连字符");
  }
  if (!/^\d+\.\d+\.\d+$/.test(input.version)) {
    throw new Error("模板版本必须使用x.y.z格式");
  }
  if (!input.title.trim()) throw new Error("执行模板标题不能为空");
  if (!input.rawContent.trim()) throw new Error("执行模板正文不能为空");
  if (!input.sourceName.trim()) throw new Error("执行模板来源名称不能为空");
  if (!EXACT_TEMPLATE_CATEGORY_SET.has(input.category)) {
    throw new Error("执行模板必须保存到全局方法类知识库");
  }
}

export async function saveExactKnowledgeTemplate(
  input: SaveExactKnowledgeTemplateInput,
): Promise<KnowledgeEntry> {
  assertInput(input);
  const templateKey = input.templateKey.trim();
  const version = input.version.trim();
  return saveExactKnowledgeTemplateEntry({
    templateKey,
    version,
    category: input.category,
    title: input.title.trim(),
    rawContent: input.rawContent,
    sourceName: input.sourceName.trim(),
    tags: [...input.tags],
    keywords: [...input.keywords],
    sourceUrl: input.sourceUrl.trim(),
  });
}
