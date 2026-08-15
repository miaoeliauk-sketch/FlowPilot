"use client";

import {
  addKnowledgeEntryWithId,
  getKnowledgeEntries,
  updateKnowledgeEntry,
} from "./ip-store";
import type {
  IPOriginalSourceKind,
  IPSourceAnalysis,
  IPSourceAnalysisItem,
  KnowledgeEntry,
} from "./types";

export interface AddIPOriginalSourceInput {
  ipId: string;
  title: string;
  sourceKind: IPOriginalSourceKind;
  originalContent: string;
  sourceName: string;
  sourceUrl: string;
  analysis: IPSourceAnalysis;
}

export function deriveIPOriginalSourceTitle(
  originalContent: string,
  analysis: IPSourceAnalysis,
): string {
  const candidate = analysis.items.find(item => item.kind === "claim")?.content
    ?? analysis.items[0]?.content
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
  analysis: IPSourceAnalysis,
): IPSourceAnalysis {
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

export function addIPOriginalSource(input: AddIPOriginalSourceInput): KnowledgeEntry {
  assertSourceInput(input);
  const sourceId = `source-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const sourceAnalysis = normalizeAnalysis(sourceId, input.originalContent, input.analysis);
  const allConfirmed = sourceAnalysis.items.length > 0 && sourceAnalysis.items.every(
    item => item.extractionStatus === "人工确认",
  );
  // Source编号、完整原文和解析层一次写入，避免先保存原文、后补解析造成半成品。
  return addKnowledgeEntryWithId({
    id: sourceId,
    category: "IP原始内容",
    title: input.title.trim(),
    rawContent: input.originalContent,
    sourceKind: input.sourceKind,
    sourceName: input.sourceName.trim(),
    sourceAnalysis,
    tags: [input.sourceKind],
    keywords: input.analysis.items
      .filter(item => item.kind === "claim" || item.kind === "concept" || item.kind === "topic")
      .map(item => item.content.slice(0, 60)),
    ipId: input.ipId.trim(),
    sourceTier: "中",
    sourceTierReason: "原文已保存；AI解析可回溯，尚未代表外部事实已核实",
    contentDirection: input.analysis.items
      .filter(item => item.kind === "topic")
      .map(item => item.content),
    sourcePlatform: input.sourceKind,
    sourceUrl: input.sourceUrl.trim(),
    note: JSON.stringify({ sourceRecord: true, analysisStatus: allConfirmed ? "人工确认" : "AI提取" }),
    extractedAt: input.analysis.analyzedAt,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
  });
}

export function getIPOriginalSource(id: string): KnowledgeEntry | null {
  return getKnowledgeEntries("IP原始内容").find(entry => entry.id === id) ?? null;
}

export function replaceIPOriginalSourceAnalysis(id: string, analysis: IPSourceAnalysis): void {
  const source = getIPOriginalSource(id);
  if (!source) throw new Error("找不到要重新解析的IP原始内容");
  const sourceAnalysis = normalizeAnalysis(source.id, source.rawContent, analysis);
  updateKnowledgeEntry(id, {
    sourceAnalysis,
    extractedAt: analysis.analyzedAt,
    // 不允许在重新解析时写入rawContent。
  });
  const persisted = getIPOriginalSource(id);
  if (persisted?.sourceAnalysis?.analyzedAt !== analysis.analyzedAt) {
    throw new Error("解析结果更新失败，Source原文未受影响");
  }
}
