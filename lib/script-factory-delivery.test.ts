import assert from "node:assert/strict";
import test from "node:test";
import { getScriptDeliveryBlockReason } from "./script-factory-delivery";

function completedAuditDetails(auditVersion: string) {
  return {
    auditSessionId: `session-${auditVersion}`,
    coverageAssessment: {
      coverage: "FULL",
      reason: "核心判断和推理过程均有来源。",
      coveredDimensions: ["核心判断", "推理过程"],
      missingDimensions: [],
      sourceReferences: [],
      caseNeed: "NOT_NEEDED",
      caseReason: "当前内容不依赖案例。",
    },
    attributionAudit: {
      outputStatus: "formal",
      confidenceLevel: "high",
      coveredDimensions: ["核心判断", "推理过程"],
      missingDimensions: [],
      recommendation: "观点与推理均有来源。",
      auditStatus: "completed",
      paragraphAttributions: [],
    },
  };
}

test("出处审计待处理、不可用或命中问题时阻止跨页面交付", () => {
  assert.match(getScriptDeliveryBlockReason({ generationMode: "ip", postGenerationAuditStatus: "pending" }) ?? "", /审计/);
  assert.match(getScriptDeliveryBlockReason({ generationMode: "ip", postGenerationAuditStatus: "unavailable" }) ?? "", /审计/);
  assert.match(getScriptDeliveryBlockReason({
    generationMode: "ip",
    postGenerationAuditStatus: "completed",
    sourceIntegrityAudit: { status: "needs_review", deliveryBlocked: true, issues: [{}] },
  }) ?? "", /未通过/);
});

test("出处审计声称通过但问题列表非空时仍然阻止交付", () => {
  assert.match(getScriptDeliveryBlockReason({
    generationMode: "ip",
    postGenerationAuditStatus: "completed",
    auditVersion: "audit-contradictory-source-v1",
    sourceIntegrityAudit: {
      status: "passed",
      deliveryBlocked: false,
      issues: [{
        code: "responsibility_subject_distortion",
        sectionIndex: 0,
        paragraphIndex: 0,
        excerpt: "这是一条仍有出处问题的正文。",
        sourceReferences: [{ sourceId: "source-1", itemId: "claim-1" }],
        reason: "正文改变了原始责任主体。",
      }],
    },
    factAudit: { overallStatus: "not_checked", systemVerified: false, pendingItems: [], caseEvidence: null },
    deliveryGate: {
      status: "OPEN",
      auditVersion: "audit-contradictory-source-v1",
      blockerCodes: [],
      pendingItemIds: [],
    },
  }) ?? "", /未通过|矛盾|问题/);
});

test("出处审计完整通过后允许交付", () => {
  assert.equal(getScriptDeliveryBlockReason({
    generationMode: "ip",
    postGenerationAuditStatus: "completed",
    auditVersion: "audit-v1",
    ...completedAuditDetails("audit-v1"),
    sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
    factAudit: { overallStatus: "not_checked", systemVerified: false, pendingItems: [], caseEvidence: null },
    deliveryGate: {
      status: "OPEN",
      auditVersion: "audit-v1",
      blockerCodes: [],
      pendingItemIds: [],
    },
  }), null);
  assert.equal(getScriptDeliveryBlockReason({ generationMode: "standard" }), null);
});

test("只声称审计完成但缺少会话、覆盖度或段落归属明细时不得交付", () => {
  assert.match(getScriptDeliveryBlockReason({
    generationMode: "ip",
    postGenerationAuditStatus: "completed",
    auditVersion: "audit-incomplete-completed-v1",
    sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
    factAudit: { overallStatus: "not_checked", systemVerified: false, pendingItems: [], caseEvidence: null },
    deliveryGate: {
      status: "OPEN",
      auditVersion: "audit-incomplete-completed-v1",
      blockerCodes: [],
      pendingItemIds: [],
    },
  }) ?? "", /审计.*不完整|明细/);
});

