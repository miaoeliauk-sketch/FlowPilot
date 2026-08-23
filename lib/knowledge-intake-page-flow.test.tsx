import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/knowledge-intake",
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
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
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

let restoreBrowser: (() => void) | undefined;

before(() => {
  restoreBrowser = installBrowserEnvironment();
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify(null));
  localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));
});

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
});

after(() => restoreBrowser?.());

function buildIntakeResponseItem(title: string, overrides: Record<string, unknown> = {}) {
  return {
    title,
    summary: `${title}摘要`,
    category: "选题方法库",
    ipId: null,
    ipMatchStatus: "not_applicable",
    ipMatchReason: "通用方法",
    coreMethod: `${title}核心方法`,
    applicableScenarios: ["短视频选题"],
    triggerKeywords: [title],
    similarPhrases: [],
    aiUsage: "用于优化短视频选题",
    examples: [],
    unsuitableCases: [],
    tags: [title],
    reusableValue: "可复用",
    confidence: "高",
    confidenceReason: "原文明确",
    ingestRecommend: "建议入库",
    ingestReason: "方法完整",
    ...overrides,
  };
}

function buildExistingKnowledgeEntry(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    category: "选题方法库",
    title: "反常识选题法",
    rawContent: [
      "【一句话总结】\n用反常识冲突解决普通选题缺少吸引力的问题",
      "【核心方法】\n先指出大众默认判断，再用真实反例推翻它",
      "【适用场景】\n知识口播、观点短视频",
      "【AI调用方式】\n当选题缺少冲突时，用反例重构切入角度",
    ].join("\n\n"),
    sourceKind: null,
    sourceName: "历史课程",
    sourceAnalysis: null,
    tags: [],
    keywords: [],
    ipId: null,
    sourceTier: "中",
    sourceTierReason: "来源明确",
    contentDirection: ["知识口播", "观点短视频"],
    sourcePlatform: "课程逐字稿",
    sourceUrl: "",
    note: JSON.stringify({
      coreMethod: "先指出大众默认判断，再用真实反例推翻它",
      applicableScenarios: ["知识口播", "观点短视频"],
      aiUsage: "当选题缺少冲突时，用反例重构切入角度",
    }),
    createdAt: "2026-08-01T00:00:00.000Z",
    extractedAt: null,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
    ...overrides,
  };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test("普通智能入库在提交前提示长内容需要分段并阻止提炼", async () => {
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;

  const view = render(
    <IPProvider>
      <KnowledgeIntakePage />
    </IPProvider>,
  );
  const user = userEvent.setup({ document });

  await user.click(view.getByPlaceholderText(/粘贴逐字稿/));
  await user.paste("长".repeat(10_372));

  assert.ok(view.getByText("当前内容10372字，单次智能提炼建议不超过4000字，请按章节分成约3段导入"));
  assert.equal(
    (view.getByRole("button", { name: "AI提炼方法" }) as HTMLButtonElement).disabled,
    true,
  );
});

