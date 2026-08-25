import {
  calculateIPSourceContextDigest,
  digestIPSourceFinalProofClaims,
  digestIPSourceLegacyProofClaims,
  getIPSourceAnalysisProofSecret,
  readVerifiedIPSourceFinalProof,
  readVerifiedIPSourceLegacyProof,
} from "./ip-source-analysis-proof";
import {
  getIPSourceLedgerRecord,
  verifyFinalizedIPSourceLedger,
  verifyLegacyIPSourceLedger,
} from "./ip-source-ledger";
import type { ScriptFactoryIPSourceContextItem } from "./script-factory-source-context";
import type { IPSourceAnalysisItem } from "./types";

export async function verifyScriptFactoryIPSourceContext(
  items: ScriptFactoryIPSourceContextItem[],
  currentIPId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const claimedV1SourceIds = [...new Set(
    items.filter(item => item.parserVersion === 1).map(item => item.sourceId),
  )];
  for (const sourceId of claimedV1SourceIds) {
    if ((await getIPSourceLedgerRecord(sourceId))?.kind === "v2") {
      return { ok: false, error: "V2认知不能伪装成旧版数据，已拒绝生成。" };
    }
  }
  if (items.some(item => item.parserVersion === 1 && !item.legacyProof?.trim())) {
    return { ok: false, error: "历史V1认知尚未完成合规登记，已拒绝生成。" };
  }
  const secret = await getIPSourceAnalysisProofSecret();
  const v1Items = items.filter(item => item.parserVersion === 1);
  for (const sourceId of claimedV1SourceIds) {
    const sourceItems = v1Items.filter(item => item.sourceId === sourceId);
    const proofs = [...new Set(sourceItems.map(item => item.legacyProof))];
    if (proofs.length !== 1 || !proofs[0]) {
      return { ok: false, error: "同一份历史V1认知的迁移凭证不一致，已拒绝生成。" };
    }
    const claims = readVerifiedIPSourceLegacyProof(proofs[0], secret);
    if (!claims || claims.ipId !== currentIPId || claims.sourceId !== sourceId) {
      return { ok: false, error: "历史V1认知迁移凭证无效或不属于当前IP，已拒绝生成。" };
    }
    const contextItems: IPSourceAnalysisItem[] = sourceItems.map(item => ({
      id: item.itemId,
      kind: item.kind,
      content: item.content,
      sourceId: item.sourceId,
      startPosition: 0,
      endPosition: item.originalExcerpt.length,
      originalExcerpt: item.originalExcerpt,
      extractionStatus: item.extractionStatus,
    }));
    if (calculateIPSourceContextDigest(contextItems) !== claims.contextDigest) {
      return { ok: false, error: "历史V1认知内容与迁移凭证不一致，已拒绝生成。" };
    }
    if (!await verifyLegacyIPSourceLedger({
      sourceId,
      ipId: currentIPId,
      digest: digestIPSourceLegacyProofClaims(claims),
    })) {
      return { ok: false, error: "历史V1认知迁移凭证已失效，已拒绝生成。" };
    }
  }

  const v2Items = items.filter(item => item.parserVersion === 2);
  const sourceIds = [...new Set(v2Items.map(item => item.sourceId))];
  for (const sourceId of sourceIds) {
    const sourceItems = v2Items.filter(item => item.sourceId === sourceId);
    const proofs = [...new Set(sourceItems.map(item => item.finalProof))];
    if (proofs.length !== 1 || !proofs[0]) {
      return { ok: false, error: "同一份V2认知的最终凭证不一致，已拒绝生成。" };
    }
    const claims = readVerifiedIPSourceFinalProof(proofs[0], secret);
    if (!claims || claims.ipId !== currentIPId || claims.sourceId !== sourceId) {
      return { ok: false, error: "V2认知最终凭证无效或不属于当前IP，已拒绝生成。" };
    }
    const contextItems: IPSourceAnalysisItem[] = sourceItems.map(item => ({
      id: item.itemId,
      kind: item.kind,
      content: item.content,
      sourceId: item.sourceId,
      startPosition: 0,
      endPosition: item.originalExcerpt.length,
      originalExcerpt: item.originalExcerpt,
      extractionStatus: item.extractionStatus,
    }));
    if (calculateIPSourceContextDigest(contextItems) !== claims.contextDigest) {
      return { ok: false, error: "V2认知内容与最终凭证不一致，已拒绝生成。" };
    }
    const ledgerVerified = await verifyFinalizedIPSourceLedger({
      sourceId,
      ipId: currentIPId,
      nonce: claims.nonce,
      digest: claims.analysisDigest,
      finalDigest: digestIPSourceFinalProofClaims(claims),
    });
    if (!ledgerVerified) {
      return { ok: false, error: "V2认知最终凭证已失效，已拒绝生成。" };
    }
  }
  return { ok: true };
}
