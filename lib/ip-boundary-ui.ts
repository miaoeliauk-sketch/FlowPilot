import { parseBoundaryReport, type BoundaryReport } from "./ip-boundary-engine";
import type { KnowledgeEntry } from "./types";

export const BOUNDARY_AUDIT_TIMEOUT_MS = 15_000;

export class BoundaryAuditTimeoutError extends Error {
  constructor() {
    super("审计响应超时，请重新审计。");
    this.name = "BoundaryAuditTimeoutError";
  }
}

export async function fetchBoundaryCheckWithTimeout({
  fetcher,
  url,
  init,
  timeoutMs = BOUNDARY_AUDIT_TIMEOUT_MS,
}: {
  fetcher: (url: string, init?: RequestInit) => Promise<Response>;
  url: string;
  init?: RequestInit;
  timeoutMs?: number;
}): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new BoundaryAuditTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetcher(url, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof BoundaryAuditTimeoutError)) {
      throw new BoundaryAuditTimeoutError();
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type BoundaryAction = "allow" | "confirm" | "intercept";

export interface BoundaryEvidenceNode {
  nodeId: string;
  relation: "matched" | "conflicting";
  verificationStatus: "human_confirmed";
  question: string;
  claim: string;
  reasoningSteps: string[];
}

export interface BoundaryCheckUIResponse {
  report: BoundaryReport;
  evidenceNodes: BoundaryEvidenceNode[];
}

export function buildBoundarySourceBundle(entries: KnowledgeEntry[], ipId: string) {
  const scopedEntries = entries.filter(entry => entry.ipId === ipId);
  const sources = scopedEntries.flatMap(entry => {
    const analysis = entry.sourceAnalysis;
    const finalProof = entry.sourceFinalProof?.trim();
    if (analysis?.parserVersion !== 2 || !finalProof) return [];
    return [{
      sourceId: entry.id,
      rawContent: entry.rawContent,
      analysis,
      finalProof,
    }];
  });
  return {
    unregisteredV1: scopedEntries.some(entry => entry.sourceAnalysis?.parserVersion === 1 && !entry.sourceLegacyProof?.trim()),
    registeredV1: scopedEntries.some(entry => entry.sourceAnalysis?.parserVersion === 1 && entry.sourceLegacyProof?.trim()),
    sources,
    nodeIds: new Set(sources.flatMap(source => source.analysis.nodes.map(node => node.id))),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseBoundaryCheckUIResponse(
  value: unknown,
  allowedNodeIds: ReadonlySet<string>,
): BoundaryCheckUIResponse | null {
  if (!isRecord(value) || !Array.isArray(value.evidenceNodes)) return null;
  let report: BoundaryReport;
  try {
    report = parseBoundaryReport(JSON.stringify(value.report), allowedNodeIds);
  } catch {
    return null;
  }
  const referencedIds = new Set([...report.matchedNodeIds, ...report.conflictingNodeIds]);
  const evidenceNodes: BoundaryEvidenceNode[] = [];
  for (const item of value.evidenceNodes) {
    if (!isRecord(item)
      || typeof item.nodeId !== "string" || !referencedIds.has(item.nodeId)
      || !(item.relation === "matched" || item.relation === "conflicting")
      || item.verificationStatus !== "human_confirmed"
      || typeof item.question !== "string" || !item.question.trim()
      || typeof item.claim !== "string" || !item.claim.trim()
      || !Array.isArray(item.reasoningSteps)
      || item.reasoningSteps.some(step => typeof step !== "string" || !step.trim())) {
      return null;
    }
    const expectedRelation = report.conflictingNodeIds.includes(item.nodeId) ? "conflicting" : "matched";
    if (item.relation !== expectedRelation) return null;
    evidenceNodes.push({
      nodeId: item.nodeId,
      relation: item.relation,
      verificationStatus: item.verificationStatus,
      question: item.question.trim(),
      claim: item.claim.trim(),
      reasoningSteps: item.reasoningSteps.map(step => step.trim()),
    });
  }
  if (evidenceNodes.length !== referencedIds.size
    || new Set(evidenceNodes.map(item => item.nodeId)).size !== evidenceNodes.length) return null;
  return { report, evidenceNodes };
}

export function decideBoundaryAction(report: BoundaryReport): BoundaryAction {
  if (report.stance === "CONFLICTING" || report.coverage === "NONE") return "intercept";
  if (report.coverage === "PARTIAL") return "confirm";
  return "allow";
}
