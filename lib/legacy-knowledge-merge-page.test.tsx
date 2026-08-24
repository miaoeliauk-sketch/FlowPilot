import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import type { KnowledgeEntry } from "./types";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/knowledge-merge-maintenance",
  pretendToBeVisual: true,
});

const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
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
  IS_REACT_ACT_ENVIRONMENT: true,
  React,
})) {
  previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
Object.defineProperty(dom.window.navigator, "locks", {
  configurable: true,
  value: { request: async (_name: string, operation: () => unknown) => operation() },
});

after(() => {
  dom.window.close();
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Object.defineProperty(globalThis, name, { configurable: true, value: undefined });
  }
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("ipwr:scriptAssets", "[]");
  localStorage.setItem("ipwr:videoReviews", "[]");
  localStorage.setItem("ipwr:ipStyleProfiles", "[]");
});

function knowledge(id: string, title: string, rawContent: string): KnowledgeEntry {
  return {
    id,
    category: "定位方法库",
    title,
    rawContent,
    sourceKind: null,
    sourceName: "历史导入",
    sourceAnalysis: null,
    tags: [],
    keywords: [],
    ipId: null,
    sourceTier: "低",
    sourceTierReason: "旧知识来源待复核",
    contentDirection: [],
    sourcePlatform: "智能入库助手",
    sourceUrl: "",
    note: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    extractedAt: null,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    trustStatus: null,
    sourceReference: null,
    executionTemplate: null,
    dna: null,
  };
}

test("受控管理页先锁定单组快照，再经二次确认执行真实严格合并", async () => {
  const source = knowledge("source-a", "来源项", "来源项原文");
  const survivor = knowledge("survivor-b", "保留项", "保留项原文");
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([source, survivor]));

  const { cleanup, fireEvent, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const MergePage = (await import("../app/knowledge-merge-maintenance/page")).default;
  const user = userEvent.setup({ document });
  const page = render(<MergePage />);
  try {
    await user.type(page.getByLabelText("复核组编号"), "D01");
    await user.type(page.getByLabelText("保留项编号"), survivor.id);
    await user.type(page.getByLabelText("被合并项编号"), source.id);
    await user.type(
      page.getByLabelText("完整备份SHA-256"),
      "92f23a67057063cb2859a8b22be0e8e33446973d1ea04fbbfb2bd731af152278",
    );
    fireEvent.change(page.getByLabelText("人工合并后的完整正文"), {
      target: { value: "保留项原文。补充来源项独有信息。" },
    });

    await user.click(page.getByRole("button", { name: "载入并锁定本组" }));
    assert.match((await page.findByRole("status")).textContent ?? "", /已锁定D01/);
    assert.ok(page.getByText("保留项"));
    assert.ok(page.getByText("来源项"));
    assert.ok(page.getByText("保留项原文"));
    assert.ok(page.getByText("来源项原文"));
    assert.equal(page.getAllByText(/分类：定位方法库/).length, 2);
    assert.equal(page.getAllByText(/来源：历史导入.*智能入库助手/).length, 2);
    assert.equal(
      (JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as KnowledgeEntry[]).length,
      2,
      "仅锁定快照时不能提前修改知识",
    );

    await user.click(page.getByRole("checkbox", { name: "我已核对本组内容并确认只处理这一组" }));
    await user.click(page.getByRole("button", { name: "确认执行D01" }));
    assert.match((await page.findByRole("status")).textContent ?? "", /D01处理完成/);
    const persisted = JSON.parse(
      localStorage.getItem("ipwr:knowledgeEntries") ?? "[]",
    ) as KnowledgeEntry[];
    assert.deepEqual(persisted.map(entry => entry.id), [survivor.id]);
    assert.equal(persisted[0]?.rawContent, "保留项原文。补充来源项独有信息。");
  } finally {
    cleanup();
  }
});
