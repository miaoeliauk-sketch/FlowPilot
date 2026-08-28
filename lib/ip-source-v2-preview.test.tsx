import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import type { CognitionNodeV2 } from "./types";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/knowledge-intake/original",
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
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Event: dom.window.Event,
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

let restoreBrowser: (() => void) | undefined;
let originalFetch: typeof globalThis.fetch;
const PROOF_SECRET = "test-only-ip-source-analysis-proof-secret-32-bytes";
const originalProofSecret = process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET;

before(() => {
  restoreBrowser = installBrowserEnvironment();
  originalFetch = globalThis.fetch;
  process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET = PROOF_SECRET;
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
  localStorage.clear();
  window.sessionStorage.clear();
});

after(() => {
  restoreBrowser?.();
  if (originalProofSecret === undefined) {
    delete process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET;
  } else {
    process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET = originalProofSecret;
  }
});

test("SourceViewer遇到越界锚点时显示失效提示并保留完整原文", async () => {
  const { render } = await import("@testing-library/react");
  const { SourceViewer } = await import("../components/ip-brain/SourceViewer");
  const sourceContent = "老师原话：判断来自真实矛盾。";
  const view = render(<SourceViewer
    sourceContent={sourceContent}
    activeAnchor={{
      quote: "真实矛盾",
      startPosition: 5,
      endPosition: sourceContent.length + 10,
    }}
  />);

  assert.equal(view.getByRole("status").textContent, "锚点失效");
  assert.equal(view.getByTestId("source-content").textContent, sourceContent);
  assert.equal(view.container.querySelector("mark"), null);
});

test("SourceViewer按位置高亮重复原文的指定一处且10万字只生成少量元素", async () => {
  const originalScrollDescriptor = Object.getOwnPropertyDescriptor(
    globalThis.HTMLElement.prototype,
    "scrollIntoView",
  );
  let scrollCalls = 0;
  try {
    Object.defineProperty(globalThis.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: () => { scrollCalls += 1; },
    });
    const { render } = await import("@testing-library/react");
    const { SourceViewer } = await import("../components/ip-brain/SourceViewer");
    const sourceContent = `重复观点。${"甲".repeat(99_980)}重复观点。`;
    const startPosition = sourceContent.lastIndexOf("重复观点");
    const view = render(<SourceViewer
      sourceContent={sourceContent}
      activeAnchor={{
        quote: "重复观点",
        startPosition,
        endPosition: startPosition + 4,
      }}
    />);

    const mark = view.container.querySelector("mark");
    assert.equal(mark?.textContent, "重复观点");
    assert.equal(view.getByTestId("source-content").textContent, sourceContent);
    assert.ok(view.container.querySelectorAll("*").length <= 4);
    assert.equal(scrollCalls, 1);
  } finally {
    if (originalScrollDescriptor) {
      Object.defineProperty(
        globalThis.HTMLElement.prototype,
        "scrollIntoView",
        originalScrollDescriptor,
      );
    } else {
      Reflect.deleteProperty(globalThis.HTMLElement.prototype, "scrollIntoView");
    }
  }
});

function createReviewedNode(): CognitionNodeV2 {
  return {
    id: "00000000-0000-4000-8000-000000000041",
    question: {
      content: "选题是否应该追随共识？",
      derivation: "inferred",
      anchors: [{ quote: "为什么不要追随共识", startPosition: 0, endPosition: 9 }],
    },
    claim: {
      content: "不要追随共识。",
      anchors: [{ quote: "不要追随共识", startPosition: 3, endPosition: 9 }],
    },
    reasoning: {
      status: "partial",
      steps: [{
        order: 1,
        content: "共识会稀释情绪价值。",
        anchors: [{ quote: "共识会稀释情绪价值", startPosition: 10, endPosition: 20 }],
      }],
    },
    evidence: [],
    concepts: [],
    reviewStatus: "human_confirmed",
    humanRevision: {
      claim: "不要重复已经形成的共识。",
      reasoningSteps: [{ order: 1, content: "共识内容很难再提供新的情绪价值。" }],
      updatedAt: "2026-08-24T13:00:00.000Z",
    },
  };
}

