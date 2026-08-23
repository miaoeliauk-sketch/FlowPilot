import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { addKnowledgeEntry, getKnowledgeEntries } from "./ip-store";
import { createTopicBoardIPProfile } from "./topic-board-contract.fixture";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/hot-analysis",
    pretendToBeVisual: true,
  });
  const browserGlobals: Record<string, unknown> = {
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
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

const activeIP = createTopicBoardIPProfile({ id: "ip-hot-analysis", name: "案例老师" });
const otherIP = createTopicBoardIPProfile({ id: "ip-hot-analysis-other", name: "另一位老师" });
const originalFetch = globalThis.fetch;
let restoreBrowser: (() => void) | undefined;

before(() => {
  restoreBrowser = installBrowserEnvironment();
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([activeIP]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(activeIP.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  window.history.replaceState({}, "", "/hot-analysis");
});

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
  localStorage.clear();
});

after(() => restoreBrowser?.());

function analysisResponse(methodCards: unknown[] = []) {
  return {
    mode: "transcript",
    title: "反常识装修案例",
    author: "外部作者",
    platform: "抖音",
    publishedAt: "2026-08-20",
    contentDirection: ["装修避坑"],
    evaluation: {
      account: "外部账号",
      track: "装修",
      hook: "贵材料不等于高级感",
      hookType: "反常识型",
      hookScore: { painPoint: 8, curiosity: 8, conflict: 8, benefit: 8, emotion: 6, total: 38 },
      grade: "A",
      whyViral: "开头制造认知反差。",
      structureBreakdown: "误区、原因、方案",
      metricsLayerPassed: true,
      metricsLayerReason: "真实数据达标",
      contentLayerPassed: true,
      contentLayerMatched: ["明确痛点"],
      structureLayerPassed: true,
      structureLayerMissing: [],
      exclusionMatched: null,
      selfCheckPassed: true,
      selfCheckReasoning: "证据完整",
      admitted: true,
    },
    dna: {
      titleStructure: "认知颠覆型",
      openingHookType: "反常识",
      openingHookText: "贵材料不等于高级感",
      structureBreakdown: [{ stage: "Hook", percentage: 20, content: "开头" }],
      emotionValue: [{ emotion: "好奇", percentage: 100 }],
      userNeedLayer: "知识",
    },
    hasRealMetrics: true,
    worthLearning: "值得学习",
    worthLearningReason: "方法可复用",
    ipFitTier: "高度匹配",
    ipFitReason: "符合当前IP定位",
    methodCards,
    titleEvaluation: null,
  };
}

async function renderAnalyzedPage(
  inputRaw: string,
  response = analysisResponse(),
  options: { switchToIPId?: string } = {},
) {
  globalThis.fetch = async () => Response.json(response);
  const { fireEvent, render, screen } = await import("@testing-library/react");
  const { IPProvider, useIP } = await import("./ip-context");
  const { default: HotAnalysisPage } = await import("../app/hot-analysis/page");
  function SwitchIPButton() {
    const { switchIP } = useIP();
    return options.switchToIPId
      ? <button onClick={() => switchIP(options.switchToIPId!)}>测试切换IP</button>
      : null;
  }
  render(<IPProvider><SwitchIPButton /><HotAnalysisPage /></IPProvider>);
  fireEvent.change(await screen.findByPlaceholderText(/粘贴内容/), {
    target: { value: inputRaw },
  });
  fireEvent.click(screen.getByRole("button", { name: "分析完整内容" }));
  await screen.findByText("反常识装修案例");
  return { fireEvent, screen };
}

test("切换IP时立即清空旧分析结果和全部入库前检查面板", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([activeIP, otherIP]));
  const card = {
    name: "旧IP方法卡",
    targetCategory: "开头方法库",
    summary: "旧IP分析结果不应跨IP残留。",
    evidenceQuote: "切换后立即清空。",
    coreMethod: "切换IP后清空分析状态。",
    applicableScenes: ["IP切换"],
    triggerKeywords: ["切换IP"],
    aiUsage: "切换IP时使用。",
    example: "旧结果不再展示。",
    unsuitableCases: "无",
  };
  const { fireEvent, screen } = await renderAnalyzedPage(
    "这是一份属于旧IP的爆款分析内容，切换IP后不能继续显示。",
    analysisResponse([card]),
    { switchToIPId: otherIP.id },
  );
  assert.equal(document.body.textContent?.includes("开头制造认知反差。"), true);
  fireEvent.click(screen.getByRole("button", { name: "收录到爆款案例库" }));
  await screen.findByText("爆款案例入库前检查");
  fireEvent.click(screen.getByRole("button", { name: "拆解为方法卡" }));
  await screen.findByText("方法卡入库前检查");
  fireEvent.click(screen.getByRole("button", { name: "测试切换IP" }));

  assert.equal(document.body.textContent?.includes("开头制造认知反差。"), false);
  assert.equal(document.body.textContent?.includes("爆款案例入库前检查"), false);
  assert.equal(document.body.textContent?.includes("方法卡入库前检查"), false);
});

