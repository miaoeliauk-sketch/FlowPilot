import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import type { IPProfile } from "./types";

const ACTIVE_IP: IPProfile = {
  id: "ip-cover-owner",
  name: "封面测试IP",
  avatar: "封",
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
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
};

function createMissingImageIndexedDB() {
  return {
    open() {
      const openRequest: Record<string, any> = {};
      queueMicrotask(() => {
        openRequest.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => undefined,
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
        openRequest.onsuccess?.();
      });
      return openRequest;
    },
  };
}

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/knowledge-hub?scope=material",
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
    indexedDB: createMissingImageIndexedDB(),
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

before(() => {
  restoreBrowser = installBrowserEnvironment();
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ACTIVE_IP]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ACTIVE_IP.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
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

test("封面数据损坏时明确报错并禁止继续新增", async () => {
  const corrupted = "{broken-cover-data";
  localStorage.setItem("ipwr:coverRefs", corrupted);

  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const view = render(
    <IPProvider>
      <KnowledgeHubPage />
    </IPProvider>,
  );

  await view.findByRole("alert", { name: "封面参考库加载失败" });
  for (const button of view.getAllByRole("button", { name: /添加封面参考/ })) {
    assert.equal((button as HTMLButtonElement).disabled, true);
  }
  assert.equal(localStorage.getItem("ipwr:coverRefs"), corrupted);
});

function coverRecord(id: string, scope: "global" | "ip", ipId: string | null, title: string) {
  return {
    id,
    title,
    imageDataUrl: "data:image/png;base64,cover",
    platform: "视频号",
    contentType: "封面标题参考",
    coverType: "标准标题封面",
    visualTags: ["知识类"],
    textStyle: "清晰",
    layout: "居中",
    colorStyle: "",
    referenceReason: "测试参考",
    avoidReason: "",
    sourceUrl: "",
    scope,
    ipId,
    createdAt: "2026-08-11T10:00:00.000Z",
    updatedAt: "2026-08-11T10:00:00.000Z",
  };
}

test("封面页只展示全局和当前IP数据且只能删除自己的封面", async () => {
  localStorage.setItem("ipwr:coverRefs", JSON.stringify([
    coverRecord("global-cover", "global", null, "通用封面"),
    coverRecord("current-cover", "ip", ACTIVE_IP.id, "当前IP封面"),
    coverRecord("other-cover", "ip", "ip-other", "其他IP封面"),
  ]));

  const { render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const user = userEvent.setup({ document });
  const view = render(
    <IPProvider>
      <KnowledgeHubPage />
    </IPProvider>,
  );

  await view.findByText("通用封面");
  await view.findByText("当前IP封面");
  assert.equal(view.queryByText("其他IP封面"), null);
  assert.equal(view.queryByRole("button", { name: "删除封面「通用封面」" }), null);

  await user.click(view.getByRole("button", { name: "删除封面「当前IP封面」" }));
  await waitFor(() => assert.equal(view.queryByText("当前IP封面"), null));

  const remaining = JSON.parse(localStorage.getItem("ipwr:coverRefs") ?? "[]") as Array<{ id: string }>;
  assert.deepEqual(remaining.map(item => item.id), ["global-cover", "other-cover"]);
});

test("封面元数据存在但图片丢失时进入失败闭锁", async () => {
  const missingImageCover = {
    ...coverRecord("missing-image", "ip", ACTIVE_IP.id, "图片已丢失的封面"),
    imageDataUrl: "",
    imageKey: "missing-image-key",
  };
  const original = JSON.stringify([missingImageCover]);
  localStorage.setItem("ipwr:coverRefs", original);

  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const KnowledgeHubPage = (await import("../app/knowledge-hub/page")).default;
  const view = render(
    <IPProvider>
      <KnowledgeHubPage />
    </IPProvider>,
  );

  await view.findByRole("alert", { name: "封面参考库加载失败" });
  assert.equal(view.queryByText("图片已丢失的封面"), null);
  assert.equal(localStorage.getItem("ipwr:coverRefs"), original);
});
