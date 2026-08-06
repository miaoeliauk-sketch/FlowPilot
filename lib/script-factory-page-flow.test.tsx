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

test("脚本工厂不把装修演示内容作为真实初始值", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));

  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
  const user = userEvent.setup({ document });

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
  assert.doesNotMatch(view.container.textContent ?? "", /设计师石空|比例关系|材质关系|灯光关系/);

  await user.click(view.getByRole("button", { name: /内容引擎（完整内容包）/ }));
  const engineTopic = view.getByPlaceholderText(topicPlaceholder) as HTMLInputElement;
  const audiencePlaceholder = "留空则使用当前IP的目标受众";
  const industryPlaceholder = "留空则使用当前IP的内容方向";
  const audienceInput = view.getByPlaceholderText(audiencePlaceholder) as HTMLInputElement;
  const industryInput = view.getByPlaceholderText(industryPlaceholder) as HTMLInputElement;

  assert.equal(engineTopic.placeholder, topicPlaceholder);
  assert.equal(audienceInput.value, "");
  assert.equal(industryInput.value, "");
  assert.equal(audienceInput.placeholder, audiencePlaceholder);
  assert.equal(industryInput.placeholder, industryPlaceholder);
  assert.doesNotMatch(view.container.textContent ?? "", /准备装修的业主|室内设计与全案装修/);
});

test("经典模式使用当前水木然档案且不提交固定装修要求", async () => {
  const originalFetch = globalThis.fetch;
  let resolveRequest!: (body: Record<string, unknown>) => void;
  const capturedRequest = new Promise<Record<string, unknown>>(resolve => {
    resolveRequest = resolve;
  });

  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/script-factory") {
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

    const currentIPLabel = await view.findByText("当前操盘IP");
    assert.match(currentIPLabel.closest("button")?.textContent ?? "", /水木然/);

    const topicInput = view.container.querySelector("textarea") as HTMLTextAreaElement | null;
    assert.ok(topicInput);
    const topic = "普通人如何判断下一轮行业变化";
    await user.type(topicInput, topic);

    await user.click(view.getByRole("button", { name: "生成完整内容" }));
    const [requestBody] = await Promise.all([
      waitWithTimeout(capturedRequest, 7000),
      view.findByText(/测试已截获请求/),
    ]);
    const sentIP = requestBody.ipProfile as IPProfile | undefined;

    assert.equal(requestBody.topic, topic);
    assert.deepEqual(sentIP, SHUIMURAN);
    assert.equal(Object.hasOwn(requestBody, "generationRequirement"), false);
    assert.doesNotMatch(
      JSON.stringify(requestBody),
      /设计师石空|准备装修的业主|室内设计与全案装修|比例关系|材质关系|灯光关系/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
