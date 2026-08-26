import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";

const interviewPanelModulePath = "../components/ip-boundary/InterviewPanel";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/topic-board",
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
    InputEvent: dom.window.InputEvent,
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

after(() => {
  restoreBrowser?.();
});

test("IP切换只隐藏当前访谈并按IP和选题恢复各自草稿", async () => {
  const { InterviewPanel } = await import(interviewPanelModulePath);
  const { cleanup, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const user = userEvent.setup({ document });
  const question = {
    id: "question-claim",
    missingElement: "CLAIM",
    content: "老师，关于这个话题，您的核心主张是什么？",
    basedOnNodeIds: [],
  };
  const panel = (activeIPId: string, interviewId: string) => React.createElement(InterviewPanel, {
    key: activeIPId,
    activeIPId,
    topicId: "topic-shared",
    interviewId,
    questions: [question],
  });

  try {
    const view = render(panel("ip-a", "interview-a-v1"));
    const answerA = "我对这个话题的核心判断，需要先区分事实和情绪。";
    await user.type(view.getByRole("textbox", { name: "访谈回答" }), answerA);

    view.rerender(panel("ip-b", "interview-b-v1"));
    assert.equal(
      (view.getByRole("textbox", { name: "访谈回答" }) as HTMLTextAreaElement).value,
      "",
      "IP B不能看到IP A的访谈草稿",
    );

    view.rerender(panel("ip-a", "interview-a-v1"));
    assert.equal(
      (view.getByRole("textbox", { name: "访谈回答" }) as HTMLTextAreaElement).value,
      answerA,
      "切回IP A后应恢复同一选题和访谈的草稿",
    );
  } finally {
    cleanup();
  }
});
