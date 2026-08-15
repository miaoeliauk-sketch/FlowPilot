import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { createTopicBoardIPProfile } from "./topic-board-contract.fixture";

const ipA = createTopicBoardIPProfile({ id: "ip-source-a", name: "IP A" });
const ipB = createTopicBoardIPProfile({ id: "ip-source-b", name: "IP B" });

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/knowledge-intake/original",
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
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
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

let restoreBrowser: (() => void) | undefined;
let originalFetch: typeof globalThis.fetch;

before(() => {
  restoreBrowser = installBrowserEnvironment();
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ipA, ipB]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ipA.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
});

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
  localStorage.clear();
});

after(() => restoreBrowser?.());

test("IP A发起的旧分析在切换到IP B后不能保存", async () => {
  const originalContent = "老师原话：真正重要的是判断力。";
  let resolveAnalysis: ((response: Response) => void) | null = null;
  globalThis.fetch = async () => await new Promise<Response>(resolve => {
    resolveAnalysis = resolve;
  });

  const { act, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider, useIP } = await import("./ip-context");
  const OriginalSourcePage = (await import("../app/knowledge-intake/original/page")).default;

  function SwitchIP() {
    const { switchIP } = useIP();
    return <button onClick={() => switchIP(ipB.id)}>切换到IP B</button>;
  }

  const view = render(
    <IPProvider>
      <SwitchIP />
      <OriginalSourcePage />
    </IPProvider>,
  );
  const user = userEvent.setup({ document });

  await user.type(view.getByPlaceholderText(/粘贴老师的课程/), originalContent);
  await user.click(view.getByRole("button", { name: "开始理解内容" }));
  await waitFor(() => assert.equal(typeof resolveAnalysis, "function"));
  await user.click(view.getByRole("button", { name: "切换到IP B" }));

  await act(async () => {
    resolveAnalysis?.(new Response(JSON.stringify({
      analysis: {
        analyzedAt: "2026-08-14T12:00:00.000Z",
        parserVersion: 1,
        items: [{
          id: "A01",
          kind: "claim",
          content: "真正重要的是判断力。",
          sourceId: "source-draft-test",
          startPosition: 0,
          endPosition: originalContent.length,
          originalExcerpt: originalContent,
          extractionStatus: "AI提取",
        }],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  });

  await view.findByText("内容理解结果");
  await user.click(view.getByRole("button", { name: "确认保存为IP原始内容" }));

  assert.ok(view.getByRole("alert").textContent?.includes("当前IP已切换"));
  assert.equal(localStorage.getItem("ipwr:knowledgeEntries"), null);
});
