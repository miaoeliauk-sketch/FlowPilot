import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/shoot-room",
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

function knowledgeEntry(id: string, title: string, ipId: string | null) {
  return {
    id,
    category: "方法论",
    title,
    rawContent: `${title}正文`,
    tags: [title],
    keywords: [title],
    ipId,
    sourceTier: "高",
    sourceTierReason: "测试数据",
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

const SHUIMURAN = {
  id: "ip-shuimuran",
  name: "水木然",
  avatar: "水",
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
};
const OTHER_IP = {
  id: "ip-other",
  name: "其他IP",
  avatar: "其",
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
};

let restoreBrowser: (() => void) | undefined;

before(() => {
  restoreBrowser = installBrowserEnvironment();
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN, OTHER_IP]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
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

test("水木然拍摄时只检索通用知识和水木然知识，不读取或记录其他IP知识", async () => {
  const globalEntry = knowledgeEntry("global", "通用拍摄方法", null);
  const currentEntry = knowledgeEntry("current", "水木然拍摄方法", SHUIMURAN.id);
  const otherEntry = knowledgeEntry("other", "其他IP私有方法", OTHER_IP.id);
  localStorage.setItem(
    "ipwr:knowledgeEntries",
    JSON.stringify([globalEntry, currentEntry, otherEntry]),
  );

  const originalFetch = globalThis.fetch;
  let requestedTitles: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/knowledge-search") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        entries?: Array<{ id: string; title: string }>;
      };
      const entries = body.entries ?? [];
      requestedTitles = entries.map(entry => entry.title);
      return new Response(JSON.stringify({
        results: entries.map(entry => ({
          id: entry.id,
          reason: `匹配理由：${entry.title}`,
          relevanceTier: "高度相关",
          relevanceReason: `相关依据：${entry.title}`,
        })),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { render, waitFor } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ShootRoomPage = (await import("../app/shoot-room/page")).default;
    const user = userEvent.setup({ document });

    const view = render(
      <IPProvider>
        <ShootRoomPage />
      </IPProvider>,
    );

    const videoName = view.getByPlaceholderText("例如：ChatGPT做副业");
    await user.clear(videoName);
    await user.type(videoName, "商业认知拍摄选题");

    await waitFor(() => {
      assert.ok(requestedTitles.length > 0, "拍摄作战室没有发出知识检索请求");
    }, { timeout: 3000 });

    assert.deepEqual(
      new Set(requestedTitles),
      new Set(["通用拍摄方法", "水木然拍摄方法"]),
    );
    assert.equal(Boolean(view.queryByText("其他IP私有方法")), false);
    assert.equal(Boolean(view.queryByText("匹配理由：其他IP私有方法")), false);

    const storedEntries = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{
      id: string;
      usageRecords: unknown[];
    }>;
    const storedOther = storedEntries.find(entry => entry.id === otherEntry.id);
    assert.ok(storedOther);
    assert.equal(storedOther.usageRecords.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("切换IP后丢弃旧IP迟到的检索结果且不写入使用记录", async () => {
  const globalEntry = knowledgeEntry("global-race", "通用拍摄方法", null);
  const currentEntry = knowledgeEntry("current-race", "水木然拍摄方法", SHUIMURAN.id);
  const otherEntry = knowledgeEntry("other-race", "其他IP私有方法", OTHER_IP.id);
  localStorage.setItem(
    "ipwr:knowledgeEntries",
    JSON.stringify([globalEntry, currentEntry, otherEntry]),
  );

  interface PendingSearch {
    titles: string[];
    entries: Array<{ id: string; title: string }>;
    resolve: (response: Response) => void;
  }
  const pendingSearches: PendingSearch[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/knowledge-search") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        entries?: Array<{ id: string; title: string }>;
      };
      const entries = body.entries ?? [];
      return new Promise<Response>(resolve => {
        pendingSearches.push({
          titles: entries.map(entry => entry.title),
          entries,
          resolve,
        });
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  function searchResponse(entries: Array<{ id: string; title: string }>) {
    return new Response(JSON.stringify({
      results: entries.map(entry => ({
        id: entry.id,
        reason: `匹配理由：${entry.title}`,
        relevanceTier: "高度相关",
        relevanceReason: `相关依据：${entry.title}`,
      })),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  try {
    const { act, render, waitFor } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider, useIP } = await import("./ip-context");
    const ShootRoomPage = (await import("../app/shoot-room/page")).default;
    const user = userEvent.setup({ document });

    function ShootRoomWithIPSwitch() {
      const { switchIP } = useIP();
      return (
        <>
          <button type="button" onClick={() => switchIP(OTHER_IP.id)}>切换到其他IP</button>
          <ShootRoomPage />
        </>
      );
    }

    const view = render(
      <IPProvider>
        <ShootRoomWithIPSwitch />
      </IPProvider>,
    );

    const videoName = view.getByPlaceholderText("例如：ChatGPT做副业");
    await user.clear(videoName);
    await user.type(videoName, "商业认知拍摄选题");

    await waitFor(() => {
      assert.ok(pendingSearches.some(request => request.titles.includes("水木然拍摄方法")));
    }, { timeout: 3000 });
    const waterRequest = pendingSearches.find(request => request.titles.includes("水木然拍摄方法"));
    assert.ok(waterRequest);

    await user.click(view.getByRole("button", { name: "切换到其他IP" }));
    await waitFor(() => {
      assert.ok(pendingSearches.some(request => request.titles.includes("其他IP私有方法")));
    }, { timeout: 3000 });
    const otherRequest = pendingSearches.find(request => request.titles.includes("其他IP私有方法"));
    assert.ok(otherRequest);

    await act(async () => {
      otherRequest.resolve(searchResponse(otherRequest.entries));
      await Promise.resolve();
    });
    assert.ok(await view.findByText("其他IP私有方法"));

    await act(async () => {
      waterRequest.resolve(searchResponse(waterRequest.entries));
      await Promise.resolve();
    });

    assert.equal(Boolean(view.queryByText("水木然拍摄方法")), false);
    assert.equal(Boolean(view.queryByText("匹配理由：水木然拍摄方法")), false);
    assert.ok(view.getByText("其他IP私有方法"));

    const storedEntries = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{
      id: string;
      usageRecords: unknown[];
    }>;
    assert.equal(storedEntries.find(entry => entry.id === currentEntry.id)?.usageRecords.length, 0);
    assert.equal(storedEntries.find(entry => entry.id === otherEntry.id)?.usageRecords.length, 1);
  } finally {
    for (const pending of pendingSearches) {
      pending.resolve(searchResponse(pending.entries));
    }
    globalThis.fetch = originalFetch;
  }
});
