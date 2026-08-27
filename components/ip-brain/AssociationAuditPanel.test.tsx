import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";

import type { AssociationAuditResponse } from "../../lib/cognition-association-audit";

const panelModulePath = "./AssociationAuditPanel";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/ip",
    pretendToBeVisual: true,
  });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const browserGlobals: Record<string, unknown> = {
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  };

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

function reportFixture(): AssociationAuditResponse {
  return {
    results: [
      {
        nodeId: "related-node",
        relation: "RELATED",
        lexicalScore: 0.72,
        reason: "讨论的是同一种认知沉淀方法。",
        quote: "结构化账本记录认知",
      },
      {
        nodeId: "conflicting-node",
        relation: "CONFLICTING",
        lexicalScore: 0.81,
        reason: "新观点与原节点的核心立场相反。",
        quote: "持续输出不等于日更",
      },
      {
        nodeId: "unrelated-node",
        relation: "UNRELATED",
        lexicalScore: 0,
        reason: "已经检查，讨论对象不同。",
        quote: "基金定投",
      },
      {
        nodeId: "unassessed-node",
        relation: "UNASSESSED",
        lexicalScore: 0.18,
        reason: null,
        quote: null,
      },
    ],
    truncated: true,
    candidateCountBeforeTruncation: 4,
    assessedCandidateCount: 3,
    auditScope: "full",
  };
}

let restoreBrowser: (() => void) | undefined;

before(() => {
  restoreBrowser = installBrowserEnvironment();
});

after(() => {
  restoreBrowser?.();
});

test("全量审计报告明确显示当前审计范围", async () => {
  const { AssociationAuditPanel } = await import(panelModulePath);
  const { cleanup, render } = await import("@testing-library/react");

  try {
    const view = render(<AssociationAuditPanel report={reportFixture()} onReaudit={() => {}} />);
    assert.ok(view.getByText("全量审计（从全部候选节点发起）"));
  } finally {
    cleanup();
  }
});

test("子集审计内部再次截断时同时显示范围说明和截断数量", async () => {
  const { AssociationAuditPanel } = await import(panelModulePath);
  const { cleanup, render } = await import("@testing-library/react");

  try {
    const view = render(
      <AssociationAuditPanel
        report={{ ...reportFixture(), auditScope: "subset" }}
        onReaudit={() => {}}
      />,
    );
    assert.ok(view.getByText("本次为子集审计（针对此前未检查节点）"));
    assert.ok(view.getByText("候选节点较多，本次仅审计了3 / 4个节点，其余标记为未检查。"));
  } finally {
    cleanup();
  }
});

test("关联审计面板明确区分四种状态且未检查不被写成无关", async () => {
  const { AssociationAuditPanel } = await import(panelModulePath);
  const { cleanup, render, within } = await import("@testing-library/react");

  try {
    const view = render(<AssociationAuditPanel report={reportFixture()} onReaudit={() => {}} />);
    const related = view.container.querySelector('[data-association-status="RELATED"]');
    const conflicting = view.container.querySelector('[data-association-status="CONFLICTING"]');
    const unrelated = view.container.querySelector('[data-association-status="UNRELATED"]');
    const unassessed = view.container.querySelector('[data-association-status="UNASSESSED"]');

    assert.ok(related);
    assert.ok(conflicting);
    assert.ok(unrelated);
    assert.ok(unassessed);
    const relatedBadge = within(related as HTMLElement).getByText("相关");
    const conflictingBadge = within(conflicting as HTMLElement).getByText("冲突");
    const unrelatedBadge = within(unrelated as HTMLElement).getByText("无关");
    const unassessedBadge = within(unassessed as HTMLElement).getByText("本次未检查");
    assert.match(relatedBadge.className, /bg-\[#EAF3DE\]/u);
    assert.match(conflictingBadge.className, /bg-\[#FCEBEB\]/u);
    assert.match(unrelatedBadge.className, /bg-\[#F2F1ED\]/u);
    assert.match(unassessedBadge.className, /bg-\[#E8E7E2\]/u);
    assert.equal(unassessed.textContent?.includes("无关"), false);
    assert.match(related.className, /border-\[#CBE2B5\]/u);
    assert.match(conflicting.className, /border-\[#F3C6C6\]/u);
    assert.match(unrelated.className, /border-\[#D8D7D1\]/u);
    assert.match(unassessed.className, /border-\[#D8D7D1\]/u);

    assert.ok(within(related as HTMLElement).getByText("讨论的是同一种认知沉淀方法。"));
    assert.ok(within(related as HTMLElement).getByText("结构化账本记录认知"));
    assert.ok(within(conflicting as HTMLElement).getByText("新观点与原节点的核心立场相反。"));
    assert.ok(within(conflicting as HTMLElement).getByText("持续输出不等于日更"));
    assert.ok(within(unassessed as HTMLElement).getByText("未被本次审计覆盖"));
    assert.equal(within(unassessed as HTMLElement).queryByText("判断理由"), null);
  } finally {
    cleanup();
  }
});

test("截断提示显示审计数量并把未检查节点子集交给父组件", async () => {
  const { AssociationAuditPanel } = await import(panelModulePath);
  const { cleanup, fireEvent, render } = await import("@testing-library/react");
  const calls: string[][] = [];

  try {
    const view = render(
      <AssociationAuditPanel
        report={reportFixture()}
        onReaudit={(nodeIds: string[]) => calls.push(nodeIds)}
      />,
    );

    assert.ok(view.getByText("候选节点较多，本次仅审计了3 / 4个节点，其余标记为未检查。"));
    fireEvent.click(view.getByRole("button", { name: "重新审计未检查节点" }));
    assert.deepEqual(calls, [["unassessed-node"]]);
  } finally {
    cleanup();
  }
});