test("分析请求进行中切换IP后旧响应永久失效且不会写回历史", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([activeIP, otherIP]));
  let resolveRequest: ((response: Response) => void) | undefined;
  globalThis.fetch = async () => new Promise<Response>(resolve => {
    resolveRequest = resolve;
  });
  const { act, fireEvent, render, screen } = await import("@testing-library/react");
  const { IPProvider, useIP } = await import("./ip-context");
  const { default: HotAnalysisPage } = await import("../app/hot-analysis/page");
  function SwitchIPButton() {
    const { switchIP } = useIP();
    return <button onClick={() => switchIP(otherIP.id)}>测试切换IP</button>;
  }
  render(<IPProvider><SwitchIPButton /><HotAnalysisPage /></IPProvider>);
  fireEvent.change(await screen.findByPlaceholderText(/粘贴内容/), {
    target: { value: "旧IP请求稍后返回时也不能重新写回页面。" },
  });
  fireEvent.click(screen.getByRole("button", { name: "分析完整内容" }));
  assert.equal(screen.getByRole("button", { name: /生成中/ }).hasAttribute("disabled"), true);

  fireEvent.click(screen.getByRole("button", { name: "测试切换IP" }));
  await act(async () => {
    resolveRequest?.(Response.json(analysisResponse()));
    await Promise.resolve();
  });

  assert.equal(document.body.textContent?.includes("反常识装修案例"), false);
  const histories = JSON.parse(localStorage.getItem("ipwr:hotAnalyses") ?? "[]") as unknown[];
  assert.equal(histories.length, 0);
});

test("收录爆款案例先展示全库检查结果并经人工确认后才保存", async () => {
  const inputRaw = "很多人以为只要购买最贵的材料就能获得高级感，但真正决定质感的是比例、光线和留白。";
  addKnowledgeEntry({
    category: "爆款案例",
    title: "历史相同装修案例",
    rawContent: inputRaw,
    sourceKind: null,
    sourceName: "历史案例库",
    sourceAnalysis: null,
    tags: [],
    keywords: [],
    ipId: activeIP.id,
    sourceTier: "高",
    sourceTierReason: "来源明确",
    contentDirection: ["装修避坑"],
    sourcePlatform: "小红书",
    sourceUrl: "https://example.com/old-case",
    note: "",
    extractedAt: null,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    trustStatus: null,
    sourceReference: null,
    dna: null,
  });
  const beforeCount = getKnowledgeEntries().length;
  const { fireEvent, screen } = await renderAnalyzedPage(inputRaw);

  fireEvent.click(screen.getByRole("button", { name: "收录到爆款案例库" }));

  await screen.findByText("爆款案例入库前检查");
  assert.equal(getKnowledgeEntries().length, beforeCount);
  assert.ok(screen.getByText("完全相同"));
  assert.ok(screen.getByText(/历史相同装修案例/));
  assert.ok(screen.getByText(/原文内容完全一致/));
  assert.ok(screen.getByText(/案例老师IP｜小红书｜历史案例库/));

  fireEvent.click(screen.getByRole("button", { name: "确认继续收录爆款案例" }));
  await screen.findByText("已收录爆款案例");
  const saved = getKnowledgeEntries().find(entry => entry.title === "反常识装修案例");
  assert.equal(saved?.sourceReference?.role, "viral_case");
  assert.equal(getKnowledgeEntries().length, beforeCount + 1);
  assert.equal(screen.getByRole("button", { name: "已收录爆款案例" }).hasAttribute("disabled"), true);
});

