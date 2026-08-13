import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { createTopicBoardIPProfile } from "./topic-board-contract.fixture";

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

const ip = createTopicBoardIPProfile({ id: "ip-shuimuran", name: "水木然" });
const script = {
  id: "script-animal-past-life",
  ipId: ip.id,
  title: "你的动物相里，藏着你的前世今生",
  cover: "动物相暴露了什么？",
  content: "这是应该恢复的脚本正文",
  status: "草稿",
  scriptResult: {
    generationStatus: "complete",
    partialFailure: null,
    ipId: ip.id,
    ipName: ip.name,
    topic: "你的动物相里，藏着你的前世今生",
    platform: "视频号",
    formatCategory: "medium",
    formatLabel: "中视频",
    durationSeconds: 300,
    durationLabel: "5分钟",
    goal: "建立信任",
    videoType: "口播",
    outputLabels: {
      cover: "封面文案",
      outline: "口播逐字稿",
      shooting: "拍摄画面建议",
      comment: "评论区引导",
    },
    titles: [{
      title: "你的动物相里，藏着你的前世今生",
      formula: "悬念",
      platform: "视频号",
      whyFitsIP: "符合IP定位",
    }],
    coverCopy: ["动物相暴露了什么？"],
    outline: [{
      label: "开头",
      timeRange: "0-30秒",
      content: "这是应该恢复的脚本正文",
      subPoints: [],
    }],
    commentGuidance: {
      interactionPrompt: "你是什么动物相？",
      keywordReplies: [],
      dmGuidance: "无",
      materialPackGuidance: "无",
    },
    ipStyleExplanation: "使用水木然的表达风格",
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
      calledAt: "2026-08-08T14:51:28.237Z",
      model: "deepseek-v4-flash",
      ipUsed: ip.name,
      mockHit: false,
    },
  },
  createdAt: "2026-08-08T14:51:57.939Z",
};

let restoreBrowser: (() => void) | undefined;

before(() => {
  restoreBrowser = installBrowserEnvironment();
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  localStorage.setItem("ipwr:scriptAssets", JSON.stringify([script]));
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

test("工作台查看待完成脚本时携带对应scriptId", async () => {
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const Home = (await import("../app/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<Home />);

  await user.click(await view.findByRole("button", { name: /待完成脚本/ }));
  assert.ok(view.getByText(script.title));

  const viewLink = view.getByRole("link", { name: "查看" }) as HTMLAnchorElement;
  assert.equal(
    viewLink.getAttribute("href"),
    `/script-factory?scriptId=${encodeURIComponent(script.id)}`,
  );
});

test("工作台脚本记录展开历史后可查看指定脚本", async () => {
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const Home = (await import("../app/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<Home />);

  await user.click(await view.findByRole("button", { name: /脚本记录/ }));
  assert.ok(view.getByText("脚本历史"));
  assert.ok(view.getByText(script.title));

  const historyLink = view.getByRole("link", { name: `查看脚本“${script.title}”` }) as HTMLAnchorElement;
  assert.equal(
    historyLink.getAttribute("href"),
    `/script-factory?scriptId=${encodeURIComponent(script.id)}`,
  );
});

test("脚本工厂通过scriptId恢复对应的完整草稿内容", async () => {
  window.history.replaceState({}, "", `/script-factory?scriptId=${encodeURIComponent(script.id)}`);
  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
  const view = render(
    <IPProvider>
      <ScriptFactoryPage />
    </IPProvider>,
  );

  const topicInput = await view.findByDisplayValue(script.scriptResult.topic) as HTMLTextAreaElement;
  assert.equal(topicInput.value, script.scriptResult.topic);
  assert.ok(view.getByText("这是应该恢复的脚本正文"));
  assert.ok(view.getByText("动物相暴露了什么？"));
});

test("脚本工厂兼容恢复没有生成状态字段的旧版完整草稿", async () => {
  const legacyResult = { ...script.scriptResult } as Record<string, unknown>;
  delete legacyResult.generationStatus;
  delete legacyResult.partialFailure;
  const legacyScript = { ...script, id: "script-legacy", scriptResult: legacyResult };
  localStorage.setItem("ipwr:scriptAssets", JSON.stringify([legacyScript]));
  window.history.replaceState({}, "", `/script-factory?scriptId=${legacyScript.id}`);

  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
  const view = render(
    <IPProvider>
      <ScriptFactoryPage />
    </IPProvider>,
  );

  assert.ok(await view.findByText("这是应该恢复的脚本正文"));
  assert.equal(view.queryByText(/保存的脚本数据不完整/), null);
});

test("目标脚本无法恢复时不展示同IP的另一条临时草稿", async () => {
  const damagedScript = { ...script, id: "script-damaged", scriptResult: {} };
  const stalePartialResult = {
    ...script.scriptResult,
    generationStatus: "partial",
    partialFailure: {
      stage: "storyboard",
      errorCode: "TEST_PARTIAL",
      message: "测试用临时草稿",
    },
    outline: [{
      label: "开头",
      timeRange: "0-30秒",
      content: "这是另一条临时草稿，不应显示",
      subPoints: [],
    }],
  };
  localStorage.setItem("ipwr:scriptAssets", JSON.stringify([damagedScript]));
  localStorage.setItem("flowpilot_script_factory_partial_drafts_v1", JSON.stringify({
    version: 1,
    draftsByIP: {
      [ip.id]: {
        version: 1,
        ipId: ip.id,
        topic: "另一条临时草稿",
        savedAt: "2026-08-08T15:00:00.000Z",
        failedStage: "storyboard",
        warning: "测试用临时草稿",
        generationSettings: {
          platform: "视频号",
          formatCategory: "medium",
          durationSeconds: 300,
          goal: "建立信任",
          videoType: "口播",
          needsStoryboard: true,
          needsShootingTips: true,
        },
        result: stalePartialResult,
      },
    },
  }));
  window.history.replaceState({}, "", `/script-factory?scriptId=${damagedScript.id}`);

  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
  const view = render(
    <IPProvider>
      <ScriptFactoryPage />
    </IPProvider>,
  );

  assert.ok((await view.findAllByText(/保存的脚本数据不完整/)).length > 0);
  assert.equal(view.queryByText("这是另一条临时草稿，不应显示"), null);
  assert.equal(view.queryByDisplayValue("另一条临时草稿"), null);
});
