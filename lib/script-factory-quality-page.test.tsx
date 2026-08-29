import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import type { IPProfile } from "./types";

const ZHAO_DONG: IPProfile = {
  id: "ip-zhao-dong",
  name: "赵董",
  avatar: "赵",
  positioning: "商业观察者",
  platforms: ["抖音"],
  audience: "关注消费品牌和商业逻辑的经营者",
  contentDirection: ["商业洞察"],
  personaKeywords: ["直接", "实战"],
  professionalIdentity: "企业经营者",
  personalityTags: ["直率"],
  credibilitySource: "长期企业经营经验",
  representativeViewpoints: ["商业判断要回到真实因果关系"],
  tone: "直接清晰",
  commonOpenings: ["我给你讲明白"],
  commonClosings: ["这才是关键"],
  catchphrases: ["记住"],
  forbiddenExpressions: [],
  pacing: "先判断后解释",
  commonScenes: ["办公室"],
  commonShotTypes: ["正面口播"],
  showsFace: true,
  usesScreenRecording: false,
  needsBroll: false,
  needsCaseScreenshots: false,
  needsSubtitleHighlight: true,
  sampleViralTitles: [],
  styleNotes: "用经营视角解释消费现象",
  bio: "企业经营者",
  color: "#123456",
  createdAt: "2026-08-09T00:00:00.000Z",
  updatedAt: "2026-08-09T00:00:00.000Z",
};

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/script-factory",
    pretendToBeVisual: true,
  });
  const globals: Record<string, unknown> = {
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
  for (const [key, value] of Object.entries(globals)) {
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

function completeResponse() {
  return {
    generationStatus: "complete",
    partialFailure: null,
    ipId: ZHAO_DONG.id,
    ipName: ZHAO_DONG.name,
    topic: "Jellycat为什么能卖出情绪溢价",
    platform: "抖音",
    formatCategory: "short",
    formatLabel: "短视频",
    durationSeconds: 30,
    durationLabel: "30秒",
    goal: "建立信任",
    videoType: "口播",
    outputLabels: {
      cover: "封面文案",
      outline: "口播逐字稿",
      shooting: "拍摄画面建议",
      comment: "评论区引导",
    },
    titles: [{ title: "Jellycat卖的到底是什么", formula: "提问", platform: "抖音", whyFitsIP: "经营视角" }],
    coverCopy: ["情绪价值为什么值钱"],
    outline: [{ label: "核心方法", timeRange: "10-20秒", content: "情绪价值提高了消费者的支付意愿。", subPoints: [] }],
    commentGuidance: {
      interactionPrompt: "你会为情绪价值付费吗？",
      keywordReplies: [],
      dmGuidance: "",
      materialPackGuidance: "",
    },
    ipStyleExplanation: "从经营视角解释定价权。",
    qualityCheck: {
      status: "needs_review",
      warnings: [{
        category: "argument",
        code: "analogy_mechanism_mismatch",
        title: "论证待核对",
        sectionLabel: "核心方法",
        excerpt: "奶茶卖得越多，每杯分摊成本越低",
        message: "该案例说明规模效应，不能直接支持情绪溢价带来的定价权。",
      }],
    },
    storyboard: [],
    shootingSuggestions: [],
    shotPrompts: [],
    editingRhythm: {
      subtitleHighlights: [],
      soundEffects: [],
      screenRecordingCuts: [],
      caseInserts: [],
      pauses: [],
    },
    apiMeta: {
      apiCalled: true,
      calledAt: "2026-08-09T00:00:00.000Z",
      model: "deepseek-v4-flash",
      ipUsed: ZHAO_DONG.name,
      mockHit: false,
    },
    globalConstraintReview: {
      reviewRequired: false,
      detectionMode: "keyword",
      semanticAssessment: "not_implemented",
      matches: [],
      source: "server_ledger",
    },
  };
}

let restoreBrowser: (() => void) | undefined;

before(() => {
  restoreBrowser = installBrowserEnvironment();
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([ZHAO_DONG]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(ZHAO_DONG.id));
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

test("脚本工厂非阻断展示论证待核对提示并保留生成结果", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/script-factory") {
      return new Response(JSON.stringify(completeResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(
      <IPProvider>
        <ScriptFactoryPage />
      </IPProvider>,
    );

    await user.click(view.getByRole("button", { name: "IP专属生成" }));
    const topicInput = view.container.querySelector("textarea") as HTMLTextAreaElement;
    await user.type(topicInput, "Jellycat为什么能卖出情绪溢价");
    await user.click(view.getByRole("button", { name: "生成IP专属内容" }));

    assert.ok(await view.findByText(/论证待核对/));
    assert.ok(view.getByText(/规模效应，不能直接支持情绪溢价带来的定价权/));
    assert.ok(view.getByText("情绪价值提高了消费者的支付意愿。"));
    assert.ok(view.getByText(/脚本仍可继续查看和使用/));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
