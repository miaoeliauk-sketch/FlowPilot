import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/copy-integration",
    pretendToBeVisual: true,
  });
  Object.defineProperty(dom.window.navigator, "locks", {
    configurable: true,
    value: {
      async request(_name: string, operation: () => unknown) {
        return operation();
      },
    },
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

let restoreBrowser: (() => void) | undefined;

before(() => {
  restoreBrowser = installBrowserEnvironment();
});

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
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

test("用户提交两份素材后按固定顺序看到四部分整合结果", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: { sources?: Array<{ name: string; content: string; contentWeight?: number }> } = {};
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      draft: {
        sections: [{
          heading: "信任与成交",
          paragraphs: [{ text: "信任是影响成交的重要因素。", sourceIds: ["source-1", "source-2"] }],
        }],
        fullText: "## 信任与成交\n\n信任是影响成交的重要因素。",
      },
      decisionSummary: {
        items: [
          "关于建立信任所需时间，素材1和素材2存在冲突：需要7天 vs 需要30天。正式使用前需确定统一立场。",
          "另有1处内容标记为依据不足，详见下文“未采用及依据不足内容”部分。",
        ],
      },
      conflicts: [{
        topic: "建立信任所需时间",
        conflictPoint: "建立信任需要7天还是30天",
        alternatives: [
          { brief: "需要7天", text: "素材1认为建立信任需要7天。", sourceIds: ["source-1"] },
          { brief: "需要30天", text: "素材2认为建立信任需要30天。", sourceIds: ["source-2"] },
        ],
      }],
      contentReview: {
        exclusions: [{
          summary: "2026年10月一定完成转变",
          reason: "属于缺乏依据的具体时间断言",
          sourceIds: ["source-1"],
        }],
        evidenceGaps: [{
          summary: "建立信任周期存在固定规律",
          reason: "缺乏可核实的权威来源，但仍有整理价值",
          sourceIds: ["source-2"],
        }],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const CopyIntegrationPage = (await import("../app/copy-integration/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<CopyIntegrationPage />);

    const nameInputs = view.getAllByLabelText("素材名称");
    const contentInputs = view.getAllByLabelText("素材正文");
    const weightInputs = view.getAllByLabelText(/文案\d+内容份额/);
    assert.equal(weightInputs.length, 2);
    await user.clear(weightInputs[0]);
    await user.type(weightInputs[0], "3");
    await user.clear(weightInputs[1]);
    await user.type(weightInputs[1], "7");
    await user.clear(nameInputs[0]);
    await user.type(nameInputs[0], "逐字稿");
    await user.type(contentInputs[0], "客户不买，是因为缺乏信任。建立信任需要7天。");
    await user.clear(nameInputs[1]);
    await user.type(nameInputs[1], "笔记");
    await user.type(contentInputs[1], "成交困难源于客户不信任。建立信任需要30天。");
    assert.ok(view.getByText("约30%"));
    assert.ok(view.getByText("约70%"));
    await user.click(view.getByRole("button", { name: "开始整合" }));

    assert.equal(requestBody.sources?.length, 2);
    assert.equal(requestBody.sources?.[0].name, "逐字稿");
    assert.deepEqual(requestBody.sources?.map(source => source.contentWeight), [3, 7]);
    const draftHeading = await view.findByRole("heading", { name: "内容母稿" });
    const summaryHeading = view.getByRole("heading", { name: "决策摘要" });
    const conflictsHeading = view.getByRole("heading", { name: "待确认冲突" });
    const reviewHeading = view.getByRole("heading", { name: "未采用及依据不足内容" });

    assert.ok(draftHeading.compareDocumentPosition(summaryHeading) & Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(summaryHeading.compareDocumentPosition(conflictsHeading) & Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(conflictsHeading.compareDocumentPosition(reviewHeading) & Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(view.getByText("信任是影响成交的重要因素。"));
    assert.ok(view.getByText(/关于建立信任所需时间，素材1和素材2存在冲突/));
    assert.ok(view.getByText("两者矛盾点在于：建立信任需要7天还是30天"));
    assert.ok(view.getByText("素材1认为建立信任需要7天。"));
    assert.ok(view.getByText("素材2认为建立信任需要30天。"));
    assert.ok(view.getByRole("heading", { name: "未采用" }));
    assert.ok(view.getByRole("heading", { name: "依据不足／建议核实" }));
    assert.ok(view.getByText("2026年10月一定完成转变"));
    assert.ok(view.getByText("建立信任周期存在固定规律"));
    assert.equal(view.queryByText("重复观点合并"), null);

    await user.clear(nameInputs[0]);
    await user.type(nameInputs[0], "改名后的素材");
    assert.ok(view.getAllByText("逐字稿").length > 0);
    assert.equal(view.queryByText("改名后的素材"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("排除候选在用户确认前保留在母稿并支持逐条保留或排除", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    draft: {
      sections: [
        { heading: "信任观点", paragraphs: [{ text: "信任是成交的前提。", sourceIds: ["source-1"] }] },
        { heading: "口播过渡", paragraphs: [{ text: "你听懂了吗？", sourceIds: ["source-2"], exclusionCandidateIds: ["candidate-1"] }] },
      ],
      fullText: "## 信任观点\n\n信任是成交的前提。\n\n## 口播过渡\n\n你听懂了吗？",
    },
    decisionSummary: { items: ["另有1处疑似口播支架，需确认保留或排除。"] },
    conflicts: [],
    exclusionCandidates: [{
      id: "candidate-1",
      summary: "你听懂了吗？",
      reason: "疑似口播过渡或结构提示，建议确认是否排除",
      sourceIds: ["source-2"],
    }],
    contentReview: { exclusions: [], evidenceGaps: [] },
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const CopyIntegrationPage = (await import("../app/copy-integration/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<CopyIntegrationPage />);
    const contentInputs = view.getAllByLabelText("素材正文");
    await user.type(contentInputs[0], "信任是成交的前提。");
    await user.type(contentInputs[1], "你听懂了吗？");
    await user.click(view.getByRole("button", { name: "开始整合" }));

    assert.ok(await view.findByRole("heading", { name: "待确认排除候选" }));
    assert.ok(view.getAllByText("你听懂了吗？").length >= 2);
    assert.equal(view.queryByRole("button", { name: "保存母稿" }), null);
    assert.ok(view.getByText("请先处理全部排除候选，再保存母稿。"));
    await user.click(view.getByRole("button", { name: "保留进母稿" }));
    assert.equal(view.queryByRole("heading", { name: "待确认排除候选" }), null);
    assert.ok(view.getByRole("heading", { name: "口播过渡" }));
    assert.ok(view.getByText("已保留"));
    assert.ok(view.getByRole("button", { name: "保存母稿" }));
    assert.equal(view.queryByText("另有1处疑似口播支架，需确认保留或排除。"), null);
    assert.ok(view.getByText("当前没有需要老师决策或核实的事项。"));

    await user.click(view.getByRole("button", { name: "开始整合" }));
    await view.findByRole("heading", { name: "待确认排除候选" });
    assert.equal(view.queryByText("已保留"), null);
    await user.click(view.getByRole("button", { name: "确认排除" }));
    assert.equal(view.queryByRole("heading", { name: "待确认排除候选" }), null);
    assert.equal(view.queryByRole("heading", { name: "口播过渡" }), null);
    assert.ok(view.getByText("已排除"));
    assert.ok(view.getByText(/用户确认排除/));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("页面最多允许添加10份素材", async () => {
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const CopyIntegrationPage = (await import("../app/copy-integration/page")).default;
  const user = userEvent.setup({ document });
  const view = render(<CopyIntegrationPage />);
  const addButton = view.getByRole("button", { name: "＋ 添加素材" });

  for (let index = 0; index < 9; index += 1) {
    await user.click(addButton);
  }

  assert.equal(view.getAllByLabelText("素材正文").length, 10);
  assert.equal(view.getAllByLabelText(/文案\d+内容份额/).length, 10);
  assert.equal((addButton as HTMLButtonElement).disabled, true);
});

test("空白文案不参与页面内容份额计算", async () => {
  const { render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const CopyIntegrationPage = (await import("../app/copy-integration/page")).default;
  const user = userEvent.setup({ document });
  const view = render(React.createElement(CopyIntegrationPage));
  try {
    await user.click(view.getByRole("button", { name: /添加素材/ }));
    const contentInputs = view.getAllByLabelText("素材正文");
    await user.type(contentInputs[0], "第一篇文案");
    await user.type(contentInputs[1], "第二篇文案");

    assert.equal(view.getAllByText("约50%").length, 2);
    assert.equal(view.getAllByText("填写正文后参与计算").length, 1);
  } finally {
    view.unmount();
  }
});

test("未保存的整合结果不分配编号，点击保存后生成母稿和片段编号", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    draft: {
      sections: [
        {
          heading: "信任是成交的前提",
          paragraphs: [{ text: "客户愿意购买，首先取决于信任是否建立。", sourceIds: ["source-1", "source-2"] }],
        },
        {
          heading: "信任需要长期积累",
          paragraphs: [{ text: "稳定兑现承诺，才能逐步形成信任。", sourceIds: ["source-2"] }],
        },
      ],
      fullText: "## 信任是成交的前提\n\n客户愿意购买，首先取决于信任是否建立。\n\n## 信任需要长期积累\n\n稳定兑现承诺，才能逐步形成信任。",
    },
    decisionSummary: { items: ["当前没有需要老师决策或核实的事项。"] },
    conflicts: [],
    contentReview: { exclusions: [], evidenceGaps: [] },
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const { render } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const CopyIntegrationPage = (await import("../app/copy-integration/page")).default;
    const user = userEvent.setup({ document });
    const view = render(<CopyIntegrationPage />);

    const contentInputs = view.getAllByLabelText("素材正文");
    await user.type(contentInputs[0], "客户不买，是因为缺乏信任。");
    await user.type(contentInputs[1], "信任需要持续积累。");
    await user.click(view.getByRole("button", { name: "开始整合" }));

    const titleInput = await view.findByLabelText("母稿标题");
    assert.equal((titleInput as HTMLInputElement).value, "信任是成交的前提");
    assert.equal(view.queryByText(/^母稿编号：/), null);
    await user.clear(titleInput);
    await user.type(titleInput, "客户信任母稿");
    await user.click(view.getByRole("button", { name: "保存母稿" }));

    assert.ok(await view.findByText(/^母稿编号：MG-\d{8}-001$/));
    assert.ok(view.getByText(/^MG-\d{8}-001-P01$/));
    assert.ok(view.getByText(/^MG-\d{8}-001-P02$/));
    assert.ok(view.getByRole("heading", { name: "决策摘要" }));
    assert.ok(view.getByRole("heading", { name: "待确认冲突" }));
    assert.ok(view.getByRole("heading", { name: "未采用及依据不足内容" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("保存后的片段可以修改标题、合并相邻片段并在光标处拆分", async () => {
  const { fireEvent, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { ContentMasterEditor } = await import("../components/ContentMasterEditor");
  const user = userEvent.setup({ document });
  let latestFullText = "";
  const view = render(<ContentMasterEditor
    sections={[
      {
        heading: "信任是成交的前提",
        paragraphs: [{ text: "客户愿意购买，首先取决于信任是否建立。", sourceIds: ["source-1", "source-2"] }],
      },
      {
        heading: "信任需要长期积累",
        paragraphs: [{ text: "稳定兑现承诺，才能逐步形成信任。", sourceIds: ["source-2"] }],
      },
    ]}
    sources={[
      { id: "source-1", name: "素材1" },
      { id: "source-2", name: "素材2" },
    ]}
    onDraftChange={draft => {
      latestFullText = draft?.fullText ?? "";
    }}
  />);

  await user.click(view.getByRole("button", { name: "保存母稿" }));
  const idText = (await view.findByText(/^母稿编号：MG-\d{8}-001$/)).textContent ?? "";
  const draftId = idText.replace("母稿编号：", "");
  const firstId = `${draftId}-P01`;
  const secondId = `${draftId}-P02`;

  const firstHeading = view.getByLabelText(`片段小标题 ${firstId}`);
  await user.clear(firstHeading);
  await user.type(firstHeading, "先建立基本信任");
  await user.click(view.getByRole("button", { name: `保存片段标题 ${firstId}` }));
  assert.equal((firstHeading as HTMLInputElement).value, "先建立基本信任");

  await user.click(view.getByRole("button", { name: `合并片段 ${firstId} 与 ${secondId}` }));
  const mergedId = `${draftId}-P03`;
  assert.ok(await view.findByText(mergedId));
  assert.equal(view.queryByText(firstId), null);
  assert.equal(view.queryByText(secondId), null);

  const mergedContent = view.getByLabelText(`片段正文 ${mergedId}`) as HTMLTextAreaElement;
  const splitAt = mergedContent.value.indexOf("稳定兑现承诺");
  mergedContent.setSelectionRange(splitAt, splitAt);
  fireEvent.select(mergedContent);
  await user.click(view.getByRole("button", { name: `在光标处拆分 ${mergedId}` }));

  assert.ok(await view.findByText(`${draftId}-P04`));
  assert.ok(view.getByText(`${draftId}-P05`));
  assert.equal(view.queryByText(mergedId), null);
  assert.equal(latestFullText,
    "## 先建立基本信任与信任需要长期积累（上）\n\n客户愿意购买，首先取决于信任是否建立。\n\n## 先建立基本信任与信任需要长期积累（下）\n\n稳定兑现承诺，才能逐步形成信任。");
});
