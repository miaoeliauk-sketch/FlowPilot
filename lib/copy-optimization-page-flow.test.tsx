import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { createTopicBoardIPProfile } from "./topic-board-contract.fixture";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/copy-optimization",
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
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  };
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

const ipA = createTopicBoardIPProfile({ id: "ip-a", name: "IP A" });
const ipB = createTopicBoardIPProfile({ id: "ip-b", name: "IP B" });

function knowledgeEntry(id: string, title: string, ipId: string | null) {
  return {
    id,
    category: "方法论",
    title,
    rawContent: `${title}的完整知识内容`,
    tags: ["内容"],
    keywords: ["表达"],
    ipId,
    sourceTier: "中",
    sourceTierReason: "测试资料",
    contentDirection: [],
    sourcePlatform: "测试",
    sourceUrl: "",
    note: "",
    createdAt: "2026-08-14T00:00:00.000Z",
    extractedAt: null,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
  };
}

async function renderPage() {
  const { render } = await import("@testing-library/react");
  const { IPProvider, useIP } = await import("./ip-context");
  const CopyOptimizationPage = (await import("../app/copy-optimization/page")).default;
  function TestIPSwitcher() {
    const { switchIP } = useIP();
    return <button onClick={() => switchIP(ipB.id)}>测试切换到IP B</button>;
  }
  return render(
    <IPProvider>
      <TestIPSwitcher />
      <CopyOptimizationPage />
    </IPProvider>,
  );
}

let restoreBrowser: (() => void) | undefined;
let originalFetch: typeof globalThis.fetch;

before(() => {
  restoreBrowser = installBrowserEnvironment();
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ipA, ipB]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ipA.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
});

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
  localStorage.clear();
});

after(() => {
  restoreBrowser?.();
});

