import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { addKnowledgeEntry, getKnowledgeEntries, getTopicAssets } from "./ip-store";
import { buildIPSourceAnalysisV2 } from "./ip-source-analysis-v2";
import { addVideoReviewForSource } from "./review-traceability";
import { createValidTopicBoardResult } from "./topic-board-contract.fixture";
import type { IPProfile, KnowledgeCategory } from "./types";

const SHIKONG: IPProfile = {
  id: "ip-shikong",
  name: "设计师石空",
  avatar: "石",
  positioning: "高端住宅设计师",
  platforms: ["视频号"],
  audience: "准备装修的业主",
  contentDirection: ["住宅设计"],
  personaKeywords: ["专业"],
  professionalIdentity: "设计师",
  personalityTags: ["直接"],
  credibilitySource: "项目经验",
  representativeViewpoints: ["设计服务生活"],
  tone: "专业直接",
  commonOpenings: ["装修之前"],
  commonClosings: ["设计要落地"],
  catchphrases: [],
  forbiddenExpressions: [],
  pacing: "简洁",
  commonScenes: ["工地"],
  commonShotTypes: ["口播"],
  showsFace: true,
  usesScreenRecording: false,
  needsBroll: true,
  needsCaseScreenshots: true,
  needsSubtitleHighlight: true,
  sampleViralTitles: [],
  styleNotes: "住宅设计",
  bio: "",
  color: "#654321",
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
};

const SHUIMURAN: IPProfile = {
  id: "ip-shuimuran",
  name: "水木然",
  avatar: "水",
  positioning: "商业认知作者",
  platforms: ["视频号", "抖音"],
  audience: "关注商业趋势和个人成长的人",
  contentDirection: ["商业洞察", "个人成长"],
  personaKeywords: ["理性", "洞察"],
  professionalIdentity: "商业作者",
  personalityTags: ["克制", "清醒"],
  credibilitySource: "长期研究商业趋势并持续公开写作",
  representativeViewpoints: ["趋势影响个体选择", "认知决定行动质量"],
  tone: "理性克制",
  commonOpenings: ["很多人没意识到", "真正重要的变化是"],
  commonClosings: ["这才是关键", "选择比努力更重要"],
  catchphrases: ["看懂趋势"],
  forbiddenExpressions: ["装修", "豪宅", "施工"],
  pacing: "层层递进",
  commonScenes: ["书房", "演播室"],
  commonShotTypes: ["正面口播", "图表讲解"],
  showsFace: true,
  usesScreenRecording: false,
  needsBroll: true,
  needsCaseScreenshots: false,
  needsSubtitleHighlight: true,
  sampleViralTitles: ["普通人如何看懂下一轮行业趋势"],
  styleNotes: "以商业趋势切入，给出克制、可验证的判断",
  bio: "关注商业趋势与个人选择的作者",
  color: "#123456",
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
};

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

function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("页面没有发出董事会请求")), timeoutMs);
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

function addBoardKnowledge({
  idLabel,
  ipId,
  category,
}: {
  idLabel: string;
  ipId: string | null;
  category?: KnowledgeCategory;
}) {
  return addKnowledgeEntry({
    category: category ?? "选题方法库",
    title: `${idLabel}机会判断方法`,
    rawContent: "普通人判断机会时，需要先检查它是否适合自己。",
    tags: ["机会"],
    keywords: ["机会", "判断"],
    ipId,
    sourceTier: "高",
    sourceTierReason: "页面流程测试",
    contentDirection: [],
    sourcePlatform: "测试",
    sourceUrl: "",
    note: "",
    extractedAt: "2026-08-15T00:00:00.000Z",
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
  });
}

function knowledgeSearchResult(id: string) {
  return {
    id,
    reason: "与当前选题直接相关",
    relevanceTier: "高度相关",
    relevanceReason: "标题和关键词均命中",
    matchedFields: ["标题"],
    matchedKeywords: ["机会"],
    methodMatches: [],
    methodAdvice: "",
    matchScore: 10,
  };
}

