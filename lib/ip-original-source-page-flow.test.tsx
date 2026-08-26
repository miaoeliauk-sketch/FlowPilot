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

test("携带IP编号进入资料导入页时自动对齐对应IP", async () => {
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ipB.id));
  window.history.replaceState({}, "", `/knowledge-intake/original?ipId=${encodeURIComponent(ipA.id)}`);

  try {
    const { render } = await import("@testing-library/react");
    const { IPProvider } = await import("./ip-context");
    const OriginalSourcePage = (await import("../app/knowledge-intake/original/page")).default;
    const view = render(<IPProvider><OriginalSourcePage /></IPProvider>);

    assert.ok(await view.findByText(ipA.name, { selector: "b" }));
    assert.equal(JSON.parse(localStorage.getItem("ipwr:activeIpId") ?? "null"), ipA.id);
  } finally {
    window.history.replaceState({}, "", "/knowledge-intake/original");
  }
});

test("IP A发起的旧分析在切换到IP B后不会展示也不能保存", async () => {
  const originalContent = "老师原话：真正重要的是判断力。";
  let resolveAnalysis: ((response: Response) => void) | null = null;
  let requestedSourceId = "";
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { sourceId?: string };
    requestedSourceId = body.sourceId ?? "";
    return await new Promise<Response>(resolve => {
      resolveAnalysis = resolve;
    });
  };

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

  await user.type(view.getByPlaceholderText("例如：持续输出的真正含义"), "判断力");
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
          sourceId: requestedSourceId,
          startPosition: 0,
          endPosition: originalContent.length,
          originalExcerpt: originalContent,
          extractionStatus: "AI提取",
        }],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  });

  assert.equal(view.queryByText("内容理解结果"), null);
  assert.equal(view.queryByText("真正重要的是判断力。"), null);
  assert.equal(localStorage.getItem("ipwr:knowledgeEntries"), null);
});

test("粘贴逐字稿后分两层展示全库比较并由人工决定是否保存", async () => {
  const originalContent = "今天讲反常识选题。先写出大家默认相信的判断，再用真实案例推翻它。";
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    {
      id: "source-existing",
      category: "IP原始内容",
      title: "七月直播逐字稿",
      rawContent: originalContent,
      sourceKind: "直播逐字稿",
      sourceName: "七月直播.srt",
      sourceAnalysis: null,
      tags: ["直播逐字稿"],
      keywords: ["反常识选题"],
      ipId: ipB.id,
      sourceTier: "中",
      sourceTierReason: "历史原文",
      contentDirection: [],
      sourcePlatform: "直播逐字稿",
      sourceUrl: "",
      note: "",
      createdAt: "2026-08-01T00:00:00.000Z",
      extractedAt: null,
      metrics: null,
      viralEvaluation: null,
      usageRecords: [],
      status: "未使用",
      dna: null,
    },
    {
      id: "method-existing",
      category: "选题方法库",
      title: "反常识选题法",
      rawContent: "【一句话总结】\n先写出大众默认判断，再用真实案例推翻它",
      sourceKind: null,
      sourceName: "选题课第一讲",
      sourceAnalysis: null,
      tags: ["选题"],
      keywords: ["先写出大众默认判断，再用真实案例推翻它"],
      ipId: null,
      sourceTier: "中",
      sourceTierReason: "课程整理",
      contentDirection: [],
      sourcePlatform: "课程逐字稿",
      sourceUrl: "",
      note: "",
      createdAt: "2026-08-02T00:00:00.000Z",
      extractedAt: null,
      metrics: null,
      viralEvaluation: null,
      usageRecords: [],
      status: "未使用",
      dna: null,
    },
  ]));
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { sourceId?: string };
    return new Response(JSON.stringify({
      analysis: {
        analyzedAt: "2026-08-22T12:00:00.000Z",
        parserVersion: 1,
        items: [{
          id: "A01",
          kind: "claim",
          content: "先写出大众默认判断，再用真实案例推翻它",
          sourceId: body.sourceId ?? "",
          startPosition: 0,
          endPosition: originalContent.length,
          originalExcerpt: originalContent,
          extractionStatus: "AI提取",
        }],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const { render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const OriginalSourcePage = (await import("../app/knowledge-intake/original/page")).default;
  const view = render(
    <IPProvider>
      <OriginalSourcePage />
    </IPProvider>,
  );
  const user = userEvent.setup({ document });

  await user.type(view.getByPlaceholderText("例如：持续输出的真正含义"), "反常识选题法");
  await user.type(view.getByPlaceholderText(/粘贴老师的课程/), originalContent);
  await user.click(view.getByRole("button", { name: "开始理解内容" }));

  await waitFor(() => assert.ok(view.getByText("原文重复检查")));
  assert.ok(view.getByText("知识内容检查"));
  assert.ok(view.getAllByText("完全相同").length >= 2);
  assert.ok(view.getByText(/七月直播逐字稿.*IP原始内容/));
  assert.ok(view.getByText(/IP B.*直播逐字稿.*七月直播\.srt/));
  assert.ok(view.getByText(/反常识选题法.*选题方法库/));
  assert.ok(view.getByText(/标题表达完全一致/));
  assert.ok(view.getByText(/关键词完全一致/));
  assert.ok(view.getByText(/观点摘要完全一致/));

  const beforeDecision = localStorage.getItem("ipwr:knowledgeEntries");
  await user.click(view.getByRole("button", { name: "暂不保存" }));
  assert.equal(localStorage.getItem("ipwr:knowledgeEntries"), beforeDecision);
  assert.equal(
    (view.getByRole("button", { name: "确认保存为IP原始内容" }) as HTMLButtonElement).disabled,
    true,
  );

  await user.click(view.getByRole("button", { name: "继续保存这份原始内容" }));
  await user.click(view.getByRole("button", { name: "确认保存为IP原始内容" }));
  await waitFor(() => assert.ok(view.getByText("IP原始内容已保存")));
  assert.equal(JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]").length, 3);
});

test("txt、md和srt文件上传后都能进入同一套两层检查", async () => {
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { rawContent?: string; sourceId?: string };
    const originalContent = body.rawContent ?? "";
    return new Response(JSON.stringify({
      analysis: {
        analyzedAt: "2026-08-22T12:00:00.000Z",
        parserVersion: 1,
        items: [{
          id: "A01",
          kind: "claim",
          content: "文件中的观点摘要",
          sourceId: body.sourceId ?? "",
          startPosition: 0,
          endPosition: originalContent.length,
          originalExcerpt: originalContent,
          extractionStatus: "AI提取",
        }],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const { fireEvent, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const OriginalSourcePage = (await import("../app/knowledge-intake/original/page")).default;
  const view = render(
    <IPProvider>
      <OriginalSourcePage />
    </IPProvider>,
  );
  const user = userEvent.setup({ document });
  const fileInput = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  const formats = [
    { name: "直播.txt", type: "text/plain", content: "txt文件中的完整逐字稿内容" },
    { name: "课程.md", type: "text/markdown", content: "md文件中的完整逐字稿内容" },
    { name: "字幕.srt", type: "application/x-subrip", content: "srt文件中的完整逐字稿内容" },
  ];

  for (const format of formats) {
    const file = {
      name: format.name,
      type: format.type,
      text: async () => format.content,
    } as File;
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => assert.equal(
      (view.getByPlaceholderText(/粘贴老师的课程/) as HTMLTextAreaElement).value,
      format.content,
    ));
  }

  await user.click(view.getByRole("button", { name: "开始理解内容" }));
  await waitFor(() => assert.ok(view.getByText("原文重复检查")));
  assert.ok(view.getByText("知识内容检查"));
});
