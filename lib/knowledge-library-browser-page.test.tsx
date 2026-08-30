import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import type { IPProfile, KnowledgeEntry } from "./types";

const activeIP: IPProfile = {
  id: "ip-library-a",
  name: "知识老师",
  avatar: "知",
  positioning: "知识内容创作者",
  platforms: ["视频号"],
  audience: "知识内容用户",
  contentDirection: ["知识分享"],
  personaKeywords: ["专业"],
  professionalIdentity: "内容创作者",
  personalityTags: ["克制"],
  credibilitySource: "长期实践",
  representativeViewpoints: ["真实经验优先"],
  tone: "清晰",
  commonOpenings: [],
  commonClosings: [],
  catchphrases: [],
  forbiddenExpressions: [],
  pacing: "层层递进",
  commonScenes: [],
  commonShotTypes: [],
  showsFace: true,
  usesScreenRecording: false,
  needsBroll: false,
  needsCaseScreenshots: false,
  needsSubtitleHighlight: true,
  sampleViralTitles: [],
  styleNotes: "",
  bio: "",
  color: "#639922",
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
};
const otherIP: IPProfile = {
  ...activeIP,
  id: "ip-library-b",
  name: "另一位老师",
  avatar: "另",
};

function entry(
  id: string,
  title: string,
  ipId: string | null,
  overrides: Partial<KnowledgeEntry> = {},
): KnowledgeEntry {
  return {
    id,
    category: "文案框架方法库",
    title,
    rawContent: `${title}的摘要正文`,
    sourceKind: null,
    sourceName: "",
    sourceAnalysis: null,
    tags: [],
    keywords: [],
    ipId,
    sourceTier: "中",
    sourceTierReason: "测试来源",
    contentDirection: [],
    sourcePlatform: "",
    sourceUrl: "",
    note: "",
    createdAt: "2026-08-23T00:00:00.000Z",
    extractedAt: null,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    trustStatus: null,
    sourceReference: null,
    dna: null,
    ...overrides,
  };
}

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/knowledge-hub",
    pretendToBeVisual: true,
  });
  const browserGlobals: Record<string, unknown> = {
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    indexedDB: { open: () => ({}) },
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  };
  Object.defineProperty(dom.window.navigator, "locks", {
    configurable: true,
    value: {
      request: async (_name: string, operation: () => unknown) => operation(),
    },
  });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(browserGlobals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return () => {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  };
}

let restoreBrowser: (() => void) | undefined;

before(() => { restoreBrowser = installBrowserEnvironment(); });

beforeEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/knowledge-hub");
  localStorage.clear();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([activeIP, otherIP]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(activeIP.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    entry("current-method", "反常识开头方法", activeIP.id, {
      category: "开头方法库",
      tags: ["认知冲突"],
      trustStatus: "ai_derived_unverified",
      sourceReference: {
        sourceType: "hot_analysis",
        analysisId: "analysis-a",
        role: "method_card",
        groupItemId: "method-1",
      },
    }),
    entry("global-case", "全局爆款案例", null, {
      category: "爆款案例",
      sourcePlatform: "抖音",
    }),
    entry("other-private", "其他IP私有知识", otherIP.id),
  ]));
  localStorage.setItem("ipwr:scriptAssets", JSON.stringify([]));
  localStorage.setItem("ipwr:videoReviews", JSON.stringify([]));
});

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
});

after(() => restoreBrowser?.());

test("知识中心默认使用只读浏览并支持搜索和组合筛选", async () => {
  const stored = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as unknown[];
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    ...stored.slice(0, 2),
    {
      ...entry("other-private", "其他IP私有知识", otherIP.id),
      category: "未知损坏分类",
      tags: [null],
    },
  ]));
  const { render, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const user = userEvent.setup({ document });
  const view = render(
    <IPProvider>
      <KnowledgeHubPage />
    </IPProvider>,
  );

  await view.findByRole("heading", { name: "知识浏览" });
  assert.ok(view.getByText("反常识开头方法"));
  assert.ok(view.getByText("全局爆款案例"));
  assert.equal(view.queryByText("其他IP私有知识"), null);
  const cards = view.getAllByTestId("knowledge-browser-card");
  const methodCard = cards.find(card => card.textContent?.includes("反常识开头方法"))!;
  const globalCard = cards.find(card => card.textContent?.includes("全局爆款案例"))!;
  assert.ok(within(methodCard).getByText("AI拆解，尚未验证"));
  assert.ok(within(methodCard).getByText("来源：爆款分析拆解的方法卡"));
  assert.ok(within(methodCard).getByText("当前IP：知识老师"));
  assert.ok(within(globalCard).getByText("通用知识"));

  await user.type(view.getByRole("searchbox", { name: "搜索知识" }), "认知冲突");
  assert.ok(view.getByText("反常识开头方法"));
  assert.equal(view.queryByText("全局爆款案例"), null);

  await user.clear(view.getByRole("searchbox", { name: "搜索知识" }));
  await user.selectOptions(view.getByLabelText("按分类筛选"), "开头方法库");
  await user.selectOptions(view.getByLabelText("按可信度筛选"), "ai_derived_unverified");
  await user.selectOptions(view.getByLabelText("按来源筛选"), "hot_analysis_method");
  assert.deepEqual(view.getAllByTestId("knowledge-browser-card").map(node => node.textContent?.includes("反常识开头方法")), [true]);
});

