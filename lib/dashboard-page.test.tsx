import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import {
  addEvaluatedTopicAsset,
  completeVideoReview,
  deferVideoReview,
} from "./ip-store";
import { addScriptAssetForTopic } from "./topic-script-link";
import { addVideoReviewForSource } from "./review-traceability";
import { createValidTopicBoardResult } from "./topic-board-contract.fixture";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
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

const currentIP = { id: "ip-a", name: "当前IP-A" };
const otherIP = { id: "ip-b", name: "其他IP-B" };

function knowledgeEntry(id: string, title: string, category: string, ipId: string | null) {
  return {
    id,
    title,
    category,
    ipId,
    createdAt: `2026-08-08T00:00:0${id.length}.000Z`,
  };
}

function coverRef(id: string, scope: "global" | "ip", ipId: string | null, createdAt: string) {
  return {
    id,
    title: `${id}封面`,
    imageDataUrl: `data:image/png;base64,${id}`,
    platform: "抖音",
    contentType: "知识口播",
    coverType: "大字标题",
    visualTags: ["高对比"],
    textStyle: "短句",
    layout: "中心大标题",
    colorStyle: "黑底黄字",
    referenceReason: "标题清晰",
    avoidReason: "",
    sourceUrl: "",
    scope,
    ipId,
    createdAt,
    updatedAt: createdAt,
  };
}

async function renderDashboard() {
  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const Home = (await import("../app/page")).default;
  return render(<IPProvider><Home /></IPProvider>);
}

async function renderDashboardWithLayout() {
  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const AppLayout = (await import("../components/layout/AppLayout")).default;
  const Home = (await import("../app/page")).default;
  return render(
    <IPProvider>
      <AppLayout><Home /></AppLayout>
    </IPProvider>,
  );
}

async function renderAppLayout() {
  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const AppLayout = (await import("../components/layout/AppLayout")).default;
  return render(
    <IPProvider>
      <AppLayout><div>页面内容</div></AppLayout>
    </IPProvider>,
  );
}

async function getAssetCard(
  view: { container: HTMLElement },
  href: string,
  label: string,
) {
  const { within } = await import("@testing-library/react");
  const matchingLinks = Array.from(
    view.container.querySelectorAll<HTMLAnchorElement>(`a[href="${href}"]`),
  );
  const card = matchingLinks.find((link) => within(link).queryByText(label, { exact: true }));

  assert.ok(card, `没有找到“${label}”分类卡片`);
  return within(card);
}

function seedActiveIP() {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([currentIP, otherIP]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(currentIP.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
}

function addInternalReview(ipId: string, suffix: string) {
  const boardResult = createValidTopicBoardResult();
  const evaluation = {
    ...boardResult,
    ipId,
    ipName: ipId === currentIP.id ? currentIP.name : otherIP.name,
  };
  const topic = addEvaluatedTopicAsset({
    ipId,
    title: `${boardResult.topic}-${suffix}`,
    source: "manual",
  }, evaluation);
  const script = addScriptAssetForTopic({
    topicId: topic.id,
    ipId,
    title: `复盘脚本-${suffix}`,
    cover: "",
    content: `脚本正文-${suffix}`,
    status: "定稿",
  });
  return addVideoReviewForSource({
    activeIPId: ipId,
    source: { type: "flowpilot", scriptId: script.id },
    review: {
      title: script.title,
      platform: "视频号",
      publishedAt: "2026-08-20",
      videoUrl: "",
      contentDirection: "商业洞察",
      scriptText: script.content,
      metrics: { views: 0, likes: 0, comments: 0, favorites: 0, shares: 0, newFollowers: 0, dms: 0, leads: 0, conversions: 0 },
      analysis: null,
    },
  });
}

let restoreBrowser: (() => void) | undefined;

before(() => {
  restoreBrowser = installBrowserEnvironment();
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  seedActiveIP();
});

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
});

after(() => {
  restoreBrowser?.();
});

test("当前IP知识只统计并展示当前IP的数据", async () => {
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    knowledgeEntry("current", "当前IP知识", "IP表达语料", currentIP.id),
    knowledgeEntry("other", "其他IP私有知识", "IP表达语料", otherIP.id),
  ]));

  const view = await renderDashboard();
  const card = await getAssetCard(view, "/knowledge-hub?scope=ip", "当前IP知识库");

  assert.ok(await card.findByText("1", { exact: true }));
  assert.ok(view.getByText("当前IP知识"));
  assert.equal(Boolean(view.queryByText("其他IP私有知识")), false);
});

test("从IP A切换到IP B后工作台立即改为展示IP B的数据", async () => {
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    knowledgeEntry("current", "IP A知识", "IP表达语料", currentIP.id),
    knowledgeEntry("other", "IP B知识", "IP表达语料", otherIP.id),
  ]));

  const view = await renderDashboardWithLayout();
  const userEvent = (await import("@testing-library/user-event")).default;
  const user = userEvent.setup({ document });

  assert.ok(await view.findByText("IP A知识"));
  await user.click(view.getByRole("button", { name: /当前操盘IP.*当前IP-A/ }));
  await user.click(view.getByRole("button", { name: "其他IP-B" }));

  assert.ok(await view.findByText("IP B知识"));
  assert.equal(Boolean(view.queryByText("IP A知识")), false);
});