test("高风险无依据具体陈述缺少对应事实待办时不得交付", () => {
  const auditVersion = "audit-missing-specific-claim-item-v1";
  assert.match(getScriptDeliveryBlockReason({
    generationMode: "ip",
    postGenerationAuditStatus: "completed",
    auditVersion,
    auditSessionId: "session-missing-specific-claim-item",
    coverageAssessment: {
      coverage: "NONE",
      reason: "没有找到输入依据。",
      coveredDimensions: [],
      missingDimensions: ["核心判断"],
      sourceReferences: [],
      caseNeed: "NOT_ASSESSED",
      caseReason: "需要人工核对。",
    },
    attributionAudit: {
      outputStatus: "exploratory",
      confidenceLevel: "low",
      coveredDimensions: [],
      missingDimensions: ["核心判断"],
      recommendation: "请人工核对具体陈述。",
      auditStatus: "completed",
      paragraphAttributions: [{
        sectionIndex: 0,
        paragraphIndex: 0,
        excerpt: "我见过一家企业因此损失了三百万元。",
        attributionType: "ai_reasoning",
        reasoningSubtype: "unsupported_specific_claim",
        sourceReferences: [],
        reason: "输入素材没有提供这段具体经历和数据。",
      }],
    },
    sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
    factAudit: { overallStatus: "not_checked", systemVerified: false, pendingItems: [], caseEvidence: null },
    deliveryGate: {
      status: "OPEN",
      auditVersion,
      blockerCodes: [],
      pendingItemIds: [],
    },
  }) ?? "", /待核验|传导|具体陈述|矛盾/);
});

test("综合交付门禁阻断时即使出处审计通过也禁止复制和跨页面交付", () => {
  assert.match(getScriptDeliveryBlockReason({
    generationMode: "ip",
    postGenerationAuditStatus: "completed",
    sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
    factAudit: {
      overallStatus: "pending",
      systemVerified: false,
      pendingItems: [{
        id: "pending-1",
        sectionIndex: 0,
        paragraphIndex: 0,
        subtype: "unsupported_specific_claim",
        excerpt: "一条仍需人工判断的具体陈述。",
        reason: "输入素材没有提供对应依据。",
        resolutionStatus: "PENDING",
      }],
      caseEvidence: null,
    },
    deliveryGate: {
      status: "BLOCKED",
      auditVersion: "audit-v1",
      blockerCodes: ["UNRESOLVED_UNSUPPORTED_SPECIFIC_CLAIM"],
      pendingItemIds: ["pending-1"],
    },
  }) ?? "", /待核验|门禁/);
});

test("事实待核验项包含未知处理状态时默认阻断交付", () => {
  assert.match(getScriptDeliveryBlockReason({
    generationMode: "ip",
    postGenerationAuditStatus: "completed",
    auditVersion: "audit-unknown-resolution-v1",
    sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
    factAudit: {
      overallStatus: "pending",
      systemVerified: false,
      pendingItems: [{
        id: "pending-unknown-resolution",
        sectionIndex: 0,
        paragraphIndex: 0,
        subtype: "unsupported_specific_claim",
        excerpt: "一条状态损坏的待核验陈述。",
        reason: "处理状态未知。",
        resolutionStatus: "UNKNOWN",
      }],
      caseEvidence: null,
    },
    deliveryGate: {
      status: "OPEN",
      auditVersion: "audit-unknown-resolution-v1",
      blockerCodes: [],
      pendingItemIds: [],
    },
  }) ?? "", /待核验|异常|门禁/);
});

test("事实审计声称仍待核验但没有对应待办明细时默认阻断交付", () => {
  assert.match(getScriptDeliveryBlockReason({
    generationMode: "ip",
    postGenerationAuditStatus: "completed",
    auditVersion: "audit-contradictory-fact-v1",
    sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
    factAudit: {
      overallStatus: "pending",
      systemVerified: false,
      pendingItems: [],
      caseEvidence: {
        title: "未核实案例",
        content: "一条没有完成核实的人工案例。",
        sourceType: "用户提供",
        verificationStatus: "未经系统核验",
      },
    },
    deliveryGate: {
      status: "OPEN",
      auditVersion: "audit-contradictory-fact-v1",
      blockerCodes: [],
      pendingItemIds: [],
    },
  }) ?? "", /待核验|矛盾|异常/);
});