test("没有当前IP时不展示任何私有爆款分析历史", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(null));
  localStorage.setItem("ipwr:hotAnalyses", JSON.stringify([{
    id: "private-analysis-without-active-ip",
    ipId: activeIP.id,
    title: "不应泄露的私有分析",
    inputRaw: "其他IP的私有原文",
    inputType: "transcript",
    createdAt: "2026-08-22T00:00:00.000Z",
    evaluation: analysisResponse().evaluation,
  }]));
  addKnowledgeEntry({
    category: "开头方法库",
    title: "不应加载的私有方法卡",
    rawContent: "【核心方法】私有知识不能在无IP时加载。",
    sourceKind: null,
    sourceName: "",
    sourceAnalysis: null,
    tags: [],
    keywords: [],
    ipId: activeIP.id,
    sourceTier: "中",
    sourceTierReason: "来自爆款分析",
    contentDirection: [],
    sourcePlatform: "",
    sourceUrl: "",
    note: "",
    extractedAt: null,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    trustStatus: "ai_derived_unverified",
    sourceReference: {
      sourceType: "hot_analysis",
      analysisId: "private-analysis-without-active-ip",
      role: "method_card",
      groupItemId: "method-card-1",
    },
    dna: null,
  });
  const { render, screen } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const { default: HotAnalysisPage } = await import("../app/hot-analysis/page");
  render(<IPProvider><HotAnalysisPage /></IPProvider>);

  await screen.findByText(/还没有创建IP/);
  assert.equal(document.body.textContent?.includes("不应泄露的私有分析"), false);
  assert.equal(document.body.textContent?.includes("不应加载的私有方法卡"), false);
});

test("爆款案例严格保存失败时如实提示且不会显示已收录", async () => {
  const inputRaw = "爆款案例保存失败时不能让用户误以为已经成功收录。";
  const beforeCount = getKnowledgeEntries().length;
  const { fireEvent, screen } = await renderAnalyzedPage(inputRaw);
  fireEvent.click(screen.getByRole("button", { name: "收录到爆款案例库" }));
  await screen.findByText("爆款案例入库前检查");

  const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
  const originalSetItem = storagePrototype.setItem;
  storagePrototype.setItem = function setItem(key: string, value: string) {
    if (key === "ipwr:knowledgeEntries") throw new Error("模拟案例存储失败");
    return originalSetItem.call(this, key, value);
  };
  try {
    fireEvent.click(screen.getByRole("button", { name: "确认继续收录爆款案例" }));
    await screen.findByText(/爆款分析知识保存失败/);
    assert.equal(getKnowledgeEntries().length, beforeCount);
    assert.ok(screen.getByRole("button", { name: "确认继续收录爆款案例" }));
    assert.equal(screen.queryByRole("button", { name: "已收录爆款案例" }), null);
  } finally {
    storagePrototype.setItem = originalSetItem;
  }
});

