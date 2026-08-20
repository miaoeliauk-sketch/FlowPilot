import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/knowledge-intake",
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

after(() => restoreBrowser?.());

function buildIntakeResponseItem(title: string) {
  return {
    title,
    summary: `${title}摘要`,
    category: "选题方法库",
    ipId: null,
    ipMatchStatus: "not_applicable",
    ipMatchReason: "通用方法",
    coreMethod: `${title}核心方法`,
    applicableScenarios: ["短视频选题"],
    triggerKeywords: [title],
    similarPhrases: [],
    aiUsage: "用于优化短视频选题",
    examples: [],
    unsuitableCases: [],
    tags: [title],
    reusableValue: "可复用",
    confidence: "高",
    confidenceReason: "原文明确",
    ingestRecommend: "建议入库",
    ingestReason: "方法完整",
  };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test("普通智能入库在提交前提示长内容需要分段并阻止提炼", async () => {
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;

  const view = render(
    <IPProvider>
      <KnowledgeIntakePage />
    </IPProvider>,
  );
  const user = userEvent.setup({ document });

  await user.click(view.getByPlaceholderText(/粘贴逐字稿/));
  await user.paste("长".repeat(10_372));

  assert.ok(view.getByText("当前内容10372字，单次智能提炼建议不超过4000字，请按章节分成约3段导入"));
  assert.equal(
    (view.getByRole("button", { name: "AI提炼方法" }) as HTMLButtonElement).disabled,
    true,
  );
});

test("有可靠标题结构的长文可以先预览自动分段结果", async () => {
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;

  const view = render(
    <IPProvider>
      <KnowledgeIntakePage />
    </IPProvider>,
  );
  const user = userEvent.setup({ document });
  const content = [
    "# 第一章 选题",
    "甲".repeat(2_100),
    "## 第二章 开头",
    "乙".repeat(2_100),
    "## 第三章 结尾",
    "丙".repeat(1_000),
  ].join("\n");

  await user.click(view.getByPlaceholderText(/粘贴逐字稿/));
  await user.paste(content);
  await user.click(view.getByRole("button", { name: "预览自动分段" }));

  assert.ok(view.getByText("分段预览（共2段）"));
  assert.ok(view.getByText("1. 第一章 选题"));
  assert.ok(view.getByText("2. 第二章 开头 等2个章节"));
  assert.ok(view.getByText(/2109字/));
  assert.ok(view.getByText(/3121字/));
});

test("确认分段后依次提炼并显示当前进度与来源段落", async () => {
  const { render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;
  const originalFetch = globalThis.fetch;
  const first = deferredResponse();
  const second = deferredResponse();
  const requestBodies: Array<{ rawContent: string }> = [];
  let callCount = 0;
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as { rawContent: string });
    callCount += 1;
    return callCount === 1 ? first.promise : second.promise;
  };

  try {
    const view = render(
      <IPProvider>
        <KnowledgeIntakePage />
      </IPProvider>,
    );
    const user = userEvent.setup({ document });
    const content = [
      "# 第一章 选题",
      "甲".repeat(2_100),
      "## 第二章 开头",
      "乙".repeat(2_100),
      "## 第三章 结尾",
      "丙".repeat(1_000),
    ].join("\n");

    await user.click(view.getByPlaceholderText(/粘贴逐字稿/));
    await user.paste(content);
    await user.click(view.getByRole("button", { name: "预览自动分段" }));
    await user.click(view.getByRole("button", { name: "确认分段并开始提炼" }));

    assert.ok(view.getByText("正在提炼第1/2段：第一章 选题"));
    assert.equal(callCount, 1, "第一段完成前不应提前请求第二段");

    first.resolve(new Response(JSON.stringify({
      mode: "global",
      items: [buildIntakeResponseItem("选题方法")],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await waitFor(() => assert.equal(callCount, 2));
    assert.ok(view.getByText("正在提炼第2/2段：第二章 开头 等2个章节"));
    second.resolve(new Response(JSON.stringify({
      mode: "global",
      items: [buildIntakeResponseItem("开头方法")],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await waitFor(() => assert.ok(view.getAllByText("选题方法").length > 0));
    assert.ok(view.getAllByText("开头方法").length > 0);
    assert.ok(view.getByText("来源：第1段·第一章 选题"));
    assert.ok(view.getByText("来源：第2段·第二章 开头 等2个章节"));
    assert.equal(requestBodies.length, 2);
    assert.ok(requestBodies.every(body => body.rawContent.length <= 4_000));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("单段失败不清除成功结果并且可以只重试失败段", async () => {
  const { render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<{ rawContent: string }> = [];
  let callCount = 0;
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as { rawContent: string });
    callCount += 1;
    if (callCount === 1) {
      return new Response(JSON.stringify({
        mode: "global",
        items: [buildIntakeResponseItem("已成功的方法")],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (callCount === 2) {
      return new Response(JSON.stringify({ error: "第二段返回格式不完整" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      mode: "global",
      items: [buildIntakeResponseItem("重试成功的方法")],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const view = render(
      <IPProvider>
        <KnowledgeIntakePage />
      </IPProvider>,
    );
    const user = userEvent.setup({ document });
    const content = [
      "# 第一章 选题",
      "甲".repeat(2_100),
      "## 第二章 开头",
      "乙".repeat(2_100),
      "## 第三章 结尾",
      "丙".repeat(1_000),
    ].join("\n");

    await user.click(view.getByPlaceholderText(/粘贴逐字稿/));
    await user.paste(content);
    await user.click(view.getByRole("button", { name: "预览自动分段" }));
    await user.click(view.getByRole("button", { name: "确认分段并开始提炼" }));

    await waitFor(() => assert.ok(view.getByText("第二段返回格式不完整")));
    assert.ok(view.getAllByText("已成功的方法").length > 0);
    assert.equal(callCount, 2);

    await user.click(view.getByRole("button", { name: "重试第2段" }));

    await waitFor(() => assert.ok(view.getAllByText("重试成功的方法").length > 0));
    assert.ok(view.getAllByText("已成功的方法").length > 0, "重试失败段不能清除其他段的成功结果");
    assert.equal(callCount, 3);
    assert.equal(requestBodies[2]?.rawContent, requestBodies[1]?.rawContent, "重试只能重新提交失败段");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
