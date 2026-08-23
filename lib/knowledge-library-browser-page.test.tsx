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
