import { NextRequest, NextResponse } from "next/server";

import type { AssociationAuditReport } from "./cognition-association-audit";
import type { VerifiedCognitionSources } from "./ip-cognition-source-verification";
import type { CognitionNodeV2 } from "./types";

const MAX_SOURCES = 50;

interface CognitionAuditDependencies {
  verifySources: (sources: unknown[], activeIPId: string) => Promise<VerifiedCognitionSources>;
  runAudit: (
    input: string,
    candidates: CognitionNodeV2[],
  ) => Promise<AssociationAuditReport>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function securityFailure() {
  return NextResponse.json({
    error: "认知来源凭证无效或已失效",
    code: "SECURITY_VALIDATION_FAILED",
  }, { status: 403 });
}

export function createCognitionAuditPost(dependencies: CognitionAuditDependencies) {
  return async function POST(request: NextRequest) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
    }
    if (!isRecord(body)) return NextResponse.json({ error: "请求格式错误" }, { status: 400 });

    const activeIPId = typeof body.activeIPId === "string" ? body.activeIPId.trim() : "";
    const input = typeof body.input === "string" ? body.input.trim() : "";
    const sources = Array.isArray(body.sources) ? body.sources : null;
    const rawCandidateNodeIds = body.candidateNodeIds;
    const candidateNodeIds = rawCandidateNodeIds === undefined
      ? null
      : Array.isArray(rawCandidateNodeIds)
        ? rawCandidateNodeIds.map(id => typeof id === "string" ? id.trim() : "")
        : null;
    if (!activeIPId || !input || input.length > 500
      || !sources || sources.length === 0 || sources.length > MAX_SOURCES
      || (rawCandidateNodeIds !== undefined && (
        !candidateNodeIds
        || candidateNodeIds.length === 0
        || candidateNodeIds.some(id => !id)
        || new Set(candidateNodeIds).size !== candidateNodeIds.length
      ))) {
      return NextResponse.json({ error: "关联审计请求不完整或超出限制" }, { status: 400 });
    }

    try {
      const verified = await dependencies.verifySources(sources, activeIPId);
      if (!verified.ok) return securityFailure();

      const auditScope = candidateNodeIds ? "subset" as const : "full" as const;
      const requestedNodeIds = candidateNodeIds ? new Set(candidateNodeIds) : null;
      const verifiedNodeIds = new Set(verified.nodes.map(node => node.id));
      if (requestedNodeIds && [...requestedNodeIds].some(id => !verifiedNodeIds.has(id))) {
        return securityFailure();
      }
      const candidates = requestedNodeIds
        ? verified.nodes.filter(node => requestedNodeIds.has(node.id))
        : verified.nodes;
      if (candidates.length === 0) {
        return NextResponse.json({ error: "没有可用于关联审计的人工确认认知" }, { status: 400 });
      }

      const report = await dependencies.runAudit(input, candidates);
      return NextResponse.json({ ...report, auditScope });
    } catch {
      return NextResponse.json({
        error: "关联审计失败，请重试",
        code: "ASSOCIATION_AUDIT_FAILED",
      }, { status: 502 });
    }
  };
}