test("标题模式同样先展示检查结果并通过统一入口保存未验证方法卡", async () => {
  globalThis.fetch = async () => Response.json({
    mode: "title",
    title: "贵材料不等于高级感",
    author: "",
    platform: "",
    publishedAt: "",
    contentDirection: ["装修避坑"],
    evaluation: null,
    dna: null,
    hasRealMetrics: false,
    worthLearning: "部分学习",
    worthLearningReason: "标题结构可参考",
    ipFitTier: "高度匹配",
    ipFitReason: "符合当前IP定位",
    methodCards: [],
    titleStructure: "认知颠覆型",
    titleEvaluation: {
      titleAttraction: { score: 8, reason: "有反差" },
      topicPotential: { score: 8, reason: "有讨论空间" },
      painPointClarity: { score: 7, painPoint: "装修预算", reason: "对象明确" },
      ipFit: { tier: "高度匹配", reason: "符合定位" },
      worthContinuing: { verdict: "值得学习", reason: "值得补全" },
      titleDiagnosisGrade: "A",
      overallSummary: "用价格误区制造反常识冲突。",
    },
  });
  const { fireEvent, render, screen } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const { default: HotAnalysisPage } = await import("../app/hot-analysis/page");
  render(<IPProvider><HotAnalysisPage /></IPProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "标题" }));
  fireEvent.change(screen.getByPlaceholderText(/粘贴要诊断的标题/), {
    target: { value: "贵材料不等于高级感" },
  });
  fireEvent.click(screen.getByRole("button", { name: "诊断标题" }));
  await screen.findByText("用价格误区制造反常识冲突。");
  const beforeCount = getKnowledgeEntries().length;

  fireEvent.click(screen.getByRole("button", { name: "加入标题方法库" }));
  await screen.findByText("方法卡入库前检查");
  assert.equal(getKnowledgeEntries().length, beforeCount);
  fireEvent.click(screen.getByRole("button", { name: "继续入库：贵材料不等于高级感" }));
  fireEvent.click(screen.getByRole("button", { name: "保存已选择的方法卡" }));

  await screen.findByRole("button", { name: "已加入标题方法库" });
  const saved = getKnowledgeEntries().find(entry => entry.title === "贵材料不等于高级感");
  assert.equal(saved?.sourceReference?.role, "method_card");
  assert.equal(saved?.trustStatus, "ai_derived_unverified");
});

test("方法卡逐张展示检查结果并在全部人工选择后统一保存", async () => {
  const methodCards = [
    {
      name: "比例优先法",
      targetCategory: "文案框架方法库",
      summary: "先讲比例，再讲材料。",
      evidenceQuote: "真正决定质感的是比例。",
      coreMethod: "先解释空间比例，再推荐材料。",
      applicableScenes: ["装修避坑"],
      triggerKeywords: ["比例", "材料"],
      aiUsage: "写装修建议时优先调用。",
      example: "先调整比例，再升级材料。",
      unsuitableCases: "纯材料测评不适用。",
    },
    {
      name: "留白对比法",
      targetCategory: "开头方法库",
      summary: "用留白制造反差。",
      evidenceQuote: "真正决定质感的是留白。",
      coreMethod: "先展示拥挤，再展示留白。",
      applicableScenes: ["空间改造"],
      triggerKeywords: ["留白", "反差"],
      aiUsage: "写空间改造开头时调用。",
      example: "不是装得多，而是留得对。",
      unsuitableCases: "信息密集教程不适用。",
    },
  ];
  const beforeCount = getKnowledgeEntries().length;
  const { fireEvent, screen } = await renderAnalyzedPage(
    "很多人以为只要购买最贵的材料就能获得高级感，但真正决定质感的是比例、光线和留白。",
    analysisResponse(methodCards),
  );

  fireEvent.click(screen.getByRole("button", { name: "拆解为方法卡" }));

  await screen.findByText("方法卡入库前检查");
  assert.equal(getKnowledgeEntries().length, beforeCount);
  assert.ok(screen.getByText("比例优先法：检查结果"));
  assert.ok(screen.getByText("留白对比法：检查结果"));
  assert.equal(screen.getByRole("button", { name: "保存已选择的方法卡" }).hasAttribute("disabled"), true);

  fireEvent.click(screen.getByRole("button", { name: "继续入库：比例优先法" }));
  fireEvent.click(screen.getByRole("button", { name: "暂不入库：留白对比法" }));
  const saveButton = screen.getByRole("button", { name: "保存已选择的方法卡" });
  assert.equal(saveButton.hasAttribute("disabled"), false);
  fireEvent.click(saveButton);

  await screen.findByRole("button", { name: "已入库 (1)" });
  const saved = getKnowledgeEntries().filter(entry => entry.sourceReference?.role === "method_card");
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.title, "比例优先法");
  assert.equal(saved[0]?.trustStatus, "ai_derived_unverified");
  assert.equal(screen.getByRole("button", { name: "已入库 (1)" }).hasAttribute("disabled"), true);
  assert.ok(screen.getByText("案例0条｜方法卡1张"));
  assert.ok(screen.getByText("AI拆解，尚未验证"));
  assert.ok(screen.getByText("已用于脚本0次｜已有发布复盘0次｜尚未发布或未复盘0次"));
});

