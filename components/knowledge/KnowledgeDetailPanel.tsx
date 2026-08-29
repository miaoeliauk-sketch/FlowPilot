"use client";

import { useEffect, useState } from "react";
import type { KnowledgeLibraryItem } from "@/lib/knowledge-library-view";
import type { KnowledgeDeletionPreview } from "@/lib/ip-store";
import {
  GLOBAL_BLOCKING_CONSTRAINT_CONFIRMATION_STATEMENT,
  confirmGlobalBlockingConstraintFromKnowledge,
} from "@/lib/global-content-constraint-confirmation";
import { getActiveGlobalBlockingConstraints } from "@/lib/global-content-constraint-store";

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
  onPrepareDelete,
  onDelete,
}: {
  item: KnowledgeLibraryItem;
  onClose: () => void;
  onPrepareDelete?: () => KnowledgeDeletionPreview;
  onDelete?: () => void | Promise<void>;
}) {
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletionPreview, setDeletionPreview] = useState<KnowledgeDeletionPreview | null>(null);
  const [ruleText, setRuleText] = useState(item.entry.rawContent);
  const [prohibitedIntent, setProhibitedIntent] = useState("");
  const [allowedBoundaries, setAllowedBoundaries] = useState("");
  const [detectionTerms, setDetectionTerms] = useState("");
  const [confirmedBy, setConfirmedBy] = useState("");
  const [confirmationChecked, setConfirmationChecked] = useState(false);
  const [isConfirmingRule, setIsConfirmingRule] = useState(false);
  const [ruleConfirmationError, setRuleConfirmationError] = useState<string | null>(null);
  const [ruleConfirmationSuccess, setRuleConfirmationSuccess] = useState(false);
  const [isRuleActive, setIsRuleActive] = useState(false);
  const { originalSource, effectEvidence, legacyUnverifiedRecords } = item.detail;
  const isGlobalBlockingSource = item.entry.category === "通用禁用规则" && item.entry.ipId === null;

  useEffect(() => {
    if (!isGlobalBlockingSource || typeof window === "undefined") {
      setIsRuleActive(false);
      return;
    }
    try {
      setIsRuleActive(getActiveGlobalBlockingConstraints(window.localStorage)
        .some(rule => rule.sourceKnowledgeEntryId === item.entry.id));
    } catch {
      setIsRuleActive(false);
    }
  }, [isGlobalBlockingSource, item.entry.id]);
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
          <div className="flex flex-shrink-0 gap-2">
            {onPrepareDelete && onDelete && (
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  try {
                    setDeletionPreview(onPrepareDelete());
                    setShowDeleteConfirmation(true);
                  } catch (error) {
                    setDeletionPreview(null);
                    setShowDeleteConfirmation(false);
                    setDeleteError(error instanceof Error ? error.message : "删除检查失败，请稍后重试");
                  }
                }}
                className="rounded-lg border border-[#E7B7B7] bg-white px-3 py-1.5 text-[12px] text-[#A32D2D]"
              >
                删除知识
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="关闭知识详情" className="rounded-lg border border-[#E5E4DE] bg-white px-3 py-1.5 text-[12px] text-[#555]">关闭</button>
          </div>
        </div>

        {deleteError && !showDeleteConfirmation && (
          <p role="alert" className="mb-4 rounded-[12px] border border-[#F2B8B5] bg-[#FCEBEB] px-4 py-3 text-[12px] text-[#A32D2D]">
            {deleteError}
          </p>
        )}

        {showDeleteConfirmation && deletionPreview && onDelete && (
          <section
            role="alertdialog"
            aria-modal="true"
            aria-label="确认删除知识"
            className="mb-4 rounded-[14px] border border-[#E7B7B7] bg-[#FFF5F5] p-4"
          >
            <h3 className="text-[14px] font-semibold text-[#8C2424]">确认删除「{item.title}」？</h3>
            <div className="mt-2 space-y-1 text-[12px] leading-5 text-[#6F3A3A]">
              <p>归属：{item.ipId ? "当前IP知识" : "通用知识（会影响所有IP）"}</p>
              <p>已用于脚本{deletionPreview.adoptedScriptCount}次 · 已有发布复盘{deletionPreview.reviewedScriptCount}次</p>
              <p>删除后，这条知识不再参与检索；已有脚本和复盘不会被删除。</p>
            </div>
            {deleteError && <p role="alert" className="mt-2 text-[12px] text-[#A32D2D]">{deleteError}</p>}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  setIsDeleting(true);
                  setDeleteError(null);
                  try {
                    await onDelete();
                  } catch (error) {
                    setDeleteError(error instanceof Error ? error.message : "知识删除失败，请稍后重试");
                    setIsDeleting(false);
                  }
                }}
                className="rounded-[9px] bg-[#A32D2D] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
              >
                {isDeleting ? "正在删除…" : "确认删除这条知识"}
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  setShowDeleteConfirmation(false);
                  setDeletionPreview(null);
                  setDeleteError(null);
                }}
                className="rounded-[9px] border border-[#DAD9D2] bg-white px-4 py-2 text-[12px] text-[#555] disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </section>
        )}

        <div className="space-y-4">
          {isGlobalBlockingSource && (
            <section className="rounded-[14px] border border-[#E8D7B7] bg-[#FFF9ED] p-4">
              <h3 className="text-[14px] font-semibold text-[#6B5122]">人工确认全局强制底线</h3>
              {isRuleActive || ruleConfirmationSuccess ? (
                <p className="mt-2 rounded-[10px] bg-[#EAF3DE] px-3 py-2 text-[12px] font-semibold text-[#3B6D11]">
                  已严格回读：已记录本设备显式确认，这条规则现已对所有IP生效
                </p>
              ) : (
                <>
                  <p className="mt-1 text-[12px] leading-5 text-[#866A36]">
                    这条知识尚未成为已启用的全局底线。当前记录可能来自AI整理，必须由你逐字核对后才能启用。
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-[#866A36]">
                    本设备只能记录一次显式确认操作和自述姓名，不能证明现实身份。首次生产确认仍须由你本人点击。
                  </p>
                  <div className="mt-3 space-y-3">
                    <label className="block text-[12px] font-semibold text-[#555]">
                      规则全文
                      <textarea
                        aria-label="规则全文"
                        value={ruleText}
                        onChange={event => setRuleText(event.target.value)}
                        rows={5}
                        className="mt-1 w-full rounded-[9px] border border-[#DAD9D2] bg-white p-2 text-[12px] font-normal leading-5 text-[#333]"
                      />
                    </label>
                    <label className="block text-[12px] font-semibold text-[#555]">
                      禁止的表达动机
                      <textarea
                        aria-label="禁止的表达动机"
                        value={prohibitedIntent}
                        onChange={event => setProhibitedIntent(event.target.value)}
                        rows={2}
                        className="mt-1 w-full rounded-[9px] border border-[#DAD9D2] bg-white p-2 text-[12px] font-normal leading-5 text-[#333]"
                      />
                    </label>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block text-[12px] font-semibold text-[#555]">
                        允许边界（每行一项）
                        <textarea
                          aria-label="允许边界（每行一项）"
                          value={allowedBoundaries}
                          onChange={event => setAllowedBoundaries(event.target.value)}
                          rows={5}
                          className="mt-1 w-full rounded-[9px] border border-[#DAD9D2] bg-white p-2 text-[12px] font-normal leading-5 text-[#333]"
                        />
                      </label>
                      <label className="block text-[12px] font-semibold text-[#555]">
                        高风险检测短语（每行一项）
                        <textarea
                          aria-label="高风险检测短语（每行一项）"
                          value={detectionTerms}
                          onChange={event => setDetectionTerms(event.target.value)}
                          rows={5}
                          className="mt-1 w-full rounded-[9px] border border-[#DAD9D2] bg-white p-2 text-[12px] font-normal leading-5 text-[#333]"
                        />
                      </label>
                    </div>
                    <label className="block text-[12px] font-semibold text-[#555]">
                      确认名称（本设备自述）
                      <input
                        aria-label="确认名称（本设备自述）"
                        value={confirmedBy}
                        onChange={event => setConfirmedBy(event.target.value)}
                        className="mt-1 w-full rounded-[9px] border border-[#DAD9D2] bg-white px-3 py-2 text-[12px] font-normal text-[#333]"
                      />
                    </label>
                    <label className="flex items-start gap-2 text-[12px] leading-5 text-[#555]">
                      <input
                        type="checkbox"
                        checked={confirmationChecked}
                        onChange={event => setConfirmationChecked(event.target.checked)}
                        className="mt-1"
                      />
                      {GLOBAL_BLOCKING_CONSTRAINT_CONFIRMATION_STATEMENT}
                    </label>
                    {ruleConfirmationError && <p role="alert" className="text-[12px] text-[#A32D2D]">{ruleConfirmationError}</p>}
                    <button
                      type="button"
                      disabled={isConfirmingRule || !confirmationChecked}
                      onClick={async () => {
                        setIsConfirmingRule(true);
                        setRuleConfirmationError(null);
                        try {
                          await confirmGlobalBlockingConstraintFromKnowledge(window.localStorage, {
                            sourceKnowledgeEntryId: item.entry.id,
                            expectedSourceTitle: item.entry.title,
                            expectedSourceRawContent: item.entry.rawContent,
                            confirmedBy,
                            confirmationStatement: confirmationChecked
                              ? GLOBAL_BLOCKING_CONSTRAINT_CONFIRMATION_STATEMENT
                              : "",
                            rule: {
                              title: item.entry.title,
                              canonicalText: ruleText,
                              prohibitedIntent,
                              allowedBoundaries: allowedBoundaries.split("\n").map(value => value.trim()).filter(Boolean),
                              detectionTerms: detectionTerms.split("\n").map(value => value.trim()).filter(Boolean),
                            },
                          });
                          setRuleConfirmationSuccess(true);
                          setIsRuleActive(true);
                        } catch (error) {
                          setRuleConfirmationError(error instanceof Error ? error.message : "人工确认失败，请稍后重试");
                        } finally {
                          setIsConfirmingRule(false);
                        }
                      }}
                      className="rounded-[9px] bg-[#1C1C1B] px-4 py-2 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isConfirmingRule ? "正在严格保存并回读…" : "确认并启用为所有IP强制底线"}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
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
