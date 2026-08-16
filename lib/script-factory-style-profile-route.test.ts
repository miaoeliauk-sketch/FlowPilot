import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  titles: [
    {
      title: "普通人下一轮机会的真正秘密，藏在这三个信号里",
    },
  ],
  fullScript: VALID_CONTENT.outline.map(section => section.content).join(""),
  pendingVerification: [],
};

const COMPRESSION_PRESERVATION_DRAFT = {
  titles: [{ title: "一家企业真正的机会，藏在进退之间" }],
  fullScript: `很多人判断一家企业有没有机会，只看规模和增长速度。某企业连续三年主动缩减低效门店，却把更多预算投入产品质量和员工培训。短期看，它少赚了不少钱，长期却稳住了复购和口碑。这不是简单的保守，而是一种主动选择边界的能力。《道德经》说“明道若昧，进道若退”，真正的前进有时看起来像后退。因为扩张会放大优势，也会同时放大管理漏洞；当组织能力跟不上规模，增长越快，风险积累得越快。所以，企业真正的竞争力，不是永远向前冲，而是在该停的时候敢停、该退的时候敢退。看懂这种进退，才能理解下一轮机会真正属于谁。`,
  pendingVerification: ["某企业连续三年的经营情况"],
};

const COMPRESSED_PRESERVATION_CONTENT = {
  titles: COMPRESSION_PRESERVATION_DRAFT.titles,
  fullScript: `很多人判断企业机会，只看规模和增速。某企业连续三年缩减低效门店，却把预算投入产品质量和员工培训，短期少赚了钱，长期稳住复购和口碑。这是主动选择边界。《道德经》说“明道若昧，进道若退”，前进有时看起来像后退。因为扩张既放大优势，也放大管理漏洞；组织能力跟不上，增长越快，风险越大。所以，企业的竞争力不是永远向前冲，而是在该停时敢停、该退时敢退。看懂进退，才能理解下一轮机会属于谁。`,
  pendingVerification: COMPRESSION_PRESERVATION_DRAFT.pendingVerification,
};

const COMPRESSED_SHUIMURAN_CONTENT = {
  ...SHUIMURAN_DIRECTOR_CONTENT,
  fullScript: "变化不会提前通知所有人，它总是先改变少数人的选择。很多人只盯结果，却没看到行业规则已经改变。判断趋势不能只看热闹，要观察需求、成本和普通人的真实行为。当三个信号同时出现，个体要调整选择顺序。看懂变化后就行动，这才是普通人能抓住的机会。",
};

const TOO_LONG_SHUIMURAN_COMPRESSION = {
  ...SHUIMURAN_DIRECTOR_CONTENT,
  fullScript: "变化不会提前通知所有人，它总是先改变少数人的选择。很多人只盯着眼前结果，却没有看到行业规则已经发生变化。判断趋势不能只看热闹，要同时观察需求、成本和普通人的真实行为。当三个信号同时出现时，个体真正需要调整自己的选择顺序。看懂变化之后就行动，这才是普通人能够抓住的机会。",
};

const WRONG_TITLE_TOO_LONG_SHUIMURAN_COMPRESSION = {
  ...TOO_LONG_SHUIMURAN_COMPRESSION,
  titles: [{ title: "被压缩步骤擅自改变的标题" }],
};

const TOO_SHORT_SHUIMURAN_COMPRESSION = {
  ...SHUIMURAN_DIRECTOR_CONTENT,
  fullScript: "变化已经开始。看懂趋势，才能调整选择。",
};

const BREAK_SIX_CONTENT = {
  titles: [{ title: "一个人真正觉醒之前，必须破掉这六种相" }],
  fullScript: `大家有没有发现一个很有意思的现象：很多人越努力越焦虑，因为他们一直在着相。
第一种相，叫我相。破掉我相，就是看清自己的局限。
第二种相，叫人相。破掉人相，就是不再用别人的尺子量自己。
第三种相，叫众生相。破掉众生相，就是敢于走少有人走的路。
第四种相，叫寿者相。破掉寿者相，就是不再被年龄绑架。
第五种相，叫法相。破掉法相，就是不再迷信方法。
第六种相，叫非法相。破掉非法相，就是既不执着于有，也不执着于无。
希望你能成为那1%的人。`,
  pendingVerification: [],
};

const COMPRESSED_BREAK_SIX_CONTENT = {
  ...BREAK_SIX_CONTENT,
  fullScript: `大家有没有发现一个很有意思的现象：很多人焦虑，因为一直在着相。
第一种相，叫我相，就是看清局限。
第二种相，叫人相，就是不用别人的尺子量自己。
第三种相，叫众生相，就是敢走少有人走的路。
第四种相，叫寿者相，就是不被年龄绑架。
第五种相，叫法相，就是不迷信方法。
第六种相，叫非法相，就是既不执着于有，也不执着于无。
希望你能成为那1%的人。`,
};