test("知识库独立治理入口通过服务端固定正文和一次性挑战确认且不改写旧方法卡", async () => {
  const fullRuleText = [
    "判断对象是表达动机，不是具体词汇。",
    "允许反差、悬念和适度焦虑。",
    "禁止利用受众的无力感进行情绪操纵，迫使其被动接受或行动。",
  ].join("\n");
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    entry("knowledge-emotional-coercion", "表达动机判断法（旧方法卡）", null, {
      category: "开头方法库",
      rawContent: fullRuleText,
      sourcePlatform: "智能入库助手",
      trustStatus: "ai_derived_unverified",
    }),
  ]));
  const proposal = {
    proposalId: "emotional-coercion-v2",
    ruleId: "global-constraint-emotional-coercion-v2",
    title: "禁止利用无力感进行情绪绑架",
    canonicalText: fullRuleText,
    prohibitedIntent: "利用受众的无力感进行情绪操纵，迫使其被动接受或行动",
    traceabilityStandards: [],
    applicableScopes: ["所有IP的脚本生成"],
    priorityRedlines: ["不得利用受众的无力感迫使其行动"],
    prohibitedScenarios: [],
    allowedBoundaries: ["反差", "悬念", "适度焦虑", "引用", "批判", "合理语境"],
    runtimePositioning: "明确高风险表达召回＋人工判断语境",
    detectionTerms: ["被时代抛弃", "阶级固化"],
    activationMode: "active_on_confirmation",
    confirmationAcknowledgement: "我已逐字核对并确认启用",
  };
  let confirmed = false;
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    requests.push({ url, method, body });
    if (url === "/api/global-content-constraint/proposals" && method === "GET") {
      return new Response(JSON.stringify({
        proposals: [{
          proposal,
          confirmationStatus: confirmed ? "active" : "pending_confirmation",
          runtimeStatus: confirmed ? "active" : "detection_pending",
          rule: confirmed ? { ruleId: proposal.ruleId, status: "active", canonicalText: fullRuleText } : null,
          sourceFacts: confirmed ? { sourceType: "user_confirmed", confirmedBy: "彭彭" } : null,
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "/api/global-content-constraint/challenge" && method === "POST") {
      return new Response(JSON.stringify({
        challengeId: "challenge-for-ui-test",
        challenge: "fake-challenge-for-test",
        expiresAt: "2026-08-29T12:02:00.000Z",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "/api/global-content-constraint/confirm" && method === "POST") {
      confirmed = true;
      return new Response(JSON.stringify({
        rule: { ruleId: proposal.ruleId, status: "active", canonicalText: fullRuleText },
        sourceFacts: { sourceType: "user_confirmed", confirmedBy: "彭彭" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
  };
  const { render, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const user = userEvent.setup({ document });
  try {
    const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);

    const oldCard = await view.findByRole("button", { name: "查看表达动机判断法（旧方法卡）详情" });
    assert.ok(oldCard);
    await user.click(await view.findByRole("button", { name: "查看待确认V2强制底线" }));
    const dialog = await view.findByRole("dialog", { name: "通用禁用规则人工确认" });
    assert.ok(await within(dialog).findByText("待确认V2强制底线"));
    assert.match(dialog.textContent ?? "", /判断对象是表达动机，不是具体词汇/);
    assert.match(dialog.textContent ?? "", /禁止利用受众的无力感进行情绪操纵/);
    assert.equal(within(dialog).queryByLabelText("规则全文"), null);
    assert.equal(within(dialog).queryByLabelText("确认名称（本设备自述）"), null);

    await user.click(within(dialog).getByRole("checkbox", { name: /我已逐字核对服务端固定的规则全文/ }));
    await user.click(within(dialog).getByRole("button", { name: "确认并启用为所有IP强制底线" }));

    assert.ok(await within(dialog).findByText("服务端已严格回读：这条规则现已对所有IP生效"));
    const challengeCall = requests.find(request => request.url.endsWith("/challenge"));
    const confirmCall = requests.find(request => request.url.endsWith("/confirm"));
    assert.deepEqual(challengeCall?.body, { proposalId: "emotional-coercion-v2" });
    assert.deepEqual(Object.keys(confirmCall?.body ?? {}).sort(), [
      "acknowledgement",
      "challenge",
      "challengeId",
      "confirmedBy",
      "idempotencyKey",
      "proposalId",
    ]);
    assert.equal(localStorage.getItem("ipwr:global_blocking_constraints_v2"), null);
    const storedKnowledge = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as KnowledgeEntry[];
    assert.equal(storedKnowledge[0]?.rawContent, fullRuleText);
    assert.equal(storedKnowledge[0]?.trustStatus, "ai_derived_unverified");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("知识库治理入口列出多条服务端提案并逐字确认不可溯源事实规则", async () => {
  const newRuleText = [
    "【核心判断】",
    "禁止将未经验证、来源不明或超出原始证据的信息，以确定事实、真实案例、精确数据、直接引语或IP亲历的形式对外输出。",
    "",
    "【可溯源标准】",
    "1. 系统内部必须能够追溯到具体的原始资料、原文段落或用户确认记录。",
    "",
    "【适用范围】",
    "1. 选题、标题、封面文案、口播脚本、图文正文和发布文案。",
    "",
    "【四项最高优先级红线】",
    "1. IP本人经历",
    "2. 客户案例",
    "3. 业绩数据",
    "4. 权威引语",
    "",
    "【典型禁止场景】",
    "1. 无依据地写出具体比例、金额、人数、增长率或调查结论。",
    "",
    "【允许边界】",
    "1. 明确标注为“假设”“示例”或“虚构情境”的内容。",
  ].join("\n");
  const emotionalProposal = {
    proposalId: "emotional-coercion-v2",
    ruleId: "global-constraint-emotional-coercion-v2",
    title: "禁止利用无力感进行情绪绑架",
    canonicalText: "判断对象是表达动机，不是具体词汇。",
    prohibitedIntent: "禁止利用受众的无力感进行情绪操纵",
    traceabilityStandards: [],
    applicableScopes: ["所有IP的脚本生成"],
    priorityRedlines: ["不得利用无力感迫使行动"],
    prohibitedScenarios: [],
    allowedBoundaries: ["反差", "悬念"],
    runtimePositioning: "明确高风险表达召回＋人工判断语境",
    detectionTerms: ["被时代抛弃"],
    activationMode: "active_on_confirmation",
    confirmationAcknowledgement: "我已逐字核对并确认启用",
  };
  const newProposal = {
    proposalId: "untraceable-facts-v1",
    ruleId: "global-constraint-untraceable-facts-v1",
    title: "禁止编造不可溯源的事实",
    canonicalText: newRuleText,
    prohibitedIntent: "禁止把未经验证的信息作为确定事实对外输出",
    traceabilityStandards: ["系统内部必须能追溯到具体依据"],
    applicableScopes: ["选题、标题、脚本和发布文案"],
    priorityRedlines: ["IP本人经历", "客户案例", "业绩数据", "权威引语"],
    prohibitedScenarios: ["无依据地写出精确数据"],
    allowedBoundaries: ["明确标注为假设、示例或虚构情境"],
    runtimePositioning: "高风险事实召回＋人工核验来源",
    detectionTerms: null,
    activationMode: "confirmed_pending_detection",
    confirmationAcknowledgement: "我已逐字核对并确认规则内容，检测范围待配置",
  };
  let confirmed = false;
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    requests.push({ url, method, body });
    if (url === "/api/global-content-constraint/proposals" && method === "GET") {
      return new Response(JSON.stringify({
        proposals: [
          {
            proposal: emotionalProposal,
            confirmationStatus: "active",
            runtimeStatus: "active",
            rule: { ruleId: emotionalProposal.ruleId, status: "active", canonicalText: emotionalProposal.canonicalText },
            sourceFacts: { sourceType: "user_confirmed", confirmedBy: "彭彭" },
          },
          {
            proposal: newProposal,
            confirmationStatus: confirmed ? "confirmed_pending_detection" : "pending_confirmation",
            runtimeStatus: "detection_pending",
            rule: null,
            sourceFacts: confirmed ? { sourceType: "user_confirmed", confirmedBy: "彭彭" } : null,
          },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "/api/global-content-constraint/challenge" && method === "POST") {
      return new Response(JSON.stringify({
        challengeId: "challenge-for-untraceable-facts",
        challenge: "fake-challenge-for-test",
        expiresAt: "2026-08-30T12:02:00.000Z",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "/api/global-content-constraint/confirm" && method === "POST") {
      confirmed = true;
      return new Response(JSON.stringify({
        confirmationStatus: "confirmed_pending_detection",
        runtimeStatus: "detection_pending",
        proposal: newProposal,
        rule: null,
        sourceFacts: { sourceType: "user_confirmed", confirmedBy: "彭彭" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
  };

  const { render, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const user = userEvent.setup({ document });
  try {
    const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);
    await user.click(await view.findByRole("button", { name: "查看待确认V2强制底线" }));
    const dialog = await view.findByRole("dialog", { name: "通用禁用规则人工确认" });

    assert.ok(await within(dialog).findByRole("button", { name: /禁止利用无力感进行情绪绑架.*已启用/ }));
    const newRuleButton = await within(dialog).findByRole("button", { name: /禁止编造不可溯源的事实.*待确认/ });
    await user.click(newRuleButton);
    assert.match(dialog.textContent ?? "", /【核心判断】/);
    assert.match(dialog.textContent ?? "", /【四项最高优先级红线】/);
    assert.match(dialog.textContent ?? "", /IP本人经历/);
    assert.match(dialog.textContent ?? "", /高风险事实召回＋人工核验来源/);
    assert.match(dialog.textContent ?? "", /检测词和召回范围尚未配置/);
    assert.equal(within(dialog).queryByLabelText("规则全文"), null);

    await user.click(within(dialog).getByRole("checkbox", { name: /我已逐字核对服务端固定的规则全文/ }));
    await user.click(within(dialog).getByRole("button", { name: "确认规则内容并登记" }));

    assert.ok(await within(dialog).findByText("规则内容已确认，检测范围待配置"));
    const challengeCall = requests.find(request => request.url.endsWith("/challenge"));
    const confirmCall = requests.find(request => request.url.endsWith("/confirm"));
    assert.deepEqual(challengeCall?.body, { proposalId: "untraceable-facts-v1" });
    assert.deepEqual(Object.keys(confirmCall?.body ?? {}).sort(), [
      "acknowledgement",
      "challenge",
      "challengeId",
      "confirmedBy",
      "idempotencyKey",
      "proposalId",
    ]);
    assert.equal(
      confirmCall?.body?.acknowledgement,
      "我已逐字核对并确认规则内容，检测范围待配置",
    );
    assert.equal(confirmCall?.body?.canonicalText, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("知识浏览每页显示12条并支持页码、上一页下一页和直接跳转", async () => {
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify(
    Array.from({ length: 26 }, (_, index) => entry(
      `paged-${index + 1}`,
      `分页知识${String(index + 1).padStart(2, "0")}`,
      activeIP.id,
    )),
  ));
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);

  await view.findByText("分页知识01");
  assert.equal(view.getAllByTestId("knowledge-browser-card").length, 12);
  assert.equal(view.queryByText("分页知识13"), null);
  assert.equal(view.getByRole("button", { name: "第1页" }).getAttribute("aria-current"), "page");

  await user.click(view.getByRole("button", { name: "下一页" }));
  assert.ok(await view.findByText("分页知识13"));
  assert.equal(view.queryByText("分页知识01"), null);
  assert.equal(view.getByRole("button", { name: "第2页" }).getAttribute("aria-current"), "page");

  await user.clear(view.getByRole("spinbutton", { name: "跳转页码" }));
  await user.type(view.getByRole("spinbutton", { name: "跳转页码" }), "3");
  await user.click(view.getByRole("button", { name: "跳转" }));
  assert.ok(await view.findByText("分页知识25"));
  assert.equal(view.getAllByTestId("knowledge-browser-card").length, 2);
  assert.equal(view.getByRole("button", { name: "下一页" }).hasAttribute("disabled"), true);

  await user.click(view.getByRole("button", { name: "上一页" }));
  assert.ok(await view.findByText("分页知识13"));
});

test("删除当前末页唯一一条知识后自动退回有效页", async () => {
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify(
    Array.from({ length: 13 }, (_, index) => entry(
      `delete-page-${index + 1}`,
      `待分页删除知识${String(index + 1).padStart(2, "0")}`,
      activeIP.id,
    )),
  ));
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);

  await view.findByText("待分页删除知识01");
  await user.click(view.getByRole("button", { name: "第2页" }));
  await user.click(await view.findByRole("button", { name: "查看待分页删除知识13详情" }));
  await user.click(view.getByRole("button", { name: "删除知识" }));
  await user.click(view.getByRole("button", { name: "确认删除这条知识" }));

  assert.ok(await view.findByText("待分页删除知识01"));
  assert.equal(view.queryByText("待分页删除知识13"), null);
  assert.equal(view.getByRole("button", { name: "第1页" }).getAttribute("aria-current"), "page");
  assert.equal((view.getByRole("spinbutton", { name: "跳转页码" }) as HTMLInputElement).value, "1");
});

test("修改搜索或筛选条件后自动回到第1页", async () => {
  const entries = Array.from({ length: 25 }, (_, index) => entry(
    `reset-filter-${index + 1}`,
    `筛选分页知识${String(index + 1).padStart(2, "0")}`,
    activeIP.id,
    index === 24 ? { category: "开头方法库" } : {},
  ));
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify(entries));
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);

  await view.findByText("筛选分页知识01");
  await user.click(view.getByRole("button", { name: "第2页" }));
  await user.type(view.getByRole("searchbox", { name: "搜索知识" }), "筛选分页知识01");
  assert.ok(await view.findByText("筛选分页知识01"));
  assert.equal(view.getByRole("button", { name: "第1页" }).getAttribute("aria-current"), "page");

  await user.clear(view.getByRole("searchbox", { name: "搜索知识" }));
  await user.click(view.getByRole("button", { name: "第2页" }));
  await user.selectOptions(view.getByLabelText("按分类筛选"), "开头方法库");
  assert.ok(await view.findByText("筛选分页知识25"));
  assert.equal(view.getByRole("button", { name: "第1页" }).getAttribute("aria-current"), "page");
  assert.equal((view.getByRole("spinbutton", { name: "跳转页码" }) as HTMLInputElement).value, "1");
});

test("切换IP后分页状态回到第1页", async () => {
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    ...Array.from({ length: 25 }, (_, index) => entry(
      `switch-a-${index + 1}`,
      `IP A分页知识${String(index + 1).padStart(2, "0")}`,
      activeIP.id,
    )),
    ...Array.from({ length: 13 }, (_, index) => entry(
      `switch-b-${index + 1}`,
      `IP B分页知识${String(index + 1).padStart(2, "0")}`,
      otherIP.id,
    )),
  ]));
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider, useIP } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const user = userEvent.setup({ document });

  function SwitchIP() {
    const { switchIP } = useIP();
    return <button onClick={() => switchIP(otherIP.id)}>切换到IP B并重置分页</button>;
  }

  const view = render(
    <IPProvider>
      <SwitchIP />
      <KnowledgeHubPage />
    </IPProvider>,
  );
  await view.findByText("IP A分页知识01");
  await user.click(view.getByRole("button", { name: "第2页" }));
  assert.ok(await view.findByText("IP A分页知识13"));

  await user.click(view.getByRole("button", { name: "切换到IP B并重置分页" }));
  assert.ok(await view.findByText("IP B分页知识01"));
  assert.equal(view.queryByText("IP B分页知识13"), null);
  assert.equal(view.getByRole("button", { name: "第1页" }).getAttribute("aria-current"), "page");
  assert.equal((view.getByRole("spinbutton", { name: "跳转页码" }) as HTMLInputElement).value, "1");
});

test("原有新增导入和专项库能力保留在次级管理入口", async () => {
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const user = userEvent.setup({ document });
  const view = render(
    <IPProvider>
      <KnowledgeHubPage />
    </IPProvider>,
  );

  await view.findByRole("heading", { name: "知识浏览" });
  await user.click(view.getByRole("button", { name: "管理知识库" }));
  assert.ok(await view.findByText("通用知识库"));
  assert.ok(view.getByText("历史专项库："));
  assert.ok(view.getByRole("link", { name: /新增知识/ }));
  assert.ok(view.getByRole("button", { name: /从 Excel 批量导入/ }));

  await user.click(view.getByRole("button", { name: /通用禁用规则/ }));
  assert.ok(view.getByText("所有IP都必须遵守的内容底线、价值观红线和禁止使用的表达动机。"));
  assert.ok(view.getByText("你可以添加所有IP都必须遵守的内容底线、价值观红线和禁止使用的表达动机。"));
});

test("管理知识库的旧删除入口也必须先确认，取消时不删除", async () => {
  const previousConfirm = window.confirm;
  let confirmMessage = "";
  Object.defineProperty(window, "confirm", {
    configurable: true,
    value: (message?: string) => {
      confirmMessage = message ?? "";
      return false;
    },
  });
  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);

    await user.click(await view.findByRole("button", { name: "管理知识库" }));
    await user.click(view.getByRole("button", { name: "爆款案例" }));
    await user.click(view.getByRole("button", { name: "删除知识「全局爆款案例」" }));
    assert.match(confirmMessage, /全局爆款案例/);
    assert.match(confirmMessage, /通用知识/);
    assert.match(confirmMessage, /脚本和复盘不会被删除/);
    const persisted = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{ id: string }>;
    assert.ok(persisted.some(item => item.id === "global-case"));
  } finally {
    Object.defineProperty(window, "confirm", { configurable: true, value: previousConfirm });
  }
});

test("切换IP过程中不会把旧知识短暂显示成新IP归属", async () => {
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    entry("knowledge-a", "IP A私有知识", activeIP.id),
    entry("knowledge-b", "IP B私有知识", otherIP.id),
  ]));
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider, useIP } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const user = userEvent.setup({ document });

  function SwitchIP() {
    const { switchIP } = useIP();
    return <button onClick={() => switchIP(otherIP.id)}>切换到IP B</button>;
  }

  const view = render(
    <IPProvider>
      <SwitchIP />
      <KnowledgeHubPage />
    </IPProvider>,
  );
  await view.findByText("IP A私有知识");
  let observedFalseOwnership = false;
  const observer = new MutationObserver(() => {
    const text = document.body.textContent ?? "";
    if (text.includes("IP A私有知识") && text.includes("当前IP：另一位老师")) {
      observedFalseOwnership = true;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  try {
    await user.click(view.getByRole("button", { name: "切换到IP B" }));
    await view.findByText("IP B私有知识");
  } finally {
    observer.disconnect();
  }

  assert.equal(observedFalseOwnership, false);
  assert.equal(view.queryByText("IP A私有知识"), null);
});

test("知识详情展示原始来源、真实证据和历史未验证记录但不替用户下结论", async () => {
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    entry("detail-method", "可追溯方法卡", activeIP.id, {
      rawContent: "方法卡完整原文。",
      trustStatus: "ai_derived_unverified",
      sourceReference: {
        sourceType: "hot_analysis",
        analysisId: "analysis-detail",
        role: "method_card",
        groupItemId: "method-1",
      },
      usageRecords: [
        {
          id: "legacy-detail",
          module: "脚本工厂",
          usedAt: "2025-01-01T00:00:00.000Z",
          reason: "旧记录无法核验",
          relevanceTier: "中度相关",
          relevanceReason: "历史数据",
          context: "旧脚本",
          trackingStatus: "legacy_unverified",
          topicId: null,
          scriptId: null,
          reviewId: null,
          usageType: null,
          sectionLabel: null,
          evidenceExcerpt: null,
        },
        {
          id: "trusted-detail",
          module: "脚本工厂",
          usedAt: "2026-08-23T01:00:00.000Z",
          reason: "最终正文真实采用",
          relevanceTier: "高度相关",
          relevanceReason: "正文存在证据",
          context: "生成脚本",
          trackingStatus: "script_adopted",
          topicId: "topic-detail",
          scriptId: "script-detail",
          reviewId: "review-detail",
          usageType: "structure",
          sectionLabel: "开头",
          evidenceExcerpt: "真实采用片段",
        },
      ],
    }),
    entry("detail-case", "来源完整案例", activeIP.id, {
      category: "爆款案例",
      rawContent: "爆款分析保存的完整案例原文。",
      sourceReference: {
        sourceType: "hot_analysis",
        analysisId: "analysis-detail",
        role: "viral_case",
        groupItemId: "case-1",
      },
    }),
  ]));
  localStorage.setItem("ipwr:scriptAssets", JSON.stringify([{
    id: "script-detail",
    ipId: activeIP.id,
    topicId: "topic-detail",
    title: "真实采用脚本",
    cover: "",
    content: "真实采用片段",
    status: "定稿",
    knowledgeTracking: {
      status: "verified",
      candidateKnowledgeEntryIds: ["detail-method"],
      verifiedAt: "2026-08-23T01:00:00.000Z",
      usages: [{
        knowledgeEntryId: "detail-method",
        usageType: "structure",
        sectionLabel: "开头",
        evidenceExcerpt: "真实采用片段",
        reason: "最终正文真实采用",
      }],
    },
    createdAt: "2026-08-23T01:00:00.000Z",
  }]));
  localStorage.setItem("ipwr:videoReviews", JSON.stringify([{
    id: "review-detail",
    ipId: activeIP.id,
    title: "真实发布复盘",
    platform: "视频号",
    publishedAt: "2026-08-24",
    videoUrl: "https://example.com/video",
    contentDirection: "知识",
    topicId: "topic-detail",
    scriptId: "script-detail",
    sourceType: "flowpilot",
    traceabilityStatus: "traceable",
    knowledgeEffectStatus: "tracked",
    scriptText: "真实采用片段",
    metrics: { views: 1200, likes: 88, comments: 12, favorites: 30, shares: 9, newFollowers: 6, dms: 2, leads: 1, conversions: 0 },
    analysis: null,
    savedToKnowledge: false,
    knowledgeEntryId: null,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    manualReviewStatus: "completed",
    manualReviewTags: ["标题结构有效"],
    manualReviewNote: "发布数据已人工复盘。",
  }]));

  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);

  await user.click(await view.findByRole("button", { name: "查看可追溯方法卡详情" }));
  const detail = await view.findByRole("dialog", { name: "知识详情：可追溯方法卡" });
  assert.match(detail.textContent ?? "", /方法卡完整原文/);
  assert.match(detail.textContent ?? "", /来源完整案例/);
  assert.match(detail.textContent ?? "", /真实采用脚本/);
  assert.match(detail.textContent ?? "", /真实发布复盘/);
  assert.match(detail.textContent ?? "", /播放1,200/);
  assert.match(detail.textContent ?? "", /历史未验证记录/);
  assert.match(detail.textContent ?? "", /旧记录无法核验/);
  assert.equal(/方法有效|方法无效|判定有效|判定无效/.test(detail.textContent ?? ""), false);
});

test("用户在知识详情看清范围和引用影响后确认删除，列表立即刷新且不级联删除脚本复盘", async () => {
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    entry("delete-method", "待删除的当前IP方法", activeIP.id, {
      usageRecords: [{
        id: "usage-delete-method",
        module: "脚本工厂",
        usedAt: "2026-08-23T01:00:00.000Z",
        reason: "正文真实采用",
        relevanceTier: "高度相关",
        relevanceReason: "正文存在证据",
        context: "生成脚本",
        trackingStatus: "script_adopted",
        topicId: "topic-delete",
        scriptId: "script-delete",
        reviewId: "review-delete",
        usageType: "structure",
        sectionLabel: "开头",
        evidenceExcerpt: "真实采用片段",
      }],
    }),
    entry("keep-global", "应保留的通用知识", null),
    entry("keep-other", "应保留的其他IP知识", otherIP.id),
  ]));
  localStorage.setItem("ipwr:scriptAssets", JSON.stringify([{
    id: "script-delete",
    ipId: activeIP.id,
    topicId: "topic-delete",
    title: "引用知识的脚本",
    cover: "",
    content: "真实采用片段",
    status: "定稿",
    knowledgeTracking: {
      status: "verified",
      candidateKnowledgeEntryIds: ["delete-method"],
      verifiedAt: "2026-08-23T01:00:00.000Z",
      usages: [{
        knowledgeEntryId: "delete-method",
        usageType: "structure",
        sectionLabel: "开头",
        evidenceExcerpt: "真实采用片段",
        reason: "正文真实采用",
      }],
    },
    createdAt: "2026-08-23T01:00:00.000Z",
  }]));
  localStorage.setItem("ipwr:videoReviews", JSON.stringify([{
    id: "review-delete",
    ipId: activeIP.id,
    title: "引用知识的复盘",
    platform: "视频号",
    publishedAt: "2026-08-24",
    videoUrl: "",
    contentDirection: "知识",
    topicId: "topic-delete",
    scriptId: "script-delete",
    sourceType: "flowpilot",
    traceabilityStatus: "traceable",
    knowledgeEffectStatus: "tracked",
    scriptText: "真实采用片段",
    metrics: null,
    analysis: null,
    savedToKnowledge: false,
    knowledgeEntryId: null,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    manualReviewStatus: "completed",
    manualReviewTags: [],
    manualReviewNote: "已复盘",
  }]));

  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);

  await user.click(await view.findByRole("button", { name: "查看待删除的当前IP方法详情" }));
  await user.click(view.getByRole("button", { name: "删除知识" }));
  const confirmation = view.getByRole("alertdialog", { name: "确认删除知识" });
  assert.match(confirmation.textContent ?? "", /待删除的当前IP方法/);
  assert.match(confirmation.textContent ?? "", /当前IP知识/);
  assert.match(confirmation.textContent ?? "", /已用于脚本1次/);
  assert.match(confirmation.textContent ?? "", /已有发布复盘1次/);
  assert.match(confirmation.textContent ?? "", /脚本和复盘不会被删除/);
  assert.equal((JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as unknown[]).length, 3);

  await user.click(view.getByRole("button", { name: "确认删除这条知识" }));
  assert.equal(view.queryByText("待删除的当前IP方法"), null);
  assert.ok(view.getByText("应保留的通用知识"));
  const storedKnowledge = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{ id: string }>;
  assert.deepEqual(storedKnowledge.map(item => item.id).sort(), ["keep-global", "keep-other"]);
  assert.equal((JSON.parse(localStorage.getItem("ipwr:scriptAssets") ?? "[]") as unknown[]).length, 1);
  assert.equal((JSON.parse(localStorage.getItem("ipwr:videoReviews") ?? "[]") as unknown[]).length, 1);
});

test("确认删除时知识归属已经变化会明确阻止且保留原数据", async () => {
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);

  await user.click(await view.findByRole("button", { name: "查看反常识开头方法详情" }));
  await user.click(view.getByRole("button", { name: "删除知识" }));
  const stored = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as KnowledgeEntry[];
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify(stored.map(item =>
    item.id === "current-method" ? { ...item, ipId: otherIP.id } : item
  )));

  await user.click(view.getByRole("button", { name: "确认删除这条知识" }));
  assert.match((await view.findByRole("alert")).textContent ?? "", /知识归属已经变化/);
  const persisted = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as KnowledgeEntry[];
  assert.equal(persisted.find(item => item.id === "current-method")?.ipId, otherIP.id);
  assert.ok(view.getByRole("dialog", { name: "知识详情：反常识开头方法" }));
});

test("确认删除时知识库数据已损坏会明确反馈且不把损坏状态覆盖成空库", async () => {
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);

  await user.click(await view.findByRole("button", { name: "查看反常识开头方法详情" }));
  await user.click(view.getByRole("button", { name: "删除知识" }));
  localStorage.setItem("ipwr:knowledgeEntries", "{损坏的旧数据");

  await user.click(view.getByRole("button", { name: "确认删除这条知识" }));
  assert.match((await view.findByRole("alert")).textContent ?? "", /知识库数据已损坏/);
  assert.equal(localStorage.getItem("ipwr:knowledgeEntries"), "{损坏的旧数据");
  assert.ok(view.getByRole("dialog", { name: "知识详情：反常识开头方法" }));
});

test("通用知识的删除确认统计所有IP的真实脚本和复盘引用", async () => {
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    entry("global-used", "被其他IP采用的通用知识", null, {
      usageRecords: [{
        id: "usage-global-other",
        module: "脚本工厂",
        usedAt: "2026-08-23T01:00:00.000Z",
        reason: "正文真实采用",
        relevanceTier: "高度相关",
        relevanceReason: "正文存在证据",
        context: "生成脚本",
        trackingStatus: "script_adopted",
        topicId: "topic-other",
        scriptId: "script-other",
        reviewId: "review-other",
        usageType: "structure",
        sectionLabel: "开头",
        evidenceExcerpt: "真实采用片段",
      }],
    }),
  ]));
  localStorage.setItem("ipwr:scriptAssets", JSON.stringify([{
    id: "script-other",
    ipId: otherIP.id,
    topicId: "topic-other",
    title: "其他IP引用脚本",
    cover: "",
    content: "真实采用片段",
    status: "定稿",
    knowledgeTracking: {
      status: "verified",
      candidateKnowledgeEntryIds: ["global-used"],
      verifiedAt: "2026-08-23T01:00:00.000Z",
      usages: [{
        knowledgeEntryId: "global-used",
        usageType: "structure",
        sectionLabel: "开头",
        evidenceExcerpt: "真实采用片段",
        reason: "正文真实采用",
      }],
    },
    createdAt: "2026-08-23T01:00:00.000Z",
  }]));
  localStorage.setItem("ipwr:videoReviews", JSON.stringify([{
    id: "review-other",
    ipId: otherIP.id,
    title: "其他IP发布复盘",
    platform: "视频号",
    publishedAt: "2026-08-24",
    videoUrl: "",
    contentDirection: "知识",
    topicId: "topic-other",
    scriptId: "script-other",
    sourceType: "flowpilot",
    traceabilityStatus: "traceable",
    knowledgeEffectStatus: "tracked",
    scriptText: "真实采用片段",
    metrics: null,
    analysis: null,
    savedToKnowledge: false,
    knowledgeEntryId: null,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    manualReviewStatus: "completed",
    manualReviewTags: [],
    manualReviewNote: "已复盘",
  }]));

  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);

  await user.click(await view.findByRole("button", { name: "查看被其他IP采用的通用知识详情" }));
  const detail = view.getByRole("dialog", { name: "知识详情：被其他IP采用的通用知识" });
  assert.equal((detail.textContent ?? "").includes("其他IP引用脚本"), false);
  assert.equal((detail.textContent ?? "").includes("其他IP发布复盘"), false);
  await user.click(view.getByRole("button", { name: "删除知识" }));
  const confirmation = view.getByRole("alertdialog", { name: "确认删除知识" });
  assert.match(confirmation.textContent ?? "", /已用于脚本1次/);
  assert.match(confirmation.textContent ?? "", /已有发布复盘1次/);
});

