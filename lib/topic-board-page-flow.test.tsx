import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { addKnowledgeEntry, getKnowledgeEntries } from "./ip-store";
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

async function renderBoundaryAuditScenario(report: {
  coverage: "FULL" | "PARTIAL" | "NONE";
  stance: "ALIGNED" | "CONFLICTING" | "UNDETERMINED";
  explanation: string;
  matchedNodeIds: string[];
  conflictingNodeIds: string[];
  supportedParts: string[];
  missingElements: Array<"CLAIM" | "REASONING" | "CASE" | "DATA" | "DETAIL">;
}, boundaryFetcher?: (init?: RequestInit) => Promise<Response>, interviewFetcher?: (init?: RequestInit) => Promise<Response>) {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;

  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
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
      return new Response(JSON.stringify({ results: [], debug: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const { cleanup, render } = await import("@testing-library/react");
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
