import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import type { IPProfile, KnowledgeEntry } from "./types";
import type { ScriptFactPendingItem } from "./script-factory-contract";

const SHUIMURAN: IPProfile = {
  id: "ip-shuimuran",
  name: "水木然",
  avatar: "水",
  positioning: "商业认知作者",
  platforms: ["视频号", "抖音"],
  audience: "关注商业趋势和个人成长的人",
  contentDirection: ["商业洞察", "个人成长"],
  personaKeywords: ["理性", "洞察"],
  professionalIdentity: "商业作者",
  personalityTags: ["克制", "清醒"],
  credibilitySource: "长期研究商业趋势并持续公开写作",
  representativeViewpoints: ["趋势影响个体选择"],
  tone: "理性克制",
  commonOpenings: ["很多人没意识到"],
  commonClosings: ["这才是关键"],
  catchphrases: ["看懂趋势"],
  forbiddenExpressions: ["装修", "豪宅", "施工"],
  pacing: "层层递进",
  commonScenes: ["书房"],
  commonShotTypes: ["正面口播"],
  showsFace: true,
  usesScreenRecording: false,
  needsBroll: true,
  needsCaseScreenshots: false,
  needsSubtitleHighlight: true,
  sampleViralTitles: ["普通人如何看懂下一轮行业趋势"],
  styleNotes: "以商业趋势切入，给出克制、可验证的判断",
  bio: "关注商业趋势与个人选择的作者",
  color: "#123456",
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
  scriptDirectorProfileId: "shuimuran-v1",
};
const OTHER_IP: IPProfile = {
  ...SHUIMURAN,
  id: "ip-other",
  name: "另一位老师",
  avatar: "另",
  color: "#654321",
};

function knowledgeEntry(
  id: string,
  title: string,
  ipId: string | null,
  overrides: Partial<KnowledgeEntry> = {},
): KnowledgeEntry {
  return {
    id,
    category: "文案框架方法库",
    title,
    rawContent: `${title}完整正文。`,
    sourceKind: null,
    sourceName: "",
    sourceAnalysis: null,
    tags: [],
    keywords: [],
    ipId,
    sourceTier: "中",
    sourceTierReason: "测试来源",
    contentDirection: [],
    sourcePlatform: "",
    sourceUrl: "",
    note: "",
    createdAt: "2026-08-23T00:00:00.000Z",
    extractedAt: null,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    trustStatus: null,
    sourceReference: null,
    executionTemplate: null,
    dna: null,
    ...overrides,
  };
}

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/script-factory",
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
  Object.defineProperty(dom.window.navigator, "locks", {
    configurable: true,
    value: {
      request: async <T,>(_name: string, operation: () => T) => operation(),
    },
  });
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

