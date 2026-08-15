import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { addKnowledgeEntry, getKnowledgeEntries } from "./ip-store";
import { createValidTopicBoardResult } from "./topic-board-contract.fixture";
import type { IPProfile } from "./types";

const ACTIVE_IP: IPProfile = {
  id: "ip-knowledge-lifecycle",
  name: "水木然",
  avatar: "水",
  positioning: "商业认知作者",
  platforms: ["视频号"],
  audience: "关注商业趋势和个人成长的人",
  contentDirection: ["商业洞察"],
  personaKeywords: ["理性"],
  professionalIdentity: "商业作者",
  personalityTags: ["克制"],
  credibilitySource: "长期公开写作",
  representativeViewpoints: ["认知决定行动质量"],
  tone: "理性克制",
  commonOpenings: [],
  commonClosings: [],
  catchphrases: [],
  forbiddenExpressions: [],
  pacing: "层层递进",
  commonScenes: ["书房"],
  commonShotTypes: ["正面口播"],
  showsFace: true,
  usesScreenRecording: false,
  needsBroll: true,
  needsCaseScreenshots: false,
  needsSubtitleHighlight: true,
  sampleViralTitles: [],
  styleNotes: "商业趋势",
  bio: "商业认知作者",
  color: "#123456",
  createdAt: "2026-08-15T00:00:00.000Z",
  updatedAt: "2026-08-15T00:00:00.000Z",
};

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

test("知识真正参与董事会评审并保存成功后才写入使用记录", { timeout: 10000 }, async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;

  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([ACTIVE_IP]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(ACTIVE_IP.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));

    const topic = "高净值客户如何判断一个机会";
    const knowledge = addKnowledgeEntry({
      category: "选题方法库",
      title: topic,
      rawContent: "判断机会时，要先确认它是否适合当前阶段。",
      tags: ["机会"],
      keywords: ["机会", "判断"],
      ipId: ACTIVE_IP.id,
      sourceTier: "高",
      sourceTierReason: "页面流程测试",
      contentDirection: [],
      sourcePlatform: "测试",
      sourceUrl: "",
      note: "",
      extractedAt: "2026-08-15T00:00:00.000Z",
      metrics: null,
      viralEvaluation: null,
      usageRecords: [],
      status: "未使用",
      dna: null,
    });

    globalThis.fetch = async input => {
      if (String(input) === "/api/knowledge-search") {
        return new Response(JSON.stringify({ results: [], debug: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      const result = createValidTopicBoardResult();
      result.topic = topic;
      result.ipId = ACTIVE_IP.id;
      result.ipName = ACTIVE_IP.name;
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const { cleanup, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const user = userEvent.setup({ document });
    const page = render(
      <IPProvider>
        <TopicBoardPage />
      </IPProvider>,
    );

    const topicInput = page.getByRole("textbox");
    await user.clear(topicInput);
    await user.type(topicInput, topic);
    await user.click(page.getByRole("button", { name: "召开董事会" }));
    await page.findByText(`评估已保存到${ACTIVE_IP.name}的选题库。`, {}, { timeout: 7000 });

    const stored = getKnowledgeEntries().find(entry => entry.id === knowledge.id);
    assert.equal(stored?.usageRecords.length, 1);
    assert.equal(stored?.usageRecords[0]?.module, "选题董事会");
    assert.equal(stored?.usageRecords[0]?.context, topic);
    assert.equal(stored?.status, "已用于选题");
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});
