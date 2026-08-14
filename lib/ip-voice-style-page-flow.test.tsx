import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import type { IPProfile, IPStyleProfile, KnowledgeEntry } from "./types";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/ip",
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

function ipProfile(id: string, name: string): IPProfile {
  return {
    id,
    name,
    avatar: name.slice(0, 1),
    positioning: "",
    platforms: [],
    audience: "",
    contentDirection: [],
    personaKeywords: [],
    professionalIdentity: "",
    personalityTags: [],
    credibilitySource: "",
    representativeViewpoints: [],
    tone: "",
    commonOpenings: [],
    commonClosings: [],
    catchphrases: [],
    forbiddenExpressions: [],
    pacing: "",
    commonScenes: [],
    commonShotTypes: [],
    showsFace: true,
    usesScreenRecording: false,
    needsBroll: false,
    needsCaseScreenshots: false,
    needsSubtitleHighlight: false,
    sampleViralTitles: [],
    styleNotes: "",
    bio: "",
    color: "#639922",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };
}

function voiceEntry(id: string, title: string, ipId: string, order: number): KnowledgeEntry {
  return {
    id,
    category: "IP语料库",
    title,
    rawContent: `${title}的完整口播正文`,
    tags: ["口播逐字稿"],
    keywords: [],
    ipId,
    sourceTier: "高",
    sourceTierReason: "测试语料",
    contentDirection: [],
    sourcePlatform: "测试",
    sourceUrl: "",
    note: "",
    createdAt: `2026-08-14T00:00:0${order}.000Z`,
    extractedAt: null,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
  };
}

function styleProfile(ipId: string, summary: string, sampleId: string): IPStyleProfile {
  return {
    ipId,
    openingHabits: ["先抛判断", "用问题引入", "从场景切入"],
    viewpointStyle: "先给结论，再解释原因。",
    sentenceLength: "长短句结合",
    emotionalTone: ["犀利", "克制"],
    commonPhrases: ["真正的问题是", "换句话说", "仔细想想", "所以", "你会发现"],
    closingHabits: ["回到行动", "用判断收束", "留下反问"],
    forbiddenExpressions: ["空洞口号", "过度书面语", "绝对化承诺"],
    styleSummary: summary,
    sourceSampleIds: [sampleId],
    sourceSampleTitles: ["原样本"],
    extractedAt: "2026-08-14T00:00:00.000Z",
    model: "deepseek-v4-flash",
  };
}

const IP_A = ipProfile("ip-a", "IP A");
const IP_B = ipProfile("ip-b", "IP B");
let restoreBrowser: (() => void) | undefined;

