import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/topic-review/route";
import { buildTopicReviewRequestPayload } from "./topic-review-request";
import type { IPProfile } from "./types";

const SHUIMURAN: IPProfile = {
  id: "ip-shuimuran",
  name: "水木然",
  avatar: "水",
  positioning: "商业认知作者",
  platforms: ["视频号"],
  audience: "关注商业趋势和个人成长的人",
  contentDirection: ["商业洞察"],
  personaKeywords: ["理性"],
  professionalIdentity: "商业作者",
  personalityTags: ["克制"],
  credibilitySource: "长期研究",
  representativeViewpoints: ["趋势影响个体"],
  tone: "理性克制",
  commonOpenings: ["很多人没意识到"],
  commonClosings: ["这才是关键"],
  catchphrases: [],
  forbiddenExpressions: ["装修"],
  pacing: "层层递进",
  commonScenes: ["书房"],
  commonShotTypes: ["口播"],
  showsFace: true,
  usesScreenRecording: false,
  needsBroll: false,
  needsCaseScreenshots: false,
  needsSubtitleHighlight: true,
  sampleViralTitles: [],
  styleNotes: "商业趋势",
  bio: "",
  color: "#123456",
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
};

test("当前操盘IP会进入董事会的每一次AI评审", async () => {
  const originalFetch = globalThis.fetch;
  const capturedSystemPrompts: string[] = [];
  const capturedUserPrompts: string[] = [];

  globalThis.fetch = async (_input, init) => {
    const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: { role: string; content: string }[];
    };
    const systemPrompt = requestBody.messages?.[0]?.content ?? "";
    capturedSystemPrompts.push(systemPrompt);
    capturedUserPrompts.push(requestBody.messages?.[1]?.content ?? "");
    const content = systemPrompt.includes("内容安全合规官")
      ? JSON.stringify({
          observation: "没有发现不可控风险。",
          reasoning: "内容边界清晰。",
          conclusion: "可以通过安全审查。",
          dims: [
            { label: "言行无害性", score: 9 },
            { label: "合规性", score: 9 },
            { label: "争议免疫力", score: 9 },
          ],
          veto: false,
          vetoReason: null,
          vote: "支持",
        })
      : systemPrompt.includes("JSON格式输出数组") ? "[]" : "{}";

    return new Response(JSON.stringify({
      id: "mock-topic-review",
      choices: [{
        finish_reason: "stop",
        message: { content },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const payload = buildTopicReviewRequestPayload({
      topic: "普通人如何判断行业趋势",
      userPersonas: [],
      knowledgeContext: [],
      historicalData: [],
    }, SHUIMURAN);

    assert.equal(payload.ipProfile, SHUIMURAN);

    const response = await POST(new NextRequest("http://localhost/api/topic-review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DeepSeek-Key": "mock-key",
      },
      body: JSON.stringify(payload),
    }));
    const result = await response.json() as { ipName?: string };

    assert.equal(response.status, 200);
    assert.equal(result.ipName, "水木然");
    assert.ok(capturedUserPrompts.length >= 10);
    assert.ok(capturedUserPrompts.every(prompt => (
      prompt.includes("IP名称：水木然")
      && prompt.includes("目标受众：关注商业趋势和个人成长的人")
      && !prompt.includes("IP名称：设计师石空")
      && !prompt.includes("目标受众：准备装修")
    )));
    assert.ok(capturedSystemPrompts.some(prompt => (
      prompt.includes("执行容易度")
      && prompt.includes("素材易得度")
      && prompt.includes("差异化程度")
      && prompt.includes("分数越高代表对该IP越有利")
    )));
    assert.ok(capturedSystemPrompts.some(prompt => (
      prompt.includes("赛道宽松度")
      && prompt.includes("竞争越不激烈分越高")
    )));
    assert.ok(capturedSystemPrompts.some(prompt => (
      prompt.includes("戏剧感")
      && prompt.includes("不许硬编")
    )));
    assert.ok(capturedUserPrompts.some(prompt => (
      prompt.includes("失败概率百分比")
      && prompt.includes("低风险<30")
      && prompt.includes("中风险30-60")
      && prompt.includes("高风险>60")
    )));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
