import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGlobalBlockingConstraint,
  selectActiveGlobalBlockingConstraints,
  transitionGlobalBlockingConstraint,
} from "./global-content-constraint-contract";

function activeRuleFixture() {
  return {
    schemaVersion: 1,
    ruleId: "global-constraint-emotional-coercion",
    sourceKnowledgeEntryId: "knowledge-expression-motive",
    scope: "all_ips",
    category: "通用禁用规则",
    priority: "global_baseline",
    enforcement: "block",
    status: "active",
    title: "禁止利用无力感进行情绪绑架",
    canonicalText: "判断对象是表达动机，不是具体词汇。允许反差、悬念和适度焦虑。禁止利用受众的无力感进行情绪操纵，迫使其被动接受或行动。",
    prohibitedIntent: "利用受众的无力感进行情绪操纵，迫使其被动接受或行动",
    allowedBoundaries: ["反差", "悬念", "适度焦虑"],
    detection: {
      type: "keyword",
      matchMode: "any",
      terms: ["你没有选择", "再不行动就来不及了"],
    },
    humanConfirmation: {
      confirmedBy: "彭彭",
      confirmedAt: "2026-08-29T14:00:00.000Z",
    },
    revision: 1,
    createdAt: "2026-08-29T14:00:00.000Z",
    updatedAt: "2026-08-29T14:00:00.000Z",
  };
}

test("已人工确认的通用禁用规则可解析为跨IP强制拦截规则", () => {
  const input = activeRuleFixture();

  assert.deepEqual(parseGlobalBlockingConstraint(input), input);
});

test("契约拒绝单一IP范围和本期未开放的语义检测器", () => {
  assert.throws(
    () => parseGlobalBlockingConstraint({ ...activeRuleFixture(), scope: "single_ip" }),
    /scope必须为all_ips/,
  );
  assert.throws(
    () => parseGlobalBlockingConstraint({
      ...activeRuleFixture(),
      detection: { type: "semantic", model: "deepseek" },
    }),
    /detection只支持keyword/,
  );
});

test("字段缺失、伪造优先级和不可执行规则不能进入状态管理", () => {
  const cases: Array<{ value: unknown; message: RegExp }> = [
    { value: { ...activeRuleFixture(), schemaVersion: 2 }, message: /schemaVersion必须为1/ },
    { value: { ...activeRuleFixture(), category: "IP禁用规则" }, message: /category必须为通用禁用规则/ },
    { value: { ...activeRuleFixture(), priority: "ip_specific" }, message: /priority必须为global_baseline/ },
    { value: { ...activeRuleFixture(), enforcement: "warn" }, message: /enforcement必须为block/ },
    { value: { ...activeRuleFixture(), title: "  " }, message: /title不能为空/ },
    { value: { ...activeRuleFixture(), revision: 0 }, message: /revision必须是正整数/ },
    {
      value: { ...activeRuleFixture(), allowedBoundaries: ["反差", "反差"] },
      message: /allowedBoundaries不能包含重复项/,
    },
    {
      value: { ...activeRuleFixture(), detection: { type: "keyword", matchMode: "any", terms: [] } },
      message: /detection.terms至少包含一项/,
    },
    {
      value: {
        ...activeRuleFixture(),
        detection: { type: "keyword", matchMode: "any", terms: ["立即行动", "立即行动"] },
      },
      message: /detection.terms不能包含重复项/,
    },
    { value: { ...activeRuleFixture(), humanConfirmation: null }, message: /active规则必须经过人工确认/ },
    { value: { ...activeRuleFixture(), createdAt: "2026年8月29日" }, message: /createdAt必须是ISO时间/ },
    { value: { ...activeRuleFixture(), unexpected: true }, message: /包含未定义字段/ },
  ];

  for (const testCase of cases) {
    assert.throws(() => parseGlobalBlockingConstraint(testCase.value), testCase.message);
  }
});

