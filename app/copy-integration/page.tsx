"use client";

import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { ContentMasterEditor } from "@/components/ContentMasterEditor";
import type { ContentMaster } from "@/lib/content-master-types";
import type {
  CopyIntegrationExclusionCandidate,
  CopyIntegrationResult,
  CopyIntegrationSource,
} from "@/lib/copy-integration-types";

type ExclusionDecisionRecord = CopyIntegrationExclusionCandidate & {
  decision: "kept" | "excluded";
};

const INITIAL_SOURCES: CopyIntegrationSource[] = [
  { id: "source-1", name: "素材1", content: "", contentWeight: 50 },
  { id: "source-2", name: "素材2", content: "", contentWeight: 50 },
];

function formatPercentageTotal(percent: number): string {
  const rounded = Math.round(percent * 100) / 100;
  if (Number.isInteger(rounded)) return `${rounded}%`;
  return `${rounded.toFixed(2).replace(/0$/u, "")}%`;
}

function NoteSources({ sourceIds, names }: { sourceIds: string[]; names: Map<string, string> }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sourceIds.map((sourceId) => (
        <span key={sourceId} className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[11px] text-[#777]">
          {names.get(sourceId) ?? sourceId}
        </span>
      ))}
    </div>
  );
}

export default function CopyIntegrationPage() {
  const nextSourceNumber = useRef(3);
  const [sources, setSources] = useState<CopyIntegrationSource[]>(INITIAL_SOURCES);
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState<CopyIntegrationResult | null>(null);
  const [exclusionDecisions, setExclusionDecisions] = useState<ExclusionDecisionRecord[]>([]);
  const [savedContentMaster, setSavedContentMaster] = useState<ContentMaster | null>(null);
  const [resultRevision, setResultRevision] = useState(0);
  const [resultSourceNames, setResultSourceNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const sourceNames = resultSourceNames;
  const sourcesWithContent = sources.filter(source => source.content.trim().length > 0);
  const activePercentageTotal = sourcesWithContent.reduce(
    (total, source) => total + (source.contentWeight ?? 0),
    0,
  );

  function rebuildFullText(sections: CopyIntegrationResult["draft"]["sections"]): string {
    return sections
      .map(section => `## ${section.heading}\n\n${section.paragraphs.map(paragraph => paragraph.text).join("\n\n")}`)
      .join("\n\n");
  }

  function updateCandidateDecisionSummary(items: string[], remainingCandidates: number): string[] {
    const otherItems = items.filter(item =>
      item !== "当前没有需要老师决策或核实的事项。" &&
      !/^另有\d+处疑似口播支架，需确认保留或排除。$/.test(item));
    if (remainingCandidates > 0) {
      return [...otherItems, `另有${remainingCandidates}处疑似口播支架，需确认保留或排除。`];
    }
    return otherItems.length > 0 ? otherItems : ["当前没有需要老师决策或核实的事项。"];
  }

  function resolveExclusionCandidate(candidate: CopyIntegrationExclusionCandidate, decision: "keep" | "exclude") {
    setResult((current) => {
      if (!current) return current;
      const exclusionCandidates = current.exclusionCandidates.filter(item => item.id !== candidate.id);
      const sections = decision === "exclude"
        ? current.draft.sections.filter(section => !section.paragraphs.some(paragraph =>
          paragraph.exclusionCandidateIds?.includes(candidate.id)))
        : current.draft.sections.map(section => ({
          ...section,
          paragraphs: section.paragraphs.map(paragraph => ({
            ...paragraph,
            exclusionCandidateIds: paragraph.exclusionCandidateIds?.filter(id => id !== candidate.id),
          })),
        }));
      const exclusions = decision === "exclude"
        ? [...current.contentReview.exclusions, {
          summary: candidate.summary,
          reason: `用户确认排除：${candidate.reason}`,
          sourceIds: candidate.sourceIds,
        }]
        : current.contentReview.exclusions;
      return {
        ...current,
        exclusionCandidates,
        draft: { sections, fullText: rebuildFullText(sections) },
        decisionSummary: {
          items: updateCandidateDecisionSummary(current.decisionSummary.items, exclusionCandidates.length),
        },
        contentReview: { ...current.contentReview, exclusions },
      };
    });
    setExclusionDecisions(current => [
      ...current.filter(item => item.id !== candidate.id),
      { ...candidate, decision: decision === "keep" ? "kept" : "excluded" },
    ]);
    setSavedContentMaster(null);
    setCopied(false);
    setResultRevision(current => current + 1);
  }

  function updateSource(id: string, field: "name" | "content", value: string) {
    setSources((current) => current.map((source) =>
      source.id === id ? { ...source, [field]: value } : source));
  }

  function updateSourceWeight(id: string, value: number) {
    setSources(current => current.map(source =>
      source.id === id ? { ...source, contentWeight: value } : source));
  }

  function addSource() {
    if (sources.length >= 10) return;
    const number = nextSourceNumber.current;
    nextSourceNumber.current += 1;
    setSources((current) => [
      ...current,
      { id: `source-${number}`, name: `素材${number}`, content: "", contentWeight: 0 },
    ]);
  }

  function removeSource(id: string) {
    setSources((current) => current.length > 2
      ? current.filter((source) => source.id !== id)
      : current);
  }

  async function integrate() {
    const validSources = sources.filter((source) => source.content.trim());
    if (validSources.length < 2) {
      setError("请至少填写2份素材正文");
      return;
    }
    if (validSources.some(source =>
      !Number.isFinite(source.contentWeight) ||
      (source.contentWeight ?? 0) <= 0 ||
      (source.contentWeight ?? 0) > 100)) {
      setError("每篇文案的内容占比必须大于0且不超过100%");
      return;
    }
    if (Math.abs(activePercentageTotal - 100) > 0.01) {
      setError("所有已填写文案的内容占比合计必须为100%");
      return;
    }

    setError("");
    setCopied(false);
    setExclusionDecisions([]);
    setLoading(true);
    try {
      const response = await apiFetch("/api/copy-integration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sources: validSources.map((source) => ({
            id: source.id,
            name: source.name.trim() || "未命名素材",
            content: source.content.trim(),
            contentPercentage: source.contentWeight,
          })),
          instruction: instruction.trim(),
        }),
      });
      const body = await response.json() as CopyIntegrationResult & { error?: string };
      if (!response.ok) throw new Error(body.error || "文案整合失败");
      setResultSourceNames(new Map(validSources.map((source) => [
        source.id,
        source.name.trim() || "未命名素材",
      ])));
      setSavedContentMaster(null);
      setExclusionDecisions([]);
      setResult({ ...body, exclusionCandidates: body.exclusionCandidates ?? [] });
      setResultRevision(current => current + 1);
    } catch (caught) {
      setResult(null);
      setSavedContentMaster(null);
      setError(caught instanceof Error ? caught.message : "文案整合失败");
    } finally {
      setLoading(false);
    }
  }

  async function copyDraft() {
    if (!result) return;
    await navigator.clipboard.writeText(savedContentMaster?.fullText ?? result.draft.fullText);
    setCopied(true);
  }

  const displayedDraftSections = savedContentMaster
    ? savedContentMaster.segments
      .filter(segment => segment.status === "正常")
      .sort((first, second) => first.order - second.order)
      .map(segment => ({
        heading: segment.heading,
        paragraphs: segment.content.split(/\n{2,}/).map((text, paragraphIndex) => ({
          text,
          sourceIds: segment.paragraphSourceIds?.[paragraphIndex] ?? segment.sourceIds,
        })),
      }))
    : result?.draft.sections ?? [];

  return (
    <div className="mx-auto max-w-[1180px] p-2 md:p-5">
      <header className="mb-6">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#8A8A86]">CONTENT INTEGRATION</div>
        <h1 className="text-[28px] font-bold tracking-tight text-[#1C1C1B]">文案整合</h1>
        <p className="mt-2 max-w-[760px] text-[13px] leading-6 text-[#777]">
          合并多份素材，进行观点级去重和逻辑整理，生成可继续创作的内容母稿。不会生成标题、爆款开头、CTA或拍摄建议。
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
        <section className="rounded-[18px] border border-[#E5E4DE] bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-bold text-[#1C1C1B]">原始素材</h2>
              <p className="mt-1 text-[12px] text-[#999]">每篇文案独立填写，并直接设置它在母稿中的目标内容占比。</p>
              <p className="mt-1 text-[11px] text-[#AAA]">已填写文案的占比合计需为100%；实际成稿可能因重复和冲突略有浮动。</p>
            </div>
            <button type="button" onClick={addSource} disabled={sources.length >= 10}
              className="rounded-full bg-[#F2F1ED] px-3 py-1.5 text-[12px] font-semibold text-[#444] hover:bg-[#E8E6DF] disabled:cursor-not-allowed disabled:opacity-50">
              ＋ 添加素材
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {sources.map((source, index) => (
              <div key={source.id} className="rounded-[14px] border border-[#E8E7E1] bg-[#FAFAF8] p-3.5">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1C1C1B] text-[10px] font-bold text-[#C8F04A]">
                    {index + 1}
                  </span>
                  <label className="flex-1">
                    <span className="sr-only">素材名称</span>
                    <input value={source.name} onChange={(event) => updateSource(source.id, "name", event.target.value)}
                      aria-label="素材名称"
                      className="w-full bg-transparent text-[13px] font-semibold text-[#333] outline-none" />
                  </label>
                  {sources.length > 2 && (
                    <button type="button" onClick={() => removeSource(source.id)}
                      className="text-[11px] text-[#A32D2D] hover:underline">删除</button>
                  )}
                </div>
                <label>
                  <span className="sr-only">素材正文</span>
                  <textarea value={source.content} onChange={(event) => updateSource(source.id, "content", event.target.value)}
                    aria-label="素材正文" rows={7} placeholder="粘贴逐字稿、笔记、参考文案或知识库内容……"
                    className="w-full resize-y rounded-[10px] border border-[#E5E4DE] bg-white p-3 text-[13px] leading-6 text-[#333] outline-none focus:border-[#639922]" />
                </label>
                <div className="mt-2 flex items-center gap-2">
                  <label className="flex items-center gap-2 text-[11px] font-semibold text-[#666]">
                    <span>内容占比</span>
                    <span className="relative">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        aria-label={`文案${index + 1}内容占比`}
                        value={source.contentWeight ?? 0}
                        onChange={event => updateSourceWeight(source.id, Number(event.target.value))}
                        className="w-20 rounded-[7px] border border-[#DDDCD6] bg-white py-1 pl-2 pr-6 text-[12px] outline-none focus:border-[#639922]"
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-[#888]">%</span>
                    </span>
                  </label>
                  <span className="text-[11px] text-[#888]">
                    {source.content.trim() ? "计入合计" : "填写正文后参与计算"}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className={`mt-3 text-right text-[12px] font-semibold ${
            Math.abs(activePercentageTotal - 100) <= 0.01 ? "text-[#639922]" : "text-[#A32D2D]"
          }`}>
            当前合计：{formatPercentageTotal(activePercentageTotal)}
          </div>

          <label className="mt-4 block">
            <span className="text-[12px] font-bold text-[#666]">补充整合要求（可选）</span>
            <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={3}
              placeholder="例如：按问题、原因、方法的顺序组织。"
              className="mt-2 w-full resize-y rounded-[10px] border border-[#E5E4DE] bg-white p-3 text-[13px] leading-6 outline-none focus:border-[#639922]" />
          </label>

          {error && <div role="alert" className="mt-3 rounded-[10px] bg-[#FCEBEB] px-3 py-2 text-[12px] text-[#A32D2D]">{error}</div>}
          <button type="button" onClick={integrate} disabled={loading}
            className="mt-4 w-full rounded-[12px] bg-[#1C1C1B] px-4 py-3 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {loading ? "正在整合……" : "开始整合"}
          </button>
        </section>

        <section className="rounded-[18px] border border-[#E5E4DE] bg-white p-5">
          {!result ? (
            <div className="flex min-h-[480px] items-center justify-center rounded-[14px] border border-dashed border-[#D9D8D2] bg-[#FAFAF8] p-8 text-center">
              <div>
                <div className="text-[30px]">⌘</div>
                <h2 className="mt-3 text-[15px] font-bold text-[#555]">整合结果将在这里出现</h2>
                <p className="mt-2 text-[12px] leading-5 text-[#999]">结果分为内容母稿、决策摘要、待确认冲突和内容核查四部分。</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {result.exclusionCandidates.length > 0 && (
                <section className="rounded-[16px] border border-[#E5B94D] bg-[#FFF8E6] p-4">
                  <h2 className="text-[16px] font-bold text-[#6E5200]">待确认排除候选</h2>
                  <p className="mt-1 text-[12px] leading-5 text-[#8A6A16]">这些内容仍保留在母稿中。只有你确认后，系统才会移除。</p>
                  {result.exclusionCandidates.map(candidate => (
                    <article key={candidate.id} className="mt-3 rounded-[12px] border border-[#F0DC9A] bg-white p-3.5">
                      <p className="text-[13px] leading-6 text-[#444]">{candidate.summary}</p>
                      <p className="mt-1 text-[12px] text-[#888]">系统建议：{candidate.reason}</p>
                      <NoteSources sourceIds={candidate.sourceIds} names={sourceNames} />
                      <div className="mt-3 flex gap-2">
                        <button type="button" onClick={() => resolveExclusionCandidate(candidate, "keep")}
                          className="rounded-full border border-[#D8D6CE] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#444]">保留进母稿</button>
                        <button type="button" onClick={() => resolveExclusionCandidate(candidate, "exclude")}
                          className="rounded-full bg-[#1C1C1B] px-3 py-1.5 text-[12px] font-semibold text-white">确认排除</button>
                      </div>
                    </article>
                  ))}
                </section>
              )}
              {exclusionDecisions.length > 0 && (
                <section className="rounded-[14px] border border-[#E5E4DE] bg-[#FAFAF8] p-3.5">
                  <h2 className="text-[13px] font-bold text-[#555]">候选处理记录</h2>
                  <div className="mt-2 flex flex-col gap-2">
                    {exclusionDecisions.map(item => (
                      <div key={item.id} className="flex items-start justify-between gap-3 text-[12px] leading-5 text-[#666]">
                        <span>{item.summary}</span>
                        <span className="shrink-0 font-semibold text-[#444]">{item.decision === "kept" ? "已保留" : "已排除"}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-[16px] font-bold text-[#1C1C1B]">内容母稿</h2>
                  <button type="button" onClick={copyDraft}
                    className="rounded-full bg-[#C8F04A] px-3 py-1.5 text-[12px] font-bold text-[#1C1C1B]">
                    {copied ? "已复制" : "复制母稿"}
                  </button>
                </div>
                {result.exclusionCandidates.length > 0 ? (
                  <div className="mb-5 rounded-[12px] border border-[#E5B94D] bg-[#FFF8E6] p-3.5 text-[12px] text-[#7A5A0A]">
                    请先处理全部排除候选，再保存母稿。
                  </div>
                ) : result.draft.sections.length === 0 ? (
                  <div className="mb-5 rounded-[12px] border border-[#E5E4DE] bg-[#FAFAF8] p-3.5 text-[12px] text-[#777]">
                    当前母稿没有可保存的内容。
                  </div>
                ) : (
                  <ContentMasterEditor
                    key={resultRevision}
                    sections={result.draft.sections}
                    sources={Array.from(sourceNames, ([id, name]) => ({ id, name }))}
                    onDraftChange={setSavedContentMaster}
                  />
                )}
                <div className="flex flex-col gap-5">
                  {displayedDraftSections.map((section, index) => (
                    <article key={`${section.heading}-${index}`}>
                      <h3 className="text-[15px] font-bold text-[#2B2B29]">{section.heading}</h3>
                      <div className="mt-2 flex flex-col gap-2 text-[13.5px] leading-7 text-[#444]">
                        {section.paragraphs.map((paragraph, paragraphIndex) => (
                          <div key={paragraphIndex}>
                            <p>{paragraph.text}</p>
                            <NoteSources sourceIds={paragraph.sourceIds} names={sourceNames} />
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <section className="rounded-[16px] border border-[#2F2F2C] bg-[#1C1C1B] p-4 text-white">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#C8F04A]" aria-hidden="true" />
                  <h2 className="text-[16px] font-bold">决策摘要</h2>
                </div>
                <div className="flex flex-col gap-2">
                  {result.decisionSummary.items.map((item, index) => (
                    <p key={index} className="text-[13px] leading-6 text-[#F3F3EF]">{item}</p>
                  ))}
                </div>
              </section>

              <section className="border-t border-[#E5E4DE] pt-5">
                <h2 className="text-[16px] font-bold text-[#A06700]">待确认冲突</h2>
                {result.conflicts.length === 0
                  ? <p className="mt-2 text-[12px] text-[#AAA]">没有发现实质冲突。</p>
                  : result.conflicts.map((item, index) => (
                    <article key={index} className="mt-3 rounded-[12px] border border-[#F0DC9A] bg-[#FFFBF0] p-3.5">
                      <h3 className="text-[13px] font-bold text-[#6E5200]">{item.topic}</h3>
                      <div className="mt-2 flex flex-col gap-2">
                        {item.alternatives.map((alternative, alternativeIndex) => (
                          <div key={alternativeIndex} className="rounded-[8px] bg-white/75 px-3 py-2 text-[12.5px] leading-5 text-[#555]">
                            <p>{alternative.text}</p>
                            <NoteSources sourceIds={alternative.sourceIds} names={sourceNames} />
                          </div>
                        ))}
                      </div>
                      <p className="mt-2.5 text-[12.5px] font-semibold leading-5 text-[#6E5200]">
                        两者矛盾点在于：{item.conflictPoint}
                      </p>
                    </article>
                  ))}
              </section>

              <section className="border-t border-[#E5E4DE] pt-5">
                <h2 className="text-[16px] font-bold text-[#1C1C1B]">未采用及依据不足内容</h2>

                <div className="mt-4">
                  <h3 className="text-[12px] font-bold text-[#666]">未采用</h3>
                  {result.contentReview.exclusions.length === 0
                    ? <p className="mt-2 text-[12px] text-[#AAA]">没有未采用内容。</p>
                    : result.contentReview.exclusions.map((item, index) => (
                      <div key={index} className="mt-2 rounded-[10px] bg-[#F7F6F2] p-3 text-[12.5px] leading-5 text-[#555]">
                        <p>{item.summary}</p>
                        <p className="mt-1 text-[#888]">排除原因：{item.reason}</p>
                        <NoteSources sourceIds={item.sourceIds} names={sourceNames} />
                      </div>
                    ))}
                </div>

                <div className="mt-5">
                  <h3 className="text-[12px] font-bold text-[#A06700]">依据不足／建议核实</h3>
                  {result.contentReview.evidenceGaps.length === 0
                    ? <p className="mt-2 text-[12px] text-[#AAA]">没有需要额外核实的内容。</p>
                    : result.contentReview.evidenceGaps.map((item, index) => (
                      <div key={index} className="mt-2 rounded-[10px] border border-[#F0DC9A] bg-[#FFFBF0] p-3 text-[12.5px] leading-5 text-[#555]">
                        <p>{item.summary}</p>
                        <p className="mt-1 text-[#888]">核实提示：{item.reason}</p>
                        <NoteSources sourceIds={item.sourceIds} names={sourceNames} />
                      </div>
                    ))}
                </div>
              </section>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