test("文案优化检索只发送通用和目标IP知识，生成前不写使用记录", async () => {
  const entries = [
    knowledgeEntry("knowledge-global", "通用知识", null),
    knowledgeEntry("knowledge-ip-a", "IP A知识", ipA.id),
    knowledgeEntry("knowledge-ip-b", "IP B私有知识", ipB.id),
  ];
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify(entries));

  let requestedEntryIds: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const requestBody = JSON.parse(String(init?.body)) as {
      entries: Array<{ id: string }>;
    };
    requestedEntryIds = requestBody.entries.map(entry => entry.id);
    return new Response(JSON.stringify({
      results: requestBody.entries.map(entry => ({
        id: entry.id,
        reason: "内容相关",
        relevanceTier: "高度相关",
        relevanceReason: "命中主题",
      })),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const view = await renderPage();
  const userEvent = (await import("@testing-library/user-event")).default;
  const { waitFor } = await import("@testing-library/react");
  const user = userEvent.setup({ document });

  await user.type(
    view.getByPlaceholderText(/粘贴视频口播稿/),
    "这是一段用于验证知识检索范围的完整文案。",
  );

  await waitFor(() => assert.ok(requestedEntryIds.length > 0), { timeout: 3_000 });
  assert.deepEqual(requestedEntryIds, ["knowledge-global", "knowledge-ip-a"]);
  assert.equal(Boolean(view.queryByText(/IP B私有知识/)), false);

  const stored = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{
    usageRecords: unknown[];
  }>;
  assert.ok(stored.every(entry => entry.usageRecords.length === 0));
});

test("切换IP后迟到的旧知识检索不能覆盖当前IP结果", async () => {
  const entries = [
    knowledgeEntry("knowledge-ip-a", "IP A旧结果", ipA.id),
    knowledgeEntry("knowledge-ip-b", "IP B当前结果", ipB.id),
  ];
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify(entries));

  let resolveIPASearch: ((response: Response) => void) | null = null;
  let resolveIPBSearch: ((response: Response) => void) | null = null;
  let requestCount = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { entries: Array<{ id: string }> };
    requestCount += 1;
    return await new Promise<Response>((resolve) => {
      if (body.entries.some(entry => entry.id === "knowledge-ip-a")) resolveIPASearch = resolve;
      else resolveIPBSearch = resolve;
    });
  };

  const view = await renderPage();
  const userEvent = (await import("@testing-library/user-event")).default;
  const { act, waitFor } = await import("@testing-library/react");
  const user = userEvent.setup({ document });

  await user.type(
    view.getByPlaceholderText(/粘贴视频口播稿/),
    "这是一段用于验证切换IP后旧请求不能覆盖新结果的完整文案。",
  );
  await waitFor(() => assert.equal(typeof resolveIPASearch, "function"), { timeout: 3_000 });
  await user.click(view.getByRole("button", { name: "测试切换到IP B" }));
  await waitFor(() => assert.equal(typeof resolveIPBSearch, "function"), { timeout: 3_000 });
  assert.equal(requestCount, 2);

  await act(async () => {
    resolveIPBSearch?.(new Response(JSON.stringify({
      results: [{
        id: "knowledge-ip-b",
        reason: "当前IP相关",
        relevanceTier: "高度相关",
        relevanceReason: "属于当前IP",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  });
  await waitFor(() => assert.ok(view.queryByText(/IP B当前结果/)));

  await act(async () => {
    resolveIPASearch?.(new Response(JSON.stringify({
      results: [{
        id: "knowledge-ip-a",
        reason: "旧IP相关",
        relevanceTier: "高度相关",
        relevanceReason: "属于旧IP",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(Boolean(view.queryByText(/IP A旧结果/)), false);
  assert.ok(view.queryByText(/IP B当前结果/));
});

test("切换IP后立即清空旧候选且无知识的新上下文正常结束检索", async () => {
  const entries = [knowledgeEntry("knowledge-ip-a", "IP A旧候选", ipA.id)];
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify(entries));

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { entries: Array<{ id: string }> };
    return new Response(JSON.stringify({
      results: body.entries.map(entry => ({
        id: entry.id,
        reason: "内容相关",
        relevanceTier: "高度相关",
        relevanceReason: "属于当前IP",
      })),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const view = await renderPage();
  const userEvent = (await import("@testing-library/user-event")).default;
  const { waitFor } = await import("@testing-library/react");
  const user = userEvent.setup({ document });

  await user.type(
    view.getByPlaceholderText(/粘贴视频口播稿/),
    "这是一段用于验证新上下文没有知识时也能结束检索的完整文案。",
  );
  await waitFor(() => assert.ok(view.queryByText(/IP A旧候选/)), { timeout: 3_000 });

  await user.click(view.getByRole("button", { name: "测试切换到IP B" }));
  assert.equal(Boolean(view.queryByText(/IP A旧候选/)), false);
  assert.ok(view.queryByText("检索中…"));

  await waitFor(() => {
    assert.ok(view.queryByText("知识库里没有找到强相关的参考。"));
    assert.equal(Boolean(view.queryByText("检索中…")), false);
  }, { timeout: 3_000 });
});

test("IP切换后的知识更新等待期阻止优化请求", async () => {
  const entries = [
    knowledgeEntry("knowledge-ip-a", "IP A知识", ipA.id),
    knowledgeEntry("knowledge-ip-b", "IP B知识", ipB.id),
  ];
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify(entries));

  let optimizationCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.includes("/api/knowledge-search")) {
      if (body.entries.some((entry: { id: string }) => entry.id === "knowledge-ip-b")) {
        return await new Promise<Response>(() => {});
      }
      return new Response(JSON.stringify({
        results: [{
          id: "knowledge-ip-a",
          reason: "内容相关",
          relevanceTier: "高度相关",
          relevanceReason: "属于当前IP",
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/api/copy-optimization/breakdown")) {
      return new Response(JSON.stringify({
        coreElements: { viewpoint: "核心观点", cases: [], logic: "核心逻辑", conclusion: "核心结论" },
        expressionAnalysis: {
          openingHook: "开头",
          narrativeRhythm: "节奏",
          emotionalTone: "基调",
          rhetoricDevices: [],
          closingStyle: "结尾",
        },
        boundaryNote: "只拆解，不评价观点。",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/api/copy-optimization")) {
      optimizationCalls += 1;
      return new Response(JSON.stringify({ error: "本测试不应调用优化接口" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`未处理的请求：${url}`);
  };

  const view = await renderPage();
  const userEvent = (await import("@testing-library/user-event")).default;
  const { waitFor } = await import("@testing-library/react");
  const user = userEvent.setup({ document });

  await user.type(
    view.getByPlaceholderText(/粘贴视频口播稿/),
    "这是一段用于验证知识更新等待期不能提交优化请求的完整文案。",
  );
  await waitFor(() => assert.ok(view.queryByText(/IP A知识/)), { timeout: 3_000 });
  await user.click(view.getByRole("button", { name: /拆解原文/ }));
  await waitFor(() => assert.ok(view.queryAllByText("拆解结果").length > 0));
  await user.click(view.getByRole("button", { name: /确认拆解结果/ }));

  await user.click(view.getByRole("button", { name: "测试切换到IP B" }));
  await user.click(view.getByRole("button", { name: "开始优化" }));

  assert.equal(optimizationCalls, 0);
  assert.ok(view.queryByText(/知识正在更新，请稍候/));
});

test("文案优化只在知识真正参与生成后展示已参考并写入使用记录", async () => {
  const entries = [
    knowledgeEntry("knowledge-global", "通用知识", null),
    knowledgeEntry("knowledge-ip-a", "IP A知识", ipA.id),
    knowledgeEntry("knowledge-ip-b", "IP B私有知识", ipB.id),
  ];
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify(entries));

  const optimizationRequest: {
    current?: {
      ipProfile: { id: string };
      knowledgeReferences?: Array<{
        id: string;
        title: string;
        content: string;
        ipId: string | null;
      }>;
    };
  } = {};

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.includes("/api/knowledge-search")) {
      return new Response(JSON.stringify({
        results: body.entries.map((entry: { id: string }) => ({
          id: entry.id,
          reason: "内容相关",
          relevanceTier: "高度相关",
          relevanceReason: "命中主题",
        })),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/api/copy-optimization/breakdown")) {
      return new Response(JSON.stringify({
        coreElements: {
          viewpoint: "核心观点",
          cases: ["核心案例"],
          logic: "核心逻辑",
          conclusion: "核心结论",
        },
        expressionAnalysis: {
          openingHook: "开头",
          narrativeRhythm: "节奏",
          emotionalTone: "基调",
          rhetoricDevices: ["对比"],
          closingStyle: "结尾",
        },
        boundaryNote: "只拆解，不评价观点。",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/api/copy-optimization")) {
      optimizationRequest.current = body;
      const knowledgeReferenceIds = body.knowledgeReferences.map((item: { id: string }) => item.id);
      return new Response(JSON.stringify({
        ipId: body.ipProfile.id,
        ipName: body.ipProfile.name,
        mode: body.mode,
        modeLabel: "平衡模式",
        goal: body.goal,
        constraints: body.constraints,
        coreElements: body.breakdown.coreElements,
        lockedItemsCheck: [
          { item: "viewpoint", label: "核心观点", preserved: true, howPreserved: "完整保留" },
        ],
        segments: [
          { original: "原文", rewritten: "优化后的完整文案", reason: "更清晰", changeType: ["表达优化"] },
        ],
        rewrittenFullText: "优化后的完整文案",
        deviationScore: 10,
        deviationWarning: false,
        deviationThreshold: 30,
        deviationReason: "未偏离",
        styleMatchScore: 85,
        referencedSamples: [],
        knowledgeReferenceIds,
        ipStyleExplanation: "符合IP A的表达习惯",
        goalImpact: { direction: "更有利", reasoning: "表达更清晰" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`未处理的请求：${url}`);
  };

  const view = await renderPage();
  const userEvent = (await import("@testing-library/user-event")).default;
  const { waitFor } = await import("@testing-library/react");
  const user = userEvent.setup({ document });

  await user.type(
    view.getByPlaceholderText(/粘贴视频口播稿/),
    "这是一段用于验证知识真正参与生成的完整文案。",
  );
  await waitFor(() => assert.ok(view.queryByText(/IP A知识/)), { timeout: 3_000 });

  await user.click(view.getByRole("button", { name: /拆解原文/ }));
  await waitFor(() => assert.ok(view.queryAllByText("拆解结果").length > 0));
  await user.click(view.getByRole("button", { name: /确认拆解结果/ }));
  await user.click(view.getByRole("button", { name: "开始优化" }));

  await waitFor(() => assert.ok(view.queryAllByText("优化后的完整文案").length > 0));
  const optimizationBody = optimizationRequest.current;
  assert.ok(optimizationBody);
  assert.deepEqual(
    optimizationBody.knowledgeReferences?.map(item => item.id),
    ["knowledge-global", "knowledge-ip-a"],
  );
  assert.deepEqual(
    optimizationBody.knowledgeReferences?.map(item => item.content),
    ["通用知识的完整知识内容", "IP A知识的完整知识内容"],
  );
  assert.equal(Boolean(view.queryByText(/本次优化参考了/)), true);

  const stored = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{
    id: string;
    status: string;
    usageRecords: Array<{ module: string }>;
  }>;
  const byId = new Map(stored.map(entry => [entry.id, entry]));
  assert.equal(byId.get("knowledge-global")?.usageRecords.length, 1);
  assert.equal(byId.get("knowledge-ip-a")?.usageRecords.length, 1);
  assert.equal(byId.get("knowledge-ip-b")?.usageRecords.length, 0);
  assert.equal(byId.get("knowledge-global")?.usageRecords[0]?.module, "文案优化");
  assert.equal(byId.get("knowledge-global")?.status, "已用于分析");
});

test("优化生成期间切换IP时丢弃旧结果且不写知识使用记录", async () => {
  const entries = [knowledgeEntry("knowledge-ip-a", "IP A知识", ipA.id)];
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify(entries));

  let resolveOptimization: ((response: Response) => void) | null = null;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.includes("/api/knowledge-search")) {
      return new Response(JSON.stringify({
        results: body.entries.map((entry: { id: string }) => ({
          id: entry.id,
          reason: "内容相关",
          relevanceTier: "高度相关",
          relevanceReason: "命中主题",
        })),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/api/copy-optimization/breakdown")) {
      return new Response(JSON.stringify({
        coreElements: { viewpoint: "核心观点", cases: [], logic: "核心逻辑", conclusion: "核心结论" },
        expressionAnalysis: {
          openingHook: "开头",
          narrativeRhythm: "节奏",
          emotionalTone: "基调",
          rhetoricDevices: [],
          closingStyle: "结尾",
        },
        boundaryNote: "只拆解，不评价观点。",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/api/copy-optimization")) {
      return await new Promise<Response>((resolve) => { resolveOptimization = resolve; });
    }
    throw new Error(`未处理的请求：${url}`);
  };

  const view = await renderPage();
  const userEvent = (await import("@testing-library/user-event")).default;
  const { act, waitFor } = await import("@testing-library/react");
  const user = userEvent.setup({ document });

  await user.type(
    view.getByPlaceholderText(/粘贴视频口播稿/),
    "这是一段用于验证生成期间切换IP会丢弃旧结果的完整文案。",
  );
  await waitFor(() => assert.ok(view.queryByText(/IP A知识/)), { timeout: 3_000 });
  await user.click(view.getByRole("button", { name: /拆解原文/ }));
  await waitFor(() => assert.ok(view.queryAllByText("拆解结果").length > 0));
  await user.click(view.getByRole("button", { name: /确认拆解结果/ }));
  await user.click(view.getByRole("button", { name: "开始优化" }));
  await waitFor(() => assert.equal(typeof resolveOptimization, "function"));

  await user.click(view.getByRole("button", { name: "测试切换到IP B" }));
  await act(async () => {
    resolveOptimization?.(new Response(JSON.stringify({
      ipId: ipA.id,
      ipName: ipA.name,
      mode: "balanced",
      modeLabel: "平衡模式",
      goal: "完播率",
      constraints: {},
      coreElements: { viewpoint: "核心观点", cases: [], logic: "核心逻辑", conclusion: "核心结论" },
      lockedItemsCheck: [{ item: "viewpoint", label: "核心观点", preserved: true, howPreserved: "完整保留" }],
      segments: [{ original: "原文", rewritten: "不应显示的旧IP优化结果", reason: "测试", changeType: ["测试"] }],
      rewrittenFullText: "不应显示的旧IP优化结果",
      deviationScore: 0,
      deviationWarning: false,
      deviationThreshold: 30,
      deviationReason: "未偏离",
      styleMatchScore: 90,
      referencedSamples: [],
      knowledgeReferenceIds: ["knowledge-ip-a"],
      ipStyleExplanation: "旧IP表达",
      goalImpact: { direction: "中性", reasoning: "测试" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  });

  await waitFor(() => assert.ok(view.queryByText(/目标IP已切换/)));
  assert.equal(view.queryAllByText("不应显示的旧IP优化结果").length, 0);
  const stored = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{
    usageRecords: unknown[];
  }>;
  assert.ok(stored.every(entry => entry.usageRecords.length === 0));
});
