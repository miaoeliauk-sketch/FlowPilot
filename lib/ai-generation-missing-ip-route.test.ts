import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as scriptFactoryPOST } from "../app/api/script-factory/route";
import type { IPProfile } from "./types";

const VALID_IP: IPProfile = {
  id: "ip-shuimuran",
  name: "水木然",
  avatar: "水",
  positioning: "商业认知作者",
  platforms: ["视频号"],
  audience: "关注商业趋势和个人成长的人",
  contentDirection: ["商业洞察"],
  personaKeywords: ["理性", "洞察"],
  professionalIdentity: "商业作者",
  personalityTags: ["克制", "清醒"],
  credibilitySource: "长期研究商业趋势并持续公开写作",
  representativeViewpoints: ["趋势最终会落到个人选择"],
  tone: "理性克制",
  commonOpenings: ["很多人没意识到"],
  commonClosings: ["这才是关键"],
  catchphrases: ["看懂趋势"],
  forbiddenExpressions: ["装修", "豪宅"],
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

function postRequest(path: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "test-key",
    },
    body: JSON.stringify(body),
  });
}

async function assertInvalidIPRejected(
  post: (request: NextRequest) => Promise<Response>,
  path: string,
) {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("无效IP不应调用DeepSeek");
  };

  try {
    for (const ipProfile of [
      { id: "", name: "水木然" },
      { id: "ip-shuimuran", name: "   " },
    ]) {
      const response = await post(postRequest(path, {
        topic: "普通人如何判断下一轮行业变化",
        ipProfile,
      }));
      const result = await response.json();

      assert.equal(response.status, 400);
      assert.equal(result.errorCode, "MISSING_IP_PROFILE");
      assert.equal(result.apiMeta.apiCalled, false);
    }
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("经典脚本接口缺少当前IP时返回400且不调用DeepSeek", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "{}" } }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const response = await scriptFactoryPOST(postRequest("/api/script-factory", {
      topic: "普通人如何判断下一轮行业变化",
    }));
    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.errorCode, "MISSING_IP_PROFILE");
    assert.match(result.error, /当前操盘IP/);
    assert.equal(result.apiMeta.apiCalled, false);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("经典脚本接口拒绝ID或名称为空的IP", async () => {
  await assertInvalidIPRejected(scriptFactoryPOST, "/api/script-factory");
});

test("经典脚本接口拒绝只有ID和名称的不完整IP档案且不调用DeepSeek", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("不完整IP不应调用DeepSeek");
  };

  try {
    const response = await scriptFactoryPOST(postRequest("/api/script-factory", {
      topic: "普通人如何判断下一轮行业变化",
      ipProfile: { id: "ip-shuimuran", name: "水木然" },
    }));
    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.errorCode, "INVALID_IP_PROFILE");
    assert.equal(result.errorField, "ipProfile.avatar");
    assert.equal(result.apiMeta.apiCalled, false);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("经典脚本接口拒绝未登记的专属编导规则", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("无效专属规则不应调用DeepSeek");
  };

  try {
    const response = await scriptFactoryPOST(postRequest("/api/script-factory", {
      topic: "普通人如何判断下一轮行业变化",
      ipProfile: { ...VALID_IP, scriptDirectorProfileId: "unknown" },
    }));
    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.errorCode, "INVALID_IP_PROFILE");
    assert.equal(result.errorField, "ipProfile.scriptDirectorProfileId");
    assert.equal(result.apiMeta.apiCalled, false);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("选题和IP同时缺失时优先返回IP错误", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("双缺失请求不应调用DeepSeek");
  };

  try {
    const response = await scriptFactoryPOST(postRequest("/api/script-factory", {}));
    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.errorCode, "MISSING_IP_PROFILE");
    assert.equal(result.apiMeta.apiCalled, false);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("经典脚本接口拒绝错误的IP数组和布尔字段类型且不调用DeepSeek", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("字段类型错误时不应调用DeepSeek");
  };

  try {
    const invalidProfiles = [
      {
        ipProfile: { ...VALID_IP, platforms: "视频号" },
        errorField: "ipProfile.platforms",
      },
      {
        ipProfile: { ...VALID_IP, showsFace: "true" },
        errorField: "ipProfile.showsFace",
      },
    ];

    for (const { ipProfile, errorField } of invalidProfiles) {
      const response = await scriptFactoryPOST(postRequest("/api/script-factory", {
        topic: "普通人如何判断下一轮行业变化",
        ipProfile,
      }));
      const result = await response.json();

      assert.equal(response.status, 400);
      assert.equal(result.errorCode, "INVALID_IP_PROFILE");
      assert.equal(result.errorField, errorField);
      assert.match(result.error, new RegExp(errorField.replace("ipProfile.", "")));
      assert.equal(result.apiMeta.apiCalled, false);
    }
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