for (const damagedStore of ["ipwr:scriptAssets", "ipwr:videoReviews"] as const) {
  test(`${damagedStore}损坏时阻止删除且不覆盖知识数据`, async () => {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);

    await user.click(await view.findByRole("button", { name: "查看反常识开头方法详情" }));
    await user.click(view.getByRole("button", { name: "删除知识" }));
    localStorage.setItem(damagedStore, "{损坏的数据");
    await user.click(view.getByRole("button", { name: "确认删除这条知识" }));

    assert.match((await view.findByRole("alert")).textContent ?? "", /数据已损坏/);
    const persisted = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{ id: string }>;
    assert.ok(persisted.some(item => item.id === "current-method"));
  });
}

test("复盘库存在结构残缺记录时阻止删除且不覆盖知识数据", async () => {
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);

  await user.click(await view.findByRole("button", { name: "查看反常识开头方法详情" }));
  await user.click(view.getByRole("button", { name: "删除知识" }));
  localStorage.setItem("ipwr:videoReviews", JSON.stringify([{
    id: "broken-review",
    createdAt: "2026-08-25T00:00:00.000Z",
  }]));
  await user.click(view.getByRole("button", { name: "确认删除这条知识" }));

  assert.match((await view.findByRole("alert")).textContent ?? "", /数据已损坏/);
  const persisted = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{ id: string }>;
  assert.ok(persisted.some(item => item.id === "current-method"));
});

