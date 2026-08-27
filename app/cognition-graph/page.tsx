"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AssociationAuditPanel } from "@/components/ip-brain/AssociationAuditPanel";
import { CognitionGraphCanvas } from "@/components/ip-brain/CognitionGraphCanvas";
import { apiFetch } from "@/lib/api-fetch";
import type { AssociationAuditResponse } from "@/lib/cognition-association-audit";
import { bridgeCognitionGraph } from "@/lib/cognition-graph-bridge";
import { buildBoundarySourceBundle } from "@/lib/ip-boundary-ui";
import { useIP } from "@/lib/ip-context";
import { getKnowledgeEntries } from "@/lib/ip-store";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAuditResponse(value: unknown): AssociationAuditResponse | null {
  if (!isRecord(value)
    || !(value.auditScope === "full" || value.auditScope === "subset")
    || typeof value.truncated !== "boolean"
    || typeof value.candidateCountBeforeTruncation !== "number"
    || !Number.isInteger(value.candidateCountBeforeTruncation)
    || value.candidateCountBeforeTruncation < 0
    || typeof value.assessedCandidateCount !== "number"
    || !Number.isInteger(value.assessedCandidateCount)
    || value.assessedCandidateCount < 0
    || !Array.isArray(value.results)) return null;

  const results: AssociationAuditResponse["results"] = [];
  const seen = new Set<string>();
  for (const item of value.results) {
    if (!isRecord(item)
      || typeof item.nodeId !== "string" || !item.nodeId.trim() || seen.has(item.nodeId)
      || !(item.relation === "RELATED" || item.relation === "CONFLICTING"
        || item.relation === "UNRELATED" || item.relation === "UNASSESSED")
      || typeof item.lexicalScore !== "number" || item.lexicalScore < 0 || item.lexicalScore > 1
      || !(typeof item.reason === "string" || item.reason === null)
      || !(typeof item.quote === "string" || item.quote === null)) return null;
    if ((item.relation === "RELATED" || item.relation === "CONFLICTING")
      && (!(typeof item.reason === "string" && item.reason.trim())
        || !(typeof item.quote === "string" && item.quote.trim()))) return null;
    seen.add(item.nodeId);
    results.push({
      nodeId: item.nodeId,
      relation: item.relation,
      lexicalScore: item.lexicalScore,
      reason: item.reason,
      quote: item.quote,
    });
  }

  const assessedCount = results.filter(result => result.relation !== "UNASSESSED").length;
  const containsUnassessed = assessedCount !== results.length;
  if (value.candidateCountBeforeTruncation !== results.length
    || value.assessedCandidateCount !== assessedCount
    || value.truncated !== containsUnassessed) return null;

  return {
    results,
    truncated: value.truncated,
    candidateCountBeforeTruncation: value.candidateCountBeforeTruncation,
    assessedCandidateCount: value.assessedCandidateCount,
    auditScope: value.auditScope,
  };
}

function hasExactNodeIds(report: AssociationAuditResponse, expectedNodeIds: string[]): boolean {
  if (report.results.length !== expectedNodeIds.length) return false;
  const actual = new Set(report.results.map(result => result.nodeId));
  return actual.size === expectedNodeIds.length
    && expectedNodeIds.every(nodeId => actual.has(nodeId));
}

function mergeSubsetAuditResponse(
  current: AssociationAuditResponse,
  subset: AssociationAuditResponse,
  requestedNodeIds: string[],
): AssociationAuditResponse {
  const requested = new Set(requestedNodeIds);
  const currentNodeIds = new Set(current.results.map(result => result.nodeId));
  const subsetNodeIds = new Set(subset.results.map(result => result.nodeId));
  if (subset.auditScope !== "subset"
    || subsetNodeIds.size !== requested.size
    || [...requested].some(nodeId => !currentNodeIds.has(nodeId) || !subsetNodeIds.has(nodeId))
    || subset.results.some(result => !requested.has(result.nodeId))) {
    throw new Error("子集审计返回的数据与请求范围不一致，请重试。");
  }
  const replacements = new Map(subset.results.map(result => [result.nodeId, result]));
  return {
    ...subset,
    results: current.results.map(result => replacements.get(result.nodeId) ?? result),
  };
}

