import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import {
  addEvaluatedTopicAsset,
  addTopicAsset,
  getScriptAssets,
  updateTopicAssetStatus,
} from "./ip-store";
import {
  createTopicBoardIPProfile,
  createValidTopicBoardResult,
} from "./topic-board-contract.fixture";
import { getPartialScriptDraft, savePartialScriptDraft } from "./script-factory-draft";
import { buildIPSourceAnalysisV2 } from "./ip-source-analysis-v2";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/topic-board",
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
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
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

let restoreBrowser: (() => void) | undefined;

function createCompleteScriptResponse(ipId: string, ipName: string, topic: string) {
  return {
    generationStatus: "complete",
    partialFailure: null,
    ipId,
    ipName,
    topic,
    platform: "视频号",
    formatCategory: "short",
    formatLabel: "短视频",
    durationSeconds: 60,
    durationLabel: "60秒",
    goal: "建立信任",
    videoType: "口播",
    outputLabels: {
      cover: "封面文案",
      outline: "脚本大纲",
      shooting: "拍摄建议",
      comment: "评论区引导",
    },
    titles: [{ title: "聪明人为什么越来越焦虑", formula: "反常识", platform: "视频号", whyFitsIP: "符合IP定位" }],
    coverCopy: ["越聪明，越焦虑？"],
    outline: [{ label: "开头", timeRange: "0-10秒", content: "先给出反常识判断" }],
    commentGuidance: {
      interactionPrompt: "你怎么看？",
      keywordReplies: [],
      dmGuidance: "无",
      materialPackGuidance: "无",
    },
    ipStyleExplanation: "使用当前IP的表达风格",
    storyboard: [],
    shootingSuggestions: [],
    shotPrompts: [],
    editingRhythm: {
      subtitleHighlights: [],
      soundEffects: [],
      screenRecordingCuts: [],
      caseInserts: [],
      pauses: [],
    },
    apiMeta: {
      apiCalled: true,
      calledAt: "2026-08-08T00:00:00.000Z",
      model: "deepseek-chat",
      ipUsed: ipName,
      mockHit: false,
    },
    globalConstraintReview: {
      reviewRequired: false,
      detectionMode: "keyword",
      semanticAssessment: "not_implemented",
      matches: [],
      source: "server_ledger",
    },
  };
}

function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("页面没有发出脚本生成请求")), timeoutMs);
    promise.then(
      value => {
        clearTimeout(timeout);
        resolve(value);
      },
      error => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequestIPId(requestBody: Record<string, unknown>): string | null {
  const ipProfile = requestBody.ipProfile;
  return isRecord(ipProfile) && typeof ipProfile.id === "string" ? ipProfile.id : null;
}

function seedConfirmedBoundarySource(ipId: string) {
  const sourceId = `script-boundary-source-${ipId}`;
  const rawContent = "老师明确说：持续输出来自问题深化，而不是机械日更。";
  const extracted = buildIPSourceAnalysisV2({
    sourceId,
    sourceContent: rawContent,
    analyzedAt: "2026-08-26T12:00:00.000Z",
    createId: () => "00000000-0000-4000-8000-000000000302",
    candidate: {
      nodes: [{
        nodeRef: "N1",
        question: { content: "持续输出依靠什么？", derivation: "explicit", anchors: [{ quote: rawContent }] },
        claim: { content: "持续输出来自问题深化。", anchors: [{ quote: "持续输出来自问题深化" }] },
        reasoning: { status: "not_provided", steps: [] },
        evidence: [],
        concepts: [],
      }],
      aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
    },
  });
  const analysis = {
    ...extracted,
    nonce: 2,
    nodes: extracted.nodes.map(node => ({ ...node, reviewStatus: "human_confirmed" as const })),
  };
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([{
    id: sourceId,
    category: "IP原始内容",
    title: "页面准入测试认知",
    rawContent,
    sourceAnalysis: analysis,
    sourceFinalProof: "page-boundary-final-proof",
    sourceLegacyProof: null,
    ipId,
    createdAt: "2026-08-26T12:00:00.000Z",
  }]));
  return analysis.nodes[0]!.id;
}

