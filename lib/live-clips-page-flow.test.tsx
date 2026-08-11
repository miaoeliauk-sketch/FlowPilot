import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { LIVE_CLIP_STORAGE_KEY, type LiveClipWorkspaceState } from "./live-clips-types";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/live-clips", pretendToBeVisual: true });
  const globals: Record<string, unknown> = {
    window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true, React,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { configurable: true, value: dom.window.crypto });
  return () => {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  };
}

const ip = {
  id: "ip-pengpeng", name: "彭彭说AI", avatar: "彭", positioning: "AI内容创作者",
  platforms: ["抖音", "小红书"], audience: "AI新手", contentDirection: ["AI工具"],
  personaKeywords: [], professionalIdentity: "AI创作者", personalityTags: [], credibilitySource: "实测",
  representativeViewpoints: [], tone: "真诚", commonOpenings: [], commonClosings: [], catchphrases: [],
  forbiddenExpressions: [], pacing: "自然", commonScenes: [], commonShotTypes: [], showsFace: true,
  usesScreenRecording: true, needsBroll: false, needsCaseScreenshots: false, needsSubtitleHighlight: true,
  sampleViralTitles: [], styleNotes: "", bio: "", color: "#7C6EE6",
  createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z",
};

test("用户导入无时间逐字稿后先保存原文，再进入AI分析且不生成时间", async () => {
  const restore = installBrowserEnvironment();
  let cleanupPage: (() => void) | undefined;
  try {
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
    const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { IPProvider } = await import("./ip-context");
    const { default: LiveClipsPage } = await import("../app/live-clips/page");
    const view = render(<IPProvider><LiveClipsPage /></IPProvider>);

    await waitFor(() => assert.ok(view.getByText("彭彭说AI")));
    fireEvent.change(view.getByLabelText("直播名称"), { target: { value: "8月10日直播" } });
    fireEvent.change(view.getByLabelText("直播逐字稿"), {
      target: {
        value: "很多人做账号的时候，第一反应是追求爆款。\n但在账号冷启动阶段，更重要的是把内容定位讲清楚。\n定位决定你长期为谁解决什么问题，也决定用户为什么持续关注你。",
      },
    });
    fireEvent.click(view.getByRole("button", { name: "保存并进入AI分析" }));

    await waitFor(() => assert.ok(view.getByText("原始逐字稿未包含时间信息，无法提供准确剪辑时间。")));
    const state = JSON.parse(localStorage.getItem(LIVE_CLIP_STORAGE_KEY) || "{}") as LiveClipWorkspaceState;
    assert.equal(state.liveTranscripts[0].rawTranscript.includes("第一反应是追求爆款"), true);
    assert.equal(state.liveTranscripts[0].hasTimecode, false);
    assert.ok(state.liveTranscripts[0].paragraphs.every(paragraph => paragraph.startTime === null && paragraph.endTime === null));
    assert.ok(state.transcriptChunks.length > 0);
  } finally {
    cleanupPage?.();
    restore();
  }
});

