import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import {
  addKnowledgeEntry,
  addEvaluatedTopicAsset,
  addScriptAsset,
  deleteScriptAsset,
  deleteTopicAsset,
  completeVideoReview,
  getKnowledgeEntries,
  getVideoReviews,
  recordKnowledgeUsage,
} from "./ip-store";
import { addScriptAssetForTopic } from "./topic-script-link";
import { addVideoReviewForSource } from "./review-traceability";
import {
  createTopicBoardIPProfile,
  createValidTopicBoardResult,
} from "./topic-board-contract.fixture";
import type { VideoReview } from "./types";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/review",
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
    HTMLSelectElement: dom.window.HTMLSelectElement,
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

function createReviewResponse(): NonNullable<VideoReview["analysis"]> {
  return {
    layer1: { grade: "B", performanceType: "普通款", highlights: [], weaknesses: [], scoringBasis: "数据有限" },
    layer2: { hasViralPotential: false, confidenceTier: "低可信度", reasoning: "数据有限", dataEvidence: "", structureEvidence: "", knowledgeEvidence: "" },
    layer3: {
      hasScriptText: false,
      noScriptReason: "未提供文本",
      titleAnalysis: { score: 0, feedback: "", suggestion: "" },
      hookAnalysis: { score: 0, feedback: "", suggestion: "" },
      middleAnalysis: { score: 0, feedback: "", suggestion: "" },
      endingAnalysis: { score: 0, feedback: "", suggestion: "" },
    },
    layer4: { hasHistoricalData: false, noHistoryReason: "历史不足", betterMetrics: [], worseMetrics: [], changeReason: "", avgHistoricalViews: null, avgHistoricalLikes: null, avgHistoricalComments: null, avgHistoricalFavorites: null },
    layer5: { successPatterns: [], failurePatterns: [], reusableFormulas: [] },
    layer6: { continueSuggestions: [], stopSuggestions: [], optimizeSuggestions: [], recommendedTopics: [], recommendedTitles: [] },
  };
}

before(() => {
  restoreBrowser = installBrowserEnvironment();
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
});

after(() => restoreBrowser?.());

