import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { createTopicBoardIPProfile } from "./topic-board-contract.fixture";

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
