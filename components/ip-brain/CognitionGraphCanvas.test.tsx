import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import test, { after, before } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";

import type { CognitionGraph } from "../../lib/cognition-graph-bridge";

const canvasModulePath = "./CognitionGraphCanvas";

type LoaderResult = {
  format?: string;
  source?: string;
  shortCircuit?: boolean;
} | Promise<{
  format?: string;
  source?: string;
  shortCircuit?: boolean;
}>;

type RegisterHooks = (hooks: {
  load: (
    url: string,
    context: unknown,
    nextLoad: (url: string, context: unknown) => LoaderResult,
  ) => LoaderResult;
}) => void;

const registerHooks = (nodeModule as unknown as { registerHooks: RegisterHooks }).registerHooks;

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      return { format: "module", source: "export default {};", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

function graphFixture(): CognitionGraph {
  return {
    nodes: [
      {
        id: "node-1:claim",
        sourceCognitionNodeId: "node-1",
        kind: "CLAIM",
        type: "claimNode",
        visualRole: "claim-primary",
        order: 0,
        position: { x: 0, y: 0 },
        data: { label: "停止学习是为了消化", content: "停止学习是为了消化知识。" },
      },
      {
        id: "node-1:reasoning:1",
        sourceCognitionNodeId: "node-1",
        kind: "REASONING",
        type: "reasoningNode",
        visualRole: "reasoning-path",
        order: 1,
        position: { x: 0, y: 120 },
        data: { label: "知识淤积阻碍行动", content: "知识淤积会阻碍行动。" },
      },
      {
        id: "node-1:reasoning:2",
        sourceCognitionNodeId: "node-1",
        kind: "REASONING",
        type: "reasoningNode",
        visualRole: "reasoning-path",
        order: 2,
        position: { x: 200, y: 120 },
        data: { label: "空白期帮助消化", content: "空白期能帮助消化已有知识。" },
      },
      {
        id: "node-1:case:1",
        sourceCognitionNodeId: "node-1",
        kind: "CASE",
        type: "caseNode",
        visualRole: "case-evidence",
        order: 1,
        position: { x: 0, y: 240 },
        data: { label: "闭关后效率提高", content: "闭关一个月后行动效率提高。" },
      },
    ],
    edges: [
      {
        id: "e-node-1:claim-node-1:reasoning:1",
        source: "node-1:claim",
        target: "node-1:reasoning:1",
      },
      {
        id: "e-node-1:reasoning:1-node-1:reasoning:2",
        source: "node-1:reasoning:1",
        target: "node-1:reasoning:2",
      },
      {
        id: "e-node-1:claim-node-1:case:1",
        source: "node-1:claim",
        target: "node-1:case:1",
      },
    ],
  };
}

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/ip",
    pretendToBeVisual: true,
  });
  const previous = new Map<string, PropertyDescriptor | undefined>();

  class ResizeObserverMock {
    constructor(private readonly callback: ResizeObserverCallback) {}

    observe(target: Element) {
      this.callback([
        {
          target,
          contentRect: target.getBoundingClientRect(),
        } as ResizeObserverEntry,
      ], this as unknown as ResizeObserver);
    }

    unobserve() {}

    disconnect() {}
  }

  const browserGlobals: Record<string, unknown> = {
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
    MutationObserver: dom.window.MutationObserver,
    ResizeObserver: ResizeObserverMock,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  };

  for (const [key, value] of Object.entries(browserGlobals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  const rectangleDescriptor = Object.getOwnPropertyDescriptor(
    dom.window.HTMLElement.prototype,
    "getBoundingClientRect",
  );
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      width: 800,
      height: 500,
      top: 0,
      right: 800,
      bottom: 500,
      left: 0,
      toJSON: () => ({}),
    }),
  });

  return () => {
    dom.window.close();
    if (rectangleDescriptor) {
      Object.defineProperty(
        dom.window.HTMLElement.prototype,
        "getBoundingClientRect",
        rectangleDescriptor,
      );
    } else {
      Reflect.deleteProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect");
    }
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

test("认知图谱画布稳定渲染四个节点和点阵背景", async () => {
  const { CognitionGraphCanvas } = await import(canvasModulePath);
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const graph = graphFixture();

  try {
    const view = render(
      <CognitionGraphCanvas nodes={graph.nodes} edges={graph.edges} height={500} />,
    );

    const container = view.container.querySelector(".cognition-graph");
    assert.ok(container);
    assert.ok(container.querySelector(".react-flow"));
    assert.ok(container.querySelector(".react-flow__background"));
    await waitFor(() => {
      assert.equal(container.querySelectorAll(".react-flow__node").length, 4);
    });

    const claimNode = container.querySelector('[data-node-type="claim"]');
    const reasoningNodes = container.querySelectorAll('[data-node-type="reasoning"]');
    const caseNode = container.querySelector('[data-node-type="case"]');
    assert.ok(claimNode);
    assert.match(claimNode.className, /bg-\[#F3A04C\]/u);
    assert.equal(reasoningNodes.length, 2);
    reasoningNodes.forEach((node) => assert.match(node.className, /rounded-full/u));
    assert.ok(caseNode);
    assert.match(caseNode.className, /rounded-full/u);
    assert.match(caseNode.className, /border-dashed/u);

    for (const label of graph.nodes.map(node => node.data.label)) {
      assert.ok(view.getByText(label));
    }
    for (const node of [claimNode, ...reasoningNodes, caseNode]) {
      assert.ok(node.querySelector(".react-flow__handle.source"));
      assert.ok(node.querySelector(".react-flow__handle.target"));
    }
  } finally {
    cleanup();
  }
});

test("同一认知节点拆出的视觉节点同步呈现冲突高亮", async () => {
  const { CognitionGraphCanvas } = await import(canvasModulePath);
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const graph = graphFixture();
  const conflictingNodes = graph.nodes.map(node => ({
    ...node,
    data: { ...node.data, auditStatus: "CONFLICTING" as const },
  }));

  try {
    const view = render(
      <CognitionGraphCanvas nodes={conflictingNodes} edges={graph.edges} height={500} />,
    );

    await waitFor(() => {
      assert.equal(view.container.querySelectorAll('[data-audit-status="CONFLICTING"]').length, 4);
    });
    view.container.querySelectorAll('[data-audit-status="CONFLICTING"]').forEach((node) => {
      assert.match(node.className, /border-\[#DC2626\]/u);
      assert.match(node.className, /bg-\[#FEF2F2\]/u);
    });
  } finally {
    cleanup();
  }
});

test("相关认知节点呈现绿色反馈", async () => {
  const { CognitionGraphCanvas } = await import(canvasModulePath);
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const graph = graphFixture();
  const relatedNodes = graph.nodes.map(node => ({
    ...node,
    data: { ...node.data, auditStatus: "RELATED" as const },
  }));

  try {
    const view = render(
      <CognitionGraphCanvas nodes={relatedNodes} edges={graph.edges} height={500} />,
    );
    await waitFor(() => {
      assert.equal(view.container.querySelectorAll('[data-audit-status="RELATED"]').length, 4);
    });
    view.container.querySelectorAll('[data-audit-status="RELATED"]').forEach((node) => {
      assert.match(node.className, /border-\[#16A34A\]/u);
      assert.match(node.className, /ring-2/u);
    });
  } finally {
    cleanup();
  }
});

test("本次未检查的认知节点降低透明度且不冒充无关结论", async () => {
  const { CognitionGraphCanvas } = await import(canvasModulePath);
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const graph = graphFixture();
  const unassessedNodes = graph.nodes.map(node => ({
    ...node,
    data: { ...node.data, auditStatus: "UNASSESSED" as const },
  }));

  try {
    const view = render(
      <CognitionGraphCanvas nodes={unassessedNodes} edges={graph.edges} height={500} />,
    );
    await waitFor(() => {
      assert.equal(view.container.querySelectorAll('[data-audit-status="UNASSESSED"]').length, 4);
    });
    view.container.querySelectorAll('[data-audit-status="UNASSESSED"]').forEach((node) => {
      assert.match(node.className, /opacity-50/u);
      assert.doesNotMatch(node.className, /border-\[#DC2626\]|border-\[#16A34A\]/u);
    });
  } finally {
    cleanup();
  }
});
