"use client";

import type { KnowledgeLibraryItem } from "@/lib/knowledge-library-view";

function formatMetric(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("zh-CN")
    : "未记录";
}

function formatDate(value: string | null): string {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN");
}

export function KnowledgeDetailPanel({
  item,
  onClose,
}: {
  item: KnowledgeLibraryItem;
  onClose: () => void;
}) {
  const { originalSource, effectEvidence, legacyUnverifiedRecords } = item.detail;
  const sourceHref = originalSource.sourceUrl && /^https?:\/\//i.test(originalSource.sourceUrl)
    ? originalSource.sourceUrl
    : null;
  const relatedRoleLabel = {
    viral_case: "完整案例",
    method_card: "方法卡",
    reviewed_method: "同来源方法卡",
    execution_template: "同来源执行模板",
  } as const;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/25" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`知识详情：${item.title}`}
        className="h-full w-full max-w-[680px] overflow-y-auto bg-[#FAFAF7] p-5 shadow-2xl md:p-7"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] text-[#8A8A86]">{item.normalizedCategory} · {item.source.label}</p>
            <h2 className="mt-1 text-[21px] font-semibold text-[#1C1C1B]">{item.title}</h2>
            <p className="mt-2 text-[12px] text-[#777]">以下仅陈列来源、采用和发布证据，结论由你判断。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭知识详情" className="rounded-lg border border-[#E5E4DE] bg-white px-3 py-1.5 text-[12px] text-[#555]">关闭</button>
        </div>

        <div className="space-y-4">
          <section className="rounded-[14px] border border-[#E5E4DE] bg-white p-4">
            <h3 className="text-[14px] font-semibold text-[#1C1C1B]">完整原始来源</h3>
            <div className="mt-2 space-y-1 text-[12px] text-[#777]">
              {originalSource.sourceName && <p>来源名称：{originalSource.sourceName}</p>}
              {originalSource.sourcePlatform && <p>来源方式：{originalSource.sourcePlatform}</p>}
              {originalSource.analysisId && <p>爆款分析编号：{originalSource.analysisId}</p>}
              {originalSource.templateKey && <p>模板标识：{originalSource.templateKey}</p>}
              {originalSource.templateVersion && <p>模板版本：{originalSource.templateVersion}</p>}
              {originalSource.reviewStatus && <p>审核状态：{originalSource.reviewStatus}</p>}
              {sourceHref && <p>来源链接：<a className="text-[#3974B8] underline" href={sourceHref} target="_blank" rel="noreferrer">查看原链接</a></p>}
            </div>
            <pre className="mt-3 whitespace-pre-wrap break-words rounded-[10px] bg-[#F7F6F2] p-3 font-sans text-[12px] leading-6 text-[#444]">{originalSource.content || "未保存原始正文"}</pre>
          </section>

          <section className="rounded-[14px] border border-[#E5E4DE] bg-white p-4">
            <h3 className="text-[14px] font-semibold text-[#1C1C1B]">真实关联案例</h3>
            {item.relatedKnowledge.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {item.relatedKnowledge.map(related => (
                  <li key={related.id} className="rounded-[10px] bg-[#F7F6F2] px-3 py-2 text-[12px] text-[#555]">
                    {relatedRoleLabel[related.role]}：{related.title} · {related.category}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-[12px] text-[#888]">暂无可核验的来源组关联，不补造缺失关系。</p>}
          </section>

          <section className="rounded-[14px] border border-[#E5E4DE] bg-white p-4">
            <h3 className="text-[14px] font-semibold text-[#1C1C1B]">真实采用与发布证据</h3>
            {effectEvidence.length > 0 ? (
              <div className="mt-3 space-y-3">
                {effectEvidence.map(evidence => (
                  <article key={evidence.scriptId} className="rounded-[10px] border border-[#ECEBE5] p-3 text-[12px] text-[#555]">
                    <p className="font-semibold text-[#333]">脚本：{evidence.scriptTitle}</p>
                    <p className="mt-1">采用时间：{formatDate(evidence.usedAt)}</p>
                    {evidence.sectionLabel && <p>采用位置：{evidence.sectionLabel}</p>}
                    {evidence.evidenceExcerpt && <p>正文证据：{evidence.evidenceExcerpt}</p>}
                    {evidence.reviewId ? (
                      <div className="mt-2 border-t border-[#ECEBE5] pt-2">
                        <p className="font-semibold text-[#333]">复盘：{evidence.reviewTitle ?? "未记录标题"}</p>
                        <p>{evidence.platform ?? "未记录平台"} · 发布于{formatDate(evidence.publishedAt)}</p>
                        <p className="mt-1 leading-5">
                          播放{formatMetric(evidence.metrics?.views)} · 点赞{formatMetric(evidence.metrics?.likes)} · 评论{formatMetric(evidence.metrics?.comments)} · 收藏{formatMetric(evidence.metrics?.favorites)} · 分享{formatMetric(evidence.metrics?.shares)}
                        </p>
                        <p className="leading-5">
                          涨粉{formatMetric(evidence.metrics?.newFollowers)} · 私信{formatMetric(evidence.metrics?.dms)} · 线索{formatMetric(evidence.metrics?.leads)} · 转化{formatMetric(evidence.metrics?.conversions)}
                        </p>
                        {evidence.manualReviewNote && <p className="mt-1">人工复盘说明：{evidence.manualReviewNote}</p>}
                      </div>
                    ) : <p className="mt-2 border-t border-[#ECEBE5] pt-2 text-[#888]">尚未关联真实发布复盘。</p>}
                  </article>
                ))}
              </div>
            ) : <p className="mt-2 text-[12px] text-[#888]">暂无经过统一契约确认的采用记录。</p>}
          </section>

          {legacyUnverifiedRecords.length > 0 && (
            <section className="rounded-[14px] border border-[#E8D7B7] bg-[#FFF9ED] p-4">
              <h3 className="text-[14px] font-semibold text-[#6B5122]">历史未验证记录</h3>
              <p className="mt-1 text-[11.5px] text-[#866A36]">这些旧记录缺少完整证据，不计入上方采用和复盘统计。</p>
              <ul className="mt-2 space-y-2">
                {legacyUnverifiedRecords.map(record => (
                  <li key={record.id} className="text-[12px] text-[#6B5122]">
                    {record.module} · {formatDate(record.usedAt)}：{record.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
