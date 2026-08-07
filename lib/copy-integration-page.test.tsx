import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/copy-integration",
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

test("用户提交两份素材后看到内容母稿和待确认冲突", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: { sources?: Array<{ name: string; content: string }> } = {};
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      draft: {
        sections: [{
          heading: "信任与成交",
          paragraphs: ["信任是影响成交的重要因素。"],
          sourceIds: ["source-1", "source-2"],
        }],
        fullText: "## 信任与成交\n\n信任是影响成交的重要因素。",
      },
      integrationNotes: {
        mergedDuplicates: [],
        conflicts: [{
          summary: "建立信任所需时间不一致",
          alternatives: [
            { text: "需要7天", sourceIds: ["source-1"] },
            { text: "需要30天", sourceIds: ["source-2"] },
          ],
        }],
        exclusions: [],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const CopyIntegrationPage = (await import("../app/copy-integration/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<CopyIntegrationPage />);

    const nameInputs = view.getAllByLabelText("素材名称");
    const contentInputs = view.getAllByLabelText("素材正文");
    await user.clear(nameInputs[0]);
    await user.type(nameInputs[0], "逐字稿");
    await user.type(contentInputs[0], "客户不买，是因为缺乏信任。建立信任需要7天。");
    await user.clear(nameInputs[1]);
    await user.type(nameInputs[1], "笔记");
    await user.type(contentInputs[1], "成交困难源于客户不信任。建立信任需要30天。");
    await user.click(view.getByRole("button", { name: "开始整合" }));

    assert.equal(requestBody.sources?.length, 2);
    assert.equal(requestBody.sources?.[0].name, "逐字稿");
    assert.ok(await view.findByText("内容母稿"));
    assert.ok(view.getByText("信任是影响成交的重要因素。"));
    assert.ok(view.getByText("待确认冲突"));
    assert.ok(view.getByText("建立信任所需时间不一致"));
    assert.ok(view.getByText("需要7天"));
    assert.ok(view.getByText("需要30天"));

    await user.clear(nameInputs[0]);
    await user.type(nameInputs[0], "改名后的素材");
    assert.ok(view.getAllByText("逐字稿").length > 0);
    assert.equal(view.queryByText("改名后的素材"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("页面最多允许添加10份素材", async () => {
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const CopyIntegrationPage = (await import("../app/copy-integration/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<CopyIntegrationPage />);
  const addButton = view.getByRole("button", { name: "＋ 添加素材" });

  for (let index = 0; index < 9; index += 1) {
    await user.click(addButton);
  }

  assert.equal(view.getAllByLabelText("素材正文").length, 10);
  assert.equal((addButton as HTMLButtonElement).disabled, true);
});