test("新建复盘明确区分内部内容和外部内容并只列出当前IP脚本", async () => {
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", "true");
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: ip.id,
    title: "当前IP已发布脚本",
    cover: "",
    content: "脚本正文",
    status: "定稿",
  });

  const { render, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const ReviewPage = (await import("../app/review/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<IPProvider><ReviewPage /></IPProvider>);

  assert.ok(await view.findByRole("button", { name: "FlowPilot内部内容" }));
  assert.ok(view.getByRole("button", { name: "外部或临时内容" }));
  const selector = view.getByLabelText("选择已发布脚本");
  assert.ok(within(selector).getByRole("option", { name: script.title }));
  await user.click(view.getByRole("button", { name: "外部或临时内容" }));
  assert.ok(view.getByText(/暂不计入知识使用统计/));
});

test("内部脚本缺少选题关联时在调用AI前明确拒绝", async () => {
  const ip = createTopicBoardIPProfile();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", "true");
  const script = addScriptAsset({
    ipId: ip.id,
    title: "缺少选题来源的脚本",
    cover: "",
    content: "脚本正文",
    status: "定稿",
  });
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("关联失败时不应调用AI");
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ReviewPage = (await import("../app/review/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ReviewPage /></IPProvider>);

    await user.selectOptions(await view.findByLabelText("选择已发布脚本"), script.id);
    await user.click(view.getByRole("button", { name: "开始六层复盘分析" }));

    assert.match(view.container.textContent ?? "", /没有关联选题/);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("页面成功分析内部脚本后保存完整的选题和脚本关联", async () => {
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", "true");
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: ip.id,
    title: "准备复盘的内部脚本",
    cover: "",
    content: "脚本正文",
    status: "定稿",
  });
  addVideoReviewForSource({
    activeIPId: ip.id,
    source: { type: "external" },
    review: {
      title: "外部高播放复盘",
      platform: "视频号",
      publishedAt: "2026-08-19",
      videoUrl: "",
      contentDirection: "商业洞察",
      scriptText: "外部临时内容",
      metrics: { views: 999999, likes: 9999, comments: 999, favorites: 999, shares: 999, newFollowers: 999, dms: 0, leads: 0, conversions: 0 },
      analysis: createReviewResponse(),
    },
  });
  const originalFetch = globalThis.fetch;
  let capturedRequest: {
    historicalAvg?: { count?: number };
    [key: string]: unknown;
  } = {};
  globalThis.fetch = async (_input, init) => {
    capturedRequest = JSON.parse(String(init?.body ?? "{}")) as typeof capturedRequest;
    return new Response(JSON.stringify(createReviewResponse()), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ReviewPage = (await import("../app/review/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ReviewPage /></IPProvider>);

    await user.selectOptions(await view.findByLabelText("选择已发布脚本"), script.id);
    await user.type(view.getByPlaceholderText("填写发布的标题"), "可追溯复盘");
    await user.type(view.getAllByPlaceholderText("0")[0]!, "1000");
    await user.click(view.getByRole("button", { name: "开始六层复盘分析" }));

    await view.findByText("第一层 · 数据结果");
    const saved = getVideoReviews(ip.id).find(item => item.title === "可追溯复盘");
    assert.equal(capturedRequest.historicalAvg?.count, 0);
    assert.equal(saved?.scriptId, script.id);
    assert.equal(saved?.topicId, topic.id);
    assert.equal(saved?.sourceType, "flowpilot");
    assert.equal(saved?.traceabilityStatus, "traceable");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("知识库标记写入失败时页面显示失败且不误报保存成功", async () => {
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", "true");
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: ip.id,
    title: "标记失败测试脚本",
    cover: "",
    content: "脚本正文",
    status: "定稿",
  });
  const originalFetch = globalThis.fetch;
  const originalAlert = Object.getOwnPropertyDescriptor(globalThis, "alert");
  const alertMessages: string[] = [];
  globalThis.fetch = async () => new Response(JSON.stringify(createReviewResponse()), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  Object.defineProperty(globalThis, "alert", {
    configurable: true,
    value: (message?: unknown) => {
      alertMessages.push(String(message));
    },
  });

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ReviewPage = (await import("../app/review/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ReviewPage /></IPProvider>);

    await user.selectOptions(await view.findByLabelText("选择已发布脚本"), script.id);
    await user.type(view.getByPlaceholderText("填写发布的标题"), "标记失败复盘");
    await user.type(view.getAllByPlaceholderText("0")[0]!, "1000");
    await user.click(view.getByRole("button", { name: "开始六层复盘分析" }));
    await view.findByText("第一层 · 数据结果");

    const saved = getVideoReviews(ip.id).find(item => item.title === "标记失败复盘");
    assert.ok(saved);
    completeVideoReview(saved.id, {
      tags: ["选题角度新颖"],
      note: "标题角度带来了明显的播放增长。",
    });
    await user.type(view.getByPlaceholderText("仅作引用记录，不自动抓取"), "https://example.com/video");

    const stored = localStorage;
    const originalGlobalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const originalWindowStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
    const failingReviewStorage = {
      getItem: stored.getItem.bind(stored),
      setItem(key: string, value: string) {
        if (key === "ipwr:videoReviews") throw new Error("review marker write failed");
        stored.setItem(key, value);
      },
      removeItem: stored.removeItem.bind(stored),
      clear: stored.clear.bind(stored),
      key: stored.key.bind(stored),
      get length() { return stored.length; },
    };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: failingReviewStorage });
    Object.defineProperty(window, "localStorage", { configurable: true, value: failingReviewStorage });
    const restoreStorage = () => {
      if (originalGlobalStorage) Object.defineProperty(globalThis, "localStorage", originalGlobalStorage);
      else delete (globalThis as Record<string, unknown>).localStorage;
      if (originalWindowStorage) Object.defineProperty(window, "localStorage", originalWindowStorage);
      else delete (window as unknown as Record<string, unknown>).localStorage;
    };

    try {
      await user.click(await view.findByRole("button", { name: "存入复盘经验库" }));
      assert.ok(await view.findByText("知识库标记保存失败，请稍后重试"));
      assert.deepEqual(alertMessages, []);
      assert.equal(getVideoReviews(ip.id).find(item => item.id === saved.id)?.savedToKnowledge, false);
      assert.deepEqual(getKnowledgeEntries("复盘经验库"), []);

      restoreStorage();
      await user.click(view.getByRole("button", { name: "存入复盘经验库" }));
      assert.deepEqual(alertMessages, ["经验已存入知识库「方法论」分类"]);
      const storedKnowledge = getKnowledgeEntries("复盘经验库");
      assert.equal(storedKnowledge.length, 1);
      assert.equal(
        getVideoReviews(ip.id).find(item => item.id === saved.id)?.knowledgeEntryId,
        storedKnowledge[0]?.id,
      );
      assert.equal(
        Boolean(view.queryByRole("button", { name: "存入复盘经验库" })),
        false,
      );
    } finally {
      restoreStorage();
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAlert) Object.defineProperty(globalThis, "alert", originalAlert);
    else delete (globalThis as Record<string, unknown>).alert;
  }
});

test("复盘记录能展开查看本次发布脚本关联的知识条目", async () => {
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", "true");
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const knowledge = addKnowledgeEntry({
    category: "方法论",
    title: "先给结论再解释原因",
    rawContent: "开头先给明确结论，再解释背后的原因。",
    tags: [],
    keywords: [],
    ipId: ip.id,
    sourceTier: "高",
    sourceTierReason: "测试",
    contentDirection: [],
    sourcePlatform: "",
    sourceUrl: "",
    note: "",
    extractedAt: "2026-08-20T00:00:00.000Z",
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
  });
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: ip.id,
    title: "已发布的知识关联脚本",
    cover: "",
    content: "脚本正文",
    status: "定稿",
    knowledgeTracking: {
      status: "unavailable",
      candidateKnowledgeEntryIds: [knowledge.id],
      verifiedAt: "2026-08-20T08:00:00.000Z",
      usages: [],
    },
  });
  recordKnowledgeUsage(knowledge.id, {
    module: "脚本工厂",
    usedAt: "2026-08-20T08:00:00.000Z",
    reason: "脚本生成成功",
    relevanceTier: "高度相关",
    relevanceReason: "与选题直接相关",
    context: topic.title,
  }, "已用于脚本", script.id);
  addVideoReviewForSource({
    activeIPId: ip.id,
    source: { type: "flowpilot", scriptId: script.id },
    review: {
      title: "带知识关联的发布复盘",
      platform: "视频号",
      publishedAt: "2026-08-20",
      videoUrl: "",
      contentDirection: "商业洞察",
      scriptText: "脚本正文",
      metrics: { views: 1200, likes: 80, comments: 12, favorites: 20, shares: 5, newFollowers: 6, dms: 0, leads: 0, conversions: 0 },
      analysis: createReviewResponse(),
    },
  });

  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const ReviewPage = (await import("../app/review/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<IPProvider><ReviewPage /></IPProvider>);

  await user.click(await view.findByRole("button", { name: "复盘记录" }));
  assert.ok(await view.findByText("带知识关联的发布复盘"));
  await user.click(view.getByRole("button", { name: "展开" }));
  assert.ok(view.getByText("本次脚本使用的知识（1条）"));
  assert.ok(view.getByText(new RegExp(knowledge.title)));
});

test("复盘记录把知识关联暂不可用与无关联明确区分", async () => {
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", "true");
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: ip.id,
    title: "知识关联暂不可用的脚本",
    cover: "",
    content: "脚本正文",
    status: "定稿",
  });
  const review = addVideoReviewForSource({
    activeIPId: ip.id,
    source: { type: "flowpilot", scriptId: script.id },
    review: {
      title: "知识关联暂不可用的复盘",
      platform: "视频号",
      publishedAt: "2026-08-20",
      videoUrl: "",
      contentDirection: "商业洞察",
      scriptText: "脚本正文",
      metrics: { views: 1200, likes: 80, comments: 12, favorites: 20, shares: 5, newFollowers: 6, dms: 0, leads: 0, conversions: 0 },
      analysis: createReviewResponse(),
    },
  });
  localStorage.setItem("ipwr:videoReviews", JSON.stringify([
    { ...review, knowledgeEffectStatus: "knowledge_unavailable" },
  ]));

  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const ReviewPage = (await import("../app/review/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<IPProvider><ReviewPage /></IPProvider>);

  await user.click(await view.findByRole("button", { name: "复盘记录" }));
  assert.ok(await view.findByText("知识关联暂不可用"));
});

test("知识关联真实存在但状态同步持续失败时页面展示部分完成", async () => {
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", "true");
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const knowledge = addKnowledgeEntry({
    category: "方法论",
    title: "状态待同步时仍应展示的知识",
    rawContent: "真实关联不能被后续状态写入失败掩盖。",
    tags: [], keywords: [], ipId: ip.id,
    sourceTier: "高", sourceTierReason: "测试", contentDirection: [],
    sourcePlatform: "", sourceUrl: "", note: "",
    extractedAt: "2026-08-20T00:00:00.000Z",
    metrics: null, viralEvaluation: null, usageRecords: [],
    status: "未使用", dna: null,
  });
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: ip.id,
    title: "状态同步持续失败的脚本",
    cover: "",
    content: "脚本正文",
    status: "定稿",
    knowledgeTracking: {
      status: "unavailable",
      candidateKnowledgeEntryIds: [knowledge.id],
      verifiedAt: "2026-08-20T08:00:00.000Z",
      usages: [],
    },
  });
  recordKnowledgeUsage(knowledge.id, {
    module: "脚本工厂",
    usedAt: "2026-08-20T08:00:00.000Z",
    reason: "脚本生成成功",
    relevanceTier: "高度相关",
    relevanceReason: "与选题直接相关",
    context: topic.title,
  }, "已用于脚本", script.id);
  const review = addVideoReviewForSource({
    activeIPId: ip.id,
    source: { type: "flowpilot", scriptId: script.id },
    review: {
      title: "状态待同步的发布复盘",
      platform: "视频号",
      publishedAt: "2026-08-20",
      videoUrl: "",
      contentDirection: "商业洞察",
      scriptText: "脚本正文",
      metrics: { views: 1200, likes: 80, comments: 12, favorites: 20, shares: 5, newFollowers: 6, dms: 0, leads: 0, conversions: 0 },
      analysis: createReviewResponse(),
    },
  });
  localStorage.setItem("ipwr:videoReviews", JSON.stringify([
    { ...review, knowledgeEffectStatus: "tracked_status_pending" },
  ]));
  const stored = localStorage;
  const originalGlobalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const originalWindowStorage = Object.getOwnPropertyDescriptor(
    window,
    "localStorage",
  );
  const failingReviewStatusStorage = {
    getItem: stored.getItem.bind(stored),
    setItem(key: string, value: string) {
      if (key === "ipwr:videoReviews") throw new Error("review status write failed");
      stored.setItem(key, value);
    },
    removeItem: stored.removeItem.bind(stored),
    clear: stored.clear.bind(stored),
    key: stored.key.bind(stored),
    get length() { return stored.length; },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: failingReviewStatusStorage,
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: failingReviewStatusStorage,
  });

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ReviewPage = (await import("../app/review/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ReviewPage /></IPProvider>);

    await user.click(await view.findByRole("button", { name: "复盘记录" }));
    assert.ok(await view.findByText("关联知识1条（状态同步待重试）"));
  } finally {
    if (originalGlobalStorage) {
      Object.defineProperty(globalThis, "localStorage", originalGlobalStorage);
    }
    if (originalWindowStorage) {
      Object.defineProperty(window, "localStorage", originalWindowStorage);
    }
  }
});

test("删除复盘的知识关联清理失败时页面显示错误且保留记录", async () => {
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", "true");
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const knowledge = addKnowledgeEntry({
    category: "方法论",
    title: "删除失败时仍需保留的知识",
    rawContent: "删除失败时不能留下悬空关联。",
    tags: [], keywords: [], ipId: ip.id,
    sourceTier: "高", sourceTierReason: "测试", contentDirection: [],
    sourcePlatform: "", sourceUrl: "", note: "",
    extractedAt: "2026-08-20T00:00:00.000Z",
    metrics: null, viralEvaluation: null, usageRecords: [], status: "未使用", dna: null,
  });
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: ip.id,
    title: "删除失败测试脚本",
    cover: "",
    content: "脚本正文",
    status: "定稿",
    knowledgeTracking: {
      status: "unavailable",
      candidateKnowledgeEntryIds: [knowledge.id],
      verifiedAt: "2026-08-20T08:00:00.000Z",
      usages: [],
    },
  });
  recordKnowledgeUsage(knowledge.id, {
    module: "脚本工厂",
    usedAt: "2026-08-20T08:00:00.000Z",
    reason: "脚本生成成功",
    relevanceTier: "高度相关",
    relevanceReason: "与选题直接相关",
    context: topic.title,
  }, "已用于脚本", script.id);
  const review = addVideoReviewForSource({
    activeIPId: ip.id,
    source: { type: "flowpilot", scriptId: script.id },
    review: {
      title: "删除清理失败的复盘",
      platform: "视频号",
      publishedAt: "2026-08-20",
      videoUrl: "",
      contentDirection: "商业洞察",
      scriptText: "脚本正文",
      metrics: { views: 1200, likes: 80, comments: 12, favorites: 20, shares: 5, newFollowers: 6, dms: 0, leads: 0, conversions: 0 },
      analysis: createReviewResponse(),
    },
  });

  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const ReviewPage = (await import("../app/review/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<IPProvider><ReviewPage /></IPProvider>);

  await user.click(await view.findByRole("button", { name: "复盘记录" }));
  assert.ok(await view.findByText(review.title));
  localStorage.setItem("ipwr:knowledgeEntries", "{broken");
  await user.click(view.getByRole("button", { name: "删除复盘" }));

  assert.ok(await view.findByText("知识关联清理失败，复盘未删除"));
  assert.ok(view.getByText(review.title));
  assert.deepEqual(getVideoReviews(ip.id).map(item => item.id), [review.id]);
});

test("分析期间切换IP时旧请求不能把复盘写入原IP或新IP", async () => {
  const ipA = createTopicBoardIPProfile();
  const ipB = { ...ipA, id: "ip-other", name: "另一个IP" };
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ipA, ipB]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ipA.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", "true");
  const topic = addEvaluatedTopicAsset({
    ipId: ipA.id,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: ipA.id,
    title: "等待分析的脚本",
    cover: "",
    content: "脚本正文",
    status: "定稿",
  });
  let releaseResponse: ((response: Response) => void) | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Promise<Response>(resolve => {
    releaseResponse = resolve;
  });

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider, useIP } = await import("./ip-context");
    const ReviewPage = (await import("../app/review/page")).default;
    const user = userEvent.setup({ document });
    function Harness() {
      const { switchIP } = useIP();
      return <><button onClick={() => switchIP(ipB.id)}>切换到另一个IP</button><ReviewPage /></>;
    }
    const view = render(<IPProvider><Harness /></IPProvider>);

    await user.selectOptions(await view.findByLabelText("选择已发布脚本"), script.id);
    await user.type(view.getByPlaceholderText("填写发布的标题"), "等待返回的复盘");
    await user.type(view.getAllByPlaceholderText("0")[0]!, "1000");
    await user.click(view.getByRole("button", { name: "开始六层复盘分析" }));
    await user.click(view.getByRole("button", { name: "切换到另一个IP" }));

    releaseResponse?.(new Response(JSON.stringify(createReviewResponse()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    assert.ok(await view.findByRole("button", { name: "开始六层复盘分析" }));
    assert.equal(Boolean(view.queryByText("当前操盘IP刚刚发生变化，请确认后重新分析。")), false);
    assert.deepEqual(getVideoReviews(ipA.id), []);
    assert.deepEqual(getVideoReviews(ipB.id), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("分析期间从IP A切到IP B再切回IP A时旧请求仍永久失效", async () => {
  const ipA = createTopicBoardIPProfile();
  const ipB = { ...ipA, id: "ip-other", name: "另一个IP" };
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ipA, ipB]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ipA.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", "true");
  const topic = addEvaluatedTopicAsset({
    ipId: ipA.id,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: ipA.id,
    title: "切走又切回时等待分析的脚本",
    cover: "",
    content: "脚本正文",
    status: "定稿",
  });
  let releaseResponse: ((response: Response) => void) | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Promise<Response>(resolve => {
    releaseResponse = resolve;
  });

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider, useIP } = await import("./ip-context");
    const ReviewPage = (await import("../app/review/page")).default;
    const user = userEvent.setup({ document });
    function Harness() {
      const { switchIP } = useIP();
      return <>
        <button onClick={() => switchIP(ipB.id)}>切换到IP B</button>
        <button onClick={() => switchIP(ipA.id)}>切换回IP A</button>
        <ReviewPage />
      </>;
    }
    const view = render(<IPProvider><Harness /></IPProvider>);

    await user.selectOptions(await view.findByLabelText("选择已发布脚本"), script.id);
    await user.type(view.getByPlaceholderText("填写发布的标题"), "切走又切回的复盘");
    await user.type(view.getAllByPlaceholderText("0")[0]!, "1000");
    await user.click(view.getByRole("button", { name: "开始六层复盘分析" }));
    await user.click(view.getByRole("button", { name: "切换到IP B" }));
    await user.click(view.getByRole("button", { name: "切换回IP A" }));

    assert.ok(await view.findByRole("button", { name: "开始六层复盘分析" }));

    releaseResponse?.(new Response(JSON.stringify(createReviewResponse()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(Boolean(view.queryByText("第一层 · 数据结果")), false);
    assert.equal(Boolean(view.queryByRole("button", { name: "存入复盘经验库" })), false);
    assert.deepEqual(getVideoReviews(ipA.id), []);
    assert.deepEqual(getVideoReviews(ipB.id), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("分析成功后切换IP会清除旧结果和知识沉淀入口", async () => {
  const ipA = createTopicBoardIPProfile();
  const ipB = { ...ipA, id: "ip-other", name: "另一个IP" };
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ipA, ipB]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ipA.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", "true");
  const topic = addEvaluatedTopicAsset({
    ipId: ipA.id,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: ipA.id,
    title: "IP A的脚本",
    cover: "",
    content: "脚本正文",
    status: "定稿",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(createReviewResponse()), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider, useIP } = await import("./ip-context");
    const ReviewPage = (await import("../app/review/page")).default;
    const user = userEvent.setup({ document });
    function Harness() {
      const { switchIP } = useIP();
      return <><button onClick={() => switchIP(ipB.id)}>切换到另一个IP</button><ReviewPage /></>;
    }
    const view = render(<IPProvider><Harness /></IPProvider>);

    await user.selectOptions(await view.findByLabelText("选择已发布脚本"), script.id);
    await user.type(view.getByPlaceholderText("填写发布的标题"), "IP A复盘");
    await user.type(view.getAllByPlaceholderText("0")[0]!, "1000");
    await user.click(view.getByRole("button", { name: "开始六层复盘分析" }));
    await view.findByText("第一层 · 数据结果");
    await user.click(view.getByRole("button", { name: "切换到另一个IP" }));

    assert.equal(Boolean(view.queryByText("第一层 · 数据结果")), false);
    assert.equal(Boolean(view.queryByRole("button", { name: "存入复盘经验库" })), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("分析期间来源失效时不展示未保存的假成功结果", async () => {
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", "true");
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: ip.id,
    title: "等待返回时被删除的脚本",
    cover: "",
    content: "脚本正文",
    status: "定稿",
  });
  let releaseResponse: ((response: Response) => void) | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Promise<Response>(resolve => {
    releaseResponse = resolve;
  });

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ReviewPage = (await import("../app/review/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ReviewPage /></IPProvider>);

    await user.selectOptions(await view.findByLabelText("选择已发布脚本"), script.id);
    await user.type(view.getByPlaceholderText("填写发布的标题"), "来源失效复盘");
    await user.type(view.getAllByPlaceholderText("0")[0]!, "1000");
    await user.click(view.getByRole("button", { name: "开始六层复盘分析" }));
    deleteScriptAsset(script.id);
    releaseResponse?.(new Response(JSON.stringify(createReviewResponse()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    assert.ok(await view.findByText("来源已失效，本次分析结果无法保存"));
    assert.equal(Boolean(view.queryByText("第一层 · 数据结果")), false);
    assert.equal(Boolean(view.queryByRole("button", { name: "存入复盘经验库" })), false);
    assert.deepEqual(getVideoReviews(ip.id), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("外部不可追溯复盘不提供知识入库入口且不产生孤儿知识", async () => {
  const ip = createTopicBoardIPProfile();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", "true");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(createReviewResponse()), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ReviewPage = (await import("../app/review/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ReviewPage /></IPProvider>);

    await user.click(view.getByRole("button", { name: "外部或临时内容" }));
    await user.type(view.getByPlaceholderText("填写发布的标题"), "外部临时复盘");
    await user.type(view.getAllByPlaceholderText("0")[0]!, "1000");
    await user.click(view.getByRole("button", { name: "开始六层复盘分析" }));

    await view.findByText("第一层 · 数据结果");
    assert.equal(Boolean(view.queryByRole("button", { name: "存入复盘经验库" })), false);
    assert.deepEqual(getKnowledgeEntries("复盘经验库"), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("分析期间关联选题失效时统一提示来源失效且不展示结果", async () => {
  const ip = createTopicBoardIPProfile();
  const boardResult = createValidTopicBoardResult();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", "true");
  const topic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId: ip.id,
    title: "选题等待期间失效的脚本",
    cover: "",
    content: "脚本正文",
    status: "定稿",
  });
  let releaseResponse: ((response: Response) => void) | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Promise<Response>(resolve => {
    releaseResponse = resolve;
  });

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ReviewPage = (await import("../app/review/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ReviewPage /></IPProvider>);

    await user.selectOptions(await view.findByLabelText("选择已发布脚本"), script.id);
    await user.type(view.getByPlaceholderText("填写发布的标题"), "关联选题失效复盘");
    await user.type(view.getAllByPlaceholderText("0")[0]!, "1000");
    await user.click(view.getByRole("button", { name: "开始六层复盘分析" }));
    deleteTopicAsset(topic.id);
    releaseResponse?.(new Response(JSON.stringify(createReviewResponse()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    assert.ok(await view.findByText("来源已失效，本次分析结果无法保存"));
    assert.equal(Boolean(view.queryByText("第一层 · 数据结果")), false);
    assert.equal(Boolean(view.queryByRole("button", { name: "存入复盘经验库" })), false);
    assert.deepEqual(getVideoReviews(ip.id), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