test("删除锁内重新读取最新知识，保留另一标签页刚新增的数据", async () => {
  const { deleteKnowledgeEntryFromLibrary } = await import("./ip-store");
  const locksDescriptor = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (_name: string, operation: () => unknown) => {
        const latest = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as KnowledgeEntry[];
        localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
          ...latest,
          entry("concurrent-new", "另一标签页新知识", activeIP.id),
        ]));
        return operation();
      },
    },
  });
  try {
    await deleteKnowledgeEntryFromLibrary({
      id: "current-method",
      activeIPId: activeIP.id,
      expectedIPId: activeIP.id,
    });
    const persisted = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{ id: string }>;
    assert.ok(persisted.some(item => item.id === "concurrent-new"));
    assert.equal(persisted.some(item => item.id === "current-method"), false);
  } finally {
    if (locksDescriptor) Object.defineProperty(navigator, "locks", locksDescriptor);
    else Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  }
});

test("旧口播样本删除入口需要确认且不能跨IP删除", async () => {
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    entry("voice-other", "其他IP口播样本", otherIP.id, {
      category: "IP语料库",
      tags: ["口播逐字稿"],
    }),
  ]));
  const previousConfirm = window.confirm;
  const previousAlert = window.alert;
  let confirmMessage = "";
  let alertMessage = "";
  Object.defineProperty(window, "confirm", {
    configurable: true,
    value: (message?: string) => {
      confirmMessage = message ?? "";
      return true;
    },
  });
  Object.defineProperty(window, "alert", {
    configurable: true,
    value: (message?: string) => { alertMessage = message ?? ""; },
  });
  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);

    await user.click(await view.findByRole("button", { name: "管理知识库" }));
    await user.click(view.getByRole("button", { name: "IP口播" }));
    await user.click(view.getByRole("button", { name: "删除口播样本「其他IP口播样本」" }));

    assert.match(confirmMessage, /其他IP口播样本/);
    assert.match(confirmMessage, /删除后不会删除已有脚本和复盘/);
    assert.match(alertMessage, /不属于当前IP/);
    const persisted = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{ id: string }>;
    assert.ok(persisted.some(item => item.id === "voice-other"));
  } finally {
    Object.defineProperty(window, "confirm", { configurable: true, value: previousConfirm });
    Object.defineProperty(window, "alert", { configurable: true, value: previousAlert });
  }
});