test("草稿经人工确认后启用，启用规则可停用且不修改原对象", () => {
  const draft = {
    ...activeRuleFixture(),
    status: "draft",
    humanConfirmation: null,
  };

  const active = transitionGlobalBlockingConstraint(draft, {
    type: "activate",
    confirmedBy: "彭彭",
    at: "2026-08-29T15:00:00.000Z",
  });
  assert.equal(active.status, "active");
  assert.deepEqual(active.humanConfirmation, {
    confirmedBy: "彭彭",
    confirmedAt: "2026-08-29T15:00:00.000Z",
  });
  assert.equal(active.revision, 2);
  assert.equal(active.updatedAt, "2026-08-29T15:00:00.000Z");
  assert.equal(draft.status, "draft");
  assert.equal(draft.humanConfirmation, null);

  const disabled = transitionGlobalBlockingConstraint(active, {
    type: "disable",
    at: "2026-08-29T16:00:00.000Z",
  });
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.revision, 3);
  assert.equal(disabled.updatedAt, "2026-08-29T16:00:00.000Z");
  assert.deepEqual(disabled.humanConfirmation, active.humanConfirmation);
});

test("状态机拒绝重复操作、越级停用和倒退时间", () => {
  const active = activeRuleFixture();
  const draft = { ...active, status: "draft", humanConfirmation: null };
  const disabled = { ...active, status: "disabled" };

  assert.throws(
    () => transitionGlobalBlockingConstraint(active, {
      type: "activate",
      confirmedBy: "彭彭",
      at: "2026-08-29T15:00:00.000Z",
    }),
    /active规则不能重复启用/,
  );
  assert.throws(
    () => transitionGlobalBlockingConstraint(draft, {
      type: "disable",
      at: "2026-08-29T15:00:00.000Z",
    }),
    /只有active规则可以停用/,
  );
  assert.throws(
    () => transitionGlobalBlockingConstraint(disabled, {
      type: "activate",
      confirmedBy: "彭彭",
      at: "2026-08-29T17:00:00.000Z",
    }),
    /只有draft规则可以启用/,
  );
  assert.throws(
    () => transitionGlobalBlockingConstraint(active, {
      type: "deactivate",
      at: "2026-08-29T17:00:00.000Z",
    } as never),
    /状态变更类型不正确/,
  );
  assert.throws(
    () => transitionGlobalBlockingConstraint(disabled, {
      type: "disable",
      at: "2026-08-29T15:00:00.000Z",
    }),
    /只有active规则可以停用/,
  );
  assert.throws(
    () => transitionGlobalBlockingConstraint(draft, {
      type: "activate",
      confirmedBy: "彭彭",
      at: "2026-08-29T13:59:59.000Z",
    }),
    /状态变更时间不能早于当前更新时间/,
  );
  assert.throws(
    () => parseGlobalBlockingConstraint({ ...draft, humanConfirmation: active.humanConfirmation }),
    /draft规则不能携带人工确认凭证/,
  );
  assert.throws(
    () => parseGlobalBlockingConstraint({ ...disabled, humanConfirmation: null }),
    /disabled规则必须保留人工确认凭证/,
  );
});

test("契约拒绝创建、确认和更新时间顺序自相矛盾", () => {
  assert.throws(
    () => parseGlobalBlockingConstraint({
      ...activeRuleFixture(),
      updatedAt: "2026-08-29T13:59:59.000Z",
    }),
    /updatedAt不能早于createdAt/,
  );
  assert.throws(
    () => parseGlobalBlockingConstraint({
      ...activeRuleFixture(),
      humanConfirmation: {
        confirmedBy: "彭彭",
        confirmedAt: "2026-08-29T13:59:59.000Z",
      },
    }),
    /确认时间不能早于创建时间/,
  );
  assert.throws(
    () => parseGlobalBlockingConstraint({
      ...activeRuleFixture(),
      humanConfirmation: {
        confirmedBy: "彭彭",
        confirmedAt: "2026-08-29T15:00:00.000Z",
      },
    }),
    /确认时间不能晚于更新时间/,
  );
});

test("只返回active规则，任一记录损坏时整组拒绝而不是静默跳过", () => {
  const active = activeRuleFixture();
  const draft = { ...activeRuleFixture(), ruleId: "draft-rule", status: "draft", humanConfirmation: null };
  const disabled = { ...activeRuleFixture(), ruleId: "disabled-rule", status: "disabled" };

  assert.deepEqual(
    selectActiveGlobalBlockingConstraints([draft, active, disabled]).map(rule => rule.ruleId),
    [active.ruleId],
  );
  assert.throws(
    () => selectActiveGlobalBlockingConstraints([
      active,
      { ...disabled, scope: "single_ip" },
    ]),
    /scope必须为all_ips/,
  );
});