test("认知卡片默认展示人工修订并可查看AI原始提取和发起修订", async () => {
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { CognitionNodeCard } = await import("../components/ip-brain/CognitionNodeCard");
  const activated: string[] = [];
  const actions: unknown[] = [];
  const view = render(<CognitionNodeCard
    node={createReviewedNode()}
    onActivateAnchor={anchor => activated.push(anchor.quote)}
    onReview={action => { actions.push(action); }}
  />);
  const user = userEvent.setup({ document });

  assert.ok(view.getByText("不要重复已经形成的共识。"));
  assert.ok(view.getByRole("button", { name: "1. 共识内容很难再提供新的情绪价值。" }));
  await user.click(view.getByRole("button", { name: "查看AI原始提取" }));
  await user.click(view.getByRole("button", { name: "不要追随共识。" }));
  assert.deepEqual(activated, ["不要追随共识"]);

  await user.click(view.getByRole("button", { name: "修改" }));
  const claimInput = view.getByLabelText("人工修订观点");
  await user.clear(claimInput);
  await user.type(claimInput, "不要跟随已经失去信息增量的共识。");
  await user.click(view.getByRole("button", { name: "保存人工修订" }));
  assert.deepEqual(actions[0], {
    type: "revise",
    nodeId: createReviewedNode().id,
    humanRevision: {
      claim: "不要跟随已经失去信息增量的共识。",
      reasoningSteps: [{ order: 1, content: "共识内容很难再提供新的情绪价值。" }],
    },
  });
});