test("事实审计总状态必须由案例或待办明细真实支撑", () => {
  const base = {
    generationMode: "ip",
    postGenerationAuditStatus: "completed",
    auditVersion: "audit-fact-summary-v1",
    sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
    deliveryGate: {
      status: "OPEN",
      auditVersion: "audit-fact-summary-v1",
      blockerCodes: [],
      pendingItemIds: [],
    },
  };
  const resolvedItem = {
    id: "resolved-1",
    sectionIndex: 0,
    paragraphIndex: 0,
    subtype: "unsupported_specific_claim",
    excerpt: "一条已经由人工决定放行的具体陈述。",
    reason: "输入素材没有提供对应依据。",
    resolutionStatus: "CONFIRMED_ALLOWED",
  };

  assert.match(getScriptDeliveryBlockReason({
    ...base,
    factAudit: {
      overallStatus: "not_checked",
      systemVerified: false,
      pendingItems: [resolvedItem],
      caseEvidence: null,
    },
  }) ?? "", /矛盾|异常/);
  assert.match(getScriptDeliveryBlockReason({
    ...base,
    factAudit: {
      overallStatus: "user_confirmed",
      systemVerified: false,
      pendingItems: [],
      caseEvidence: null,
    },
  }) ?? "", /矛盾|异常/);
});

test("v1.3交付门禁只有明确OPEN才允许交付，缺失、损坏或未知状态一律关闭", () => {
  const passedAudit = {
    generationMode: "ip",
    postGenerationAuditStatus: "completed",
    auditVersion: "audit-v1",
    ...completedAuditDetails("audit-v1"),
    sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
    factAudit: { overallStatus: "not_checked", systemVerified: false, pendingItems: [], caseEvidence: null },
  };

  assert.match(getScriptDeliveryBlockReason(passedAudit) ?? "", /门禁/);
  assert.match(getScriptDeliveryBlockReason({ ...passedAudit, deliveryGate: "damaged" }) ?? "", /门禁/);
  assert.match(getScriptDeliveryBlockReason({
    ...passedAudit,
    deliveryGate: { status: "UNKNOWN" },
  }) ?? "", /门禁/);
  assert.match(getScriptDeliveryBlockReason({
    ...passedAudit,
    deliveryGate: { status: "OPEN" },
  }) ?? "", /门禁/);
  assert.match(getScriptDeliveryBlockReason({
    ...passedAudit,
    deliveryGate: {
      status: "OPEN",
      auditVersion: "audit-old",
      blockerCodes: [],
      pendingItemIds: [],
    },
  }) ?? "", /门禁|版本/);
  assert.match(getScriptDeliveryBlockReason({
    ...passedAudit,
    auditVersion: "   ",
    deliveryGate: {
      status: "OPEN",
      auditVersion: "   ",
      blockerCodes: [],
      pendingItemIds: [],
    },
  }) ?? "", /门禁|版本/);
  assert.equal(getScriptDeliveryBlockReason({
    ...passedAudit,
    deliveryGate: {
      status: "OPEN",
      auditVersion: "audit-v1",
      blockerCodes: [],
      pendingItemIds: [],
    },
  }), null);
});

test("水木然终审明确失败或未完成时阻止交付", () => {
  const passedAudit = {
    generationMode: "ip",
    outputMode: "shuimuran-confirmed",
    postGenerationAuditStatus: "completed",
    sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
  };
  assert.match(getScriptDeliveryBlockReason({
    ...passedAudit,
    qualityCheck: { status: "needs_review", warnings: [{ code: "shuimuran_review_failed" }] },
  }) ?? "", /终审/);
  assert.match(getScriptDeliveryBlockReason({
    ...passedAudit,
    qualityCheck: { status: "needs_review", warnings: [{ code: "shuimuran_review_unavailable" }] },
  }) ?? "", /终审/);
});

test("普通论证复核未完成不会冒充水木然终审未完成", () => {
  assert.equal(getScriptDeliveryBlockReason({
    generationMode: "ip",
    outputMode: "shuimuran-confirmed",
    postGenerationAuditStatus: "completed",
    auditVersion: "audit-v1",
    ...completedAuditDetails("audit-v1"),
    sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
    factAudit: { overallStatus: "not_checked", systemVerified: false, pendingItems: [], caseEvidence: null },
    deliveryGate: {
      status: "OPEN",
      auditVersion: "audit-v1",
      blockerCodes: [],
      pendingItemIds: [],
    },
    qualityCheck: { status: "unavailable", warnings: [] },
  }), null);
});
