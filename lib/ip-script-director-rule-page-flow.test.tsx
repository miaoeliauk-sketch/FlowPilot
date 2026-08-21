import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";

import { createScriptDirectorRule } from "./script-director-rule";
import { getScriptDirectorRules } from "./script-director-rule-store";
import type { IPProfile } from "./types";

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
    File: dom.window.File,
    FileReader: dom.window.FileReader,
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
    positioning: "AI内容创作",
    platforms: ["抖音"],
    audience: "AI内容创作者",
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
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
}

const IP_A = ipProfile("ip-a", "IP A");
const IP_B = ipProfile("ip-b", "IP B");
let restoreBrowser: (() => void) | undefined;

interface CapturedDirectorRuleRequest {
  ipProfile: {
    id: string;
  };
  rawMarkdown: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCapturedDirectorRuleRequest(body: string): CapturedDirectorRuleRequest {
  const parsed: unknown = JSON.parse(body);
  if (!isRecord(parsed) || !isRecord(parsed.ipProfile) || typeof parsed.ipProfile.id !== "string") {
    throw new Error("测试未捕获到合法的专属编导规则请求");
  }
  if (typeof parsed.rawMarkdown !== "string") {
    throw new Error("测试未捕获到完整的规则原文");
  }
  return { ipProfile: { id: parsed.ipProfile.id }, rawMarkdown: parsed.rawMarkdown };
}

before(() => { restoreBrowser = installBrowserEnvironment(); });
beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([IP_A, IP_B]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(IP_A.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
});
afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
});
after(() => { restoreBrowser?.(); });

async function previewRule(rawMarkdown: string, protectedEntities = ["示例人物"]) {
  const item = (id: string, text: string, scope: "opening" | "body" | "ending" | "compression" | "output") => ({
    id,
    text,
    level: "quality_warning" as const,
    enforcement: "deterministic" as const,
    scope,
  });
  return createScriptDirectorRule({
    ipId: IP_A.id,
    name: `${IP_A.name}专属编导规则`,
    version: "1.0.0",
    rawMarkdown,
    fileName: null,
    importedAt: "2026-08-21T12:00:00.000Z",
    profileContext: {
      ipNameSnapshot: IP_A.name,
      source: "ip_profile",
      usePlatformPositioningFromProfile: true,
    },
    targetAudience: [IP_A.audience],
    language: {
      catchphrases: [item("catchphrase-1", "明白吗？", "body")],
      forbiddenExpressions: [item("forbidden-1", "禁止空泛开场", "opening")],
      toneGuidelines: [item("tone-1", "表达犀利直接", "body")],
    },
    opening: {
      requirements: [item("opening-1", "先否定大众答案", "opening")],
      forbiddenPatterns: [item("opening-forbidden-1", "不能从背景介绍开始", "opening")],
    },
    body: {
      reasoningSequence: [item("reasoning-1", "从现象推演到规律", "body")],
      casePolicy: {
        maximumCasesPerClaim: 2,
        level: "quality_warning",
        enforcement: "deterministic",
        scope: "body",
        requirements: [item("case-1", "每个观点最多使用两个案例", "body")],
      },
      materialPolicies: [item("material-1", "格式范例不能进入素材池", "body")],
    },
    ending: {
      requirements: [item("ending-1", "结尾必须回扣标题悬念", "ending")],
      forbiddenPatterns: [item("ending-forbidden-1", "不能使用通用鼓励语", "ending")],
    },
    examples: [{
      id: "example-1",
      kind: "opening",
      content: "真正的问题，不是你看到的表象。",
      demonstrates: "直接判断式开头",
      sourceReference: "导入文档第六节",
      confirmationStatus: "confirmed",
      materialPermission: false,
      protectedEntities,
    }],
    compression: {
      enabled: true,
      targetReduction: {
        minimumPercent: 20,
        maximumPercent: 30,
        level: "quality_warning",
        enforcement: "deterministic",
        scope: "compression",
      },
      mustKeep: [item("keep-1", "保留核心案例", "compression")],
      preferRemove: [item("remove-1", "删除重复表达", "compression")],
      otherRequirements: [item("compression-1", "压缩后保持因果链完整", "compression")],
    },
    specialRules: [item("special-1", "本规则优先于通用风格", "output")],
    validationRequirements: [item("validation-1", "输出前核对全部禁用表达", "output")],
  });
}

