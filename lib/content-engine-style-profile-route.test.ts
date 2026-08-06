import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/skill/content-engine/route";
import type { IPProfile, IPStyleProfile } from "./types";

const SHUIMURAN: IPProfile = {
  id: "ip-shuimuran",
  name: "水木然",
  avatar: "水",
  positioning: "商业认知作者",
  platforms: ["视频号"],
  audience: "关注商业趋势和个人成长的人",
  contentDirection: ["商业洞察", "个人成长"],
  personaKeywords: ["理性", "洞察"],
  professionalIdentity: "商业作者",
  personalityTags: ["克制", "清醒"],
  credibilitySource: "长期研究商业趋势并持续公开写作",
  representativeViewpoints: ["趋势最终会落到个人选择"],
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
  styleNotes: "从时代变化切入个人选择",
  bio: "关注商业趋势与个人选择的作者",
  color: "#7656D6",
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
};

const LEARNED_STYLE: IPStyleProfile = {
  ipId: SHUIMURAN.id,
  openingHabits: ["先抛出一句反常识判断"],
  viewpointStyle: "先讲时代变化，再落到普通人的现实选择。",
  sentenceLength: "长短句结合",
  emotionalTone: ["清醒", "克制"],
  commonPhrases: ["真正的拐点已经出现"],
  closingHabits: ["用行动建议收束判断"],
  forbiddenExpressions: ["空洞成功学口号"],
  styleSummary: "强判断开场，逐层解释，最后回到个人行动。",
  sourceSampleIds: ["sample-1"],
  sourceSampleTitles: ["内容创作拐点洞察"],
  extractedAt: "2026-08-05T01:00:00.000Z",
  model: "deepseek-v4-flash",
};

function deepSeekResponse(content: unknown): Response {
  return new Response(JSON.stringify({
    id: "content-engine-request",
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function contentEngineRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/skill/content-engine", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "test-key",
    },
    body: JSON.stringify(body),
  });
}

test("空受众和行业会回退到水木然档案并注入已学习风格", async () => {
  const originalFetch = globalThis.fetch;
  let outboundPrompt = "";
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    outboundPrompt = (body.messages ?? [])
      .map(message => message.content ?? "")
      .join("\n");
    return deepSeekResponse("{}");
  };

  try {
    const response = await POST(contentEngineRequest({
      topic: "普通人如何判断下一轮行业变化",
      targetAudience: "",
      industry: "",
      contentGoal: "traffic",
      ipProfile: SHUIMURAN,
      styleProfile: LEARNED_STYLE,
    }));
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result._meta.audience, SHUIMURAN.audience);
    assert.equal(result._meta.industry, SHUIMURAN.contentDirection[0]);
    assert.match(outboundPrompt, /IP名称：水木然/);
    assert.match(outboundPrompt, /IP定位：商业认知作者/);
    assert.match(outboundPrompt, /目标受众：关注商业趋势和个人成长的人/);
    assert.match(outboundPrompt, /行业\/赛道：商业洞察/);
    assert.match(outboundPrompt, /开头习惯：先抛出一句反常识判断/);
    assert.match(outboundPrompt, /高频用词：真正的拐点已经出现/);
    assert.match(outboundPrompt, /结尾方式：用行动建议收束判断/);
    assert.match(outboundPrompt, /额外禁用表达[^\n]*空洞成功学口号/);
    assert.doesNotMatch(
      outboundPrompt,
      /设计师石空|准备装修的业主|室内设计与全案装修|比例关系|材质关系|灯光关系/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("其他IP的风格画像会在Content Engine调用DeepSeek前被拒绝", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return deepSeekResponse("{}");
  };

  try {
    const response = await POST(contentEngineRequest({
      topic: "普通人如何判断下一轮行业变化",
      ipProfile: SHUIMURAN,
      styleProfile: {
        ...LEARNED_STYLE,
        ipId: "ip-designer",
      },
    }));
    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.errorCode, "style_profile_ip_mismatch");
    assert.match(result.error, /风格画像与当前IP不匹配/);
    assert.equal(result.apiMeta.apiCalled, false);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("用户明确填写的受众和行业优先于IP档案", async () => {
  const originalFetch = globalThis.fetch;
  let outboundPrompt = "";
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    outboundPrompt = (body.messages ?? [])
      .map(message => message.content ?? "")
      .join("\n");
    return deepSeekResponse("{}");
  };

  try {
    const response = await POST(contentEngineRequest({
      topic: "普通人如何判断下一轮行业变化",
      targetAudience: "正在转型的企业管理者",
      industry: "企业数字化转型",
      ipProfile: SHUIMURAN,
      styleProfile: LEARNED_STYLE,
    }));
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result._meta.audience, "正在转型的企业管理者");
    assert.equal(result._meta.industry, "企业数字化转型");
    assert.match(
      outboundPrompt,
      /【内容生产任务】[\s\S]*目标受众：正在转型的企业管理者[\s\S]*行业\/赛道：企业数字化转型/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