test("知识只被检索展示时不写入选题使用记录", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  let usageCountAfterSearch = -1;
  let statusAfterSearch = "";

  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
    const knowledge = addBoardKnowledge({ idLabel: "仅展示", ipId: SHUIMURAN.id });

    globalThis.fetch = async (input) => {
      if (String(input) === "/api/knowledge-search") {
        const result = knowledgeSearchResult(knowledge.id);
        return new Response(JSON.stringify({
          results: [{
            ...result,
            matchedFields: ["标题", "标签"],
            methodMatches: ["反常识结构"],
            methodAdvice: "先呈现大众判断，再给出相反解释。",
          }],
          debug: null,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "测试不应调用其他接口" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    };

    const { cleanup, render, waitFor } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    cleanupPage = cleanup;
    const { IPProvider } = await import("./ip-context");
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const page = render(
      <IPProvider>
        <TopicBoardPage />
      </IPProvider>,
    );

    await page.findByText(`[选题方法库] ${knowledge.title}`);
    assert.ok(page.getByText("命中字段：标题、标签"));
    assert.ok(page.getByText("调用方法：反常识结构。先呈现大众判断，再给出相反解释。"));
    assert.equal(page.queryByText("检索调试"), null);
    const stored = getKnowledgeEntries().find(entry => entry.id === knowledge.id);
    usageCountAfterSearch = stored?.usageRecords.length ?? -1;
    statusAfterSearch = stored?.status ?? "";
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }

  assert.equal(usageCountAfterSearch, 0);
  assert.equal(statusAfterSearch, "未使用");
});

test("董事会主评估先完成展示，内容适配随后异步补充且先描述内容再判断IP匹配", { timeout: 9000 }, async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  let releaseAdaptation!: () => void;
  const adaptationGate = new Promise<void>(resolve => { releaseAdaptation = resolve; });

  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));

    globalThis.fetch = async (input, init) => {
      if (String(input) === "/api/topic-review") {
        return new Response(JSON.stringify(createValidTopicBoardResult()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(input) === "/api/content-adaptation") {
        const request = JSON.parse(String(init?.body ?? "{}")) as {
          items?: Array<{ key?: string }>;
        };
        await adaptationGate;
        return new Response(JSON.stringify({
          items: [{
            key: request.items?.[0]?.key,
            contentProfile: {
              primaryTrack: "财经商业",
              secondaryTrack: "职场成长",
              fineTags: ["商业机会", "职业选择"],
              targetAudience: "正在判断职业机会的职场人",
              audienceTags: ["职场人", "机会判断"],
              primaryPurpose: "信任建立",
              secondaryPurpose: "知识教育",
              reasons: {
                track: "选题围绕商业机会判断展开。",
                audience: "问题直接面向正在做职业选择的人。",
                purpose: "用判断框架建立专业信任。",
              },
            },
            ipFit: {
              tier: "高度匹配",
              reason: "与水木然的商业洞察定位和目标人群一致。",
            },
          }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ results: [], debug: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const { act, cleanup, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const user = userEvent.setup({ document });
    const page = render(<IPProvider><TopicBoardPage /></IPProvider>);

    await user.click(page.getByRole("button", { name: "召开董事会" }));
    await page.findByText("评估已保存到水木然的选题库。", {}, { timeout: 7000 });
    assert.ok(page.getByText("小白决策建议"));
    assert.ok(page.getByText("内容适配正在异步生成，不影响选题评估"));

    await act(async () => {
      releaseAdaptation();
      await adaptationGate;
    });
    await page.findByText(/目标人群：正在判断职业机会的职场人/);
    const section = page.getByRole("region", { name: "内容适配与IP匹配" });
    const sectionText = section.textContent ?? "";
    assert.ok(sectionText.indexOf("内容本身") < sectionText.indexOf("与当前IP"));
    assert.match(sectionText, /财经商业/);
    assert.match(sectionText, /高度匹配/);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("内容适配生成失败不阻断选题评估和保存", { timeout: 9000 }, async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
    globalThis.fetch = async input => {
      if (String(input) === "/api/topic-review") {
        return new Response(JSON.stringify(createValidTopicBoardResult()), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(input) === "/api/content-adaptation") {
        return new Response(JSON.stringify({ error: "模拟辅助判断失败" }), { status: 502, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ results: [], debug: null }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const { cleanup, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const page = render(<IPProvider><TopicBoardPage /></IPProvider>);
    await userEvent.setup({ document }).click(page.getByRole("button", { name: "召开董事会" }));
    await page.findByText("评估已保存到水木然的选题库。", {}, { timeout: 7000 });
    await page.findByText("内容适配暂不可用，不影响选题评估");
    assert.ok(page.getByText("小白决策建议"));
    assert.equal(getTopicAssets(SHUIMURAN.id).length, 1);
    assert.equal(getTopicAssets(SHUIMURAN.id)[0]?.contentAdaptation, null);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("修改选题后等待中的旧内容适配失效且不写入历史选题", { timeout: 9000 }, async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  let releaseAdaptation!: () => void;
  const adaptationGate = new Promise<void>(resolve => { releaseAdaptation = resolve; });
  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
    globalThis.fetch = async (input, init) => {
      if (String(input) === "/api/topic-review") return new Response(JSON.stringify(createValidTopicBoardResult()), { status: 200, headers: { "Content-Type": "application/json" } });
      if (String(input) === "/api/content-adaptation") {
        const request = JSON.parse(String(init?.body ?? "{}")) as { items: Array<{ key: string }> };
        await adaptationGate;
        return new Response(JSON.stringify({ items: [{ key: request.items[0]?.key, contentProfile: { primaryTrack: "财经商业", secondaryTrack: null, fineTags: ["旧选题", "迟到结果"], targetAudience: "旧选题人群", audienceTags: ["旧人群", "旧判断"], primaryPurpose: "知识教育", secondaryPurpose: null, reasons: { track: "旧结果", audience: "旧结果", purpose: "旧结果" } }, ipFit: { tier: "高度匹配", reason: "旧结果不应回写" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ results: [], debug: null }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const page = render(<IPProvider><TopicBoardPage /></IPProvider>);
    await userEvent.setup({ document }).click(page.getByRole("button", { name: "召开董事会" }));
    await page.findByText("内容适配正在异步生成，不影响选题评估", {}, { timeout: 7000 });
    fireEvent.change(page.getByRole("textbox"), { target: { value: "这是已经切换的新选题" } });
    await act(async () => { releaseAdaptation(); await adaptationGate; await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(page.queryByText(/旧选题人群/), null);
    assert.equal(page.queryByRole("region", { name: "内容适配与IP匹配" }), null);
    assert.equal(getTopicAssets(SHUIMURAN.id)[0]?.contentAdaptation, null);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("切换IP后等待中的旧内容适配失效且不跨IP回写", { timeout: 9000 }, async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  let releaseAdaptation!: () => void;
  const adaptationGate = new Promise<void>(resolve => { releaseAdaptation = resolve; });
  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN, SHIKONG]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
    globalThis.fetch = async (input, init) => {
      if (String(input) === "/api/topic-review") return new Response(JSON.stringify(createValidTopicBoardResult()), { status: 200, headers: { "Content-Type": "application/json" } });
      if (String(input) === "/api/content-adaptation") {
        const request = JSON.parse(String(init?.body ?? "{}")) as { items: Array<{ key: string }> };
        await adaptationGate;
        return new Response(JSON.stringify({ items: [{ key: request.items[0]?.key, contentProfile: { primaryTrack: "财经商业", secondaryTrack: null, fineTags: ["旧IP", "迟到结果"], targetAudience: "旧IP目标人群", audienceTags: ["旧IP", "旧人群"], primaryPurpose: "知识教育", secondaryPurpose: null, reasons: { track: "旧IP", audience: "旧IP", purpose: "旧IP" } }, ipFit: { tier: "高度匹配", reason: "旧IP结果" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ results: [], debug: null }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const { act, cleanup, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const AppLayout = (await import("../components/layout/AppLayout")).default;
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const user = userEvent.setup({ document });
    const page = render(<IPProvider><AppLayout><TopicBoardPage /></AppLayout></IPProvider>);
    await user.click(page.getByRole("button", { name: "召开董事会" }));
    await page.findByText("内容适配正在异步生成，不影响选题评估", {}, { timeout: 7000 });
    const currentIPButton = (await page.findByText("当前操盘IP")).closest("button");
    assert.ok(currentIPButton);
    await user.click(currentIPButton);
    await user.click(page.getByRole("button", { name: /设计师石空/ }));
    await page.findByText(/评估背景：当前操盘IP为设计师石空/);
    await act(async () => { releaseAdaptation(); await adaptationGate; await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(page.queryByText(/旧IP目标人群/), null);
    assert.equal(getTopicAssets(SHUIMURAN.id)[0]?.contentAdaptation, null);
    assert.equal(getTopicAssets(SHIKONG.id).length, 0);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("重新评估后迟到的旧适配结果不能覆盖新结果", { timeout: 15000 }, async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  let adaptationCount = 0;
  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
    globalThis.fetch = async (input, init) => {
      if (String(input) === "/api/topic-review") return new Response(JSON.stringify(createValidTopicBoardResult()), { status: 200, headers: { "Content-Type": "application/json" } });
      if (String(input) === "/api/content-adaptation") {
        adaptationCount += 1;
        const thisRequest = adaptationCount;
        const request = JSON.parse(String(init?.body ?? "{}")) as { items: Array<{ key: string }> };
        if (thisRequest === 1) await firstGate;
        const label = thisRequest === 1 ? "迟到旧结果" : "当前新结果";
        return new Response(JSON.stringify({ items: [{ key: request.items[0]?.key, contentProfile: { primaryTrack: "财经商业", secondaryTrack: null, fineTags: [label, "机会判断"], targetAudience: `${label}目标人群`, audienceTags: [label, "职场人"], primaryPurpose: "知识教育", secondaryPurpose: null, reasons: { track: label, audience: label, purpose: label } }, ipFit: { tier: "高度匹配", reason: `${label}匹配说明` } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ results: [], debug: null }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const { act, cleanup, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const user = userEvent.setup({ document });
    const page = render(<IPProvider><TopicBoardPage /></IPProvider>);
    await user.click(page.getByRole("button", { name: "召开董事会" }));
    await page.findByText("内容适配正在异步生成，不影响选题评估", {}, { timeout: 7000 });
    await user.click(page.getByRole("button", { name: "召开董事会" }));
    await page.findByText(/目标人群：当前新结果目标人群/, {}, { timeout: 7000 });
    await act(async () => { releaseFirst(); await firstGate; await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(page.queryByText(/迟到旧结果目标人群/), null);
    assert.ok(page.getByText(/目标人群：当前新结果目标人群/));
    const assets = getTopicAssets(SHUIMURAN.id);
    assert.equal(assets.length, 2);
    assert.equal(assets.filter(asset => asset.contentAdaptation).length, 1);
    assert.equal(assets[0]?.contentAdaptation?.current?.contentProfile.targetAudience, "当前新结果目标人群");
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("人工修改内容适配后保留AI原始判断和修改记录", { timeout: 9000 }, async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
    globalThis.fetch = async (input, init) => {
      if (String(input) === "/api/topic-review") return new Response(JSON.stringify(createValidTopicBoardResult()), { status: 200, headers: { "Content-Type": "application/json" } });
      if (String(input) === "/api/content-adaptation") {
        const request = JSON.parse(String(init?.body ?? "{}")) as { items: Array<{ key: string }> };
        return new Response(JSON.stringify({ items: [{ key: request.items[0]?.key, contentProfile: { primaryTrack: "财经商业", secondaryTrack: null, fineTags: ["商业机会", "职业选择"], targetAudience: "AI判断的目标人群", audienceTags: ["职场人", "机会判断"], primaryPurpose: "信任建立", secondaryPurpose: null, reasons: { track: "商业机会选题", audience: "面向职场人", purpose: "建立专业信任" } }, ipFit: { tier: "高度匹配", reason: "符合当前IP定位" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ results: [], debug: null }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const { cleanup, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const user = userEvent.setup({ document });
    const page = render(<IPProvider><TopicBoardPage /></IPProvider>);
    await user.click(page.getByRole("button", { name: "召开董事会" }));
    await page.findByText(/目标人群：AI判断的目标人群/, {}, { timeout: 7000 });
    await user.click(page.getByRole("button", { name: "编辑内容适配" }));
    const audienceInput = page.getByRole("textbox", { name: "目标人群" });
    await user.clear(audienceInput);
    await user.type(audienceInput, "人工修正后的目标人群");
    await user.click(page.getByRole("button", { name: "保存人工修改" }));
    await page.findByText(/目标人群：人工修正后的目标人群/);
    const stored = getTopicAssets(SHUIMURAN.id)[0]?.contentAdaptation;
    assert.equal(stored?.reviewStatus, "human_modified");
    assert.equal(stored?.aiOriginal.contentProfile.targetAudience, "AI判断的目标人群");
    assert.equal(stored?.current?.contentProfile.targetAudience, "人工修正后的目标人群");
    assert.equal(stored?.revisions.at(-1)?.action, "modify");
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("切换IP后立即清空上一IP已经显示的知识", { timeout: 5000 }, async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  let oldKnowledgeStillVisible = false;

  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN, SHIKONG]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));

    const waterEntry = addBoardKnowledge({ idLabel: "水木然专属", ipId: SHUIMURAN.id });
    addBoardKnowledge({ idLabel: "石空专属", ipId: SHIKONG.id });

    globalThis.fetch = async (input) => {
      if (String(input) === "/api/knowledge-search") {
        return new Response(JSON.stringify({
          results: [knowledgeSearchResult(waterEntry.id)],
          debug: null,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "测试不应调用其他接口" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    };

    const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { IPProvider } = await import("./ip-context");
    const AppLayout = (await import("../components/layout/AppLayout")).default;
    const TopicBoardPage = (await import("../app/topic-board/page")).default;

    const page = render(
      <IPProvider>
        <AppLayout>
          <TopicBoardPage />
        </AppLayout>
      </IPProvider>,
    );

    await page.findByText(`[选题方法库] ${waterEntry.title}`);
    const currentIPButton = (await page.findByText("当前操盘IP")).closest("button");
    assert.ok(currentIPButton);
    await act(async () => {
      fireEvent.click(currentIPButton);
    });
    await act(async () => {
      fireEvent.click(page.getByRole("button", { name: /设计师石空/ }));
    });
    await page.findByText(/评估背景：当前操盘IP为设计师石空/);

    oldKnowledgeStillVisible = page.queryByText(`[选题方法库] ${waterEntry.title}`) !== null;
    await page.findByText(/知识库里没有找到强相关的参考|未命中强相关知识库/, {}, { timeout: 2000 });
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
  assert.equal(oldKnowledgeStillVisible, false);
});

test("切换IP后旧检索响应不能覆盖当前知识列表", { timeout: 7000 }, async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  let staleKnowledgeVisible = false;
  let staleUsageCount = -1;
  let searchCount = 0;
  let resolveOldSearchStarted!: () => void;
  let resolveNewSearchStarted!: () => void;
  let releaseOldSearch!: () => void;
  let releaseNewSearch!: () => void;
  const oldSearchStarted = new Promise<void>(resolve => { resolveOldSearchStarted = resolve; });
  const newSearchStarted = new Promise<void>(resolve => { resolveNewSearchStarted = resolve; });

  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN, SHIKONG]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));

    const waterEntry = addBoardKnowledge({ idLabel: "迟到的水木然", ipId: SHUIMURAN.id });
    addBoardKnowledge({ idLabel: "石空当前", ipId: SHIKONG.id });

    globalThis.fetch = async (input) => {
      if (String(input) !== "/api/knowledge-search") {
        return new Response(JSON.stringify({ error: "测试不应调用其他接口" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      searchCount += 1;
      if (searchCount === 1) {
        return new Response(JSON.stringify({ results: [], debug: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (searchCount === 2) {
        resolveOldSearchStarted();
        return new Promise<Response>(resolve => {
          releaseOldSearch = () => resolve(new Response(JSON.stringify({
            results: [knowledgeSearchResult(waterEntry.id)],
            debug: null,
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }));
        });
      }
      resolveNewSearchStarted();
      return new Promise<Response>(resolve => {
        releaseNewSearch = () => resolve(new Response(JSON.stringify({ results: [], debug: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      });
    };

    const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { IPProvider } = await import("./ip-context");
    const AppLayout = (await import("../components/layout/AppLayout")).default;
    const TopicBoardPage = (await import("../app/topic-board/page")).default;

    const page = render(
      <IPProvider>
        <AppLayout>
          <TopicBoardPage />
        </AppLayout>
      </IPProvider>,
    );

    await page.findByText(/知识库里没有找到强相关的参考|未命中强相关知识库/);
    const topicInput = page.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(topicInput, { target: { value: "水木然新的机会判断方法" } });
    await waitWithTimeout(oldSearchStarted, 3000);

    const currentIPButton = (await page.findByText("当前操盘IP")).closest("button");
    assert.ok(currentIPButton);
    await act(async () => { fireEvent.click(currentIPButton); });
    await act(async () => {
      fireEvent.click(page.getByRole("button", { name: /设计师石空/ }));
    });
    await page.findByText(/评估背景：当前操盘IP为设计师石空/);

    await act(async () => {
      releaseOldSearch();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    staleKnowledgeVisible = page.queryByText(`[选题方法库] ${waterEntry.title}`) !== null;
    staleUsageCount = getKnowledgeEntries().find(entry => entry.id === waterEntry.id)?.usageRecords.length ?? -1;

    await waitWithTimeout(newSearchStarted, 3000);
    await act(async () => {
      releaseNewSearch();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await page.findByText(/知识库里没有找到强相关的参考|未命中强相关知识库/);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
  assert.equal(staleKnowledgeVisible, false);
  assert.equal(staleUsageCount, 0);
});

test("修改选题后旧检索响应不能覆盖新选题结果", { timeout: 7000 }, async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  let staleKnowledgeVisible = false;
  let searchCount = 0;
  let resolveOldSearchStarted!: () => void;
  let resolveNewSearchStarted!: () => void;
  let releaseOldSearch!: () => void;
  let releaseNewSearch!: () => void;
  const oldSearchStarted = new Promise<void>(resolve => { resolveOldSearchStarted = resolve; });
  const newSearchStarted = new Promise<void>(resolve => { resolveNewSearchStarted = resolve; });

  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
    const oldEntry = addBoardKnowledge({ idLabel: "旧选题", ipId: SHUIMURAN.id });
    const newEntry = addBoardKnowledge({ idLabel: "新选题", ipId: SHUIMURAN.id });

    globalThis.fetch = async (input) => {
      if (String(input) !== "/api/knowledge-search") {
        return new Response(JSON.stringify({ error: "测试不应调用其他接口" }), { status: 500 });
      }
      searchCount += 1;
      if (searchCount === 1) {
        return new Response(JSON.stringify({ results: [], debug: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (searchCount === 2) {
        resolveOldSearchStarted();
        return new Promise<Response>(resolve => {
          releaseOldSearch = () => resolve(new Response(JSON.stringify({
            results: [knowledgeSearchResult(oldEntry.id)],
            debug: null,
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }));
        });
      }
      resolveNewSearchStarted();
      return new Promise<Response>(resolve => {
        releaseNewSearch = () => resolve(new Response(JSON.stringify({
          results: [knowledgeSearchResult(newEntry.id)],
          debug: null,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      });
    };

    const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { IPProvider } = await import("./ip-context");
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const page = render(
      <IPProvider>
        <TopicBoardPage />
      </IPProvider>,
    );

    await page.findByText(/知识库里没有找到强相关的参考|未命中强相关知识库/);
    const topicInput = page.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(topicInput, { target: { value: "高净值客户旧选题" } });
    await waitWithTimeout(oldSearchStarted, 3000);
    fireEvent.change(topicInput, { target: { value: "高净值客户新选题" } });

    await act(async () => {
      releaseOldSearch();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    staleKnowledgeVisible = page.queryByText(`[选题方法库] ${oldEntry.title}`) !== null;

    await waitWithTimeout(newSearchStarted, 3000);
    await act(async () => {
      releaseNewSearch();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await page.findByText(`[选题方法库] ${newEntry.title}`);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
  assert.equal(staleKnowledgeVisible, false);
});

test("董事会检索只发送通用知识和当前IP知识", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  let resolveSearchRequest!: (body: Record<string, unknown>) => void;
  const searchRequest = new Promise<Record<string, unknown>>(resolve => {
    resolveSearchRequest = resolve;
  });

  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/knowledge-search") {
      resolveSearchRequest(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify({ results: [], debug: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "测试不应调用其他接口" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN, SHIKONG]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));

    const globalEntry = addBoardKnowledge({ idLabel: "通用", ipId: null, category: "爆款案例" });
    const currentIPEntry = addBoardKnowledge({ idLabel: "水木然", ipId: SHUIMURAN.id });
    addBoardKnowledge({ idLabel: "石空", ipId: SHIKONG.id });

    const { cleanup, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { IPProvider } = await import("./ip-context");
    const TopicBoardPage = (await import("../app/topic-board/page")).default;

    const page = render(
      <IPProvider>
        <TopicBoardPage />
      </IPProvider>,
    );

    const requestBody = await waitWithTimeout(searchRequest, 3000);
    await page.findByText(/知识库里没有找到强相关的参考|未命中强相关知识库/);
    const entries = requestBody.entries as Array<{ id?: string; normalizedCategory?: string }> | undefined;
    assert.deepEqual(
      entries?.map(entry => entry.id).sort(),
      [globalEntry.id, currentIPEntry.id].sort(),
    );
    assert.equal(
      entries?.find(entry => entry.id === globalEntry.id)?.normalizedCategory,
      "选题方法库",
    );
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("用户从页面选中水木然之后，董事会请求携带完整的水木然档案", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  let resolveRequest!: (body: Record<string, unknown>) => void;
  const capturedRequest = new Promise<Record<string, unknown>>(resolve => {
    resolveRequest = resolve;
  });

  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/topic-review") {
      resolveRequest(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify({ error: "测试已截获请求" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ results: [], debug: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHIKONG, SHUIMURAN]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHIKONG.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));

    const { act, cleanup, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const AppLayout = (await import("../components/layout/AppLayout")).default;
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const user = userEvent.setup({ document });

    const page = render(
      <IPProvider>
        <AppLayout>
          <TopicBoardPage />
        </AppLayout>
      </IPProvider>,
    );

    const currentIPLabel = await page.findByText("当前操盘IP");
    const currentIPButton = currentIPLabel.closest("button");
    assert.ok(currentIPButton);
    assert.match(currentIPButton.textContent ?? "", /设计师石空/);

    const topicInput = page.getByRole("textbox") as HTMLTextAreaElement;
    assert.equal(topicInput.value, "普通人如何判断一个机会是否真的适合自己？");
    assert.ok(page.getByRole("button", { name: "为什么同样的方法，有人有效，有人却没效果？" }));
    assert.ok(page.getByRole("button", { name: "一个专业服务最容易被用户误解的地方是什么？" }));
    assert.ok(page.getByRole("button", { name: "新手开始一件事时，最应该避开的误区是什么？" }));
    assert.match(
      (await page.findByText(/评估背景：当前操盘IP为设计师石空/)).textContent ?? "",
      /将结合其受众、内容方向和表达风格进行判断/,
    );

    await user.click(currentIPButton);
    await user.click(page.getByRole("button", { name: /水木然/ }));
    assert.match(currentIPButton.textContent ?? "", /水木然/);
    assert.match(
      (await page.findByText(/评估背景：当前操盘IP为水木然/)).textContent ?? "",
      /将结合其受众、内容方向和表达风格进行判断/,
    );
    assert.equal(page.queryByText(/演示背景：当前IP为设计师石空/), null);

    const topic = "普通人如何判断行业趋势";
    await user.clear(topicInput);
    await user.type(topicInput, topic);
    const requestBody = await act(async () => {
      await user.click(page.getByRole("button", { name: "召开董事会" }));
      return waitWithTimeout(capturedRequest, 7000);
    });
    await page.findByText("测试已截获请求");
    const sentIP = requestBody.ipProfile as IPProfile | undefined;

    assert.equal(requestBody.topic, topic);
    assert.deepEqual(sentIP, SHUIMURAN);
    assert.doesNotMatch(JSON.stringify(requestBody), /设计师石空|准备装修的业主/);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("董事会评审只发送通用和当前IP可见的历史证据", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  let resolveRequest!: (body: Record<string, unknown>) => void;
  const capturedRequest = new Promise<Record<string, unknown>>(resolve => {
    resolveRequest = resolve;
  });

  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/topic-review") {
      resolveRequest(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify({ error: "测试已截获请求" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ results: [], debug: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN, SHIKONG]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));

    const globalEvidence = addBoardKnowledge({ idLabel: "通用", ipId: null, category: "爆款案例" });
    const currentIPEvidence = addBoardKnowledge({ idLabel: "水木然", ipId: SHUIMURAN.id, category: "爆款案例" });
    const otherIPEvidence = addBoardKnowledge({ idLabel: "石空", ipId: SHIKONG.id, category: "爆款案例" });
    const externalReview = addVideoReviewForSource({
      activeIPId: SHUIMURAN.id,
      source: { type: "external" },
      review: {
        title: "普通人如何判断一个机会是否真的适合自己？",
        platform: "视频号",
        publishedAt: "2026-08-20",
        videoUrl: "",
        contentDirection: "机会判断",
        scriptText: "普通人如何判断一个机会是否真的适合自己？",
        metrics: { views: 9999, likes: 999, comments: 99, favorites: 99, shares: 99, newFollowers: 99, dms: 0, leads: 0, conversions: 0 },
        analysis: null,
      },
    });

    const { act, cleanup, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const user = userEvent.setup({ document });

    const page = render(
      <IPProvider>
        <TopicBoardPage />
      </IPProvider>,
    );

    const requestBody = await act(async () => {
      await user.click(page.getByRole("button", { name: "召开董事会" }));
      return waitWithTimeout(capturedRequest, 7000);
    });
    const evidence = requestBody.historicalData as Array<{ id?: string }> | undefined;
    const evidenceIds = evidence?.map(item => item.id).sort();

    assert.deepEqual(evidenceIds, [globalEvidence.id, currentIPEvidence.id].sort());
    assert.equal(evidenceIds?.includes(otherIPEvidence.id), false);
    assert.equal(evidenceIds?.includes(externalReview.id), false);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("离开页面后的迟到评审不得保存或污染下一次评审", async () => {
  const topicA = "评审A：已经离开的旧页面";
  const topicB = "评审B：当前页面的有效选题";
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  let restoreBrowser: (() => void) | null = installBrowserEnvironment();
  let cleanupPage: (() => void) | null = null;
  let resolveAStarted!: () => void;
  const aStarted = new Promise<void>(resolve => { resolveAStarted = resolve; });
  let resolveAResponse!: (response: Response) => void;
  const aResponse = new Promise<Response>(resolve => { resolveAResponse = resolve; });

  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    writable: true,
    value: ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => (
      originalSetTimeout(
        handler,
        [500, 600, 700, 800, 1000].includes(Number(timeout)) ? 0 : timeout,
        ...args,
      )
    )) as typeof setTimeout,
  });

  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
    globalThis.fetch = async input => {
      if (String(input) === "/api/topic-review") {
        resolveAStarted();
        return aResponse;
      }
      return new Response(JSON.stringify({ results: [], debug: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { IPProvider } = await import("./ip-context");
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const firstPage = render(<IPProvider><TopicBoardPage /></IPProvider>);
    fireEvent.change(firstPage.getByPlaceholderText(/例如：/), { target: { value: topicA } });
    await act(async () => {
      fireEvent.click(firstPage.getByRole("button", { name: "召开董事会" }));
      await aStarted;
    });

    cleanupPage();
    cleanupPage = null;
    restoreBrowser();
    restoreBrowser = installBrowserEnvironment();
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
    globalThis.fetch = async input => {
      if (String(input) === "/api/topic-review") {
        return new Response(JSON.stringify({ ...createValidTopicBoardResult(), topic: topicB }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ results: [], debug: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const secondPage = render(<IPProvider><TopicBoardPage /></IPProvider>);
    cleanupPage = cleanup;
    fireEvent.change(secondPage.getByPlaceholderText(/例如：/), { target: { value: topicB } });
    fireEvent.click(secondPage.getByRole("button", { name: "召开董事会" }));
    await secondPage.findByText("评估已保存到水木然的选题库。", {}, { timeout: 7000 });

    await act(async () => {
      resolveAResponse(new Response(JSON.stringify({ ...createValidTopicBoardResult(), topic: topicA }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
      await Promise.resolve();
      await Promise.resolve();
      await new Promise(resolve => originalSetTimeout(resolve, 0));
    });

    assert.deepEqual(
      getTopicAssets(SHUIMURAN.id).map(asset => asset.title),
      [topicB],
    );
    assert.equal(secondPage.queryByText(topicA), null);
    assert.equal(secondPage.getAllByRole("button", { name: /生成脚本/ }).length, 1);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "setTimeout", {
      configurable: true,
      writable: true,
      value: originalSetTimeout,
    });
    restoreBrowser?.();
  }
});

test("评审A未结束时直接发起评审B，A的迟到结果不得保存或污染B", async () => {
  const topicA = "评审A：尚未结束的旧选题";
  const topicB = "评审B：用户重新发起的新选题";
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const restoreBrowser = installBrowserEnvironment();
  let cleanupPage: (() => void) | undefined;
  let reviewRequestCount = 0;
  let resolveAStarted!: () => void;
  const aStarted = new Promise<void>(resolve => { resolveAStarted = resolve; });
  let resolveAResponse!: (response: Response) => void;
  const aResponse = new Promise<Response>(resolve => { resolveAResponse = resolve; });

  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    writable: true,
    value: ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => (
      originalSetTimeout(
        handler,
        [500, 600, 700, 800, 1000].includes(Number(timeout)) ? 0 : timeout,
        ...args,
      )
    )) as typeof setTimeout,
  });

  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
    globalThis.fetch = async input => {
      if (String(input) === "/api/topic-review") {
        reviewRequestCount += 1;
        if (reviewRequestCount === 1) {
          resolveAStarted();
          return aResponse;
        }
        return new Response(JSON.stringify({ ...createValidTopicBoardResult(), topic: topicB }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ results: [], debug: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { IPProvider } = await import("./ip-context");
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const page = render(<IPProvider><TopicBoardPage /></IPProvider>);
    fireEvent.change(page.getByPlaceholderText(/例如：/), { target: { value: topicA } });
    await act(async () => {
      fireEvent.click(page.getByRole("button", { name: "召开董事会" }));
      await aStarted;
    });

    fireEvent.change(page.getByPlaceholderText(/例如：/), { target: { value: topicB } });
    const restartButton = page.getByRole("button", { name: "重新发起评审" }) as HTMLButtonElement;
    assert.equal(restartButton.disabled, false);
    fireEvent.click(restartButton);
    await page.findByText("评估已保存到水木然的选题库。", {}, { timeout: 7000 });

    await act(async () => {
      resolveAResponse(new Response(JSON.stringify({ ...createValidTopicBoardResult(), topic: topicA }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
      await Promise.resolve();
      await new Promise(resolve => originalSetTimeout(resolve, 0));
    });

    assert.deepEqual(
      getTopicAssets(SHUIMURAN.id).map(asset => asset.title),
      [topicB],
    );
    assert.equal(page.queryByText(topicA), null);
    assert.equal(page.getAllByRole("button", { name: /生成脚本/ }).length, 1);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "setTimeout", {
      configurable: true,
      writable: true,
      value: originalSetTimeout,
    });
    restoreBrowser();
  }
});

test("旧评审进行中重新发起的新评审读取知识库失败时结束旧加载并显示真实失败", async () => {
  const topicA = "评审A：尚未结束的旧选题";
  const topicB = "评审B：读取知识库失败的新选题";
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const restoreBrowser = installBrowserEnvironment();
  let cleanupPage: (() => void) | undefined;
  let resolveAStarted!: () => void;
  const aStarted = new Promise<void>(resolve => { resolveAStarted = resolve; });
  let resolveAResponse!: (response: Response) => void;
  const aResponse = new Promise<Response>(resolve => { resolveAResponse = resolve; });

  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    writable: true,
    value: ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => (
      originalSetTimeout(
        handler,
        [500, 600, 700, 800, 1000].includes(Number(timeout)) ? 0 : timeout,
        ...args,
      )
    )) as typeof setTimeout,
  });

  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
    globalThis.fetch = async input => {
      if (String(input) === "/api/topic-review") {
        resolveAStarted();
        return aResponse;
      }
      return new Response(JSON.stringify({ results: [], debug: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { IPProvider } = await import("./ip-context");
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const page = render(<IPProvider><TopicBoardPage /></IPProvider>);
    fireEvent.change(page.getByPlaceholderText(/例如：/), { target: { value: topicA } });
    await act(async () => {
      fireEvent.click(page.getByRole("button", { name: "召开董事会" }));
      await aStarted;
    });

    localStorage.setItem("ipwr:knowledgeEntries", "{损坏的知识库数据");
    fireEvent.change(page.getByPlaceholderText(/例如：/), { target: { value: topicB } });
    fireEvent.click(page.getByRole("button", { name: "重新发起评审" }));

    assert.ok(await page.findByText("认知底座加载异常，请先重新加载。"));
    assert.ok(page.getByRole("button", { name: "召开董事会" }));
    assert.equal(page.queryByRole("button", { name: "重新发起评审" }), null);
    assert.equal(page.queryByText(/阶段 \d+ \/ 7/), null);

    await act(async () => {
      resolveAResponse(new Response(JSON.stringify({ ...createValidTopicBoardResult(), topic: topicA }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
      await Promise.resolve();
      await new Promise(resolve => originalSetTimeout(resolve, 0));
    });

    assert.equal(page.queryByText(topicA), null);
    assert.equal(getTopicAssets(SHUIMURAN.id).length, 0);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "setTimeout", {
      configurable: true,
      writable: true,
      value: originalSetTimeout,
    });
    restoreBrowser();
  }
});

test("切换IP后旧评审的知识、进度和错误不得写回当前页面", async () => {
  const topicA = "普通人如何判断一个机会是否适合自己";
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const restoreBrowser = installBrowserEnvironment();
  let cleanupPage: (() => void) | undefined;
  let releaseReviewResponse!: () => void;
  const reviewResponseGate = new Promise<void>(resolve => { releaseReviewResponse = resolve; });
  let resolveReviewStarted!: () => void;
  const reviewStarted = new Promise<void>(resolve => { resolveReviewStarted = resolve; });

  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    writable: true,
    value: ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => (
      originalSetTimeout(
        handler,
        [500, 600, 700, 800].includes(Number(timeout)) ? 0 : timeout,
        ...args,
      )
    )) as typeof setTimeout,
  });

  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN, SHIKONG]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
    const waterKnowledge = addBoardKnowledge({ idLabel: "水木然", ipId: SHUIMURAN.id });
    globalThis.fetch = async input => {
      if (String(input) === "/api/topic-review") {
        resolveReviewStarted();
        await reviewResponseGate;
        return new Response(JSON.stringify({ error: "旧IP评审失败，不应显示在当前页面" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ results: [], debug: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { IPProvider, useIP } = await import("./ip-context");
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    function SwitchToShikong() {
      const { switchIP } = useIP();
      return <button type="button" onClick={() => switchIP(SHIKONG.id)}>切换到设计师石空</button>;
    }
    const page = render(
      <IPProvider>
        <SwitchToShikong />
        <TopicBoardPage />
      </IPProvider>,
    );
    await page.findByText(/评估背景：当前操盘IP为水木然/);
    fireEvent.change(page.getByPlaceholderText(/例如：/), { target: { value: topicA } });
    fireEvent.click(page.getByRole("button", { name: "召开董事会" }));
    fireEvent.click(page.getByRole("button", { name: "切换到设计师石空" }));
    await act(async () => {
      await waitWithTimeout(reviewStarted, 3000);
    });

    await act(async () => {
      releaseReviewResponse();
      await reviewResponseGate;
      await Promise.resolve();
      await Promise.resolve();
      await new Promise(resolve => originalSetTimeout(resolve, 50));
    });

    assert.ok(page.getByText(/评估背景：当前操盘IP为设计师石空/));
    assert.equal(Boolean(page.queryByText(new RegExp(waterKnowledge.title))), false);
    assert.equal(Boolean(page.queryByText("旧IP评审失败，不应显示在当前页面")), false);
    assert.equal(Boolean(page.queryByText(/阶段 \d+ \/ 7/)), false);
    assert.equal(getTopicAssets(SHUIMURAN.id).length, 0);
    assert.equal(getTopicAssets(SHIKONG.id).length, 0);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "setTimeout", {
      configurable: true,
      writable: true,
      value: originalSetTimeout,
    });
    restoreBrowser();
  }
});

async function renderBoundaryAuditScenario(report: {
  coverage: "FULL" | "PARTIAL" | "NONE";
  stance: "ALIGNED" | "CONFLICTING" | "UNDETERMINED";
  explanation: string;
  matchedNodeIds: string[];
  conflictingNodeIds: string[];
  supportedParts: string[];
  missingElements: Array<"CLAIM" | "REASONING" | "CASE" | "DATA" | "DETAIL">;
}, boundaryFetcher?: (init?: RequestInit) => Promise<Response>, interviewFetcher?: (init?: RequestInit) => Promise<Response>, interviewCompletionFetchers?: {
  extract?: (init?: RequestInit) => Promise<Response>;
  confirm?: (init?: RequestInit) => Promise<Response>;
  verify?: (init?: RequestInit) => Promise<Response>;
}, options?: {
  ips?: IPProfile[];
  withLayout?: boolean;
}) {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;

  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify(options?.ips ?? [SHUIMURAN]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
    const sourceId = "boundary-source-v2";
    const rawContent = "老师明确说：持续输出不等于日更，输出质量来自问题深化。";
    const extracted = buildIPSourceAnalysisV2({
      sourceId,
      sourceContent: rawContent,
      analyzedAt: "2026-08-26T10:00:00.000Z",
      createId: () => "00000000-0000-4000-8000-000000000201",
      candidate: {
        nodes: [{
          nodeRef: "N1",
          question: { content: "持续输出是否等于日更？", derivation: "explicit", anchors: [{ quote: rawContent }] },
          claim: { content: "持续输出不等于日更。", anchors: [{ quote: "持续输出不等于日更" }] },
          reasoning: {
            status: "complete",
            steps: [{ order: 1, content: "输出质量来自问题深化。", anchors: [{ quote: "输出质量来自问题深化" }] }],
          },
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
    const confirmedNodeId = analysis.nodes[0]!.id;
    const responseReport = {
      ...report,
      matchedNodeIds: report.matchedNodeIds.map(() => confirmedNodeId),
      conflictingNodeIds: report.conflictingNodeIds.map(() => confirmedNodeId),
    };
    localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([{
      id: sourceId,
      category: "IP原始内容",
      title: "持续输出直播片段",
      rawContent,
      sourceKind: "直播逐字稿",
      sourceName: "持续输出直播.txt",
      sourceAnalysis: analysis,
      sourceFinalProof: "final-proof-for-page-test",
      sourceLegacyProof: null,
      tags: ["持续输出"],
      keywords: ["日更"],
      ipId: SHUIMURAN.id,
      sourceTier: "高",
      sourceTierReason: "测试中的已确认原始内容",
      contentDirection: ["个人成长"],
      sourcePlatform: "直播逐字稿",
      sourceUrl: "",
      note: "",
      createdAt: "2026-08-26T10:00:00.000Z",
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

    globalThis.fetch = async (input, init) => {
      if (String(input) === "/api/topic-review") {
        return new Response(JSON.stringify(createValidTopicBoardResult()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(input) === "/api/ip-boundary/check") {
        if (boundaryFetcher) return boundaryFetcher(init);
        return new Response(JSON.stringify({
          report: responseReport,
          evidenceNodes: [
            ...responseReport.matchedNodeIds.map(nodeId => ({ nodeId, relation: "matched" as const })),
            ...responseReport.conflictingNodeIds.map(nodeId => ({ nodeId, relation: "conflicting" as const })),
          ].map(reference => ({
            ...reference,
            verificationStatus: "human_confirmed",
            question: "持续输出是否等于日更？",
            claim: "持续输出不等于日更。",
            reasoningSteps: ["输出质量来自问题深化，而不是机械增加频次。"],
          })),
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(input) === "/api/ip-boundary/interview/questions" && interviewFetcher) {
        return interviewFetcher(init);
      }
      if (String(input) === "/api/ip-boundary/interview/extract" && interviewCompletionFetchers?.extract) {
        return interviewCompletionFetchers.extract(init);
      }
      if (String(input) === "/api/ip-boundary/interview/confirm" && interviewCompletionFetchers?.confirm) {
        return interviewCompletionFetchers.confirm(init);
      }
      if (String(input) === "/api/ip-source-analysis/verify" && interviewCompletionFetchers?.verify) {
        return interviewCompletionFetchers.verify(init);
      }
      return new Response(JSON.stringify({ results: [], debug: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const { cleanup, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const AppLayout = (await import("../components/layout/AppLayout")).default;
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const user = userEvent.setup({ document });
    const content = <TopicBoardPage />;
    const page = render(
      <IPProvider>
        {options?.withLayout ? <AppLayout>{content}</AppLayout> : content}
      </IPProvider>,
    );

    await user.click(page.getByRole("button", { name: "召开董事会" }));
    await page.findByText("评估已保存到水木然的选题库。", {}, { timeout: 7000 });
    return { page, user, restore: () => {
      cleanupPage?.();
      globalThis.fetch = originalFetch;
      restoreBrowser();
    } };
  } catch (error) {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
    throw error;
  }
}

test("长期确认访谈认知后持久保存并自动重审解锁当前选题", async () => {
  const answer = "我认为停止继续输入，是为了消化已有知识，因为知识淤积会让行动停滞。";
  const sourceId = "interview-source-long-term";
  const extracted = buildIPSourceAnalysisV2({
    sourceId,
    sourceContent: answer,
    analyzedAt: "2026-08-26T14:00:00.000Z",
    createId: () => "00000000-0000-4000-8000-000000000301",
    candidate: {
      nodes: [{
        nodeRef: "N1",
        question: { content: "为什么要停止继续输入？", derivation: "inferred", anchors: [{ quote: answer }] },
        claim: { content: "停止继续输入，是为了消化已有知识。", anchors: [{ quote: "停止继续输入，是为了消化已有知识" }] },
        reasoning: {
          status: "complete",
          steps: [{ order: 1, content: "知识淤积会让行动停滞。", anchors: [{ quote: "知识淤积会让行动停滞" }] }],
        },
        evidence: [],
        concepts: [],
      }],
      aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
    },
  });
  const reviewed = {
    ...extracted,
    nonce: extracted.nonce + 1,
    nodes: extracted.nodes.map(node => ({ ...node, reviewStatus: "human_confirmed" as const })),
  };
  let boundaryCalls = 0;
  let interviewContext: { topicId: string; interviewId: string } | null = null;
  const scenario = await renderBoundaryAuditScenario({
    coverage: "NONE",
    stance: "UNDETERMINED",
    explanation: "当前认知库没有涉及该主题。",
    matchedNodeIds: [],
    conflictingNodeIds: [],
    supportedParts: [],
    missingElements: ["CLAIM"],
  }, async init => {
    boundaryCalls += 1;
    const requestBody = JSON.parse(String(init?.body)) as {
      sources: Array<{ analysis: { nodes: Array<{ id: string }> } }>;
    };
    const nodeId = requestBody.sources[0]!.analysis.nodes[0]!.id;
    const unlocked = boundaryCalls > 1;
    return new Response(JSON.stringify({
      report: unlocked ? {
        coverage: "FULL",
        stance: "ALIGNED",
        explanation: "新确认的访谈认知已完整支持该选题。",
        matchedNodeIds: [nodeId],
        conflictingNodeIds: [],
        supportedParts: ["停止输入与知识消化"],
        missingElements: [],
      } : {
        coverage: "NONE",
        stance: "UNDETERMINED",
        explanation: "当前认知库没有涉及该主题。",
        matchedNodeIds: [],
        conflictingNodeIds: [],
        supportedParts: [],
        missingElements: ["CLAIM"],
      },
      evidenceNodes: unlocked ? [{
        nodeId,
        relation: "matched",
        verificationStatus: "human_confirmed",
        question: "为什么要停止继续输入？",
        claim: "停止继续输入，是为了消化已有知识。",
        reasoningSteps: ["知识淤积会让行动停滞。"],
      }] : [],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }, async init => {
    const body = JSON.parse(String(init?.body)) as { topicId: string; interviewId: string };
    interviewContext = { topicId: body.topicId, interviewId: body.interviewId };
    return new Response(JSON.stringify({
      activeIPId: SHUIMURAN.id,
      topicId: body.topicId,
      interviewId: body.interviewId,
      questions: [{
        id: "question-long-term",
        missingElement: "CLAIM",
        content: "关于这个话题，您的核心主张和理由是什么？",
        basedOnNodeIds: [],
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }, {
    extract: async () => new Response(JSON.stringify({
      source: {
        id: sourceId,
        ipId: SHUIMURAN.id,
        topicId: interviewContext?.topicId,
        interviewId: interviewContext?.interviewId,
        rawInteraction: [{
          questionId: "question-long-term",
          question: "关于这个话题，您的核心主张和理由是什么？",
          answer,
        }],
        timestamp: extracted.analyzedAt,
      },
      analysis: extracted,
      analysisToken: "analysis-token-long-term",
      candidates: extracted.nodes.map(node => ({ sourceId, node })),
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
    confirm: async () => new Response(JSON.stringify({
      mode: "long_term",
      source: {
        id: sourceId,
        ipId: SHUIMURAN.id,
        topicId: interviewContext?.topicId,
        interviewId: interviewContext?.interviewId,
        rawInteraction: [{
          questionId: "question-long-term",
          question: "关于这个话题，您的核心主张和理由是什么？",
          answer,
        }],
        timestamp: reviewed.analyzedAt,
      },
      analysis: reviewed,
      finalProof: "final-proof-long-term",
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
    verify: async () => new Response(JSON.stringify({ verified: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  });

  try {
    await scenario.user.click(scenario.page.getByRole("button", { name: "开启认知访谈" }));
    const answerInput = await scenario.page.findByRole("textbox", { name: "访谈回答" });
    await scenario.user.type(answerInput, answer);
    await scenario.user.click(scenario.page.getByRole("button", { name: "提交回答并提取认知" }));
    await scenario.page.findByRole("textbox", { name: "候选观点" });
    await scenario.user.click(scenario.page.getByRole("button", { name: "长期入库并重新审计" }));

    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => assert.equal(boundaryCalls, 2));
    assert.equal(
      (scenario.page.getByRole("button", { name: /生成脚本/ }) as HTMLButtonElement).disabled,
      false,
    );
    assert.equal(
      getKnowledgeEntries("IP原始内容").some(entry => entry.id === sourceId),
      true,
      "长期出口必须保存为刷新后仍可读取的IP原始内容",
    );
  } finally {
    scenario.restore();
  }
});

test("仅本次使用的访谈认知只解锁当前选题且不会跟随到新选题", async () => {
  const answer = "我对这个选题的临时判断是先停止继续输入，因为知识淤积会让行动停滞。";
  const sourceId = "interview-source-temporary-topic-a";
  const extracted = buildIPSourceAnalysisV2({
    sourceId,
    sourceContent: answer,
    analyzedAt: "2026-08-26T15:00:00.000Z",
    createId: () => "00000000-0000-4000-8000-000000000302",
    candidate: {
      nodes: [{
        nodeRef: "N1",
        question: { content: "当前选题为什么需要停止继续输入？", derivation: "inferred", anchors: [{ quote: answer }] },
        claim: { content: "当前选题应该先停止继续输入。", anchors: [{ quote: "先停止继续输入" }] },
        reasoning: {
          status: "complete",
          steps: [{ order: 1, content: "知识淤积会让行动停滞。", anchors: [{ quote: "知识淤积会让行动停滞" }] }],
        },
        evidence: [],
        concepts: [],
      }],
      aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
    },
  });
  const temporaryAnalysis = {
    ...extracted,
    nonce: extracted.nonce + 1,
    nodes: extracted.nodes.map(node => ({ ...node, reviewStatus: "human_confirmed" as const })),
  };
  let topicAId = "";
  let topicAText = "";
  let interviewId = "";
  let boundaryCalls = 0;
  const scenario = await renderBoundaryAuditScenario({
    coverage: "NONE",
    stance: "UNDETERMINED",
    explanation: "当前认知库没有涉及该主题。",
    matchedNodeIds: [],
    conflictingNodeIds: [],
    supportedParts: [],
    missingElements: ["CLAIM"],
  }, async init => {
    boundaryCalls += 1;
    const body = JSON.parse(String(init?.body)) as {
      topic?: string;
      temporaryContext?: {
        topicId?: string;
        temporaryProof?: string;
        analysis?: { nodes?: Array<{ id?: string }> };
      };
    };
    if (!topicAText && body.topic) topicAText = body.topic;
    const temporaryApplies = body.temporaryContext?.topicId === topicAId
      && body.temporaryContext.temporaryProof === "temporary-proof-topic-a"
      && body.topic === topicAText;
    return new Response(JSON.stringify({
      report: temporaryApplies ? {
        coverage: "FULL",
        stance: "ALIGNED",
        explanation: "当前会话的临时访谈认知支持该选题。",
        matchedNodeIds: [temporaryAnalysis.nodes[0]!.id],
        conflictingNodeIds: [],
        supportedParts: ["停止输入与知识消化"],
        missingElements: [],
      } : {
        coverage: "NONE",
        stance: "UNDETERMINED",
        explanation: "当前选题没有可用的长期或临时认知。",
        matchedNodeIds: [],
        conflictingNodeIds: [],
        supportedParts: [],
        missingElements: ["CLAIM"],
      },
      evidenceNodes: temporaryApplies ? [{
        nodeId: temporaryAnalysis.nodes[0]!.id,
        relation: "matched",
        verificationStatus: "human_confirmed",
        question: "当前选题为什么需要停止继续输入？",
        claim: "当前选题应该先停止继续输入。",
        reasoningSteps: ["知识淤积会让行动停滞。"],
      }] : [],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }, async init => {
    const body = JSON.parse(String(init?.body)) as { topicId: string; interviewId: string };
    topicAId = body.topicId;
    interviewId = body.interviewId;
    return new Response(JSON.stringify({
      activeIPId: SHUIMURAN.id,
      topicId: body.topicId,
      interviewId: body.interviewId,
      questions: [{
        id: "question-temporary",
        missingElement: "CLAIM",
        content: "关于当前选题，您仅用于本次生成的判断是什么？",
        basedOnNodeIds: [],
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }, {
    extract: async () => new Response(JSON.stringify({
      source: {
        id: sourceId,
        ipId: SHUIMURAN.id,
        topicId: topicAId,
        interviewId,
        rawInteraction: [{
          questionId: "question-temporary",
          question: "关于当前选题，您仅用于本次生成的判断是什么？",
          answer,
        }],
        timestamp: extracted.analyzedAt,
      },
      analysis: extracted,
      analysisToken: "analysis-token-temporary-topic-a",
      candidates: extracted.nodes.map(node => ({ sourceId, node })),
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
    confirm: async () => new Response(JSON.stringify({
      mode: "temporary",
      activeIPId: SHUIMURAN.id,
      topicId: topicAId,
      interviewId,
      sourceId,
      rawContent: answer,
      analysis: temporaryAnalysis,
      temporaryProof: "temporary-proof-topic-a",
      expiresAt: Date.now() + 30 * 60 * 1000,
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  }, { ips: [SHUIMURAN, SHIKONG], withLayout: true });

  try {
    await scenario.user.click(scenario.page.getByRole("button", { name: "开启认知访谈" }));
    const answerInput = await scenario.page.findByRole("textbox", { name: "访谈回答" });
    await scenario.user.type(answerInput, answer);
    await scenario.user.click(scenario.page.getByRole("button", { name: "提交回答并提取认知" }));
    await scenario.page.findByRole("textbox", { name: "候选观点" });
    await scenario.user.click(scenario.page.getByRole("button", { name: "仅本次使用并重新审计" }));

    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => assert.equal(boundaryCalls, 2));
    assert.equal(
      (scenario.page.getByRole("button", { name: /生成脚本/ }) as HTMLButtonElement).disabled,
      false,
      "临时凭证应只解锁当前选题",
    );
    assert.equal(
      getKnowledgeEntries("IP原始内容").some(entry => entry.id === sourceId),
      false,
      "临时出口不得写入长期认知库",
    );

    const currentIPButton = (await scenario.page.findByText("当前操盘IP")).closest("button");
    assert.ok(currentIPButton);
    await scenario.user.click(currentIPButton);
    await scenario.user.click(scenario.page.getByRole("button", { name: /设计师石空/ }));
    await scenario.page.findByText(/评估背景：当前操盘IP为设计师石空/);
    await scenario.user.click(currentIPButton);
    await scenario.user.click(scenario.page.getByRole("button", { name: /水木然/ }));
    await scenario.page.findByText(/评估背景：当前操盘IP为水木然/);
    await scenario.user.click(scenario.page.getByRole("button", {
      name: "查看选题“普通人如何判断一个机会是否适合自己？”完整评估",
    }));
    await waitFor(() => assert.equal(boundaryCalls, 3));
    assert.equal(
      (scenario.page.getByRole("button", { name: /生成脚本/ }) as HTMLButtonElement).disabled,
      true,
      "切换IP后再切回也不得恢复旧的临时凭证",
    );

    const topicInput = scenario.page.getByPlaceholderText(/例如：/);
    await scenario.user.clear(topicInput);
    await scenario.user.type(topicInput, "相似但不同的第二个选题");
    await scenario.user.click(scenario.page.getByRole("button", { name: "召开董事会" }));
    await waitFor(() => assert.equal(boundaryCalls, 4), { timeout: 7000 });
    assert.ok(scenario.page.getByText("认知真空"));
    assert.equal(
      scenario.page.getAllByRole("button", { name: /生成脚本/ })
        .some(button => (button as HTMLButtonElement).disabled),
      true,
      "切换选题后当前审计对象不得继承上一选题的临时凭证",
    );
  } finally {
    scenario.restore();
  }
});

test("认知真空可开启访谈且切换选题会重置当前会话", async () => {
  let resolveQuestions: ((response: Response) => void) | undefined;
  const questionRequest: {
    current: { topicId: string; interviewId: string } | null;
  } = { current: null };
  const questionResponse = new Promise<Response>(resolve => {
    resolveQuestions = resolve;
  });
  const scenario = await renderBoundaryAuditScenario({
    coverage: "NONE",
    stance: "UNDETERMINED",
    explanation: "当前认知库没有涉及该主题。",
    matchedNodeIds: [],
    conflictingNodeIds: [],
    supportedParts: [],
    missingElements: ["CLAIM"],
  }, undefined, async init => {
    const requestBody: unknown = JSON.parse(String(init?.body));
    assert.ok(typeof requestBody === "object" && requestBody !== null);
    assert.ok("topicId" in requestBody && typeof requestBody.topicId === "string");
    assert.ok("interviewId" in requestBody && typeof requestBody.interviewId === "string");
    questionRequest.current = {
      topicId: requestBody.topicId,
      interviewId: requestBody.interviewId,
    };
    return questionResponse;
  });

  try {
    const interviewButton = scenario.page.getByRole("button", { name: "开启认知访谈" });
    await scenario.user.click(interviewButton);
    assert.ok(await scenario.page.findByText("正在生成中立访谈问题…"));

    resolveQuestions?.(new Response(JSON.stringify({
      activeIPId: SHUIMURAN.id,
      topicId: questionRequest.current?.topicId,
      interviewId: questionRequest.current?.interviewId,
      questions: [{
        id: "question-1",
        missingElement: "CLAIM",
        content: "关于这个话题，您的核心主张是什么？",
        basedOnNodeIds: [],
      }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const answer = await scenario.page.findByRole("textbox", { name: "访谈回答" });
    await scenario.user.type(answer, "这是我对当前选题的真实判断。 ");
    const topicInput = scenario.page.getByPlaceholderText(/例如：/);
    await scenario.user.clear(topicInput);
    await scenario.user.type(topicInput, "这是一个新的页面内选题");

    assert.equal(scenario.page.queryByRole("complementary", { name: "认知访谈" }), null);
  } finally {
    scenario.restore();
  }
});

test("立场冲突时页面展示认知警告并禁止进入脚本生成", async () => {
  const scenario = await renderBoundaryAuditScenario({
    coverage: "PARTIAL",
    stance: "CONFLICTING",
    explanation: "该选题把日更当作增长手段，与已确认观点相反。",
    matchedNodeIds: [],
    conflictingNodeIds: ["node-conflict"],
    supportedParts: ["持续输出"],
    missingElements: ["REASONING"],
  });

  try {
    assert.ok(scenario.page.getByText("立场冲突"));
    assert.ok(scenario.page.getByText("持续输出不等于日更。"));
    assert.equal(
      (scenario.page.getByRole("button", { name: /生成脚本/ }) as HTMLButtonElement).disabled,
      true,
    );
  } finally {
    scenario.restore();
  }
});

test("认知仅部分覆盖时进入脚本生成前必须二次确认", async () => {
  const scenario = await renderBoundaryAuditScenario({
    coverage: "PARTIAL",
    stance: "ALIGNED",
    explanation: "已有观点支持方向，但缺少具体案例。",
    matchedNodeIds: ["node-partial"],
    conflictingNodeIds: [],
    supportedParts: ["精准减负"],
    missingElements: ["CASE"],
  });

  try {
    await scenario.user.click(scenario.page.getByRole("button", { name: /生成脚本/ }));
    assert.ok(await scenario.page.findByRole("dialog", { name: "认知覆盖不完整" }));
    assert.ok(scenario.page.getByText(/AI可能会补充尚未被IP确认的细节/));
  } finally {
    scenario.restore();
  }
});

test("认知真空时禁止生成并提供真实可用的资料导入入口", async () => {
  const scenario = await renderBoundaryAuditScenario({
    coverage: "NONE",
    stance: "UNDETERMINED",
    explanation: "当前认知库没有涉及该主题。",
    matchedNodeIds: [],
    conflictingNodeIds: [],
    supportedParts: [],
    missingElements: ["CLAIM"],
  });

  try {
    assert.ok(scenario.page.getByText("认知真空"));
    const importLink = scenario.page.getByRole("link", { name: "导入资料" });
    assert.equal(importLink.getAttribute("href"), `/knowledge-intake/original?ipId=${encodeURIComponent(SHUIMURAN.id)}`);
    assert.equal(
      (scenario.page.getByRole("button", { name: /生成脚本/ }) as HTMLButtonElement).disabled,
      true,
    );
  } finally {
    scenario.restore();
  }
});

test("董事会读取到损坏认知时停止加载并提供重新加载入口", async () => {
  const restoreBrowser = installBrowserEnvironment();
  try {
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
    localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([{
      id: "damaged-topic-board-cognition",
      category: "IP原始内容",
      title: "损坏认知",
      rawContent: "原始内容",
      sourceAnalysis: { parserVersion: 2, sourceId: "wrong-source" },
      ipId: SHUIMURAN.id,
      createdAt: "2026-08-26T12:00:00.000Z",
    }]));

    const { cleanup, render, waitFor } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const page = render(<IPProvider><TopicBoardPage /></IPProvider>);

    assert.ok(await page.findByText("认知底座加载异常"));
    const retryButton = page.getByRole("button", { name: "重新加载" });
    assert.equal(page.queryByText("检索中…"), null);
    assert.notEqual(localStorage.getItem("ipwr:knowledgeEntries"), null, "容错入口不得删除原数据");
    localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([]));
    await userEvent.setup({ document }).click(retryButton);
    await waitFor(() => assert.equal(page.queryByText("认知底座加载异常"), null));
    cleanup();
  } finally {
    restoreBrowser();
  }
});

test("边界审计超过15秒后保持生成锁定并允许重新审计", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  let boundaryCalls = 0;
  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    writable: true,
    value: ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => (
      originalSetTimeout(handler, timeout === 15_000 ? 0 : timeout, ...args)
    )) as typeof setTimeout,
  });

  let scenario: Awaited<ReturnType<typeof renderBoundaryAuditScenario>> | null = null;
  try {
    scenario = await renderBoundaryAuditScenario({
      coverage: "FULL",
      stance: "ALIGNED",
      explanation: "不会返回的模拟结果。",
      matchedNodeIds: ["node-timeout"],
      conflictingNodeIds: [],
      supportedParts: ["选题"],
      missingElements: [],
    }, async init => {
      boundaryCalls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });

    assert.ok(await scenario.page.findByText("审计响应超时"));
    assert.equal(
      (scenario.page.getByRole("button", { name: /生成脚本/ }) as HTMLButtonElement).disabled,
      true,
    );
    await scenario.user.click(scenario.page.getByRole("button", { name: "重新审计" }));
    await scenario.page.findByText("审计响应超时");
    assert.equal(boundaryCalls, 2);
  } finally {
    scenario?.restore();
    Object.defineProperty(globalThis, "setTimeout", { configurable: true, writable: true, value: originalSetTimeout });
  }
});