test("用户确认完整解析预览后才保存原始规则并可启用和停用", async () => {
  const rawMarkdown = " \n# IP A专属编导规则\n\n开头必须直接进入判断。\n ";
  const parsedRule = await previewRule(rawMarkdown);
  const originalFetch = globalThis.fetch;
  const capturedRequests: CapturedDirectorRuleRequest[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) !== "/api/script-director-rule/parse") {
      return new Response(JSON.stringify({}), { status: 200 });
    }
    capturedRequests.push(parseCapturedDirectorRuleRequest(String(init?.body)));
    return new Response(JSON.stringify({
      rule: parsedRule,
      apiMeta: { apiCalled: true, attempts: 1 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const IPPage = (await import("../app/ip/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><IPPage /></IPProvider>);

    const ruleButtons = await view.findAllByTitle("专属编导规则");
    await user.click(ruleButtons[0]);
    await user.type(view.getByLabelText("规则文档内容"), rawMarkdown);
    await user.click(view.getByRole("button", { name: "AI解析并预览" }));

    assert.ok(await view.findByText("解析预览"));
    assert.equal(getScriptDirectorRules(IP_A.id).length, 0);
    assert.equal(getScriptDirectorRules(IP_B.id).length, 0);
    assert.equal(capturedRequests[0]?.ipProfile.id, IP_A.id);
    assert.equal(capturedRequests[0]?.rawMarkdown, rawMarkdown);
    assert.ok(view.getByText("常用口头禅"));
    assert.ok(view.getByText("禁用表达"));
    assert.ok(view.getByText("语气基调"));
    assert.ok(view.getByText("案例数量限制：每个观点最多2个"));
    assert.ok(view.getByText("压缩目标：精简20%至30%"));
    assert.ok(view.getAllByText("质量提醒").length > 0);
    assert.ok(view.getAllByText("程序检查").length > 0);
    assert.ok(view.getAllByText("作用范围：正文（body）").length > 0);
    assert.ok(view.getAllByText("作用范围：压缩（compression）").length > 0);
    assert.ok(view.getByText("特别说明"));
    assert.ok(view.getByText("生成前检查"));
    assert.ok(view.getByText(/来源：导入文档第六节/));

    await user.click(view.getByRole("button", { name: "确认并保存规则" }));
    assert.ok(await view.findByText("规则已保存，启用后才会参与脚本生成"));
    assert.equal(getScriptDirectorRules(IP_A.id).length, 1);
    assert.equal(getScriptDirectorRules(IP_B.id).length, 0);
    assert.equal(getScriptDirectorRules(IP_A.id)[0]?.source.rawMarkdown, rawMarkdown);

    await user.click(view.getByRole("button", { name: "启用规则" }));
    assert.ok(await view.findByText("已启用"));
    assert.equal(getScriptDirectorRules(IP_A.id)[0]?.status, "active");

    await user.click(view.getByRole("button", { name: "停用规则" }));
    assert.ok(await view.findByText("未启用"));
    assert.equal(getScriptDirectorRules(IP_A.id)[0]?.status, "inactive");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("用户可以上传Markdown规则文档并在解析前检查原文", async () => {
  const { render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const IPPage = (await import("../app/ip/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<IPProvider><IPPage /></IPProvider>);

  const ruleButtons = await view.findAllByTitle("专属编导规则");
  await user.click(ruleButtons[0]);
  const file = new File(["# 上传规则\n\n禁止使用空泛结尾。"], "IP-A-rule.md", { type: "text/markdown" });
  await user.upload(view.getByLabelText("上传规则文档"), file);

  await waitFor(() => assert.equal(
    (view.getByLabelText("规则文档内容") as HTMLTextAreaElement).value,
    "# 上传规则\n\n禁止使用空泛结尾。",
  ));
  assert.ok(view.getByText(/IP-A-rule\.md/));
});

test("超大规则文件在读取到内存前被拒绝", async () => {
  const originalFileReader = Object.getOwnPropertyDescriptor(globalThis, "FileReader");
  let readerCreated = false;
  Object.defineProperty(globalThis, "FileReader", {
    configurable: true,
    writable: true,
    value: class {
      constructor() {
        readerCreated = true;
        throw new Error("超大文件不应创建FileReader");
      }
    },
  });

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const IPPage = (await import("../app/ip/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><IPPage /></IPProvider>);

    const ruleButtons = await view.findAllByTitle("专属编导规则");
    await user.click(ruleButtons[0]);
    const oversizedFile = new File([new Uint8Array(200_001)], "oversized-rule.md", { type: "text/markdown" });
    await user.upload(view.getByLabelText("上传规则文档"), oversizedFile);

    assert.ok(await view.findByText("规则文档文件过大，请控制在200KB以内"));
    assert.equal(readerCreated, false);
    assert.equal((view.getByLabelText("规则文档内容") as HTMLTextAreaElement).value, "");
  } finally {
    if (originalFileReader) Object.defineProperty(globalThis, "FileReader", originalFileReader);
  }
});

test("具体名称出现2次时明确提醒但用户仍可保存", async () => {
  const rawMarkdown = "胖东来只用于标题格式。胖东来不是本次创作素材。";
  const parsedRule = await previewRule(rawMarkdown, ["胖东来"]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    rule: parsedRule,
    apiMeta: { apiCalled: true, attempts: 1 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const { fireEvent, render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const IPPage = (await import("../app/ip/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><IPPage /></IPProvider>);

    const ruleButtons = await view.findAllByTitle("专属编导规则");
    await user.click(ruleButtons[0]);
    fireEvent.change(view.getByLabelText("规则文档内容"), { target: { value: rawMarkdown } });
    await user.click(view.getByRole("button", { name: "AI解析并预览" }));

    assert.ok(await view.findByText("示例名称使用提醒"));
    assert.ok(view.getByText("胖东来出现2次，可能让AI误把范例当成默认素材"));
    await user.click(view.getByRole("button", { name: "确认并保存规则" }));
    assert.equal(getScriptDirectorRules(IP_A.id).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("具体名称出现超过3次时明确说明原因并禁止保存", async () => {
  const rawMarkdown = "胖东来演示标题。胖东来演示开头。胖东来演示正文。胖东来不是本次创作素材。";
  const parsedRule = await previewRule(rawMarkdown, ["胖东来"]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    rule: parsedRule,
    apiMeta: { apiCalled: true, attempts: 1 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const { fireEvent, render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const IPPage = (await import("../app/ip/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><IPPage /></IPProvider>);

    const ruleButtons = await view.findAllByTitle("专属编导规则");
    await user.click(ruleButtons[0]);
    fireEvent.change(view.getByLabelText("规则文档内容"), { target: { value: rawMarkdown } });
    await user.click(view.getByRole("button", { name: "AI解析并预览" }));

    assert.ok(await view.findByText("示例名称污染已拦截"));
    assert.ok(view.getByText("胖东来出现4次，超过允许上限，请减少后重新解析"));
    const saveButton = view.getByRole("button", { name: "示例污染未通过，无法保存" });
    assert.equal(saveButton.hasAttribute("disabled"), true);
    assert.equal(getScriptDirectorRules(IP_A.id).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