test("工作台保留大号资产总览设计", async () => {
  const view = await renderDashboard();

  assert.ok(await view.findByText("知识资产合计"));
  assert.ok(view.getByText("条方法、知识、素材与校准样本"));
  assert.ok(view.getByText("最近新增"));
});

test("工作台展示当前生产流程和新增功能入口", async () => {
  const view = await renderDashboard();

  assert.ok(await view.findByText("核心生产流程"));
  assert.ok(view.getByRole("link", { name: /文案整合/ }));
  assert.ok(view.getByRole("link", { name: /直播切片/ }));
  assert.equal(view.getByRole("link", { name: /逐字稿中心/ }).getAttribute("href"), "/transcribe");
  assert.ok(view.getByRole("link", { name: /智能知识入库/ }));
  assert.ok(view.getByRole("link", { name: /内容判断库/ }));
  assert.ok(view.getByText("内容再生产与运营"));
  assert.equal(Boolean(view.queryByRole("link", { name: /录音转逐字稿/ })), false);
});

test("左侧导航按核心生产流程和运营工具分组且不再展示录音转逐字稿", async () => {
  const view = await renderAppLayout();

  assert.ok(await view.findByText("内容生产流程"));
  assert.ok(view.getByText("运营工具"));
  assert.ok(view.getByRole("link", { name: /文案整合.*01/ }));
  assert.ok(view.getByRole("link", { name: /AI 选题董事会.*02/ }));
  assert.ok(view.getByRole("link", { name: /AI IP脚本工厂.*03/ }));
  assert.ok(view.getByRole("link", { name: /AI 拍摄作战室.*04/ }));
  assert.ok(view.getByRole("link", { name: /发布复盘.*05/ }));
  assert.ok(view.getByRole("link", { name: "智能知识入库" }));
  assert.ok(view.getByRole("link", { name: "评论区需求雷达" }));
  assert.ok(view.getByRole("link", { name: "爆款分析" }));
  assert.ok(view.getByRole("link", { name: "文案优化" }));
  assert.equal(Boolean(view.queryByRole("link", { name: /录音转逐字稿/ })), false);
});

test("左侧导航展示Nicole品牌名称和小象Logo", async () => {
  const view = await renderAppLayout();

  assert.ok(await view.findByText("Nicole", { exact: true }));
  assert.ok(view.getByRole("img", { name: "Nicole品牌Logo" }));
  assert.equal(Boolean(view.queryByText("FlowPilot", { exact: true })), false);
});

test("通用方法库只统计并展示明确全局的方法知识", async () => {
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    knowledgeEntry("global", "明确全局方法", "选题方法库", null),
    knowledgeEntry("unowned-private", "无归属私有知识", "IP表达语料", null),
    knowledgeEntry("other-global-category", "其他IP的方法知识", "选题方法库", otherIP.id),
  ]));

  const view = await renderDashboard();
  const card = await getAssetCard(view, "/knowledge-hub?scope=global", "通用方法库");

  assert.ok(await card.findByText("1", { exact: true }));
  assert.ok(view.getByText("明确全局方法"));
  assert.equal(Boolean(view.queryByText("无归属私有知识")), false);
  assert.equal(Boolean(view.queryByText("其他IP的方法知识")), false);
});

test("封面参考库只统计明确全局和当前IP的封面", async () => {
  localStorage.setItem("ipwr:coverRefs", JSON.stringify([
    coverRef("global", "global", null, "2026-08-08T00:00:04.000Z"),
    coverRef("current", "ip", currentIP.id, "2026-08-08T00:00:03.000Z"),
    coverRef("other", "ip", otherIP.id, "2026-08-08T00:00:02.000Z"),
  ]));

  const view = await renderDashboard();
  const card = await getAssetCard(view, "/knowledge-hub?scope=material", "封面参考库");

  assert.ok(await card.findByText("2", { exact: true }));
});

test("图片已迁移到IndexedDB的封面仍在工作台计数", async () => {
  localStorage.setItem("ipwr:coverRefs", JSON.stringify([
    {
      ...coverRef("migrated", "global", null, "2026-08-08T00:00:04.000Z"),
      imageDataUrl: "",
      imageKey: "cover-image-migrated",
    },
  ]));

  const view = await renderDashboard();
  const card = await getAssetCard(view, "/knowledge-hub?scope=material", "封面参考库");

  assert.ok(await card.findByText("1", { exact: true }));
  assert.equal(Boolean(view.queryByText("暂无法加载封面数据")), false);
});

test("封面数据损坏时工作台安全降级并提示暂时无法加载", async () => {
  localStorage.setItem("ipwr:coverRefs", JSON.stringify([null]));

  const view = await renderDashboard();
  const coverCard = await getAssetCard(view, "/knowledge-hub?scope=material", "封面参考库");

  assert.ok(await view.findByText("暂无法加载封面数据"));
  assert.ok(await coverCard.findByText("0", { exact: true }));
  assert.ok(view.getByText("工作台"));
});