const VALID_SHUIMURAN_REVIEW = {
  checks: {
    titleKeepsAnswer: true,
    openingBuildsSuspense: true,
    concreteEntry: true,
    classicExplainsReality: true,
    risesToPattern: true,
    conciseWithoutRepetition: true,
    staleHotspotReframed: true,
    titleOpeningEndingClosed: true,
    soundsLikeTeacher: true,
    singleCoreIdea: true,
    reasoningSupported: true,
    endingClosesSpecificLoop: true,
  },
  issues: [],
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
  generationMode: "standard" | "ip" = "ip",
): NextRequest {
  return new NextRequest("http://localhost/api/script-factory", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "test-key",
    },
    body: JSON.stringify({
      generationMode,
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
      ipSourceContext: [
        { ipId: ipProfile.id, sourceId: "source-1", sourceTitle: "课程原文", itemId: "claim-1", kind: "claim", content: "趋势会改变普通人的选择。", originalExcerpt: "趋势最终会落到普通人的现实选择。", extractionStatus: "人工确认" },
        { ipId: ipProfile.id, sourceId: "source-1", sourceTitle: "课程原文", itemId: "reasoning-1", kind: "reasoning", content: "判断趋势要观察需求和行为。", originalExcerpt: "判断趋势要同时观察需求、成本和普通人的真实行为。", extractionStatus: "人工确认" },
      ],
    }),
  });
}