test("脚本或复盘数据损坏时普通知识浏览仍安全返回可见知识", async () => {
  const { loadKnowledgeLibrarySnapshot } = await import("./knowledge-library-view");

  for (const damagedStore of ["ipwr:scriptAssets", "ipwr:videoReviews"] as const) {
    localStorage.setItem("ipwr:scriptAssets", JSON.stringify([]));
    localStorage.setItem("ipwr:videoReviews", JSON.stringify([]));
    localStorage.setItem(damagedStore, "{损坏的数据");

    const snapshot = loadKnowledgeLibrarySnapshot(activeIP.id);

    assert.ok(snapshot.items.some(item => item.id === "current-method"));
    assert.ok(snapshot.items.some(item => item.id === "global-case"));
  }
});

test("知识已经删除但列表刷新失败时明确提示删除已完成", async () => {
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);

  await user.click(await view.findByRole("button", { name: "查看反常识开头方法详情" }));
  await user.click(view.getByRole("button", { name: "删除知识" }));

  const storage = localStorage;
  const originalGetItem = storage.getItem.bind(storage);
  const originalSetItem = storage.setItem.bind(storage);
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let knowledgeWritten = false;
  let knowledgeReadsAfterWrite = 0;
  const failingStorage = {
    get length() { return storage.length; },
    clear: () => storage.clear(),
    key: (index: number) => storage.key(index),
    removeItem: (key: string) => storage.removeItem(key),
    setItem: (key: string, value: string) => {
      originalSetItem(key, value);
      if (key === "ipwr:knowledgeEntries" && !value.includes("current-method")) {
        knowledgeWritten = true;
      }
    },
    getItem: (key: string) => {
      if (key === "ipwr:knowledgeEntries" && knowledgeWritten) {
        knowledgeReadsAfterWrite += 1;
        if (knowledgeReadsAfterWrite === 2) throw new Error("模拟列表刷新失败");
      }
      return originalGetItem(key);
    },
  } satisfies Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: failingStorage,
  });
  try {
    await user.click(view.getByRole("button", { name: "确认删除这条知识" }));

    assert.match((await view.findByRole("alert")).textContent ?? "", /知识已删除.*列表刷新失败/);
    const persisted = JSON.parse(originalGetItem("ipwr:knowledgeEntries") ?? "[]") as Array<{ id: string }>;
    assert.equal(persisted.some(item => item.id === "current-method"), false);
  } finally {
    if (localStorageDescriptor) {
      Object.defineProperty(globalThis, "localStorage", localStorageDescriptor);
    } else {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  }
});

