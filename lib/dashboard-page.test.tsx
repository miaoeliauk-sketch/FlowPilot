import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
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

const currentIP = { id: "ip-a", name: "当前IP-A" };
const otherIP = { id: "ip-b", name: "其他IP-B" };

function knowledgeEntry(id: string, title: string, category: string, ipId: string | null) {
  return {
    id,
    title,
    category,
    ipId,
    createdAt: `2026-08-08T00:00:0${id.length}.000Z`,
  };
}

async function renderDashboard() {
  const { render } = await import("@testing-library/react");
  const Home = (await import("../app/page")).default;
  return render(<Home />);
}

function seedActiveIP() {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([currentIP, otherIP]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(currentIP.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
}

let restoreBrowser: (() => void) | undefined;

before(() => {
  restoreBrowser = installBrowserEnvironment();
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  seedActiveIP();
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

test("当前IP知识只统计并展示当前IP的数据", async () => {
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    knowledgeEntry("current", "当前IP知识", "IP表达语料", currentIP.id),
    knowledgeEntry("other", "其他IP私有知识", "IP表达语料", otherIP.id),
  ]));

  const view = await renderDashboard();
  const label = await view.findByText("当前IP知识库");

  assert.match(label.parentElement?.textContent ?? "", /^1当前IP知识库$/);
  assert.ok(view.getByText("当前IP知识"));
  assert.equal(Boolean(view.queryByText("其他IP私有知识")), false);
});

test("通用方法库只统计并展示明确全局的方法知识", async () => {
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    knowledgeEntry("global", "明确全局方法", "选题方法库", null),
    knowledgeEntry("unowned-private", "无归属私有知识", "IP表达语料", null),
    knowledgeEntry("other-global-category", "其他IP的方法知识", "选题方法库", otherIP.id),
  ]));

  const view = await renderDashboard();
  const label = await view.findByText("通用方法库");

  assert.match(label.parentElement?.textContent ?? "", /^1通用方法库$/);
  assert.ok(view.getByText("明确全局方法"));
  assert.equal(Boolean(view.queryByText("无归属私有知识")), false);
  assert.equal(Boolean(view.queryByText("其他IP的方法知识")), false);
});

test("封面参考库只统计明确全局和当前IP的封面", async () => {
  localStorage.setItem("ipwr:coverRefs", JSON.stringify([
    { id: "global", title: "全局封面", scope: "global", ipId: null, createdAt: "2026-08-08T00:00:04.000Z" },
    { id: "current", title: "当前IP封面", scope: "ip", ipId: currentIP.id, createdAt: "2026-08-08T00:00:03.000Z" },
    { id: "other", title: "其他IP封面", scope: "ip", ipId: otherIP.id, createdAt: "2026-08-08T00:00:02.000Z" },
    { id: "conflict", title: "冲突封面", scope: "global", ipId: otherIP.id, createdAt: "2026-08-08T00:00:01.000Z" },
  ]));

  const view = await renderDashboard();
  const label = await view.findByText("封面参考库");

  assert.match(label.parentElement?.textContent ?? "", /^2封面参考库$/);
});

test("历史校准样本只统计当前IP的数据", async () => {
  localStorage.setItem("ipwr:topicCalibrationSamples", JSON.stringify([
    { id: "current", ipId: currentIP.id, ipName: currentIP.name },
    { id: "other", ipId: otherIP.id, ipName: otherIP.name },
  ]));

  const view = await renderDashboard();
  const label = await view.findByText("历史校准样本");

  assert.match(label.parentElement?.textContent ?? "", /^1历史校准样本$/);
});

test("完全没有当前IP时只显示通用知识且不暴露任何IP私有数据", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([]));
  localStorage.removeItem("ipwr:activeIpId");
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    knowledgeEntry("global", "无IP时可见的通用方法", "选题方法库", null),
    knowledgeEntry("private", "无IP时不可见的私有知识", "IP表达语料", currentIP.id),
    knowledgeEntry("unowned-private", "无IP时不可见的无归属私有知识", "IP表达语料", null),
  ]));
  localStorage.setItem("ipwr:coverRefs", JSON.stringify([
    { id: "global", title: "无IP时可见的全局封面", scope: "global", ipId: null, createdAt: "2026-08-08T00:00:04.000Z" },
    { id: "private", title: "无IP时不可见的私有封面", scope: "ip", ipId: currentIP.id, createdAt: "2026-08-08T00:00:03.000Z" },
  ]));
  localStorage.setItem("ipwr:topicCalibrationSamples", JSON.stringify([
    { id: "private", ipId: currentIP.id, ipName: currentIP.name },
  ]));

  const view = await renderDashboard();

  assert.ok(view.getByText("无IP时可见的通用方法"));
  assert.equal(Boolean(view.queryByText("无IP时不可见的私有知识")), false);
  assert.equal(Boolean(view.queryByText("无IP时不可见的无归属私有知识")), false);
  assert.match(view.getByText("当前IP知识库").parentElement?.textContent ?? "", /^0当前IP知识库$/);
  assert.match(view.getByText("封面参考库").parentElement?.textContent ?? "", /^1封面参考库$/);
  assert.match(view.getByText("历史校准样本").parentElement?.textContent ?? "", /^0历史校准样本$/);
});
