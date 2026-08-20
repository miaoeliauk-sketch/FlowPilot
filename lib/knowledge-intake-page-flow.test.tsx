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
    assert.ok(view.getByText("来源：第1段·第一章 选题"));
    assert.ok(view.getByText("来源：第2段·第二章 开头 等2个章节"));
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

test("汇总后自动合并完全重复项并要求用户处理疑似重复组", async () => {
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

    await waitFor(() => assert.ok(view.getByText("已自动合并1张完全重复方法卡，来源章节已保留。")));
    assert.ok(view.getByText("疑似重复组1"));
    assert.equal(view.getAllByText("数字标题法").length, 1);
    assert.ok(view.getAllByText("来源：第1段·第一章 选题、第2段·第二章 开头 等2个章节").length >= 1);
    const saveButton = view.getAllByRole("button", { name: /写入通用知识库/ })[0] as HTMLButtonElement;
    assert.equal(saveButton.disabled, true, "疑似重复组确认前不应允许入库");

    await user.click(view.getByRole("button", { name: "合并这组" }));

    await waitFor(() => assert.equal(view.queryByText("疑似重复组1"), null));
    assert.equal((view.getAllByRole("button", { name: /写入通用知识库/ })[0] as HTMLButtonElement).disabled, false);
    assert.ok(view.getAllByText("来源：第1段·第一章 选题、第2段·第二章 开头 等2个章节").length >= 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
