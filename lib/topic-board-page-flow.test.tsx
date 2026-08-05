import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import type { IPProfile } from "./types";

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
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHIKONG, SHUIMURAN]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHIKONG.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));

    const { act, cleanup, render, screen } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const AppLayout = (await import("../components/layout/AppLayout")).default;
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const user = userEvent.setup({ document });

    render(
      <IPProvider>
        <AppLayout>
          <TopicBoardPage />
        </AppLayout>
      </IPProvider>,
    );

    const currentIPLabel = await screen.findByText("当前操盘IP");
    const currentIPButton = currentIPLabel.closest("button");
    assert.ok(currentIPButton);
    assert.match(currentIPButton.textContent ?? "", /设计师石空/);

    const topicInput = screen.getByRole("textbox") as HTMLTextAreaElement;
    assert.equal(topicInput.value, "普通人如何判断一个机会是否真的适合自己？");
    assert.ok(screen.getByRole("button", { name: "为什么同样的方法，有人有效，有人却没效果？" }));
    assert.ok(screen.getByRole("button", { name: "一个专业服务最容易被用户误解的地方是什么？" }));
    assert.ok(screen.getByRole("button", { name: "新手开始一件事时，最应该避开的误区是什么？" }));
    assert.match(
      (await screen.findByText(/评估背景：当前操盘IP为设计师石空/)).textContent ?? "",
      /将结合其受众、内容方向和表达风格进行判断/,
    );

    await user.click(currentIPButton);
    await user.click(screen.getByRole("button", { name: /水木然/ }));
    assert.match(currentIPButton.textContent ?? "", /水木然/);
    assert.match(
      (await screen.findByText(/评估背景：当前操盘IP为水木然/)).textContent ?? "",
      /将结合其受众、内容方向和表达风格进行判断/,
    );
    assert.equal(screen.queryByText(/演示背景：当前IP为设计师石空/), null);

    const topic = "普通人如何判断行业趋势";
    await user.clear(topicInput);
    await user.type(topicInput, topic);
    const requestBody = await act(async () => {
      await user.click(screen.getByRole("button", { name: "召开董事会" }));
      return waitWithTimeout(capturedRequest, 7000);
    });
    await screen.findByText("测试已截获请求");
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
