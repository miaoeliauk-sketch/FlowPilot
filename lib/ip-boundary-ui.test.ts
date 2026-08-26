import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BoundaryAuditPanel } from "../components/ip-boundary/BoundaryAuditPanel";
import {
  BOUNDARY_AUDIT_TIMEOUT_MS,
  BoundaryAuditTimeoutError,
  fetchBoundaryCheckWithTimeout,
} from "./ip-boundary-ui";

test("边界审计请求超过15秒时必须中止并返回明确超时错误", async () => {
  assert.equal(BOUNDARY_AUDIT_TIMEOUT_MS, 15_000);
  const capturedSignal: { current: AbortSignal | null } = { current: null };

  await assert.rejects(
    fetchBoundaryCheckWithTimeout({
      timeoutMs: 10,
      fetcher: async (_url, init) => {
        capturedSignal.current = init?.signal ?? null;
        return new Promise<Response>((_resolve, reject) => {
          capturedSignal.current?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      },
      url: "/api/ip-boundary/check",
      init: { method: "POST" },
    }),
    BoundaryAuditTimeoutError,
  );

  assert.equal(capturedSignal.current?.aborted, true);
});

test("边界审计超时后保持锁定并提供重新审计入口", () => {
  const originalReact = Object.getOwnPropertyDescriptor(globalThis, "React");
  try {
    Object.defineProperty(globalThis, "React", { configurable: true, writable: true, value: React });
    const html = renderToStaticMarkup(React.createElement(BoundaryAuditPanel, {
      status: "timeout",
      report: null,
      evidenceNodes: [],
      message: "审计响应超时，请重新审计。",
      onRetry: () => undefined,
    }));

    assert.match(html, /审计响应超时/);
    assert.match(html, /<button[^>]*>重新审计<\/button>/);
  } finally {
    if (originalReact) Object.defineProperty(globalThis, "React", originalReact);
    else delete (globalThis as Record<string, unknown>).React;
  }
});

test("边界审计进行中使用稳定高度的Skeleton占位", () => {
  const originalReact = Object.getOwnPropertyDescriptor(globalThis, "React");
  try {
    Object.defineProperty(globalThis, "React", { configurable: true, writable: true, value: React });
    const html = renderToStaticMarkup(React.createElement(BoundaryAuditPanel, {
      status: "checking",
      report: null,
      evidenceNodes: [],
    }));

    assert.match(html, /min-h-\[180px\]/);
    assert.match(html, /animate-pulse/);
    assert.match(html, /正在核对IP认知边界/);
  } finally {
    if (originalReact) Object.defineProperty(globalThis, "React", originalReact);
    else delete (globalThis as Record<string, unknown>).React;
  }
});

test("边界审计面板对超长无空格证据启用强制换行保护", () => {
  const originalReact = Object.getOwnPropertyDescriptor(globalThis, "React");
  try {
    Object.defineProperty(globalThis, "React", { configurable: true, writable: true, value: React });
    const longEvidence = "https://example.com/" + "a".repeat(2_000);
    const html = renderToStaticMarkup(React.createElement(BoundaryAuditPanel, {
      status: "ready",
      report: {
        coverage: "FULL",
        stance: "ALIGNED",
        explanation: longEvidence,
        matchedNodeIds: ["node-long"],
        conflictingNodeIds: [],
        supportedParts: ["长文本"],
        missingElements: [],
      },
      evidenceNodes: [{
        nodeId: "node-long",
        relation: "matched",
        verificationStatus: "human_confirmed",
        question: "如何处理长文本？",
        claim: longEvidence,
        reasoningSteps: [longEvidence],
      }],
    }));

    assert.match(html, /break-words/);
    assert.match(html, /\[overflow-wrap:anywhere\]/);
  } finally {
    if (originalReact) Object.defineProperty(globalThis, "React", originalReact);
    else delete (globalThis as Record<string, unknown>).React;
  }
});
