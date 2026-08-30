import assert from "node:assert/strict";
import test from "node:test";
import { applyManualScriptRewrite } from "./script-factory-manual-rewrite";

const OUTLINE = [{
  label: "冲突判断",
  timeRange: "0—30秒",
  content: "第一段保留。\n当事人自己的说法前后矛盾。",
  subPoints: [],
}];

test("用户可以对当前审计问题手动替换一次，并留下版本记录", () => {
  const result = applyManualScriptRewrite({
    outline: OUTLINE,
    auditVersion: "audit-v1",
    previousRewrite: null,
    target: {
      sectionIndex: 0,
      paragraphIndex: 1,
      excerpt: "当事人自己的说法前后矛盾。",
    },
    action: "replace",
    replacement: "外部资料对这段说法提出了质疑。",
    deleteConfirmed: false,
    appliedAt: "2026-08-30T10:00:00.000Z",
  });

  assert.equal(result.outline[0]?.content, "第一段保留。\n外部资料对这段说法提出了质疑。");
  assert.deepEqual(result.rewrite, {
    auditVersion: "audit-v1",
    action: "replace",
    sectionIndex: 0,
    paragraphIndex: 1,
    originalExcerpt: "当事人自己的说法前后矛盾。",
    appliedAt: "2026-08-30T10:00:00.000Z",
  });
});

test("删除正文前必须明确确认并展示的原文必须仍与当前正文一致", () => {
  assert.throws(() => applyManualScriptRewrite({
    outline: OUTLINE,
    auditVersion: "audit-v1",
    previousRewrite: null,
    target: { sectionIndex: 0, paragraphIndex: 1, excerpt: "当事人自己的说法前后矛盾。" },
    action: "delete",
    replacement: "",
    deleteConfirmed: false,
  }), /删除前必须再次确认/);

  assert.throws(() => applyManualScriptRewrite({
    outline: OUTLINE,
    auditVersion: "audit-v1",
    previousRewrite: null,
    target: { sectionIndex: 0, paragraphIndex: 1, excerpt: "已经过期的原文" },
    action: "delete",
    replacement: "",
    deleteConfirmed: true,
  }), /待处理原文已经变化/);
});

test("同一份脚本完成一次人工处理后不得再次进入系统重写循环", () => {
  assert.throws(() => applyManualScriptRewrite({
    outline: OUTLINE,
    auditVersion: "audit-v2",
    previousRewrite: {
      auditVersion: "audit-v1",
      action: "replace",
      sectionIndex: 0,
      paragraphIndex: 1,
      originalExcerpt: "当事人自己的说法前后矛盾。",
      appliedAt: "2026-08-30T10:00:00.000Z",
    },
    target: { sectionIndex: 0, paragraphIndex: 1, excerpt: "当事人自己的说法前后矛盾。" },
    action: "replace",
    replacement: "再次替换。",
    deleteConfirmed: false,
  }), /已经使用过一次人工处理机会/);
});

test("删除段落只删除用户确认的原文，其他段落保持不变", () => {
  const result = applyManualScriptRewrite({
    outline: OUTLINE,
    auditVersion: "audit-v1",
    previousRewrite: null,
    target: { sectionIndex: 0, paragraphIndex: 1, excerpt: "当事人自己的说法前后矛盾。" },
    action: "delete",
    replacement: "",
    deleteConfirmed: true,
  });

  assert.equal(result.outline[0]?.content, "第一段保留。");
  assert.equal(result.rewrite.action, "delete");
});
