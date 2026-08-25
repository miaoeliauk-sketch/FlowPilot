import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import {
  addEvaluatedTopicAsset,
  addKnowledgeEntry,
  getKnowledgeEntries,
  recordKnowledgeUsage,
} from "./ip-store";
import { addVideoReviewForSource } from "./review-traceability";
import { addScriptAssetForTopic } from "./topic-script-link";
import {
  createTopicBoardIPProfile,
  createValidTopicBoardResult,
} from "./topic-board-contract.fixture";

const ipA = createTopicBoardIPProfile({ id: "ip-detail-a", name: "IP A" });
const ipB = createTopicBoardIPProfile({ id: "ip-detail-b", name: "IP B" });

function knowledgeEntry(id: string, title: string, ipId: string) {
  return {
    id,
    category: "IP人设资料",
    title,
    rawContent: `${title}的完整内容`,
    tags: ["人设"],
    keywords: ["人设"],
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

function createIndexedDBStub() {
  return {
    open() {
      const request: Record<string, any> = {};
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          transaction: () => ({
            objectStore: () => ({
              get: () => {
                const getRequest: Record<string, any> = { result: undefined };
                queueMicrotask(() => getRequest.onsuccess?.());
                return getRequest;
              },
            }),
          }),
          close: () => undefined,
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
}

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/knowledge-hub?scope=ip",
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
    confirm: () => true,
    indexedDB: createIndexedDBStub(),
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
  localStorage.clear();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ipA, ipB]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ipA.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    knowledgeEntry("knowledge-a", "IP A私有详情", ipA.id),
    knowledgeEntry("knowledge-b", "IP B私有详情", ipB.id),
  ]));
});

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
});

after(() => restoreBrowser?.());

test("切换IP时关闭已打开的旧IP知识详情", async () => {
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider, useIP } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;

  function SwitchIP() {
    const { switchIP } = useIP();
    return <button onClick={() => switchIP(ipB.id)}>切换到IP B</button>;
  }

  const view = render(
    <IPProvider>
      <SwitchIP />
      <KnowledgeHubPage />
    </IPProvider>,
  );
  const user = userEvent.setup({ document });
  await view.findByText("IP A私有详情");
  await user.click(view.getByText("IP A私有详情"));
  assert.ok(view.getByRole("button", { name: "关闭" }));

  await user.click(view.getByRole("button", { name: "切换到IP B" }));
  assert.equal(view.queryAllByText("IP A私有详情的完整内容").length, 0);
  assert.equal(view.queryByText("IP A私有详情"), null);
  assert.ok(view.getByText("IP B私有详情"));
});

