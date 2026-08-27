import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "react";

import { IPProvider } from "./ip-context";
import { buildIPSourceAnalysisV2 } from "./ip-source-analysis-v2";
import { createTopicBoardIPProfile } from "./topic-board-contract.fixture";

type LoaderResult = {
  format?: string;
  source?: string;
  shortCircuit?: boolean;
} | Promise<{
  format?: string;
  source?: string;
  shortCircuit?: boolean;
}>;

type RegisterHooks = (hooks: {
  load: (
    url: string,
    context: unknown,
    nextLoad: (url: string, context: unknown) => LoaderResult,
  ) => LoaderResult;
}) => void;

const registerHooks = (nodeModule as unknown as { registerHooks: RegisterHooks }).registerHooks;

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      return { format: "module", source: "export default {};", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/cognition-graph",
    pretendToBeVisual: true,
  });
  const previous = new Map<string, PropertyDescriptor | undefined>();

  class ResizeObserverMock {
    constructor(private readonly callback: ResizeObserverCallback) {}

    observe(target: Element) {
      this.callback([{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }

    unobserve() {}
    disconnect() {}
  }

  const browserGlobals: Record<string, unknown> = {
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver,
    ResizeObserver: ResizeObserverMock,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  };
  for (const [key, value] of Object.entries(browserGlobals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  const rectangleDescriptor = Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype, "getBoundingClientRect");
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0, y: 0, width: 800, height: 500, top: 0, right: 800, bottom: 500, left: 0,
      toJSON: () => ({}),
    }),
  });

  return () => {
    dom.window.close();
    if (rectangleDescriptor) {
      Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", rectangleDescriptor);
    } else {
      Reflect.deleteProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect");
    }
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  };
}

function seedCognitionGraphData() {
  const ip = createTopicBoardIPProfile();
  const sourceId = "cognition-graph-source";
  const rawContent = "持续输出来自问题深化。机械日更不能替代问题深化。基金定投需要长期纪律。";
  let idSequence = 400;
  const extracted = buildIPSourceAnalysisV2({
    sourceId,
    sourceContent: rawContent,
    analyzedAt: "2026-08-27T09:00:00.000Z",
    createId: () => `00000000-0000-4000-8000-${String(++idSequence).padStart(12, "0")}`,
    candidate: {
      nodes: [
        {
          nodeRef: "N1",
          question: { content: "持续输出依靠什么？", derivation: "explicit", anchors: [{ quote: "持续输出来自问题深化" }] },
          claim: { content: "持续输出来自问题深化。", anchors: [{ quote: "持续输出来自问题深化" }] },
          reasoning: { status: "not_provided", steps: [] },
          evidence: [],
          concepts: [],
        },
        {
          nodeRef: "N2",
          question: { content: "机械日更能否替代深化？", derivation: "explicit", anchors: [{ quote: "机械日更不能替代问题深化" }] },
          claim: { content: "机械日更不能替代问题深化。", anchors: [{ quote: "机械日更不能替代问题深化" }] },
          reasoning: { status: "not_provided", steps: [] },
          evidence: [],
          concepts: [],
        },
        {
          nodeRef: "N3",
          question: { content: "基金定投依靠什么？", derivation: "explicit", anchors: [{ quote: "基金定投需要长期纪律" }] },
          claim: { content: "基金定投需要长期纪律。", anchors: [{ quote: "基金定投需要长期纪律" }] },
          reasoning: { status: "not_provided", steps: [] },
          evidence: [],
          concepts: [],
        },
      ],
      aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
    },
  });
  const analysis = {
    ...extracted,
    nonce: 2,
    nodes: extracted.nodes.map(node => ({ ...node, reviewStatus: "human_confirmed" as const })),
  };
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([{
    id: sourceId,
    category: "IP原始内容",
    title: "持续输出认知",
    rawContent,
    sourceAnalysis: analysis,
    sourceFinalProof: "graph-page-final-proof",
    sourceLegacyProof: null,
    ipId: ip.id,
    createdAt: "2026-08-27T09:00:00.000Z",
  }]));
  return { ip, nodeId: analysis.nodes[0]!.id, nodeIds: analysis.nodes.map(node => node.id) };
}

