import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/content-adaptation/route";

const AI_ITEM = {
  key: "topic-1",
  contentProfile: {
    primaryTrack: "职场成长",
    secondaryTrack: "知识科普",
    fineTags: ["晋升沟通", "职场新人"],
    targetAudience: "希望获得晋升但不懂成果表达的职场新人",
    audienceTags: ["职场新人", "晋升阶段"],
    primaryPurpose: "知识教育",
    secondaryPurpose: "信任建立",
    reasons: {
      track: "内容讨论职场晋升方法",
      audience: "正文指向希望晋升的职场新人",
      purpose: "通过解释方法提供知识并建立信任",
    },
  },
  ipFit: {
    tier: "高度匹配",
    reason: "内容赛道和目标人群都符合当前IP定位",
  },
};

function deepSeekResponse(content: string) {
  return new Response(JSON.stringify({
    id: "content-adaptation-request",
    choices: [{
      finish_reason: "stop",
      message: { content },
    }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 200,
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function adaptationRequest(body: unknown) {
  return new NextRequest("http://localhost/api/content-adaptation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "test-key",
    },
    body: JSON.stringify(body),
  });
}

test("统一入口按固定口径返回内容适配和独立IP匹配结果", async () => {
  const originalFetch = globalThis.fetch;
  let outboundBody = "";
  globalThis.fetch = async (_input, init) => {
    outboundBody = String(init?.body ?? "");
    return deepSeekResponse(JSON.stringify({ items: [AI_ITEM] }));
  };

  try {
    const response = await POST(adaptationRequest({
      items: [{ key: "topic-1", content: "为什么努力工作却一直得不到晋升？" }],
      ipContext: {
        id: "ip-career",
        name: "职场教练",
        positioning: "帮助职场新人提升沟通和晋升能力",
        audience: "工作1至5年的职场新人",
        contentDirection: ["职场成长"],
      },
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.items[0].contentProfile.primaryTrack, "职场成长");
    assert.equal(body.items[0].ipFit.tier, "高度匹配");
    assert.match(outboundBody, /先描述内容本身/);
    assert.match(outboundBody, /财经商业/);
    assert.match(outboundBody, /知识教育/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("统一入口拒绝空内容和重复条目编号且不调用AI", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("不应调用AI");
  };

  try {
    const response = await POST(adaptationRequest({
      items: [
        { key: "same", content: "有效内容" },
        { key: "same", content: " " },
      ],
    }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /内容|编号/);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