test("方法卡严格保存失败时如实提示且允许用户重试", async () => {
  const card = {
    name: "失败可见法",
    targetCategory: "开头方法库",
    summary: "保存失败必须被用户看到。",
    evidenceQuote: "不能假装保存成功。",
    coreMethod: "严格感知写入结果。",
    applicableScenes: ["知识入库"],
    triggerKeywords: ["失败提示"],
    aiUsage: "保存知识时调用。",
    example: "失败后保留确认界面。",
    unsuitableCases: "无",
  };
  const { fireEvent, screen } = await renderAnalyzedPage("保存失败测试需要足够长的正文内容。", analysisResponse([card]));
  fireEvent.click(screen.getByRole("button", { name: "拆解为方法卡" }));
  await screen.findByText("方法卡入库前检查");
  fireEvent.click(screen.getByRole("button", { name: "继续入库：失败可见法" }));

  const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
  const originalSetItem = storagePrototype.setItem;
  storagePrototype.setItem = function setItem(key: string, value: string) {
    if (key === "ipwr:knowledgeEntries") throw new Error("模拟知识存储失败");
    return originalSetItem.call(this, key, value);
  };
  try {
    fireEvent.click(screen.getByRole("button", { name: "保存已选择的方法卡" }));
    await screen.findByText(/爆款分析知识保存失败/);
    assert.equal(getKnowledgeEntries().some(entry => entry.title === "失败可见法"), false);
    assert.ok(screen.getByRole("button", { name: "保存已选择的方法卡" }));
    assert.equal(screen.queryByRole("button", { name: "已入库 (1)" }), null);
  } finally {
    storagePrototype.setItem = originalSetItem;
  }
});

test("历史效果遇到损坏脚本存储时安全降级且页面继续展示", async () => {
  const analysisId = "analysis-with-corrupted-scripts";
  localStorage.setItem("ipwr:hotAnalyses", JSON.stringify([{
    id: analysisId,
    ipId: activeIP.id,
    inputType: "transcript",
    inputRaw: "即使旧脚本数据损坏，历史知识仍需安全展示。",
    sourceUrl: "",
    title: "旧脚本损坏的历史案例",
    author: "",
    platform: "抖音",
    publishedAt: "2026-08-20",
    contentDirection: ["数据兼容"],
    evaluation: analysisResponse().evaluation,
    hasRealMetrics: true,
    worthLearning: "值得学习",
    worthLearningReason: "用于验证旧数据兼容",
    ipFitTier: "高度匹配",
    ipFitReason: "当前IP数据",
    dna: analysisResponse().dna,
    createdAt: "2026-08-22T00:00:00.000Z",
  }]));
  addKnowledgeEntry({
    category: "开头方法库",
    title: "损坏数据下仍可见的方法卡",
    rawContent: "【核心方法】历史脚本数据损坏时只降级效果证据。",
    sourceKind: null,
    sourceName: "",
    sourceAnalysis: null,
    tags: [],
    keywords: [],
    ipId: activeIP.id,
    sourceTier: "中",
    sourceTierReason: "来自爆款分析",
    contentDirection: [],
    sourcePlatform: "抖音",
    sourceUrl: "",
    note: "",
    extractedAt: null,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    trustStatus: "ai_derived_unverified",
    sourceReference: {
      sourceType: "hot_analysis",
      analysisId,
      role: "method_card",
      groupItemId: "method-card-corrupted-script",
    },
    dna: null,
  });
  localStorage.setItem("ipwr:scriptAssets", JSON.stringify({ damaged: true }));

  const { render, screen } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const { default: HotAnalysisPage } = await import("../app/hot-analysis/page");
  render(<IPProvider><HotAnalysisPage /></IPProvider>);

  await screen.findByText("旧脚本损坏的历史案例");
  assert.ok(screen.getByText("损坏数据下仍可见的方法卡"));
  assert.ok(screen.getByText("已用于脚本0次｜已有发布复盘0次｜尚未发布或未复盘0次"));
});

