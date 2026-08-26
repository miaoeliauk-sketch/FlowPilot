import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import type { InterviewCandidateNode } from "./ip-boundary-interview";
import { buildIPSourceAnalysisV2 } from "./ip-source-analysis-v2";

const interviewPanelModulePath = "../components/ip-boundary/InterviewPanel";
const extractionAuditModulePath = "../components/ip-boundary/InterviewExtractionAudit";

function candidateNode(claim = "停止学习是为了消化已经掌握的知识。"): InterviewCandidateNode {
  return {
    sourceId: "interview-source-1",
    node: {
      id: "node-interview-1",
      question: {
        content: "什么时候应该停止学习新知识？",
        derivation: "inferred",
        anchors: [{ quote: claim, startPosition: 0, endPosition: claim.length }],
      },
      claim: {
        content: claim,
        anchors: [{ quote: claim, startPosition: 0, endPosition: claim.length }],
      },
      reasoning: { status: "not_provided", steps: [] },
      evidence: [],
      concepts: [],
      reviewStatus: "ai_extracted",
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

test("人工微调候选观点时同步修订内容但保留AI原文与锚点", async () => {
  const { InterviewExtractionAudit } = await import(extractionAuditModulePath);
  const { cleanup, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const user = userEvent.setup({ document });
  const original = candidateNode();
  const changes: InterviewCandidateNode[][] = [];

  try {
    const view = render(React.createElement(InterviewExtractionAudit, {
      candidates: [original],
      existingClaims: [],
      onChange: (next: InterviewCandidateNode[]) => changes.push(next),
      onLongTermConfirm: () => undefined,
    }));
    const textarea = view.getByRole("textbox", { name: "候选观点" });
    await user.clear(textarea);
    await user.type(textarea, "停止输入，是为了真正消化已有知识。");

    assert.equal((textarea as HTMLTextAreaElement).value, "停止输入，是为了真正消化已有知识。");
    const latest = changes.at(-1)?.[0]?.node;
    assert.equal(latest?.humanRevision?.claim, "停止输入，是为了真正消化已有知识。");
    assert.equal(latest?.claim.content, original.node.claim.content, "人工微调不能覆盖AI原始观点");
    assert.deepEqual(latest?.claim.anchors, original.node.claim.anchors, "人工微调不能覆盖原文锚点");
  } finally {
    cleanup();
  }
});

test("删除全部候选后物理禁用长期入库", async () => {
  const { InterviewExtractionAudit } = await import(extractionAuditModulePath);
  const { cleanup, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const user = userEvent.setup({ document });
  const changes: InterviewCandidateNode[][] = [];

  try {
    const view = render(React.createElement(InterviewExtractionAudit, {
      candidates: [candidateNode()],
      existingClaims: [],
      onChange: (next: InterviewCandidateNode[]) => changes.push(next),
      onLongTermConfirm: () => undefined,
    }));

    await user.click(view.getByRole("button", { name: "删除候选" }));

    assert.deepEqual(changes.at(-1), []);
    assert.equal(
      (view.getByRole("button", { name: "长期入库并重新审计" }) as HTMLButtonElement).disabled,
      true,
    );
  } finally {
    cleanup();
  }
});

test("候选观点与存量认知高度相似时显示黄色疑似重复预警", async () => {
  const { InterviewExtractionAudit } = await import(extractionAuditModulePath);
  const { cleanup, render } = await import("@testing-library/react");

  try {
    const view = render(React.createElement(InterviewExtractionAudit, {
      candidates: [candidateNode("持续输出不等于机械日更。")],
      existingClaims: [{ nodeId: "existing-node-1", content: "持续输出不等于机械日更" }],
      onChange: () => undefined,
      onLongTermConfirm: () => undefined,
    }));

    const warning = view.getByText("与已有认知高度相似，请核对是否重复。");
    assert.equal(warning.getAttribute("data-warning"), "similar");
    assert.match(warning.className, /bg-\[#FFF7D6\]/u);
  } finally {
    cleanup();
  }
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

test("提交访谈回答后保留完整问答并进入候选认知待预审状态", async () => {
  const originalFetch = globalThis.fetch;
  const capturedRequest: { current: unknown } = { current: null };
  const answer = "我认为停止学习能消化知识，因为大脑需要空白期。";
  const analysis = buildIPSourceAnalysisV2({
    sourceId: "interview-source-1",
    sourceContent: answer,
    analyzedAt: "2026-08-26T12:00:00.000Z",
    createId: () => "00000000-0000-4000-8000-000000000401",
    candidate: {
      nodes: [{
        nodeRef: "N1",
        question: {
          content: "为什么停止学习能帮助消化知识？",
          derivation: "inferred",
          anchors: [{ quote: answer }],
        },
        claim: {
          content: "停止学习能消化知识。",
          anchors: [{ quote: "停止学习能消化知识" }],
        },
        reasoning: {
          status: "complete",
          steps: [{
            order: 1,
            content: "大脑需要空白期。",
            anchors: [{ quote: "大脑需要空白期" }],
          }],
        },
        evidence: [],
        concepts: [],
      }],
      aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
    },
  });
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "/api/ip-boundary/interview/extract");
      capturedRequest.current = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        source: {
          id: "interview-source-1",
          ipId: "ip-submit",
          topicId: "topic-submit",
          interviewId: "interview-submit-v1",
          rawInteraction: [{
            questionId: "question-claim",
            question: "老师，关于这个话题，您的核心主张是什么？",
            answer,
          }],
          timestamp: "2026-08-26T12:00:00.000Z",
        },
        analysis,
        analysisToken: "valid-mock-analysis-token-v1",
        candidates: analysis.nodes.map(node => ({ sourceId: analysis.sourceId, node })),
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
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
    const view = render(React.createElement(InterviewPanel, {
      activeIPId: "ip-submit",
      topicId: "topic-submit",
      interviewId: "interview-submit-v1",
      questions: [question],
    }));

    await user.type(
      view.getByRole("textbox", { name: "访谈回答" }),
      answer,
    );
    await user.click(view.getByRole("button", { name: "提交回答并提取认知" }));

    assert.ok(await view.findByText("已提取1个候选认知节点，等待人工预审。"));
    assert.equal(
      (view.getByRole("textbox", { name: "候选观点" }) as HTMLTextAreaElement).value,
      analysis.nodes[0]?.claim.content,
    );
    assert.ok(isRecord(capturedRequest.current));
    assert.equal(capturedRequest.current.activeIPId, "ip-submit");
    assert.equal(capturedRequest.current.topicId, "topic-submit");
    assert.equal(capturedRequest.current.interviewId, "interview-submit-v1");
    assert.deepEqual(capturedRequest.current.rawInteraction, [{
      questionId: "question-claim",
      question: "老师，关于这个话题，您的核心主张是什么？",
      answer,
    }]);
    cleanup();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
