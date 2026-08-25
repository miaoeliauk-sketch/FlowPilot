"use client";

import {
  getLegacyIPSourceAnalysisItems,
  parseStoredIPSourceAnalysis,
} from "./ip-source-analysis-v2";
import {
  addKnowledgeEntryWithId,
  addFinalizedIPOriginalSourceWithId,
  getKnowledgeEntries,
  replaceLegacyIPSourceAnalysis,
} from "./ip-store";
import type {
  IPOriginalSourceKind,
  IPSourceAnalysis,
  IPSourceAnalysisItem,
  IPSourceAnalysisSnapshot,
  KnowledgeEntry,
} from "./types";

export interface AddIPOriginalSourceInput {
  sourceId?: string;
  ipId: string;
  title: string;
  sourceKind: IPOriginalSourceKind;
  originalContent: string;
  sourceName: string;
  sourceUrl: string;
  analysis: IPSourceAnalysisSnapshot;
}

export interface AddVerifiedIPOriginalSourceInput extends AddIPOriginalSourceInput {
  finalProof: string;
  isStillCurrent?: () => boolean;
}

export function createIPOriginalSourceId(): string {
  return `source-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function deriveIPOriginalSourceTitle(
  originalContent: string,
  analysis: IPSourceAnalysisSnapshot,
): string {
  const items = getLegacyIPSourceAnalysisItems(analysis);
  const candidate = items.find(item => item.kind === "claim")?.content
    ?? items[0]?.content
    ?? originalContent.split(/\r?\n/).find(line => line.trim())
    ?? "";
  const normalized = candidate.replace(/\s+/g, " ").trim().replace(/[。！？；，、：]+$/u, "");
  if (normalized.length <= 30) return normalized;
  return `${normalized.slice(0, 30)}…`;
}

function assertSourceInput(input: AddIPOriginalSourceInput) {
  if (!input.ipId.trim()) throw new Error("IP原始内容必须绑定当前IP");
  if (!input.title.trim()) throw new Error("请填写原始内容标题");
  if (!input.originalContent.trim()) throw new Error("请提供原始内容");
}

function normalizeAnalysis(
  sourceId: string,
  originalContent: string,
  analysis: IPSourceAnalysisSnapshot,
): IPSourceAnalysisSnapshot {
  if (analysis.parserVersion === 2) {
    const parsed = parseStoredIPSourceAnalysis(analysis, originalContent, sourceId);
    if (!parsed.ok) throw new Error(parsed.error);
    if (parsed.version !== 2) throw new Error("V2认知解析保存版本错误");
    return parsed.analysis;
  }
  const items = analysis.items.map((item, index): IPSourceAnalysisItem => {
    const start = item.startPosition;
    const end = item.endPosition;
    if (
      !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start ||
      originalContent.slice(start, end) !== item.originalExcerpt
    ) {
      throw new Error(`第${index + 1}条解析无法回溯到原文`);
    }
    return {
      ...item,
      id: item.id || `A${String(index + 1).padStart(2, "0")}`,
      sourceId,
    };
  });
  return {
    analyzedAt: analysis.analyzedAt,
    parserVersion: 1,
    items,
  };
}

function buildIPOriginalSourceEntry(
  input: AddIPOriginalSourceInput,
  finalProof: string | null,
): Omit<KnowledgeEntry, "createdAt"> {
  assertSourceInput(input);
  const sourceId = input.sourceId?.trim() || createIPOriginalSourceId();
  if (input.analysis.parserVersion === 2 && !input.sourceId?.trim()) {
    throw new Error("V2认知解析必须在分析前生成正式Source编号");
  }
  const sourceAnalysis = normalizeAnalysis(sourceId, input.originalContent, input.analysis);
  const allConfirmed = sourceAnalysis.parserVersion === 1
    ? sourceAnalysis.items.length > 0 && sourceAnalysis.items.every(
        item => item.extractionStatus === "人工确认",
      )
    : sourceAnalysis.nodes.length > 0 && sourceAnalysis.nodes.every(
        node => node.reviewStatus !== "ai_extracted",
      );
  const allRejected = sourceAnalysis.parserVersion === 2
    && sourceAnalysis.nodes.length > 0
    && sourceAnalysis.nodes.every(node => node.reviewStatus === "rejected");
  const analysisStatus = allRejected ? "reviewed_none" : allConfirmed ? "人工确认" : "AI提取";
  const compatibleItems = getLegacyIPSourceAnalysisItems(sourceAnalysis);
  // Source编号、完整原文和解析层一次写入，避免先保存原文、后补解析造成半成品。
  return {
    id: sourceId,
    category: "IP原始内容",
    title: input.title.trim(),
    rawContent: input.originalContent,
    sourceKind: input.sourceKind,
    sourceName: input.sourceName.trim(),
    sourceAnalysis,
    sourceFinalProof: finalProof,
    tags: [input.sourceKind],
    keywords: compatibleItems
      .filter(item => item.kind === "claim" || item.kind === "concept" || item.kind === "topic")
      .map(item => item.content.slice(0, 60)),
    ipId: input.ipId.trim(),
    sourceTier: "中",
    sourceTierReason: "原文已保存；AI解析可回溯，尚未代表外部事实已核实",
    contentDirection: compatibleItems
      .filter(item => item.kind === "topic")
      .map(item => item.content),
    sourcePlatform: input.sourceKind,
    sourceUrl: input.sourceUrl.trim(),
    note: JSON.stringify({ sourceRecord: true, analysisStatus }),
    extractedAt: input.analysis.analyzedAt,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
  };
}

export function addIPOriginalSource(input: AddIPOriginalSourceInput): KnowledgeEntry {
  if (input.analysis.parserVersion === 2) {
    throw new Error("V2认知必须经过服务端最终校验后才能入库");
  }
  return addKnowledgeEntryWithId(buildIPOriginalSourceEntry(input, null));
}

export async function addVerifiedIPOriginalSource(
  input: AddVerifiedIPOriginalSourceInput,
): Promise<KnowledgeEntry> {
  if (input.analysis.parserVersion !== 2) {
    throw new Error("旧版解析请使用原有保存入口");
  }
  if (!input.finalProof.trim()) throw new Error("缺少最终入库凭证");
  return addFinalizedIPOriginalSourceWithId(
    buildIPOriginalSourceEntry(input, input.finalProof.trim()),
    {
      activeIPId: input.ipId,
      rawContent: input.originalContent,
      finalProof: input.finalProof.trim(),
      isStillCurrent: input.isStillCurrent,
    },
  );
}

export function getIPOriginalSource(id: string): KnowledgeEntry | null {
  return getKnowledgeEntries("IP原始内容").find(entry => entry.id === id) ?? null;
}

export function replaceIPOriginalSourceAnalysis(id: string, analysis: IPSourceAnalysis): void {
  const source = getIPOriginalSource(id);
  if (!source) throw new Error("找不到要重新解析的IP原始内容");
  const sourceAnalysis = normalizeAnalysis(source.id, source.rawContent, analysis);
  replaceLegacyIPSourceAnalysis(id, sourceAnalysis);
  const persisted = getIPOriginalSource(id);
  if (persisted?.sourceAnalysis?.analyzedAt !== analysis.analyzedAt) {
    throw new Error("解析结果更新失败，Source原文未受影响");
  }
}