test("口播样本删除使用独立路径且不受脚本或复盘损坏影响", async () => {
  const voiceSample = entry("voice-independent", "独立口播样本", activeIP.id, {
    category: "IP语料库",
    tags: ["口播逐字稿"],
  });
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([voiceSample]));
  localStorage.setItem("ipwr:scriptAssets", "{损坏的脚本库");
  localStorage.setItem("ipwr:videoReviews", "{损坏的复盘库");
  const { deleteVoiceSample } = await import("./ip-store");

  await deleteVoiceSample({
    id: voiceSample.id,
    activeIPId: activeIP.id,
    expectedIPId: activeIP.id,
  });

  const persisted = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{ id: string }>;
  assert.equal(persisted.some(item => item.id === voiceSample.id), false);
});

test("知识库存在重复编号时严格拒绝删除且不改写原数据", async () => {
  const duplicateA = entry("duplicate-id", "重复知识A", activeIP.id);
  const duplicateB = entry("duplicate-id", "重复知识B", activeIP.id);
  const original = JSON.stringify([duplicateA, duplicateB]);
  localStorage.setItem("ipwr:knowledgeEntries", original);
  const { deleteKnowledgeEntryFromLibrary } = await import("./ip-store");

  await assert.rejects(
    deleteKnowledgeEntryFromLibrary({
      id: "duplicate-id",
      activeIPId: activeIP.id,
      expectedIPId: activeIP.id,
    }),
    /重复编号/,
  );
  assert.equal(localStorage.getItem("ipwr:knowledgeEntries"), original);
});