test("认知图谱页面首次审计发送完整候选范围并渲染全量报告", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  const { ip, nodeIds } = seedCognitionGraphData();
  const requestBodies: Array<Record<string, unknown>> = [];
  let resolveAudit: ((response: Response) => void) | null = null;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "/api/cognition/audit");
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Promise<Response>(resolve => {
      resolveAudit = resolve;
    });
  };

  function completeAudit() {
    if (!resolveAudit) throw new Error("审计请求尚未发出");
    resolveAudit(new Response(JSON.stringify({
      results: [{
        nodeId: nodeIds[0],
        relation: "RELATED",
        lexicalScore: 0.72,
        reason: "讨论同一持续输出方法。",
        quote: "持续输出来自问题深化",
      }, {
        nodeId: nodeIds[1],
        relation: "UNRELATED",
        lexicalScore: 0.1,
        reason: "检查后未发现直接关联。",
        quote: "机械日更不能替代问题深化",
      }, {
        nodeId: nodeIds[2],
        relation: "UNRELATED",
        lexicalScore: 0,
        reason: "检查后确认属于其他主题。",
        quote: "基金定投需要长期纪律",
      }],
      truncated: false,
      candidateCountBeforeTruncation: 3,
      assessedCandidateCount: 3,
      auditScope: "full",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }

  let cleanupPage: (() => void) | undefined;
  try {
    const { default: CognitionGraphPage } = await import("../app/cognition-graph/page");
    const { cleanup, fireEvent, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const view = render(<IPProvider><CognitionGraphPage /></IPProvider>);

    const input = await view.findByLabelText("待审观点");
    fireEvent.change(input, { target: { value: "持续输出为什么不等于机械日更？" } });
    fireEvent.click(view.getByRole("button", { name: "开始关联审计" }));

    assert.equal(view.getByRole("button", { name: "正在关联审计……" }).hasAttribute("disabled"), true);
    completeAudit();
    assert.ok(await view.findByText("全量审计（从全部候选节点发起）"));
    assert.ok(view.container.querySelector(".cognition-graph"));
    assert.equal(requestBodies.length, 1);
    assert.equal(requestBodies[0]!.activeIPId, ip.id);
    assert.equal("candidateNodeIds" in requestBodies[0]!, false);
    assert.ok(Array.isArray(requestBodies[0]!.sources));
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("认知图谱页面把403凭证失败转换为可理解的安全提示", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  seedCognitionGraphData();
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: "认知来源凭证无效或已失效",
    code: "SECURITY_VALIDATION_FAILED",
  }), { status: 403, headers: { "Content-Type": "application/json" } });

  let cleanupPage: (() => void) | undefined;
  try {
    const { default: CognitionGraphPage } = await import("../app/cognition-graph/page");
    const { cleanup, fireEvent, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const view = render(<IPProvider><CognitionGraphPage /></IPProvider>);

    fireEvent.change(await view.findByLabelText("待审观点"), {
      target: { value: "测试凭证失败提示" },
    });
    fireEvent.click(view.getByRole("button", { name: "开始关联审计" }));

    assert.ok(await view.findByText("当前IP的认知凭证校验失败，请重新确认知识资料。"));
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("重新审计只发送未检查节点并按编号合并回原有全量结果", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  const { nodeIds } = seedCognitionGraphData();
  const requestBodies: Array<Record<string, unknown>> = [];
  const subsetResolver: { current: ((response: Response) => void) | null } = { current: null };
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requestBodies.push(body);
    if (!Array.isArray(body.candidateNodeIds)) {
      return new Response(JSON.stringify({
        results: [
          { nodeId: nodeIds[0], relation: "RELATED", lexicalScore: 0.8, reason: "原有相关理由", quote: "持续输出来自问题深化" },
          { nodeId: nodeIds[1], relation: "UNASSESSED", lexicalScore: 0.6, reason: null, quote: null },
          { nodeId: nodeIds[2], relation: "UNRELATED", lexicalScore: 0, reason: "原有无关理由", quote: "基金定投需要长期纪律" },
        ],
        truncated: true,
        candidateCountBeforeTruncation: 3,
        assessedCandidateCount: 2,
        auditScope: "full",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Promise<Response>(resolve => {
      subsetResolver.current = resolve;
    });
  };

  let cleanupPage: (() => void) | undefined;
  try {
    const { default: CognitionGraphPage } = await import("../app/cognition-graph/page");
    const { cleanup, fireEvent, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const view = render(<IPProvider><CognitionGraphPage /></IPProvider>);

    fireEvent.change(await view.findByLabelText("待审观点"), {
      target: { value: "持续输出是否必须机械日更？" },
    });
    fireEvent.click(view.getByRole("button", { name: "开始关联审计" }));
    assert.ok(await view.findByText("原有相关理由"));
    const reauditButton = view.getByRole("button", { name: "重新审计未检查节点" });
    fireEvent.click(reauditButton);
    fireEvent.click(reauditButton);
    assert.equal(requestBodies.length, 2, "同一子集正在审计时不得重复发起付费请求");
    if (!subsetResolver.current) throw new Error("子集审计请求尚未发出");
    subsetResolver.current(new Response(JSON.stringify({
      results: [{
        nodeId: nodeIds[1],
        relation: "CONFLICTING",
        lexicalScore: 0.92,
        reason: "重审后确认立场冲突",
        quote: "机械日更不能替代问题深化",
      }],
      truncated: false,
      candidateCountBeforeTruncation: 1,
      assessedCandidateCount: 1,
      auditScope: "subset",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    assert.ok(await view.findByText("本次为子集审计（针对此前未检查节点）"));
    assert.ok(view.getByText("重审后确认立场冲突"));
    assert.ok(view.getByText("原有相关理由"));
    assert.ok(view.getByText("节点编号：" + nodeIds[2]));
    assert.equal(view.queryByText("本次未检查"), null);
    assert.deepEqual(requestBodies[1]!.candidateNodeIds, [nodeIds[1]]);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("全量审计缺少候选节点时拒绝展示不完整报告", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  const { nodeIds } = seedCognitionGraphData();
  globalThis.fetch = async () => new Response(JSON.stringify({
    results: [{
      nodeId: nodeIds[0],
      relation: "RELATED",
      lexicalScore: 0.8,
      reason: "只返回了一个节点",
      quote: "持续输出来自问题深化",
    }],
    truncated: false,
    candidateCountBeforeTruncation: 1,
    assessedCandidateCount: 1,
    auditScope: "full",
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  let cleanupPage: (() => void) | undefined;
  try {
    const { default: CognitionGraphPage } = await import("../app/cognition-graph/page");
    const { cleanup, fireEvent, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const view = render(<IPProvider><CognitionGraphPage /></IPProvider>);

    fireEvent.change(await view.findByLabelText("待审观点"), {
      target: { value: "测试不完整全量报告" },
    });
    fireEvent.click(view.getByRole("button", { name: "开始关联审计" }));

    assert.ok(await view.findByText("关联审计返回的数据不完整，请重试。"));
    assert.equal(view.queryByText("只返回了一个节点"), null);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("相关或冲突节点缺少理由与引用时拒绝展示无证据报告", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  const { nodeIds } = seedCognitionGraphData();
  globalThis.fetch = async () => new Response(JSON.stringify({
    results: [
      { nodeId: nodeIds[0], relation: "RELATED", lexicalScore: 0.8, reason: null, quote: null },
      { nodeId: nodeIds[1], relation: "UNRELATED", lexicalScore: 0.1, reason: "无直接关联", quote: "机械日更不能替代问题深化" },
      { nodeId: nodeIds[2], relation: "UNRELATED", lexicalScore: 0, reason: "属于其他主题", quote: "基金定投需要长期纪律" },
    ],
    truncated: false,
    candidateCountBeforeTruncation: 3,
    assessedCandidateCount: 3,
    auditScope: "full",
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  let cleanupPage: (() => void) | undefined;
  try {
    const { default: CognitionGraphPage } = await import("../app/cognition-graph/page");
    const { cleanup, fireEvent, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const view = render(<IPProvider><CognitionGraphPage /></IPProvider>);

    fireEvent.change(await view.findByLabelText("待审观点"), {
      target: { value: "测试无证据相关结果" },
    });
    fireEvent.click(view.getByRole("button", { name: "开始关联审计" }));

    assert.ok(await view.findByText("关联审计返回的数据不完整，请重试。"));
    assert.equal(view.queryByText("相关"), null);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("输入从A切到B再回A时允许重新审计且丢弃旧A结果", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  const { nodeIds } = seedCognitionGraphData();
  const oldRequestResolver: { current: ((response: Response) => void) | null } = { current: null };
  let requestCount = 0;
  const makeResponse = (reason: string) => new Response(JSON.stringify({
    results: [
      { nodeId: nodeIds[0], relation: "RELATED", lexicalScore: 0.8, reason, quote: "持续输出来自问题深化" },
      { nodeId: nodeIds[1], relation: "UNRELATED", lexicalScore: 0.1, reason: "无直接关联", quote: "机械日更不能替代问题深化" },
      { nodeId: nodeIds[2], relation: "UNRELATED", lexicalScore: 0, reason: "属于其他主题", quote: "基金定投需要长期纪律" },
    ],
    truncated: false,
    candidateCountBeforeTruncation: 3,
    assessedCandidateCount: 3,
    auditScope: "full",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Promise<Response>(resolve => {
        oldRequestResolver.current = resolve;
      });
    }
    return makeResponse("新A请求结果");
  };

  let cleanupPage: (() => void) | undefined;
  try {
    const { default: CognitionGraphPage } = await import("../app/cognition-graph/page");
    const { cleanup, fireEvent, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const view = render(<IPProvider><CognitionGraphPage /></IPProvider>);
    const input = await view.findByLabelText("待审观点");

    fireEvent.change(input, { target: { value: "观点A" } });
    fireEvent.click(view.getByRole("button", { name: "开始关联审计" }));
    fireEvent.change(input, { target: { value: "观点B" } });
    fireEvent.change(input, { target: { value: "观点A" } });
    fireEvent.click(view.getByRole("button", { name: "开始关联审计" }));

    assert.equal(requestCount, 2);
    assert.ok(await view.findByText("新A请求结果"));
    if (!oldRequestResolver.current) throw new Error("旧A请求尚未发出");
    oldRequestResolver.current(makeResponse("旧A迟到结果"));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(view.queryByText("旧A迟到结果"), null);
    assert.ok(view.getByText("新A请求结果"));
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

for (const scenario of [
  { status: 400, expected: "审计请求参数有误，请检查待审观点后重试。" },
  { status: 502, expected: "语义审计暂时失败，请稍后重试。" },
]) {
  test(`认知图谱页面明确说明HTTP ${scenario.status}审计错误`, async () => {
    const restoreBrowser = installBrowserEnvironment();
    const originalFetch = globalThis.fetch;
    seedCognitionGraphData();
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "模拟审计错误" }), {
      status: scenario.status,
      headers: { "Content-Type": "application/json" },
    });

    let cleanupPage: (() => void) | undefined;
    try {
      const { default: CognitionGraphPage } = await import("../app/cognition-graph/page");
      const { cleanup, fireEvent, render } = await import("@testing-library/react");
      cleanupPage = cleanup;
      const view = render(<IPProvider><CognitionGraphPage /></IPProvider>);

      fireEvent.change(await view.findByLabelText("待审观点"), {
        target: { value: `测试${scenario.status}错误提示` },
      });
      fireEvent.click(view.getByRole("button", { name: "开始关联审计" }));

      assert.ok(await view.findByText(scenario.expected));
    } finally {
      cleanupPage?.();
      globalThis.fetch = originalFetch;
      restoreBrowser();
    }
  });
}