test("单条脚本知识追踪结构损坏时拒绝计入可信采用和复盘证据", async () => {
  const analysisId = "analysis-with-invalid-tracking";
  const scriptId = "script-with-invalid-tracking";
  localStorage.setItem("ipwr:hotAnalyses", JSON.stringify([{
    id: analysisId,
    ipId: activeIP.id,
    inputType: "transcript",
    inputRaw: "损坏的知识追踪不能推进方法可信度。",
    sourceUrl: "",
    title: "知识追踪损坏的历史案例",
    author: "",
    platform: "抖音",
    publishedAt: "2026-08-20",
    contentDirection: ["数据兼容"],
    evaluation: analysisResponse().evaluation,
    hasRealMetrics: true,
    worthLearning: "值得学习",
    worthLearningReason: "用于验证可信关联防伪",
    ipFitTier: "高度匹配",
    ipFitReason: "当前IP数据",
    dna: analysisResponse().dna,
    createdAt: "2026-08-22T00:00:00.000Z",
  }]));
  const saved = addKnowledgeEntry({
    category: "开头方法库",
    title: "不能被损坏追踪推进的方法卡",
    rawContent: "【核心方法】只有完整合法的脚本追踪才能形成采用证据。",
    sourceKind: null,
    sourceName: "",
    sourceAnalysis: null,
    tags: [],
    keywords: [],
    ipId: activeIP.id,
    sourceTier: "中",
    sourceTierReason: "来自爆款分析",
    contentDirection: [],
    sourcePlatform: "抖音",
    sourceUrl: "",
    note: "",
    extractedAt: null,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    trustStatus: "ai_derived_unverified",
    sourceReference: {
      sourceType: "hot_analysis",
      analysisId,
      role: "method_card",
      groupItemId: "method-card-invalid-tracking",
    },
    dna: null,
  });
  const entries = getKnowledgeEntries();
  const stored = entries.find(entry => entry.id === saved.id)!;
  stored.usageRecords = [{
    id: "usage-from-invalid-tracking",
    module: "脚本工厂",
    usedAt: "2026-08-22T09:00:00.000Z",
    reason: "损坏数据伪造的采用记录",
    relevanceTier: "高度相关",
    relevanceReason: "不应被采信",
    context: "生成口播脚本",
    trackingStatus: "script_adopted",
    topicId: "topic-invalid-tracking",
    scriptId,
    reviewId: null,
    usageType: "structure",
    sectionLabel: "开头",
    evidenceExcerpt: "完整合法的脚本追踪",
  }];
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify(entries));
  localStorage.setItem("ipwr:scriptAssets", JSON.stringify([{
    id: scriptId,
    ipId: activeIP.id,
    topicId: "topic-invalid-tracking",
    title: "追踪状态与结构互相矛盾的脚本",
    cover: "",
    content: "只有完整合法的脚本追踪才能形成采用证据。",
    status: "定稿",
    knowledgeTracking: {
      status: "not_tracked",
      candidateKnowledgeEntryIds: [saved.id],
      verifiedAt: null,
      usages: [],
    },
    createdAt: "2026-08-22T09:00:00.000Z",
  }]));

  const { render, screen } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const { default: HotAnalysisPage } = await import("../app/hot-analysis/page");
  render(<IPProvider><HotAnalysisPage /></IPProvider>);

  await screen.findByText("不能被损坏追踪推进的方法卡");
  assert.ok(screen.getByText("AI拆解，尚未验证"));
  assert.ok(screen.getByText("已用于脚本0次｜已有发布复盘0次｜尚未发布或未复盘0次"));
  assert.equal(screen.queryByText("已被采用，等待效果"), null);
});