test("知识删除写入失败时明确报错且保留原数据", async () => {
  const originalStorage = localStorage;
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const original = originalStorage.getItem("ipwr:knowledgeEntries");
  const failingStorage = {
    get length() { return originalStorage.length; },
    clear: () => originalStorage.clear(),
    getItem: (key: string) => originalStorage.getItem(key),
    key: (index: number) => originalStorage.key(index),
    removeItem: (key: string) => originalStorage.removeItem(key),
    setItem: (key: string, value: string) => {
      if (key === "ipwr:knowledgeEntries") throw new Error("模拟写入失败");
      originalStorage.setItem(key, value);
    },
  } satisfies Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: failingStorage,
  });
  try {
    const { deleteKnowledgeEntryFromLibrary } = await import("./ip-store");
    await assert.rejects(
      deleteKnowledgeEntryFromLibrary({
        id: "current-method",
        activeIPId: activeIP.id,
        expectedIPId: activeIP.id,
      }),
      /知识删除失败/,
    );
    assert.equal(originalStorage.getItem("ipwr:knowledgeEntries"), original);
  } finally {
    if (originalDescriptor) Object.defineProperty(globalThis, "localStorage", originalDescriptor);
    else delete (globalThis as Record<string, unknown>).localStorage;
  }
});

test("浏览器不支持安全锁时拒绝删除且保留原数据", async () => {
  const locksDescriptor = Object.getOwnPropertyDescriptor(navigator, "locks");
  const original = localStorage.getItem("ipwr:knowledgeEntries");
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: undefined,
  });
  try {
    const { deleteKnowledgeEntryFromLibrary } = await import("./ip-store");
    await assert.rejects(
      deleteKnowledgeEntryFromLibrary({
        id: "current-method",
        activeIPId: activeIP.id,
        expectedIPId: activeIP.id,
      }),
      /不支持安全删除知识/,
    );
    assert.equal(localStorage.getItem("ipwr:knowledgeEntries"), original);
  } finally {
    if (locksDescriptor) Object.defineProperty(navigator, "locks", locksDescriptor);
    else Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  }
});