function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("页面没有发出脚本生成请求")), timeoutMs);
    promise.then(
      value => {
        clearTimeout(timeout);
        resolve(value);
      },
      error => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

let restoreBrowser: (() => void) | undefined;

before(() => {
  restoreBrowser = installBrowserEnvironment();
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  window.sessionStorage.clear();
});

after(() => {
  restoreBrowser?.();
});

function generatedScript(topic: string, compressionAudit?: Record<string, unknown>) {
  return {
    generationMode: "ip",
    generationStatus: "complete",
    partialFailure: null,
    ipId: SHUIMURAN.id,
    ipName: SHUIMURAN.name,
    topic,
    platform: "抖音",
    formatCategory: "short",
    formatLabel: "短视频",
    durationSeconds: 60,
    durationLabel: "60秒",
    goal: "建立信任",
    videoType: "口播",
    outputLabels: { cover: "封面文案", outline: "口播逐字稿", shooting: "拍摄建议", comment: "互动引导" },
    titles: [{ title: "判断变化的真正线索", formula: "判断", platform: "抖音", whyFitsIP: "符合IP表达" }],
    coverCopy: ["判断变化的真正线索"],
    outline: [{ label: "核心判断", timeRange: "0—60秒", content: "正文应该先展示，辅助审计随后补充。", subPoints: [] }],
    commentGuidance: { interactionPrompt: "", keywordReplies: [], dmGuidance: "", materialPackGuidance: "" },
    ipStyleExplanation: "",
    pendingVerification: [],
    storyboard: [],
    shootingSuggestions: [],
    shotPrompts: [],
    editingRhythm: { subtitleHighlights: [], soundEffects: [], screenRecordingCuts: [], caseInserts: [], pauses: [] },
    apiMeta: { apiCalled: true, calledAt: "2026-08-15T00:00:00.000Z", model: "test", ipUsed: SHUIMURAN.name, mockHit: false },
    globalConstraintReview: serverConstraintReview(false),
    compressionAudit,
  };
}

function blockedSpecificClaimScript(input: {
  topic: string;
  auditSessionId: string;
  auditVersion: string;
  pendingItemId: string;
  withSourceIssue?: boolean;
  scriptAssetId?: string;
}) {
  const excerpt = "正文应该先展示，辅助审计随后补充。";
  const pendingItems: ScriptFactPendingItem[] = [{
    id: input.pendingItemId,
    sectionIndex: 0,
    paragraphIndex: 0,
    subtype: "unsupported_specific_claim",
    excerpt,
    reason: "模型新增了输入素材没有提供的具体经历。",
    resolutionStatus: "PENDING",
  }];
  const sourceIssue = {
    code: "responsibility_subject_distortion",
    sectionIndex: 0,
    paragraphIndex: 0,
    excerpt,
    sourceReferences: [{ sourceId: "source-1", itemId: "claim-1" }],
    reason: "外部质疑被改写成当事人本人前后矛盾。",
  };
  return {
    ...generatedScript(input.topic),
    ...(input.scriptAssetId ? { scriptAssetId: input.scriptAssetId } : {}),
    postGenerationAuditStatus: "completed" as const,
    auditSessionId: input.auditSessionId,
    auditVersion: input.auditVersion,
    attributionAudit: {
      outputStatus: "exploratory" as const,
      confidenceLevel: "low" as const,
      coveredDimensions: [],
      missingDimensions: ["核心判断"],
      recommendation: "请人工核对具体陈述。",
      auditStatus: "completed" as const,
      paragraphAttributions: [{
        sectionIndex: 0,
        paragraphIndex: 0,
        excerpt,
        attributionType: "ai_reasoning" as const,
        reasoningSubtype: "unsupported_specific_claim" as const,
        sourceReferences: [],
        reason: "模型新增了输入素材没有提供的具体经历。",
      }],
    },
    sourceIntegrityAudit: input.withSourceIssue
      ? { status: "needs_review" as const, deliveryBlocked: true, issues: [sourceIssue] }
      : { status: "passed" as const, deliveryBlocked: false, issues: [] },
    factAudit: {
      overallStatus: "pending" as const,
      systemVerified: false as const,
      pendingItems,
      caseEvidence: null,
    },
    deliveryGate: {
      status: "BLOCKED" as const,
      auditVersion: input.auditVersion,
      blockerCodes: [
        ...(input.withSourceIssue ? ["SOURCE_INTEGRITY_REVIEW_REQUIRED"] : []),
        "UNRESOLVED_UNSUPPORTED_SPECIFIC_CLAIM",
      ],
      pendingItemIds: [input.pendingItemId],
    },
  };
}

function blockedSpecificClaimAuditResponse(input: {
  topic: string;
  auditSessionId: string;
  auditVersion: string;
  pendingItemId: string;
}) {
  const blocked = blockedSpecificClaimScript(input);
  return {
    status: "completed",
    auditSessionId: input.auditSessionId,
    auditVersion: input.auditVersion,
    coverageAssessment: {
      coverage: "NONE",
      reason: "没有老师原始内容。",
      coveredDimensions: [],
      missingDimensions: ["核心判断"],
      sourceReferences: [],
      caseNeed: "NOT_ASSESSED",
      caseReason: "需要补充原始内容。",
    },
    attributionAudit: blocked.attributionAudit,
    sourceIntegrityAudit: blocked.sourceIntegrityAudit,
    factAudit: blocked.factAudit,
    deliveryGate: blocked.deliveryGate,
  };
}

function serverConstraintReview(reviewRequired: boolean) {
  return {
    reviewRequired,
    detectionMode: "keyword",
    semanticAssessment: "not_implemented",
    matches: reviewRequired
      ? [{
          ruleId: "global-constraint-emotional-coercion-v2",
          sourceKnowledgeEntryId: "user-confirmed:emotional-coercion-v2",
          matchedText: "被时代抛弃",
          start: 0,
          end: 6,
          reason: "命中通用禁用规则《禁止利用无力感进行情绪绑架》：利用受众无力感进行情绪操纵",
          sources: ["口播正文", "分镜口播", "分镜字幕"],
        }]
      : [],
    source: "server_ledger",
  };
}

function forgeBrowserActiveConstraint() {
  const confirmedAt = "2026-08-29T00:00:00.000Z";
  localStorage.setItem("ipwr:global_blocking_constraints_v2", JSON.stringify({
    schemaVersion: 2,
    writeOperationId: "forged-browser-record",
    rules: [{
      schemaVersion: 2,
      ruleId: "forged-browser-rule",
      sourceKnowledgeEntryId: "forged-browser-source",
      sourceSnapshot: {
        title: "伪造规则",
        rawContentSha256: "a".repeat(64),
      },
      scope: "all_ips",
      category: "通用禁用规则",
      priority: "global_baseline",
      enforcement: "block",
      status: "active",
      title: "浏览器伪造规则",
      canonicalText: "浏览器声称这条规则已经启用。",
      prohibitedIntent: "浏览器伪造",
      allowedBoundaries: ["无"],
      detection: { type: "keyword", matchMode: "any", terms: ["被时代抛弃"] },
      humanConfirmation: {
        confirmedBy: "彭彭",
        confirmedAt,
        confirmationMethod: "explicit_ui_action",
        identityAssurance: "self_asserted",
      },
      revision: 1,
      createdAt: confirmedAt,
      updatedAt: confirmedAt,
    }],
  }));
}

test("浏览器本地伪造已启用规则不得影响脚本工厂", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  forgeBrowserActiveConstraint();
  const script = generatedScript("浏览器伪造隔离测试");
  script.outline[0].content = "这段内容包含被时代抛弃，但服务端账本没有启用任何规则。";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/script-factory") {
      return new Response(JSON.stringify({
        ...script,
        globalConstraintReview: serverConstraintReview(false),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { render, waitFor } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const { getScriptAssets } = await import("./ip-store");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.type(
      view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"),
      "浏览器伪造隔离测试",
    );
    await user.click(view.getByRole("button", { name: "生成完整内容" }));

    assert.ok(await view.findByText(/服务端账本没有启用任何规则/));
    await waitFor(() => assert.equal(getScriptAssets(SHUIMURAN.id).length, 1));
    assert.equal(view.queryByText("疑似违反通用禁用规则，等待人工确认"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("服务端已启用规则命中脚本时先展示结果但暂缓保存", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    knowledgeEntry("knowledge-review-timing", "人工复核保存时序", null),
  ]));
  const matchedScript = generatedScript("合理引用测试");
  matchedScript.outline[0].content = "我们反对用‘被时代抛弃’这种说法贩卖焦虑。";
  matchedScript.globalConstraintReview = serverConstraintReview(true);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/knowledge-search") {
      return new Response(JSON.stringify({
        results: [{
          id: "knowledge-review-timing",
          reason: "适合当前选题",
          relevanceTier: "高度相关",
          relevanceReason: "用于验证保存时序",
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input) === "/api/script-factory") {
      return new Response(JSON.stringify(matchedScript), {
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
    const { render, waitFor } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const { getKnowledgeEntries, getScriptAssets } = await import("./ip-store");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.type(
      view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"),
      "合理引用测试",
    );
    assert.ok(await view.findByText(/人工复核保存时序/, {}, { timeout: 2500 }));
    await user.click(view.getByRole("button", { name: "生成完整内容" }));

    assert.ok(await view.findByText("我们反对用‘被时代抛弃’这种说法贩卖焦虑。"));
    assert.ok(view.getByText("疑似违反通用禁用规则，等待人工确认"));
    assert.ok(view.getByText("当前检测只能识别明确的高风险表达，可能存在遗漏，最终内容合规性仍需要你自己整体判断。"));
    assert.ok(view.getByText(/命中通用禁用规则《禁止利用无力感进行情绪绑架》/));
    assert.ok(view.getByText(/涉及口播正文、分镜口播、分镜字幕/));
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 0);
    assert.equal(getKnowledgeEntries()[0]?.usageRecords.length, 0);

    await user.click(view.getByRole("button", { name: "确认属于合理语境，继续保存" }));
    await waitFor(() => assert.equal(getScriptAssets(SHUIMURAN.id).length, 1));
    assert.equal(getKnowledgeEntries()[0]?.usageRecords.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("IP专属稿通过通用规则人工确认后仍须等待v1.3门禁开放才能正式入库", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const matchedScript = generatedScript("双重门禁测试");
  matchedScript.outline[0].content = "我们反对用‘被时代抛弃’这种说法贩卖焦虑。";
  matchedScript.globalConstraintReview = serverConstraintReview(true);
  const auditSessionId = "audit-session-double-gate";
  const auditVersion = "audit-double-gate-v1";
  const pendingItemId = "pending-double-gate-001";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const path = String(input);
    if (path === "/api/script-factory") {
      return new Response(JSON.stringify(matchedScript), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (path === "/api/script-factory/audit") {
      return new Response(JSON.stringify(blockedSpecificClaimAuditResponse({
        topic: "双重门禁测试",
        auditSessionId,
        auditVersion,
        pendingItemId,
      })), { status: 200, headers: { "Content-Type": "application/json" } });
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
    const { getScriptAssets } = await import("./ip-store");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(view.getByRole("button", { name: "IP专属生成" }));
    await user.type(
      view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"),
      "双重门禁测试",
    );
    await user.click(view.getByRole("radio", { name: "这是选题或素材，不是老师本人原文" }));
    await user.click(view.getByRole("button", { name: "生成IP专属内容" }));
    assert.ok(await view.findByText("疑似违反通用禁用规则，等待人工确认"));

    await user.click(view.getByRole("button", { name: "确认属于合理语境，继续保存" }));

    assert.ok(await view.findByText("存在待核验内容"));
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 0);
    assert.ok((view.getByRole("button", { name: "审核通过后可复制" }) as HTMLButtonElement).disabled);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("人工确认违规后丢弃未保存结果并重新生成，只保存后续安全结果", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const matchedScript = generatedScript("违规重写测试");
  matchedScript.outline[0].content = "不马上行动，你就会被时代抛弃。";
  matchedScript.globalConstraintReview = serverConstraintReview(true);
  const safeScript = generatedScript("违规重写测试");
  safeScript.outline[0].content = "先看清问题，再决定是否行动。";
  (safeScript as typeof safeScript & { coverageAssessment?: { coverage: string } }).coverageAssessment = {
    coverage: "FULL",
  };
  let generationCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/script-factory") {
      generationCount += 1;
      return new Response(JSON.stringify(generationCount === 1 ? matchedScript : safeScript), {
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
    const { render, waitFor } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const { getScriptAssets } = await import("./ip-store");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.type(
      view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"),
      "违规重写测试",
    );
    await user.click(view.getByRole("button", { name: "生成完整内容" }));
    assert.ok(await view.findByText("不马上行动，你就会被时代抛弃。"));
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 0);

    await user.click(view.getByRole("button", { name: "确认违规，重新生成" }));
    assert.ok(await view.findByText("先看清问题，再决定是否行动。"));
    await waitFor(() => assert.equal(getScriptAssets(SHUIMURAN.id).length, 1));
    assert.equal(generationCount, 2);
    assert.equal(view.queryByText("疑似违反通用禁用规则，等待人工确认"), null);
    assert.match(getScriptAssets(SHUIMURAN.id)[0]?.content ?? "", /先看清问题/);
    assert.doesNotMatch(getScriptAssets(SHUIMURAN.id)[0]?.content ?? "", /被时代抛弃/);
    const savedResult = getScriptAssets(SHUIMURAN.id)[0]?.scriptResult as {
      coverageAssessment?: unknown;
    } | undefined;
    assert.equal(savedResult?.coverageAssessment, undefined, "重新生成时不得沿用旧覆盖度结论");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("人工放行后知识记账失败再次确认时不会重复保存脚本", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN, OTHER_IP]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    knowledgeEntry("knowledge-idempotent-review", "人工放行幂等保护", null),
  ]));
  const matchedScript = generatedScript("人工放行幂等测试");
  matchedScript.outline[0].content = "我们反对用‘被时代抛弃’制造恐慌。";
  matchedScript.globalConstraintReview = serverConstraintReview(true);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/knowledge-search") {
      return new Response(JSON.stringify({
        results: [{
          id: "knowledge-idempotent-review",
          reason: "适合当前选题",
          relevanceTier: "高度相关",
          relevanceReason: "用于验证重复保存保护",
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input) === "/api/script-factory") {
      return new Response(JSON.stringify(matchedScript), {
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
    const { render, waitFor } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider, useIP } = await import("./ip-context");
    const { getKnowledgeEntries, getScriptAssets } = await import("./ip-store");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    function SwitchIP() {
      const { switchIP } = useIP();
      return <button type="button" onClick={() => switchIP(OTHER_IP.id)}>切换复核IP</button>;
    }

    const view = render(<IPProvider><SwitchIP /><ScriptFactoryPage /></IPProvider>);

    await user.type(
      view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"),
      "人工放行幂等测试",
    );
    assert.ok(await view.findByText(/人工放行幂等保护/, {}, { timeout: 2500 }));
    await user.click(view.getByRole("button", { name: "生成完整内容" }));
    assert.ok(await view.findByText("疑似违反通用禁用规则，等待人工确认"));

    const originalKnowledge = localStorage.getItem("ipwr:knowledgeEntries");
    localStorage.setItem("ipwr:knowledgeEntries", "{");
    await user.click(view.getByRole("button", { name: "确认属于合理语境，继续保存" }));
    await waitFor(() => assert.equal(getScriptAssets(SHUIMURAN.id).length, 1));
    assert.ok(await view.findByText("脚本已保存，后续记录待补全"));
    assert.equal(view.queryByRole("button", { name: "确认违规，重新生成" }), null);

    localStorage.setItem("ipwr:knowledgeEntries", originalKnowledge!);
    const topicInput = view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文");
    await user.clear(topicInput);
    await user.type(topicInput, "切换后的新选题");
    await user.click(view.getByRole("button", { name: "切换复核IP" }));
    assert.ok(view.getByText("脚本已保存，后续记录待补全"));
    assert.equal(view.queryByText("我们反对用‘被时代抛弃’制造恐慌。"), null);
    assert.equal((view.getByRole("button", { name: "生成完整内容" }) as HTMLButtonElement).disabled, true);
    assert.equal((view.getByRole("button", { name: "IP专属生成" }) as HTMLButtonElement).disabled, true);

    await user.click(view.getByRole("button", { name: "重试完成保存记录" }));
    await waitFor(() => assert.equal(getKnowledgeEntries()[0]?.usageRecords.length, 1));
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 1);
    assert.equal(view.queryByText(/知识库数据已损坏，请先恢复备份/), null);
    await waitFor(() => assert.equal(
      (view.getByRole("button", { name: "生成完整内容" }) as HTMLButtonElement).disabled,
      false,
    ));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("脚本工厂默认恢复固定脚本生成，并保留IP专属生成入口", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));

  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;

  const view = render(
    <IPProvider>
      <ScriptFactoryPage />
    </IPProvider>,
  );

  const topicPlaceholder = "输入选题，或粘贴一段需要按当前IP改写的原文";
  const classicTopic = view.getByPlaceholderText(topicPlaceholder) as HTMLTextAreaElement;
  assert.equal(classicTopic.value, "");
  assert.equal(classicTopic.placeholder, topicPlaceholder);
  assert.equal(view.queryByText(/本次演示生成要求/), null);
  assert.equal(view.queryByText("IP差异化验收测试"), null);
  assert.equal(view.queryByText("母稿驱动"), null);
  assert.equal(view.queryByText(/内容引擎（完整内容包）/), null);
  assert.ok(view.getByRole("button", { name: "固定脚本生成" }));
  assert.ok(view.getByRole("button", { name: "IP专属生成" }));
  assert.ok(view.getByRole("button", { name: "生成完整内容" }));
  assert.equal(view.queryByRole("button", { name: "检查观点覆盖度" }), null);
  assert.doesNotMatch(view.container.textContent ?? "", /设计师石空|比例关系|材质关系|灯光关系/);
});

test("IP专属生成必须主动声明输入类型且老师原文确认随正文变化失效", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));

  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

  await user.click(view.getByRole("button", { name: "IP专属生成" }));
  const input = view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文");
  await user.type(input, "这是老师本人讲过的一段完整原文。");
  const generate = view.getByRole("button", { name: "生成IP专属内容" }) as HTMLButtonElement;
  assert.equal(generate.disabled, true);

  const teacherOriginal = view.getByRole("radio", { name: "这是老师本人原文" }) as HTMLInputElement;
  const topicOrMaterial = view.getByRole("radio", { name: "这是选题或素材，不是老师本人原文" }) as HTMLInputElement;
  assert.equal(teacherOriginal.checked, false);
  assert.equal(topicOrMaterial.checked, false);

  await user.click(teacherOriginal);
  const confirmation = view.getByRole("checkbox", { name: /我确认以上内容是当前IP老师本人原文/ }) as HTMLInputElement;
  assert.equal(generate.disabled, true);
  await user.click(confirmation);
  assert.equal(generate.disabled, false);

  await user.type(input, "补充内容");
  assert.equal(confirmation.checked, false);
  assert.equal(generate.disabled, true);
});

test("老师原文确认后先登记服务端来源编号，登记成功后才生成", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    calls.push({ path, body });
    if (path === "/api/script-factory/sources") {
      return new Response(JSON.stringify({
        status: "created",
        sourceId: "ipsrc_11111111-1111-4111-8111-111111111111",
        ipId: SHUIMURAN.id,
        contentSha256: "a".repeat(64),
        provenance: "user_declared_teacher_original",
        createdAt: "2026-09-01T00:00:00.000Z",
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    if (path === "/api/script-factory") {
      return new Response(JSON.stringify(generatedScript("老师本人原文测试")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ status: "unavailable" }), {
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
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(view.getByRole("button", { name: "IP专属生成" }));
    await user.type(
      view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"),
      "这是老师本人讲过的一段完整原文。",
    );
    await user.click(view.getByRole("radio", { name: "这是老师本人原文" }));
    await user.click(view.getByRole("checkbox", { name: /我确认以上内容是当前IP老师本人原文/ }));
    await user.click(view.getByRole("button", { name: "生成IP专属内容" }));

    assert.ok(await view.findByText("正文应该先展示，辅助审计随后补充。"));
    const sourceIndex = calls.findIndex(call => call.path === "/api/script-factory/sources");
    const generationIndex = calls.findIndex(call => call.path === "/api/script-factory");
    assert.ok(sourceIndex >= 0);
    assert.ok(generationIndex > sourceIndex);
    assert.deepEqual(calls[sourceIndex]?.body, {
      inputIntent: "teacher_original",
      confirmation: "TEACHER_ORIGINAL_CONFIRMED",
      ipId: SHUIMURAN.id,
      title: "这是老师本人讲过的一段完整原文。",
      rawContent: "这是老师本人讲过的一段完整原文。",
      idempotencyKey: calls[sourceIndex]?.body.idempotencyKey,
    });
    assert.equal(typeof calls[sourceIndex]?.body.idempotencyKey, "string");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("选题或素材路径不会创建老师原文来源编号", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const paths: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const path = String(input);
    paths.push(path);
    if (path === "/api/script-factory") {
      return new Response(JSON.stringify(generatedScript("普通选题测试")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ status: "unavailable" }), {
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
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(view.getByRole("button", { name: "IP专属生成" }));
    await user.type(
      view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"),
      "企业AI落地的核心卡点",
    );
    await user.click(view.getByRole("radio", { name: "这是选题或素材，不是老师本人原文" }));
    await user.click(view.getByRole("button", { name: "生成IP专属内容" }));

    assert.ok(await view.findByText("正文应该先展示，辅助审计随后补充。"));
    assert.equal(paths.includes("/api/script-factory/sources"), false);
    assert.equal(paths.includes("/api/script-factory"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("老师原文来源登记失败时停止生成", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  let generationCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const path = String(input);
    if (path === "/api/script-factory/sources") {
      return new Response(JSON.stringify({ error: "老师原文来源账本写入失败，请稍后重试。" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (path === "/api/script-factory") generationCalls += 1;
    return new Response(JSON.stringify({ status: "unavailable" }), {
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
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(view.getByRole("button", { name: "IP专属生成" }));
    await user.type(
      view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"),
      "这是老师本人讲过的一段完整原文。",
    );
    await user.click(view.getByRole("radio", { name: "这是老师本人原文" }));
    await user.click(view.getByRole("checkbox", { name: /我确认以上内容是当前IP老师本人原文/ }));
    await user.click(view.getByRole("button", { name: "生成IP专属内容" }));

    assert.ok(await view.findByText("老师原文来源账本写入失败，请稍后重试。"));
    assert.equal(generationCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("脚本工厂可以打开只读灵感抽屉并搜索筛选和查看知识详情", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const entries = [
    knowledgeEntry("global-template", "通用执行模板", null, {
      category: "文案框架方法库",
      rawContent: "通用模板逐字正文。",
      sourceName: "标准模板",
      sourcePlatform: "用户提供文档",
      executionTemplate: {
        templateKey: "standard-template",
        version: "1.0.0",
        contentHash: "a".repeat(64),
      },
    }),
    knowledgeEntry("current-method", "当前IP反常识开头", SHUIMURAN.id, {
      category: "开头方法库",
      rawContent: "先给出反常识判断，再解释原因。",
      tags: ["认知冲突"],
      trustStatus: "ai_derived_unverified",
      sourceReference: {
        sourceType: "hot_analysis",
        analysisId: "analysis-drawer",
        role: "method_card",
        groupItemId: "method-1",
      },
    }),
    knowledgeEntry("other-private", "其他IP私有方法", "ip-other"),
  ];
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify(entries));
  localStorage.setItem("ipwr:scriptAssets", JSON.stringify([]));
  localStorage.setItem("ipwr:videoReviews", JSON.stringify([]));
  const originalKnowledge = localStorage.getItem("ipwr:knowledgeEntries");

  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

  await user.click(await view.findByRole("button", { name: "打开灵感知识库" }));
  const drawer = await view.findByRole("dialog", { name: "灵感知识库" });
  assert.match(drawer.textContent ?? "", /通用执行模板/);
  assert.match(drawer.textContent ?? "", /当前IP反常识开头/);
  assert.doesNotMatch(drawer.textContent ?? "", /其他IP私有方法/);

  await user.type(view.getByRole("searchbox", { name: "搜索灵感知识" }), "认知冲突");
  assert.match(drawer.textContent ?? "", /当前IP反常识开头/);
  assert.doesNotMatch(drawer.textContent ?? "", /通用执行模板/);
  await user.clear(view.getByRole("searchbox", { name: "搜索灵感知识" }));
  await user.selectOptions(view.getByLabelText("灵感分类筛选"), "开头方法库");
  await user.selectOptions(view.getByLabelText("灵感可信度筛选"), "ai_derived_unverified");
  await user.selectOptions(view.getByLabelText("灵感来源筛选"), "hot_analysis_method");
  assert.match(drawer.textContent ?? "", /当前IP反常识开头/);
  assert.doesNotMatch(drawer.textContent ?? "", /通用执行模板/);

  await user.click(view.getByRole("button", { name: "查看当前IP反常识开头详情" }));
  const detail = await view.findByRole("dialog", { name: "知识详情：当前IP反常识开头" });
  assert.match(detail.textContent ?? "", /先给出反常识判断，再解释原因/);
  assert.equal(view.queryByRole("button", { name: /插入/ }), null);
  assert.equal(localStorage.getItem("ipwr:knowledgeEntries"), originalKnowledge);
});

test("切换IP时灵感抽屉立即清空旧结果、筛选条件和已打开详情", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN, OTHER_IP]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    knowledgeEntry("knowledge-a", "水木然私有知识", SHUIMURAN.id, { tags: ["只找水木然"] }),
    knowledgeEntry("knowledge-b", "另一位老师私有知识", OTHER_IP.id),
  ]));
  localStorage.setItem("ipwr:scriptAssets", JSON.stringify([]));
  localStorage.setItem("ipwr:videoReviews", JSON.stringify([]));

  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider, useIP } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
  const user = userEvent.setup({ document });

  function SwitchIP() {
    const { switchIP } = useIP();
    return <button type="button" onClick={() => switchIP(OTHER_IP.id)}>切换抽屉IP</button>;
  }

  const view = render(<IPProvider><SwitchIP /><ScriptFactoryPage /></IPProvider>);
  await user.click(await view.findByRole("button", { name: "打开灵感知识库" }));
  await view.findByText("水木然私有知识");
  await user.type(view.getByRole("searchbox", { name: "搜索灵感知识" }), "只找水木然");
  await user.click(view.getByRole("button", { name: "查看水木然私有知识详情" }));
  assert.ok(await view.findByRole("dialog", { name: "知识详情：水木然私有知识" }));

  let showedOldKnowledgeAsNewIP = false;
  const observer = new MutationObserver(() => {
    const drawer = view.queryByRole("dialog", { name: "灵感知识库" });
    const text = drawer?.textContent ?? "";
    if (text.includes("另一位老师知识") && text.includes("水木然私有知识")) {
      showedOldKnowledgeAsNewIP = true;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  try {
    await user.click(view.getByRole("button", { name: "切换抽屉IP" }));
    await view.findByText("另一位老师私有知识");
  } finally {
    observer.disconnect();
  }

  assert.equal(showedOldKnowledgeAsNewIP, false);
  assert.equal(view.queryByText("水木然私有知识"), null);
  assert.equal(view.queryByRole("dialog", { name: "知识详情：水木然私有知识" }), null);
  assert.equal((view.getByRole("searchbox", { name: "搜索灵感知识" }) as HTMLInputElement).value, "");
});

test("水木然迁移规则待测试时不会自动启用且底层IP存储格式异常不影响生成", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const originalFetch = globalThis.fetch;
  let generationRequestCount = 0;
  const requestBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/script-factory") {
      generationRequestCount += 1;
      requestBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify(generatedScript("水木然专属测试")), {
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
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(view.getByRole("button", { name: "IP专属生成" }));
    assert.equal(view.queryByText("水木然专属编导规则已启用"), null);
    await user.type(
      view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"),
      "水木然专属测试",
    );
    await user.click(view.getByRole("radio", { name: "这是选题或素材，不是老师本人原文" }));

    // 模拟旧同步数据把同一个IP编号写成未JSON序列化的字符串。
    localStorage.setItem("ipwr:activeIpId", SHUIMURAN.id);
    await user.click(view.getByRole("button", { name: "生成IP专属内容" }));

    assert.equal(generationRequestCount, 1);
    assert.equal(requestBodies[0]?.directorRule, null);
    assert.equal(view.queryByText("当前操盘IP刚刚发生变化，请确认后重新生成。"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("IP专属生成先展示待审正文，交付门禁开放后才写入正式脚本库", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  let resolveAudit: ((response: Response) => void) | undefined;
  const auditResponse = new Promise<Response>(resolve => { resolveAudit = resolve; });
  const requestedPaths: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const path = String(input);
    requestedPaths.push(path);
    if (path === "/api/script-factory") {
      return new Response(JSON.stringify(generatedScript("变化背后的判断")), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (path === "/api/script-factory/audit") return auditResponse;
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(view.getByRole("button", { name: "IP专属生成" }));
    await user.type(view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"), "变化背后的判断");
    await user.click(view.getByRole("radio", { name: "这是选题或素材，不是老师本人原文" }));
    assert.equal(view.queryByRole("button", { name: "检查观点覆盖度" }), null);
    await user.click(view.getByRole("button", { name: "生成IP专属内容" }));

    assert.ok(await view.findByText("正文应该先展示，辅助审计随后补充。"));
    assert.ok(view.getByText("团队审核信息"));
    assert.ok(view.getByText("观点归属分析中。正文可查看，审计完成前不得视为正式交付"));
    assert.equal(requestedPaths.includes("/api/script-factory/coverage"), false);
    assert.equal(requestedPaths.includes("/api/script-factory/audit"), true);
    const { getScriptAssets } = await import("./ip-store");
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 0, "待审正文不得被工作台、拍摄室等正式脚本读取入口看到");

    resolveAudit?.(new Response(JSON.stringify({
      status: "completed",
      auditSessionId: "audit-session-team-review",
      auditVersion: "audit-team-review",
      coverageAssessment: {
        coverage: "NONE",
        reason: "当前没有找到老师的明确观点依据。",
        coveredDimensions: [],
        missingDimensions: ["核心判断", "推理过程"],
        sourceReferences: [],
        caseNeed: "NOT_ASSESSED",
        caseReason: "先补充老师的核心判断。",
      },
      attributionAudit: {
        outputStatus: "review",
        confidenceLevel: "medium",
        coveredDimensions: ["核心判断"],
        missingDimensions: ["推理过程"],
        recommendation: "发布前请老师确认推理过程。",
        auditStatus: "completed",
        paragraphAttributions: [{
          sectionIndex: 0,
          paragraphIndex: 0,
          excerpt: "正文应该先展示，辅助审计随后补充。",
          attributionType: "ai_reasoning",
          reasoningSubtype: "unsupported_opinion",
          sourceReferences: [],
          reason: "这是缺少素材支撑的分析性判断。",
        }],
      },
      sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
      factAudit: { overallStatus: "not_checked", systemVerified: false, pendingItems: [], caseEvidence: null },
      deliveryGate: {
        status: "OPEN",
        auditVersion: "audit-team-review",
        blockerCodes: [],
        pendingItemIds: [],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    assert.ok(await view.findByText(/待审核稿 · 置信度中/));
    const savedAfterAudit = getScriptAssets(SHUIMURAN.id);
    assert.equal(savedAfterAudit.length, 1);
    const savedResult = savedAfterAudit[0]?.scriptResult as {
      postGenerationAuditStatus?: string;
      coverageAssessment?: { coverage?: string };
    } | undefined;
    assert.equal(savedResult?.postGenerationAuditStatus, "completed");
    assert.equal(savedResult?.coverageAssessment?.coverage, "NONE");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("主审计返回OPEN但仍带阻断项时不得写入正式脚本库", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const path = String(input);
    if (path === "/api/script-factory") {
      return new Response(JSON.stringify(generatedScript("矛盾OPEN门禁")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (path === "/api/script-factory/audit") {
      return new Response(JSON.stringify({
        status: "completed",
        auditSessionId: "audit-session-contradictory-main",
        auditVersion: "audit-contradictory-main-v1",
        coverageAssessment: {
          coverage: "NONE",
          reason: "没有老师原始内容。",
          coveredDimensions: [],
          missingDimensions: ["核心判断"],
          sourceReferences: [],
          caseNeed: "NOT_ASSESSED",
          caseReason: "需要补充原始内容。",
        },
        attributionAudit: {
          outputStatus: "exploratory",
          confidenceLevel: "low",
          coveredDimensions: [],
          missingDimensions: ["核心判断"],
          recommendation: "请人工核对具体陈述。",
          auditStatus: "completed",
          paragraphAttributions: [{
            sectionIndex: 0,
            paragraphIndex: 0,
            excerpt: "正文应该先展示，辅助审计随后补充。",
            attributionType: "ai_reasoning",
            reasoningSubtype: "unsupported_specific_claim",
            sourceReferences: [],
            reason: "模型新增了输入素材没有提供的具体经历。",
          }],
        },
        sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
        factAudit: {
          overallStatus: "pending",
          systemVerified: false,
          pendingItems: [{
            id: "pending-contradictory-main-001",
            sectionIndex: 0,
            paragraphIndex: 0,
            subtype: "unsupported_specific_claim",
            excerpt: "正文应该先展示，辅助审计随后补充。",
            reason: "模型新增了输入素材没有提供的具体经历。",
            resolutionStatus: "PENDING",
          }],
          caseEvidence: null,
        },
        deliveryGate: {
          status: "OPEN",
          auditVersion: "audit-contradictory-main-v1",
          blockerCodes: ["UNRESOLVED_UNSUPPORTED_SPECIFIC_CLAIM"],
          pendingItemIds: ["pending-contradictory-main-001"],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
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
    const { getScriptAssets } = await import("./ip-store");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(view.getByRole("button", { name: "IP专属生成" }));
    await user.type(
      view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"),
      "矛盾OPEN门禁",
    );
    await user.click(view.getByRole("radio", { name: "这是选题或素材，不是老师本人原文" }));
    await user.click(view.getByRole("button", { name: "生成IP专属内容" }));

    assert.ok(await view.findByText("存在待核验内容"));
    assert.ok(view.getByText("门禁响应矛盾"));
    assert.ok(view.getByText(/门禁标记为开放，但仍存在阻断原因或待核验项/));
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 0);
    assert.ok((view.getByRole("button", { name: "审核通过后可复制" }) as HTMLButtonElement).disabled);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("主审计待审保存失败时不得复用同会话同版本旧稿正式入库", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const auditSessionId = "audit-session-main-save-failure";
  const auditVersion = "audit-main-save-failure-v1";
  const { saveScriptAuditDraft } = await import("./script-factory-audit-draft");
  assert.equal(saveScriptAuditDraft(window.sessionStorage, {
    ipId: SHUIMURAN.id,
    auditSessionId,
    auditVersion,
    result: blockedSpecificClaimScript({
      topic: "旧待审稿",
      auditSessionId,
      auditVersion,
      pendingItemId: "old-pending-item",
    }),
  }), true);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const path = String(input);
    if (path === "/api/script-factory") {
      return new Response(JSON.stringify(generatedScript("新正文待审保存失败")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (path === "/api/script-factory/audit") {
      return new Response(JSON.stringify({
        status: "completed",
        auditSessionId,
        auditVersion,
        coverageAssessment: {
          coverage: "FULL",
          reason: "核心判断有完整依据。",
          coveredDimensions: ["核心判断"],
          missingDimensions: [],
          sourceReferences: [{ sourceId: "source-1", itemId: "claim-1" }],
          caseNeed: "NOT_NEEDED",
          caseReason: "本次不需要案例。",
        },
        attributionAudit: {
          outputStatus: "formal",
          confidenceLevel: "high",
          coveredDimensions: ["核心判断"],
          missingDimensions: [],
          recommendation: "可以继续交付。",
          auditStatus: "completed",
          paragraphAttributions: [{
            sectionIndex: 0,
            paragraphIndex: 0,
            excerpt: "正文应该先展示，辅助审计随后补充。",
            attributionType: "teacher_explicit",
            sourceReferences: [{ sourceId: "source-1", itemId: "claim-1" }],
            reason: "有明确来源。",
          }],
        },
        sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
        factAudit: { overallStatus: "not_checked", systemVerified: false, pendingItems: [], caseEvidence: null },
        deliveryGate: { status: "OPEN", auditVersion, blockerCodes: [], pendingItemIds: [] },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const storagePrototype = Object.getPrototypeOf(window.sessionStorage) as Storage;
  const originalSetItem = storagePrototype.setItem;
  let failDraftSave = false;
  Object.defineProperty(storagePrototype, "setItem", {
    configurable: true,
    writable: true,
    value: function setItem(this: Storage, key: string, value: string) {
      if (this === window.sessionStorage && key === "ipwr:scriptAuditDrafts:v1" && failDraftSave) {
        throw new Error("simulated main audit draft save failure");
      }
      return originalSetItem.call(this, key, value);
    },
  });

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const { getScriptAssets } = await import("./ip-store");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    failDraftSave = true;
    await user.click(view.getByRole("button", { name: "IP专属生成" }));
    await user.type(
      view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"),
      "新正文待审保存失败",
    );
    await user.click(view.getByRole("radio", { name: "这是选题或素材，不是老师本人原文" }));
    await user.click(view.getByRole("button", { name: "生成IP专属内容" }));

    assert.ok(await view.findByText(/待审正文未能保存到独立草稿区|正式脚本已保存，但待审记录尚未完成清理标记/));
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 0);
    assert.ok((view.getByRole("button", { name: "审核通过后可复制" }) as HTMLButtonElement).disabled);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(storagePrototype, "setItem", {
      configurable: true,
      writable: true,
      value: originalSetItem,
    });
  }
});

test("用户可通过正规入口人工确认高风险无依据陈述并解除交付阻断", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const originalFetch = globalThis.fetch;
  const resolveBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/script-factory") {
      return new Response(JSON.stringify(generatedScript("人工确认具体陈述")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (path === "/api/script-factory/audit") {
      return new Response(JSON.stringify({
        status: "completed",
        auditSessionId: "audit-session-confirm-claim",
        auditVersion: "audit-confirm-claim-v1",
        coverageAssessment: {
          coverage: "NONE",
          reason: "没有老师原始内容。",
          coveredDimensions: [],
          missingDimensions: ["核心判断"],
          sourceReferences: [],
          caseNeed: "NOT_ASSESSED",
          caseReason: "需要补充原始内容。",
        },
        attributionAudit: {
          outputStatus: "exploratory",
          confidenceLevel: "low",
          coveredDimensions: [],
          missingDimensions: ["核心判断"],
          recommendation: "请人工核对具体陈述。",
          auditStatus: "completed",
          paragraphAttributions: [{
            sectionIndex: 0,
            paragraphIndex: 0,
            excerpt: "正文应该先展示，辅助审计随后补充。",
            attributionType: "ai_reasoning",
            reasoningSubtype: "unsupported_specific_claim",
            sourceReferences: [],
            reason: "模型新增了输入素材没有提供的具体经历。",
          }],
        },
        sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
        factAudit: {
          overallStatus: "pending",
          systemVerified: false,
          pendingItems: [{
            id: "audit-confirm-claim-v1:0:0:unsupported_specific_claim",
            sectionIndex: 0,
            paragraphIndex: 0,
            subtype: "unsupported_specific_claim",
            excerpt: "正文应该先展示，辅助审计随后补充。",
            reason: "模型新增了输入素材没有提供的具体经历。",
            resolutionStatus: "PENDING",
          }],
          caseEvidence: null,
        },
        deliveryGate: {
          status: "BLOCKED",
          auditVersion: "audit-confirm-claim-v1",
          blockerCodes: ["UNRESOLVED_UNSUPPORTED_SPECIFIC_CLAIM"],
          pendingItemIds: ["audit-confirm-claim-v1:0:0:unsupported_specific_claim"],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (path === "/api/script-factory/audit/resolve") {
      resolveBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify({
        status: "resolved",
        auditSessionId: "audit-session-confirm-claim",
        auditVersion: "audit-confirm-claim-v1",
        pendingItem: {
          id: "audit-confirm-claim-v1:0:0:unsupported_specific_claim",
          sectionIndex: 0,
          paragraphIndex: 0,
          subtype: "unsupported_specific_claim",
          excerpt: "正文应该先展示，辅助审计随后补充。",
          reason: "模型新增了输入素材没有提供的具体经历。",
          resolutionStatus: "CONFIRMED_ALLOWED",
        },
        deliveryGate: {
          status: "OPEN",
          auditVersion: "audit-confirm-claim-v1",
          blockerCodes: [],
          pendingItemIds: [],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
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
    const { getScriptAssets } = await import("./ip-store");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(view.getByRole("button", { name: "IP专属生成" }));
    await user.type(
      view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"),
      "人工确认具体陈述",
    );
    await user.click(view.getByRole("radio", { name: "这是选题或素材，不是老师本人原文" }));
    await user.click(view.getByRole("button", { name: "生成IP专属内容" }));

    assert.ok((await view.findAllByText("模型新增了输入素材没有提供的具体经历。")).length >= 1);
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 0);
    assert.ok((view.getByRole("button", { name: "审核通过后可复制" }) as HTMLButtonElement).disabled);
    assert.ok(view.getByText("补充出处和删除正文尚需后续安全流程，本页不会直接把它们标记为已处理。"));

    await user.click(view.getByRole("button", { name: "人工确认允许使用" }));

    assert.equal(resolveBodies.length, 1);
    assert.deepEqual(Object.keys(resolveBodies[0] ?? {}).sort(), [
      "auditSessionId",
      "auditVersion",
      "idempotencyKey",
      "pendingItemId",
      "resolutionStatus",
    ]);
    assert.equal(resolveBodies[0]?.auditSessionId, "audit-session-confirm-claim");
    assert.equal(resolveBodies[0]?.auditVersion, "audit-confirm-claim-v1");
    assert.equal(
      resolveBodies[0]?.pendingItemId,
      "audit-confirm-claim-v1:0:0:unsupported_specific_claim",
    );
    assert.equal(resolveBodies[0]?.resolutionStatus, "CONFIRMED_ALLOWED");
    assert.equal(typeof resolveBodies[0]?.idempotencyKey, "string");
    assert.ok(String(resolveBodies[0]?.idempotencyKey).length > 0);
    assert.ok(await view.findByText("人工确认允许使用（仍无出处）"));
    assert.ok(view.getByRole("button", { name: "复制正文" }));
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("人工处理响应声称OPEN但完整事实审计仍有待核验项时不得正式入库", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const auditSessionId = "audit-session-remaining-pending";
  const auditVersion = "audit-remaining-pending-v1";
  const pendingItemId = "pending-resolved-item";
  const remainingItemId = "pending-omitted-item";
  const blockedResult = blockedSpecificClaimScript({
    topic: "仍有待核验项",
    auditSessionId,
    auditVersion,
    pendingItemId,
  });
  blockedResult.factAudit.pendingItems.push({
    id: remainingItemId,
    sectionIndex: 1,
    paragraphIndex: 0,
    subtype: "declared_pending_verification",
    excerpt: "另一条仍需核验的具体陈述。",
    reason: "这条陈述尚未完成核验。",
    resolutionStatus: "PENDING",
  });
  blockedResult.deliveryGate.pendingItemIds.push(remainingItemId);
  blockedResult.deliveryGate.blockerCodes.push("UNRESOLVED_FACT_VERIFICATION");
  const { saveScriptAuditDraft } = await import("./script-factory-audit-draft");
  assert.equal(saveScriptAuditDraft(window.sessionStorage, {
    ipId: SHUIMURAN.id,
    auditSessionId,
    auditVersion,
    result: blockedResult,
  }), true);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/script-factory/audit/resolve") {
      return new Response(JSON.stringify({
        status: "resolved",
        auditSessionId,
        auditVersion,
        pendingItem: { ...blockedResult.factAudit.pendingItems[0], resolutionStatus: "CONFIRMED_ALLOWED" },
        deliveryGate: { status: "OPEN", auditVersion, blockerCodes: [], pendingItemIds: [] },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
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
    const { getScriptAssets } = await import("./ip-store");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(await view.findByRole("button", { name: "人工确认允许使用" }));

    assert.ok(await view.findByText("另一条仍需核验的具体陈述。"));
    assert.ok(view.getByText("存在待核验内容"));
    assert.equal(view.queryByText("用户已确认"), null);
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 0);
    assert.ok((view.getByRole("button", { name: "审核通过后可复制" }) as HTMLButtonElement).disabled);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("人工处理响应声称OPEN但完整来源审计仍有问题时不得正式入库", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const auditSessionId = "audit-session-source-problem";
  const auditVersion = "audit-source-problem-v1";
  const pendingItemId = "pending-source-problem";
  const blockedResult = blockedSpecificClaimScript({
    topic: "来源审计仍有问题",
    auditSessionId,
    auditVersion,
    pendingItemId,
    withSourceIssue: true,
  });
  const { saveScriptAuditDraft } = await import("./script-factory-audit-draft");
  assert.equal(saveScriptAuditDraft(window.sessionStorage, {
    ipId: SHUIMURAN.id,
    auditSessionId,
    auditVersion,
    result: blockedResult,
  }), true);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/script-factory/audit/resolve") {
      return new Response(JSON.stringify({
        status: "resolved",
        auditSessionId,
        auditVersion,
        pendingItem: { ...blockedResult.factAudit.pendingItems[0], resolutionStatus: "CONFIRMED_ALLOWED" },
        deliveryGate: { status: "OPEN", auditVersion, blockerCodes: [], pendingItemIds: [] },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
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
    const { getScriptAssets } = await import("./ip-store");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(await view.findByRole("button", { name: "人工确认允许使用" }));

    assert.ok(await view.findByText("责任主体失真"));
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 0);
    assert.ok((view.getByRole("button", { name: "审核通过后可复制" }) as HTMLButtonElement).disabled);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("人工决定登记后待审记录更新失败时停止正式入库", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const auditSessionId = "audit-session-draft-update-failure";
  const auditVersion = "audit-draft-update-failure-v1";
  const pendingItemId = "pending-draft-update-failure-001";
  const blockedResult = blockedSpecificClaimScript({
    topic: "待审记录更新失败",
    auditSessionId,
    auditVersion,
    pendingItemId,
  });
  const { saveScriptAuditDraft } = await import("./script-factory-audit-draft");
  assert.equal(saveScriptAuditDraft(window.sessionStorage, {
    ipId: SHUIMURAN.id,
    auditSessionId,
    auditVersion,
    result: blockedResult,
  }), true);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/script-factory/audit/resolve") {
      return new Response(JSON.stringify({
        status: "resolved",
        auditSessionId,
        auditVersion,
        pendingItem: {
          ...blockedResult.factAudit.pendingItems[0],
          resolutionStatus: "CONFIRMED_ALLOWED",
        },
        deliveryGate: { status: "OPEN", auditVersion, blockerCodes: [], pendingItemIds: [] },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const storagePrototype = Object.getPrototypeOf(window.sessionStorage) as Storage;
  const originalSetItem = storagePrototype.setItem;
  let failDraftUpdate = false;
  Object.defineProperty(storagePrototype, "setItem", {
    configurable: true,
    writable: true,
    value: function setItem(this: Storage, key: string, value: string) {
      if (this === window.sessionStorage && key === "ipwr:scriptAuditDrafts:v1" && failDraftUpdate) {
        throw new Error("simulated pending draft update failure");
      }
      return originalSetItem.call(this, key, value);
    },
  });

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const { getScriptAssets } = await import("./ip-store");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    assert.ok(await view.findByRole("button", { name: "人工确认允许使用" }));
    failDraftUpdate = true;
    await user.click(view.getByRole("button", { name: "人工确认允许使用" }));

    assert.ok(await view.findByText(/人工决定已在服务端登记|正式脚本已保存/));
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 0);
    assert.ok((view.getByRole("button", { name: "审核通过后可复制" }) as HTMLButtonElement).disabled);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(storagePrototype, "setItem", {
      configurable: true,
      writable: true,
      value: originalSetItem,
    });
  }
});

test("人工处理响应任一关键条件不合格时均不得正式入库或开放复制", async context => {
  const auditSessionId = "audit-session-contradictory-open";
  const auditVersion = "audit-contradictory-open-v1";
  const pendingItemId = "pending-contradictory-open-001";
  const pendingItem = {
    id: pendingItemId,
    sectionIndex: 0,
    paragraphIndex: 0,
    subtype: "unsupported_specific_claim" as const,
    excerpt: "正文应该先展示，辅助审计随后补充。",
    reason: "模型新增了输入素材没有提供的具体经历。",
    resolutionStatus: "PENDING" as const,
  };
  const blockedResult = {
    ...generatedScript("矛盾门禁响应"),
    postGenerationAuditStatus: "completed" as const,
    auditSessionId,
    auditVersion,
    attributionAudit: {
      outputStatus: "exploratory" as const,
      confidenceLevel: "low" as const,
      coveredDimensions: [],
      missingDimensions: ["核心判断"],
      recommendation: "请人工核对具体陈述。",
      auditStatus: "completed" as const,
      paragraphAttributions: [{
        sectionIndex: 0,
        paragraphIndex: 0,
        excerpt: pendingItem.excerpt,
        attributionType: "ai_reasoning" as const,
        reasoningSubtype: "unsupported_specific_claim" as const,
        sourceReferences: [],
        reason: pendingItem.reason,
      }],
    },
    sourceIntegrityAudit: { status: "passed" as const, deliveryBlocked: false, issues: [] },
    factAudit: {
      overallStatus: "pending" as const,
      systemVerified: false as const,
      pendingItems: [pendingItem],
      caseEvidence: null,
    },
    deliveryGate: {
      status: "BLOCKED" as const,
      auditVersion,
      blockerCodes: ["UNRESOLVED_UNSUPPORTED_SPECIFIC_CLAIM"],
      pendingItemIds: [pendingItemId],
    },
  };
  const validResolution = {
    status: "resolved",
    auditSessionId,
    auditVersion,
    pendingItem: { ...pendingItem, resolutionStatus: "CONFIRMED_ALLOWED" },
    deliveryGate: { status: "OPEN", auditVersion, blockerCodes: [], pendingItemIds: [] },
  };
  const cases: Array<{ name: string; response: unknown }> = [
    { name: "会话不一致", response: { ...validResolution, auditSessionId: "other-session" } },
    {
      name: "版本不一致",
      response: {
        ...validResolution,
        auditVersion: "other-version",
        deliveryGate: { ...validResolution.deliveryGate, auditVersion: "other-version" },
      },
    },
    {
      name: "目标项目不一致",
      response: {
        ...validResolution,
        pendingItem: { ...validResolution.pendingItem, id: "other-pending-item" },
      },
    },
    {
      name: "响应结构残缺",
      response: {
        ...validResolution,
        pendingItem: {
          id: pendingItemId,
          sectionIndex: 0,
          paragraphIndex: 0,
          subtype: "unsupported_specific_claim",
          excerpt: pendingItem.excerpt,
          resolutionStatus: "CONFIRMED_ALLOWED",
        },
      },
    },
    {
      name: "OPEN仍携带阻断原因",
      response: {
        ...validResolution,
        deliveryGate: {
          ...validResolution.deliveryGate,
          blockerCodes: ["UNRESOLVED_UNSUPPORTED_SPECIFIC_CLAIM"],
        },
      },
    },
    {
      name: "OPEN仍携带待处理项目",
      response: {
        ...validResolution,
        deliveryGate: { ...validResolution.deliveryGate, pendingItemIds: [pendingItemId] },
      },
    },
  ];

  for (const scenario of cases) {
    await context.test(scenario.name, async () => {
      const { cleanup, render } = await import("@testing-library/react");
      cleanup();
      document.body.innerHTML = "";
      localStorage.clear();
      window.sessionStorage.clear();
      localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
      localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
      localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
      const { saveScriptAuditDraft } = await import("./script-factory-audit-draft");
      assert.equal(saveScriptAuditDraft(window.sessionStorage, {
        ipId: SHUIMURAN.id,
        auditSessionId,
        auditVersion,
        result: blockedResult,
      }), true);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async input => {
        if (String(input) === "/api/script-factory/audit/resolve") {
          return new Response(JSON.stringify(scenario.response), {
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
        const userEvent = (await import("@testing-library/user-event")).default;
        const { IPProvider } = await import("./ip-context");
        const { getScriptAssets } = await import("./ip-store");
        const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
        const user = userEvent.setup({ document });
        const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

        await user.click(await view.findByRole("button", { name: "人工确认允许使用" }));

        assert.ok(await view.findByText("服务端返回的人工处理记录与当前审计不一致"));
        assert.equal(getScriptAssets(SHUIMURAN.id).length, 0);
        assert.ok((view.getByRole("button", { name: "审核通过后可复制" }) as HTMLButtonElement).disabled);
      } finally {
        globalThis.fetch = originalFetch;
        cleanup();
      }
    });
  }
});

test("门禁阻断的待审正文刷新后仍可恢复且不会进入正式脚本读取入口", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/script-factory") {
      return new Response(JSON.stringify(generatedScript("刷新恢复待审稿")), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input) === "/api/script-factory/audit") {
      return new Response(JSON.stringify({
        status: "completed",
        auditSessionId: "audit-session-refresh",
        auditVersion: "audit-refresh",
        coverageAssessment: {
          coverage: "NONE",
          reason: "没有老师原始内容。",
          coveredDimensions: [],
          missingDimensions: ["核心判断"],
          sourceReferences: [],
          caseNeed: "NOT_ASSESSED",
          caseReason: "需要补充原始内容。",
        },
        attributionAudit: {
          outputStatus: "review",
          confidenceLevel: "low",
          coveredDimensions: [],
          missingDimensions: ["核心判断"],
          recommendation: "请人工核对。",
          auditStatus: "completed",
          paragraphAttributions: [{
            sectionIndex: 0,
            paragraphIndex: 0,
            excerpt: "正文应该先展示，辅助审计随后补充。",
            attributionType: "ai_reasoning",
            reasoningSubtype: "unsupported_opinion",
            sourceReferences: [],
            reason: "没有老师原始表达。",
          }],
        },
        sourceIntegrityAudit: {
          status: "needs_review",
          deliveryBlocked: true,
          issues: [{
            code: "responsibility_subject_distortion",
            sectionIndex: 0,
            paragraphIndex: 0,
            excerpt: "正文应该先展示，辅助审计随后补充。",
            sourceReferences: [{ sourceId: "source-1", itemId: "claim-1" }],
            reason: "责任主体发生变化。",
          }],
        },
        factAudit: { overallStatus: "not_checked", systemVerified: false, pendingItems: [], caseEvidence: null },
        deliveryGate: {
          status: "BLOCKED",
          auditVersion: "audit-refresh",
          blockerCodes: ["SOURCE_INTEGRITY_REVIEW_REQUIRED"],
          pendingItemIds: [],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { cleanup, render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const { getScriptAssets } = await import("./ip-store");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const firstView = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(firstView.getByRole("button", { name: "IP专属生成" }));
    await user.type(firstView.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"), "刷新恢复待审稿");
    await user.click(firstView.getByRole("radio", { name: "这是选题或素材，不是老师本人原文" }));
    await user.click(firstView.getByRole("button", { name: "生成IP专属内容" }));
    assert.ok(await firstView.findByText("责任主体失真"));
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 0);
    const { getPendingScriptAuditDraft } = await import("./script-factory-audit-draft");
    assert.ok(getPendingScriptAuditDraft(window.sessionStorage, SHUIMURAN.id));

    cleanup();
    const restoredView = render(<IPProvider><ScriptFactoryPage /></IPProvider>);
    assert.ok((await restoredView.findAllByText("正文应该先展示，辅助审计随后补充。")).length >= 1);
    assert.ok(restoredView.getByText("责任主体失真"));
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("人工确认等待期间正文被改写时迟到确认不得按旧内容生效", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const auditSessionId = "audit-session-late-resolution";
  const auditVersion = "audit-late-resolution-v1";
  const pendingItemId = "pending-late-resolution-001";
  const blockedResult = blockedSpecificClaimScript({
    topic: "迟到人工确认",
    auditSessionId,
    auditVersion,
    pendingItemId,
    withSourceIssue: true,
  });
  const { saveScriptAuditDraft } = await import("./script-factory-audit-draft");
  assert.equal(saveScriptAuditDraft(window.sessionStorage, {
    ipId: SHUIMURAN.id,
    auditSessionId,
    auditVersion,
    result: blockedResult,
  }), true);

  let resolveConfirmation!: (response: Response) => void;
  const confirmationResponse = new Promise<Response>(resolve => { resolveConfirmation = resolve; });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const path = String(input);
    if (path === "/api/script-factory/audit/resolve") return confirmationResponse;
    if (path === "/api/script-factory/audit") return new Promise<Response>(() => undefined);
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { act, render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const { getScriptAssets } = await import("./ip-store");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(await view.findByRole("button", { name: "人工确认允许使用" }));
    assert.ok(await view.findByText("正在登记人工决定…"));
    await user.click(view.getByRole("button", { name: "人工替换" }));
    const editor = view.getByRole("textbox", { name: "替换后的正文" });
    await user.clear(editor);
    await user.type(editor, "这是人工改写后的新正文。");
    await user.click(view.getByRole("button", { name: "确认替换" }));
    assert.ok((await view.findAllByText("这是人工改写后的新正文。")).length >= 1);
    const { getPendingScriptAuditDraft } = await import("./script-factory-audit-draft");
    const rewrittenDraft = getPendingScriptAuditDraft<Record<string, unknown>>(
      window.sessionStorage,
      SHUIMURAN.id,
    );
    assert.equal(rewrittenDraft?.result.coverageAssessment, undefined, "正文变化后必须清空旧覆盖度结论");

    await act(async () => {
      resolveConfirmation(new Response(JSON.stringify({
        status: "resolved",
        auditSessionId,
        auditVersion,
        pendingItem: {
          ...blockedResult.factAudit.pendingItems[0],
          resolutionStatus: "CONFIRMED_ALLOWED",
        },
        deliveryGate: { status: "OPEN", auditVersion, blockerCodes: [], pendingItemIds: [] },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
      await Promise.resolve();
    });

    assert.ok(await view.findByText(/人工确认期间页面内容或当前IP已变化，旧结果未写入正式脚本/));
    assert.ok(view.getByText("这是人工改写后的新正文。"));
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("人工改写在复审通过前不得覆盖原正式稿", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const auditSessionId = "audit-session-preserve-formal";
  const auditVersion = "audit-preserve-formal-v1";
  const pendingItemId = "pending-preserve-formal-001";
  const blockedResult = blockedSpecificClaimScript({
    topic: "保护原正式稿",
    auditSessionId,
    auditVersion,
    pendingItemId,
    withSourceIssue: true,
  });
  const { addScriptAsset, getScriptAssets } = await import("./ip-store");
  const formalAsset = addScriptAsset({
    ipId: SHUIMURAN.id,
    title: "原正式稿",
    cover: "原封面",
    content: "原正式正文",
    status: "草稿",
    scriptResult: blockedResult,
  });
  const linkedBlockedResult = { ...blockedResult, scriptAssetId: formalAsset.id };
  const { getPendingScriptAuditDraft, saveScriptAuditDraft } = await import("./script-factory-audit-draft");
  assert.equal(saveScriptAuditDraft(window.sessionStorage, {
    ipId: SHUIMURAN.id,
    auditSessionId,
    auditVersion,
    result: linkedBlockedResult,
  }), true);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/script-factory/audit") return new Promise<Response>(() => undefined);
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
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(await view.findByRole("button", { name: "人工替换" }));
    const editor = view.getByRole("textbox", { name: "替换后的正文" });
    await user.clear(editor);
    await user.type(editor, "复审尚未通过的新正文。");
    await user.click(view.getByRole("button", { name: "确认替换" }));
    assert.ok((await view.findAllByText("复审尚未通过的新正文。")).length >= 1);

    const storedFormal = getScriptAssets(SHUIMURAN.id).find(asset => asset.id === formalAsset.id);
    assert.equal(storedFormal?.content, "原正式正文");
    const pendingDraft = getPendingScriptAuditDraft<typeof linkedBlockedResult>(window.sessionStorage, SHUIMURAN.id);
    assert.equal(pendingDraft?.result.outline[0]?.content, "复审尚未通过的新正文。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("人工替换复审时不会复用同一审计会话的旧版本正式稿", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const originalFetch = globalThis.fetch;
  const auditBodies: Array<Record<string, unknown>> = [];
  let auditCalls = 0;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/script-factory") {
      return new Response(JSON.stringify(generatedScript("变化背后的判断")), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (path === "/api/script-factory/audit") {
      auditCalls += 1;
      auditBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      const first = auditCalls === 1;
      return new Response(JSON.stringify({
        status: "completed",
        auditSessionId: "audit-session-rewrite",
        auditVersion: first ? "audit-v1" : "audit-v2",
        coverageAssessment: {
          coverage: "NONE",
          reason: "当前没有找到老师的明确观点依据。",
          coveredDimensions: [],
          missingDimensions: ["核心判断", "推理过程"],
          sourceReferences: [],
          caseNeed: "NOT_ASSESSED",
          caseReason: "先补充老师的核心判断。",
        },
        attributionAudit: {
          outputStatus: first ? "formal" : "review",
          confidenceLevel: first ? "high" : "low",
          coveredDimensions: [],
          missingDimensions: ["核心判断"],
          recommendation: "发布前请人工确认。",
          auditStatus: "completed",
          paragraphAttributions: [{
            sectionIndex: 0,
            paragraphIndex: 0,
            excerpt: first ? "正文应该先展示，辅助审计随后补充。" : "外部资料对这段说法提出了质疑。",
            attributionType: "ai_reasoning",
            reasoningSubtype: "unsupported_opinion",
            sourceReferences: [],
            reason: "没有老师原始表达。",
          }],
        },
        sourceIntegrityAudit: {
          status: first ? "needs_review" : "passed",
          deliveryBlocked: first,
          issues: first ? [{
            code: "responsibility_subject_distortion",
            sectionIndex: 0,
            paragraphIndex: 0,
            excerpt: "正文应该先展示，辅助审计随后补充。",
            sourceReferences: [{ sourceId: "source-1", itemId: "claim-1" }],
            reason: "外部质疑被改写成当事人本人前后矛盾。",
          }] : [],
        },
        factAudit: { overallStatus: "not_checked", systemVerified: false, pendingItems: [], caseEvidence: null },
        deliveryGate: {
          status: first ? "BLOCKED" : "OPEN",
          auditVersion: first ? "audit-v1" : "audit-v2",
          blockerCodes: first ? ["SOURCE_INTEGRITY_REVIEW_REQUIRED"] : [],
          pendingItemIds: [],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const { addScriptAsset, getScriptAssets } = await import("./ip-store");
    addScriptAsset({
      ipId: SHUIMURAN.id,
      title: "旧版本正式稿",
      cover: "旧版本封面",
      content: "旧版本正式正文",
      status: "草稿",
      scriptResult: {
        auditSessionId: "audit-session-rewrite",
        auditVersion: "audit-v1",
      },
    });
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(view.getByRole("button", { name: "IP专属生成" }));
    await user.type(view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"), "变化背后的判断");
    await user.click(view.getByRole("radio", { name: "这是选题或素材，不是老师本人原文" }));
    await user.click(view.getByRole("button", { name: "生成IP专属内容" }));
    assert.ok(await view.findByText("责任主体失真"));
    assert.ok(view.getByText(/待审核稿 · 置信度高/));
    assert.ok((view.getByRole("button", { name: "审核通过后可复制" }) as HTMLButtonElement).disabled);
    assert.deepEqual(Object.keys(auditBodies[0] ?? {}).sort(), ["caseEvidence", "content", "sources"]);
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 1);

    await user.click(view.getByRole("button", { name: "人工替换" }));
    const editor = view.getByRole("textbox", { name: "替换后的正文" });
    await user.clear(editor);
    await user.type(editor, "外部资料对这段说法提出了质疑。");
    await user.click(view.getByRole("button", { name: "确认替换" }));

    assert.ok((await view.findAllByText("外部资料对这段说法提出了质疑。")).length >= 1);
    assert.ok(view.getByText(/已经使用过一次人工处理机会/));
    assert.ok(view.getByRole("button", { name: "复制正文" }));
    const rewrittenAssets = getScriptAssets(SHUIMURAN.id);
    assert.equal(rewrittenAssets.length, 2);
    const currentAsset = rewrittenAssets.find(asset => {
      const stored = asset.scriptResult as { auditVersion?: string } | undefined;
      return stored?.auditVersion === "audit-v2";
    });
    assert.match(currentAsset?.content ?? "", /外部资料对这段说法提出了质疑/);
    assert.doesNotMatch(currentAsset?.content ?? "", /正文应该先展示/);
    assert.ok(rewrittenAssets.some(asset => asset.content === "旧版本正式正文"));
    assert.equal(auditCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("知识检索完成但脚本最终生成失败时不留下已用于脚本记录", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([{
    id: "knowledge-delayed-record",
    category: "方法论",
    title: "延迟记账方法",
    rawContent: "先给结论，再用案例解释。",
    tags: [],
    keywords: ["结论", "案例"],
    ipId: null,
    sourceTier: "高",
    sourceTierReason: "人工确认",
    contentDirection: [],
    sourcePlatform: "",
    sourceUrl: "",
    note: "",
    createdAt: "2026-08-22T00:00:00.000Z",
    extractedAt: "2026-08-22T00:00:00.000Z",
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
  }]));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/knowledge-search") {
      return new Response(JSON.stringify({
        results: [{
          id: "knowledge-delayed-record",
          reason: "适合当前选题",
          relevanceTier: "高度相关",
          relevanceReason: "结构方法一致",
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input) === "/api/script-factory") {
      return new Response(JSON.stringify({ error: "生成失败" }), {
        status: 500,
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
    const { getKnowledgeEntries } = await import("./ip-store");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.type(
      view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"),
      "失败后不能提前记账",
    );
    assert.ok(await view.findByText(/延迟记账方法/, {}, { timeout: 2500 }));
    assert.equal(getKnowledgeEntries()[0]?.usageRecords.length, 0);

    await user.click(view.getByRole("button", { name: "生成完整内容" }));
    assert.ok(await view.findByText(/API返回错误/));
    assert.equal(getKnowledgeEntries()[0]?.usageRecords.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("完整脚本生成并保存成功后才新增已用于脚本记录", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([{
    id: "knowledge-after-success",
    category: "方法论",
    title: "成功后记账方法",
    rawContent: "先给结论，再用案例解释。",
    tags: [],
    keywords: ["结论", "案例"],
    ipId: null,
    sourceTier: "高",
    sourceTierReason: "人工确认",
    contentDirection: [],
    sourcePlatform: "",
    sourceUrl: "",
    note: "",
    createdAt: "2026-08-22T00:00:00.000Z",
    extractedAt: "2026-08-22T00:00:00.000Z",
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
  }]));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/knowledge-search") {
      return new Response(JSON.stringify({
        results: [{
          id: "knowledge-after-success",
          reason: "适合当前选题",
          relevanceTier: "高度相关",
          relevanceReason: "结构方法一致",
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input) === "/api/script-factory") {
      return new Response(JSON.stringify(generatedScript("成功后记录知识")), {
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
    const { getKnowledgeEntries, getScriptAssets } = await import("./ip-store");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.type(
      view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"),
      "成功后才能记录知识",
    );
    assert.ok(await view.findByText(/成功后记账方法/, {}, { timeout: 2500 }));
    assert.equal(getKnowledgeEntries()[0]?.usageRecords.length, 0);

    await user.click(view.getByRole("button", { name: "生成完整内容" }));
    assert.ok(await view.findByText("正文应该先展示，辅助审计随后补充。"));
    const entry = getKnowledgeEntries()[0];
    const script = getScriptAssets(SHUIMURAN.id)[0];
    assert.equal(entry?.status, "已用于脚本");
    assert.equal(entry?.usageRecords.length, 1);
    assert.equal(entry?.usageRecords[0]?.module, "脚本工厂");
    assert.equal(entry?.usageRecords[0]?.trackingStatus, "module_recorded");
    assert.equal(entry?.usageRecords[0]?.scriptId, script?.id);
    assert.equal(entry?.usageRecords[0]?.topicId, null);
    assert.equal(script?.knowledgeTracking.status, "unavailable");
    assert.deepEqual(script?.knowledgeTracking.candidateKnowledgeEntryIds, ["knowledge-after-success"]);
    assert.equal(typeof script?.knowledgeTracking.verifiedAt, "string");
    assert.deepEqual(script?.knowledgeTracking.usages, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("分镜或执行建议阶段失败时不提前留下已用于脚本记录", async () => {
  const originalFetch = globalThis.fetch;
  const { cleanup, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const { getKnowledgeEntries } = await import("./ip-store");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;

  try {
    for (const failedStage of ["storyboard", "execution"] as const) {
      cleanup();
      document.body.innerHTML = "";
      localStorage.clear();
      localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
      localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
      localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
      localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([{
        id: `knowledge-${failedStage}`,
        category: "方法论",
        title: `${failedStage}阶段方法`,
        rawContent: "先给结论，再用案例解释。",
        tags: [],
        keywords: ["结论", "案例"],
        ipId: null,
        sourceTier: "高",
        sourceTierReason: "人工确认",
        contentDirection: [],
        sourcePlatform: "",
        sourceUrl: "",
        note: "",
        createdAt: "2026-08-22T00:00:00.000Z",
        extractedAt: "2026-08-22T00:00:00.000Z",
        metrics: null,
        viralEvaluation: null,
        usageRecords: [],
        status: "未使用",
        dna: null,
      }]));
      globalThis.fetch = async input => {
        if (String(input) === "/api/knowledge-search") {
          return new Response(JSON.stringify({
            results: [{
              id: `knowledge-${failedStage}`,
              reason: "适合当前选题",
              relevanceTier: "高度相关",
              relevanceReason: "结构方法一致",
            }],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (String(input) === "/api/script-factory") {
          return new Response(JSON.stringify({
            ...generatedScript(`${failedStage}阶段失败`),
            generationStatus: "partial",
            partialFailure: {
              stage: failedStage,
              errorCode: `${failedStage}_failed`,
              message: `${failedStage}阶段生成失败`,
            },
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      const user = userEvent.setup({ document });
      const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);
      await user.type(
        view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"),
        `${failedStage}失败不记账`,
      );
      assert.ok(await view.findByText(new RegExp(`${failedStage}阶段方法`), {}, { timeout: 2500 }));
      await user.click(view.getByRole("button", { name: "生成完整内容" }));
      assert.ok(await view.findByText(`${failedStage}阶段生成失败`));
      assert.equal(getKnowledgeEntries()[0]?.usageRecords.length, 0);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("水木然压缩兜底状态显示在团队审核信息且审计完成前禁止复制", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/script-factory") {
      return new Response(JSON.stringify(generatedScript("压缩兜底", {
        status: "closest_fallback",
        initialChars: 678,
        idealMinimumChars: 475,
        idealMaximumChars: 542,
        acceptableMinimumChars: 475,
        acceptableMaximumChars: 610,
        actualChars: 630,
        actualRatio: 0.9292,
        selectedAttempt: 2,
        message: "本次压缩未能精确达到目标比例，已采用最接近的版本。",
      })), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input) === "/api/script-factory/audit") {
      return new Promise<Response>(() => undefined);
    }
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(view.getByRole("button", { name: "IP专属生成" }));
    await user.type(view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"), "压缩兜底");
    await user.click(view.getByRole("radio", { name: "这是选题或素材，不是老师本人原文" }));
    await user.click(view.getByRole("button", { name: "生成IP专属内容" }));

    assert.ok(await view.findByText("本次压缩未能精确达到目标比例，已采用最接近的版本。"));
    assert.ok(view.getByText(/初稿678字/));
    assert.ok(view.getByText(/最终630字/));
    const { getScriptAssets } = await import("./ip-store");
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 0);
    assert.ok((view.getByRole("button", { name: "审核通过后可复制" }) as HTMLButtonElement).disabled);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("生成后审计失败时正文仍可查看但不得写入正式脚本库", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/script-factory") {
      return new Response(JSON.stringify(generatedScript("审计失败也能使用")), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input) === "/api/script-factory/audit") {
      return new Response(JSON.stringify({ error: "暂时不可用" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(view.getByRole("button", { name: "IP专属生成" }));
    await user.type(view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"), "审计失败也能使用");
    await user.click(view.getByRole("radio", { name: "这是选题或素材，不是老师本人原文" }));
    await user.click(view.getByRole("button", { name: "生成IP专属内容" }));

    assert.ok(await view.findByText("正文应该先展示，辅助审计随后补充。"));
    assert.ok(await view.findByText("本次归属分析暂未完成。正文可查看，但不得视为审计通过或正式交付"));
    const { getPendingScriptAuditDraft } = await import("./script-factory-audit-draft");
    const failedAuditDraft = getPendingScriptAuditDraft<Record<string, unknown>>(
      window.sessionStorage,
      SHUIMURAN.id,
    );
    assert.equal(failedAuditDraft?.result.coverageAssessment, undefined, "审计失败后不得保留旧覆盖度结论");
    const { getScriptAssets } = await import("./ip-store");
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("生成后审计返回200但内容残缺时正文仍可查看但不得写入正式脚本库", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/script-factory") {
      return new Response(JSON.stringify(generatedScript("残缺审计不影响正文")), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input) === "/api/script-factory/audit") {
      return new Response(JSON.stringify({ status: "completed" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(view.getByRole("button", { name: "IP专属生成" }));
    await user.type(view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"), "残缺审计不影响正文");
    await user.click(view.getByRole("radio", { name: "这是选题或素材，不是老师本人原文" }));
    await user.click(view.getByRole("button", { name: "生成IP专属内容" }));

    assert.ok(await view.findByText("正文应该先展示，辅助审计随后补充。"));
    assert.ok(await view.findByText("本次归属分析暂未完成。正文可查看，但不得视为审计通过或正式交付"));
    assert.equal(view.queryByText("历史稿未记录观点归属信息"), null);
    const { getScriptAssets } = await import("./ip-store");
    assert.equal(getScriptAssets(SHUIMURAN.id).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("切换生成模式后丢弃旧稿迟到的审计结果", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  let resolveAudit: ((response: Response) => void) | undefined;
  const auditResponse = new Promise<Response>(resolve => { resolveAudit = resolve; });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/script-factory") {
      return new Response(JSON.stringify(generatedScript("旧稿")), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input) === "/api/script-factory/audit") return auditResponse;
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

    await user.click(view.getByRole("button", { name: "IP专属生成" }));
    await user.type(view.getByPlaceholderText("输入选题，或粘贴一段需要按当前IP改写的原文"), "旧稿");
    await user.click(view.getByRole("radio", { name: "这是选题或素材，不是老师本人原文" }));
    await user.click(view.getByRole("button", { name: "生成IP专属内容" }));
    assert.ok(await view.findByText("正文应该先展示，辅助审计随后补充。"));
    await user.click(view.getByRole("button", { name: "固定脚本生成" }));
    assert.equal(view.queryByText("正文应该先展示，辅助审计随后补充。"), null);

    resolveAudit?.(new Response(JSON.stringify({
      status: "completed",
      coverageAssessment: {
        coverage: "NONE",
        reason: "当前没有找到老师的明确观点依据。",
        coveredDimensions: [],
        missingDimensions: ["核心判断", "推理过程"],
        sourceReferences: [],
        caseNeed: "NOT_ASSESSED",
        caseReason: "先补充老师的核心判断。",
      },
      attributionAudit: {
        outputStatus: "formal",
        confidenceLevel: "high",
        coveredDimensions: ["核心判断"],
        missingDimensions: [],
        recommendation: "可使用。",
        auditStatus: "completed",
        paragraphAttributions: [],
      },
      factAudit: { overallStatus: "not_checked", systemVerified: false, pendingItems: [], caseEvidence: null },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(view.queryByText(/正式稿 · 置信度高/), null);
    assert.equal(view.queryByText("正文应该先展示，辅助审计随后补充。"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("重新打开IP专属脚本时恢复对应生成模式", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  localStorage.setItem("ipwr:scriptAssets", JSON.stringify([{
    id: "script-ip-mode",
    ipId: SHUIMURAN.id,
    title: "IP专属历史脚本",
    cover: "封面",
    content: "正文",
    status: "草稿",
    createdAt: "2026-08-13T00:00:00.000Z",
    scriptResult: {
      generationMode: "ip",
      generationStatus: "complete",
      partialFailure: null,
      ipId: SHUIMURAN.id,
      ipName: SHUIMURAN.name,
      topic: "IP专属历史脚本",
      platform: "抖音",
      formatCategory: "short",
      formatLabel: "短视频",
      durationSeconds: 60,
      durationLabel: "60秒",
      goal: "建立信任",
      videoType: "口播",
      outputLabels: { cover: "封面文案", outline: "口播逐字稿", shooting: "拍摄建议", comment: "互动引导" },
      titles: [{ title: "IP专属历史脚本", formula: "判断", platform: "抖音", whyFitsIP: "符合" }],
      coverCopy: ["封面"],
      outline: [{ label: "判断", timeRange: "0-60秒", content: "完整正文。" }],
      commentGuidance: { interactionPrompt: "", keywordReplies: [], dmGuidance: "", materialPackGuidance: "" },
      ipStyleExplanation: "",
      postGenerationAuditStatus: "completed",
      auditVersion: "stale-incomplete-audit-v1",
      coverageAssessment: {
        coverage: "FULL",
        reason: "这是一份缺少完整审计明细的旧覆盖度结论。",
        coveredDimensions: ["核心判断"],
        missingDimensions: [],
        sourceReferences: [],
        caseNeed: "NOT_NEEDED",
        caseReason: "旧记录声称不需要案例。",
      },
      attributionAudit: {
        outputStatus: "exploratory",
        confidenceLevel: "low",
        coveredDimensions: [],
        missingDimensions: ["核心判断"],
        recommendation: "请老师补充核心判断。",
        auditStatus: "completed",
        paragraphAttributions: [{ sectionIndex: 0, paragraphIndex: 0, excerpt: "完整正文。", attributionType: "ai_reasoning", sourceReferences: [], reason: "没有老师原始表达。" }],
      },
      sourceIntegrityAudit: { status: "passed", deliveryBlocked: false, issues: [] },
      factAudit: { overallStatus: "not_checked", systemVerified: false, pendingItems: [], caseEvidence: null },
      generationApproval: {
        coverage: "NONE",
        outputStatus: "exploratory",
        confirmationType: "limitations_acknowledged",
        missingDimensions: ["核心判断"],
        confirmedAt: "2026-08-13T00:00:00.000Z",
      },
      storyboard: [],
      shootingSuggestions: [],
      shotPrompts: [],
      editingRhythm: { subtitleHighlights: [], soundEffects: [], screenRecordingCuts: [], caseInserts: [], pauses: [] },
      apiMeta: { apiCalled: true, calledAt: "2026-08-13T00:00:00.000Z", model: "test", ipUsed: SHUIMURAN.name, mockHit: false },
    },
  }]));
  window.history.replaceState({}, "", "/script-factory?scriptId=script-ip-mode");

  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
  const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

  const modeButton = await view.findByRole("button", { name: "IP专属生成" });
  assert.equal(modeButton.getAttribute("aria-pressed"), "true");
  assert.ok(view.getByText(/不得视为审计通过或正式交付/));
  assert.ok((view.getByRole("button", { name: "审核通过后可复制" }) as HTMLButtonElement).disabled);
  assert.equal(view.queryByText(/正式稿 · 置信度高/), null);
  assert.equal(view.queryByRole("button", { name: "生成完整内容" }), null);
  await (await import("@testing-library/user-event")).default.setup({ document }).click(view.getByRole("button", { name: "固定脚本生成" }));
  assert.equal(view.queryByText("完整正文。"), null);
  assert.equal(view.queryByText(/不得视为审计通过或正式交付/), null);
  window.history.replaceState({}, "", "/script-factory");
});

test("水木然IP专属结果只展示标题、完整口播文案和待核验内容", async () => {
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([SHUIMURAN]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(SHUIMURAN.id));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
  localStorage.setItem("ipwr:scriptAssets", JSON.stringify([{
    id: "script-shuimuran-confirmed",
    ipId: SHUIMURAN.id,
    title: "胖东来的经营秘诀",
    cover: "",
    content: "胖东来真正厉害的地方，根本不是服务。",
    status: "草稿",
    createdAt: "2026-08-14T00:00:00.000Z",
    scriptResult: {
      generationMode: "ip",
      outputMode: "shuimuran-confirmed",
      generationStatus: "complete",
      partialFailure: null,
      ipId: SHUIMURAN.id,
      ipName: SHUIMURAN.name,
      topic: "胖东来的经营秘诀",
      platform: "视频号",
      formatCategory: "short",
      formatLabel: "短视频",
      durationSeconds: 60,
      durationLabel: "60秒",
      goal: "建立信任",
      videoType: "口播",
      outputLabels: { cover: "封面文案", outline: "口播逐字稿", shooting: "拍摄建议", comment: "互动引导" },
      titles: [{ title: "胖东来的经营秘诀，就是《道德经》的这八个字", formula: "", platform: "", whyFitsIP: "" }],
      coverCopy: [],
      outline: [{ label: "完整口播文案", timeRange: "完整口播", content: "胖东来真正厉害的地方，根本不是服务。" }],
      commentGuidance: { interactionPrompt: "", keywordReplies: [], dmGuidance: "", materialPackGuidance: "" },
      ipStyleExplanation: "不应展示的自我评价",
      pendingVerification: ["《道德经》原文出处待确认"],
      storyboard: [],
      shootingSuggestions: [],
      shotPrompts: [],
      editingRhythm: { subtitleHighlights: [], soundEffects: [], screenRecordingCuts: [], caseInserts: [], pauses: [] },
      apiMeta: { apiCalled: true, calledAt: "2026-08-14T00:00:00.000Z", model: "test", ipUsed: SHUIMURAN.name, mockHit: false },
    },
  }]));
  window.history.replaceState({}, "", "/script-factory?scriptId=script-shuimuran-confirmed");

  const { render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const ScriptFactoryPage = (await import("../app/script-factory/page")).default;
  const view = render(<IPProvider><ScriptFactoryPage /></IPProvider>);

  assert.ok(await view.findByText("标题："));
  assert.ok(view.getByText(/不得视为审计通过或正式交付/));
  assert.ok((view.getByRole("button", { name: "审核通过后可复制" }) as HTMLButtonElement).disabled);
  assert.ok(view.getByText("完整口播文案："));
  assert.ok(view.getByText("待核验内容："));
  assert.ok(view.getByText("《道德经》原文出处待确认"));
  assert.equal(view.queryByText("封面文案"), null);
  assert.equal(view.queryByText("互动引导"), null);
  assert.equal(view.queryByText("不应展示的自我评价"), null);
  window.history.replaceState({}, "", "/script-factory");
});
