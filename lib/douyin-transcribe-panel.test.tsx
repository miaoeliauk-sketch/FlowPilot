import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "react";

import type { DouyinTranscriptionFailureCode } from "./douyin-transcription";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/transcribe",
    pretendToBeVisual: true,
  });
  const browserGlobals: Record<string, unknown> = {
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
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

test("逐字稿页面按失败阶段显示对应文案而不采用笼统提示", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  const { cleanup, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { DouyinTranscribePanel } = await import("../components/transcribe/DouyinTranscribePanel");
  const cases: Array<{ code: DouyinTranscriptionFailureCode; expected: string }> = [
    {
      code: "link_parse_failed",
      expected: "没有识别到抖音视频链接，请检查分享文案或链接后重试。",
    },
    {
      code: "cookie_required",
      expected: "该视频需要登录信息才能下载，请选择Chrome、Safari等浏览器登录信息后重试。",
    },
    {
      code: "download_failed",
      expected: "视频下载失败，请检查网络或稍后重试。",
    },
    {
      code: "audio_conversion_failed",
      expected: "视频已下载，但音频转换失败，请检查本机FFmpeg后重试。",
    },
    {
      code: "transcription_failed",
      expected: "音频已下载，但转写失败，请检查所选转写方式或稍后重试。",
    },
  ];

  try {
    for (const scenario of cases) {
      globalThis.fetch = async (_input, init) => {
        if (!init?.method) {
          return new Response(JSON.stringify({
            ready: true,
            toolDir: "/tmp/tool",
            missing: [],
            modes: { local: true, api: true, bailian: true },
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (scenario.code === "link_parse_failed") {
          return new Response(JSON.stringify({
            errorCode: scenario.code,
            error: "下载或转写失败，请检查链接、登录状态和所选转写方式。",
          }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
          results: [{
            sourceUrl: "https://v.douyin.com/example/",
            title: "抖音链接1",
            status: "error",
            errorCode: scenario.code,
            text: "",
            message: "下载或转写失败，请检查链接、登录状态和所选转写方式。",
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      };

      const page = render(<DouyinTranscribePanel onDone={() => undefined} />);
      const user = userEvent.setup({ document });
      await page.findByText("本机工具已就绪。API Key不会保存，浏览器登录信息默认不读取。");
      assert.equal(
        (page.getByLabelText("读取抖音登录信息") as HTMLSelectElement).value,
        "",
      );
      await user.type(
        page.getByPlaceholderText("把抖音分享文案或视频链接粘贴到这里，可一行一条"),
        "https://v.douyin.com/example/",
      );
      await user.click(page.getByRole("button", { name: "开始提取逐字稿" }));
      const messages = await page.findAllByText(scenario.expected);
      assert.ok(messages.length >= 1, scenario.code);
      assert.equal(page.queryByText("下载或转写失败，请检查链接、登录状态和所选转写方式。"), null);
      cleanup();
      document.body.innerHTML = "";
    }
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("逐字稿页面遇到损坏响应或未知状态时只显示固定安全提示", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  const { cleanup, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { DouyinTranscribePanel } = await import("../components/transcribe/DouyinTranscribePanel");
  const unsafeResponses = [
    new Response("<html>内部代理错误 /Users/private/path</html>", { status: 502 }),
    new Response(JSON.stringify({
      errorCode: "unexpected_internal_failure",
      error: "内部路径：/Users/private/path",
    }), { status: 500, headers: { "Content-Type": "application/json" } }),
    new Response(JSON.stringify({ results: [null] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    new Response(JSON.stringify({ error: "内部路径：/Users/private/path" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }),
    new Response(JSON.stringify({
      results: [{
        sourceUrl: "https://v.douyin.com/example/",
        title: "抖音链接1",
        status: "error",
        text: "",
        message: "内部路径：/Users/private/path",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  ];

  try {
    for (const unsafeResponse of unsafeResponses) {
      globalThis.fetch = async (_input, init) => {
        if (!init?.method) {
          return new Response(JSON.stringify({
            ready: true,
            toolDir: "/tmp/tool",
            missing: [],
            modes: { local: true, api: true, bailian: true },
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return unsafeResponse.clone();
      };

      const page = render(<DouyinTranscribePanel onDone={() => undefined} />);
      const user = userEvent.setup({ document });
      await page.findByText("本机工具已就绪。API Key不会保存，浏览器登录信息默认不读取。");
      await user.type(
        page.getByPlaceholderText("把抖音分享文案或视频链接粘贴到这里，可一行一条"),
        "https://v.douyin.com/example/",
      );
      await user.click(page.getByRole("button", { name: "开始提取逐字稿" }));
      const safeMessages = await page.findAllByText("抖音链接处理失败，请稍后重试。");
      assert.ok(safeMessages.length >= 1);
      assert.equal(page.queryByText(/private\/path/), null);
      cleanup();
      document.body.innerHTML = "";
    }
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("逐字稿页面遇到损坏的健康检查响应时安全降级", async () => {
  const unsafeHealthResponses = [
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    new Response(JSON.stringify({ error: "内部路径：/Users/private/path" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }),
  ];

  for (const unsafeHealthResponse of unsafeHealthResponses) {
    const restoreBrowser = installBrowserEnvironment();
    const originalFetch = globalThis.fetch;
    const { cleanup, render } = await import("@testing-library/react");
    const { DouyinTranscribePanel } = await import("../components/transcribe/DouyinTranscribePanel");
    try {
      globalThis.fetch = async () => unsafeHealthResponse.clone();
      const page = render(<DouyinTranscribePanel onDone={() => undefined} />);
      await page.findByText("无法检查本机转写环境。");
      assert.equal(page.queryByText(/private\/path/), null);
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      restoreBrowser();
    }
  }
});
