export const GLOBAL_CATEGORIES = [
  { id: "定位方法库",     desc: "账号定位、人设定位、受众定位、差异化定位的方法，供 AI 判断内容方向参考。" },
  { id: "选题方法库",     desc: "选题判断、爆款选题、用户痛点、内容角度、平台趋势，供 AI 做选题判断参考。" },
  { id: "标题方法库",     desc: "爆款标题、标题公式、关键词组合、情绪词、利益点表达，供 AI 生成标题参考。" },
  { id: "开头方法库",     desc: "短视频开头、3秒钩子、冲突引入、问题引入、反常识开头，供 AI 生成开头参考。" },
  { id: "文案框架方法库", desc: "口播文案结构、脚本结构、转折方式、论证框架、故事结构，供 AI 生成脚本参考。" },
  { id: "通用禁用规则",   desc: "所有IP都必须遵守的内容底线、价值观红线和禁止使用的表达动机。" },
] as const;

export const IP_CATEGORIES = [
  { id: "IP原始内容",   desc: "当前IP亲自表达过的直播、课程、文章和语音资料。完整原文只保存一份，观点与表达解析都可回溯原文。" },
  { id: "IP人设资料",   desc: "当前 IP 的身份设定、定位、角色关系、专业背景和内容边界。" },
  { id: "IP表达语料",   desc: "当前 IP 的常用语气、句式、开头方式、表达习惯和口头禅。" },
  { id: "IP历史内容",   desc: "当前 IP 过去发布过的文案、脚本、逐字稿和内容记录。" },
  { id: "IP高表现内容", desc: "当前 IP 数据表现较好的内容，供 AI 学习有效表达方式。" },
  { id: "IP受众反馈",   desc: "评论区、高赞反馈、用户问题、用户痛点和真实需求。" },
  { id: "IP禁用规则",   desc: "当前 IP 不应使用的表达、不能碰的话题、不符合人设的语气和内容边界。" },
] as const;

export type GlobalCategoryId = typeof GLOBAL_CATEGORIES[number]["id"];
export type IPCategoryId = typeof IP_CATEGORIES[number]["id"];

const LEGACY_TO_NEW: Record<string, string> = {
  "爆款案例": "选题方法库",
  "选题案例": "选题方法库",
  "方法论": "文案框架方法库",
  "Hook": "开头方法库",
  "IP语料库": "IP表达语料",
  "复盘经验库": "选题方法库",
};

export const ALL_NEW_CATS = [...GLOBAL_CATEGORIES.map(c => c.id), ...IP_CATEGORIES.map(c => c.id)];

export function getNormalizedCategory(e: { category: string; tags?: string[]; ipId?: string | null; title?: string }): string {
  if (ALL_NEW_CATS.includes(e.category as any)) return e.category;
  if (e.category === "评论需求") return e.ipId ? "IP受众反馈" : "选题方法库";
  if (LEGACY_TO_NEW[e.category]) return LEGACY_TO_NEW[e.category];
  const title = (e.title ?? "").toLowerCase();
  if (title.includes("开头") || title.includes("钩子") || title.includes("开场")) return "开头方法库";
  if (title.includes("标题")) return "标题方法库";
  if (title.includes("文案框架") || title.includes("脚本框架")) return "文案框架方法库";
  if (title.includes("定位")) return "定位方法库";
  if (title.includes("选题") || title.includes("痛点")) return "选题方法库";
  for (const cat of ALL_NEW_CATS) {
    if ((e.tags ?? []).some(t => t.includes(cat) || cat.includes(t))) return cat;
  }
  return "待确认";
}

export function isGlobalMethodCategory(category: string) {
  return GLOBAL_CATEGORIES.some(c => c.id === category && !isGlobalConstraintCategory(c.id));
}

export function isGlobalConstraintCategory(category: string) {
  return category === "通用禁用规则";
}

export function isIPKnowledgeCategory(category: string) {
  return IP_CATEGORIES.some(c => c.id === category);
}
