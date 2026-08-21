import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { addVideoReviewForSource } from "./review-traceability";
import { createTopicBoardIPProfile } from "./topic-board-contract.fixture";

test("选题建议不会把外部不可追溯复盘发送给AI", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/topic-proposal",
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

  const ip = createTopicBoardIPProfile();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", "true");
  addVideoReviewForSource({
    activeIPId: ip.id,
    source: { type: "external" },
    review: {
      title: "外部高播放复盘不应参与选题",
      platform: "视频号",
      publishedAt: "2026-08-20",
      videoUrl: "",
      contentDirection: "商业洞察",
      scriptText: "外部临时内容",
      metrics: { views: 999999, likes: 9999, comments: 999, favorites: 999, shares: 999, newFollowers: 999, dms: 0, leads: 0, conversions: 0 },
      analysis: null,
    },
  });

  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ proposals: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { cleanup, render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const TopicProposalPage = (await import("../app/topic-proposal/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><TopicProposalPage /></IPProvider>);

    await user.click(view.getByRole("button", { name: /生成本周选题提案/ }));
    await view.findByText(/本次提案参考了/);
    assert.doesNotMatch(JSON.stringify(capturedBody), /外部高播放复盘不应参与选题/);
    cleanup();
  } finally {
    globalThis.fetch = originalFetch;
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
});