test("单条脚本的知识追踪结构损坏时严格拒绝删除", async () => {
  const original = localStorage.getItem("ipwr:knowledgeEntries");
  localStorage.setItem("ipwr:scriptAssets", JSON.stringify([{
    id: "script-broken-tracking",
    ipId: activeIP.id,
    topicId: "topic-broken-tracking",
    title: "追踪结构损坏的脚本",
    cover: "",
    content: "正文可能引用了知识",
    status: "定稿",
    knowledgeTracking: {
      status: "verified",
      candidateKnowledgeEntryIds: ["current-method"],
      verifiedAt: "2026-08-23T01:00:00.000Z",
      usages: [{
        knowledgeEntryId: "current-method",
        usageType: "非法类型",
      }],
    },
    createdAt: "2026-08-23T01:00:00.000Z",
  }]));
  const { deleteKnowledgeEntryFromLibrary } = await import("./ip-store");

  await assert.rejects(
    deleteKnowledgeEntryFromLibrary({
      id: "current-method",
      activeIPId: activeIP.id,
      expectedIPId: activeIP.id,
    }),
    /脚本库数据已损坏/,
  );
  assert.equal(localStorage.getItem("ipwr:knowledgeEntries"), original);
});

test("严格写入已回读确认后不因多余读取失败误报删除失败", async () => {
  const originalStorage = localStorage;
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let knowledgeWritten = false;
  let readsAfterWrite = 0;
  const unstableStorage = {
    get length() { return originalStorage.length; },
    clear: () => originalStorage.clear(),
    key: (index: number) => originalStorage.key(index),
    removeItem: (key: string) => originalStorage.removeItem(key),
    setItem: (key: string, value: string) => {
      originalStorage.setItem(key, value);
      if (key === "ipwr:knowledgeEntries" && !value.includes("current-method")) {
        knowledgeWritten = true;
      }
    },
    getItem: (key: string) => {
      if (key === "ipwr:knowledgeEntries" && knowledgeWritten) {
        readsAfterWrite += 1;
        if (readsAfterWrite === 2) throw new Error("模拟写入确认后的多余读取失败");
      }
      return originalStorage.getItem(key);
    },
  } satisfies Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: unstableStorage,
  });
  try {
    const { deleteKnowledgeEntryFromLibrary } = await import("./ip-store");
    await deleteKnowledgeEntryFromLibrary({
      id: "current-method",
      activeIPId: activeIP.id,
      expectedIPId: activeIP.id,
    });
    const persisted = JSON.parse(originalStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{ id: string }>;
    assert.equal(persisted.some(item => item.id === "current-method"), false);
  } finally {
    if (originalDescriptor) Object.defineProperty(globalThis, "localStorage", originalDescriptor);
    else delete (globalThis as Record<string, unknown>).localStorage;
  }
});