test("AI按主题生成切片卡后，只有用户勾选的候选进入正式方案", async () => {
  const restore = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;
  try {
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      if (url.includes("/api/live-clips/topics")) {
        return Response.json({
          removalSuggestions: [{ paragraphNumber: 1, quote: "大家能听到吗？", reason: "临时互动" }],
          topics: [{
            id: "topic-1", liveTranscriptId: requestBody.liveTranscriptId, title: "知识付费内容建立什么信任",
            summary: "讨论知识量和解决问题能力的区别。", startTime: "00:01:08", endTime: "00:01:38",
            startParagraph: 2, endParagraph: 4, keywords: ["知识付费", "信任"], mainPoint: "用户购买解决问题的能力。",
            sourceChunkIds: [requestBody.chunk.id], candidateStatus: "pending", candidateError: null,
            createdAt: "2026-08-11T00:00:00.000Z",
          }],
        });
      }
      if (url.includes("/api/live-clips/candidates")) {
        return Response.json({ candidates: [{
          id: "candidate-1", liveTranscriptId: requestBody.liveTranscriptId, topicBlockId: "topic-1",
          topic: "为什么知识付费不能只证明懂得多", clipType: "counterintuitive", secondaryTags: ["opinion"],
          recommendation: "强烈建议切", dimensions: {
            completeness: "强", hookStrength: "强", pointClarity: "强", informationDensity: "强", tension: "中", ipFit: "强",
          },
          recommendReason: "观点完整，有清晰反差。", startTime: "00:01:08", endTime: "00:01:38",
          startParagraph: 2, endParagraph: 4, estimatedDurationSeconds: 30, durationBasis: "actual",
          corePoint: "用户购买的是解决问题的能力。", startQuote: "知识付费最大的误区", endQuote: "解决问题的信任。",
          rawClipText: "知识付费最大的误区，就是天天证明自己懂得多。\n用户真正购买的是解决具体问题的能力。\n所以内容建立的不是知识量，而是解决问题的信任。",
          cleanedClipText: "知识付费最大的误区，证明自己懂得多。\n用户真正购买的是解决具体问题的能力。\n所以内容建立的不是知识量，而是解决问题的信任。",
          removeSuggestions: [{ paragraphNumber: 2, quote: "就是天天", reason: "口语冗余", startTime: "00:01:08", endTime: "00:01:18" }],
          titleSuggestions: ["知识付费别只讲干货", "用户为什么付费", "内容要建立什么信任"],
          coverSuggestions: ["别再证明你懂得多", "用户买的是解决问题"], createdAt: "2026-08-11T00:00:00.000Z",
        }] });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { IPProvider } = await import("./ip-context");
    const { default: LiveClipsPage } = await import("../app/live-clips/page");
    const view = render(<IPProvider><LiveClipsPage /></IPProvider>);
    await waitFor(() => assert.ok(view.getByText("彭彭说AI")));
    fireEvent.change(view.getByLabelText("直播名称"), { target: { value: "知识付费直播" } });
    fireEvent.change(view.getByLabelText("直播逐字稿"), { target: { value: [
      "[00:01:00] 大家能听到吗？",
      "[00:01:08] 知识付费最大的误区，就是天天证明自己懂得多。",
      "[00:01:18] 用户真正购买的是解决具体问题的能力。",
      "[00:01:28] 所以内容建立的不是知识量，而是解决问题的信任。",
      "[00:01:38] 下一段我们讲产品和服务如何设计。",
    ].join("\n") } });
    fireEvent.click(view.getByRole("button", { name: "保存并进入AI分析" }));
    fireEvent.click(await view.findByRole("button", { name: "开始AI分析" }));

    await waitFor(() => assert.ok(view.getByText("为什么知识付费不能只证明懂得多")));
    assert.ok(view.getByText("00:01:08 → 00:01:38"));
    fireEvent.click(view.getByRole("checkbox", { name: "选择切片：为什么知识付费不能只证明懂得多" }));
    fireEvent.click(view.getByRole("button", { name: "生成切片方案" }));
    await waitFor(() => assert.ok(view.getByText("已生成1条正式切片方案")));

    const state = JSON.parse(localStorage.getItem(LIVE_CLIP_STORAGE_KEY) || "{}") as LiveClipWorkspaceState;
    assert.equal(state.clipCandidates.length, 1);
    assert.equal(state.clipPlans.length, 1);
    assert.equal(state.clipPlans[0].clipCandidateId, "candidate-1");
    assert.equal(state.clipPlans[0].userAccepted, true);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("本地直播切片数据损坏时页面进入保护状态且不允许覆盖", async () => {
  const restore = installBrowserEnvironment();
  let cleanupPage: (() => void) | undefined;
  try {
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([ip]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(ip.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
    localStorage.setItem(LIVE_CLIP_STORAGE_KEY, "{broken");
    const { cleanup, render, waitFor } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { IPProvider } = await import("./ip-context");
    const { default: LiveClipsPage } = await import("../app/live-clips/page");
    const view = render(<IPProvider><LiveClipsPage /></IPProvider>);

    await waitFor(() => assert.ok(view.getByRole("alert").textContent?.includes("已停止读取")));
    assert.equal((view.getByRole("button", { name: "保存并进入AI分析" }) as HTMLButtonElement).disabled, true);
    assert.equal(localStorage.getItem(LIVE_CLIP_STORAGE_KEY), "{broken");
  } finally {
    cleanupPage?.();
    restore();
  }
});
