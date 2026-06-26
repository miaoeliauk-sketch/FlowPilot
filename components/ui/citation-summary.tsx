/**
 * components/ui/citation-summary.tsx
 *
 * P0：知识库引用统计展示组件。
 * 在各生成模块的结果区域展示"本次生成参考了 N 条知识资产"，
 * 并按分类拆分显示来源，让用户感知到知识库真正参与了内容生产。
 *
 * 展示文案使用"参考了"而不是"引用了"，避免用户误解为AI逐条精确引用。
 */

import { KnowledgeCategory } from "@/lib/types";

interface KnowledgeRefLike {
  entry: {
    category: string;
  };
}

interface CitationSummaryProps {
  refs: KnowledgeRefLike[];
  /** 是否正在检索中 */
  loading?: boolean;
  /** 是否已触发过检索（用于判断知识库是否为空） */
  searched?: boolean;
  /** 自定义说明文字，默认"本次生成参考了" */
  label?: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  "爆款案例": "爆款案例",
  "方法论": "方法论",
  "评论需求": "评论需求",
  "选题案例": "选题案例",
  "IP语料库": "IP口播样本",
  "复盘经验库": "复盘经验",
};

const CATEGORY_ORDER: string[] = [
  "爆款案例", "IP语料库", "方法论", "评论需求", "选题案例", "复盘经验库",
];

export function CitationSummary({ refs, loading, searched, label = "本次生成参考了" }: CitationSummaryProps) {
  // 未触发检索时不展示（避免结果页空白时出现0条的提示）
  if (!searched && !loading) return null;

  // 统计各分类数量
  const counts: Record<string, number> = {};
  for (const ref of refs) {
    const cat = ref.entry.category;
    counts[cat] = (counts[cat] ?? 0) + 1;
  }

  const total = refs.length;
  const hasData = total > 0;

  // 有数据的分类，按预定顺序排列
  const entries = CATEGORY_ORDER
    .map(cat => ({ cat, label: CATEGORY_LABEL[cat] ?? cat, count: counts[cat] ?? 0 }))
    .filter(e => e.count > 0);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[12px] bg-[#F7F6F2] px-4 py-3">
      {loading ? (
        <span className="text-[12px] text-[#999]">正在检索知识库…</span>
      ) : !hasData ? (
        <span className="text-[12px] text-[#BBB]">
          知识库暂无内容，本次仅基于模型内置能力生成
        </span>
      ) : (
        <>
          <span className="text-[12px] font-semibold text-[#555]">
            {label} <span className="text-[#1C1C1B]">{total}</span> 条知识资产
          </span>
          <span className="text-[#E5E4DE]">|</span>
          {entries.map(e => (
            <span key={e.cat} className="flex items-center gap-1 text-[12px] text-[#639922]">
              <span className="text-[11px]">✓</span>
              {e.label} {e.count}条
            </span>
          ))}
          <span className="text-[10.5px] text-[#BBB]">
            · AI参考这些条目生成答案，不代表逐条精确引用
          </span>
        </>
      )}
    </div>
  );
}