test("新增原始内容按V2解析并用分析前生成的同一Source编号完成审核和保存", async () => {
  const { createTopicBoardIPProfile } = await import("./topic-board-contract.fixture");
  const { buildIPSourceAnalysisV2 } = await import("./ip-source-analysis-v2");
  const {
    buildIPSourceAnalysisProofClaims,
    createIPSourceAnalysisToken,
    digestIPSourceAnalysisProofClaims,
  } = await import("./ip-source-analysis-proof");
  const { initializeIPSourceLedger } = await import("./ip-source-ledger");
  const { POST: reviewPOST } = await import("../app/api/ip-source-analysis/review/route");
  const { POST: finalizePOST } = await import("../app/api/ip-source-analysis/finalize/route");
  const { POST: verifyPOST } = await import("../app/api/ip-source-analysis/verify/route");
  const { NextRequest } = await import("next/server");
  const ip = createTopicBoardIPProfile({ id: "ip-v2-preview", name: "V2测试IP" });
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const sourceContent = "老师明确说：不要追随已经形成的共识。";
  let requestedSourceId = "";
  let requestedParserVersion: unknown;
  let requestedSeq: unknown;

  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (url === "/api/ip-source-analysis") {
        requestedSourceId = String(body.sourceId ?? "");
        requestedParserVersion = body.parserVersion;
        requestedSeq = body.requestSeq;
        const analysis = buildIPSourceAnalysisV2({
          sourceId: requestedSourceId,
          sourceContent,
          analyzedAt: "2026-08-24T14:00:00.000Z",
          createId: () => "00000000-0000-4000-8000-000000000051",
          candidate: {
            nodes: [{
              nodeRef: "N1",
              question: {
                content: "选题是否应该追随共识？",
                derivation: "inferred",
                anchors: [{ quote: sourceContent }],
              },
              claim: {
                content: "不要追随已经形成的共识。",
                anchors: [{ quote: "不要追随已经形成的共识" }],
              },
              reasoning: { status: "not_provided", steps: [] },
              evidence: [],
              concepts: [],
            }],
            aiSuggestions: {
              potentialPrinciples: [{ content: "AI原则建议", basedOnNodeRefs: ["N1"] }],
              topicPotential: [],
            },
          },
        });
        const claims = buildIPSourceAnalysisProofClaims({ ipId: ip.id, analysis });
        await initializeIPSourceLedger({
          sourceId: analysis.sourceId,
          ipId: ip.id,
          nonce: analysis.nonce,
          digest: digestIPSourceAnalysisProofClaims(claims),
        });
        const analysisToken = createIPSourceAnalysisToken(claims, PROOF_SECRET);
        return new Response(JSON.stringify({
          analysis,
          analysisToken,
          activeIPId: ip.id,
          requestSeq: requestedSeq,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/ip-source-analysis/review") {
        return reviewPOST(new NextRequest("http://localhost/api/ip-source-analysis/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }));
      }
      if (url === "/api/ip-source-analysis/finalize") {
        return finalizePOST(new NextRequest("http://localhost/api/ip-source-analysis/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }));
      }
      if (url === "/api/ip-source-analysis/verify") {
        return verifyPOST(new NextRequest("http://localhost/api/ip-source-analysis/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }));
      }
      throw new Error(`未处理的测试请求：${url}`);
    };

    const { fireEvent, render, waitFor } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const OriginalSourcePage = (await import("../app/knowledge-intake/original/page")).default;
    const view = render(<IPProvider><OriginalSourcePage /></IPProvider>);
    const user = userEvent.setup({ document });

    await user.type(view.getByPlaceholderText("例如：持续输出的真正含义"), "非共识选题");
    await user.type(view.getByPlaceholderText(/粘贴老师的课程/), sourceContent);
    fireEvent.click(view.getByRole("button", { name: "开始理解内容" }));
    await waitFor(() => assert.ok(view.getByText("不要追随已经形成的共识。")));
    const { loadDraftCognitionBatches } = await import("./cognition-draft-session-store");
    const initialDrafts = loadDraftCognitionBatches(window.sessionStorage, ip.id).records;
    assert.equal(initialDrafts.length, 1);
    assert.equal(initialDrafts[0]?.analysis.sourceId, requestedSourceId);
    assert.deepEqual(initialDrafts[0]?.sourceMetadata, {
      title: "非共识选题",
      sourceKind: "直播逐字稿",
      sourceName: "",
      sourceUrl: "",
    });
    const initialAnalysisToken = initialDrafts[0]?.analysisToken;
    assert.equal(requestedParserVersion, 2);
    assert.match(requestedSourceId, /^source-/);
    assert.ok(view.getByText("以下内容为AI建议，不是老师原意"));
    assert.ok(view.getByText("AI原则建议"));
    assert.equal(view.queryByRole("button", { name: /转为判断原则/ }), null);

    await user.click(view.getByRole("button", { name: "确认" }));
    await waitFor(() => assert.ok(view.getByText("人工已确认")));
    const reviewedDrafts = loadDraftCognitionBatches(window.sessionStorage, ip.id).records;
    assert.equal(reviewedDrafts.length, 1);
    assert.notEqual(reviewedDrafts[0]?.analysisToken, initialAnalysisToken);
    assert.equal(reviewedDrafts[0]?.analysis.nodes[0]?.reviewStatus, "human_confirmed");
    await user.click(view.getByRole("button", { name: "继续保存这份原始内容" }));
    await user.click(view.getByRole("button", { name: "确认保存为IP原始内容" }));
    await waitFor(() => assert.ok(view.getByText("IP原始内容已保存")));

    const saved = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{
      id: string;
      sourceAnalysis?: { parserVersion?: number; sourceId?: string };
      sourceFinalProof?: string | null;
    }>;
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.id, requestedSourceId);
    assert.equal(saved[0]?.sourceAnalysis?.parserVersion, 2);
    assert.equal(saved[0]?.sourceAnalysis?.sourceId, requestedSourceId);
    assert.equal(typeof saved[0]?.sourceFinalProof, "string");
    assert.equal(loadDraftCognitionBatches(window.sessionStorage, ip.id).records.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("A分析期间切换到B后，A的迟到结果不会显示在B页面", { timeout: 5_000 }, async () => {
  const { createTopicBoardIPProfile } = await import("./topic-board-contract.fixture");
  const { buildIPSourceAnalysisV2 } = await import("./ip-source-analysis-v2");
  const ipA = createTopicBoardIPProfile({ id: "ip-analysis-a", name: "分析IP A" });
  const ipB = createTopicBoardIPProfile({ id: "ip-analysis-b", name: "分析IP B" });
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ipA, ipB]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ipA.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const sourceContent = "老师明确说：A的观点不能出现在B页面。";
  let resolveAnalysis: ((response: Response) => void) | undefined;
  let requestedSourceId = "";
  let requestedSeq: unknown;

  try {
    globalThis.fetch = async (_input, init) => new Promise<Response>((resolve) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requestedSourceId = String(body.sourceId ?? "");
      requestedSeq = body.requestSeq;
      resolveAnalysis = resolve;
    });
    const { act, fireEvent, render, waitFor } = await import("@testing-library/react");
    const { IPProvider, useIP } = await import("./ip-context");
    const OriginalSourcePage = (await import("../app/knowledge-intake/original/page")).default;
    function SwitchIP() {
      const { switchIP } = useIP();
      return <button onClick={() => switchIP(ipB.id)}>切换到B</button>;
    }
    const view = render(<IPProvider><SwitchIP /><OriginalSourcePage /></IPProvider>);

    fireEvent.change(view.getByPlaceholderText(/粘贴老师的课程/), {
      target: { value: sourceContent },
    });
    const analyzeButton = view.getByRole("button", { name: "开始理解内容" });
    await waitFor(() => assert.equal(analyzeButton.hasAttribute("disabled"), false));
    fireEvent.click(analyzeButton);
    await waitFor(() => assert.equal(typeof resolveAnalysis, "function"));
    fireEvent.click(view.getByRole("button", { name: "切换到B" }));

    const analysis = buildIPSourceAnalysisV2({
      sourceId: requestedSourceId,
      sourceContent,
      analyzedAt: "2026-08-24T16:00:00.000Z",
      createId: () => "00000000-0000-4000-8000-000000000061",
      candidate: {
        nodes: [{
          nodeRef: "N1",
          question: { content: "A表达了什么？", derivation: "explicit", anchors: [{ quote: sourceContent }] },
          claim: { content: "A的观点不能出现在B页面。", anchors: [{ quote: "A的观点不能出现在B页面" }] },
          reasoning: { status: "not_provided", steps: [] },
          evidence: [],
          concepts: [],
        }],
        aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
      },
    });
    await act(async () => {
      resolveAnalysis?.(new Response(JSON.stringify({
        analysis,
        analysisToken: "late-token",
        activeIPId: ipA.id,
        requestSeq: requestedSeq,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
      await Promise.resolve();
    });
    assert.equal(view.queryByText("A的观点不能出现在B页面。"), null);
    assert.equal(view.queryByText("内容理解结果"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("A保存期间切换到B后，A的迟到结果不会写入或显示成功", { timeout: 5_000 }, async () => {
  const { createTopicBoardIPProfile } = await import("./topic-board-contract.fixture");
  const { buildIPSourceAnalysisV2 } = await import("./ip-source-analysis-v2");
  const ipA = createTopicBoardIPProfile({ id: "ip-save-a", name: "保存IP A" });
  const ipB = createTopicBoardIPProfile({ id: "ip-save-b", name: "保存IP B" });
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ipA, ipB]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ipA.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const sourceContent = "老师明确说：迟到的保存不能污染新的IP。";
  let resolveFinalize: ((response: Response) => void) | undefined;
  let requestedSourceId = "";
  let finalizeRequestSeq: unknown;

  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (url === "/api/ip-source-analysis") {
        requestedSourceId = String(body.sourceId ?? "");
        const analysis = buildIPSourceAnalysisV2({
          sourceId: requestedSourceId,
          sourceContent,
          analyzedAt: "2026-08-25T18:00:00.000Z",
          createId: () => "00000000-0000-4000-8000-000000000091",
          candidate: {
            nodes: [{
              nodeRef: "N1",
              question: { content: "保存期间切换IP怎么办？", derivation: "explicit", anchors: [{ quote: sourceContent }] },
              claim: { content: "迟到的保存不能污染新的IP。", anchors: [{ quote: "迟到的保存不能污染新的IP" }] },
              reasoning: { status: "not_provided", steps: [] },
              evidence: [],
              concepts: [],
            }],
            aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
          },
        });
        return Response.json({
          analysis,
          analysisToken: "analysis-token",
          activeIPId: ipA.id,
          requestSeq: body.requestSeq,
        });
      }
      if (url === "/api/ip-source-analysis/review") {
        const analysis = body.analysis as ReturnType<typeof buildIPSourceAnalysisV2>;
        return Response.json({
          analysis: {
            ...analysis,
            nonce: analysis.nonce + 1,
            nodes: analysis.nodes.map(node => ({ ...node, reviewStatus: "human_confirmed" })),
          },
          analysisToken: "reviewed-token",
          activeIPId: ipA.id,
          requestSeq: body.requestSeq,
        });
      }
      if (url === "/api/ip-source-analysis/finalize") {
        finalizeRequestSeq = body.requestSeq;
        return await new Promise<Response>(resolve => { resolveFinalize = resolve; });
      }
      if (url === "/api/ip-source-analysis/verify") {
        return Response.json({ verified: true });
      }
      throw new Error(`未处理的测试请求：${url}`);
    };
    const { act, fireEvent, render, waitFor } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider, useIP } = await import("./ip-context");
    const OriginalSourcePage = (await import("../app/knowledge-intake/original/page")).default;
    function SwitchIP() {
      const { switchIP } = useIP();
      return <button onClick={() => switchIP(ipB.id)}>切换到保存IP B</button>;
    }
    const view = render(<IPProvider><SwitchIP /><OriginalSourcePage /></IPProvider>);
    const user = userEvent.setup({ document });

    await user.type(view.getByPlaceholderText("例如：持续输出的真正含义"), "保存竞态");
    await user.type(view.getByPlaceholderText(/粘贴老师的课程/), sourceContent);
    fireEvent.click(view.getByRole("button", { name: "开始理解内容" }));
    await view.findByText("迟到的保存不能污染新的IP。");
    await user.click(view.getByRole("button", { name: "确认" }));
    await view.findByText("人工已确认");
    await user.click(view.getByRole("button", { name: "继续保存这份原始内容" }));
    fireEvent.click(view.getByRole("button", { name: "确认保存为IP原始内容" }));
    await waitFor(() => assert.equal(typeof resolveFinalize, "function"));
    fireEvent.click(view.getByRole("button", { name: "切换到保存IP B" }));

    await act(async () => {
      resolveFinalize?.(Response.json({
        finalProof: "final-proof",
        activeIPId: ipA.id,
        sourceId: requestedSourceId,
        nonce: 2,
        requestSeq: finalizeRequestSeq,
      }));
      await Promise.resolve();
    });
    await waitFor(() => assert.equal(localStorage.getItem("ipwr:knowledgeEntries"), null));
    assert.equal(view.queryByText("IP原始内容已保存"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("A保存期间切到B再切回A后，旧A请求仍不会写入或显示成功", { timeout: 5_000 }, async () => {
  const { createTopicBoardIPProfile } = await import("./topic-board-contract.fixture");
  const { buildIPSourceAnalysisV2 } = await import("./ip-source-analysis-v2");
  const ipA = createTopicBoardIPProfile({ id: "ip-save-aba-a", name: "往返保存IP A" });
  const ipB = createTopicBoardIPProfile({ id: "ip-save-aba-b", name: "往返保存IP B" });
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ipA, ipB]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ipA.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const sourceContent = "老师明确说：切走再切回也不能接收旧保存。";
  let resolveFinalize: ((response: Response) => void) | undefined;
  let requestedSourceId = "";
  let finalizeRequestSeq: unknown;

  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (url === "/api/ip-source-analysis") {
        requestedSourceId = String(body.sourceId ?? "");
        const analysis = buildIPSourceAnalysisV2({
          sourceId: requestedSourceId,
          sourceContent,
          analyzedAt: "2026-08-25T19:00:00.000Z",
          createId: () => "00000000-0000-4000-8000-000000000092",
          candidate: {
            nodes: [{
              nodeRef: "N1",
              question: { content: "切回原IP后能否接收旧结果？", derivation: "explicit", anchors: [{ quote: sourceContent }] },
              claim: { content: "切走再切回也不能接收旧保存。", anchors: [{ quote: "切走再切回也不能接收旧保存" }] },
              reasoning: { status: "not_provided", steps: [] },
              evidence: [],
              concepts: [],
            }],
            aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
          },
        });
        return Response.json({
          analysis,
          analysisToken: "analysis-token-aba",
          activeIPId: ipA.id,
          requestSeq: body.requestSeq,
        });
      }
      if (url === "/api/ip-source-analysis/review") {
        const analysis = body.analysis as ReturnType<typeof buildIPSourceAnalysisV2>;
        return Response.json({
          analysis: {
            ...analysis,
            nonce: analysis.nonce + 1,
            nodes: analysis.nodes.map(node => ({ ...node, reviewStatus: "human_confirmed" })),
          },
          analysisToken: "reviewed-token-aba",
          activeIPId: ipA.id,
          requestSeq: body.requestSeq,
        });
      }
      if (url === "/api/ip-source-analysis/finalize") {
        finalizeRequestSeq = body.requestSeq;
        return await new Promise<Response>(resolve => { resolveFinalize = resolve; });
      }
      if (url === "/api/ip-source-analysis/verify") {
        return Response.json({ verified: true });
      }
      throw new Error(`未处理的测试请求：${url}`);
    };
    const { act, fireEvent, render, waitFor } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider, useIP } = await import("./ip-context");
    const OriginalSourcePage = (await import("../app/knowledge-intake/original/page")).default;
    function SwitchIP() {
      const { switchIP } = useIP();
      return <>
        <button onClick={() => switchIP(ipB.id)}>切换到往返IP B</button>
        <button onClick={() => switchIP(ipA.id)}>切回往返IP A</button>
      </>;
    }
    const view = render(<IPProvider><SwitchIP /><OriginalSourcePage /></IPProvider>);
    const user = userEvent.setup({ document });

    await user.type(view.getByPlaceholderText("例如：持续输出的真正含义"), "往返保存竞态");
    await user.type(view.getByPlaceholderText(/粘贴老师的课程/), sourceContent);
    fireEvent.click(view.getByRole("button", { name: "开始理解内容" }));
    await view.findByText("切走再切回也不能接收旧保存。");
    await user.click(view.getByRole("button", { name: "确认" }));
    await view.findByText("人工已确认");
    await user.click(view.getByRole("button", { name: "继续保存这份原始内容" }));
    fireEvent.click(view.getByRole("button", { name: "确认保存为IP原始内容" }));
    await waitFor(() => assert.equal(typeof resolveFinalize, "function"));
    fireEvent.click(view.getByRole("button", { name: "切换到往返IP B" }));
    fireEvent.click(view.getByRole("button", { name: "切回往返IP A" }));

    await act(async () => {
      resolveFinalize?.(Response.json({
        finalProof: "final-proof-aba",
        activeIPId: ipA.id,
        sourceId: requestedSourceId,
        nonce: 2,
        requestSeq: finalizeRequestSeq,
      }));
      await Promise.resolve();
    });
    await waitFor(() => assert.equal(localStorage.getItem("ipwr:knowledgeEntries"), null));
    assert.equal(view.queryByText("IP原始内容已保存"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("分析进行期间锁定上传、原文编辑和重新分析入口", { timeout: 5_000 }, async () => {
  const { createTopicBoardIPProfile } = await import("./topic-board-contract.fixture");
  const ip = createTopicBoardIPProfile({ id: "ip-analysis-lock", name: "分析锁测试IP" });
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  let analysisStarted = false;

  try {
    globalThis.fetch = async () => {
      analysisStarted = true;
      return await new Promise<Response>(() => undefined);
    };
    const { fireEvent, render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const OriginalSourcePage = (await import("../app/knowledge-intake/original/page")).default;
    const view = render(<IPProvider><OriginalSourcePage /></IPProvider>);
    const user = userEvent.setup({ document });
    const titleInput = view.getByPlaceholderText("例如：持续输出的真正含义") as HTMLInputElement;
    const sourceInput = view.getByPlaceholderText(/粘贴老师的课程/) as HTMLTextAreaElement;
    const fileInput = view.container.querySelector('input[type="file"]') as HTMLInputElement;

    await user.type(sourceInput, "老师原始内容");
    fireEvent.click(view.getByRole("button", { name: "开始理解内容" }));

    assert.equal(analysisStarted, true);
    assert.equal(titleInput.disabled, true);
    assert.equal(sourceInput.disabled, true);
    assert.equal(fileInput.disabled, true);
    assert.equal((view.getByRole("button", { name: "正在理解原始内容……" }) as HTMLButtonElement).disabled, true);
    assert.ok(view.getByRole("status").textContent?.includes("处理中，请勿修改原始内容"));

  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("审核请求进行中锁定操作，连续点击不会发出第二次确认", async () => {
  const { createTopicBoardIPProfile } = await import("./topic-board-contract.fixture");
  const { buildIPSourceAnalysisV2 } = await import("./ip-source-analysis-v2");
  const {
    buildIPSourceAnalysisProofClaims,
    createIPSourceAnalysisToken,
    digestIPSourceAnalysisProofClaims,
  } = await import("./ip-source-analysis-proof");
  const { initializeIPSourceLedger } = await import("./ip-source-ledger");
  const { POST: reviewPOST } = await import("../app/api/ip-source-analysis/review/route");
  const { NextRequest } = await import("next/server");
  const ip = createTopicBoardIPProfile({ id: "ip-review-lock", name: "审核锁测试IP" });
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const sourceContent = "老师明确说：审核过程中不能重复提交。";
  let reviewCalls = 0;
  let releaseReview: (() => void) | undefined;

  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (url === "/api/ip-source-analysis") {
        const analysis = buildIPSourceAnalysisV2({
          sourceId: String(body.sourceId),
          sourceContent,
          analyzedAt: "2026-08-24T17:00:00.000Z",
          createId: () => "00000000-0000-4000-8000-000000000081",
          candidate: {
            nodes: [{
              nodeRef: "N1",
              question: { content: "审核时应避免什么？", derivation: "explicit", anchors: [{ quote: sourceContent }] },
              claim: { content: "审核过程中不能重复提交。", anchors: [{ quote: "审核过程中不能重复提交" }] },
              reasoning: { status: "not_provided", steps: [] },
              evidence: [],
              concepts: [],
            }],
            aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
          },
        });
        const claims = buildIPSourceAnalysisProofClaims({ ipId: ip.id, analysis });
        await initializeIPSourceLedger({
          sourceId: analysis.sourceId,
          ipId: ip.id,
          nonce: analysis.nonce,
          digest: digestIPSourceAnalysisProofClaims(claims),
        });
        return Response.json({
          analysis,
          analysisToken: createIPSourceAnalysisToken(claims, PROOF_SECRET),
          activeIPId: ip.id,
          requestSeq: body.requestSeq,
        });
      }
      if (url === "/api/ip-source-analysis/review") {
        reviewCalls += 1;
        const reviewedResponse = await reviewPOST(new NextRequest(
          "http://localhost/api/ip-source-analysis/review",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        ));
        return new Promise<Response>(resolve => {
          releaseReview = () => resolve(reviewedResponse);
        });
      }
      throw new Error(`未处理的测试请求：${url}`);
    };

    const { act, fireEvent, render, waitFor } = await import("@testing-library/react");
    const { IPProvider } = await import("./ip-context");
    const OriginalSourcePage = (await import("../app/knowledge-intake/original/page")).default;
    const view = render(<IPProvider><OriginalSourcePage /></IPProvider>);
    fireEvent.change(view.getByPlaceholderText(/粘贴老师的课程/), {
      target: { value: sourceContent },
    });
    const analyzeButton = view.getByRole("button", { name: "开始理解内容" });
    await waitFor(() => assert.equal(analyzeButton.hasAttribute("disabled"), false));
    fireEvent.click(analyzeButton);
    const confirmButton = await view.findByRole("button", { name: "确认" });

    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    await waitFor(() => assert.equal(reviewCalls, 1));
    await waitFor(() => assert.equal(typeof releaseReview, "function"));
    assert.equal(confirmButton.hasAttribute("disabled"), true);

    await act(async () => {
      releaseReview?.();
      await Promise.resolve();
    });
    assert.ok(await view.findByText("人工已确认"));
    assert.equal(view.getByRole("button", { name: "确认" }).hasAttribute("disabled"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("旧版V1解析仍按原有列表确认并保存，不误入V2认知卡片", async () => {
  const { createTopicBoardIPProfile } = await import("./topic-board-contract.fixture");
  const ip = createTopicBoardIPProfile({ id: "ip-v1-preview", name: "V1测试IP" });
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const sourceContent = "老师明确说：旧版内容仍需正常保存。";
  let requestedSourceId = "";

  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "/api/ip-source-analysis");
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requestedSourceId = String(body.sourceId ?? "");
      return new Response(JSON.stringify({
        analysis: {
          analyzedAt: "2026-08-24T15:00:00.000Z",
          parserVersion: 1,
          items: [{
            id: "V1-01",
            kind: "claim",
            content: "旧版内容仍需正常保存。",
            sourceId: requestedSourceId,
            startPosition: 0,
            endPosition: sourceContent.length,
            originalExcerpt: sourceContent,
            extractionStatus: "AI提取",
          }],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const { render, waitFor } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const OriginalSourcePage = (await import("../app/knowledge-intake/original/page")).default;
    const view = render(<IPProvider><OriginalSourcePage /></IPProvider>);
    const user = userEvent.setup({ document });

    await user.type(view.getByPlaceholderText("例如：持续输出的真正含义"), "旧版资料");
    await user.type(view.getByPlaceholderText(/粘贴老师的课程/), sourceContent);
    await user.click(view.getByRole("button", { name: "开始理解内容" }));
    await waitFor(() => assert.ok(view.getByText("旧版内容仍需正常保存。")));
    assert.ok(view.getByRole("button", { name: "全部确认原意" }));
    assert.equal(view.queryByText("原始内容证据"), null);

    await user.click(view.getByRole("button", { name: "确认原意" }));
    await user.click(view.getByRole("button", { name: "继续保存这份原始内容" }));
    await user.click(view.getByRole("button", { name: "确认保存为IP原始内容" }));
    await waitFor(() => assert.ok(view.getByText("IP原始内容已保存")));

    const saved = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{
      id: string;
      sourceAnalysis?: { parserVersion?: number };
    }>;
    assert.equal(saved[0]?.id, requestedSourceId);
    assert.equal(saved[0]?.sourceAnalysis?.parserVersion, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