function alignedBoundaryResponse(nodeId: string) {
  return new Response(JSON.stringify({
    report: {
      coverage: "FULL",
      stance: "ALIGNED",
      explanation: "当前选题已有人工确认认知支撑。",
      matchedNodeIds: [nodeId],
      conflictingNodeIds: [],
      supportedParts: ["核心观点"],
      missingElements: [],
    },
    evidenceNodes: [{
      nodeId,
      relation: "matched",
      verificationStatus: "human_confirmed",
      question: "持续输出依靠什么？",
      claim: "持续输出来自问题深化。",
      reasoningSteps: [],
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function partialBoundaryResponse(nodeId: string) {
  return new Response(JSON.stringify({
    report: {
      coverage: "PARTIAL",
      stance: "ALIGNED",
      explanation: "已有观点支持方向，但缺少具体案例。",
      matchedNodeIds: [nodeId],
      conflictingNodeIds: [],
      supportedParts: ["核心观点"],
      missingElements: ["CASE"],
    },
    evidenceNodes: [{
      nodeId,
      relation: "matched",
      verificationStatus: "human_confirmed",
      question: "持续输出依靠什么？",
      claim: "持续输出来自问题深化。",
      reasoningSteps: [],
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function unlockGeneration(
  view: ReturnType<typeof import("@testing-library/react").render>,
  user: Awaited<ReturnType<typeof import("@testing-library/user-event").default.setup>>,
) {
  await user.click(view.getByRole("button", { name: "IP专属生成" }));
  return view.getByRole("button", { name: "生成IP专属内容" });
}

before(() => {
  restoreBrowser = installBrowserEnvironment();
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/topic-board");
});

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  window.sessionStorage.clear();
});

after(() => {
  restoreBrowser?.();
});

test("选题历史只为已评估和已采用选题提供经典脚本入口", async () => {
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));

  const evaluated = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "已评估选题",
    source: "manual",
  }, { ...boardResult, topic: "已评估选题" });
  const adopted = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "已采用选题",
    source: "manual",
  }, { ...boardResult, topic: "已采用选题" });
  updateTopicAssetStatus(adopted.id, "已采用");
  const draft = addTopicAsset({ ipId: ip.id, title: "草稿选题", source: "manual" });
  const filmed = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "已拍摄选题",
    source: "manual",
  }, { ...boardResult, topic: "已拍摄选题" });
  updateTopicAssetStatus(filmed.id, "已采用");
  updateTopicAssetStatus(filmed.id, "已拍摄");
  const discarded = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "已废弃选题",
    source: "manual",
  }, { ...boardResult, topic: "已废弃选题" });
  updateTopicAssetStatus(discarded.id, "已废弃");

  const { render, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const TopicBoardPage = (await import("../app/topic-board/page")).default;
  const user = userEvent.setup({ document });
  const view = render(
    <IPProvider>
      <TopicBoardPage />
    </IPProvider>,
  );

  const history = await view.findByRole("region", { name: "当前IP选题历史" });
  const generateButtons = within(history).getAllByRole("button", { name: /生成脚本/ });
  assert.equal(generateButtons.length, 2);
  const evaluatedButton = within(history).getByRole("button", { name: `用选题“${evaluated.title}”生成脚本` });
  within(history).getByRole("button", { name: `用选题“${adopted.title}”生成脚本` });
  for (const asset of [draft, filmed, discarded]) {
    assert.equal(
      within(history).queryByRole("button", { name: `用选题“${asset.title}”生成脚本` }),
      null,
    );
  }

  await user.click(evaluatedButton);
  assert.equal(
    Boolean(await view.findByRole("region", { name: "认知边界审计" })),
    true,
  );
});

test("脚本工厂通过topicId读取当前IP的合法选题并明确显示关联", async () => {
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "为什么聪明人反而越来越焦虑",
    source: "manual",
  }, { ...boardResult, topic: "为什么聪明人反而越来越焦虑" });
  window.history.replaceState({}, "", `/script-factory?topicId=${encodeURIComponent(topic.id)}`);

  const { render, within } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
  const view = render(
    <IPProvider>
      <ScriptFactoryPage />
    </IPProvider>,
  );

  const topicInput = await view.findByDisplayValue(topic.title) as HTMLTextAreaElement;
  assert.equal(topicInput.value, topic.title);
  const linkedTopicHeading = view.getByText("当前关联选题");
  const linkedTopicBanner = linkedTopicHeading.parentElement;
  assert.ok(linkedTopicBanner);
  assert.ok(within(linkedTopicBanner).getByText(topic.title));
  assert.ok(view.getByRole("button", { name: "生成完整内容" }));
});

