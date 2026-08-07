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

test("用户提交两份素材后按固定顺序看到四部分整合结果", async () => {
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
      decisionSummary: {
        items: [
          "关于建立信任所需时间，素材1和素材2存在冲突：需要7天 vs 需要30天。正式使用前需确定统一立场。",
          "另有1处内容标记为依据不足，详见下文“未采用及依据不足内容”部分。",
        ],
      },
      conflicts: [{
        topic: "建立信任所需时间",
        conflictPoint: "建立信任需要7天还是30天",
        alternatives: [
          { brief: "需要7天", text: "素材1认为建立信任需要7天。", sourceIds: ["source-1"] },
          { brief: "需要30天", text: "素材2认为建立信任需要30天。", sourceIds: ["source-2"] },
        ],
      }],
      contentReview: {
        exclusions: [{
          summary: "2026年10月一定完成转变",
          reason: "属于缺乏依据的具体时间断言",
          sourceIds: ["source-1"],
        }],
        evidenceGaps: [{
          summary: "建立信任周期存在固定规律",
          reason: "缺乏可核实的权威来源，但仍有整理价值",
          sourceIds: ["source-2"],
        }],
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
    const draftHeading = await view.findByRole("heading", { name: "内容母稿" });
    const summaryHeading = view.getByRole("heading", { name: "决策摘要" });
    const conflictsHeading = view.getByRole("heading", { name: "待确认冲突" });
    const reviewHeading = view.getByRole("heading", { name: "未采用及依据不足内容" });

    assert.ok(draftHeading.compareDocumentPosition(summaryHeading) & Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(summaryHeading.compareDocumentPosition(conflictsHeading) & Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(conflictsHeading.compareDocumentPosition(reviewHeading) & Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(view.getByText("信任是影响成交的重要因素。"));
    assert.ok(view.getByText(/关于建立信任所需时间，素材1和素材2存在冲突/));
    assert.ok(view.getByText("两者矛盾点在于：建立信任需要7天还是30天"));
    assert.ok(view.getByText("素材1认为建立信任需要7天。"));
    assert.ok(view.getByText("素材2认为建立信任需要30天。"));
    assert.ok(view.getByRole("heading", { name: "未采用" }));
    assert.ok(view.getByRole("heading", { name: "依据不足／建议核实" }));
    assert.ok(view.getByText("2026年10月一定完成转变"));
    assert.ok(view.getByText("建立信任周期存在固定规律"));
    assert.equal(view.queryByText("重复观点合并"), null);

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
