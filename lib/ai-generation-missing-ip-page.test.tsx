import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";

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

let restoreBrowser: (() => void) | undefined;

before(() => {
  restoreBrowser = installBrowserEnvironment();
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(null));
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

test("经典模式未选择IP时显示明确提示且不发送生成请求", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("未选择IP时不应发送请求");
  };

  try {
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

    await user.type(
      view.getByPlaceholderText("例如：一个正在发生的变化，普通人应该如何判断？"),
      "测试选题",
    );
    await user.click(view.getByRole("button", { name: "生成完整内容" }));

    assert.ok(view.getByText("请先在「IP身份中心」选择一个当前操盘IP"));
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Content Engine未选择IP时禁用生成按钮并显示明确提示", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("未选择IP时不应发送请求");
  };

  try {
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

    await user.click(view.getByRole("button", { name: /内容引擎（完整内容包）/ }));
    await user.type(
      view.getByPlaceholderText("例如：一个正在发生的变化，普通人应该如何判断？"),
      "测试选题",
    );

    const generateButton = view.getByRole("button", { name: "⚡ 一键生成完整内容包" }) as HTMLButtonElement;
    assert.equal(generateButton.disabled, true);
    assert.ok(view.getByText(/请先在「IP身份中心」选择一个当前操盘IP/));
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
