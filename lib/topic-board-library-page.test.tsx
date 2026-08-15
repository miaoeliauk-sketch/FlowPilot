import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import {
  addTopicAsset,
  getTopicAssets,
  updateTopicAssetEvaluation,
} from "./ip-store";
import {
  createTopicBoardIPProfile,
  createValidTopicBoardResult,
} from "./topic-board-contract.fixture";

function createEvaluatedResult(topic: string) {
  const result = createValidTopicBoardResult();
  result.topic = topic;
  result.decisionStatus = "evaluated";
  result.aiBaseScore = 74;
  result.evidenceAdjustment = 6;
  result.evidenceAdjustmentItems = [{
    sampleId: "sample-water-01",
    title: "水木然历史高表现选题",
    performanceLevel: "高表现",
    adjustment: 6,
    reason: "同类认知选题在当前IP下有过高表现记录。",
  }];
  result.finalReferenceScore = 80;
  result.confidenceLevel = "中";
  result.confidenceReason = "目前只有1条同类历史证据，建议先小范围测试。";
  result.totalScore = 80;
  result.scoreDisplay = "80";
  return result;
}

function createBlockedResult(topic: string) {
  const result = createValidTopicBoardResult();
  result.topic = topic;
  result.decisionStatus = "blocked";
  result.aiBaseScore = null;
  result.evidenceAdjustment = 0;
  result.evidenceAdjustmentItems = [];
  result.finalReferenceScore = null;
  result.confidenceLevel = null;
  result.confidenceReason = "安全边界已触发，本次不进行内容评分。";
  result.safetyVeto = true;
  result.safetyVetoReason = "存在不可控的合规风险。";
  result.chiefOfficer = null;
  result.totalScore = null;
  result.scoreDisplay = null;
  result.finalRecommendation = null;
  result.riskLevel = null;
  result.level = "已阻断";
  return result;
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

function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("页面没有发出董事会请求")), timeoutMs);
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

