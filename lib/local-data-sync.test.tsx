import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "react";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const browserGlobals: Record<string, unknown> = {
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
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

test("浏览器数据比服务端完整时即使字段数相同也会回传", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  const postedBodies: Array<{ data?: Record<string, string> }> = [];

  try {
    localStorage.setItem("ipwr:topicAssets", JSON.stringify([
      { id: "topic-a" },
      { id: "topic-b" },
    ]));
    globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") {
        postedBodies.push(JSON.parse(String(init.body)) as { data?: Record<string, string> });
        return Response.json({ ok: true, updatedAt: "2026-08-11T12:00:01.000Z" });
      }
      return Response.json({
        updatedAt: "2026-08-11T12:00:00.000Z",
        data: {
          "ipwr:topicAssets": JSON.stringify([{ id: "topic-a" }]),
        },
      });
    };

    const { cleanup, render, waitFor } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { LocalDataSync } = await import("../components/LocalDataSync");
    render(<LocalDataSync />);

    await waitFor(() => assert.equal(postedBodies.length, 1), { timeout: 1_500 });
    assert.equal(
      postedBodies[0].data?.["ipwr:topicAssets"],
      JSON.stringify([{ id: "topic-a" }, { id: "topic-b" }]),
    );
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("浏览器删除字段后回传的完整快照不再包含该字段", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  const topicAssets = JSON.stringify([{ id: "topic-a" }]);
  const postedBodies: Array<{ data?: Record<string, string> }> = [];
  let getCount = 0;

  try {
    localStorage.setItem("ipwr:topicAssets", topicAssets);
    globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") {
        postedBodies.push(JSON.parse(String(init.body)) as { data?: Record<string, string> });
        return Response.json({ ok: true, updatedAt: "2026-08-11T12:00:01.000Z" });
      }
      getCount += 1;
      return Response.json({
        updatedAt: "2026-08-11T12:00:00.000Z",
        data: { "ipwr:topicAssets": topicAssets },
      });
    };

    const { cleanup, render, waitFor } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { LocalDataSync } = await import("../components/LocalDataSync");
    render(<LocalDataSync />);
    await waitFor(() => assert.equal(getCount, 1));

    localStorage.removeItem("ipwr:topicAssets");

    await waitFor(() => assert.equal(postedBodies.length, 1), { timeout: 2_500 });
    assert.equal(postedBodies[0].data?.["ipwr:topicAssets"], undefined);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("同步请求进行中发生新写入时会补发最新快照", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  const postedBodies: Array<{ data?: Record<string, string> }> = [];
  let finishFirstPost: (() => void) | undefined;
  let postCount = 0;
  let getCount = 0;

  try {
    globalThis.fetch = async (_input, init) => {
      if (init?.method !== "POST") {
        getCount += 1;
        return Response.json({ updatedAt: "", data: {} });
      }
      postCount += 1;
      postedBodies.push(JSON.parse(String(init.body)) as { data?: Record<string, string> });
      if (postCount === 1) {
        await new Promise<void>(resolve => {
          finishFirstPost = resolve;
        });
      }
      return Response.json({ ok: true, updatedAt: `post-${postCount}` });
    };

    const { cleanup, render, waitFor } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { LocalDataSync } = await import("../components/LocalDataSync");
    render(<LocalDataSync />);
    await waitFor(() => assert.equal(getCount, 1));

    localStorage.setItem("ipwr:activeIpId", "ip-a");
    await waitFor(() => assert.equal(postCount, 1), { timeout: 2_500 });
    localStorage.setItem("ipwr:activeIpId", "ip-b");
    await new Promise(resolve => window.setTimeout(resolve, 1_100));
    finishFirstPost?.();

    await waitFor(() => assert.equal(postCount, 2), { timeout: 2_500 });
    assert.equal(postedBodies[1].data?.["ipwr:activeIpId"], "ip-b");
  } finally {
    finishFirstPost?.();
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("组件关闭期间删除的数据重新挂载后不会被服务端旧快照复活", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  const topicAssets = JSON.stringify([{ id: "topic-a" }]);
  const postedBodies: Array<{ data?: Record<string, string> }> = [];
  let getCount = 0;

  try {
    localStorage.setItem("ipwr:topicAssets", topicAssets);
    globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") {
        postedBodies.push(JSON.parse(String(init.body)) as { data?: Record<string, string> });
        return Response.json({ ok: true, updatedAt: "2026-08-11T12:00:01.000Z" });
      }
      getCount += 1;
      return Response.json({
        updatedAt: "2026-08-11T12:00:00.000Z",
        data: { "ipwr:topicAssets": topicAssets },
      });
    };

    const { cleanup, render, waitFor } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { LocalDataSync } = await import("../components/LocalDataSync");
    render(<LocalDataSync />);
    await waitFor(() => assert.ok(
      localStorage.getItem("flowpilot:lastSuccessfulLocalSyncSnapshot:v1"),
    ));
    cleanup();

    localStorage.removeItem("ipwr:topicAssets");
    render(<LocalDataSync />);

    await waitFor(() => assert.equal(postedBodies.length, 1), { timeout: 1_500 });
    assert.equal(getCount, 2);
    assert.equal(postedBodies[0].data?.["ipwr:topicAssets"], undefined);
    assert.equal(localStorage.getItem("ipwr:topicAssets"), null);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("POST返回500时不记作成功并在服务恢复后重试", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  let getCount = 0;
  let postCount = 0;
  let errorEvents = 0;

  try {
    globalThis.fetch = async (_input, init) => {
      if (init?.method !== "POST") {
        getCount += 1;
        return Response.json({ updatedAt: "", data: {} });
      }
      postCount += 1;
      if (postCount === 1) {
        return Response.json({ error: "暂时不可用" }, { status: 500 });
      }
      return Response.json({ ok: true, updatedAt: "2026-08-11T12:00:02.000Z" });
    };
    window.addEventListener("flowpilot-local-sync-error", () => {
      errorEvents += 1;
    });

    const { cleanup, render, waitFor } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { LocalDataSync } = await import("../components/LocalDataSync");
    render(<LocalDataSync />);
    await waitFor(() => assert.equal(getCount, 1));
    localStorage.setItem("ipwr:activeIpId", "ip-retry");

    await waitFor(() => assert.equal(postCount, 2), { timeout: 4_000 });
    assert.equal(errorEvents, 1);
    assert.ok(localStorage.getItem("flowpilot:lastSuccessfulLocalSyncSnapshot:v1"));
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("组件卸载后迟到的GET响应不会再改写本地数据", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  let finishGet: ((response: Response) => void) | undefined;
  let postCount = 0;

  try {
    globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        return Response.json({ ok: true });
      }
      return new Promise<Response>(resolve => {
        finishGet = resolve;
      });
    };

    const { cleanup, render, waitFor } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { LocalDataSync } = await import("../components/LocalDataSync");
    render(<LocalDataSync />);
    await waitFor(() => assert.ok(finishGet));
    cleanup();

    finishGet?.(Response.json({
      updatedAt: "2026-08-11T12:00:00.000Z",
      data: { "ipwr:topicAssets": JSON.stringify([{ id: "stale-topic" }]) },
    }));
    await new Promise(resolve => window.setTimeout(resolve, 50));

    assert.equal(localStorage.getItem("ipwr:topicAssets"), null);
    assert.equal(postCount, 0);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("首次GET进行中删除本地数据时不会被服务端旧快照复活", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  let finishGet: ((response: Response) => void) | undefined;
  const topicAssets = JSON.stringify([{ id: "topic-a" }]);
  const postedBodies: Array<{ data?: Record<string, string> }> = [];

  try {
    localStorage.setItem("ipwr:topicAssets", topicAssets);
    globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") {
        postedBodies.push(JSON.parse(String(init.body)) as { data?: Record<string, string> });
        return Response.json({ ok: true, updatedAt: "2026-08-11T12:00:01.000Z" });
      }
      return new Promise<Response>(resolve => {
        finishGet = resolve;
      });
    };

    const { cleanup, render, waitFor } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { LocalDataSync } = await import("../components/LocalDataSync");
    render(<LocalDataSync />);
    await waitFor(() => assert.ok(finishGet));
    localStorage.removeItem("ipwr:topicAssets");
    finishGet?.(Response.json({
      updatedAt: "2026-08-11T12:00:00.000Z",
      data: { "ipwr:topicAssets": topicAssets },
    }));

    await waitFor(() => assert.equal(postedBodies.length, 1), { timeout: 1_500 });
    assert.equal(postedBodies[0].data?.["ipwr:topicAssets"], undefined);
    assert.equal(localStorage.getItem("ipwr:topicAssets"), null);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});

test("初始化GET返回409时停止自动重试", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  let getCount = 0;

  try {
    globalThis.fetch = async () => {
      getCount += 1;
      return Response.json({
        errorCode: "LOCAL_SYNC_FILE_CORRUPTED",
      }, { status: 409 });
    };

    const { cleanup, render, waitFor } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { LocalDataSync } = await import("../components/LocalDataSync");
    render(<LocalDataSync />);
    await waitFor(() => assert.equal(getCount, 1));
    await new Promise(resolve => window.setTimeout(resolve, 1_100));

    assert.equal(getCount, 1);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});