before(() => {
  restoreBrowser = installBrowserEnvironment();
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([IP_A, IP_B]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(IP_A.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  localStorage.setItem("ipwr:voiceSamplesMigrated", JSON.stringify(true));
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

test("IP A只发送勾选的本IP样本并只保存自己的画像，分析期间锁定样本增删", async () => {
  const aEntries = Array.from({ length: 6 }, (_, index) => (
    voiceEntry(`a-${index + 1}`, `A样本${index + 1}`, IP_A.id, index + 1)
  ));
  const bEntry = voiceEntry("b-1", "B私有样本", IP_B.id, 7);
  const originalBProfile = styleProfile(IP_B.id, "IP B原画像", bEntry.id);
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([...aEntries, bEntry]));
  localStorage.setItem("ipwr:ipStyleProfiles", JSON.stringify([originalBProfile]));

  let resolveRequest: ((response: Response) => void) | undefined;
  let requestedSamples: Array<{ id: string; title: string; rawText: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input) !== "/api/voice-style-extract") {
      return new Response(JSON.stringify({}), { status: 200 });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      samples?: Array<{ id: string; title: string; rawText: string }>;
    };
    requestedSamples = body.samples ?? [];
    return new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
  };

  try {
    const { act, render, waitFor } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const IPPage = (await import("../app/ip/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><IPPage /></IPProvider>);

    const sampleLibraryButtons = await view.findAllByTitle("口播逐字稿样本库");
    await user.click(sampleLibraryButtons[0]);
    assert.ok(await view.findByText("A样本1"));
    assert.equal(Boolean(view.queryByText("B私有样本")), false);

    await user.click(view.getByRole("button", { name: "选择A样本1" }));
    assert.ok(view.getByText("一次最多选择5篇样本"));
    await user.click(view.getByRole("button", { name: "取消选择A样本2" }));
    await user.click(view.getByRole("button", { name: "选择A样本1" }));
    await user.click(view.getByRole("button", { name: "学习风格" }));

    await waitFor(() => assert.equal(requestedSamples.length, 5));
    assert.deepEqual(
      requestedSamples.map((sample) => sample.id),
      ["a-6", "a-5", "a-4", "a-3", "a-1"],
    );
    assert.equal(requestedSamples.some((sample) => sample.id === bEntry.id), false);
    assert.equal(view.getByRole("button", { name: "添加样本" }).hasAttribute("disabled"), true);
    assert.equal(view.getByRole("button", { name: "删除A样本1" }).hasAttribute("disabled"), true);

    const responseProfile = styleProfile(IP_A.id, "IP A新画像", "a-6");
    await act(async () => {
      assert.ok(resolveRequest);
      resolveRequest(new Response(JSON.stringify({
        ...responseProfile,
        sourceSampleIds: requestedSamples.map((sample) => sample.id),
        sourceSampleTitles: requestedSamples.map((sample) => sample.title),
        apiMeta: {
          apiCalled: true,
          calledAt: "2026-08-14T00:00:00.000Z",
          model: "deepseek-v4-flash",
          ipUsed: IP_A.name,
          mockHit: false,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
      await Promise.resolve();
    });

    assert.ok(await view.findByText("IP A新画像"));
    const savedProfiles = JSON.parse(localStorage.getItem("ipwr:ipStyleProfiles") ?? "[]") as IPStyleProfile[];
    assert.deepEqual(savedProfiles.find((profile) => profile.ipId === IP_A.id)?.sourceSampleIds, [
      "a-6", "a-5", "a-4", "a-3", "a-1",
    ]);
    assert.deepEqual(savedProfiles.find((profile) => profile.ipId === IP_B.id), originalBProfile);
    const savedEntries = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as KnowledgeEntry[];
    assert.deepEqual(savedEntries.find((entry) => entry.id === bEntry.id), bEntry);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("浏览器拒绝写入时页面明确提示保存失败且不展示假成功画像", async () => {
  const entry = voiceEntry("a-only", "A唯一样本", IP_A.id, 1);
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([entry]));
  const generatedProfile = styleProfile(IP_A.id, "不应展示的假成功画像", entry.id);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ...generatedProfile,
    sourceSampleIds: [entry.id],
    sourceSampleTitles: [entry.title],
    apiMeta: {
      apiCalled: true,
      calledAt: "2026-08-14T00:00:00.000Z",
      model: "deepseek-v4-flash",
      ipUsed: IP_A.name,
      mockHit: false,
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
  const originalSetItem = storagePrototype.setItem;
  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const IPPage = (await import("../app/ip/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><IPPage /></IPProvider>);

    const sampleLibraryButtons = await view.findAllByTitle("口播逐字稿样本库");
    await user.click(sampleLibraryButtons[0]);
    storagePrototype.setItem = function setItem(key: string, value: string) {
      if (key === "ipwr:ipStyleProfiles") throw new Error("模拟浏览器拒绝写入");
      return originalSetItem.call(this, key, value);
    };
    await user.click(view.getByRole("button", { name: "学习风格" }));

    assert.ok(await view.findByText(/语气画像保存失败/));
    assert.equal(Boolean(view.queryByText("不应展示的假成功画像")), false);
    assert.equal(localStorage.getItem("ipwr:ipStyleProfiles"), null);
  } finally {
    storagePrototype.setItem = originalSetItem;
    globalThis.fetch = originalFetch;
  }
});