test("董事会自动保存到发起请求的IP并按当前IP管理历史状态", async () => {
  const restoreBrowser = installBrowserEnvironment();
  const originalFetch = globalThis.fetch;
  let cleanupPage: (() => void) | undefined;

  const shuimuran = createTopicBoardIPProfile();
  const shikong = createTopicBoardIPProfile({
    id: "ip-shikong",
    name: "设计师石空",
    avatar: "石",
    positioning: "住宅设计师",
    audience: "准备装修的业主",
    contentDirection: ["住宅设计"],
  });
  const oldWaterTopic = "水木然历史选题";
  const oldShikongTopic = "石空历史选题";
  const newTopic = "聪明人为什么越来越焦虑";

  let resolveCapturedRequest!: (body: Record<string, unknown>) => void;
  const capturedRequest = new Promise<Record<string, unknown>>(resolve => {
    resolveCapturedRequest = resolve;
  });
  let releaseBoardResponse!: () => void;

  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/topic-review") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      resolveCapturedRequest(body);
      return new Promise<Response>(resolve => {
        releaseBoardResponse = () => {
          const result = createEvaluatedResult(newTopic);
          const expertRoles = [
            "用户需求专家",
            "流量运营总监",
            "平台算法顾问",
            "商业变现顾问",
            "内容创作专家",
            "IP价值顾问",
            "竞争分析专家",
            "爆款基因分析师",
            "安全合规官",
          ];
          const baseExpert = result.experts[0];
          result.experts = expertRoles.map((role, index) => ({
            ...baseExpert,
            role,
            color: index === expertRoles.length - 1 ? "#8A8A86" : baseExpert.color,
            veto: false,
            vetoReason: null,
          }));
          result.weights = result.experts.map(expert => ({
            role: expert.role,
            score: expert.finalScore,
            weight: expert.weight,
            contribution: expert.finalScore * expert.weight,
          }));
          result.votes = [
            ...result.experts.map(expert => ({ role: expert.role, vote: expert.vote })),
            { role: "首席反对官", vote: "反对" },
          ];
          result.ipId = shuimuran.id;
          result.ipName = shuimuran.name;
          resolve(new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }));
        };
      });
    }
    return new Response(JSON.stringify({ results: [], debug: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([shuimuran, shikong]));
    localStorage.setItem("ipwr:activeIpId", JSON.stringify(shuimuran.id));
    localStorage.setItem("ipwr:defaultIPsInitialized:v1", JSON.stringify(true));

    const waterHistoryResult = createValidTopicBoardResult();
    waterHistoryResult.topic = oldWaterTopic;
    const waterHistory = addTopicAsset({ ipId: shuimuran.id, title: oldWaterTopic, source: "manual" });
    updateTopicAssetEvaluation(waterHistory.id, waterHistoryResult);

    const shikongHistoryResult = createValidTopicBoardResult();
    shikongHistoryResult.topic = oldShikongTopic;
    shikongHistoryResult.ipId = shikong.id;
    shikongHistoryResult.ipName = shikong.name;
    const shikongHistory = addTopicAsset({ ipId: shikong.id, title: oldShikongTopic, source: "manual" });
    updateTopicAssetEvaluation(shikongHistory.id, shikongHistoryResult);

    const blockedTopic = "存在合规风险的选题";
    const blockedAsset = addTopicAsset({ ipId: shuimuran.id, title: blockedTopic, source: "manual" });
    updateTopicAssetEvaluation(blockedAsset.id, createBlockedResult(blockedTopic));

    const { act, cleanup, render, screen, within } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const userEvent = (await import("@testing-library/user-event")).default;
    const { IPProvider } = await import("./ip-context");
    const AppLayout = (await import("../components/layout/AppLayout")).default;
    const TopicBoardPage = (await import("../app/topic-board/page")).default;
    const user = userEvent.setup({ document });

    render(
      <IPProvider>
        <AppLayout>
          <TopicBoardPage />
        </AppLayout>
      </IPProvider>,
    );

    const historyRegion = await screen.findByRole("region", { name: "当前IP选题历史" });
    assert.ok(within(historyRegion).getByText(oldWaterTopic));
    assert.equal(within(historyRegion).queryByText(oldShikongTopic), null);

    const topicInput = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.clear(topicInput);
    await user.type(topicInput, newTopic);
    const requestBody = await act(async () => {
      await user.click(screen.getByRole("button", { name: "召开董事会" }));
      return waitWithTimeout(capturedRequest, 7000);
    });
    assert.equal((requestBody.ipProfile as { id?: string } | undefined)?.id, shuimuran.id);

    const currentIPLabel = await screen.findByText("当前操盘IP");
    const currentIPButton = currentIPLabel.closest("button");
    assert.ok(currentIPButton);
    await user.click(currentIPButton);
    await user.click(screen.getByRole("button", { name: /设计师石空/ }));

    await act(async () => {
      releaseBoardResponse();
    });
    await screen.findByText(/评估已保存到水木然的选题库/);

    assert.equal(getTopicAssets(shuimuran.id).some(asset => asset.title === newTopic), true);
    assert.equal(getTopicAssets(shikong.id).some(asset => asset.title === newTopic), false);
    assert.ok(within(historyRegion).getByText(oldShikongTopic));
    assert.equal(within(historyRegion).queryByText(newTopic), null);

    await user.click(currentIPButton);
    await user.click(screen.getByRole("button", { name: /水木然/ }));
    await within(historyRegion).findByText(newTopic);

    await user.click(screen.getByRole("button", { name: `查看选题“${newTopic}”完整评估` }));
    assert.ok(await screen.findByText("小白决策建议"));
    assert.ok(screen.getByText("AI评审基础分"));
    assert.ok(screen.getByText("74"));
    assert.ok(screen.getByText("证据调整"));
    assert.ok(screen.getByText("+6"));
    assert.ok(screen.getByText("水木然历史高表现选题"));
    assert.ok(screen.getByText(/sample-water-01/));
    assert.ok(screen.getByText("最终参考分"));
    assert.ok(screen.getByText("80"));
    assert.ok(screen.getByText("可信度评级"));
    assert.ok(screen.getByText("中"));
    assert.ok(screen.getByText("目前只有1条同类历史证据，建议先小范围测试。"));
    assert.ok(screen.getByText("AI负责内容价值判断"));
    assert.ok(screen.getByText("历史证据只做有限调整，范围不超过±10分"));
    assert.ok(screen.getByText("固定规则只负责边界和阻断，不参与内容打分"));
    assert.ok(screen.getByText("AI多角色评审团 · 7阶段评审 · 完整推理链"));
    assert.equal(screen.queryByText(/9位专家/), null);

    await user.click(screen.getByRole("button", { name: `查看选题“${oldWaterTopic}”完整评估` }));
    assert.ok(await screen.findByText("透明评分"));
    assert.equal(screen.queryByText("AI评审基础分"), null);

    await user.click(screen.getByRole("button", { name: `查看选题“${blockedTopic}”完整评估` }));
    assert.ok(await screen.findByText("本次评审已阻断"));
    assert.ok(screen.getByText("存在不可控的合规风险。"));
    assert.ok(screen.getByText("安全边界已触发，本次不进行内容评分。"));
    assert.equal(screen.queryByText("AI评审基础分"), null);
    assert.equal(screen.queryByText("证据调整"), null);
    assert.equal(screen.queryByText("可信度评级"), null);
    assert.equal(screen.queryByText("透明评分"), null);
    assert.equal(screen.queryByText("综合评分计算"), null);
    assert.equal(screen.queryByText("首席反对官"), null);

    await user.click(screen.getByRole("button", { name: `将选题“${newTopic}”标记为已采用` }));
    assert.equal(getTopicAssets(shuimuran.id).find(asset => asset.title === newTopic)?.status, "已采用");

    await user.click(screen.getByRole("button", { name: `将选题“${newTopic}”标记为已拍摄` }));
    assert.equal(getTopicAssets(shuimuran.id).find(asset => asset.title === newTopic)?.status, "已拍摄");

    await user.click(screen.getByRole("button", { name: `将选题“${oldWaterTopic}”标记为已废弃` }));
    assert.equal(getTopicAssets(shuimuran.id).find(asset => asset.title === oldWaterTopic)?.status, "已废弃");

    const storedAssetIdsBeforeFailure = getTopicAssets(shuimuran.id).map(asset => asset.id).sort();
    globalThis.fetch = async (input) => {
      if (String(input) === "/api/topic-review") {
        return new Response(JSON.stringify({
          error: "安全校验异常，无法确认，请稍后重试。",
          errorCode: "SAFETY_REVIEW_INVALID",
          errorStage: "expert:安全合规官",
        }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ results: [], debug: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await user.clear(topicInput);
    await user.type(topicInput, "安全字段缺失时不应保存");
    await user.click(screen.getByRole("button", { name: "召开董事会" }));
    await screen.findByText("安全校验异常，无法确认，请稍后重试。", {}, { timeout: 7000 });

    assert.deepEqual(
      getTopicAssets(shuimuran.id).map(asset => asset.id).sort(),
      storedAssetIdsBeforeFailure,
    );
    assert.equal(screen.queryByText("小白决策建议"), null);
    assert.equal(screen.queryByText("最终董事会决议"), null);
  } finally {
    cleanupPage?.();
    globalThis.fetch = originalFetch;
    restoreBrowser();
  }
});