test("历史校准样本只统计当前IP的数据", async () => {
  localStorage.setItem("ipwr:topicCalibrationSamples", JSON.stringify([
    { id: "current", ipId: currentIP.id, ipName: currentIP.name },
    { id: "other", ipId: otherIP.id, ipName: otherIP.name },
  ]));

  const view = await renderDashboard();
  const card = await getAssetCard(view, "/topic-board", "历史校准样本");

  assert.ok(await card.findByText("1", { exact: true }));
});

test("完全没有当前IP时只显示通用知识且不暴露任何IP私有数据", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([]));
  localStorage.removeItem("ipwr:activeIpId");
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    knowledgeEntry("global", "无IP时可见的通用方法", "选题方法库", null),
    knowledgeEntry("private", "无IP时不可见的私有知识", "IP表达语料", currentIP.id),
    knowledgeEntry("unowned-private", "无IP时不可见的无归属私有知识", "IP表达语料", null),
  ]));
  localStorage.setItem("ipwr:coverRefs", JSON.stringify([
    coverRef("global", "global", null, "2026-08-08T00:00:04.000Z"),
    coverRef("private", "ip", currentIP.id, "2026-08-08T00:00:03.000Z"),
  ]));
  localStorage.setItem("ipwr:topicCalibrationSamples", JSON.stringify([
    { id: "private", ipId: currentIP.id, ipName: currentIP.name },
  ]));

  const view = await renderDashboard();
  const ipCard = await getAssetCard(view, "/knowledge-hub?scope=ip", "当前IP知识库");
  const coverCard = await getAssetCard(view, "/knowledge-hub?scope=material", "封面参考库");
  const calibrationCard = await getAssetCard(view, "/topic-board", "历史校准样本");

  assert.ok(view.getByText("无IP时可见的通用方法"));
  assert.equal(Boolean(view.queryByText("无IP时不可见的私有知识")), false);
  assert.equal(Boolean(view.queryByText("无IP时不可见的无归属私有知识")), false);
  assert.ok(await ipCard.findByText("0", { exact: true }));
  assert.ok(await coverCard.findByText("1", { exact: true }));
  assert.ok(await calibrationCard.findByText("0", { exact: true }));
});

test("完全没有当前IP时不统计任何IP的复盘记录", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([]));
  localStorage.removeItem("ipwr:activeIpId");
  localStorage.setItem("ipwr:videoReviews", JSON.stringify([
    {
      id: "review-private",
      ipId: otherIP.id,
      title: "其他IP复盘",
      createdAt: "2026-08-08T00:00:00.000Z",
      analysis: null,
    },
  ]));

  const view = await renderDashboard();
  const reviewCard = await getAssetCard(view, "/review", "复盘记录");

  assert.ok(await reviewCard.findByText("0", { exact: true }));
  assert.equal(Boolean(view.queryByText("待复盘记录")), false);
});

test("工作台待复盘数字只统计当前IP内部可追溯的pending记录", async () => {
  const pending = addInternalReview(currentIP.id, "当前待复盘");
  const deferred = addInternalReview(currentIP.id, "当前暂缓");
  deferVideoReview(deferred.id);
  const completed = addInternalReview(currentIP.id, "当前已完成");
  completeVideoReview(completed.id, {
    tags: ["标题结构有效"],
    note: "标题结构带来了更清楚的真实点击反馈。",
  });
  addVideoReviewForSource({
    activeIPId: currentIP.id,
    source: { type: "external" },
    review: {
      title: "当前IP外部内容",
      platform: "视频号",
      publishedAt: "2026-08-20",
      videoUrl: "",
      contentDirection: "商业洞察",
      scriptText: "外部内容",
      metrics: { views: 0, likes: 0, comments: 0, favorites: 0, shares: 0, newFollowers: 0, dms: 0, leads: 0, conversions: 0 },
      analysis: null,
    },
  });
  addInternalReview(otherIP.id, "其他IP待复盘");

  const view = await renderDashboard();
  const pendingLink = await view.findByRole("link", { name: /待复盘记录/ });
  const { within } = await import("@testing-library/react");

  assert.ok(within(pendingLink).getByText("1", { exact: true }));
  assert.equal(pendingLink.getAttribute("href"), "/review?tab=pending");
  assert.ok(pending.id);
});

test("工作台读取历史重复复盘时不会触发维护写入", async () => {
  const pending = addInternalReview(currentIP.id, "历史重复");
  const storedReviews = JSON.parse(localStorage.getItem("ipwr:videoReviews") ?? "[]") as Array<Record<string, unknown>>;
  localStorage.setItem("ipwr:videoReviews", JSON.stringify([
    ...storedReviews,
    {
      ...pending,
      id: "historical-duplicate-review",
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
    },
  ]));

  const beforeRender = localStorage.getItem("ipwr:videoReviews");
  const view = await renderDashboard();
  const pendingLink = await view.findByRole("link", { name: /待复盘记录/ });
  const { within } = await import("@testing-library/react");

  assert.ok(within(pendingLink).getByText("1", { exact: true }));
  assert.equal(localStorage.getItem("ipwr:videoReviews"), beforeRender);
});
