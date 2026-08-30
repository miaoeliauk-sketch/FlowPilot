import assert from "node:assert/strict";
import test from "node:test";
import { getScriptDeliveryBlockReason } from "./script-factory-delivery";

test("出处审计待处理、不可用或命中问题时阻止跨页面交付", () => {
  assert.match(getScriptDeliveryBlockReason({ generationMode: "ip", postGenerationAuditStatus: "pending" }) ?? "", /审计/);
  assert.match(getScriptDeliveryBlockReason({ generationMode: "ip", postGenerationAuditStatus: "unavailable" }) ?? "", /审计/);
  assert.match(getScriptDeliveryBlockReason({
    generationMode: "ip",
    postGenerationAuditStatus: "completed",
    sourceIntegrityAudit: { status: "needs_review", deliveryBlocked: true, issues: [{}] },
  }) ?? "", /未通过/);
});

test("出处审计完整通过后允许交付", () => {
  assert.equal(getScriptDeliveryBlockReason({
    generationMode: "ip",
    postGenerationAuditStatus: "completed",
    sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
  }), null);
  assert.equal(getScriptDeliveryBlockReason({ generationMode: "standard" }), null);
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
    sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
    qualityCheck: { status: "unavailable", warnings: [] },
  }), null);
});
