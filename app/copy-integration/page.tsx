"use client";

import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type {
  CopyIntegrationResult,
  CopyIntegrationSource,
} from "@/lib/copy-integration-types";

const INITIAL_SOURCES: CopyIntegrationSource[] = [
  { id: "source-1", name: "素材1", content: "" },
  { id: "source-2", name: "素材2", content: "" },
];

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
  const [resultSourceNames, setResultSourceNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const sourceNames = resultSourceNames;

  function updateSource(id: string, field: "name" | "content", value: string) {
    setSources((current) => current.map((source) =>
      source.id === id ? { ...source, [field]: value } : source));
  }

  function addSource() {
    if (sources.length >= 10) return;
    const number = nextSourceNumber.current;
    nextSourceNumber.current += 1;
    setSources((current) => [
      ...current,
      { id: `source-${number}`, name: `素材${number}`, content: "" },
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

    setError("");
    setCopied(false);
    setLoading(true);
    try {
      const response = await apiFetch("/api/copy-integration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sources: validSources.map((source) => ({
            ...source,
            name: source.name.trim() || "未命名素材",
            content: source.content.trim(),
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
      setResult(body);
    } catch (caught) {
      setResult(null);
      setError(caught instanceof Error ? caught.message : "文案整合失败");
    } finally {
      setLoading(false);
    }
  }

  async function copyDraft() {
    if (!result) return;
    await navigator.clipboard.writeText(result.draft.fullText);
    setCopied(true);
  }

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
              <p className="mt-1 text-[12px] text-[#999]">每份素材独立填写，便于追踪来源和识别冲突。</p>
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
              </div>
            ))}
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
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-[16px] font-bold text-[#1C1C1B]">内容母稿</h2>
                  <button type="button" onClick={copyDraft}
                    className="rounded-full bg-[#C8F04A] px-3 py-1.5 text-[12px] font-bold text-[#1C1C1B]">
                    {copied ? "已复制" : "复制母稿"}
                  </button>
                </div>
                <div className="flex flex-col gap-5">
                  {result.draft.sections.map((section, index) => (
                    <article key={`${section.heading}-${index}`}>
                      <h3 className="text-[15px] font-bold text-[#2B2B29]">{section.heading}</h3>
                      <div className="mt-2 flex flex-col gap-2 text-[13.5px] leading-7 text-[#444]">
                        {section.paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
                      </div>
                      <NoteSources sourceIds={section.sourceIds} names={sourceNames} />
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
