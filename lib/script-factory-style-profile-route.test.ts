import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/script-factory/route";
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

const VALID_CONTENT = {
  titles: [{
    title: "普通人如何看懂下一轮变化",
    formula: "问题+判断",
    platform: "视频号",
    whyFitsIP: "符合水木然的商业认知定位",
  }],
  coverCopy: ["变化已经开始"],
  outline: [
    { label: "钩子", timeRange: "0-3秒", content: "真正的变化从来不会提前通知所有人，它总是先改变少数人的选择。", subPoints: [] },
    { label: "痛点共鸣", timeRange: "3-15秒", content: "很多人只盯着眼前的结果，却没有看到行业规则已经发生了根本变化。", subPoints: [] },
    { label: "核心方法", timeRange: "15-45秒", content: "判断趋势不能只看热闹，要同时观察需求、成本和普通人的真实行为。", subPoints: [] },
    { label: "案例总结", timeRange: "45-54秒", content: "当三个信号同时出现时，个体真正需要调整的是自己的选择顺序。", subPoints: [] },
    { label: "评论区引导", timeRange: "54-60秒", content: "看懂变化之后就去行动，这才是普通人能够抓住的真正机会。", subPoints: [] },
  ],
  commentGuidance: {
    interactionPrompt: "你最近观察到了什么变化？",
    keywordReplies: [{ keyword: "变化", reply: "先从身边真实需求开始观察。" }],
    dmGuidance: "",
    materialPackGuidance: "",
  },
  ipStyleExplanation: "使用水木然的判断式开头，并用行动建议收束。",
};

const SHUIMURAN_DIRECTOR_CONTENT = {
  ...VALID_CONTENT,
  titles: [
    {
      title: "未来，真正稀缺的是判断力",
      formula: "时代趋势+明确人群+结果",
      platform: "视频号",
      whyFitsIP: "切中了老师关于认知分层与个人选择的核心判断",
      role: "主推",
      recommended: true,
    },
    {
      title: "AI越强，为什么多数人反而失去判断力？",
      formula: "趋势+冲突",
      platform: "视频号",
      whyFitsIP: "强化时代变化带来的认知冲突",
      role: "流量",
      recommended: false,
    },
    {
      title: "工具越来越强，人更需要保留自己的判断",
      formula: "现象+选择",
      platform: "视频号",
      whyFitsIP: "用克制表达承接老师关于个人选择的判断",
      role: "安全",
      recommended: false,
    },
  ],
};

const VALID_STORYBOARD = {
  storyboard: [{
    time: "0-3秒",
    scene: "书房正面口播",
    voiceover: "真正的变化从来不会提前通知所有人。",
    subtitle: "变化已经开始",
    shot: "中景",
    material: "无",
    editingTip: "关键词放大",
  }],
  shootingSuggestions: ["在书房使用固定机位正面口播。"],
  shotPrompts: [],
  editingRhythm: {
    subtitleHighlights: ["变化已经开始"],
    soundEffects: [],
    screenRecordingCuts: [],
    caseInserts: [],
    pauses: [],
  },
};

const DENSE_CLOSING_CONTENT = {
  ...VALID_CONTENT,
  outline: VALID_CONTENT.outline.map(section => section.label === "评论区引导"
    ? {
        ...section,
        content: "记住，真正的机会来自看懂变化之后的行动。明白吗？听懂了没有？",
      }
    : section),
};

const VALID_ARGUMENT_REVIEW = { issues: [] };

const INVALID_ANALOGY_CONTENT = {
  ...VALID_CONTENT,
  outline: VALID_CONTENT.outline.map(section => section.label === "核心方法"
    ? {
        ...section,
        content: "Jellycat靠情绪价值提高消费者的支付意愿。就像奶茶卖得越多，每杯分摊成本越低，所以情绪价值也能带来更高定价权。",
      }
    : section),
};

const INVALID_ANALOGY_REVIEW = {
  issues: [{
    code: "analogy_mechanism_mismatch",
    sectionLabel: "核心方法",
    excerpt: "奶茶卖得越多，每杯分摊成本越低",
    reason: "奶茶案例说明规模效应带来的成本下降，不能直接支持情绪价值提高支付意愿形成的定价权。",
  }],
};