test("无标题内容在4000至4400字边界内允许直接提炼，超过后阻止", async () => {
  const { fireEvent, render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;

  const view = render(
    <IPProvider>
      <KnowledgeIntakePage />
    </IPProvider>,
  );
  const input = view.getByPlaceholderText(/粘贴逐字稿/);
  const analyzeButton = view.getByRole("button", { name: "AI提炼方法" }) as HTMLButtonElement;

  fireEvent.change(input, { target: { value: "长".repeat(4_000) } });
  assert.equal(analyzeButton.disabled, false);
  assert.equal(view.queryByText(/略超4000字推荐长度/), null);

  fireEvent.change(input, { target: { value: "长".repeat(4_001) } });
  assert.equal(analyzeButton.disabled, false);
  assert.ok(view.getByText("当前内容4001字，略超4000字推荐长度。本次仍可直接提炼，最多生成4张方法卡；如需更完整覆盖，建议分段导入。"));

  fireEvent.change(input, { target: { value: "长".repeat(4_400) } });
  assert.equal(analyzeButton.disabled, false);
  assert.ok(view.getByText("当前内容4400字，略超4000字推荐长度。本次仍可直接提炼，最多生成4张方法卡；如需更完整覆盖，建议分段导入。"));

  fireEvent.change(input, { target: { value: "长".repeat(4_401) } });
  assert.equal(analyzeButton.disabled, true);
  assert.ok(view.getByText("当前内容4401字，单次智能提炼建议不超过4000字，请按章节分成约2段导入"));
});

test("处于容差范围但有可靠标题结构时仍优先自动分段", async () => {
  const { fireEvent, render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;
  const view = render(
    <IPProvider>
      <KnowledgeIntakePage />
    </IPProvider>,
  );
  const content = [
    "# 第一章 选题",
    "甲".repeat(2_050),
    "## 第二章 开头",
    "乙".repeat(2_050),
  ].join("\n");

  fireEvent.change(view.getByPlaceholderText(/粘贴逐字稿/), { target: { value: content } });

  assert.equal((view.getByRole("button", { name: "AI提炼方法" }) as HTMLButtonElement).disabled, true);
  assert.ok(view.getByRole("button", { name: "预览自动分段" }));
  assert.equal(view.queryByText(/本次仍可直接提炼/), null);
});

test("有标题但单节超过4000字时不能借容差通道直接提炼", async () => {
  const { fireEvent, render } = await import("@testing-library/react");
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;
  const view = render(
    <IPProvider>
      <KnowledgeIntakePage />
    </IPProvider>,
  );
  const content = [
    "# 第一章 选题",
    "甲".repeat(4_050),
    "## 第二章 开头",
    "乙".repeat(100),
  ].join("\n");

  assert.ok(content.length <= 4_400);
  fireEvent.change(view.getByPlaceholderText(/粘贴逐字稿/), { target: { value: content } });

  assert.equal((view.getByRole("button", { name: "AI提炼方法" }) as HTMLButtonElement).disabled, true);
  assert.ok(view.getByText(/章节「第一章 选题」超过4000字且没有可用的下一层边界/));
  assert.equal(view.queryByText(/本次仍可直接提炼/), null);
});

test("有可靠标题结构的长文可以先预览自动分段结果", async () => {
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;

  const view = render(
    <IPProvider>
      <KnowledgeIntakePage />
    </IPProvider>,
  );
  const user = userEvent.setup({ document });
  const content = [
    "# 第一章 选题",
    "甲".repeat(2_100),
    "## 第二章 开头",
    "乙".repeat(2_100),
    "## 第三章 结尾",
    "丙".repeat(1_000),
  ].join("\n");

  await user.click(view.getByPlaceholderText(/粘贴逐字稿/));
  await user.paste(content);
  await user.click(view.getByRole("button", { name: "预览自动分段" }));

  assert.ok(view.getByText("分段预览（共2段）"));
  assert.ok(view.getByText("1. 第一章 选题"));
  assert.ok(view.getByText("2. 第二章 开头 等2个章节"));
  assert.ok(view.getByText(/2109字/));
  assert.ok(view.getByText(/3121字/));
});

test("确认分段后依次提炼并显示当前进度与来源段落", async () => {
  const { render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;
  const originalFetch = globalThis.fetch;
  const first = deferredResponse();
  const second = deferredResponse();
  const requestBodies: Array<{ rawContent: string }> = [];
  let callCount = 0;
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as { rawContent: string });
    callCount += 1;
    return callCount === 1 ? first.promise : second.promise;
  };

  try {
    const view = render(
      <IPProvider>
        <KnowledgeIntakePage />
      </IPProvider>,
    );
    const user = userEvent.setup({ document });
    const content = [
      "# 第一章 选题",
      "甲".repeat(2_100),
      "## 第二章 开头",
      "乙".repeat(2_100),
      "## 第三章 结尾",
      "丙".repeat(1_000),
    ].join("\n");

    await user.click(view.getByPlaceholderText(/粘贴逐字稿/));
    await user.paste(content);
    await user.click(view.getByRole("button", { name: "预览自动分段" }));
    await user.click(view.getByRole("button", { name: "确认分段并开始提炼" }));

    assert.ok(view.getByText("正在提炼第1/2段：第一章 选题"));
    assert.equal(callCount, 1, "第一段完成前不应提前请求第二段");

    first.resolve(new Response(JSON.stringify({
      mode: "global",
      items: [buildIntakeResponseItem("选题方法")],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await waitFor(() => assert.equal(callCount, 2));
    assert.ok(view.getByText("正在提炼第2/2段：第二章 开头 等2个章节"));
    assert.ok(view.getAllByRole("button", { name: /写入通用知识库/ }).every(button =>
      (button as HTMLButtonElement).disabled), "全部分段完成前不能提前入库");
    second.resolve(new Response(JSON.stringify({
      mode: "global",
      items: [buildIntakeResponseItem("开头方法")],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await waitFor(() => assert.ok(view.getAllByText("选题方法").length > 0));
    assert.ok(view.getAllByText("开头方法").length > 0);
    assert.ok(view.getAllByText("来源：第1段·第一章 选题").length >= 1);
    assert.ok(view.getAllByText("来源：第2段·第二章 开头 等2个章节").length >= 1);
    assert.equal(requestBodies.length, 2);
    assert.ok(requestBodies.every(body => body.rawContent.length <= 4_000));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("失败分段重试必须串行完成并保留每一段的结果", async () => {
  const { render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;
  const originalFetch = globalThis.fetch;
  const firstRetry = deferredResponse();
  const secondRetry = deferredResponse();
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return new Response(JSON.stringify({
        mode: "global",
        items: [buildIntakeResponseItem("已成功的第一段")],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (callCount <= 3) {
      return new Response(JSON.stringify({ error: `第${callCount}段失败` }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    return callCount === 4 ? firstRetry.promise : secondRetry.promise;
  };

  try {
    const view = render(
      <IPProvider>
        <KnowledgeIntakePage />
      </IPProvider>,
    );
    const user = userEvent.setup({ document });
    const content = [
      "# 第一章 选题",
      "甲".repeat(2_100),
      "## 第二章 开头",
      "乙".repeat(2_100),
      "## 第三章 结尾",
      "丙".repeat(2_100),
    ].join("\n");

    await user.click(view.getByPlaceholderText(/粘贴逐字稿/));
    await user.paste(content);
    await user.click(view.getByRole("button", { name: "预览自动分段" }));
    await user.click(view.getByRole("button", { name: "确认分段并开始提炼" }));
    await waitFor(() => assert.ok(view.getByRole("button", { name: "重试第2段" })));

    await user.click(view.getByRole("button", { name: "重试第2段" }));
    assert.equal(
      (view.getByRole("button", { name: "重试第3段" }) as HTMLButtonElement).disabled,
      true,
      "一个分段重试期间必须锁住其他分段重试",
    );
    assert.ok(view.getAllByRole("button", { name: /写入通用知识库/ }).every(button =>
      (button as HTMLButtonElement).disabled), "重试期间不能入库");
    assert.ok(view.getAllByRole("button", { name: "重新输入" }).every(button =>
      (button as HTMLButtonElement).disabled), "重试期间不能清空当前结果");
    assert.ok(view.getAllByRole("combobox").every(select =>
      (select as HTMLSelectElement).disabled), "重试期间不能修改待合并卡片");

    firstRetry.resolve(new Response(JSON.stringify({
      mode: "global",
      items: [buildIntakeResponseItem("第一段重试结果")],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await waitFor(() => assert.equal(
      (view.getByRole("button", { name: "重试第3段" }) as HTMLButtonElement).disabled,
      false,
    ));

    await user.click(view.getByRole("button", { name: "重试第3段" }));
    secondRetry.resolve(new Response(JSON.stringify({
      mode: "global",
      items: [buildIntakeResponseItem("第二段重试结果")],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await waitFor(() => assert.ok(view.getAllByText("第一段重试结果").length > 0));
    assert.ok(view.getAllByText("第二段重试结果").length > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("普通单次入库不会启用长文分段去重", async () => {
  const { render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    mode: "global",
    items: [buildIntakeResponseItem("同名方法"), buildIntakeResponseItem("同名方法")],
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const view = render(
      <IPProvider>
        <KnowledgeIntakePage />
      </IPProvider>,
    );
    const user = userEvent.setup({ document });
    await user.type(view.getByPlaceholderText(/粘贴逐字稿/), "一份普通短资料");
    await user.click(view.getByRole("button", { name: "AI提炼方法" }));

    await waitFor(() => assert.ok(view.getByText("共 2 条，已选 2 条")));
    assert.equal(view.queryByText(/已自动合并/), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("IP内容理解不会启用长文分段去重", async () => {
  const { render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;
  const originalFetch = globalThis.fetch;
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([{ id: "ip-a", name: "测试IP" }]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify("ip-a"));
  globalThis.fetch = async () => new Response(JSON.stringify({
    mode: "ip",
    item: buildIntakeResponseItem("IP内容理解", {
      category: "IP表达语料",
      ipId: "ip-a",
      keywords: ["表达"],
      understanding: "老师习惯先说结论",
      keyPoints: ["结论先行"],
      relationToIP: "属于当前IP表达习惯",
    }),
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const view = render(
      <IPProvider>
        <KnowledgeIntakePage searchParams={{ scope: "ip" }} />
      </IPProvider>,
    );
    const user = userEvent.setup({ document });
    await user.type(view.getByPlaceholderText(/粘贴当前IP的逐字稿/), "老师原始内容");
    await user.click(view.getByRole("button", { name: "AI理解内容" }));

    await waitFor(() => assert.ok(view.getAllByText("IP内容理解").length > 0));
    assert.equal(view.queryByText(/已自动合并/), null);
    assert.equal(view.queryByText(/疑似重复项确认/), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("单篇内容保存前展示全库三档相似依据并由人工决定是否入库", async () => {
  const { render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;
  const originalFetch = globalThis.fetch;
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([{ id: "ip-a", name: "案例老师" }]));
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    buildExistingKnowledgeEntry("exact", {
      ipId: null,
      sourcePlatform: "课程逐字稿",
      sourceName: "第一讲",
    }),
    buildExistingKnowledgeEntry("high", {
      title: "用反常识制造选题冲突",
      rawContent: [
        "【一句话总结】\n通过反常识冲突解决知识类选题吸引力不足的问题",
        "【核心方法】\n先写出大众默认判断，再用一个真实反例完成推翻",
        "【适用场景】\n知识口播、观点短视频",
        "【AI调用方式】\n选题没有冲突时，调用真实反例重新设计切入角度",
      ].join("\n\n"),
      note: JSON.stringify({
        coreMethod: "先写出大众默认判断，再用一个真实反例完成推翻",
        applicableScenarios: ["知识口播", "观点短视频"],
        aiUsage: "选题没有冲突时，调用真实反例重新设计切入角度",
      }),
      ipId: "ip-a",
      sourcePlatform: "直播逐字稿",
      sourceName: "七月直播",
    }),
    buildExistingKnowledgeEntry("partial", {
      title: "普通观点怎样改成反常识选题",
      rawContent: [
        "【一句话总结】\n把大家熟悉的观点换一个方向表达",
        "【核心方法】\n先列出大众默认判断，再寻找能够推翻判断的反例",
        "【适用场景】\n知识口播",
        "【AI调用方式】\n寻找观点中可以被真实反例挑战的部分",
      ].join("\n\n"),
      note: JSON.stringify({
        coreMethod: "先列出大众默认判断，再寻找能够推翻判断的反例",
        applicableScenarios: ["知识口播"],
        aiUsage: "寻找观点中可以被真实反例挑战的部分",
      }),
      contentDirection: ["知识口播"],
      sourcePlatform: "文章",
      sourceName: "选题笔记",
    }),
  ]));
  globalThis.fetch = async () => new Response(JSON.stringify({
    mode: "global",
    items: [buildIntakeResponseItem("反常识选题法", {
      summary: "用反常识冲突解决普通选题缺少吸引力的问题",
      coreMethod: "先指出大众默认判断，再用真实反例推翻它",
      applicableScenarios: ["知识口播", "观点短视频"],
      aiUsage: "当选题缺少冲突时，用反例重构切入角度",
    })],
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const view = render(
      <IPProvider>
        <KnowledgeIntakePage />
      </IPProvider>,
    );
    const user = userEvent.setup({ document });
    await user.type(view.getByPlaceholderText(/粘贴逐字稿/), "一份用于验证全库查重的完整文字资料");
    await user.click(view.getByRole("button", { name: "AI提炼方法" }));

    await waitFor(() => assert.ok(view.getByText("入库前检查")));
    assert.ok(view.getByText("完全相同"));
    assert.ok(view.getByText("高度相似"));
    assert.ok(view.getByText("部分相似"));
    assert.ok(view.getByText(/标题、内容摘要、核心方法、适用场景和使用方式完全一致/));
    assert.ok(view.getByText(/反常识选题法.*选题方法库/));
    assert.ok(view.getByText(/全局知识.*课程逐字稿.*第一讲/));
    assert.ok(view.getByText(/案例老师IP.*直播逐字稿.*七月直播/));
    assert.ok(view.getByText("基础质量：未发现明显问题"));

    const knowledgeBeforeDecision = localStorage.getItem("ipwr:knowledgeEntries");
    await user.click(view.getByRole("button", { name: "暂不入库「反常识选题法」" }));
    assert.equal(localStorage.getItem("ipwr:knowledgeEntries"), knowledgeBeforeDecision);
    assert.ok(view.getAllByRole("button", { name: /写入通用知识库/ }).every(button =>
      (button as HTMLButtonElement).disabled));

    await user.click(view.getByRole("button", { name: "继续入库「反常识选题法」" }));
    await user.click(view.getAllByRole("button", { name: /写入通用知识库/ })[0]!);
    await waitFor(() => assert.ok(view.getByText("成功写入 1 条知识")));
    assert.equal(JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]").length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("IP理解模式先保存再导入相同内容时按真实保存结构识别为完全相同", async () => {
  const { render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;
  const originalFetch = globalThis.fetch;
  localStorage.setItem("ipwr:ips_v2", JSON.stringify([{ id: "ip-a", name: "测试IP" }]));
  localStorage.setItem("ipwr:activeIpId", JSON.stringify("ip-a"));
  globalThis.fetch = async () => new Response(JSON.stringify({
    mode: "ip",
    item: buildIntakeResponseItem("IP内容理解", {
      category: "IP表达语料",
      ipId: "ip-a",
      keywords: ["表达"],
      understanding: "老师习惯先说结论",
      keyPoints: ["结论先行"],
      relationToIP: "属于当前IP表达习惯",
    }),
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const view = render(
      <IPProvider>
        <KnowledgeIntakePage searchParams={{ scope: "ip" }} />
      </IPProvider>,
    );
    const user = userEvent.setup({ document });
    await user.type(view.getByPlaceholderText(/粘贴当前IP的逐字稿/), "老师原始内容");
    await user.click(view.getByRole("button", { name: "AI理解内容" }));

    await waitFor(() => assert.ok(view.getByText("入库前检查")));
    assert.ok(view.getByText("全库暂未发现相似内容"));
    await user.click(view.getByRole("button", { name: "继续入库「IP内容理解」" }));
    await user.click(view.getAllByRole("button", { name: /写入当前IP知识库/ })[0]!);
    await waitFor(() => assert.ok(view.getByText("成功写入 1 条知识")));

    const savedEntries = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{
      rawContent?: string;
    }>;
    assert.equal(savedEntries.length, 1);
    assert.equal(savedEntries[0]?.rawContent, [
      "【内容概要】\nIP内容理解摘要",
      "【AI对内容的理解】\n老师习惯先说结论",
      "【原文关键信息】\n结论先行",
      "【与当前IP的关系】\n属于当前IP表达习惯",
      "【原始内容】\n老师原始内容",
    ].join("\n\n"));

    await user.click(view.getByRole("button", { name: "继续入库" }));
    await user.type(view.getByPlaceholderText(/粘贴当前IP的逐字稿/), "老师原始内容");
    await user.click(view.getByRole("button", { name: "AI理解内容" }));

    await waitFor(() => assert.ok(view.getByText("完全相同")));
    assert.ok(view.getByText(/IP内容理解.*IP表达语料/));
    assert.ok(view.getByText(/测试IP.*IP内容理解入库/));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("单段失败不清除成功结果并且可以只重试失败段", async () => {
  const { render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<{ rawContent: string }> = [];
  let callCount = 0;
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as { rawContent: string });
    callCount += 1;
    if (callCount === 1) {
      return new Response(JSON.stringify({
        mode: "global",
        items: [buildIntakeResponseItem("已成功的方法")],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (callCount === 2) {
      return new Response(JSON.stringify({ error: "第二段返回格式不完整" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      mode: "global",
      items: [buildIntakeResponseItem("重试成功的方法")],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const view = render(
      <IPProvider>
        <KnowledgeIntakePage />
      </IPProvider>,
    );
    const user = userEvent.setup({ document });
    const content = [
      "# 第一章 选题",
      "甲".repeat(2_100),
      "## 第二章 开头",
      "乙".repeat(2_100),
      "## 第三章 结尾",
      "丙".repeat(1_000),
    ].join("\n");

    await user.click(view.getByPlaceholderText(/粘贴逐字稿/));
    await user.paste(content);
    await user.click(view.getByRole("button", { name: "预览自动分段" }));
    await user.click(view.getByRole("button", { name: "确认分段并开始提炼" }));

    await waitFor(() => assert.ok(view.getByText("第二段返回格式不完整")));
    assert.ok(view.getAllByText("已成功的方法").length > 0);
    assert.equal(callCount, 2);

    await user.click(view.getByRole("button", { name: "重试第2段" }));

    await waitFor(() => assert.ok(view.getAllByText("重试成功的方法").length > 0));
    assert.ok(view.getAllByText("已成功的方法").length > 0, "重试失败段不能清除其他段的成功结果");
    assert.equal(callCount, 3);
    assert.equal(requestBodies[2]?.rawContent, requestBodies[1]?.rawContent, "重试只能重新提交失败段");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("长文档批次内完全重复只提示并保留全部内容供人工选择", async () => {
  const { render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    const items = callCount === 1
      ? [
          buildIntakeResponseItem("数字标题法", {
            summary: "用具体数字解决标题信息模糊的问题",
            coreMethod: "把抽象收益改写成可核对的数字和结果",
            applicableScenarios: ["产品测评", "经验教程"],
            aiUsage: "标题缺少具体信息时，补充可验证的数字结果",
            tags: ["去重样本一"],
            triggerKeywords: ["冲突"],
          }),
          buildIntakeResponseItem("价值冲突选题法", {
            summary: "用价值冲突解决知识选题吸引力不足的问题",
            coreMethod: "先写出大众默认判断，再用一个真实反例完成推翻",
            applicableScenarios: ["知识口播", "观点短视频"],
            aiUsage: "选题没有冲突时，调用真实反例重新设计切入角度",
            tags: ["疑似样本一"],
            triggerKeywords: ["价值冲突"],
          }),
        ]
      : [
          buildIntakeResponseItem("数字标题法", {
            summary: "用具体数字解决标题信息模糊的问题",
            coreMethod: "把抽象收益改写成可核对的数字和结果",
            applicableScenarios: ["产品测评", "经验教程"],
            aiUsage: "标题缺少具体信息时，补充可验证的数字结果",
            examples: [{ input: "快速提升效率", output: "3步把整理时间缩短一半" }],
            tags: ["去重样本二"],
            triggerKeywords: ["冲突"],
          }),
          buildIntakeResponseItem("用价值冲突重构选题", {
            summary: "通过价值冲突解决知识类选题吸引力不足的问题",
            coreMethod: "先写出大众默认判断，再用真实反例把它推翻",
            applicableScenarios: ["知识口播", "观点短视频"],
            aiUsage: "知识选题没有冲突时，用真实反例重新设计切入角度",
            tags: ["疑似样本二"],
            triggerKeywords: ["价值冲突"],
          }),
        ];
    return new Response(JSON.stringify({ mode: "global", items }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const view = render(
      <IPProvider>
        <KnowledgeIntakePage />
      </IPProvider>,
    );
    const user = userEvent.setup({ document });
    const content = [
      "# 第一章 选题",
      "甲".repeat(2_100),
      "## 第二章 开头",
      "乙".repeat(2_100),
      "## 第三章 结尾",
      "丙".repeat(1_000),
    ].join("\n");

    await user.click(view.getByPlaceholderText(/粘贴逐字稿/));
    await user.paste(content);
    await user.click(view.getByRole("button", { name: "预览自动分段" }));
    await user.click(view.getByRole("button", { name: "确认分段并开始提炼" }));

    await waitFor(() => assert.ok(view.getByText("发现1张批次内完全相同的方法卡，系统未自动合并，请逐条确认是否继续入库。")));
    assert.ok(view.getByText("疑似重复组1"));
    assert.equal(view.getAllByText("数字标题法").length, 2);
    assert.ok(view.getAllByText("来源：第1段·第一章 选题").length >= 1);
    assert.ok(view.getAllByText("来源：第2段·第二章 开头 等2个章节").length >= 1);
    assert.equal(view.queryByText(/已自动合并/), null);
    assert.equal(view.getAllByRole("button", { name: /继续入库「数字标题法」/ }).length, 2);
    assert.equal(view.getAllByRole("button", { name: /暂不入库「数字标题法」/ }).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("通用智能入库可切换原文保真模式并在人工确认后逐字保存且不调用AI", async () => {
  const { render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("保真模式不应调用AI接口");
  };
  const originalTemplate = "# 标准诊断Prompt\n\n请逐字保留“中文引号”和固定输出格式。\n";
  localStorage.setItem("ipwr:knowledgeEntries", JSON.stringify([
    buildExistingKnowledgeEntry("existing-template", {
      title: "历史诊断模板",
      category: "文案框架方法库",
      rawContent: originalTemplate,
      sourcePlatform: "用户提供文档",
      sourceName: "旧版模板.md",
    }),
  ]));

  try {
    const view = render(
      <IPProvider>
        <KnowledgeIntakePage />
      </IPProvider>,
    );
    const user = userEvent.setup({ document });

    await user.click(view.getByRole("button", { name: "原文保真保存" }));
    assert.ok(view.getByRole("heading", { level: 1, name: "原文保真保存" }));
    assert.equal(view.queryByText(/AI自动提炼成可复用的短视频方法知识/), null);
    assert.ok(view.getByText("不会调用AI，正文将逐字保存"));
    await user.type(view.getByLabelText("模板标题"), "精准客户行为诊断法｜标准执行模板v1");
    await user.selectOptions(view.getByLabelText("保存分类"), "文案框架方法库");
    await user.type(view.getByLabelText("来源名称"), "FlowPilot_精准客户行为诊断法.md");
    await user.type(view.getByLabelText("模板标识"), "precise-customer-behavior-diagnosis");
    await user.clear(view.getByLabelText("模板版本"));
    await user.type(view.getByLabelText("模板版本"), "1.0.0");
    await user.type(view.getByLabelText("模板正文"), originalTemplate);
    await user.click(view.getByRole("button", { name: "检查入库内容" }));

    assert.equal(fetchCalls, 0);
    assert.ok(view.getByText("入库前检查"));
    assert.ok(view.getByText("完全相同"));
    assert.ok(view.getByText(/历史诊断模板.*文案框架方法库/));
    assert.ok(view.getByText(/用户提供文档.*旧版模板.md/));
    assert.equal(JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]").length, 1);

    await user.click(view.getByRole("button", { name: "继续保真保存" }));
    await user.click(view.getByRole("button", { name: "确认并保真保存" }));

    await waitFor(() => assert.ok(view.getByText("执行模板已保真保存")));
    const saveButton = view.getByRole("button", { name: "已保真保存" }) as HTMLButtonElement;
    assert.equal(saveButton.disabled, true);
    assert.equal(fetchCalls, 0);
    const savedEntries = JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{
      rawContent?: string;
      executionTemplate?: { templateKey?: string; version?: string };
    }>;
    assert.equal(savedEntries.length, 2);
    assert.equal(savedEntries[1]?.rawContent, originalTemplate);
    assert.equal(savedEntries[1]?.executionTemplate?.templateKey, "precise-customer-behavior-diagnosis");
    assert.equal(savedEntries[1]?.executionTemplate?.version, "1.0.0");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("原文保真模式不向IP理解开放且严格写入失败后可以重试", async () => {
  const { fireEvent, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;

  const ipView = render(
    <IPProvider>
      <KnowledgeIntakePage searchParams={{ scope: "ip" }} />
    </IPProvider>,
  );
  assert.equal(ipView.queryByRole("button", { name: "原文保真保存" }), null);
  ipView.unmount();

  const view = render(
    <IPProvider>
      <KnowledgeIntakePage />
    </IPProvider>,
  );
  const user = userEvent.setup({ document });
  await user.click(view.getByRole("button", { name: "原文保真保存" }));
  fireEvent.change(view.getByLabelText("模板标题"), { target: { value: "可重试模板" } });
  fireEvent.change(view.getByLabelText("来源名称"), { target: { value: "重试测试.md" } });
  fireEvent.change(view.getByLabelText("模板标识"), { target: { value: "retryable-template" } });
  fireEvent.change(view.getByLabelText("模板版本"), { target: { value: "1.0.0" } });
  fireEvent.change(view.getByLabelText("模板正文"), { target: { value: "这是一份用于验证严格写入失败后可以安全重试的完整模板正文。" } });
  await user.click(view.getByRole("button", { name: "检查入库内容" }));
  await user.click(view.getByRole("button", { name: "继续保真保存" }));

  const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
  const originalSetItem = storagePrototype.setItem;
  let shouldFail = true;
  storagePrototype.setItem = function setItem(key: string, value: string) {
    if (shouldFail && key === "ipwr:knowledgeEntries") throw new Error("quota");
    return originalSetItem.call(this, key, value);
  };
  try {
    await user.click(view.getByRole("button", { name: "确认并保真保存" }));
    await waitFor(() => assert.ok(view.getByRole("alert").textContent?.includes("执行模板保存失败")));
    const retryButton = view.getByRole("button", { name: "确认并保真保存" }) as HTMLButtonElement;
    assert.equal(retryButton.disabled, false);
    assert.equal(JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]").length, 0);

    shouldFail = false;
    await user.click(retryButton);
    await waitFor(() => assert.ok(view.getByText("执行模板已保真保存")));
    assert.equal(JSON.parse(localStorage.getItem("ipwr:knowledgeEntries") ?? "[]").length, 1);
  } finally {
    storagePrototype.setItem = originalSetItem;
  }
});

test("保真模式全库检查读取失败时明确提示并允许重新检查", async () => {
  const { fireEvent, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { IPProvider } = await import("./ip-context");
  const KnowledgeIntakePage = (await import("../app/knowledge-intake/page")).default;
  const view = render(
    <IPProvider>
      <KnowledgeIntakePage />
    </IPProvider>,
  );
  const user = userEvent.setup({ document });
  await user.click(view.getByRole("button", { name: "原文保真保存" }));
  fireEvent.change(view.getByLabelText("模板标题"), { target: { value: "检查重试模板" } });
  fireEvent.change(view.getByLabelText("来源名称"), { target: { value: "检查重试.md" } });
  fireEvent.change(view.getByLabelText("模板标识"), { target: { value: "precheck-retry-template" } });
  fireEvent.change(view.getByLabelText("模板正文"), { target: { value: "这是一份用于验证全库检查读取失败后能够安全重试的完整正文。" } });

  const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
  const originalGetItem = storagePrototype.getItem;
  let shouldFail = true;
  storagePrototype.getItem = function getItem(key: string) {
    if (shouldFail && key === "ipwr:knowledgeEntries") throw new Error("storage unavailable");
    return originalGetItem.call(this, key);
  };
  try {
    await user.click(view.getByRole("button", { name: "检查入库内容" }));
    await waitFor(() => assert.ok(view.getByRole("alert").textContent?.includes("入库前检查失败")));
    assert.ok(view.getByRole("button", { name: "重新检查" }));
    assert.equal(view.queryByText("入库前检查"), null);

    shouldFail = false;
    await user.click(view.getByRole("button", { name: "重新检查" }));
    await waitFor(() => assert.ok(view.getByText("入库前检查")));
    assert.equal(view.queryByRole("alert"), null);
  } finally {
    storagePrototype.getItem = originalGetItem;
  }
});