test("历史记录陈列真实发布证据但不会自动宣布方法有效", async () => {
  const card = {
    name: "真实证据方法",
    targetCategory: "开头方法库",
    summary: "用反常识开头吸引注意。",
    evidenceQuote: "贵材料不等于高级感。",
    coreMethod: "先给出反常识结论。",
    applicableScenes: ["装修避坑"],
    triggerKeywords: ["反常识"],
    aiUsage: "生成开头时调用。",
    example: "贵的不一定是对的。",
    unsuitableCases: "结论缺少依据时不适用。",
  };
  const { fireEvent, screen } = await renderAnalyzedPage("真实效果证据需要通过脚本和发布复盘建立。", analysisResponse([card]));
  fireEvent.click(screen.getByRole("button", { name: "拆解为方法卡" }));
  await screen.findByText("方法卡入库前检查");
  fireEvent.click(screen.getByRole("button", { name: "继续入库：真实证据方法" }));
  fireEvent.click(screen.getByRole("button", { name: "保存已选择的方法卡" }));
  await screen.findByRole("button", { name: "已入库 (1)" });

  const entries = getKnowledgeEntries();
  const saved = entries.find(entry => entry.title === "真实证据方法");
  assert.ok(saved);
  const usedAt = "2026-08-22T09:00:00.000Z";
  saved.usageRecords = [{
    id: "usage-page-effect",
    module: "脚本工厂",
    usedAt,
    reason: "最终正文采用反常识开头",
    relevanceTier: "高度相关",
    relevanceReason: "正文存在对应表达",
    context: "生成口播脚本",
    trackingStatus: "script_adopted",
    topicId: "topic-page-effect",
    scriptId: "script-page-effect",
    reviewId: "review-page-effect",
    usageType: "structure",
    sectionLabel: "开头",
    evidenceExcerpt: "贵的不一定是对的",
  }];
  saved.status = "已用于脚本";
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify(entries));
  localStorage.setItem("ipwr:scriptAssets", JSON.stringify([{
    id: "script-page-effect",
    ipId: activeIP.id,
    topicId: "topic-page-effect",
    title: "采用方法的真实脚本",
    cover: "",
    content: "贵的不一定是对的，真正决定质感的是比例。",
    status: "定稿",
    knowledgeTracking: {
      status: "verified",
      candidateKnowledgeEntryIds: [saved.id],
      verifiedAt: usedAt,
      usages: [{
        knowledgeEntryId: saved.id,
        usageType: "structure",
        sectionLabel: "开头",
        evidenceExcerpt: "贵的不一定是对的",
        reason: "最终正文采用反常识开头",
      }],
    },
    createdAt: usedAt,
  }]));
  localStorage.setItem("ipwr:videoReviews", JSON.stringify([{
    id: "review-page-effect",
    ipId: activeIP.id,
    title: "真实发布复盘",
    platform: "抖音",
    publishedAt: "2026-08-23",
    videoUrl: "",
    contentDirection: "装修避坑",
    topicId: "topic-page-effect",
    scriptId: "script-page-effect",
    sourceType: "flowpilot",
    traceabilityStatus: "traceable",
    knowledgeEffectStatus: "tracked",
    scriptText: "贵的不一定是对的，真正决定质感的是比例。",
    metrics: { views: 1000, likes: 100, comments: 10, favorites: 20, shares: 5, newFollowers: 2, dms: 1, leads: 0, conversions: 0 },
    analysis: null,
    savedToKnowledge: false,
    knowledgeEntryId: null,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    manualReviewStatus: "pending",
    manualReviewTags: [],
    manualReviewNote: "",
  }]));

  fireEvent.click(screen.getByRole("button", { name: "基因库" }));
  fireEvent.click(screen.getByRole("button", { name: "素材雷达" }));
  await screen.findByText("已有发布效果证据，待人工判断");
  assert.ok(screen.getByText("已用于脚本1次｜已有发布复盘1次｜尚未发布或未复盘0次"));
  assert.ok(screen.getByText("采用方法的真实脚本"));
  assert.ok(screen.getByText("真实发布复盘｜抖音｜2026-08-23"));
  assert.ok(screen.getByText("播放1,000｜点赞100｜评论10｜收藏20｜分享5"));
  assert.equal(screen.queryByText("方法有效"), null);
});