function deepSeekResponse(content: unknown, id: string): Response {
  return new Response(JSON.stringify({
    id,
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 200 },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function scriptFactoryRequest(
  styleProfile: unknown,
  ipProfile: IPProfile = SHUIMURAN,
): NextRequest {
  return new NextRequest("http://localhost/api/script-factory", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "test-key",
    },
    body: JSON.stringify({
      ipProfile,
      styleProfile,
      topic: "普通人如何判断下一轮行业变化",
      platform: "视频号",
      formatCategory: "short",
      durationSeconds: 60,
      goal: "建立信任",
      videoType: "口播",
      needsStoryboard: true,
      needsShootingTips: true,
      evidenceGate: {
        coverage: "FULL",
        evidenceConfirmed: true,
        caseNeed: "NOT_NEEDED",
        caseDecision: "skip",
        sourceReferences: [
          { sourceId: "source-1", sourceTitle: "课程原文", itemId: "claim-1", kind: "claim", content: "趋势会改变普通人的选择。", originalExcerpt: "趋势最终会落到普通人的现实选择。", extractionStatus: "人工确认" },
          { sourceId: "source-1", sourceTitle: "课程原文", itemId: "reasoning-1", kind: "reasoning", content: "判断趋势要观察需求和行为。", originalExcerpt: "判断趋势要同时观察需求、成本和普通人的真实行为。", extractionStatus: "人工确认" },
        ],
      },
    }),
  });
}

test("只有启用水木然专属编导规则的IP才会注入规则并强制三类标题", async () => {
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    prompts.push((body.messages ?? []).map(message => message.content ?? "").join("\n"));
    if (calls === 1) {
      return deepSeekResponse(JSON.stringify(SHUIMURAN_DIRECTOR_CONTENT), "director-content");
    }
    if (calls === 2) {
      return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "director-review");
    }
    return deepSeekResponse(JSON.stringify(VALID_STORYBOARD), "director-storyboard");
  };

  try {
    const response = await POST(scriptFactoryRequest(LEARNED_STYLE, {
      ...SHUIMURAN,
      scriptDirectorProfileId: "shuimuran-v1",
    }));
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.titles.length, 3);
    assert.equal(result.titles[0].role, "主推");
    assert.equal(result.titles[0].recommended, true);
    assert.match(prompts[0], /水木然专属内容编导规则/);
    assert.match(prompts[0], /不能替IP创造老师从未表达过的核心判断/);
    assert.match(prompts[0], /这些是动作库，不是固定八段模板/);
    assert.match(prompts[0], /严格输出3个标题/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("水木然已学习的风格画像同时进入核心脚本和分镜提示词", async () => {
  const originalFetch = globalThis.fetch;
  const outboundPrompts: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    outboundPrompts.push(
      (body.messages ?? []).map(message => message.content ?? "").join("\n"),
    );
    if (calls === 1) {
      return deepSeekResponse(JSON.stringify(VALID_CONTENT), "content-request");
    }
    if (calls === 2) {
      return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "quality-review-request");
    }
    return deepSeekResponse(JSON.stringify(VALID_STORYBOARD), "storyboard-request");
  };

  try {
    const response = await POST(scriptFactoryRequest(LEARNED_STYLE));
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.generationStatus, "complete");
    assert.equal(calls, 3);
    assert.equal(outboundPrompts.length, 3);

    for (const prompt of [outboundPrompts[0], outboundPrompts[2]]) {
      assert.match(prompt, /IP名称：水木然/);
      assert.match(prompt, /IP定位：商业认知作者/);
      assert.match(prompt, /目标受众：关注商业趋势和个人成长的人/);
      assert.match(prompt, /开头习惯：先抛出一句反常识判断/);
      assert.match(prompt, /高频用词：真正的拐点已经出现/);
      assert.match(prompt, /结尾方式：用行动建议收束判断/);
      assert.match(prompt, /额外禁用表达[^\n]*空洞成功学口号/);
      assert.doesNotMatch(prompt, /设计师石空|准备装修|室内设计|比例关系|材质关系|灯光关系/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("经典脚本结尾密集堆叠强调式口头禅时只重生成一次再进入论证复核", async () => {
  const originalFetch = globalThis.fetch;
  const outboundPrompts: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    outboundPrompts.push(
      (body.messages ?? []).map(message => message.content ?? "").join("\n"),
    );
    if (calls === 1) {
      return deepSeekResponse(JSON.stringify(DENSE_CLOSING_CONTENT), "dense-content-request");
    }
    if (calls === 2) {
      return deepSeekResponse(JSON.stringify(VALID_CONTENT), "revised-content-request");
    }
    if (calls === 3) {
      return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "quality-review-request");
    }
    return deepSeekResponse(JSON.stringify(VALID_STORYBOARD), "storyboard-request");
  };

  try {
    const response = await POST(scriptFactoryRequest(LEARNED_STYLE));
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.generationStatus, "complete");
    assert.equal(calls, 4);
    assert.match(outboundPrompts[0], /自然、选择性使用/);
    assert.doesNotMatch(outboundPrompts[0], /要主动使用这个IP的常用口头禅/);
    assert.match(outboundPrompts[0], /结尾最多使用一个强调式口头禅或反问/);
    assert.match(outboundPrompts[0], /类比双方必须具有相同的因果机制/);
    assert.match(outboundPrompts[1], /上次生成的结尾存在强调式口头禅或反问密集堆叠/);
    assert.match(outboundPrompts[2], /只检查案例是否支持结论/);
    assert.equal(result.qualityCheck.status, "passed");
    assert.deepEqual(result.qualityCheck.warnings, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("独立论证复核发现类比机制不一致时标记待核对但不改写脚本", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return deepSeekResponse(JSON.stringify(INVALID_ANALOGY_CONTENT), "content-request");
    }
    if (calls === 2) {
      return deepSeekResponse(JSON.stringify(INVALID_ANALOGY_REVIEW), "quality-review-request");
    }
    return deepSeekResponse(JSON.stringify(VALID_STORYBOARD), "storyboard-request");
  };

  try {
    const response = await POST(scriptFactoryRequest(LEARNED_STYLE));
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.generationStatus, "complete");
    assert.equal(calls, 3);
    assert.equal(result.qualityCheck.status, "needs_review");
    assert.deepEqual(result.qualityCheck.warnings, [{
      category: "argument",
      code: "analogy_mechanism_mismatch",
      title: "论证待核对",
      sectionLabel: "核心方法",
      excerpt: "奶茶卖得越多，每杯分摊成本越低",
      message: "奶茶案例说明规模效应带来的成本下降，不能直接支持情绪价值提高支付意愿形成的定价权。",
    }]);
    assert.match(
      result.outline.find((section: { label: string }) => section.label === "核心方法")?.content ?? "",
      /奶茶卖得越多，每杯分摊成本越低/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("其他IP的风格画像会在调用DeepSeek前被明确拒绝", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return deepSeekResponse(JSON.stringify(VALID_CONTENT), "unexpected-request");
  };

  try {
    const response = await POST(scriptFactoryRequest({
      ...LEARNED_STYLE,
      ipId: "ip-designer",
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

test("风格画像数组字段被传成字符串时会在调用DeepSeek前被拒绝", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return deepSeekResponse(JSON.stringify(VALID_CONTENT), "unexpected-request");
  };

  try {
    const response = await POST(scriptFactoryRequest({
      ...LEARNED_STYLE,
      openingHabits: "先抛出一句反常识判断",
    }));
    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.errorCode, "invalid_style_profile");
    assert.equal(result.errorField, "openingHabits");
    assert.match(result.error, /openingHabits.*字符串数组/);
    assert.equal(result.apiMeta.apiCalled, false);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("风格画像缺少关键字段时会在调用DeepSeek前被拒绝", async () => {
  const originalFetch = globalThis.fetch;
  const { styleSummary: _styleSummary, ...profileWithoutStyleSummary } = LEARNED_STYLE;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return deepSeekResponse(JSON.stringify(VALID_CONTENT), "unexpected-request");
  };

  try {
    const response = await POST(scriptFactoryRequest(profileWithoutStyleSummary));
    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.errorCode, "invalid_style_profile");
    assert.equal(result.errorField, "styleSummary");
    assert.match(result.error, /styleSummary.*非空字符串/);
    assert.equal(result.apiMeta.apiCalled, false);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const [label, invalidStyleProfile] of [
  ["false", false],
  ["0", 0],
  ["空字符串", ""],
] as const) {
  test(`风格画像传入${label}时会在调用DeepSeek前被拒绝`, async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return deepSeekResponse(JSON.stringify(VALID_CONTENT), "unexpected-request");
    };

    try {
      const response = await POST(scriptFactoryRequest(invalidStyleProfile));
      const result = await response.json();

      assert.equal(response.status, 400);
      assert.equal(result.errorCode, "invalid_style_profile");
      assert.equal(result.errorField, "styleProfile");
      assert.match(result.error, /styleProfile必须是对象/);
      assert.equal(result.apiMeta.apiCalled, false);
      assert.equal(called, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