test("直接通过URL打开冲突选题时脚本工厂必须先审计并阻止生成", async () => {
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "如何靠疯狂日更快速涨粉",
    source: "manual",
  }, { ...boardResult, topic: "如何靠疯狂日更快速涨粉" });
  const sourceId = "script-boundary-source";
  const rawContent = "老师明确说：持续输出不等于日更。";
  const extracted = buildIPSourceAnalysisV2({
    sourceId,
    sourceContent: rawContent,
    analyzedAt: "2026-08-26T12:00:00.000Z",
    createId: () => "00000000-0000-4000-8000-000000000301",
    candidate: {
      nodes: [{
        nodeRef: "N1",
        question: { content: "持续输出是否等于日更？", derivation: "explicit", anchors: [{ quote: rawContent }] },
        claim: { content: "持续输出不等于日更。", anchors: [{ quote: "持续输出不等于日更" }] },
        reasoning: { status: "not_provided", steps: [] },
        evidence: [],
        concepts: [],
      }],
      aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
    },
  });
  const analysis = {
    ...extracted,
    nonce: 2,
    nodes: extracted.nodes.map(node => ({ ...node, reviewStatus: "human_confirmed" as const })),
  };
  const nodeId = analysis.nodes[0]!.id;
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([{
    id: sourceId,
    category: "IP原始内容",
    title: "持续输出认知",
    rawContent,
    sourceKind: "直播逐字稿",
    sourceName: "持续输出.txt",
    sourceAnalysis: analysis,
    sourceFinalProof: "final-proof-for-script-boundary-test",
    sourceLegacyProof: null,
    tags: [],
    keywords: [],
    ipId: ip.id,
    sourceTier: "高",
    sourceTierReason: "测试中的已确认原始内容",
    contentDirection: [],
    sourcePlatform: "直播逐字稿",
    sourceUrl: "",
    note: "",
    createdAt: "2026-08-26T12:00:00.000Z",
    extractedAt: analysis.analyzedAt,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    trustStatus: null,
    sourceReference: null,
    executionTemplate: null,
    dna: null,
  }]));
  window.history.replaceState({}, "", `/script-factory?topicId=${encodeURIComponent(topic.id)}`);

  let boundaryCalls = 0;
  let generationCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/ip-boundary/check") {
      boundaryCalls += 1;
      return new Response(JSON.stringify({
        report: {
          coverage: "PARTIAL",
          stance: "CONFLICTING",
          explanation: "该选题与已确认的持续输出观点相反。",
          matchedNodeIds: [],
          conflictingNodeIds: [nodeId],
          supportedParts: ["日更"],
          missingElements: ["REASONING"],
        },
        evidenceNodes: [{
          nodeId,
          relation: "conflicting",
          verificationStatus: "human_confirmed",
          question: "持续输出是否等于日更？",
          claim: "持续输出不等于日更。",
          reasoningSteps: [],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input) === "/api/script-factory") generationCalls += 1;
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { render } = await import("@testing-library/react");
    const { IPProvider } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    assert.ok(await view.findByText("立场冲突"));
    assert.equal(boundaryCalls, 1);
    assert.equal((view.getByRole("button", { name: "生成完整内容" }) as HTMLButtonElement).disabled, true);
    assert.equal(generationCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("直接URL审计通过后修改选题会立即让准入结果失效", async () => {
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "持续输出为什么不等于日更",
    source: "manual",
  }, { ...boardResult, topic: "持续输出为什么不等于日更" });
  const boundaryNodeId = seedConfirmedBoundarySource(ip.id);
  window.history.replaceState({}, "", `/script-factory?topicId=${encodeURIComponent(topic.id)}`);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/ip-boundary/check") return alignedBoundaryResponse(boundaryNodeId);
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    assert.ok(await view.findByText("认知充分匹配"));
    const input = view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文");
    await user.clear(input);
    await user.type(input, "完全不同的新选题");

    assert.ok(await view.findByText("选题内容已变更，请重新审计"));
    assert.equal((view.getByRole("button", { name: "生成完整内容" }) as HTMLButtonElement).disabled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("直接URL仅部分覆盖时生成前必须二次确认", async () => {
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "推荐5个精准减负工具",
    source: "manual",
  }, { ...boardResult, topic: "推荐5个精准减负工具" });
  const boundaryNodeId = seedConfirmedBoundarySource(ip.id);
  window.history.replaceState({}, "", `/script-factory?topicId=${encodeURIComponent(topic.id)}`);

  let generationCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/ip-boundary/check") return partialBoundaryResponse(boundaryNodeId);
    if (String(input) === "/api/script-factory") generationCalls += 1;
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    assert.ok(await view.findByText("认知部分覆盖"));
    await user.click(view.getByRole("button", { name: "生成完整内容" }));
    assert.ok(await view.findByRole("dialog", { name: "认知覆盖不完整" }));
    assert.equal(generationCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("直接URL读取到损坏认知时不崩溃且保持生成锁定", async () => {
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "损坏认知不能绕过门禁",
    source: "manual",
  }, { ...boardResult, topic: "损坏认知不能绕过门禁" });
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([{
    id: "damaged-cognition-source",
    category: "IP原始内容",
    title: "损坏认知",
    createdAt: "2026-08-26T12:00:00.000Z",
    rawContent: "原始内容",
    sourceAnalysis: { parserVersion: 2, sourceId: "wrong-source" },
    ipId: ip.id,
  }]));
  window.history.replaceState({}, "", `/script-factory?topicId=${encodeURIComponent(topic.id)}`);

  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
  const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

  assert.ok(await view.findByText("部分认知数据损坏，请尝试重新解析相关资料"));
  assert.ok(view.getByRole("button", { name: "重新读取认知数据" }));
  assert.equal((view.getByRole("button", { name: "生成完整内容" }) as HTMLButtonElement).disabled, true);
  assert.notEqual(localStorage.getItem("ipwr:knowledgeEntries"), null, "容错入口不得自动删除原数据");
});

test("修复损坏认知后点击重新读取会自动重新审计", async () => {
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "修复后应自动重审",
    source: "manual",
  }, { ...boardResult, topic: "修复后应自动重审" });
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([{
    id: "damaged-cognition-source",
    category: "IP原始内容",
    title: "损坏认知",
    createdAt: "2026-08-26T12:00:00.000Z",
    rawContent: "原始内容",
    sourceAnalysis: { parserVersion: 2, sourceId: "wrong-source" },
    ipId: ip.id,
  }]));
  window.history.replaceState({}, "", `/script-factory?topicId=${encodeURIComponent(topic.id)}`);

  let boundaryCalls = 0;
  let repairedNodeId = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/ip-boundary/check") {
      boundaryCalls += 1;
      return alignedBoundaryResponse(repairedNodeId);
    }
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    assert.ok(await view.findByText("部分认知数据损坏，请尝试重新解析相关资料"));
    localStorage.removeItem("ipwr:knowledgeEntries");
    repairedNodeId = seedConfirmedBoundarySource(ip.id);
    await user.click(view.getByRole("button", { name: "重新读取认知数据" }));

    assert.ok(await view.findByText("认知充分匹配"));
    assert.equal(boundaryCalls, 1);
    assert.equal((view.getByRole("button", { name: "生成完整内容" }) as HTMLButtonElement).disabled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("URL打开选题B时不会继续展示同一IP选题A的旧草稿内容", { timeout: 5000 }, async () => {
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topicA = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "选题A的旧草稿",
    source: "manual",
  }, { ...boardResult, topic: "选题A的旧草稿" });
  const topicB = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "新打开的选题B",
    source: "manual",
  }, { ...boardResult, topic: "新打开的选题B" });
  const oldDraftResult = {
    ...createCompleteScriptResponse(ip.id, ip.name, topicA.title),
    generationStatus: "partial" as const,
    partialFailure: {
      stage: "storyboard" as const,
      errorCode: "STORYBOARD_FAILED",
      message: "选题A的核心脚本已保留。",
    },
  };
  assert.equal(savePartialScriptDraft({
    version: 1,
    ipId: ip.id,
    topicId: topicA.id,
    topic: topicA.title,
    savedAt: "2026-08-08T12:00:00.000Z",
    failedStage: "storyboard",
    warning: "选题A的分镜生成失败",
    generationSettings: {
      platform: "视频号",
      formatCategory: "short",
      durationSeconds: 60,
      goal: "建立信任",
      videoType: "口播",
      needsStoryboard: true,
      needsShootingTips: true,
    },
    result: oldDraftResult,
  }), true);
  window.history.replaceState({}, "", `/script-factory?topicId=${encodeURIComponent(topicB.id)}`);

  const { render, within } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
  const view = render(
    <IPProvider>
      <ScriptFactoryPage />
    </IPProvider>,
  );

  await view.findByDisplayValue(topicB.title);
  const heading = view.getByText("当前关联选题");
  const banner = heading.parentElement;
  assert.ok(banner);
  assert.ok(within(banner).getByText(topicB.title));
  assert.equal(
    view.queryByText("核心脚本已保留，补充内容未完成") === null,
    true,
    "切换到选题B后不应继续展示选题A的部分成功状态",
  );
  assert.equal(
    view.queryByText("先给出反常识判断") === null,
    true,
    "切换到选题B后不应继续展示选题A的旧脚本内容",
  );
});

