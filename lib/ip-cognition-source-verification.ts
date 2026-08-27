import {
  buildIPSourceAnalysisProofClaims,
  buildIPSourceFinalProofClaims,
  digestIPSourceAnalysisProofClaims,
  digestIPSourceFinalProofClaims,
  getIPSourceAnalysisProofSecret,
  verifyIPSourceFinalProof,
} from "./ip-source-analysis-proof";
import { verifyFinalizedIPSourceLedger } from "./ip-source-ledger";
import {
  parseStoredIPSourceAnalysis,
  toV1CompatibleItems,
} from "./ip-source-analysis-v2";
import type { CognitionNodeV2 } from "./types";

export type VerifiedCognitionSources =
  | { ok: true; nodes: CognitionNodeV2[] }
  | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function verifyPersistentCognitionSources(
  rawSources: unknown[],
  activeIPId: string,
): Promise<VerifiedCognitionSources> {
  const normalizedIPId = activeIPId.trim();
  if (!normalizedIPId) return { ok: false };

  const secret = await getIPSourceAnalysisProofSecret();
  const nodes: CognitionNodeV2[] = [];
  const seenNodeIds = new Set<string>();

  for (const rawSource of rawSources) {
    if (!isRecord(rawSource)) return { ok: false };
    const sourceId = typeof rawSource.sourceId === "string" ? rawSource.sourceId.trim() : "";
    const rawContent = typeof rawSource.rawContent === "string" ? rawSource.rawContent : "";
    const finalProof = typeof rawSource.finalProof === "string" ? rawSource.finalProof.trim() : "";
    if (!sourceId || !rawContent.trim() || !finalProof) return { ok: false };

    const parsed = parseStoredIPSourceAnalysis(rawSource.analysis, rawContent, sourceId);
    if (!parsed.ok || parsed.version !== 2) return { ok: false };
    const contextItems = toV1CompatibleItems(parsed.analysis);
    const finalClaims = buildIPSourceFinalProofClaims({
      ipId: normalizedIPId,
      analysis: parsed.analysis,
      contextItems,
    });
    if (!verifyIPSourceFinalProof(finalProof, finalClaims, secret)) return { ok: false };
    const analysisClaims = buildIPSourceAnalysisProofClaims({
      ipId: normalizedIPId,
      analysis: parsed.analysis,
    });
    if (!await verifyFinalizedIPSourceLedger({
      sourceId,
      ipId: normalizedIPId,
      nonce: parsed.analysis.nonce,
      digest: digestIPSourceAnalysisProofClaims(analysisClaims),
      finalDigest: digestIPSourceFinalProofClaims(finalClaims),
    })) return { ok: false };

    for (const node of parsed.analysis.nodes) {
      if (node.reviewStatus !== "human_confirmed") continue;
      if (seenNodeIds.has(node.id)) return { ok: false };
      seenNodeIds.add(node.id);
      nodes.push(node);
    }
  }
  return { ok: true, nodes };
}
