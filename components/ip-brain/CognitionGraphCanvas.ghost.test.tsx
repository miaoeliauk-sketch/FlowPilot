import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import test, { after, before } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";

import type { CognitionGraphCanvasNode } from "./CognitionGraphCanvas";
import type { CognitionGraphEdge } from "../../lib/cognition-graph-bridge";

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

function mixedGraphFixture(): { nodes: CognitionGraphCanvasNode[]; edges: CognitionGraphEdge[] } {
  return {
    nodes: [
      {
        id: "confirmed-1:claim",
        sourceCognitionNodeId: "confirmed-1",
        kind: "CLAIM",
        type: "claimNode",
        visualRole: "claim-primary",
        order: 0,
        position: { x: 0, y: 0 },
        data: { label: "已确认观点", content: "这是已经确权的正式观点。" },
      },
      {
        id: "draft-looking-confirmed:reasoning:1",
        sourceCognitionNodeId: "confirmed-1",
        kind: "REASONING",
        type: "reasoningNode",
        visualRole: "reasoning-path",
        order: 1,
        position: { x: 0, y: 120 },
        data: { label: "已确认推理", content: "这是已经确权的推理。" },
      },
      {
        id: "confirmed-1:case:1",
        sourceCognitionNodeId: "confirmed-1",
        kind: "CASE",
        type: "caseNode",
        visualRole: "case-evidence",
        order: 2,
        position: { x: 0, y: 240 },
        data: { label: "已确认案例", content: "这是已经确权的案例。" },
      },
      {
        id: "draft-source-1:claim",
        sourceCognitionNodeId: "draft-source-1",
        kind: "CLAIM",
        type: "claimNode",
        visualRole: "claim-primary",
        order: 0,
        position: { x: 200, y: 0 },
        data: {
          label: "草稿观点",
          content: "这是尚未确权的草稿观点。",
          auditStatus: "CONFLICTING",
          isDraft: true,
        },
      },
      {
        id: "draft-source-1:reasoning:1",
        sourceCognitionNodeId: "draft-source-1",
        kind: "REASONING",
        type: "reasoningNode",
        visualRole: "reasoning-path",
        order: 1,
        position: { x: 200, y: 120 },
        data: { label: "草稿推理", content: "这是尚未确权的草稿推理。", isDraft: true },
      },
      {
        id: "draft-source-1:case:1",
        sourceCognitionNodeId: "draft-source-1",
        kind: "CASE",
        type: "caseNode",
        visualRole: "case-evidence",
        order: 1,
        position: { x: 200, y: 240 },
        data: { label: "草稿案例", content: "这是尚未确权的草稿案例。", isDraft: true },
      },
    ],
    edges: [],
  };
}

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/cognition-graph",
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

test("认知图谱将未确权节点渲染为独立的幽灵态", async () => {
  const { CognitionGraphCanvas } = await import(canvasModulePath);
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const graph = mixedGraphFixture();

  try {
    const view = render(
      <CognitionGraphCanvas nodes={graph.nodes} edges={graph.edges} height={500} />,
    );

    await waitFor(() => {
      assert.equal(view.container.querySelectorAll(".react-flow__node").length, 6);
    });

    const draftNodes = view.container.querySelectorAll('[data-is-draft="true"]');
    assert.equal(draftNodes.length, 3);
    draftNodes.forEach(node => {
      assert.match(node.className, /opacity-30/u);
      assert.match(node.className, /border-dashed/u);
      assert.equal(node.getAttribute("data-audit-status"), null);
      assert.equal(node.querySelector('[aria-label="认知冲突"]'), null);
    });

    const confirmedNodes = view.container.querySelectorAll('[data-node-type]:not([data-is-draft="true"])');
    assert.equal(confirmedNodes.length, 3);
    confirmedNodes.forEach(node => assert.doesNotMatch(node.className, /opacity-30/u));
  } finally {
    cleanup();
  }
});
