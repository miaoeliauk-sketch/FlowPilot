import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import type { IPProfile } from "./types";

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
  representativeViewpoints: ["趋势影响个体选择"],
  tone: "理性克制",
  commonOpenings: ["很多人没意识到"],
  commonClosings: ["这才是关键"],
  catchphrases: ["看懂趋势"],
  forbiddenExpressions: ["装修", "豪宅", "施工"],
  pacing: "层层递进",
  commonScenes: ["书房"],
  commonShotTypes: ["正面口播"],
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
    url: "http://localhost/script-factory",
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

let restoreBrowser: (() => void) | undefined;

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

after(() => {
  restoreBrowser?.();
});

test("脚本工厂默认恢复固定脚本生成，并保留IP专属生成入口", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));

  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;

  const view = render(
    <IPProvider>
      <ScriptFactoryPage />
    </IPProvider>,
  );

  const topicPlaceholder = "例如：一个正在发生的变化，普通人应该如何判断？";
  const classicTopic = view.getByPlaceholderText(topicPlaceholder) as HTMLTextAreaElement;
  assert.equal(classicTopic.value, "");
  assert.equal(classicTopic.placeholder, topicPlaceholder);
  assert.equal(view.queryByText(/本次演示生成要求/), null);
  assert.equal(view.queryByText("IP差异化验收测试"), null);
  assert.equal(view.queryByText("母稿驱动"), null);
  assert.equal(view.queryByText(/内容引擎（完整内容包）/), null);
  assert.ok(view.getByRole("button", { name: "固定脚本生成" }));
  assert.ok(view.getByRole("button", { name: "IP专属生成" }));
  assert.ok(view.getByRole("button", { name: "生成完整内容" }));
  assert.equal(view.queryByRole("button", { name: "检查观点覆盖度" }), null);
  assert.doesNotMatch(view.container.textContent ?? "", /设计师石空|比例关系|材质关系|灯光关系/);
});

test("覆盖度为NONE时不允许直接生成", async () => {
  const originalFetch = globalThis.fetch;
  let generationCalled = false;

  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/script-factory/coverage") {
      return new Response(JSON.stringify({ assessment: {
        coverage: "NONE",
        reason: "当前IP没有表达过这个观点。",
        coveredDimensions: [],
        missingDimensions: ["核心判断", "推理过程"],
        sourceReferences: [],
        caseNeed: "NOT_ASSESSED",
        caseReason: "先补充老师原始内容。",
      } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input) === "/api/script-factory") {
      generationCalled = true;
    }
    return new Response(JSON.stringify({ results: [], debug: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));

    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const AppLayout = (await import("../components/layout/AppLayout")).default;
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });

    const view = render(
      <IPProvider>
        <AppLayout>
          <ScriptFactoryPage />
        </AppLayout>
      </IPProvider>,
    );

    await user.click(view.getByRole("button", { name: "IP专属生成" }));

    const topicInput = view.container.querySelector("textarea") as HTMLTextAreaElement | null;
    assert.ok(topicInput);
    const topic = "普通人如何判断下一轮行业变化";
    await user.type(topicInput, topic);

    await user.click(view.getByRole("button", { name: "检查观点覆盖度" }));
    assert.ok(await view.findByText("没有覆盖"));
    assert.ok(view.getByRole("link", { name: "补充IP原始内容" }));
    assert.ok(view.getByRole("button", { name: "生成采访提纲" }));
    assert.equal(view.queryByRole("button", { name: "依据确认后生成脚本" }), null);
    assert.equal(generationCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("充分覆盖并确认依据后才显示脚本生成按钮", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/script-factory/coverage") {
      return new Response(JSON.stringify({ assessment: {
        coverage: "FULL",
        reason: "原始内容同时包含核心判断和推理。",
        coveredDimensions: ["核心判断", "推理过程"],
        missingDimensions: [],
        sourceReferences: [{
          sourceId: "source-1", sourceTitle: "课程复盘", itemId: "claim-1", kind: "claim",
          content: "持续输出不是更换话题。", originalExcerpt: "持续输出不是每天换一个新话题。", extractionStatus: "人工确认",
        }],
        caseNeed: "NOT_NEEDED",
        caseReason: "原文内部论证已经完整。",
      } }), { status: 200, headers: { "Content-Type": "application/json" } });
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

    await user.click(view.getByRole("button", { name: "IP专属生成" }));
    await user.type(view.getByPlaceholderText("例如：一个正在发生的变化，普通人应该如何判断？"), "为什么持续更新仍会被忘记？");
    await user.click(view.getByRole("button", { name: "检查观点覆盖度" }));
    assert.ok(await view.findByText("充分覆盖"));
    assert.equal(view.queryByRole("button", { name: "依据确认后生成脚本" }), null);
    await user.click(view.getByRole("button", { name: "确认观点依据与案例边界" }));
    assert.ok(view.getByRole("button", { name: "依据确认后生成脚本" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("重新打开IP专属脚本时恢复对应生成模式", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  localStorage.setItem("ipwr:scriptAssets", JSON.stringify([{
    id: "script-ip-mode",
    ipId: SHUIMURAN.id,
    title: "IP专属历史脚本",
    cover: "封面",
    content: "正文",
    status: "草稿",
    createdAt: "2026-08-13T00:00:00.000Z",
    scriptResult: {
      generationMode: "ip",
      generationStatus: "complete",
      partialFailure: null,
      ipId: SHUIMURAN.id,
      ipName: SHUIMURAN.name,
      topic: "IP专属历史脚本",
      platform: "抖音",
      formatCategory: "short",
      formatLabel: "短视频",
      durationSeconds: 60,
      durationLabel: "60秒",
      goal: "建立信任",
      videoType: "口播",
      outputLabels: { cover: "封面文案", outline: "口播逐字稿", shooting: "拍摄建议", comment: "互动引导" },
      titles: [{ title: "IP专属历史脚本", formula: "判断", platform: "抖音", whyFitsIP: "符合" }],
      coverCopy: ["封面"],
      outline: [{ label: "判断", timeRange: "0-60秒", content: "完整正文。" }],
      commentGuidance: { interactionPrompt: "", keywordReplies: [], dmGuidance: "", materialPackGuidance: "" },
      ipStyleExplanation: "",
      storyboard: [],
      shootingSuggestions: [],
      shotPrompts: [],
      editingRhythm: { subtitleHighlights: [], soundEffects: [], screenRecordingCuts: [], caseInserts: [], pauses: [] },
      apiMeta: { apiCalled: true, calledAt: "2026-08-13T00:00:00.000Z", model: "test", ipUsed: SHUIMURAN.name, mockHit: false },
    },
  }]));
  window.history.replaceState({}, "", "/script-factory?scriptId=script-ip-mode");

  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
  const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

  const modeButton = await view.findByRole("button", { name: "IP专属生成" });
  assert.equal(modeButton.getAttribute("aria-pressed"), "true");
  assert.equal(view.queryByRole("button", { name: "生成完整内容" }), null);
  window.history.replaceState({}, "", "/script-factory");
});
