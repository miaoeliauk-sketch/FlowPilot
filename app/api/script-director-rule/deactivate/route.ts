import { NextRequest, NextResponse } from "next/server";

import {
  deactivateScriptDirectorRuleOnServer,
  getActiveScriptDirectorRuleOnServer,
} from "@/lib/script-director-rule-activation-registry";
import {
  getScriptDirectorRuleProofSecret,
  verifyScriptDirectorRuleActivationProof,
} from "@/lib/script-director-rule-proof";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误", apiMeta: { apiCalled: false } }, { status: 400 });
  }
  if (!isRecord(body)
    || typeof body.ipId !== "string" || !body.ipId.trim()
    || typeof body.ruleId !== "string" || !body.ruleId.trim()
    || typeof body.activationProof !== "string" || !body.activationProof.trim()) {
    return NextResponse.json({ error: "请求格式错误", apiMeta: { apiCalled: false } }, { status: 400 });
  }

  try {
    const active = getActiveScriptDirectorRuleOnServer(body.ipId);
    if (!active || active.ruleId !== body.ruleId) {
      return NextResponse.json({
        error: "专属编导规则启用状态已经变化，请刷新后重试",
        apiMeta: { apiCalled: false },
      }, { status: 409 });
    }
    const secret = await getScriptDirectorRuleProofSecret();
    if (!verifyScriptDirectorRuleActivationProof(body.activationProof, {
      ipId: active.ipId,
      ruleId: active.ruleId,
      contentHash: active.contentHash,
      activationId: active.activationId,
    }, secret)) {
      return NextResponse.json({
        error: "专属编导规则启用凭证无效，已拒绝停用",
        apiMeta: { apiCalled: false },
      }, { status: 400 });
    }
    deactivateScriptDirectorRuleOnServer(body.ipId, body.ruleId, active.activationId);
    return NextResponse.json({ ok: true, apiMeta: { apiCalled: false } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "专属编导规则停用失败",
      apiMeta: { apiCalled: false },
    }, { status: 409 });
  }
}