test("从有草稿的IP切换到无草稿IP时清除旧选题关联", { timeout: 5000 }, async () => {
  const ipWithDraft = createTopicBoardIPProfile();
  const ipWithoutDraft = createTopicBoardIPProfile({ id: "ip-without-draft", name: "无草稿IP" });
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ipWithDraft, ipWithoutDraft]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ipWithDraft.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topic = addEvaluatedTopicAsset({
    ipId: ipWithDraft.id,
    title: "旧IP的关联选题",
    source: "manual",
  }, { ...boardResult, topic: "旧IP的关联选题" });
  const oldDraftResult = {
    ...createCompleteScriptResponse(ipWithDraft.id, ipWithDraft.name, topic.title),
    generationStatus: "partial" as const,
    partialFailure: {
      stage: "storyboard" as const,
      errorCode: "STORYBOARD_FAILED",
      message: "旧IP的核心脚本已保留。",
    },
  };
  assert.equal(savePartialScriptDraft({
    version: 1,
    ipId: ipWithDraft.id,
    topicId: topic.id,
    topic: topic.title,
    savedAt: "2026-08-08T12:00:00.000Z",
    failedStage: "storyboard",
    warning: "旧IP的分镜生成失败",
    generationSettings: {
      platform: "视频号",
      formatCategory: "short",
      durationSeconds: 60,
      goal: "建立信任",
      videoType: "口播",
      needsStoryboard: true,
      needsShootingTips: true,
    },
    result: oldDraftResult,
  }), true);
  window.history.replaceState({}, "", "/script-factory");

  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider, useIP } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
  const user = userEvent.setup({ document });
  function SwitchIPControl() {
    const { activeIP, switchIP } = useIP();
    return (
      <div>
        <span>{`测试当前IP：${activeIP?.id ?? "无"}`}</span>
        <button type="button" onClick={() => switchIP(ipWithoutDraft.id)}>切换到无草稿IP</button>
      </div>
    );
  }
  const view = render(
    <IPProvider>
      <SwitchIPControl />
      <ScriptFactoryPage />
    </IPProvider>,
  );

  await view.findByText("当前关联选题");
  await user.click(view.getByRole("button", { name: "切换到无草稿IP" }));
  await view.findByText(`测试当前IP：${ipWithoutDraft.id}`);
  assert.equal(
    view.queryByText("当前关联选题") === null,
    true,
    "切换到没有草稿的新IP后不应保留旧IP的选题关联",
  );
});

