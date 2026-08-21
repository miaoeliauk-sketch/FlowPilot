import { NextRequest, NextResponse } from "next/server";

import {
  activateScriptDirectorRuleOnServer,
} from "@/lib/script-director-rule-activation-registry";
import {
  calculateScriptDirectorRuleContentHash,
  parseScriptDirectorRule,
} from "@/lib/script-director-rule";
import {
  createScriptDirectorRuleActivationProof,
  getScriptDirectorRuleProofSecret,
  verifyScriptDirectorRuleTestProof,
} from "@/lib/script-director-rule-proof";
import { isMigratedShuimuranDirectorRule } from "@/lib/shuimuran-director-rule-migration";

const TEST_TYPES = ["familiar", "unfamiliar", "stress"] as const;
const MAX_RULE_CHARS = 50_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(error: string, field?: string) {
  return NextResponse.json({
    error,
    ...(field ? { errorField: field } : {}),
    apiMeta: { apiCalled: false },
  }, { status: 400 });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return invalid("请求格式错误");
  }
  if (!isRecord(body) || typeof body.ipId !== "string" || !body.ipId.trim()) {
    return invalid("请求格式错误", "ipId");
  }
  const parsed = parseScriptDirectorRule(body.rule);
  if (!parsed.ok) return invalid("专属规则结构不完整，无法启用", "rule");
  const rule = parsed.rule;
  if (rule.ipId !== body.ipId) return invalid("专属规则不属于当前IP，已拒绝启用", "rule.ipId");
  if (rule.source.type === "built_in" && !isMigratedShuimuranDirectorRule({
    ipId: rule.ipId,
    ipName: rule.profileContext.ipNameSnapshot,
    rule,
  })) {
    return invalid("内置规则身份无法核实，已拒绝启用", "rule.source.type");
  }
  if (rule.source.rawMarkdown.length > MAX_RULE_CHARS) {
    return invalid(`专属规则原文最多${MAX_RULE_CHARS}字`, "rule.source.rawMarkdown");
  }
  if (calculateScriptDirectorRuleContentHash(rule.source.rawMarkdown) !== rule.source.contentHash) {
    return invalid("专属规则原文与哈希不一致，已拒绝启用", "rule.source.contentHash");
  }
  const proofs = rule.testValidation?.proofs;
  if (!proofs) return invalid("专属编导规则测试凭证无效，请重新完成三类测试", "rule.testValidation.proofs");

  let secret: string;
  try {
    secret = await getScriptDirectorRuleProofSecret();
  } catch {
    return NextResponse.json({
      error: "专属编导规则验证服务暂不可用，请稍后重试",
      apiMeta: { apiCalled: false },
    }, { status: 500 });
  }
  const valid = TEST_TYPES.every(testType => verifyScriptDirectorRuleTestProof(proofs[testType], {
    ipId: rule.ipId,
    ruleId: rule.id,
    contentHash: rule.source.contentHash,
    testType,
  }, secret));
  if (!valid) return invalid("专属编导规则测试凭证无效，请重新完成三类测试", "rule.testValidation.proofs");

  const active = activateScriptDirectorRuleOnServer({
    ipId: rule.ipId,
    ruleId: rule.id,
    contentHash: rule.source.contentHash,
  });
  return NextResponse.json({
    activationProof: createScriptDirectorRuleActivationProof({
      ipId: rule.ipId,
      ruleId: rule.id,
      contentHash: rule.source.contentHash,
      activationId: active.activationId,
    }, secret),
    apiMeta: { apiCalled: false },
  });
}