export default function CognitionGraphPage() {
  const { activeIP, loading: ipLoading } = useIP();
  const [input, setInput] = useState("");
  const [report, setReport] = useState<AssociationAuditResponse | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);
  const reportRef = useRef<AssociationAuditResponse | null>(null);
  const inFlightAuditKeysRef = useRef(new Map<string, number>());

  const cognition = useMemo(() => {
    if (!activeIP) return { sources: [], nodes: [], error: null as string | null };
    try {
      const bundle = buildBoundarySourceBundle(getKnowledgeEntries("IP原始内容"), activeIP.id);
      return {
        sources: bundle.sources,
        nodes: bundle.sources.flatMap(source => source.analysis.nodes
          .filter(node => node.reviewStatus === "human_confirmed")),
        error: null as string | null,
      };
    } catch {
      return { sources: [], nodes: [], error: "认知底座读取失败，请检查当前IP的知识资料。" };
    }
  }, [activeIP]);
  const graph = useMemo(() => bridgeCognitionGraph(cognition.nodes), [cognition.nodes]);

  useEffect(() => {
    requestSequenceRef.current += 1;
    reportRef.current = null;
    setReport(null);
    setError(null);
    setAuditLoading(false);
  }, [activeIP?.id]);

  async function runAudit(candidateNodeIds?: string[]) {
    if (!activeIP || !input.trim() || cognition.sources.length === 0) return;
    const auditKey = JSON.stringify([
      activeIP.id,
      input.trim(),
      candidateNodeIds ? [...candidateNodeIds].sort() : null,
    ]);
    if (inFlightAuditKeysRef.current.get(auditKey) === requestSequenceRef.current) return;
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    inFlightAuditKeysRef.current.set(auditKey, requestSequence);
    const requestIPId = activeIP.id;
    setAuditLoading(true);
    setError(null);
    try {
      const response = await apiFetch("/api/cognition/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeIPId: requestIPId,
          input: input.trim(),
          sources: cognition.sources,
          ...(candidateNodeIds ? { candidateNodeIds } : {}),
        }),
      });
      const raw: unknown = await response.json();
      if (requestSequenceRef.current !== requestSequence || activeIP.id !== requestIPId) return;
      if (!response.ok) {
        if (response.status === 400) {
          throw new Error("审计请求参数有误，请检查待审观点后重试。");
        }
        if (response.status === 403) {
          throw new Error("当前IP的认知凭证校验失败，请重新确认知识资料。");
        }
        if (response.status === 502) {
          throw new Error("语义审计暂时失败，请稍后重试。");
        }
        throw new Error("关联审计失败，请重试。");
      }
      const parsed = parseAuditResponse(raw);
      if (!parsed) throw new Error("关联审计返回的数据不完整，请重试。");
      let nextReport = parsed;
      if (candidateNodeIds) {
        const current = reportRef.current;
        if (!current) throw new Error("原始全量审计结果已失效，请重新开始审计。");
        nextReport = mergeSubsetAuditResponse(current, parsed, candidateNodeIds);
      } else {
        if (parsed.auditScope !== "full") {
          throw new Error("关联审计返回的范围标记不正确，请重试。");
        }
        if (!hasExactNodeIds(parsed, cognition.nodes.map(node => node.id))) {
          throw new Error("关联审计返回的数据不完整，请重试。");
        }
      }
      reportRef.current = nextReport;
      setReport(nextReport);
    } catch (auditError) {
      if (requestSequenceRef.current !== requestSequence || activeIP.id !== requestIPId) return;
      setError(auditError instanceof Error ? auditError.message : "关联审计失败，请重试。");
    } finally {
      if (inFlightAuditKeysRef.current.get(auditKey) === requestSequence) {
        inFlightAuditKeysRef.current.delete(auditKey);
      }
      if (requestSequenceRef.current === requestSequence && activeIP.id === requestIPId) {
        setAuditLoading(false);
      }
    }
  }

  if (ipLoading) return <main className="p-8 text-sm text-[#777]">正在读取当前IP……</main>;
  if (!activeIP) return <main className="p-8 text-sm text-[#777]">请先选择一个IP，再查看认知图谱。</main>;

  return (
    <main className="space-y-6 p-8">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#639922]">Cognition Graph</p>
        <h1 className="mt-1 text-[26px] font-bold text-[#1C1C1B]">{activeIP.name}的认知图谱</h1>
        <p className="mt-2 text-[13px] text-[#777]">输入一个新观点，检查它与当前IP已确认认知之间的关联与冲突。</p>
      </header>

      {cognition.error && (
        <div role="alert" className="rounded-[12px] border border-[#F3C6C6] bg-[#FFF5F5] px-4 py-3 text-[13px] text-[#A32D2D]">
          {cognition.error}
        </div>
      )}

      <section className="rounded-[18px] border border-[#E5E4DE] bg-white p-5">
        <label htmlFor="association-input" className="text-[13px] font-bold text-[#333]">待审观点</label>
        <textarea
          id="association-input"
          value={input}
          onChange={event => {
            requestSequenceRef.current += 1;
            setInput(event.target.value);
            reportRef.current = null;
            setReport(null);
            setError(null);
            setAuditLoading(false);
          }}
          rows={3}
          placeholder="例如：持续输出必须依赖每天更新"
          className="mt-2 w-full resize-y rounded-[12px] border border-[#E5E4DE] bg-[#FAFAF8] px-4 py-3 text-[13px] leading-6 outline-none focus:border-[#639922]"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void runAudit()}
            disabled={auditLoading || !input.trim() || cognition.sources.length === 0}
            className="rounded-full bg-[#1C1C1B] px-5 py-2.5 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {auditLoading ? "正在关联审计……" : "开始关联审计"}
          </button>
          {cognition.sources.length === 0 && !cognition.error && (
            <span className="text-[12px] text-[#999]">当前IP暂无可验签的V2认知来源。</span>
          )}
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-[12px] border border-[#F3C6C6] bg-[#FFF5F5] px-4 py-3 text-[13px] text-[#A32D2D]">
          {error}
        </div>
      )}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
        <div className="overflow-hidden rounded-[18px] border border-[#E5E4DE] bg-white p-3">
          <CognitionGraphCanvas nodes={graph.nodes} edges={graph.edges} />
        </div>
        <div>
          {report
            ? <AssociationAuditPanel report={report} onReaudit={nodeIds => void runAudit(nodeIds)} />
            : <div className="rounded-[18px] border border-dashed border-[#D8D7D1] bg-[#F7F7F5] p-6 text-[13px] leading-6 text-[#777]">完成一次关联审计后，这里会显示相关、冲突、无关和未检查节点。</div>}
        </div>
      </section>
    </main>
  );
}