test("拒绝恢复外层IP与内部结果IP不一致的损坏草稿", { timeout: 5000 }, async () => {
  const activeIP = createTopicBoardIPProfile();
  const otherIP = createTopicBoardIPProfile({ id: "ip-inside-draft", name: "草稿内部IP" });
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([activeIP, otherIP]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(activeIP.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topic = addEvaluatedTopicAsset({
    ipId: activeIP.id,
    title: "外层归属正确但内部损坏的草稿",
    source: "manual",
  }, { ...boardResult, topic: "外层归属正确但内部损坏的草稿" });
  const mismatchedResult = {
    ...createCompleteScriptResponse(otherIP.id, otherIP.name, topic.title),
    generationStatus: "partial" as const,
    partialFailure: {
      stage: "storyboard" as const,
      errorCode: "STORYBOARD_FAILED",
      message: "不应展示的跨IP结果。",
    },
  };
  assert.equal(savePartialScriptDraft({
    version: 1,
    ipId: activeIP.id,
    topicId: topic.id,
    topic: topic.title,
    savedAt: "2026-08-08T12:00:00.000Z",
    failedStage: "storyboard",
    warning: "损坏草稿",
    generationSettings: {
      platform: "视频号",
      formatCategory: "short",
      durationSeconds: 60,
      goal: "建立信任",
      videoType: "口播",
      needsStoryboard: true,
      needsShootingTips: true,
    },
    result: mismatchedResult,
  }), true);
  window.history.replaceState({}, "", "/script-factory");

  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
  const view = render(
    <IPProvider>
      <ScriptFactoryPage />
    </IPProvider>,
  );

  await view.findByText("本地临时草稿数据不完整，已停止自动恢复。");
  assert.equal(
    view.queryByText("核心脚本已保留，补充内容未完成") === null,
    true,
    "内外IP不一致的草稿不应展示脚本结果",
  );
  assert.equal(
    view.queryByText("当前关联选题") === null,
    true,
    "内外IP不一致的草稿不应恢复选题关联",
  );
});

test("生成失败后也拒绝恢复外层IP与内部结果IP不一致的损坏草稿", { timeout: 5000 }, async () => {
  const originalFetch = globalThis.fetch;
  const activeIP = createTopicBoardIPProfile();
  const otherIP = createTopicBoardIPProfile({ id: "ip-inside-failed-draft", name: "失败草稿内部IP" });
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([activeIP, otherIP]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(activeIP.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topic = addEvaluatedTopicAsset({
    ipId: activeIP.id,
    title: "生成失败后不能恢复跨IP草稿",
    source: "manual",
  }, { ...boardResult, topic: "生成失败后不能恢复跨IP草稿" });
  const boundaryNodeId = seedConfirmedBoundarySource(activeIP.id);
  const mismatchedResult = {
    ...createCompleteScriptResponse(otherIP.id, otherIP.name, topic.title),
    generationStatus: "partial" as const,
    partialFailure: {
      stage: "storyboard" as const,
      errorCode: "STORYBOARD_FAILED",
      message: "不应在失败后恢复的跨IP结果。",
    },
  };
  assert.equal(savePartialScriptDraft({
    version: 1,
    ipId: activeIP.id,
    topicId: topic.id,
    topic: topic.title,
    savedAt: "2026-08-08T12:00:00.000Z",
    failedStage: "storyboard",
    warning: "损坏草稿",
    generationSettings: {
      platform: "视频号",
      formatCategory: "short",
      durationSeconds: 60,
      goal: "建立信任",
      videoType: "口播",
      needsStoryboard: true,
      needsShootingTips: true,
    },
    result: mismatchedResult,
  }), true);
  window.history.replaceState({}, "", `/script-factory?topicId=${encodeURIComponent(topic.id)}`);
  globalThis.fetch = async (input) => {
    if (String(input) === "/api/ip-boundary/check") {
      return alignedBoundaryResponse(boundaryNodeId);
    }
    if (String(input) === "/api/script-factory") {
      return new Response(JSON.stringify({ error: "模拟生成失败" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ results: [], debug: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(
      <IPProvider>
        <ScriptFactoryPage />
      </IPProvider>,
    );

    await view.findByDisplayValue(topic.title);
    await user.click(await unlockGeneration(view, user));
    assert.ok(await view.findByText(`${activeIP.name}：API返回错误（HTTP 502）：模拟生成失败`));
    assert.equal(
      view.queryByText("核心脚本已保留，补充内容未完成") === null,
      true,
      "生成失败后仍不应展示跨IP损坏草稿的部分成功状态",
    );
    assert.equal(
      view.queryByText("先给出反常识判断") === null,
      true,
      "生成失败后仍不应展示跨IP损坏草稿的旧脚本内容",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("脚本工厂从会话存储读取当前选题临时认知并贯穿审计与生成请求", async () => {
  const originalFetch = globalThis.fetch;
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "为什么聪明人反而越来越焦虑",
    source: "manual",
  }, { ...boardResult, topic: "为什么聪明人反而越来越焦虑" });
  const boundaryNodeId = seedConfirmedBoundarySource(ip.id);
  const sourceId = "interview-source-script-page-ephemeral";
  const rawContent = "老师补充：信息摄入过量会挤压思考时间。";
  const extracted = buildIPSourceAnalysisV2({
    sourceId,
    sourceContent: rawContent,
    analyzedAt: "2026-08-26T15:00:00.000Z",
    createId: () => "00000000-0000-4000-8000-000000000399",
    candidate: {
      nodes: [{
        nodeRef: "N1",
        question: { content: "焦虑为什么增加？", derivation: "inferred", anchors: [{ quote: rawContent }] },
        claim: { content: "信息摄入过量会挤压思考时间。", anchors: [{ quote: "信息摄入过量会挤压思考时间" }] },
        reasoning: { status: "not_provided", steps: [] },
        evidence: [],
        concepts: [],
      }],
      aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
    },
  });
  const temporaryContext = {
    activeIPId: ip.id,
    topicId: topic.id,
    sourceId,
    rawContent,
    analysis: {
      ...extracted,
      nodes: extracted.nodes.map(node => ({ ...node, reviewStatus: "human_confirmed" as const })),
    },
    temporaryProof: "page-test-ephemeral-proof",
    expiresAt: Date.now() + 60_000,
  };
  window.sessionStorage.setItem(
    `FP_EPHEMERAL_COGNITION_V1:${encodeURIComponent(ip.id)}:${encodeURIComponent(topic.id)}`,
    JSON.stringify(temporaryContext),
  );
  window.history.replaceState({}, "", `/script-factory?topicId=${encodeURIComponent(topic.id)}`);
  let boundaryRequest: Record<string, unknown> = {};
  let generationRequest: Record<string, unknown> = {};

  globalThis.fetch = async (input, init) => {
    const requestBody: unknown = JSON.parse(String(init?.body ?? "{}"));
    if (String(input) === "/api/ip-boundary/check") {
      if (!isRecord(requestBody)) throw new Error("边界审计请求体不是对象");
      boundaryRequest = requestBody;
      return alignedBoundaryResponse(boundaryNodeId);
    }
    if (String(input) === "/api/script-factory") {
      if (!isRecord(requestBody)) throw new Error("脚本生成请求体不是对象");
      generationRequest = requestBody;
      return new Response(JSON.stringify(createCompleteScriptResponse(ip.id, ip.name, topic.title)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ results: [], debug: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { render, waitFor } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(
      <IPProvider>
        <ScriptFactoryPage />
      </IPProvider>,
    );

    await view.findByDisplayValue(topic.title);
    await user.click(await unlockGeneration(view, user));
    await waitFor(() => assert.ok(generationRequest.topic));
    assert.deepEqual(boundaryRequest?.temporaryContext, temporaryContext);
    assert.equal(boundaryRequest?.topicId, topic.id);
    assert.deepEqual(generationRequest?.temporaryCognition, temporaryContext);
    assert.equal(generationRequest?.topicId, topic.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("关联选题完整生成成功后保存真实topicId和同一IP", async () => {
  const originalFetch = globalThis.fetch;
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "为什么聪明人反而越来越焦虑",
    source: "manual",
  }, { ...boardResult, topic: "为什么聪明人反而越来越焦虑" });
  const boundaryNodeId = seedConfirmedBoundarySource(ip.id);
  window.history.replaceState({}, "", `/script-factory?topicId=${encodeURIComponent(topic.id)}`);
  let resolveCapturedRequest: (requestBody: Record<string, unknown>) => void = () => {
    throw new Error("请求捕获通道尚未初始化");
  };
  const capturedRequest = new Promise<Record<string, unknown>>(resolve => {
    resolveCapturedRequest = resolve;
  });

  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/ip-boundary/check") {
      return alignedBoundaryResponse(boundaryNodeId);
    }
    if (String(input) === "/api/script-factory") {
      const requestBody: unknown = JSON.parse(String(init?.body ?? "{}"));
      if (!isRecord(requestBody)) throw new Error("脚本工厂请求体不是对象");
      resolveCapturedRequest(requestBody);
      return new Response(JSON.stringify(createCompleteScriptResponse(ip.id, ip.name, topic.title)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ results: [], debug: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { render, waitFor } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(
      <IPProvider>
        <ScriptFactoryPage />
      </IPProvider>,
    );

    await view.findByDisplayValue(topic.title);
    await user.click(await unlockGeneration(view, user));
    const requestBody = await waitWithTimeout(capturedRequest, 3000);
    await waitFor(() => assert.equal(getScriptAssets(ip.id).length, 1));

    assert.equal(requestBody.topic, topic.title);
    assert.equal(readRequestIPId(requestBody), ip.id);
    const [saved] = getScriptAssets(ip.id);
    assert.equal(saved.topicId, topic.id);
    assert.equal(saved.ipId, ip.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("关联选题生成期间修改选题会丢弃旧结果且不保存", { timeout: 5000 }, async () => {
  const originalFetch = globalThis.fetch;
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "生成期间不能更换选题",
    source: "manual",
  }, { ...boardResult, topic: "生成期间不能更换选题" });
  const boundaryNodeId = seedConfirmedBoundarySource(ip.id);
  window.history.replaceState({}, "", `/script-factory?topicId=${encodeURIComponent(topic.id)}`);

  let releaseResponse!: () => void;
  let markRequested!: () => void;
  const requested = new Promise<void>(resolve => {
    markRequested = resolve;
  });
  globalThis.fetch = async input => {
    if (String(input) === "/api/ip-boundary/check") {
      return alignedBoundaryResponse(boundaryNodeId);
    }
    if (String(input) === "/api/script-factory") {
      markRequested();
      return new Promise<Response>(resolve => {
        releaseResponse = () => resolve(new Response(
          JSON.stringify(createCompleteScriptResponse(ip.id, ip.name, topic.title)),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ));
      });
    }
    return new Response(JSON.stringify({ results: [], debug: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { act, render, waitFor } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(
      <IPProvider>
        <ScriptFactoryPage />
      </IPProvider>,
    );

    await view.findByDisplayValue(topic.title);
    const clickGeneration = user.click(await unlockGeneration(view, user));
    await waitWithTimeout(requested, 3000);

    const input = view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文");
    await user.clear(input);
    await user.type(input, "生成期间修改后的新选题");
    assert.ok(await view.findByText("选题内容已变更，请重新审计"));

    await act(async () => {
      releaseResponse();
    });
    await clickGeneration;

    await waitFor(() => assert.equal(getScriptAssets(ip.id).length, 0));
    assert.equal(view.queryByText("先给出反常识判断"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("关联选题生成期间切换IP会停止保存并给出明确提示", { timeout: 5000 }, async () => {
  const originalFetch = globalThis.fetch;
  const ip = createTopicBoardIPProfile();
  const otherIP = createTopicBoardIPProfile({ id: "ip-other", name: "另一个IP" });
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip, otherIP]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "切换IP时不能误存",
    source: "manual",
  }, { ...boardResult, topic: "切换IP时不能误存" });
  const boundaryNodeId = seedConfirmedBoundarySource(ip.id);
  window.history.replaceState({}, "", `/script-factory?topicId=${encodeURIComponent(topic.id)}`);

  let releaseResponse!: () => void;
  let markRequested!: () => void;
  const requested = new Promise<void>(resolve => {
    markRequested = resolve;
  });
  globalThis.fetch = async (input) => {
    if (String(input) === "/api/ip-boundary/check") {
      return alignedBoundaryResponse(boundaryNodeId);
    }
    if (String(input) === "/api/script-factory") {
      markRequested();
      return new Promise<Response>(resolve => {
        releaseResponse = () => resolve(new Response(
          JSON.stringify(createCompleteScriptResponse(ip.id, ip.name, topic.title)),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ));
      });
    }
    return new Response(JSON.stringify({ results: [], debug: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { act, render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider, useIP } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    function SwitchIPControl() {
      const { activeIP, switchIP } = useIP();
      return (
        <div>
          <span>{`测试当前IP：${activeIP?.id ?? "无"}`}</span>
          <button type="button" onClick={() => switchIP(otherIP.id)}>切换到另一个IP</button>
        </div>
      );
    }
    const view = render(
      <IPProvider>
        <SwitchIPControl />
        <ScriptFactoryPage />
      </IPProvider>,
    );

    await view.findByDisplayValue(topic.title);
    const clickGeneration = user.click(await unlockGeneration(view, user));
    await waitWithTimeout(requested, 3000);
    await user.click(view.getByRole("button", { name: "切换到另一个IP" }));
    await view.findByText(`测试当前IP：${otherIP.id}`);
    await act(async () => {
      releaseResponse();
    });
    await clickGeneration;

    assert.ok(await view.findByText("生成期间当前操盘IP已切换，结果未保存；请切回原IP后重新生成。"));
    assert.equal(getScriptAssets(ip.id).length, 0);
    assert.equal(getScriptAssets(otherIP.id).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("接口返回的脚本IP与请求IP不一致时停止保存", async () => {
  const originalFetch = globalThis.fetch;
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "接口IP错配不能保存",
    source: "manual",
  }, { ...boardResult, topic: "接口IP错配不能保存" });
  const boundaryNodeId = seedConfirmedBoundarySource(ip.id);
  window.history.replaceState({}, "", `/script-factory?topicId=${encodeURIComponent(topic.id)}`);

  globalThis.fetch = async (input) => {
    if (String(input) === "/api/ip-boundary/check") {
      return alignedBoundaryResponse(boundaryNodeId);
    }
    if (String(input) === "/api/script-factory") {
      return new Response(JSON.stringify(createCompleteScriptResponse("ip-wrong", "错误IP", topic.title)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ results: [], debug: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(
      <IPProvider>
        <ScriptFactoryPage />
      </IPProvider>,
    );

    await view.findByDisplayValue(topic.title);
    await user.click(await unlockGeneration(view, user));
    assert.ok(await view.findByText("接口返回的脚本IP与发起请求时的IP不一致，已停止保存。"));
    assert.equal(getScriptAssets(ip.id).length, 0);
    assert.equal(getScriptAssets("ip-wrong").length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("部分成功草稿保存topicId并在刷新后恢复选题关联", async () => {
  const originalFetch = globalThis.fetch;
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "部分成功也要保留关联",
    source: "manual",
  }, { ...boardResult, topic: "部分成功也要保留关联" });
  const boundaryNodeId = seedConfirmedBoundarySource(ip.id);
  window.history.replaceState({}, "", `/script-factory?topicId=${encodeURIComponent(topic.id)}`);
  const partialResponse = {
    ...createCompleteScriptResponse(ip.id, ip.name, topic.title),
    generationStatus: "partial",
    partialFailure: {
      stage: "storyboard",
      errorCode: "STORYBOARD_FAILED",
      message: "核心脚本已生成，分镜暂未生成。",
    },
  };

  globalThis.fetch = async (input) => {
    if (String(input) === "/api/ip-boundary/check") {
      return alignedBoundaryResponse(boundaryNodeId);
    }
    if (String(input) === "/api/script-factory") {
      return new Response(JSON.stringify(partialResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ results: [], debug: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { cleanup, render, waitFor, within } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const firstView = render(
      <IPProvider>
        <ScriptFactoryPage />
      </IPProvider>,
    );

    await firstView.findByDisplayValue(topic.title);
    await user.click(await unlockGeneration(firstView, user));
    await waitFor(() => assert.ok(getPartialScriptDraft(ip.id)));
    assert.equal(getPartialScriptDraft(ip.id)?.topicId, topic.id);

    cleanup();
    document.body.innerHTML = "";
    window.history.replaceState({}, "", "/script-factory");
    const restoredView = render(
      <IPProvider>
        <ScriptFactoryPage />
      </IPProvider>,
    );
    const heading = await restoredView.findByText("当前关联选题");
    const banner = heading.parentElement;
    assert.ok(banner);
    assert.ok(within(banner).getByText(topic.title));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("脚本工厂拒绝通过URL带入其他IP的选题", async () => {
  const activeIP = createTopicBoardIPProfile();
  const otherIP = createTopicBoardIPProfile({ id: "ip-other", name: "另一个IP" });
  const boardResult = {
    ...createValidTopicBoardResult(),
    ipId: otherIP.id,
    ipName: otherIP.name,
    topic: "其他IP的选题",
  };
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([activeIP, otherIP]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(activeIP.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topic = addEvaluatedTopicAsset({
    ipId: otherIP.id,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  window.history.replaceState({}, "", `/script-factory?topicId=${encodeURIComponent(topic.id)}`);

  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
  const view = render(
    <IPProvider>
      <ScriptFactoryPage />
    </IPProvider>,
  );

  assert.ok(await view.findByText("选题所属IP与当前操盘IP不一致，已阻止关联"));
  const topicInput = view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文") as HTMLTextAreaElement;
  assert.equal(topicInput.value, "");
  assert.equal(view.queryByText("当前关联选题"), null);
});

test("生成前选题状态失效时不调用接口也不保存脚本", async () => {
  const originalFetch = globalThis.fetch;
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: "生成前被废弃的选题",
    source: "manual",
  }, { ...boardResult, topic: "生成前被废弃的选题" });
  const boundaryNodeId = seedConfirmedBoundarySource(ip.id);
  window.history.replaceState({}, "", `/script-factory?topicId=${encodeURIComponent(topic.id)}`);
  let scriptFactoryCalls = 0;
  globalThis.fetch = async (input) => {
    if (String(input) === "/api/ip-boundary/check") {
      return alignedBoundaryResponse(boundaryNodeId);
    }
    if (String(input) === "/api/script-factory") scriptFactoryCalls += 1;
    return new Response(JSON.stringify({ results: [], debug: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(
      <IPProvider>
        <ScriptFactoryPage />
      </IPProvider>,
    );

    await view.findByDisplayValue(topic.title);
    updateTopicAssetStatus(topic.id, "已废弃");
    await user.click(await unlockGeneration(view, user));

    assert.ok(await view.findByText("只有已评估或已采用且评估结果完整的选题才能生成脚本"));
    assert.equal(scriptFactoryCalls, 0);
    assert.equal(getScriptAssets(ip.id).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