test("历史V1认知在详情页明确提示待登记并可完成登记", async () => {
  const sourceId = "legacy-source-register-ui";
  const rawContent = "老师明确说：判断来自真实矛盾。";
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([{
    ...knowledgeEntry(sourceId, "历史V1认知", ipA.id),
    category: "IP原始内容",
    rawContent,
    sourceAnalysis: {
      analyzedAt: "2026-08-25T12:00:00.000Z",
      parserVersion: 1,
      items: [{
        id: "legacy-ui-claim",
        kind: "claim",
        content: "判断来自真实矛盾。",
        sourceId,
        startPosition: 6,
        endPosition: 14,
        originalExcerpt: "判断来自真实矛盾",
        extractionStatus: "人工确认",
      }],
    },
  }]));
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ legacyProof: "signed-legacy-proof" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
    const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);
    const user = userEvent.setup({ document });

    await user.click(await view.findByRole("button", { name: /IP原始内容/ }));
    await user.click(await view.findByText("历史V1认知"));
    assert.ok(view.getByText("待合规登记"));
    await user.click(view.getByRole("button", { name: "登记V1认知" }));
    assert.ok(await view.findByText("已合规登记"));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("知识卡片按真实采用和发布复盘拆分统计且历史未验证记录单列", async () => {
  const ip = createTopicBoardIPProfile();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([]));
  const boardResult = createValidTopicBoardResult();
  const firstTopic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
  const secondTopic = addEvaluatedTopicAsset({
    ipId: ip.id,
    title: `${boardResult.topic}第二条`,
    source: "manual",
  }, boardResult);
  const knowledge = addKnowledgeEntry({
    category: "IP人设资料",
    title: "只统计真实采用的知识",
    rawContent: "统计必须来自真实采用的脚本。",
    tags: [], keywords: [], ipId: ip.id,
    sourceTier: "高", sourceTierReason: "测试", contentDirection: [],
    sourcePlatform: "测试", sourceUrl: "", note: "",
    extractedAt: "2026-08-20T00:00:00.000Z",
    metrics: null, viralEvaluation: null, usageRecords: [],
    status: "未使用", dna: null,
  });
  const scripts = [firstTopic, secondTopic].map((topic, index) =>
    addScriptAssetForTopic({
      topicId: topic.id,
      ipId: ip.id,
      title: `真实采用脚本${index + 1}`,
      cover: "",
      content: "最终脚本正文",
      status: "定稿",
      knowledgeTracking: {
        status: "unavailable",
        candidateKnowledgeEntryIds: [knowledge.id],
        verifiedAt: "2026-08-20T08:00:00.000Z",
        usages: [],
      },
    })
  );
  for (const [index, script] of scripts.entries()) {
    recordKnowledgeUsage(knowledge.id, {
      module: "脚本工厂",
      usedAt: `2026-08-2${index}T08:00:00.000Z`,
      reason: "脚本生成成功",
      relevanceTier: "高度相关",
      relevanceReason: "与脚本主题直接相关",
      context: index === 0 ? firstTopic.title : secondTopic.title,
    }, "已用于脚本", script.id);
  }
  const publishedReview = addVideoReviewForSource({
    activeIPId: ip.id,
    source: { type: "flowpilot", scriptId: scripts[0]!.id },
    review: {
      title: "真实发布复盘",
      platform: "视频号",
      publishedAt: "2026-08-21",
      videoUrl: "",
      contentDirection: "商业洞察",
      scriptText: "最终脚本正文",
      metrics: { views: 3200, likes: 180, comments: 24, favorites: 31, shares: 12, newFollowers: 15, dms: 2, leads: 1, conversions: 0 },
      analysis: null,
    },
  });
  const [storedKnowledge] = getKnowledgeEntries();
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([{
    ...storedKnowledge,
    usageRecords: [{
      ...storedKnowledge!.usageRecords[0]!,
      id: "same-script-without-review",
      usedAt: "2026-08-19T08:00:00.000Z",
      reviewId: null,
    }, ...storedKnowledge!.usageRecords.map(record =>
      record.scriptId === scripts[0]!.id
        ? { ...record, reviewId: "old-review" }
        : record
    ), {
      id: "legacy-usage",
      module: "脚本工厂",
      usedAt: "2025-01-01T00:00:00.000Z",
      reason: "历史旧记录",
      relevanceTier: "中度相关",
      relevanceReason: "历史数据无法验证",
      context: "旧内容",
      trackingStatus: "legacy_unverified",
      topicId: null,
      scriptId: null,
      reviewId: null,
      usageType: null,
      sectionLabel: null,
      evidenceExcerpt: null,
    }, {
      ...storedKnowledge!.usageRecords[1]!,
      id: "damaged-usage-without-used-at",
      usedAt: undefined,
      reviewId: null,
    }],
  }]));
  localStorage.setItem("ipwr:videoReviews", JSON.stringify([{
    ...publishedReview,
    id: "old-review",
    createdAt: "2026-08-20T09:00:00.000Z",
  }, {
    ...publishedReview,
    knowledgeEffectStatus: "tracked_status_pending",
    metrics: {
      ...publishedReview.metrics,
      conversions: undefined,
    },
  }]));
  const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
  const originalSetItem = storagePrototype.setItem;
  let videoReviewWritesDuringRender = 0;
  storagePrototype.setItem = function (key: string, value: string): void {
    if (key === "ipwr:videoReviews") videoReviewWritesDuringRender += 1;
    originalSetItem.call(this, key, value);
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
    const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);
    const user = userEvent.setup({ document });

    await view.findByText("只统计真实采用的知识");
    assert.ok(view.getByText("已用于脚本：2次"));
    assert.ok(view.getByText("已有发布复盘：1次"));
    assert.ok(view.getByText("尚未发布或未复盘：1次"));
    assert.ok(view.getByText("历史未验证：1次（不计入上述统计）"));
    assert.equal(view.queryByText(/被引用3次/), null);

    await user.click(view.getByText("只统计真实采用的知识"));
    assert.ok(view.getByText("知识效果参考"));
    assert.ok(view.getByText("真实采用脚本1"));
    assert.ok(view.getByText("真实采用脚本2"));
    assert.ok(view.getByText(/播放3,200/));
    assert.ok(view.getByText(/点赞180/));
    assert.ok(view.getByText(/评论24/));
    assert.ok(view.getByText(/转化—/));
    assert.ok(view.getByText("尚未发布或未复盘"));
    assert.ok(view.getByText("历史未验证记录1次（不计入新口径）"));
    assert.equal(view.queryByText(/知识有效|知识无效|效果评分/), null);
    assert.equal(videoReviewWritesDuringRender, 0);
  } finally {
    storagePrototype.setItem = originalSetItem;
  }
});

test("复盘列表不是数组时安全降级为空列表", async () => {
  localStorage.setItem("ipwr:videoReviews", JSON.stringify({ damaged: true }));

  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);

  await view.findByText("IP A私有详情");
  assert.ok(view.getByText("已有发布复盘：0次"));
});

test("缺少创建时间的历史复盘不会导致知识库页面崩溃", async () => {
  localStorage.setItem("ipwr:videoReviews", JSON.stringify([{
    id: "damaged-review-without-created-at",
    sourceType: "external",
    title: "损坏的历史复盘",
  }, {
    id: "valid-review",
    createdAt: "2026-08-22T00:00:00.000Z",
    sourceType: "external",
    title: "可读取的历史复盘",
  }]));

  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const view = render(<IPProvider><KnowledgeHubPage /></IPProvider>);

  await view.findByText("IP A私有详情");
  assert.ok(view.getByText("已有发布复盘：0次"));
});