test("固定脚本生成不要求观点覆盖度，也不启用IP专属编导规则", async () => {
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    prompts.push((body.messages ?? []).map(message => message.content ?? "").join("\n"));
    if (calls === 1) return deepSeekResponse(JSON.stringify(VALID_CONTENT), "standard-content");
    if (calls === 2) return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "standard-review");
    return deepSeekResponse(JSON.stringify(VALID_STORYBOARD), "standard-storyboard");
  };

  try {
    const request = scriptFactoryRequest(LEARNED_STYLE, {
      ...SHUIMURAN,
      scriptDirectorProfileId: "shuimuran-v1",
    }, "standard");
    const requestBody = await request.clone().json();
    const response = await POST(new NextRequest("http://localhost/api/script-factory", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify(requestBody),
    }));

    assert.equal(response.status, 200);
    assert.doesNotMatch(prompts[0], /水木然专属内容编导规则/);
    assert.doesNotMatch(prompts[0], /本次已经确认的观点依据/);
    assert.doesNotMatch(prompts[0], /IP原始内容上下文/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("其他IP即使误带水木然规则编号也不注入老师确认版规则", async () => {
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    prompts.push((body.messages ?? []).map(message => message.content ?? "").join("\n"));
    if (calls === 1) return deepSeekResponse(JSON.stringify(VALID_CONTENT), "other-content");
    if (calls === 2) return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "other-review");
    return deepSeekResponse(JSON.stringify(VALID_STORYBOARD), "other-storyboard");
  };

  try {
    const response = await POST(scriptFactoryRequest(null, {
      ...SHUIMURAN,
      id: "ip-other",
      name: "其他IP",
      scriptDirectorProfileId: "shuimuran-v1",
    }));

    assert.equal(response.status, 200);
    assert.doesNotMatch(prompts[0], /水木然IP专属脚本生成规则｜老师确认版/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("只有水木然IP专属生成才会注入老师确认版规则", async () => {
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
      return deepSeekResponse(JSON.stringify(COMPRESSED_SHUIMURAN_CONTENT), "director-compression");
    }
    if (calls === 3) {
      return deepSeekResponse(JSON.stringify(VALID_SHUIMURAN_REVIEW), "director-final-review");
    }
    return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "director-review");
  };

  try {
    const response = await POST(scriptFactoryRequest(LEARNED_STYLE, {
      ...SHUIMURAN,
      scriptDirectorProfileId: "shuimuran-v1",
    }));
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.outputMode, "shuimuran-confirmed");
    assert.equal(result.titles.length, 1);
    assert.equal(result.outline.length, 1);
    assert.deepEqual(result.pendingVerification, []);
    assert.equal(result.storyboard.length, 0);
    assert.match(prompts[0], /水木然IP专属脚本生成规则｜老师确认版/);
    assert.match(prompts[0], /不超过24小时，可以直接追热点/);
    assert.doesNotMatch(prompts[0], /主动压缩20%至30%/);
    assert.doesNotMatch(prompts[0], /强制进行一次20%至30%的精简/);
    assert.doesNotMatch(prompts[0], /比初稿压缩了20%至30%/);
    assert.match(prompts[0], /"fullScript"/);
    assert.match(prompts[0], /"pendingVerification"/);
    assert.doesNotMatch(prompts[0], /"coverCopy"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("水木然专属生成先生成初稿再独立压缩到七至八成后进入终审", async () => {
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
      return deepSeekResponse(JSON.stringify(COMPRESSION_PRESERVATION_DRAFT), "director-draft");
    }
    if (calls === 2) {
      return deepSeekResponse(JSON.stringify(COMPRESSED_PRESERVATION_CONTENT), "director-compression");
    }
    if (calls === 3) {
      return deepSeekResponse(JSON.stringify(VALID_SHUIMURAN_REVIEW), "director-final-review");
    }
    return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "director-argument-review");
  };

  try {
    const response = await POST(scriptFactoryRequest(LEARNED_STYLE, {
      ...SHUIMURAN,
      scriptDirectorProfileId: "shuimuran-v1",
    }));
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 4);
    assert.equal(result.outline[0].content, COMPRESSED_PRESERVATION_CONTENT.fullScript);
    assert.deepEqual(result.pendingVerification, COMPRESSION_PRESERVATION_DRAFT.pendingVerification);
    assert.match(result.outline[0].content, /某企业连续三年/);
    assert.match(result.outline[0].content, /产品质量和员工培训/);
    assert.match(result.outline[0].content, /《道德经》说“明道若昧，进道若退”/);
    assert.match(result.outline[0].content, /因为扩张既放大优势，也放大管理漏洞/);
    assert.match(result.outline[0].content, /看懂进退，才能理解下一轮机会属于谁/);
    assert.match(prompts[0] ?? "", /完整初稿/);
    assert.doesNotMatch(prompts[0] ?? "", /在内部精简20%至30%/);
    assert.doesNotMatch(prompts[1] ?? "", /70%至80%/);
    assert.match(prompts[1] ?? "", /初稿共244个有效字符/);
    assert.match(prompts[1] ?? "", /必须控制在171至195个有效字符之间/);
    assert.match(prompts[1] ?? "", /核心案例、事实、因果关系、经典解释和最终结论/);
    assert.match(prompts[1] ?? "", /多个并列观点只完整保留论证最充分的1至2个/);
    assert.match(prompts[1] ?? "", /其余压缩成一句话带过/);
    assert.match(prompts[1] ?? "", /保留是保留原意和关键信息，不要求逐字保留/);
    assert.match(prompts[2] ?? "", new RegExp(COMPRESSED_PRESERVATION_CONTENT.fullScript.slice(0, 20)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("水木然压缩稿不在七至八成时明确重压一次且只终审合格稿", async () => {
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
      return deepSeekResponse(JSON.stringify(SHUIMURAN_DIRECTOR_CONTENT), "director-draft");
    }
    if (calls === 2) {
      return deepSeekResponse(JSON.stringify(TOO_LONG_SHUIMURAN_COMPRESSION), "director-compression-too-long");
    }
    if (calls === 3) {
      return deepSeekResponse(JSON.stringify(COMPRESSED_SHUIMURAN_CONTENT), "director-compression-passed");
    }
    if (calls === 4) {
      return deepSeekResponse(JSON.stringify(VALID_SHUIMURAN_REVIEW), "director-final-review");
    }
    return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "director-argument-review");
  };

  try {
    const response = await POST(scriptFactoryRequest(LEARNED_STYLE, {
      ...SHUIMURAN,
      scriptDirectorProfileId: "shuimuran-v1",
    }));
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 5);
    assert.equal(result.outline[0].content, COMPRESSED_SHUIMURAN_CONTENT.fullScript);
    assert.match(prompts[2] ?? "", /上次返回134个有效字符/);
    assert.match(prompts[2] ?? "", /目标上限为118个/);
    assert.match(prompts[2] ?? "", /至少还需要删除16个有效字符/);
    assert.match(prompts[2] ?? "", /请在这个版本基础上继续删减，不要回到初稿重新生成/);
    assert.match(prompts[2] ?? "", new RegExp(TOO_LONG_SHUIMURAN_COMPRESSION.fullScript.slice(0, 30)));
    assert.match(prompts[3] ?? "", new RegExp(COMPRESSED_SHUIMURAN_CONTENT.fullScript.slice(0, 20)));
    assert.doesNotMatch(prompts[3] ?? "", new RegExp(SHUIMURAN_DIRECTOR_CONTENT.fullScript.slice(-20)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("水木然压缩稿过短时按真实差额补回必要内容", async () => {
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    prompts.push((body.messages ?? []).map(message => message.content ?? "").join("\n"));
    if (calls === 1) return deepSeekResponse(JSON.stringify(SHUIMURAN_DIRECTOR_CONTENT), "director-draft");
    if (calls === 2) return deepSeekResponse(JSON.stringify(TOO_SHORT_SHUIMURAN_COMPRESSION), "director-compression-too-short");
    if (calls === 3) return deepSeekResponse(JSON.stringify(COMPRESSED_SHUIMURAN_CONTENT), "director-compression-passed");
    if (calls === 4) return deepSeekResponse(JSON.stringify(VALID_SHUIMURAN_REVIEW), "director-final-review");
    return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "director-argument-review");
  };

  try {
    const response = await POST(scriptFactoryRequest(LEARNED_STYLE, {
      ...SHUIMURAN,
      scriptDirectorProfileId: "shuimuran-v1",
    }));

    assert.equal(response.status, 200);
    assert.equal(calls, 5);
    assert.match(prompts[2] ?? "", /上次返回19个有效字符/);
    assert.match(prompts[2] ?? "", /目标下限为104个/);
    assert.match(prompts[2] ?? "", /至少还需要补回85个有效字符/);
    assert.match(prompts[2] ?? "", new RegExp(TOO_SHORT_SHUIMURAN_COMPRESSION.fullScript));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("水木然压缩稿同时改变标题且字数超限时完整报告两项问题", async () => {
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    prompts.push((body.messages ?? []).map(message => message.content ?? "").join("\n"));
    if (calls === 1) return deepSeekResponse(JSON.stringify(SHUIMURAN_DIRECTOR_CONTENT), "director-draft");
    if (calls === 2) return deepSeekResponse(JSON.stringify(WRONG_TITLE_TOO_LONG_SHUIMURAN_COMPRESSION), "director-compression-invalid");
    if (calls === 3) return deepSeekResponse(JSON.stringify(COMPRESSED_SHUIMURAN_CONTENT), "director-compression-passed");
    if (calls === 4) return deepSeekResponse(JSON.stringify(VALID_SHUIMURAN_REVIEW), "director-final-review");
    return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "director-argument-review");
  };

  try {
    const response = await POST(scriptFactoryRequest(LEARNED_STYLE, {
      ...SHUIMURAN,
      scriptDirectorProfileId: "shuimuran-v1",
    }));

    assert.equal(response.status, 200);
    assert.equal(calls, 5);
    assert.match(prompts[2] ?? "", /压缩稿改变了初稿标题/);
    assert.match(prompts[2] ?? "", /上次返回134个有效字符/);
    assert.match(prompts[2] ?? "", /至少还需要删除16个有效字符/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("水木然压缩重试会区分格式错误、标题变化和长度不合格", async t => {
  const scenarios = [
    {
      name: "格式错误",
      firstCompression: "{不是合法JSON",
      expectedReason: /上一次压缩稿格式不合法/,
    },
    {
      name: "标题变化",
      firstCompression: JSON.stringify({
        ...COMPRESSED_SHUIMURAN_CONTENT,
        titles: [{ title: "被压缩步骤擅自改变的标题" }],
      }),
      expectedReason: /上一次压缩改变了初稿标题/,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const originalFetch = globalThis.fetch;
      const prompts: string[] = [];
      let calls = 0;
      globalThis.fetch = async (_input, init) => {
        calls += 1;
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ content?: string }>;
        };
        prompts.push((body.messages ?? []).map(message => message.content ?? "").join("\n"));
        if (calls === 1) return deepSeekResponse(JSON.stringify(SHUIMURAN_DIRECTOR_CONTENT), "director-draft");
        if (calls === 2) return deepSeekResponse(scenario.firstCompression, "director-compression-invalid");
        if (calls === 3) return deepSeekResponse(JSON.stringify(COMPRESSED_SHUIMURAN_CONTENT), "director-compression-passed");
        if (calls === 4) return deepSeekResponse(JSON.stringify(VALID_SHUIMURAN_REVIEW), "director-final-review");
        return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "director-argument-review");
      };

      try {
        const response = await POST(scriptFactoryRequest(LEARNED_STYLE, {
          ...SHUIMURAN,
          scriptDirectorProfileId: "shuimuran-v1",
        }));

        assert.equal(response.status, 200);
        assert.equal(calls, 5);
        assert.match(prompts[2] ?? "", scenario.expectedReason);
        assert.doesNotMatch(prompts[2] ?? "", /未通过长度检查/);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});

test("水木然压缩不能改变待核验内容", async () => {
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    prompts.push((body.messages ?? []).map(message => message.content ?? "").join("\n"));
    if (calls === 1) return deepSeekResponse(JSON.stringify(COMPRESSION_PRESERVATION_DRAFT), "director-draft");
    if (calls === 2) {
      return deepSeekResponse(JSON.stringify({
        ...COMPRESSED_PRESERVATION_CONTENT,
        pendingVerification: [],
      }), "director-compression-dropped-pending");
    }
    if (calls === 3) return deepSeekResponse(JSON.stringify(COMPRESSED_PRESERVATION_CONTENT), "director-compression-passed");
    if (calls === 4) return deepSeekResponse(JSON.stringify(VALID_SHUIMURAN_REVIEW), "director-final-review");
    return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "director-argument-review");
  };

  try {
    const response = await POST(scriptFactoryRequest(LEARNED_STYLE, {
      ...SHUIMURAN,
      scriptDirectorProfileId: "shuimuran-v1",
    }));
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 5);
    assert.deepEqual(result.pendingVerification, COMPRESSION_PRESERVATION_DRAFT.pendingVerification);
    assert.match(prompts[2] ?? "", /上一次压缩改变了待核验内容/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("创业失败选题只把唯一胖东来范例作为格式说明而非默认素材", async () => {
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    prompts.push((body.messages ?? []).map(message => message.content ?? "").join("\n"));
    if (calls === 1) return deepSeekResponse(JSON.stringify(SHUIMURAN_DIRECTOR_CONTENT), "startup-failure-content");
    if (calls === 2) return deepSeekResponse(JSON.stringify(COMPRESSED_SHUIMURAN_CONTENT), "startup-failure-compression");
    if (calls === 3) return deepSeekResponse(JSON.stringify(VALID_SHUIMURAN_REVIEW), "startup-failure-review");
    return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "startup-failure-argument");
  };

  try {
    const request = scriptFactoryRequest(LEARNED_STYLE, {
      ...SHUIMURAN,
      scriptDirectorProfileId: "shuimuran-v1",
    });
    const requestBody = await request.clone().json();
    requestBody.topic = "创业失败以后，真正应该反思什么";
    const response = await POST(new NextRequest("http://localhost/api/script-factory", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify(requestBody),
    }));

    assert.equal(response.status, 200);
    assert.match(prompts[0] ?? "", /选题：「创业失败以后，真正应该反思什么」/);
    assert.equal((prompts[0]?.match(/胖东来/g) ?? []).length, 1);
    assert.match(prompts[0] ?? "", /示例只用于说明结构和表达边界，不属于本次创作素材/);
    assert.match(prompts[0] ?? "", /格式示例不能进入正文素材池/);
    assert.match(prompts[0] ?? "", /否则不得复用示例中的人物、企业、事件和结论/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("水木然专属生成只在本机记录完整AI调用链，不通过接口泄露诊断内容", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnabled = process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS;
  const originalCwd = process.cwd();
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "script-factory-route-trace-"));
  const rootDir = path.join(projectDir, ".flowpilot-diagnostics", "script-factory");
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return deepSeekResponse(JSON.stringify(SHUIMURAN_DIRECTOR_CONTENT), "trace-content");
    }
    if (calls === 2) {
      return deepSeekResponse(JSON.stringify(COMPRESSED_SHUIMURAN_CONTENT), "trace-content-compression");
    }
    if (calls === 3) {
      return deepSeekResponse(JSON.stringify(VALID_SHUIMURAN_REVIEW), "trace-shuimuran-review");
    }
    return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "trace-argument-review");
  };
  process.chdir(projectDir);
  process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS = "1";

  try {
    const request = scriptFactoryRequest(LEARNED_STYLE, {
      ...SHUIMURAN,
      scriptDirectorProfileId: "shuimuran-v1",
    });
    const requestBody = await request.clone().json();
    requestBody.needsStoryboard = false;
    requestBody.needsShootingTips = false;
    requestBody.knowledgeRefs = [{
      id: "knowledge-trace-1",
      ipId: SHUIMURAN.id,
      title: "创业失败的认知边界",
      category: "文案框架方法库",
      rawContent: "失败会让人重新看见边界。",
      reason: "支持本次选题的推理。",
    }];
    requestBody.voiceSamples = [{
      id: "voice-trace-1",
      title: "老师口播样本",
      rawText: "真正的问题，不是失败本身，而是失败之后有没有重新判断。",
      type: "老师确认稿",
    }];
    requestBody.caseEvidence = {
      ipId: SHUIMURAN.id,
      title: "创业案例A",
      content: "一位经营者在扩张失败后主动收缩业务。",
      sourceType: "用户提供",
      verificationStatus: "未核实",
      sourceUrl: "https://example.com/case-a",
    };

    const response = await POST(new NextRequest("http://localhost/api/script-factory", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify(requestBody),
    }));
    const responseText = await response.text();

    assert.equal(response.status, 200);
    assert.doesNotMatch(responseText, /generationId|diagnostic|systemPrompt|userPrompt/);
    assert.doesNotMatch(responseText, /失败会让人重新看见边界/);

    const generationDirectories = await readdir(rootDir);
    assert.equal(generationDirectories.length, 1);
    const generationDir = path.join(rootDir, generationDirectories[0]!);
    const callFiles = (await readdir(generationDir)).sort();
    assert.deepEqual(callFiles, [
      "001-content-initial.json",
      "002-content-compression.json",
      "003-shuimuran-review.json",
      "004-argument-review.json",
    ]);

    const contentRecordText = await readFile(path.join(generationDir, callFiles[0]!), "utf8");
    const contentRecord = JSON.parse(contentRecordText) as {
      shuimuranProfileEnabled: boolean;
      systemPrompt: string;
      userPrompt: string;
      materials: {
        methodKnowledge: Array<{ id: string }>;
        voiceSamples: Array<{ id: string }>;
        sourceReferences: Array<{ itemId: string }>;
        caseEvidence: { title: string };
      };
    };
    assert.equal(contentRecord.shuimuranProfileEnabled, true);
    assert.match(contentRecord.userPrompt, /大家有没有发现一个很有意思的现象/);
    assert.match(contentRecord.userPrompt, /失败会让人重新看见边界/);
    assert.match(contentRecord.userPrompt, /老师口播样本/);
    assert.match(contentRecord.userPrompt, /创业案例A/);
    assert.deepEqual(contentRecord.materials.methodKnowledge.map(item => item.id), ["knowledge-trace-1"]);
    assert.deepEqual(contentRecord.materials.voiceSamples.map(item => item.id), ["voice-trace-1"]);
    assert.deepEqual(contentRecord.materials.sourceReferences.map(item => item.itemId), ["claim-1", "reasoning-1"]);
    assert.equal(contentRecord.materials.caseEvidence.title, "创业案例A");

    const compressionRecordText = await readFile(path.join(generationDir, callFiles[1]!), "utf8");
    const compressionRecord = JSON.parse(compressionRecordText) as {
      stage: string;
      userPrompt: string;
      rawResponse: string;
      rawResponseChars: number;
      parsedBodyVisibleChars: number;
      initialBodyVisibleChars: number;
      targetMinimumChars: number;
      targetMaximumChars: number;
      actualCompressionRatio: number;
      exactlyMatchesInitial: boolean;
      normalizedMatchesInitial: boolean;
      requestId: string;
      finishReason: string;
      tokenUsage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number | null;
        reasoningTokens: number | null;
      };
      materials: {
        methodKnowledge: Array<{ id: string }>;
        voiceSamples: Array<{ id: string }>;
      };
    };
    assert.equal(compressionRecord.stage, "content-compression");
    assert.match(compressionRecord.userPrompt, new RegExp(SHUIMURAN_DIRECTOR_CONTENT.fullScript.slice(0, 20)));
    assert.doesNotMatch(compressionRecord.userPrompt, /70%至80%/);
    assert.match(compressionRecord.userPrompt, /初稿共148个有效字符/);
    assert.match(compressionRecord.userPrompt, /必须控制在104至118个有效字符之间/);
    assert.equal(compressionRecord.rawResponse, JSON.stringify(COMPRESSED_SHUIMURAN_CONTENT));
    assert.equal(compressionRecord.rawResponseChars, Array.from(JSON.stringify(COMPRESSED_SHUIMURAN_CONTENT)).length);
    assert.equal(compressionRecord.parsedBodyVisibleChars, 117);
    assert.equal(compressionRecord.initialBodyVisibleChars, 148);
    assert.equal(compressionRecord.targetMinimumChars, 104);
    assert.equal(compressionRecord.targetMaximumChars, 118);
    assert.equal(compressionRecord.actualCompressionRatio, 0.7905);
    assert.equal(compressionRecord.exactlyMatchesInitial, false);
    assert.equal(compressionRecord.normalizedMatchesInitial, false);
    assert.equal(compressionRecord.requestId, "trace-content-compression");
    assert.equal(compressionRecord.finishReason, "stop");
    assert.deepEqual(compressionRecord.tokenUsage, {
      promptTokens: 100,
      completionTokens: 200,
      totalTokens: null,
      reasoningTokens: null,
    });
    assert.deepEqual(compressionRecord.materials.methodKnowledge.map(item => item.id), ["knowledge-trace-1"]);
    assert.deepEqual(compressionRecord.materials.voiceSamples.map(item => item.id), ["voice-trace-1"]);

    const allTraceRecords = await Promise.all(callFiles.map(async file =>
      JSON.parse(await readFile(path.join(generationDir, file), "utf8")) as {
        rawResponse: string | null;
        rawResponseChars: number | null;
        requestId: string | null;
        finishReason: string | null;
        tokenUsage: { promptTokens: number | null; completionTokens: number | null };
      }
    ));
    assert.equal(allTraceRecords.every(record => typeof record.rawResponse === "string"), true);
    assert.equal(allTraceRecords.every(record => (record.rawResponseChars ?? 0) > 0), true);
    assert.deepEqual(allTraceRecords.map(record => record.requestId), [
      "trace-content",
      "trace-content-compression",
      "trace-shuimuran-review",
      "trace-argument-review",
    ]);
    assert.equal(allTraceRecords.every(record => record.finishReason === "stop"), true);
    assert.equal(allTraceRecords.every(record => record.tokenUsage.promptTokens === 100), true);
    assert.equal(allTraceRecords.every(record => record.tokenUsage.completionTokens === 200), true);

    const allTraceText = allTraceRecords.map(record => JSON.stringify(record)).join("\n");
    assert.doesNotMatch(allTraceText, /test-key|apiKey|authorization/i);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    if (originalEnabled === undefined) delete process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS;
    else process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS = originalEnabled;
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("水木然没有原始内容时仍生成，但不得冒充老师已确认观点", async () => {
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
    prompts.push((body.messages ?? []).map(message => message.content ?? "").join("\n"));
    if (calls === 1) return deepSeekResponse(JSON.stringify(SHUIMURAN_DIRECTOR_CONTENT), "director-content");
    if (calls === 2) return deepSeekResponse(JSON.stringify(COMPRESSED_SHUIMURAN_CONTENT), "director-compression");
    if (calls === 3) return deepSeekResponse(JSON.stringify(VALID_SHUIMURAN_REVIEW), "director-final-review");
    return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "director-review");
  };

  try {
    const request = scriptFactoryRequest(LEARNED_STYLE, {
      ...SHUIMURAN,
      scriptDirectorProfileId: "shuimuran-v1",
    });
    const requestBody = await request.clone().json();
    requestBody.ipSourceContext = [];
    const response = await POST(new NextRequest("http://localhost/api/script-factory", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify(requestBody),
    }));

    assert.equal(response.status, 200);
    assert.match(prompts[0], /只有相近观点或完全没有依据时，仍需完成脚本/);
    assert.match(prompts[0], /当前没有提供老师原始内容/);
    assert.match(prompts[0], /不得写成老师已经确认或长期坚持的观点/);
    assert.doesNotMatch(prompts[0], /说明缺少哪部分，并等待补充/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("水木然脚本任一终审项不通过时定向重生成并再次检查", async () => {
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    prompts.push((body.messages ?? []).map(message => message.content ?? "").join("\n"));
    if (calls === 1 || calls === 4) {
      return deepSeekResponse(JSON.stringify(SHUIMURAN_DIRECTOR_CONTENT), `director-content-${calls}`);
    }
    if (calls === 2 || calls === 5) {
      return deepSeekResponse(JSON.stringify(COMPRESSED_SHUIMURAN_CONTENT), `director-compression-${calls}`);
    }
    if (calls === 3) {
      return deepSeekResponse(JSON.stringify({
        ...VALID_SHUIMURAN_REVIEW,
        checks: { ...VALID_SHUIMURAN_REVIEW.checks, titleKeepsAnswer: false },
        issues: ["标题直接公布了核心答案"],
      }), "director-review-failed");
    }
    if (calls === 6) {
      return deepSeekResponse(JSON.stringify(VALID_SHUIMURAN_REVIEW), "director-review-passed");
    }
    if (calls === 7) return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "argument-review");
    return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "unexpected-extra-call");
  };

  try {
    const response = await POST(scriptFactoryRequest(LEARNED_STYLE, {
      ...SHUIMURAN,
      scriptDirectorProfileId: "shuimuran-v1",
    }));

    assert.equal(response.status, 200);
    assert.equal(calls, 7);
    assert.match(prompts[3], /标题直接公布了核心答案/);
    assert.doesNotMatch(prompts[4], /70%至80%/);
    assert.match(prompts[4], /初稿共148个有效字符/);
    assert.match(prompts[4], /必须控制在104至118个有效字符之间/);
    assert.match(prompts[5], new RegExp(COMPRESSED_SHUIMURAN_CONTENT.fullScript.slice(0, 20)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("破六相硬问题即使被模型放行也会触发重写并在二次终审再次拦截", async () => {
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    prompts.push((body.messages ?? []).map(message => message.content ?? "").join("\n"));
    if (calls === 1 || calls === 4) {
      return deepSeekResponse(JSON.stringify(BREAK_SIX_CONTENT), `break-six-content-${calls}`);
    }
    if (calls === 2 || calls === 5) {
      return deepSeekResponse(JSON.stringify(COMPRESSED_BREAK_SIX_CONTENT), `break-six-compression-${calls}`);
    }
    return deepSeekResponse(JSON.stringify(VALID_SHUIMURAN_REVIEW), `break-six-review-${calls}`);
  };

  try {
    const response = await POST(scriptFactoryRequest(LEARNED_STYLE, {
      ...SHUIMURAN,
      scriptDirectorProfileId: "shuimuran-v1",
    }));

    assert.equal(response.status, 502);
    assert.equal(calls, 6);
    assert.match(prompts[3] ?? "", /禁用开头/);
    assert.match(prompts[3] ?? "", /机械清单/);
    assert.match(prompts[3] ?? "", /通用结尾/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("水木然终审拥有独立重写机会，不会被首次内容重试占用", async () => {
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
      return deepSeekResponse("{内容被截断", "director-content-invalid");
    }
    if (calls === 2 || calls === 5) {
      return deepSeekResponse(JSON.stringify(SHUIMURAN_DIRECTOR_CONTENT), `director-content-${calls}`);
    }
    if (calls === 3 || calls === 6) {
      return deepSeekResponse(JSON.stringify(COMPRESSED_SHUIMURAN_CONTENT), `director-compression-${calls}`);
    }
    if (calls === 4) {
      return deepSeekResponse(JSON.stringify({
        ...VALID_SHUIMURAN_REVIEW,
        checks: { ...VALID_SHUIMURAN_REVIEW.checks, titleKeepsAnswer: false },
        issues: ["标题直接公布了核心答案"],
      }), "director-review-failed");
    }
    if (calls === 7) {
      return deepSeekResponse(JSON.stringify(VALID_SHUIMURAN_REVIEW), "director-review-passed");
    }
    if (calls === 8) return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "argument-review");
    return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "unexpected-extra-call");
  };

  try {
    const response = await POST(scriptFactoryRequest(LEARNED_STYLE, {
      ...SHUIMURAN,
      scriptDirectorProfileId: "shuimuran-v1",
    }));

    assert.equal(response.status, 200);
    assert.equal(calls, 8);
    assert.match(prompts[4], /标题直接公布了核心答案/);
    assert.doesNotMatch(prompts[5], /70%至80%/);
    assert.match(prompts[5], /初稿共148个有效字符/);
    assert.match(prompts[5], /必须控制在104至118个有效字符之间/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("格式重试、终审重写和二次终审分别写入同一次生成诊断链", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnabled = process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS;
  const originalCwd = process.cwd();
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "script-factory-retry-trace-"));
  const rootDir = path.join(projectDir, ".flowpilot-diagnostics", "script-factory");
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return deepSeekResponse("{内容被截断", "trace-content-invalid");
    if (calls === 2 || calls === 5) {
      return deepSeekResponse(JSON.stringify(SHUIMURAN_DIRECTOR_CONTENT), `trace-content-${calls}`);
    }
    if (calls === 3 || calls === 6) {
      return deepSeekResponse(JSON.stringify(COMPRESSED_SHUIMURAN_CONTENT), `trace-compression-${calls}`);
    }
    if (calls === 4) {
      return deepSeekResponse(JSON.stringify({
        ...VALID_SHUIMURAN_REVIEW,
        checks: { ...VALID_SHUIMURAN_REVIEW.checks, titleKeepsAnswer: false },
        issues: ["标题直接公布了核心答案"],
      }), "trace-review-failed");
    }
    if (calls === 7) return deepSeekResponse(JSON.stringify(VALID_SHUIMURAN_REVIEW), "trace-review-passed");
    return deepSeekResponse(JSON.stringify(VALID_ARGUMENT_REVIEW), "trace-argument-review");
  };
  process.chdir(projectDir);
  process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS = "1";

  try {
    const response = await POST(scriptFactoryRequest(LEARNED_STYLE, {
      ...SHUIMURAN,
      scriptDirectorProfileId: "shuimuran-v1",
    }));
    assert.equal(response.status, 200);

    const generationDirectories = await readdir(rootDir);
    assert.equal(generationDirectories.length, 1);
    const generationDir = path.join(rootDir, generationDirectories[0]!);
    const callFiles = (await readdir(generationDir)).sort();
    assert.deepEqual(callFiles, [
      "001-content-initial.json",
      "002-content-format-retry.json",
      "003-content-compression.json",
      "004-shuimuran-review.json",
      "005-content-rewrite.json",
      "006-content-compression.json",
      "007-shuimuran-review.json",
      "008-argument-review.json",
    ]);
    const records = await Promise.all(callFiles.map(async file =>
      JSON.parse(await readFile(path.join(generationDir, file), "utf8")) as {
        stage: string;
        retryReason: string | null;
        rawResponse: string | null;
        failureCode: string | null;
      }
    ));
    assert.equal(records[0]!.rawResponse, "{内容被截断");
    assert.match(records[0]!.failureCode ?? "", /JSON|INVALID/i);
    assert.match(records[1]!.retryReason ?? "", /JSON|解析|截断/);
    assert.match(records[4]!.retryReason ?? "", /标题直接公布了核心答案/);
    assert.equal(records[6]!.retryReason, "终审未通过后的二次检查");
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    if (originalEnabled === undefined) delete process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS;
    else process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS = originalEnabled;
    await rm(projectDir, { recursive: true, force: true });
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
